import { describe, expect, it, vi } from "vitest";
import { chunkReportText, extractCandidates } from "@/modules/extraction";
import type { LlmClient } from "@/modules/extraction/llm-client";
import type { ExtractionResult } from "@/modules/shared/contracts";

describe("chunkReportText", () => {
  it("splits long text into chunks that respect the configured ceiling", () => {
    const chunks = chunkReportText("One sentence. Two sentence. ".repeat(200), 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkReportText("Only one sentence here.", 120)).toEqual(["Only one sentence here."]);
  });
});

describe("extractCandidates", () => {
  it("merges results across chunks", async () => {
    const result: ExtractionResult = {
      entities: [{ type: "malware", name: "EvilBoat", confidence: 0.9, evidence: "EvilBoat" }],
      relationships: [],
    };
    const client: LlmClient = { extract: vi.fn(async () => result) };
    const merged = await extractCandidates("Short text.", client);
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0].name).toBe("EvilBoat");
  });

  it("retries a chunk after malformed output and eventually succeeds", async () => {
    const result: ExtractionResult = {
      entities: [{ type: "threat-actor", name: "APT29", confidence: 0.8, evidence: "APT29" }],
      relationships: [],
    };
    const client: LlmClient = {
      extract: vi
        .fn()
        .mockRejectedValueOnce(new Error("malformed"))
        .mockResolvedValueOnce(result),
    };
    const merged = await extractCandidates("Short text.", client);
    expect(client.extract).toHaveBeenCalledTimes(2);
    expect(merged.entities[0].name).toBe("APT29");
  });

  it("propagates the last error after exhausting retries", async () => {
    const client: LlmClient = { extract: vi.fn(async () => Promise.reject(new Error("boom"))) };
    await expect(extractCandidates("Short text.", client)).rejects.toThrow("boom");
    expect(client.extract).toHaveBeenCalledTimes(3);
  });
});
