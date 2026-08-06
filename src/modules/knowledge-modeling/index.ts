import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  ExtractedEntity,
  ExtractedRelationship,
  ExtractionResult,
  Graph,
  GraphCluster,
  GraphEdge,
  GraphNode,
} from '@/modules/shared/contracts';

export const normalizeName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/^the\s+/, '')
    .trim() ||
  // Non-Latin names (Cyrillic/CJK actor names are common in CTI) strip to the
  // empty string with the ASCII-only pass; without this fallback every such
  // entity hashed to the same empty key and silently merged into one node.
  value.trim().toLocaleLowerCase();

const nodeId = (type: string, name: string) =>
  `${type}--${createHash('sha256')
    .update(`${type}:${normalizeName(name)}`)
    .digest('hex')
    .slice(0, 12)}`;

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

const entityKey = (entity: Pick<ExtractedEntity, 'type' | 'name'>) =>
  `${entity.type}:${normalizeName(entity.name)}`;

// Cross-chunk merge: entities that share a normalized name or an alias collapse
// into one canonical entry (highest confidence, longest name wins). Duplicate
// entities emitted per chunk become a single record before the relationship
// pass, so a link between entities mentioned in different chunks is expressible.
export const mergeExtractedEntities = (entities: ExtractedEntity[]): ExtractedEntity[] => {
  if (entities.length === 0) return [];
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

  const merged: ExtractedEntity[] = [];
  for (const members of groups.values()) {
    const canonical = members.reduce<ExtractedEntity>((best, member) => {
      if (member.confidence > best.confidence) return member;
      if (member.confidence === best.confidence && member.name.length > best.name.length)
        return member;
      return best;
    }, members[0]);
    const aliasNames = new Set<string>();
    for (const member of members) {
      for (const alias of member.aliases ?? []) {
        if (normalizeName(alias) !== normalizeName(canonical.name)) aliasNames.add(alias);
      }
      if (member !== canonical && normalizeName(member.name) !== normalizeName(canonical.name))
        aliasNames.add(member.name);
    }
    merged.push({
      ...canonical,
      aliases: aliasNames.size > 0 ? [...aliasNames] : canonical.aliases,
    });
  }
  return merged;
};

const resolveEntities = (entities: ExtractedEntity[]) => {
  const merged = mergeExtractedEntities(entities);
  const resolved = new Map<string, ResolvedEntity>();
  const nameIndex = new Map<string, string>();
  for (const entity of merged) {
    const id = nodeId(entity.type, entity.name);
    resolved.set(entityKey(entity), { ...entity, id });
    nameIndex.set(normalizeName(entity.name), id);
    for (const alias of entity.aliases ?? []) nameIndex.set(normalizeName(alias), id);
  }
  return { entities: [...resolved.values()], nameIndex };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CVE_RE = /^cve-\d{4}-\d{4,}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const COMPOUND_TLDS = new Set([
  'co.uk',
  'org.uk',
  'net.uk',
  'com.au',
  'net.au',
  'co.jp',
  'co.in',
  'com.cn',
  'org.cn',
  'com.br',
]);

// Longest set of trailing labels that is still a shared registrable domain
// (example.com -> example.com; example.co.uk -> example.co.uk).
const registrableDomain = (hostname: string): string | null => {
  const host = hostname
    .toLocaleLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0];
  if (!DOMAIN_RE.test(host)) return null;
  const labels = host.split('.');
  const width = labels.length > 2 && COMPOUND_TLDS.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length < width) return null;
  return labels.slice(-width).join('.');
};

const mentions = (evidence: string, name: string): boolean => {
  const needle = normalizeName(name);
  if (needle.length < 3) return false;
  const haystack = evidence.toLocaleLowerCase();
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    const before = index === 0 ? ' ' : haystack[index - 1];
    const after = haystack[index + needle.length] ?? ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    index += needle.length;
  }
  return false;
};

// Deterministic id for derived edges: same pair + rule always yields the same
// edge, so tests and repeated rebuilds are stable (unlike extracted edges,
// which use randomUUID).
const derivedEdgeId = (source: string, target: string, seed: string) =>
  `derived--${createHash('sha256')
    .update([source, target, seed].join('|'))
    .digest('hex')
    .slice(0, 12)}`;

const addDerived = (
  edges: GraphEdge[],
  seen: Set<string>,
  nameIndex: Map<string, string>,
  sourceName: string,
  targetName: string,
  evidence: string,
) => {
  const source = nameIndex.get(normalizeName(sourceName));
  const target = nameIndex.get(normalizeName(targetName));
  if (!source || !target || source === target) return;
  const key = source < target ? `${source}|${target}` : `${target}|${source}`;
  if (seen.has(key)) return;
  seen.add(key);
  const [from, to] = key.split('|') as [string, string];
  edges.push({
    id: derivedEdgeId(from, to, 'associated-with'),
    source: from,
    target: to,
    type: 'associated-with',
    confidence: 0.3,
    evidence,
    derived: true,
  });
};

const unorderedPairKey = (source: string, target: string) =>
  source < target ? `${source}|${target}` : `${target}|${source}`;

// Deterministic, evidence-anchored density: report graphs are sparser than a
// codebase graph (the reference the UI is modeled on), so the model enriches
// them with two conservative rules. Both are flagged `derived` — the UI
// renders them dashed and offers a toggle, so they are never mistaken for
// faithful extraction.
export const deriveImpliedEdges = (
  extraction: ExtractionResult,
  nameIndex: Map<string, string>,
  nodes: ResolvedEntity[],
): GraphEdge[] => {
  const derived: GraphEdge[] = [];
  // Seed with every extraction edge's pair so we never derive a duplicate of a
  // faithful link (e.g. evidence that names the endpoints themselves).
  const seen = new Set<string>();
  for (const relationship of extraction.relationships) {
    const source = nameIndex.get(normalizeName(relationship.source));
    const target = nameIndex.get(normalizeName(relationship.target));
    if (source && target && source !== target) seen.add(unorderedPairKey(source, target));
  }
  // Rule 1: co-mention. Entities named in the same relationship evidence are
  // topically linked to that relationship's endpoints (associated-with).
  for (const relationship of extraction.relationships) {
    if (!relationship.evidence) continue;
    let mentionsCount = 0;
    for (const [name] of nameIndex) {
      if (mentionsCount >= 6) break; // ponytail: cap bounds worst-case dense reports
      if (!mentions(relationship.evidence, name)) continue;
      mentionsCount += 1;
      addDerived(derived, seen, nameIndex, relationship.source, name, relationship.evidence);
      addDerived(derived, seen, nameIndex, relationship.target, name, relationship.evidence);
    }
  }
  // Rule 2: shared infrastructure. Indicator hostnames under the same
  // registrable domain are associated (a.example.com ~ b.example.com).
  const byDomain = new Map<string, string[]>();
  for (const node of nodes) {
    const domain = registrableDomain(node.name);
    if (!domain) continue;
    const members = byDomain.get(domain) ?? [];
    members.push(node.name);
    byDomain.set(domain, members);
  }
  for (const [domain, members] of byDomain) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        addDerived(
          derived,
          seen,
          nameIndex,
          members[i],
          members[j],
          `Shares infrastructure: ${domain}`,
        );
      }
    }
  }
  return derived;
};

// Connected components of the graph (union of extracted + derived edges).
// Singletons are omitted: only meaningful groupings get a cluster. The label
// is the hub node (highest degree), mirroring Graphify's community naming.
const computeClusters = (nodes: GraphNode[], edges: GraphEdge[]): GraphCluster[] => {
  const adjacency = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const edge of edges) {
    sources.set(edge.source, (sources.get(edge.source) ?? 0) + 1);
    for (const nodeId of [edge.source, edge.target]) {
      const neighbors = adjacency.get(nodeId) ?? new Set();
      const other = nodeId === edge.source ? edge.target : edge.source;
      neighbors.add(other);
      adjacency.set(nodeId, neighbors);
      degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
    }
  }
  const visited = new Set<string>();
  const clusters: GraphCluster[] = [];
  for (const node of nodes) {
    if (visited.has(node.id) || !adjacency.has(node.id)) continue;
    const members: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      members.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    members.sort();
    // Hub = highest degree, ties broken by how often the node anchors an edge
    // as its source (actors lead relationships: "APT41 uses EvilBoat").
    let hub = members[0];
    for (const member of members) {
      const isBetter =
        (degree.get(member) ?? 0) > (degree.get(hub) ?? 0) ||
        ((degree.get(member) ?? 0) === (degree.get(hub) ?? 0) &&
          (sources.get(member) ?? 0) > (sources.get(hub) ?? 0));
      if (isBetter) hub = member;
    }
    const hubNode = nodes.find((candidate) => candidate.id === hub);
    clusters.push({
      id: `cluster--${createHash('sha256').update(members.join('|')).digest('hex').slice(0, 12)}`,
      label: hubNode?.name ?? hub,
      nodeIds: members,
    });
  }
  clusters.sort((a, b) => a.label.localeCompare(b.label));
  return clusters;
};

// Strong, deterministic type evidence: the name IS the pattern, not just a
// passing resemblance. Used both to retype misclassified entities and to infer
// the type of a synthesized endpoint. Returns null when the name is not a
// recognizable indicator shape (e.g. a descriptive phrase or an actor name).
const strongType = (value: string): ExtractedEntity['type'] | null => {
  const trimmed = value.trim();
  if (isIP(trimmed) || DOMAIN_RE.test(trimmed)) return 'indicator';
  if (EMAIL_RE.test(trimmed)) return 'email';
  if (CVE_RE.test(trimmed)) return 'vulnerability';
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-z]:[\\/]/i.test(trimmed))
    return 'file-path';
  return null;
};

export const inferEndpointType = (value: string): ExtractedEntity['type'] =>
  strongType(value) ?? 'indicator';

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
  // Seed with canonical names AND aliases: a relationship endpoint may cite an
  // alias, and without this the endpoint would be synthesized as a separate
  // duplicate entity even though the aliased entity already exists.
  const present = new Set<string>();
  for (const entity of entities) {
    present.add(normalizeName(entity.name));
    for (const alias of entity.aliases ?? []) present.add(normalizeName(alias));
  }
  const additions: ExtractedEntity[] = [];
  for (const relationship of extraction.relationships) {
    for (const endpoint of [relationship.source, relationship.target]) {
      const name = normalizeName(endpoint);
      if (present.has(name)) continue;
      present.add(name);
      additions.push({
        type: inferEndpointType(endpoint),
        name: endpoint.trim(),
        confidence: 0.5,
        evidence: relationship.evidence,
      });
    }
  }
  return { entities: [...entities, ...additions], relationships: extraction.relationships };
};

// The relationship pass runs once per chunk, so the same edge is often emitted
// several times (same endpoints, same type). Collapse duplicates, keeping the
// most confident occurrence.
export const mergeRelationships = (
  relationships: ExtractedRelationship[],
): ExtractedRelationship[] => {
  const best = new Map<string, ExtractedRelationship>();
  for (const relationship of relationships) {
    const key = `${normalizeName(relationship.source)}|${relationship.type}|${normalizeName(relationship.target)}`;
    const existing = best.get(key);
    if (!existing || relationship.confidence > existing.confidence) best.set(key, relationship);
  }
  return [...best.values()];
};

// Relationship endpoints often reference an entity by a name or alias variant
// that differs from the canonical name chosen during merging. Rewrite each
// endpoint to the canonical name so stored relationships point at the exact
// entity records that exist.
export const canonicalizeEndpoints = (
  relationships: ExtractedRelationship[],
  entities: ExtractedEntity[],
): ExtractedRelationship[] => {
  const canonicalByName = new Map<string, string>();
  for (const entity of entities) {
    canonicalByName.set(normalizeName(entity.name), entity.name);
    for (const alias of entity.aliases ?? [])
      canonicalByName.set(normalizeName(alias), entity.name);
  }
  return relationships.map((relationship) => ({
    ...relationship,
    source: canonicalByName.get(normalizeName(relationship.source)) ?? relationship.source,
    target: canonicalByName.get(normalizeName(relationship.target)) ?? relationship.target,
  }));
};

export const buildGraph = (extraction: ExtractionResult): Graph => {
  const { entities, nameIndex } = resolveEntities(extraction.entities);
  const nodes: GraphNode[] = entities.map(({ id, type, name, confidence, evidence, aliases }) => ({
    id,
    type,
    name,
    confidence,
    evidence,
    aliases,
  }));
  const edges: GraphEdge[] = extraction.relationships.flatMap((relationship) => {
    const source = nameIndex.get(normalizeName(relationship.source));
    const target = nameIndex.get(normalizeName(relationship.target));
    if (!source || !target || source === target) return [];
    return [
      {
        id: randomUUID(),
        source,
        target,
        type: relationship.type,
        confidence: relationship.confidence,
        evidence: relationship.evidence,
        derived: false,
      },
    ];
  });
  // The derived pass needs the merged, id-resolved entity set.
  const derived = deriveImpliedEdges(extraction, nameIndex, entities);
  edges.push(...derived);
  const clusters = computeClusters(nodes, edges);
  return { nodes, edges, clusters };
};

const stixTypeFor = (entity: GraphNode) => {
  if (entity.type === 'threat-actor') return 'threat-actor';
  if (entity.type === 'malware') return 'malware';
  if (entity.type === 'tool' || entity.type === 'web-shell') return 'tool';
  if (entity.type === 'vulnerability') return 'vulnerability';
  if (entity.type === 'indicator') return 'indicator';
  if (entity.type === 'campaign') return 'campaign';
  return 'identity';
};

// Deterministic UUID (v5-style) from an arbitrary seed: STIX ids must be UUIDs,
// so the `type--sha256-12hex` node ids cannot pass through as-is (AUDIT-06).
// sha1 of the seed gives stable ids across rebuilds of the same report.
const stixUuidFor = (seed: string): string => {
  const hash = createHash('sha1').update(seed).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const bytes = [...hash.subarray(0, 16)];
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// STIX 2.1 standard relationship_type vocabulary; everything else gets the
// x_chronicle_ prefix so strict consumers do not reject custom values (AUDIT-06).
const STIX_RELATIONSHIP_TYPES = new Set([
  'attributed-to',
  'compromises',
  'derived-from',
  'duplicates',
  'follows',
  'indicates',
  'mitigates',
  'targets',
  'uses',
  'variant-of',
]);

export const buildStixLiteBundle = (reportId: string, graph: Graph) => {
  const now = new Date().toISOString();
  const stixIdByNode = new Map<string, string>();
  for (const node of graph.nodes) {
    const stixType = stixTypeFor(node);
    stixIdByNode.set(node.id, `${stixType}--${stixUuidFor(node.id)}`);
  }
  const objects = [
    ...graph.nodes.map((node) => {
      const stixType = stixTypeFor(node);
      const object: Record<string, unknown> = {
        type: stixType,
        spec_version: '2.1',
        id: stixIdByNode.get(node.id),
        created: now,
        modified: now,
        name: node.name,
        confidence: Math.round(node.confidence * 100),
        labels: [node.type],
        x_chronicle_report_id: reportId,
      };
      // STIX 2.1 requires pattern + valid_from on indicator SDOs; the indicator
      // node's name is the IOC value, surfaced as a generic value pattern.
      if (stixType === 'indicator') {
        object.pattern = `[indicator:name = '${node.name.replace(/[\\']/g, '\\$&')}']`;
        object.valid_from = now;
      }
      return object;
    }),
    ...graph.edges
      // Derived edges are deterministic connective tissue for the UI, not
      // extraction; a STIX bundle must stay faithful to the report.
      .filter((edge) => !edge.derived)
      .map((edge) => {
        const relationshipType = STIX_RELATIONSHIP_TYPES.has(edge.type)
          ? edge.type
          : `x_chronicle_${edge.type}`;
        return {
          type: 'relationship',
          spec_version: '2.1',
          id: `relationship--${edge.id}`,
          created: now,
          modified: now,
          relationship_type: relationshipType,
          source_ref: stixIdByNode.get(edge.source),
          target_ref: stixIdByNode.get(edge.target),
          confidence: Math.round(edge.confidence * 100),
          x_chronicle_report_id: reportId,
        };
      }),
  ];
  return { type: 'bundle', id: `bundle--${randomUUID()}`, spec_version: '2.1', objects };
};
