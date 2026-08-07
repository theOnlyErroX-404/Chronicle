import { z } from 'zod';

export const EntityTypeSchema = z.enum([
  'threat-actor',
  'malware',
  'tool',
  'web-shell',
  'vulnerability',
  'indicator',
  'sector',
  'country',
  'campaign',
  'email',
  'file-path',
]);

export const RelationshipTypeSchema = z.enum([
  'uses',
  'exploits',
  'targets',
  'attributed-to',
  'communicates-with',
  'mitigated-by',
  'executes',
  'downloads',
  'delivers',
  'exfiltrates',
  // Derived (non-extracted) edges: co-mention / same-infrastructure links
  // synthesized deterministically to densify the graph; never fabricated text.
  'associated-with',
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

const ExtractionStatsSchema = z.object({
  totalChunks: z.number().int().nonnegative(),
  failedChunks: z.number().int().nonnegative(),
  phase: z.enum(['entities', 'relationships']).nullable(),
  reasons: z.array(z.string().max(300)).default([]),
});
export type ExtractionStats = z.infer<typeof ExtractionStatsSchema>;

// Schema kept module-private: extraction validates via the two pass-only schemas
// in llm-client.ts, so this aggregate is used purely for type inference.
const ExtractionResultSchema = z.object({
  entities: z.array(ExtractionEntitySchema).max(250),
  relationships: z.array(ExtractionRelationshipSchema).max(500),
  // Diagnostics for partial resilience: how many chunk calls were attempted in
  // each phase, how many failed, and why (surfaced so an "incomplete" graph is
  // explainable, not silent).
  stats: ExtractionStatsSchema.optional(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExtractedEntity = z.infer<typeof ExtractionEntitySchema>;
export type ExtractedRelationship = z.infer<typeof ExtractionRelationshipSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: EntityTypeSchema,
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
  // Extraction provenance carried through so the UI can show WHY a node
  // exists and what else it answers to (previously dropped at buildGraph).
  // Optional: reports persisted before this field existed must still load.
  evidence: z.string().max(1_500).optional(),
  aliases: z.array(z.string().min(1).max(300)).max(10).optional(),
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: RelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  // Textual basis for the relationship (extracted or the rule that derived it).
  evidence: z.string().max(1_500).optional(),
  // true when the edge was synthesized deterministically (co-mention,
  // shared infrastructure) rather than extracted by the model. Rendered
  // dashed and toggled separately from faithful extraction edges.
  derived: z.boolean().default(false),
});

export const GraphClusterSchema = z.object({
  id: z.string().min(1),
  // Name of the hub node (highest degree) that best represents the cluster.
  label: z.string().min(1),
  nodeIds: z.array(z.string().min(1)),
});

export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  // Connected components of the graph (union of extracted + derived edges);
  // singletons are omitted so only meaningful groupings are offered.
  clusters: z.array(GraphClusterSchema).default([]),
});

export type Graph = z.infer<typeof GraphSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphCluster = z.infer<typeof GraphClusterSchema>;

export const ReportStatusSchema = z.enum([
  'queued',
  'ingesting',
  'extracting',
  'modeling',
  'done',
  'failed',
  'cancelled',
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

// Human-in-the-loop feedback (architecture §2 Feedback context): an analyst
// accepts, rejects, or corrects an extracted entity / relationship / mapping.
// targetId refers to the graph node id (entity), edge id (relationship), or
// technique mapping key; correctedValue carries the field overrides for
// "correct" actions (e.g. { name: "..." } for an entity).
export const CorrectionTargetSchema = z.enum(['entity', 'relationship', 'mapping']);
export const CorrectionActionSchema = z.enum(['accept', 'reject', 'correct']);

// Value bounds keep each entry small; the 64KB request-body cap bounds the total.
const CorrectionValueSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(500), z.number().min(-1e9).max(1e9)]),
);

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

// MITRE ATT&CK mapping (architecture §2 ATT&CK Mapping context, 2-D). Maps the
// report to ATT&CK objects of four kinds: techniques (T####), groups (G####),
// software (S####), and campaigns (C####). source = how the match was produced:
// "explicit" = the ATT&CK id or name/alias appears literally in the report text
// (deterministic); a "suggested" tier via embedding similarity is added
// separately and bumps this enum.
export const AttckSourceSchema = z.enum(['explicit']);

export const AttckTypeSchema = z.enum(['technique', 'group', 'software', 'campaign']);
export type AttckType = z.infer<typeof AttckTypeSchema>;

// name/tactic are optional: they come from the bundled corpus, and a report can
// cite an ATT&CK id that the curated subset does not carry yet (the full matrix
// arrives with the embedding tier) — such mappings keep a confidence and the
// matchedText but no enriched label. tactic is only set for technique mappings.
export const AttckMappingSchema = z.object({
  attckId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z]\d{4}(\.\d{3})?$/),
  type: AttckTypeSchema,
  name: z.string().min(1).max(300).optional(),
  tactic: z.string().min(1).max(200).optional(),
  confidence: z.number().min(0).max(1),
  source: AttckSourceSchema,
  matchedText: z.string().min(1).max(500).optional(),
});

export type AttckMapping = z.infer<typeof AttckMappingSchema>;

// Timeline (architecture §2 Timeline context, 2-E): temporal expressions
// parsed deterministically from the report text, resolved to a concrete date
// where possible, ordered chronologically. `date` is the resolved date and
// matches `precision` (day → YYYY-MM-DD, month → YYYY-MM, year → YYYY);
// `matched` is the raw text span that produced the event; `label` is the
// surrounding sentence for analyst context. Relative expressions ("last week",
// "3 days later") resolve against an anchor date (earliest exact date in the
// text, falling back to the report's creation time).
export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  date: z
    .string()
    .min(4)
    .max(10)
    .regex(/^\d{4}(-\d{2})?(-\d{2})?$/),
  precision: z.enum(['day', 'month', 'year']),
  matched: z.string().min(1).max(100),
  label: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
});

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
