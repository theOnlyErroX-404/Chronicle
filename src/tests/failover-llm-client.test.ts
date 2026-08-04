import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailoverLlmClient, resetLlmCache } from "@/modules/extraction/llm-client";
import type { OpenAiEndpoint } from "@/lib/config";
import type { ExtractedEntity } from "@/modules/shared/contracts";

const completionsResponse = (content: unknown) =>
  ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) }) as unknown as Response;

const statusResponse = (status: number) => ({ ok: false, status }) as unknown as Response;

const endpoint = (baseUrl: string): OpenAiEndpoint => ({
  baseUrl,
  apiKey: "k",
  chatModel: "m",
  maxTokens: 8192,
});

const entities: { entities: ExtractedEntity[] } = {
  entities: [{ type: "threat-actor", name: "APT41", confidence: 1, evidence: "APT41" }],
};

// Route requests by base URL so the mock can tell the two endpoints apart.
const byUrl = (calls: ReturnType<typeof vi.fn>["mock"]["calls"]) => (baseUrl: string) =>
  calls.filter(([request]) => String(request).includes(baseUrl)).length;

describe("FailoverLlmClient", () => {
  beforeEach(() => {
    resetLlmCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fails over to the next endpoint on a rate limit and keeps using it", async () => {
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(429) : completionsResponse(entities),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);

    const first = await client.extractEntities("APT41.");
    const second = await client.extractEntities("APT41 again.");

    expect(first[0].name).toBe("APT41");
    expect(second[0].name).toBe("APT41");
    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(1); // rate-limited once, then blacked out
    expect(count("b.example")).toBe(2); // healthy endpoint carried both passes
  });

  it("escalates a second rate limit into a long blackout", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(429) : completionsResponse(entities),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);

    await client.extractEntities("one."); // a: 429 -> 1 min blackout, b: ok
    vi.setSystemTime(t0 + 61_000);
    await client.extractEntities("two."); // a: 429 again -> 30 min blackout, b: ok
    vi.setSystemTime(t0 + 120_000);
    await client.extractEntities("three."); // a still blacked out, b: ok

    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(2); // probed twice, then not again within 30 min
    expect(count("b.example")).toBe(3);
  });

  it("fails over to the next endpoint on a rejected API key (401)", async () => {
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(401) : completionsResponse(entities),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);
    await client.extractEntities("APT41.");

    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(1); // 401 -> 30 min blackout
    expect(count("b.example")).toBe(1);
  });

  it("fails over to the next endpoint on an upstream 5xx", async () => {
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(503) : completionsResponse(entities),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);
    await client.extractEntities("APT41.");

    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(1); // 5xx -> short blackout
    expect(count("b.example")).toBe(1);
  });

  it("fails over on extractRelationships too", async () => {
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(429) : completionsResponse({ relationships: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);

    const result = await client.extractRelationships("APT41.", entities.entities);

    expect(result).toEqual([]);
    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(1); // rate-limited once, then blacked out
    expect(count("b.example")).toBe(1);
  });

  it("propagates the last error when every endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => statusResponse(429)));

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);

    await expect(client.extractEntities("APT41.")).rejects.toMatchObject({ status: 429 });
  });

  it("reports 503 when every endpoint is cooling down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => statusResponse(429)));

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);

    await expect(client.extractEntities("APT41.")).rejects.toMatchObject({ status: 429 });
    await expect(client.extractEntities("APT41 again.")).rejects.toMatchObject({
      status: 503,
      type: "https://chronicle.local/problems/llm-unavailable",
    });
  });

  it("checkHealth succeeds if any endpoint is healthy", async () => {
    const fetchMock = vi.fn(async (request: Request | string) =>
      String(request).includes("a.example") ? statusResponse(401) : ({ ok: true, json: async () => ({}) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverLlmClient([endpoint("https://a.example"), endpoint("https://b.example")]);
    await client.checkHealth();

    const count = byUrl(fetchMock.mock.calls);
    expect(count("a.example")).toBe(1);
    expect(count("b.example")).toBe(1);
  });

  it("rejects an empty endpoint list", () => {
    expect(() => new FailoverLlmClient([])).toThrow(/No OpenAI-compatible endpoints/);
  });
});
