import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient, type Report as ReportRow } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createPostgresReportStore,
  type ReportDb,
} from '@/modules/persistence/postgres-report-store';
import type { AttckMapping, Correction, ExtractionResult, Graph } from '@/modules/shared/contracts';
import { config } from '@/lib/config';

// In-memory fake of the Prisma report delegate: same merge semantics (undefined
// keys skipped by Prisma, but the store pre-normalizes undefined -> null), so
// the store's mapping and not-found handling are tested without a live DB.
const rows = new Map<string, ReportRow>();

const db: ReportDb = {
  async create({ data }) {
    const d = data as {
      id: string;
      sourceType: string;
      sourceUrl: string | null;
      filename: string | null;
      status: string;
    };
    const now = new Date();
    const row: ReportRow = {
      id: d.id,
      sourceType: d.sourceType,
      sourceUrl: d.sourceUrl,
      filename: d.filename,
      status: d.status,
      createdAt: now,
      updatedAt: now,
      errorMessage: null,
      progress: null,
      partial: false,
      rawText: null,
      extraction: null,
      graph: null,
      stixBundle: null,
      feedback: null,
      attck: null,
    };
    rows.set(d.id, row);
    return row;
  },
  async findUnique({ where }) {
    return rows.get(where.id) ?? null;
  },
  async update({ where, data }) {
    const current = rows.get(where.id);
    if (!current) {
      throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: 'test',
      });
    }
    const patch = data as Record<string, unknown>;
    const merged = { ...current, ...patch, updatedAt: new Date() };
    rows.set(where.id, merged as ReportRow);
    return merged as ReportRow;
  },
  async count({ where }) {
    const statuses = (where as { status?: { in?: string[] } }).status?.in;
    if (statuses) return [...rows.values()].filter((row) => statuses.includes(row.status)).length;
    return rows.size;
  },
};

describe('PostgresReportStore (fake Prisma delegate)', () => {
  it('creates a queued report and persists it', async () => {
    const store = createPostgresReportStore(db);
    const report = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/1' });

    expect(report.status).toBe('queued');
    expect(report.sourceType).toBe('url');
    expect(report.sourceUrl).toBe('https://example.com/1');
    expect(report.id).toEqual(expect.any(String));
    expect(report.createdAt).toEqual(expect.any(String));
    expect(await store.get(report.id)).toMatchObject({ id: report.id, status: 'queued' });
  });

  it('returns undefined for an unknown id', async () => {
    const store = createPostgresReportStore(db);
    expect(await store.get('missing')).toBeUndefined();
  });

  it('merges patches and clears fields set to undefined', async () => {
    const store = createPostgresReportStore(db);
    const report = await store.create({ sourceType: 'pdf', filename: 'a.pdf' });

    await store.update(report.id, { status: 'ingesting', progress: 'ingesting' });
    expect((await store.get(report.id))?.status).toBe('ingesting');

    await store.update(report.id, { status: 'done', progress: undefined, partial: undefined });
    const done = await store.get(report.id);
    expect(done?.status).toBe('done');
    expect(done?.progress).toBeUndefined();
    expect(done?.partial).toBeUndefined();
  });

  it('round-trips extraction, graph, STIX bundle, and ATT&CK payloads', async () => {
    const store = createPostgresReportStore(db);
    const report = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/2' });

    const extraction: ExtractionResult = {
      entities: [{ type: 'malware', name: 'EvilRAT', confidence: 1, evidence: 'used' }],
      relationships: [],
    };
    const graph: Graph = {
      nodes: [{ id: 'a', name: 'EvilRAT', type: 'malware', confidence: 1 }],
      edges: [],
    };
    const stixBundle = { type: 'bundle', objects: [] };
    const attck: AttckMapping[] = [
      {
        attckId: 'T1059',
        type: 'technique',
        name: 'Command and Scripting Interpreter',
        confidence: 1,
        source: 'explicit',
        matchedText: 'T1059',
      },
      {
        attckId: 'G0016',
        type: 'group',
        name: 'APT29',
        confidence: 0.9,
        source: 'explicit',
        matchedText: 'APT29',
      },
    ];
    await store.update(report.id, { extraction, graph, stixBundle, attck });

    const stored = await store.get(report.id);
    expect(stored?.extraction).toEqual(extraction);
    expect(stored?.graph).toEqual(graph);
    expect(stored?.stixBundle).toEqual(stixBundle);
    expect(stored?.attck).toEqual(attck);
  });

  it('throws the same not-found message as the in-memory store on a missing update', async () => {
    const store = createPostgresReportStore(db);
    await expect(store.update('missing', { status: 'done' })).rejects.toThrow(
      'Report missing was not found.',
    );
  });

  it('round-trips feedback corrections', async () => {
    const store = createPostgresReportStore(db);
    const report = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/3' });
    const feedback: Correction[] = [
      {
        id: 'c1',
        targetType: 'entity',
        targetId: 'node-1',
        action: 'reject',
        createdAt: '2026-08-05T00:00:00.000Z',
      },
      {
        id: 'c2',
        targetType: 'relationship',
        targetId: 'edge-1',
        action: 'correct',
        correctedValue: { type: 'uses' },
        createdAt: '2026-08-05T00:00:01.000Z',
      },
    ];
    await store.update(report.id, { feedback });

    const stored = await store.get(report.id);
    expect(stored?.feedback).toEqual(feedback);
    expect(stored?.feedback).toHaveLength(2);
  });
});

// Live integration: runs only when a DATABASE_URL is present (CI provides a
// Postgres service container; vitest does not load .env, so this skips locally).
describe.skipIf(!process.env.DATABASE_URL)('PostgresReportStore (live)', () => {
  let client: PrismaClient;
  let store: ReturnType<typeof createPostgresReportStore>;
  const ids: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg(config.databaseUrl) });
    store = createPostgresReportStore(client.report as unknown as ReportDb);
  });

  afterAll(async () => {
    await client.report.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it('persists a report and round-trips graph, STIX, feedback, and ATT&CK', async () => {
    const created = await store.create({ sourceType: 'pdf', filename: 'live.pdf' });
    ids.push(created.id);
    expect(created.status).toBe('queued');

    const extraction: ExtractionResult = {
      entities: [{ type: 'malware', name: 'EvilRAT', confidence: 1, evidence: 'used' }],
      relationships: [],
    };
    const graph: Graph = {
      nodes: [{ id: 'a', name: 'EvilRAT', type: 'malware', confidence: 1 }],
      edges: [],
    };
    const stixBundle = { type: 'bundle', objects: [] };
    const feedback: Correction[] = [
      {
        id: 'c1',
        targetType: 'entity',
        targetId: 'a',
        action: 'accept',
        createdAt: '2026-08-05T00:00:00.000Z',
      },
    ];
    const attck: AttckMapping[] = [
      {
        attckId: 'T1059',
        type: 'technique',
        name: 'Command and Scripting Interpreter',
        confidence: 1,
        source: 'explicit',
        matchedText: 'T1059',
      },
    ];
    await store.update(created.id, {
      status: 'done',
      progress: 'done',
      extraction,
      graph,
      stixBundle,
      feedback,
      attck,
    });

    const stored = await store.get(created.id);
    expect(stored?.status).toBe('done');
    expect(stored?.extraction).toEqual(extraction);
    expect(stored?.graph).toEqual(graph);
    expect(stored?.stixBundle).toEqual(stixBundle);
    expect(stored?.feedback).toEqual(feedback);
    expect(stored?.attck).toEqual(attck);
  });

  it('maps a missing update to the not-found message', async () => {
    await expect(store.update('missing', { status: 'done' })).rejects.toThrow(
      'Report missing was not found.',
    );
  });
});
