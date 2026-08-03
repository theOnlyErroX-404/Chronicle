import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from "@/modules/shared/contracts";
import { normalizeName } from "@/modules/knowledge-modeling";

export type GoldenEntity = {
  type: ExtractedEntity["type"];
  name: string;
  aliases?: string[];
};

export type GoldenRelationship = {
  source: string;
  type: ExtractedRelationship["type"];
  target: string;
};

export type GoldenReport = {
  id: string;
  title: string;
  text: string;
  entities: GoldenEntity[];
  relationships: GoldenRelationship[];
};

export type Metric = { precision: number; recall: number; f1: number };
export type SetScore = Metric & { matched: number; extracted: number; expected: number };

export type ReportScore = {
  reportId: string;
  entities: SetScore;
  relationships: SetScore;
};

export type EvaluationResult = {
  perReport: ReportScore[];
  entities: SetScore;
  relationships: SetScore;
};

export type ExtractionRunner = (text: string) => Promise<ExtractionResult>;

// Maps every canonical name and alias to the report's canonical normalized name,
// so extraction output that uses an alias ("Cozy Bear" for "Midnight Blizzard")
// still matches the golden label the same way entity resolution in the graph does.
export const buildAliasMap = (entities: GoldenEntity[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const entity of entities) {
    const canonical = normalizeName(entity.name);
    map.set(canonical, canonical);
    for (const alias of entity.aliases ?? []) map.set(normalizeName(alias), canonical);
  }
  return map;
};

const canonicalize = (name: string, aliases: Map<string, string>) => aliases.get(normalizeName(name)) ?? normalizeName(name);

export const scoreSet = (matched: number, extracted: number, expected: number): SetScore => {
  const precision = extracted === 0 ? 0 : matched / extracted;
  const recall = expected === 0 ? 0 : matched / expected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, matched, extracted, expected };
};

// One-to-one matching: an extracted item can only match one expected item and
// vice versa, so duplicate extractions do not inflate the score.
const countOneToOneMatches = <TExtracted, TExpected>(
  extracted: TExtracted[],
  expected: TExpected[],
  matches: (item: TExtracted, gold: TExpected) => boolean,
): number => {
  const usedExpected = new Set<number>();
  let matched = 0;
  for (const item of extracted) {
    for (let index = 0; index < expected.length; index += 1) {
      if (usedExpected.has(index)) continue;
      if (matches(item, expected[index])) {
        usedExpected.add(index);
        matched += 1;
        break;
      }
    }
  }
  return matched;
};

export const scoreEntities = (extracted: ExtractedEntity[], golden: GoldenEntity[], aliases: Map<string, string>): SetScore => {
  const matches = (item: ExtractedEntity, gold: GoldenEntity) =>
    item.type === gold.type && canonicalize(item.name, aliases) === normalizeName(gold.name);
  const matched = countOneToOneMatches(extracted, golden, matches);
  return scoreSet(matched, extracted.length, golden.length);
};

export const scoreRelationships = (
  extracted: ExtractedRelationship[],
  golden: GoldenRelationship[],
  aliases: Map<string, string>,
): SetScore => {
  const matches = (item: ExtractedRelationship, gold: GoldenRelationship) =>
    item.type === gold.type &&
    canonicalize(item.source, aliases) === normalizeName(gold.source) &&
    canonicalize(item.target, aliases) === normalizeName(gold.target);
  const matched = countOneToOneMatches(extracted, golden, matches);
  return scoreSet(matched, extracted.length, golden.length);
};

export const scoreReport = (golden: GoldenReport, extracted: ExtractionResult): ReportScore => {
  const aliases = buildAliasMap(golden.entities);
  return {
    reportId: golden.id,
    entities: scoreEntities(extracted.entities, golden.entities, aliases),
    relationships: scoreRelationships(extracted.relationships, golden.relationships, aliases),
  };
};

export const evaluate = async (golden: GoldenReport[], run: ExtractionRunner): Promise<EvaluationResult> => {
  const perReport: ReportScore[] = [];
  for (const report of golden) {
    perReport.push(scoreReport(report, await run(report.text)));
  }
  const aggregate = (field: "entities" | "relationships"): SetScore => {
    const totals = perReport.reduce(
      (acc, score) => ({
        matched: acc.matched + score[field].matched,
        extracted: acc.extracted + score[field].extracted,
        expected: acc.expected + score[field].expected,
      }),
      { matched: 0, extracted: 0, expected: 0 },
    );
    return scoreSet(totals.matched, totals.extracted, totals.expected);
  };
  return { perReport, entities: aggregate("entities"), relationships: aggregate("relationships") };
};
