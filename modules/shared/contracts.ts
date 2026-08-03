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

export const ExtractionResultSchema = z.object({
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
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const ReportStatusSchema = z.enum([
  "queued",
  "ingesting",
  "extracting",
  "modeling",
  "done",
  "failed",
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const JobInfoSchema = z.object({
  id: z.string(),
  report_id: z.string(),
  status: ReportStatusSchema,
  progress: z.string().optional(),
  partial: z.boolean().optional(),
  error: z.string().optional(),
  queue_position: z.number().int().min(0).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobInfo = z.infer<typeof JobInfoSchema>;
