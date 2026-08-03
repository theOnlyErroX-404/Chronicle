import { randomUUID } from "node:crypto";
import type { ExtractionResult, Graph, ReportStatus } from "@/modules/shared/contracts";
import { config } from "@/lib/config";

export type ReportRecord = {
  id: string;
  sourceType: "url" | "pdf";
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
};

type NewReport = Pick<ReportRecord, "sourceType" | "sourceUrl" | "filename">;

export type ReportStore = {
  create(input: NewReport): ReportRecord;
  get(id: string): ReportRecord | undefined;
  update(id: string, patch: Partial<Omit<ReportRecord, "id" | "createdAt" | "sourceType">>): ReportRecord;
};

const activeStatuses = new Set<ReportStatus>(["queued", "ingesting", "extracting", "modeling"]);

class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, ReportRecord>();

  constructor(private readonly maxItems: number) {}

  create(input: NewReport): ReportRecord {
    const now = new Date().toISOString();
    const report: ReportRecord = { id: randomUUID(), ...input, status: "queued", createdAt: now, updatedAt: now };
    this.reports.set(report.id, report);
    this.evictOldestIfOverCap();
    return report;
  }

  get(id: string): ReportRecord | undefined {
    return this.reports.get(id);
  }

  update(id: string, patch: Partial<Omit<ReportRecord, "id" | "createdAt" | "sourceType">>): ReportRecord {
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

export const createReportStore = (maxItems: number = config.reportStoreMaxItems): ReportStore => new InMemoryReportStore(maxItems);

declare global {
  var chronicleReportStore: ReportStore | undefined;
}

// Phase 1 persistence seam. Replace this implementation with a Prisma repository in Phase 2.
export const reportStore: ReportStore = globalThis.chronicleReportStore ?? createReportStore();
if (process.env.NODE_ENV !== "production") globalThis.chronicleReportStore = reportStore;
