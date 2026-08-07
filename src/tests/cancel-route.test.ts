import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/jobs/[id]/cancel/route';
import type { ReportRecord } from '@/modules/shared/report-store';

vi.mock('@/modules/shared/auth', () => ({ requireApiToken: vi.fn() }));

const mockQueue = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('@/modules/processing', () => ({ jobQueue: mockQueue }));

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

const base = (overrides: Partial<ReportRecord> = {}): ReportRecord => ({
  id: 'r1',
  sourceType: 'url',
  sourceUrl: 'https://example.com/report',
  status: 'extracting',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:01.000Z',
  ...overrides,
});

const post = (id: string) =>
  POST(new Request(`http://chronicle.local/api/v1/jobs/${id}/cancel`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });

describe('POST /api/v1/jobs/[id]/cancel', () => {
  beforeEach(() => {
    mockQueue.remove.mockClear();
  });

  it('returns 404 for an unknown job', async () => {
    mockReports.clear();
    const response = await post('missing');
    expect(response.status).toBe(404);
  });

  it('returns 409 for a job that already finished', async () => {
    mockReports.clear();
    mockReports.set('r1', base({ status: 'done' }));
    const response = await post('r1');
    expect(response.status).toBe(409);
    expect(mockReports.get('r1')?.status).toBe('done');
  });

  it('drops a queued job and persists cancelled status', async () => {
    mockReports.clear();
    mockReports.set('r1', base({ status: 'queued' }));
    const response = await post('r1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'cancelled' });
    expect(mockQueue.remove).toHaveBeenCalledWith('r1');
    expect(mockReports.get('r1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Analysis cancelled by the user.',
    });
  });

  it('flips an in-flight job to cancelled and lets the pipeline Abort', async () => {
    mockReports.clear();
    mockReports.set('r1', base({ status: 'extracting' }));
    const response = await post('r1');
    expect(response.status).toBe(200);
    expect(mockQueue.remove).not.toHaveBeenCalled();
    expect(mockReports.get('r1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Analysis cancelled by the user.',
    });
  });
});
