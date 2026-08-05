import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/reports/[id]/feedback/route';
import type { Graph } from '@/modules/shared/contracts';
import type { ReportRecord } from '@/modules/shared/report-store';

vi.mock('@/modules/shared/auth', () => ({ requireApiToken: vi.fn() }));

const mockReports = new Map<string, Partial<ReportRecord>>();
vi.mock('@/modules/shared/report-store', () => ({
  reportStore: {
    get: (id: string) => mockReports.get(id),
    create: vi.fn(),
    update: vi.fn(async (id: string, patch: Partial<ReportRecord>) => {
      const current = mockReports.get(id);
      const updated = { ...current, ...patch };
      mockReports.set(id, updated);
      return updated as ReportRecord;
    }),
  },
}));

const base = 'http://chronicle.local/api/v1/reports/r1/feedback';

const graph: Graph = {
  nodes: [{ id: 'n1', type: 'threat-actor', name: 'APT29', confidence: 0.9 }],
  edges: [{ id: 'e1', source: 'n1', target: 'n1', type: 'uses', confidence: 0.8 }],
};

const baseReport = (overrides: Partial<ReportRecord> = {}): ReportRecord => ({
  id: 'r1',
  sourceType: 'url',
  sourceUrl: 'https://example.com/report',
  status: 'done',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:01.000Z',
  graph,
  ...overrides,
});

const post = (body: unknown) =>
  new Request(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/v1/reports/[id]/feedback', () => {
  it('returns 404 for an unknown report', async () => {
    mockReports.clear();
    const response = await POST(post({ targetType: 'entity', targetId: 'n1', action: 'accept' }), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 409 when the report has no graph yet', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport({ graph: undefined }));
    const response = await POST(post({ targetType: 'entity', targetId: 'n1', action: 'accept' }), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects malformed JSON with 400', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport());
    const response = await POST(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      { params: Promise.resolve({ id: 'r1' }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ detail: 'The request body must be valid JSON.' });
  });

  it('rejects a body missing required fields with 400', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport());
    const response = await POST(post({ targetType: 'entity' }), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid action with 400', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport());
    const response = await POST(post({ targetType: 'entity', targetId: 'n1', action: 'approve' }), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a correction whose target does not exist in the graph with 422', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport());
    const response = await POST(
      post({ targetType: 'entity', targetId: 'ghost', action: 'reject' }),
      { params: Promise.resolve({ id: 'r1' }) },
    );
    expect(response.status).toBe(422);
  });

  it('accepts a valid correction and appends it', async () => {
    mockReports.clear();
    mockReports.set('r1', baseReport());
    const response = await POST(
      post({
        targetType: 'entity',
        targetId: 'n1',
        action: 'correct',
        correctedValue: { name: 'Midnight Blizzard' },
        note: 'canonical name',
      }),
      { params: Promise.resolve({ id: 'r1' }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(1);
    expect(body.feedback[0]).toMatchObject({
      targetType: 'entity',
      targetId: 'n1',
      action: 'correct',
      correctedValue: { name: 'Midnight Blizzard' },
      note: 'canonical name',
    });
    expect(body.feedback[0].id).toEqual(expect.any(String));
    expect(body.feedback[0].createdAt).toEqual(expect.any(String));
    const stored = mockReports.get('r1');
    expect(stored?.feedback).toHaveLength(1);
  });

  it('appends to existing feedback instead of replacing it', async () => {
    mockReports.clear();
    mockReports.set(
      'r1',
      baseReport({
        feedback: [
          {
            id: 'c1',
            targetType: 'entity',
            targetId: 'n1',
            action: 'accept',
            createdAt: '2026-08-05T00:00:00.000Z',
          },
        ],
      }),
    );
    const response = await POST(
      post({ targetType: 'relationship', targetId: 'e1', action: 'reject' }),
      { params: Promise.resolve({ id: 'r1' }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(2);
    expect(body.feedback[0].id).toBe('c1');
  });
});
