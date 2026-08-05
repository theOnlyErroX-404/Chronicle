import { randomUUID } from 'node:crypto';
import type { Correction, ExtractionResult, Graph, ReportStatus } from '@/modules/shared/contracts';
import { config } from '@/lib/config';
import { createPostgresReportStore } from '@/modules/persistence/postgres-report-store';

export type ReportRecord = {
  id: string;
  sourceType: 'url' | 'pdf';
  sourceUrl?: string;
  filename?: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  progress?: string;
  partial?: boolean;
  rawText?: string;
  extraction?: ExtractionResult;
  graph?: Graph;
  stixBundle?: Record<string, unknown>;
  // Human-in-the-loop corrections, append-only, newest last.
  feedback?: Correction[];
};

type NewReport = Pick<ReportRecord, 'sourceType' | 'sourceUrl' | 'filename'>;

export type ReportStore = {
  create(input: NewReport): Promise<ReportRecord>;
  get(id: string): Promise<ReportRecord | undefined>;
  update(
    id: string,
    patch: Partial<Omit<ReportRecord, 'id' | 'createdAt' | 'sourceType'>>,
  ): Promise<ReportRecord>;
};

const activeStatuses = new Set<ReportStatus>(['queued', 'ingesting', 'extracting', 'modeling']);

class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, ReportRecord>();

  constructor(private readonly maxItems: number) {}

  async create(input: NewReport): Promise<ReportRecord> {
    const now = new Date().toISOString();
    const report: ReportRecord = {
      id: randomUUID(),
      ...input,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.reports.set(report.id, report);
    this.evictOldestIfOverCap();
    return report;
  }

  async get(id: string): Promise<ReportRecord | undefined> {
    return this.reports.get(id);
  }

  async update(
    id: string,
    patch: Partial<Omit<ReportRecord, 'id' | 'createdAt' | 'sourceType'>>,
  ): Promise<ReportRecord> {
    const current = this.reports.get(id);
    if (!current) throw new Error(`Report ${id} was not found.`);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.reports.set(id, updated);
    return updated;
  }

  // Evict the oldest report that is not currently queued/processing, so a
  // long-running server's memory stays bounded without interrupting work in
  // flight. If every report is active, creation is allowed to exceed the cap.
  private evictOldestIfOverCap(): void {
    if (this.reports.size <= this.maxItems) return;
    const [oldest] = [...this.reports.values()]
      .filter((report) => !activeStatuses.has(report.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (oldest) this.reports.delete(oldest.id);
  }
}

export const createReportStore = (maxItems: number = config.reportStoreMaxItems): ReportStore => {
  if (config.reportStoreBackend === 'postgres') {
    if (!config.databaseUrl) {
      throw new Error('REPORT_STORE_BACKEND=postgres requires DATABASE_URL to be set.');
    }
    return createPostgresReportStore();
  }
  return new InMemoryReportStore(maxItems);
};

declare global {
  var chronicleReportStore: ReportStore | undefined;
}

// Persistence seam: "memory" (bounded in-process, default) or "postgres"
// (durable, via Prisma). Both implement the same async ReportStore interface.
export const reportStore: ReportStore = globalThis.chronicleReportStore ?? createReportStore();
if (process.env.NODE_ENV !== 'production') globalThis.chronicleReportStore = reportStore;
