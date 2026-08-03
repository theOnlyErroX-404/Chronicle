import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaLlmClient, resetLlmCache } from "@/modules/extraction/llm-client";
import type { ExtractedEntity } from "@/modules/shared/contracts";

const jsonResponse = (content: unknown) =>
  ({ ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) }) as unknown as Response;

const entity = (name: string): ExtractedEntity => ({ type: "malware", name, confidence: 1, evidence: name });

describe("OllamaLlmClient extraction passes", () => {
  beforeEach(() => {
    resetLlmCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs an entities pass then a relationships pass and returns their results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          entities: [
            { type: "threat-actor", name: "APT29", aliases: ["Cozy Bear"], confidence: 1, evidence: "APT29 used SLUI" },
            { type: "malware", name: "SLUI", confidence: 1, evidence: "used SLUI" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          relationships: [{ source: "APT29", target: "SLUI", type: "uses", confidence: 1, evidence: "used SLUI" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaLlmClient();
    const entities = await client.extractEntities("APT29 used SLUI.");
    const relationships = await client.extractRelationships("APT29 used SLUI.", entities);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(entities).toHaveLength(2);
    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({ source: "APT29", target: "SLUI", type: "uses" });
  });

  it("constrains relationship endpoints to the supplied entity names via the schema enum", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ entities: [entity("EvilRAT")] }))
      .mockResolvedValueOnce(jsonResponse({ relationships: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaLlmClient();
    const entities = await client.extractEntities("EvilRAT spreads.");
    await client.extractRelationships("EvilRAT spreads.", entities);

    const relationshipRequest = fetchMock.mock.calls[1];
    const body = JSON.parse(relationshipRequest[1].body as string);
    expect(body.format.properties.relationships.items.properties.source.enum).toEqual(["EvilRAT"]);
    expect(body.format.properties.relationships.items.properties.target.enum).toEqual(["EvilRAT"]);
  });

  it("passes the full merged entity set so cross-chunk endpoints are expressible", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ relationships: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const entities = [entity("APT41"), entity("BEACON")];
    await new OllamaLlmClient().extractRelationships("chunk text", entities);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.format.properties.relationships.items.properties.source.enum).toEqual(["APT41", "BEACON"]);
  });

  it("keeps the model warm and bounds context via keep_alive and num_ctx", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ entities: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaLlmClient().extractEntities("chunk text");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.keep_alive).toBe("30m");
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.num_predict).toBe(2048);
  });

  it("serves an identical repeat pass from the cache without calling the model again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entities: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OllamaLlmClient();
    await client.extractEntities("Cache me.");
    await client.extractEntities("Cache me.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies invalid entity output as a 502 invalid-llm-output", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ entities: [{ type: "not-a-type", name: "X", confidence: 9, evidence: "" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OllamaLlmClient().extractEntities("X.")).rejects.toMatchObject({
      name: "ChronicleError",
      status: 502,
      type: "https://chronicle.local/problems/invalid-llm-output",
    });
  });

  it("classifies invalid relationship output as a 502 invalid-llm-output", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ relationships: [{ source: "X", target: "X", type: "wrong-type", confidence: 1, evidence: "" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OllamaLlmClient().extractRelationships("X.", [])).rejects.toMatchObject({
      name: "ChronicleError",
      status: 502,
      type: "https://chronicle.local/problems/invalid-llm-output",
    });
  });

  it("classifies a timed-out call as a 504 llm-timeout", async () => {
    const timeout = new Error("The operation was aborted.");
    timeout.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(timeout));

    await expect(new OllamaLlmClient().extractEntities("X.")).rejects.toMatchObject({
      status: 504,
      type: "https://chronicle.local/problems/llm-timeout",
    });
  });
});
