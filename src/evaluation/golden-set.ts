import { z } from "zod";
import { EntityTypeSchema, RelationshipTypeSchema } from "@/modules/shared/contracts";
import type { GoldenReport } from "@/evaluation/scoring";
import goldenReportsData from "./golden-set.json";

// The hand-labeled golden set for the architecture's Phase 1 quality gate
// (§5, §6) lives in golden-set.json as pure data. This module is the loader:
// it validates the file against the same entity/relationship type enums the
// extraction contracts use, so a malformed golden entry fails fast instead of
// skewing a run.
//
// Convention: each report is a single chunk (well under EXTRACTION_MAX_CHUNK_CHARS),
// unambiguous on purpose, and only uses facts a 3B model can extract from the text
// itself (no behavioral inference required). Golden relationships reference the
// canonical entity names or their aliases above.

const GoldenEntitySchema = z.object({
  type: EntityTypeSchema,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
});

const GoldenRelationshipSchema = z.object({
  source: z.string().min(1),
  type: RelationshipTypeSchema,
  target: z.string().min(1),
});

const GoldenReportSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  entities: z.array(GoldenEntitySchema).min(1),
  relationships: z.array(GoldenRelationshipSchema),
});

const GoldenSetSchema = z.array(GoldenReportSchema).min(1);

export const GOLDEN_REPORTS: GoldenReport[] = GoldenSetSchema.parse(goldenReportsData);
