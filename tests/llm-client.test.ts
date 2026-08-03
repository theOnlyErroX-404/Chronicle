import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaLlmClient } from "@/modules/extraction/llm-client";

const jsonResponse = (content: unknown) =>
  ({ ok: true, json: async () => ({ message: { content: JSON.stringify(content) } }) }) as unknown as Response;

describe("OllamaLlmClient two-pass extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs an entities pass then a relationships pass and merges the results", async () => {
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              relationships: [{ source: "APT29", target: "SLUI", type: "uses", confidence: 1, evidence: "used SLUI" }],
            }),
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OllamaLlmClient().extract("APT29 used SLUI.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({ source: "APT29", target: "SLUI", type: "uses" });
  });

  it("constrains relationship endpoints to extracted entity names via the schema enum", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ entities: [{ type: "malware", name: "EvilRAT", confidence: 1, evidence: "EvilRAT" }] }))
      .mockResolvedValueOnce(jsonResponse({ relationships: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaLlmClient().extract("EvilRAT spreads.");

    const relationshipRequest = fetchMock.mock.calls[1];
    const body = JSON.parse(relationshipRequest[1].body as string);
    expect(body.format.properties.relationships.items.properties.source.enum).toEqual(["EvilRAT"]);
    expect(body.format.properties.relationships.items.properties.target.enum).toEqual(["EvilRAT"]);
  });

  it("skips the relationships pass when no entities were extracted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ entities: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OllamaLlmClient().extract("No facts here.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.relationships).toEqual([]);
  });

  it("classifies invalid entity output as a 502 invalid-llm-output", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ entities: [{ type: "not-a-type", name: "X", confidence: 9, evidence: "" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OllamaLlmClient().extract("X.")).rejects.toMatchObject({
      name: "ChronicleError",
      status: 502,
      type: "https://chronicle.local/problems/invalid-llm-output",
    });
  });

  it("classifies invalid relationship output as a 502 invalid-llm-output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ entities: [{ type: "malware", name: "X", confidence: 1, evidence: "X" }] }))
      .mockResolvedValueOnce(jsonResponse({ relationships: [{ source: "X", target: "X", type: "wrong-type", confidence: 1, evidence: "" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OllamaLlmClient().extract("X.")).rejects.toMatchObject({
      name: "ChronicleError",
      status: 502,
      type: "https://chronicle.local/problems/invalid-llm-output",
    });
  });

  it("classifies a timed-out call as a 504 llm-timeout", async () => {
    const timeout = new Error("The operation was aborted.");
    timeout.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(timeout));

    await expect(new OllamaLlmClient().extract("X.")).rejects.toMatchObject({
      status: 504,
      type: "https://chronicle.local/problems/llm-timeout",
    });
  });
});
