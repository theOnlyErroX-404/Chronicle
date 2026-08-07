import { describe, expect, it, vi } from 'vitest';
import { ChronicleError } from '@/modules/shared/errors';

const mockStore = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  update: vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({})),
}));
const mockGetLlmClient = vi.hoisted(() => vi.fn());

vi.mock('@/modules/shared/report-store', () => ({ reportStore: mockStore }));
vi.mock('@/modules/extraction', () => ({
  createCircuitBreaker: () => ({ isOpen: () => false }),
  extractCandidates: vi.fn(async () => ({
    entities: [],
    relationships: [],
  })),
  ExtractionFailureError: class extends Error {},
  getLlmClient: mockGetLlmClient,
}));
vi.mock('@/modules/ingestion', () => ({
  ingestReport: vi.fn(async () => ''),
}));
vi.mock('@/modules/attck', () => ({ matchExplicitTechniques: vi.fn(() => []) }));
vi.mock('@/modules/timeline', () => ({ extractTimelineEvents: vi.fn(() => []) }));
vi.mock('@/modules/knowledge-modeling', () => ({
  buildGraph: vi.fn(() => ({ nodes: [], edges: [] })),
  buildStixLiteBundle: vi.fn(() => ({})),
  completeEntityEndpoints: vi.fn((result: unknown) => result),
}));

import { processReport } from '@/modules/processing/process-report';

describe('processReport failure handling', () => {
  it('rethrows after persisting failure so the queue marks the job failed (AUDIT-10)', async () => {
    mockStore.update.mockClear();
    mockGetLlmClient.mockReturnValue({
      checkHealth: vi.fn(async () => {
        throw new ChronicleError('LLM unavailable.', 503);
      }),
    });

    await expect(
      processReport('r1', { kind: 'url', url: 'https://example.com/x' }),
    ).rejects.toMatchObject({ status: 503 });
    const persisted = mockStore.update.mock.calls.some((call) => call[1]?.status === 'failed');
    expect(persisted).toBe(true);
  });
});
