import { z } from "zod";

export const EntityTypeSchema = z.enum([
  "threat-actor",
  "malware",
  "tool",
  "web-shell",
  "vulnerability",
  "indicator",
  "sector",
  "country",
  "campaign",
  "email",
  "file-path",
]);

export const RelationshipTypeSchema = z.enum([
  "uses",
  "exploits",
  "targets",
  "attributed-to",
  "communicates-with",
  "mitigated-by",
  "executes",
  "downloads",
  "delivers",
  "exfiltrates",
]);

// Single source of truth for the allowed values: JSON-schema prompts, the
// evaluation suite, and validation all derive from these, so adding a type in
// one place can never silently drift from the others.
export const ENTITY_TYPE_VALUES = EntityTypeSchema.options;
export const RELATIONSHIP_TYPE_VALUES = RelationshipTypeSchema.options;

export const ExtractionEntitySchema = z.object({
  type: EntityTypeSchema,
  name: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
  // qwen2.5:3b frequently emits empty evidence for self-evident items (e.g. an
  // IOC row); empty is accepted rather than failing the whole chunk.
  evidence: z.string().max(1_500),
  // Alternative names for the same entity, so the graph can merge alias nodes
  // instead of rendering duplicates. The prompt tells the model to report
  // aliases here rather than as separate entities.
  aliases: z.array(z.string().min(1).max(300)).max(10).optional(),
});

export const ExtractionRelationshipSchema = z.object({
  source: z.string().min(1).max(300),
  target: z.string().min(1).max(300),
  type: RelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(1_500),
});

// Schema kept module-private: extraction validates via the two pass-only schemas
// in llm-client.ts, so this aggregate is used purely for type inference.
const ExtractionResultSchema = z.object({
  entities: z.array(ExtractionEntitySchema).max(250),
  relationships: z.array(ExtractionRelationshipSchema).max(500),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExtractedEntity = z.infer<typeof ExtractionEntitySchema>;
export type ExtractedRelationship = z.infer<typeof ExtractionRelationshipSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: EntityTypeSchema,
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: RelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
});

export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type Graph = z.infer<typeof GraphSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const ReportStatusSchema = z.enum([
  "queued",
  "ingesting",
  "extracting",
  "modeling",
  "done",
  "failed",
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

// Human-in-the-loop feedback (architecture §2 Feedback context): an analyst
// accepts, rejects, or corrects an extracted entity / relationship / mapping.
// targetId refers to the graph node id (entity), edge id (relationship), or
// technique mapping key; correctedValue carries the field overrides for
// "correct" actions (e.g. { name: "..." } for an entity).
export const CorrectionTargetSchema = z.enum(["entity", "relationship", "mapping"]);
export const CorrectionActionSchema = z.enum(["accept", "reject", "correct"]);

// Value bounds keep each entry small; the 64KB request-body cap bounds the total.
const CorrectionValueSchema = z.record(z.string().min(1).max(100), z.union([z.string().max(500), z.number().min(-1e9).max(1e9)]));

export const CorrectionSchema = z.object({
  id: z.string().min(1),
  targetType: CorrectionTargetSchema,
  targetId: z.string().min(1).max(300),
  action: CorrectionActionSchema,
  correctedValue: CorrectionValueSchema.optional(),
  note: z.string().max(500).optional(),
  createdAt: z.string(),
});

// What the API accepts: id and createdAt are server-assigned, never client-supplied.
export const CorrectionInputSchema = CorrectionSchema.omit({ id: true, createdAt: true });

export type Correction = z.infer<typeof CorrectionSchema>;
export type CorrectionInput = z.infer<typeof CorrectionInputSchema>;
