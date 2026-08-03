import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleLlmClient } from "@/modules/extraction/llm-client";

const completionsResponse = (content: unknown) =>
  ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) }) as unknown as Response;

const statusResponse = (status: number) => ({ ok: false, status }) as unknown as Response;

describe("OpenAiCompatibleLlmClient two-pass extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs an entities pass then a relationships pass with structured output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completionsResponse({ entities: [{ type: "threat-actor", name: "APT29", confidence: 1, evidence: "APT29 used SLUI" }] }),
      )
      .mockResolvedValueOnce(
        completionsResponse({ relationships: [{ source: "APT29", target: "SLUI", type: "uses", confidence: 1, evidence: "used SLUI" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiCompatibleLlmClient().extract("APT29 used SLUI.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [request] = fetchMock.mock.calls[0];
    expect(String(request)).toContain("/chat/completions");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${process.env.OPENAI_API_KEY}`);
    expect(headers["content-type"]).toBe("application/json");

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.response_format).toMatchObject({ type: "json_schema" });
    expect(firstBody.response_format.json_schema.name).toBe("entities");
    expect(firstBody.response_format.json_schema.schema.properties.entities).toBeDefined();
    expect(firstBody.temperature).toBe(0);

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.response_format.json_schema.name).toBe("relationships");
    expect(secondBody.response_format.json_schema.schema.properties.relationships.items.properties.source.enum).toEqual(["APT29"]);
    expect(result.relationships).toHaveLength(1);
  });

  it("skips the relationships pass when no entities were extracted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(completionsResponse({ entities: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiCompatibleLlmClient().extract("No facts here.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.relationships).toEqual([]);
  });

  it("classifies a rejected API key as a 401 llm-auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(statusResponse(401)));

    await expect(new OpenAiCompatibleLlmClient().extract("X.")).rejects.toMatchObject({
      status: 401,
      type: "https://chronicle.local/problems/llm-auth",
    });
  });

  it("classifies a rate limit as a 429 llm-rate-limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(statusResponse(429)));

    await expect(new OpenAiCompatibleLlmClient().extract("X.")).rejects.toMatchObject({
      status: 429,
      type: "https://chronicle.local/problems/llm-rate-limit",
    });
  });

  it("classifies invalid output as a 502 invalid-llm-output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(completionsResponse({ entities: [{ type: "not-a-type", name: "X", confidence: 9, evidence: "" }] })),
    );

    await expect(new OpenAiCompatibleLlmClient().extract("X.")).rejects.toMatchObject({
      status: 502,
      type: "https://chronicle.local/problems/invalid-llm-output",
    });
  });

  it("classifies a timed-out call as a 504 llm-timeout", async () => {
    const timeout = new Error("The operation was aborted.");
    timeout.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(timeout));

    await expect(new OpenAiCompatibleLlmClient().extract("X.")).rejects.toMatchObject({
      status: 504,
      type: "https://chronicle.local/problems/llm-timeout",
    });
  });

  it("verifies the API key and reachability through GET /models", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }), status: 200 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiCompatibleLlmClient().checkHealth?.();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/models");
  });
});
