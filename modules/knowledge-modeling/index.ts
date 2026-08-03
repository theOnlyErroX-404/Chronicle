import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { ExtractedEntity, ExtractionResult, Graph, GraphNode } from "@/modules/shared/contracts";

export const normalizeName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/^the\s+/, "")
    .trim();

const nodeId = (type: string, name: string) => `${type}--${createHash("sha256").update(`${type}:${normalizeName(name)}`).digest("hex").slice(0, 12)}`;

type ResolvedEntity = ExtractedEntity & { id: string };

// Union-find so entities that claim the same alias (or share a normalized name)
// collapse into a single graph node per (type, alias-set) component.
class NameUnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let current = key;
    while (this.parent.get(current) !== current) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

const entityKey = (entity: Pick<ExtractedEntity, "type" | "name">) => `${entity.type}:${normalizeName(entity.name)}`;

const resolveEntities = (entities: ExtractedEntity[]) => {
  const unionFind = new NameUnionFind();
  const keys: string[] = [];
  for (const entity of entities) {
    const key = entityKey(entity);
    unionFind.add(key);
    keys.push(key);
    for (const alias of entity.aliases ?? []) {
      const aliasKey = `${entity.type}:${normalizeName(alias)}`;
      unionFind.add(aliasKey);
      unionFind.union(key, aliasKey);
    }
  }

  const groups = new Map<string, ExtractedEntity[]>();
  for (let index = 0; index < entities.length; index += 1) {
    const root = unionFind.find(keys[index]);
    const members = groups.get(root) ?? [];
    members.push(entities[index]);
    groups.set(root, members);
  }

  const resolved = new Map<string, ResolvedEntity>();
  const nameIndex = new Map<string, string>();
  for (const [root, members] of groups) {
    const canonical = members.reduce<ExtractedEntity>((best, member) => {
      if (member.confidence > best.confidence) return member;
      if (member.confidence === best.confidence && member.name.length > best.name.length) return member;
      return best;
    }, members[0]);
    const id = nodeId(canonical.type, canonical.name);
    resolved.set(root, { ...canonical, id });
    nameIndex.set(normalizeName(canonical.name), id);
    for (const alias of canonical.aliases ?? []) nameIndex.set(normalizeName(alias), id);
  }
  return { entities: [...resolved.values()], nameIndex };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CVE_RE = /^cve-\d{4}-\d{4,}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// Strong, deterministic type evidence: the name IS the pattern, not just a
// passing resemblance. Used both to retype misclassified entities and to infer
// the type of a synthesized endpoint. Returns null when the name is not a
// recognizable indicator shape (e.g. a descriptive phrase or an actor name).
const strongType = (value: string): ExtractedEntity["type"] | null => {
  const trimmed = value.trim();
  if (isIP(trimmed) || DOMAIN_RE.test(trimmed)) return "indicator";
  if (EMAIL_RE.test(trimmed)) return "email";
  if (CVE_RE.test(trimmed)) return "vulnerability";
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[a-z]:[\\/]/i.test(trimmed)) return "file-path";
  return null;
};

export const inferEndpointType = (value: string): ExtractedEntity["type"] => strongType(value) ?? "indicator";

// The local model occasionally mislabels an indicator shape (a file path or
// domain emitted as a "tool", a domain as "malware"). Retype every entity whose
// name is an unambiguous IP/domain/email/CVE/path regardless of what the model
// guessed, so graphs and scoring agree on indicator kinds.
const retypeStrongPatterns = (entities: ExtractedEntity[]): ExtractedEntity[] =>
  entities.map((entity) => {
    const type = strongType(entity.name);
    return type && type !== entity.type ? { ...entity, type } : entity;
  });

// The local model sometimes emits a relationship whose source/target has no
// matching entity record. Without a node, buildGraph silently drops the edge, so
// materialize a low-confidence entity for every dangling endpoint. Deterministic,
// evidence-backed (the endpoint is mentioned in the text the relationship cites).
export const completeEntityEndpoints = (extraction: ExtractionResult): ExtractionResult => {
  const entities = retypeStrongPatterns(extraction.entities);
  const present = new Set(entities.map((entity) => normalizeName(entity.name)));
  const additions: ExtractedEntity[] = [];
  for (const relationship of extraction.relationships) {
    for (const endpoint of [relationship.source, relationship.target]) {
      const name = normalizeName(endpoint);
      if (present.has(name)) continue;
      present.add(name);
      additions.push({ type: inferEndpointType(endpoint), name: endpoint.trim(), confidence: 0.5, evidence: relationship.evidence });
    }
  }
  return { entities: [...entities, ...additions], relationships: extraction.relationships };
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
