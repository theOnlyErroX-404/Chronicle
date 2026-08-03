import { createHash, randomUUID } from "node:crypto";
import type { ExtractedEntity, ExtractionResult, Graph, GraphNode } from "@/modules/shared/contracts";

const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gi, " ").trim();

const nodeId = (type: string, name: string) => `${type}--${createHash("sha256").update(`${type}:${normalizeName(name)}`).digest("hex").slice(0, 12)}`;

type ResolvedEntity = ExtractedEntity & { id: string };

const resolveEntities = (entities: ExtractedEntity[]) => {
  const resolved = new Map<string, ResolvedEntity>();
  const nameIndex = new Map<string, string>();
  for (const entity of entities) {
    const name = normalizeName(entity.name);
    const key = `${entity.type}:${name}`;
    const existing = resolved.get(key);
    if (!existing || entity.confidence > existing.confidence) {
      const candidate = { ...entity, id: nodeId(entity.type, entity.name) };
      resolved.set(key, candidate);
      nameIndex.set(name, candidate.id);
    }
  }
  return { entities: [...resolved.values()], nameIndex };
};

export const buildGraph = (extraction: ExtractionResult): Graph => {
  const { entities, nameIndex } = resolveEntities(extraction.entities);
  const nodes: GraphNode[] = entities.map(({ id, type, name, confidence }) => ({ id, type, name, confidence }));
  const edges = extraction.relationships.flatMap((relationship) => {
    const source = nameIndex.get(normalizeName(relationship.source));
    const target = nameIndex.get(normalizeName(relationship.target));
    if (!source || !target || source === target) return [];
    return [{ id: randomUUID(), source, target, type: relationship.type, confidence: relationship.confidence }];
  });
  return { nodes, edges };
};

const stixTypeFor = (entity: GraphNode) => {
  if (entity.type === "threat-actor") return "threat-actor";
  if (entity.type === "malware") return "malware";
  if (entity.type === "tool") return "tool";
  if (entity.type === "vulnerability") return "vulnerability";
  if (entity.type === "indicator") return "indicator";
  return "identity";
};

export const buildStixLiteBundle = (reportId: string, graph: Graph) => {
  const now = new Date().toISOString();
  const objects = [
    ...graph.nodes.map((node) => ({
      type: stixTypeFor(node),
      spec_version: "2.1",
      id: `${stixTypeFor(node)}--${node.id.split("--")[1]}`,
      created: now,
      modified: now,
      name: node.name,
      confidence: Math.round(node.confidence * 100),
      labels: [node.type],
      x_chronicle_report_id: reportId,
    })),
    ...graph.edges.map((edge) => ({
      type: "relationship",
      spec_version: "2.1",
      id: `relationship--${edge.id}`,
      created: now,
      modified: now,
      relationship_type: edge.type,
      source_ref: graph.nodes.find((node) => node.id === edge.source) && `${stixTypeFor(graph.nodes.find((node) => node.id === edge.source)!)}--${edge.source.split("--")[1]}`,
      target_ref: graph.nodes.find((node) => node.id === edge.target) && `${stixTypeFor(graph.nodes.find((node) => node.id === edge.target)!)}--${edge.target.split("--")[1]}`,
      confidence: Math.round(edge.confidence * 100),
      x_chronicle_report_id: reportId,
    })),
  ];
  return { type: "bundle", id: `bundle--${randomUUID()}`, spec_version: "2.1", objects };
};
