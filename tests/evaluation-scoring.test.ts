import { describe, expect, it } from "vitest";
import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from "@/modules/shared/contracts";
import { buildAliasMap, evaluate, scoreEntities, scoreRelationships, scoreReport, scoreSet } from "@/evaluation/scoring";
import { GOLDEN_REPORTS } from "@/evaluation/golden-set";

const entity = (type: ExtractedEntity["type"], name: string): ExtractedEntity => ({ type, name, confidence: 0.9, evidence: "" });
const relationship = (source: string, type: ExtractedRelationship["type"], target: string): ExtractedRelationship => ({
  source,
  target,
  type,
  confidence: 0.9,
  evidence: "",
});

describe("evaluation scoring", () => {
  it("scores an empty extracted set as zero precision and zero recall", () => {
    const score = scoreSet(0, 0, 5);
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
    expect(score.f1).toBe(0);
    expect(score.expected).toBe(5);
  });

  it("reports perfect precision, recall, and F1 on exact matches", () => {
    const aliases = buildAliasMap([{ type: "threat-actor", name: "APT29" }]);
    const score = scoreEntities([entity("threat-actor", "APT29")], [{ type: "threat-actor", name: "APT29" }], aliases);
    expect(score).toMatchObject({ matched: 1, extracted: 1, expected: 1, precision: 1, recall: 1, f1: 1 });
  });

  it("normalizes punctuation, spacing, and case so CVE names match", () => {
    const aliases = buildAliasMap([{ type: "vulnerability", name: "CVE-2023-23397" }]);
    const score = scoreEntities([entity("vulnerability", "CVE 2023 23397")], [{ type: "vulnerability", name: "CVE-2023-23397" }], aliases);
    expect(score.matched).toBe(1);
  });

  it("ignores a leading 'The ' when matching entity names", () => {
    const aliases = buildAliasMap([{ type: "threat-actor", name: "Lazarus Group" }]);
    const score = scoreEntities([entity("threat-actor", "The Lazarus Group")], [{ type: "threat-actor", name: "Lazarus Group" }], aliases);
    expect(score.matched).toBe(1);
  });

  it("matches a golden entity via an alias", () => {
    const aliases = buildAliasMap([{ type: "threat-actor", name: "Midnight Blizzard", aliases: ["Cozy Bear"] }]);
    const score = scoreEntities([entity("threat-actor", "Cozy Bear")], [{ type: "threat-actor", name: "Midnight Blizzard" }], aliases);
    expect(score.matched).toBe(1);
  });

  it("does not match across entity types even when the name is identical", () => {
    const aliases = buildAliasMap([{ type: "malware", name: "SLUI" }]);
    const score = scoreEntities([entity("threat-actor", "SLUI")], [{ type: "malware", name: "SLUI" }], aliases);
    expect(score.matched).toBe(0);
  });

  it("penalizes false positives: extras lower precision but not recall", () => {
    const aliases = buildAliasMap([{ type: "country", name: "Ukraine" }]);
    const score = scoreEntities(
      [entity("country", "Ukraine"), entity("country", "Germany"), entity("country", "Poland")],
      [{ type: "country", name: "Ukraine" }],
      aliases,
    );
    expect(score).toMatchObject({ matched: 1, extracted: 3, expected: 1 });
    expect(score.precision).toBeCloseTo(1 / 3);
    expect(score.recall).toBe(1);
  });

  it("penalizes false negatives: misses lower recall", () => {
    const aliases = buildAliasMap([{ type: "country", name: "Ukraine" }, { type: "country", name: "Russia" }]);
    const score = scoreEntities([entity("country", "Ukraine")], [{ type: "country", name: "Ukraine" }, { type: "country", name: "Russia" }], aliases);
    expect(score).toMatchObject({ matched: 1, extracted: 1, expected: 2 });
    expect(score.recall).toBe(0.5);
    expect(score.precision).toBe(1);
  });

  it("does not double-count duplicate extractions (one-to-one matching)", () => {
    const aliases = buildAliasMap([{ type: "malware", name: "Carbanak" }]);
    const score = scoreEntities(
      [entity("malware", "Carbanak"), entity("malware", "Carbanak")],
      [{ type: "malware", name: "Carbanak" }],
      aliases,
    );
    expect(score).toMatchObject({ matched: 1, extracted: 2, expected: 1 });
    expect(score.precision).toBe(0.5);
  });

  it("resolves relationship endpoints through aliases", () => {
    const aliases = buildAliasMap([{ type: "threat-actor", name: "Midnight Blizzard", aliases: ["APT29"] }, { type: "malware", name: "SLUI" }]);
    const score = scoreRelationships(
      [relationship("APT29", "uses", "SLUI")],
      [{ source: "Midnight Blizzard", type: "uses", target: "SLUI" }],
      aliases,
    );
    expect(score.matched).toBe(1);
  });

  it("rejects a relationship with the wrong type even with matching endpoints", () => {
    const aliases = buildAliasMap([{ type: "malware", name: "SLUI" }, { type: "vulnerability", name: "CVE-2023-23397" }]);
    const score = scoreRelationships(
      [relationship("SLUI", "targets", "CVE-2023-23397")],
      [{ source: "SLUI", type: "exploits", target: "CVE-2023-23397" }],
      aliases,
    );
    expect(score.matched).toBe(0);
  });

  it("requires both endpoints to resolve to the golden canonical names", () => {
    const aliases = buildAliasMap([{ type: "malware", name: "SLUI" }]);
    const score = scoreRelationships(
      [relationship("SLUI", "uses", "unknown-tool")],
      [{ source: "SLUI", type: "uses", target: "unrelated" }],
      aliases,
    );
    expect(score.matched).toBe(0);
  });

  it("scoreReport computes separate entity and relationship scores", () => {
    const golden = GOLDEN_REPORTS[0];
    const extracted: ExtractionResult = {
      entities: [entity("threat-actor", "Midnight Blizzard"), entity("malware", "SLUI"), entity("country", "Ukraine")],
      relationships: [relationship("Midnight Blizzard", "uses", "SLUI")],
    };
    const score = scoreReport(golden, extracted);
    expect(score.entities.matched).toBe(3);
    expect(score.relationships.matched).toBe(1);
  });

  it("evaluate aggregates entity and relationship totals separately across reports", async () => {
    const first = GOLDEN_REPORTS[0];
    const second = GOLDEN_REPORTS[1];
    const result = await evaluate(
      [first, second],
      async (text) => {
        if (text === first.text) {
          return { entities: first.entities.map((e) => entity(e.type, e.name)), relationships: first.relationships.map((r) => relationship(r.source, r.type, r.target)) };
        }
        return { entities: [], relationships: [] };
      },
    );
    expect(result.entities.expected).toBe(first.entities.length + second.entities.length);
    expect(result.entities.matched).toBe(first.entities.length);
    expect(result.relationships.expected).toBe(first.relationships.length + second.relationships.length);
    expect(result.relationships.matched).toBe(first.relationships.length);
    expect(result.perReport).toHaveLength(2);
  });

  it("loads the external golden-set.json and validates every report against the contract enums", () => {
    expect(GOLDEN_REPORTS).toHaveLength(4);
    for (const report of GOLDEN_REPORTS) {
      expect(report.id).toMatch(/^[a-z0-9-]+$/);
      expect(report.entities.length).toBeGreaterThan(0);
      for (const entityItem of report.entities) {
        expect(["threat-actor", "malware", "tool", "web-shell", "vulnerability", "indicator", "sector", "country", "campaign", "email", "file-path"]).toContain(entityItem.type);
      }
      for (const rel of report.relationships) {
        expect(["uses", "exploits", "targets", "attributed-to", "communicates-with", "mitigated-by", "executes", "downloads", "delivers", "exfiltrates"]).toContain(rel.type);
      }
    }
  });
});
