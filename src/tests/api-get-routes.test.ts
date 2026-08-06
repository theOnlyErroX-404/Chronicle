import { describe, expect, it, vi } from 'vitest';
import { GET as getReport } from '@/app/api/v1/reports/[id]/route';
import { GET as getGraph } from '@/app/api/v1/reports/[id]/graph/route';
import { GET as getStix } from '@/app/api/v1/reports/[id]/stix/route';
import { GET as getTimeline } from '@/app/api/v1/reports/[id]/timeline/route';
import { GET as getJob } from '@/app/api/v1/jobs/[id]/route';
import type { TimelineEvent } from '@/modules/shared/contracts';
import type { ReportRecord } from '@/modules/shared/report-store';

vi.mock('@/modules/shared/auth', () => ({ requireApiToken: vi.fn() }));

const mockReports = new Map<string, Partial<ReportRecord>>();
vi.mock('@/modules/shared/report-store', () => ({
  reportStore: { get: (id: string) => mockReports.get(id), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/modules/processing/queue', () => ({
  jobQueue: { enqueue: vi.fn(), pending: async () => 2, running: async () => true },
}));

const get = (id: string) => new Request(`http://chronicle.local/api/v1/reports/${id}`);

const baseReport = (id: string, overrides: Partial<ReportRecord> = {}): ReportRecord => ({
  id,
  sourceType: 'url',
  sourceUrl: 'https://example.com/report',
  status: 'done',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:01.000Z',
  ...overrides,
});

describe('GET routes', () => {
  it('reports/[id] returns 404 for an unknown report', async () => {
    const response = await getReport(get('missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(response.status).toBe(404);
  });

  it('reports/[id] returns the report metadata', async () => {
    mockReports.set('r1', baseReport('r1'));
    const response = await getReport(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'r1', source_type: 'url', status: 'done' });
  });

  it('graph returns 409 when the graph is not ready', async () => {
    mockReports.set('r1', baseReport('r1'));
    const response = await getGraph(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(409);
  });

  it('graph returns the graph once ready', async () => {
    mockReports.set('r1', baseReport('r1', { graph: { nodes: [], edges: [], clusters: [] } }));
    const response = await getGraph(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nodes: [], edges: [], clusters: [] });
  });

  it('stix returns 409 when the bundle is not ready', async () => {
    mockReports.set('r1', baseReport('r1'));
    const response = await getStix(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(409);
  });

  it('stix returns the bundle as an attachment', async () => {
    mockReports.set('r1', baseReport('r1', { stixBundle: { type: 'bundle' } }));
    const response = await getStix(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: 'bundle' });
    expect(response.headers.get('content-disposition')).toContain('chronicle-r1.stix.json');
  });

  it('timeline returns 409 when not ready', async () => {
    mockReports.set('r1', baseReport('r1'));
    const response = await getTimeline(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(409);
  });

  it('timeline returns the chronological events once ready', async () => {
    const timeline: TimelineEvent[] = [
      {
        id: 't1',
        date: '2024-03-05',
        precision: 'day',
        matched: 'March 5, 2024',
        label: 'Observed on March 5, 2024.',
        confidence: 1,
      },
    ];
    mockReports.set('r1', baseReport('r1', { timeline }));
    const response = await getTimeline(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(timeline);
  });

  it('jobs returns queue_position counting the running job', async () => {
    mockReports.set('q1', baseReport('q1', { status: 'queued' }));
    const response = await getJob(get('q1'), { params: Promise.resolve({ id: 'q1' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queue_position).toBe(3); // 2 queued + 1 running
    expect(body.status).toBe('queued');
  });

  it('jobs returns no queue_position for a finished job', async () => {
    mockReports.set('r1', baseReport('r1'));
    const response = await getJob(get('r1'), { params: Promise.resolve({ id: 'r1' }) });
    const body = await response.json();
    expect(body.queue_position).toBeUndefined();
  });

  it('jobs returns 404 for an unknown id', async () => {
    const response = await getJob(get('missing'), { params: Promise.resolve({ id: 'missing' }) });
    expect(response.status).toBe(404);
  });
});
