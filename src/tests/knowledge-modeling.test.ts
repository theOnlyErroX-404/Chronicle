import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  buildStixLiteBundle,
  completeEntityEndpoints,
  inferEndpointType,
} from '@/modules/knowledge-modeling';

describe('knowledge modeling', () => {
  it('deduplicates entities and retains relationships whose endpoints resolve', () => {
    const graph = buildGraph({
      entities: [
        { type: 'threat-actor', name: 'APT 29', confidence: 0.9, evidence: 'APT 29' },
        { type: 'threat-actor', name: 'APT-29', confidence: 0.8, evidence: 'APT-29' },
        { type: 'malware', name: 'ExampleRAT', confidence: 0.95, evidence: 'ExampleRAT' },
      ],
      relationships: [
        {
          source: 'APT-29',
          target: 'ExampleRAT',
          type: 'uses',
          confidence: 0.85,
          evidence: 'uses ExampleRAT',
        },
      ],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("treats a leading 'The ' as the same entity name", () => {
    const graph = buildGraph({
      entities: [
        { type: 'threat-actor', name: 'The Lazarus Group', confidence: 0.95, evidence: 'a' },
        { type: 'threat-actor', name: 'Lazarus Group', confidence: 0.6, evidence: 'b' },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe('The Lazarus Group');
  });
});

describe('completeEntityEndpoints', () => {
  it('creates an entity for a relationship endpoint missing from the entity list', () => {
    const completed = completeEntityEndpoints({
      entities: [
        { type: 'threat-actor', name: 'Midnight Blizzard', confidence: 1, evidence: 'actor' },
      ],
      relationships: [
        {
          source: 'Midnight Blizzard',
          target: 'cozybear.example.com',
          type: 'communicates-with',
          confidence: 1,
          evidence: 'communicating with the domain',
        },
      ],
    });
    const domain = completed.entities.find((entity) => entity.name === 'cozybear.example.com');
    expect(domain).toBeDefined();
    expect(domain?.type).toBe('indicator');
    expect(domain?.confidence).toBe(0.5);
  });

  it('retypes an entity that the model misclassified as an indicator shape', () => {
    const completed = completeEntityEndpoints({
      entities: [
        {
          type: 'tool',
          name: '/opt/blockchain/app',
          confidence: 1,
          evidence: 'used the file path',
        },
        { type: 'malware', name: '198.51.100.7', confidence: 1, evidence: 'server' },
      ],
      relationships: [],
    });
    expect(completed.entities.find((entity) => entity.name === '/opt/blockchain/app')?.type).toBe(
      'file-path',
    );
    expect(completed.entities.find((entity) => entity.name === '198.51.100.7')?.type).toBe(
      'indicator',
    );
  });

  it('leaves names that are not indicator shapes untouched', () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: 'tool', name: 'Cobalt Strike', confidence: 1, evidence: 'tool' }],
      relationships: [],
    });
    expect(completed.entities[0].type).toBe('tool');
  });

  it('does not duplicate an endpoint referenced by multiple relationships', () => {
    const completed = completeEntityEndpoints({
      entities: [],
      relationships: [
        {
          source: 'X',
          target: '198.51.100.7',
          type: 'communicates-with',
          confidence: 1,
          evidence: 'a',
        },
        {
          source: 'Y',
          target: '198.51.100.7',
          type: 'communicates-with',
          confidence: 1,
          evidence: 'b',
        },
      ],
    });
    const ips = completed.entities.filter((entity) => entity.name === '198.51.100.7');
    expect(ips).toHaveLength(1);
    expect(completed.entities).toHaveLength(3);
  });

  it('leaves entities that already exist untouched', () => {
    const completed = completeEntityEndpoints({
      entities: [
        { type: 'indicator', name: 'evil.example.com', confidence: 0.9, evidence: 'domain' },
      ],
      relationships: [
        {
          source: 'evil.example.com',
          target: 'CVE-2023-23397',
          type: 'exploits',
          confidence: 1,
          evidence: 'e',
        },
      ],
    });
    const existing = completed.entities.find((entity) => entity.name === 'evil.example.com');
    expect(existing?.confidence).toBe(0.9);
    expect(completed.entities).toHaveLength(2);
  });

  it('does not synthesize a duplicate entity when a relationship cites an alias', () => {
    const completed = completeEntityEndpoints({
      entities: [
        {
          type: 'threat-actor',
          name: 'Midnight Blizzard',
          aliases: ['Cozy Bear'],
          confidence: 1,
          evidence: 'actor',
        },
      ],
      relationships: [
        {
          source: 'Cozy Bear',
          target: 'evil.example.net',
          type: 'communicates-with',
          confidence: 1,
          evidence: 'phoned the domain',
        },
      ],
    });
    const graph = buildGraph(completed);
    expect(graph.nodes).toHaveLength(2);
    const actor = graph.nodes.find((node) => node.type === 'threat-actor');
    expect(actor?.name).toBe('Midnight Blizzard');
    expect(graph.edges[0].source).toBe(actor?.id);
  });

  it('makes dangling relationships survive graph construction', () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: 'threat-actor', name: 'Lazarus Group', confidence: 1, evidence: 'actor' }],
      relationships: [
        {
          source: 'Lazarus Group',
          target: '/opt/blockchain/app',
          type: 'uses',
          confidence: 1,
          evidence: 'used the file path',
        },
      ],
    });
    const graph = buildGraph(completed);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});

describe('inferEndpointType', () => {
  it('classifies IPs, domains, emails, CVEs, and file paths deterministically', () => {
    expect(inferEndpointType('198.51.100.7')).toBe('indicator');
    expect(inferEndpointType('cozybear.example.com')).toBe('indicator');
    expect(inferEndpointType('analyst@example.com')).toBe('email');
    expect(inferEndpointType('CVE-2023-23397')).toBe('vulnerability');
    expect(inferEndpointType('/opt/blockchain/app')).toBe('file-path');
    expect(inferEndpointType('C:\\temp\\malware.exe')).toBe('file-path');
    expect(inferEndpointType('some unknown name')).toBe('indicator');
  });
});

describe('alias-aware entity resolution', () => {
  it('merges entities whose aliases overlap into one node', () => {
    const graph = buildGraph({
      entities: [
        {
          type: 'threat-actor',
          name: 'Midnight Blizzard',
          aliases: ['Cozy Bear', 'APT29'],
          confidence: 1,
          evidence: 'a',
        },
        { type: 'threat-actor', name: 'APT29', confidence: 0.7, evidence: 'b' },
        { type: 'malware', name: 'SLUI', confidence: 0.9, evidence: 'c' },
      ],
      relationships: [
        { source: 'APT29', target: 'SLUI', type: 'uses', confidence: 1, evidence: 'uses SLUI' },
      ],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    const merged = graph.nodes.find((node) => node.type === 'threat-actor');
    expect(merged?.name).toBe('Midnight Blizzard');
  });

  it('does not merge entities of different types even when names overlap', () => {
    const graph = buildGraph({
      entities: [
        { type: 'threat-actor', name: 'SLUI', confidence: 0.9, evidence: 'a' },
        { type: 'malware', name: 'SLUI', confidence: 0.9, evidence: 'b' },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(2);
  });

  it('keeps the highest-confidence entity as canonical within a merged group', () => {
    const graph = buildGraph({
      entities: [
        {
          type: 'threat-actor',
          name: 'Lazarus Group',
          aliases: ['AppleJeus Group'],
          confidence: 0.6,
          evidence: 'a',
        },
        { type: 'threat-actor', name: 'Lazarus Group', confidence: 0.95, evidence: 'b' },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].confidence).toBe(0.95);
  });

  it('keeps distinct non-Latin names as separate nodes (AUDIT-08)', () => {
    const graph = buildGraph({
      entities: [
        { type: 'threat-actor', name: 'Русская Группа', confidence: 0.9, evidence: 'a' },
        { type: 'threat-actor', name: 'Китайские Хакеры', confidence: 0.9, evidence: 'b' },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(2);
  });
});

describe('STIX bundle shape', () => {
  type StixObject = Record<string, unknown> & { type: string; id: string };
  const graph = buildGraph({
    entities: [
      { type: 'threat-actor', name: 'APT41', confidence: 0.9, evidence: 'APT41' },
      { type: 'malware', name: 'EvilBoat', confidence: 0.95, evidence: 'EvilBoat' },
      { type: 'web-shell', name: 'China Chopper', confidence: 0.8, evidence: 'China Chopper' },
      {
        type: 'vulnerability',
        name: 'CVE-2021-44228',
        confidence: 0.7,
        evidence: 'CVE-2021-44228',
      },
      {
        type: 'campaign',
        name: 'Operation Restless',
        confidence: 0.6,
        evidence: 'Operation Restless',
      },
    ],
    relationships: [
      {
        source: 'APT41',
        target: 'EvilBoat',
        type: 'uses',
        confidence: 0.85,
        evidence: 'uses EvilBoat',
      },
      {
        source: 'APT41',
        target: 'Operation Restless',
        type: 'attributed-to',
        confidence: 0.6,
        evidence: 'attributed to',
      },
    ],
  });
  const bundle = buildStixLiteBundle('report-1', graph);
  const objects = bundle.objects as unknown as StixObject[];
  const nodes = objects.filter((object) => object.type !== 'relationship');
  const relationships = objects.filter((object) => object.type === 'relationship');

  it('wraps the graph in a valid STIX 2.1 bundle envelope', () => {
    expect(bundle.type).toBe('bundle');
    expect(bundle.spec_version).toBe('2.1');
    expect(bundle.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
    expect(objects.length).toBe(graph.nodes.length + graph.edges.length);
  });

  it('emits well-formed SDO objects with consistent ids and metadata', () => {
    for (const object of nodes) {
      expect(object.id).toMatch(new RegExp(`^${object.type}--`));
      expect(object.spec_version).toBe('2.1');
      expect(new Date(object.created as string).toISOString()).toBe(object.created);
      expect(new Date(object.modified as string).toISOString()).toBe(object.modified);
      expect(typeof object.name).toBe('string');
      expect(object.confidence as number).toBeGreaterThanOrEqual(0);
      expect(object.confidence as number).toBeLessThanOrEqual(100);
      expect(object.labels).toEqual([expect.any(String)]);
      expect(object.x_chronicle_report_id).toBe('report-1');
    }
  });

  it('maps internal entity types to STIX types (web-shell -> tool, campaign -> campaign)', () => {
    const byName = new Map(nodes.map((object) => [object.name, object.type]));
    expect(byName.get('APT41')).toBe('threat-actor');
    expect(byName.get('EvilBoat')).toBe('malware');
    expect(byName.get('China Chopper')).toBe('tool');
    expect(byName.get('CVE-2021-44228')).toBe('vulnerability');
    expect(byName.get('Operation Restless')).toBe('campaign');
  });

  it('emits relationships whose source_ref and target_ref resolve to bundle object ids', () => {
    const objectIds = new Set(objects.map((object) => object.id));
    expect(relationships).toHaveLength(graph.edges.length);
    for (const relationship of relationships) {
      expect(relationship.relationship_type).toMatch(/^uses$|^attributed-to$/);
      expect(objectIds.has(relationship.source_ref as string)).toBe(true);
      expect(objectIds.has(relationship.target_ref as string)).toBe(true);
      expect(relationship.source_ref).not.toBe(relationship.target_ref);
    }
  });

  it('derives deterministic UUID STIX ids from the graph node ids', () => {
    const node = nodes.find((object) => object.name === 'EvilBoat');
    expect(node?.id).toMatch(
      /^malware--[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const rebuilt = buildStixLiteBundle('report-1', graph);
    const rebuiltObjects = rebuilt.objects as unknown as StixObject[];
    const rebuiltNode = rebuiltObjects.find((object) => object.name === 'EvilBoat');
    expect(rebuiltNode?.id).toBe(node?.id);
  });

  it('maps sector and country entities to the STIX identity SDO', () => {
    const graph = buildGraph({
      entities: [
        { type: 'sector', name: 'banking', confidence: 0.8, evidence: 'banking' },
        { type: 'country', name: 'Ukraine', confidence: 0.9, evidence: 'Ukraine' },
      ],
      relationships: [],
    });
    const bundle = buildStixLiteBundle('report-2', graph);
    const objects = bundle.objects as unknown as Array<
      Record<string, unknown> & { type: string; name: string }
    >;
    const byName = new Map(objects.map((object) => [object.name, object.type]));
    expect(byName.get('banking')).toBe('identity');
    expect(byName.get('Ukraine')).toBe('identity');
  });

  it('gives indicator SDOs the required pattern and valid_from', () => {
    const graph = buildGraph({
      entities: [
        {
          type: 'indicator',
          name: '203.0.113.7',
          confidence: 0.9,
          evidence: 'C2 server',
        },
      ],
      relationships: [],
    });
    const bundle = buildStixLiteBundle('report-ind', graph);
    const objects = bundle.objects as unknown as StixObject[];
    const indicator = objects[0];
    expect(indicator.type).toBe('indicator');
    expect(typeof indicator.pattern).toBe('string');
    expect(indicator.pattern).toContain('203.0.113.7');
    expect(indicator.valid_from).toBe(indicator.created);
    expect(new Date(indicator.valid_from as string).toISOString()).toBe(
      indicator.valid_from as string,
    );
  });

  it('prefixes non-standard relationship types with x_chronicle_', () => {
    const graph = buildGraph({
      entities: [
        { type: 'malware', name: 'Loader', confidence: 0.9, evidence: 'a' },
        { type: 'malware', name: 'RAT', confidence: 0.9, evidence: 'b' },
      ],
      relationships: [
        { source: 'Loader', target: 'RAT', type: 'executes', confidence: 0.8, evidence: 'x' },
      ],
    });
    const bundle = buildStixLiteBundle('report-x', graph);
    const relationship = (bundle.objects as unknown as StixObject[]).find(
      (object) => object.type === 'relationship',
    );
    expect(relationship?.relationship_type).toBe('x_chronicle_executes');
  });
});
