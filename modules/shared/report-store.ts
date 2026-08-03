import { randomUUID } from "node:crypto";
import type { ExtractionResult, Graph, ReportStatus } from "@/modules/shared/contracts";

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

class InMemoryReportStore {
  private readonly reports = new Map<string, ReportRecord>();

  create(input: NewReport): ReportRecord {
    const now = new Date().toISOString();
    const report: ReportRecord = { id: randomUUID(), ...input, status: "queued", createdAt: now, updatedAt: now };
    this.reports.set(report.id, report);
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
}

declare global {
  var chronicleReportStore: InMemoryReportStore | undefined;
}

// Phase 1 persistence seam. Replace this implementation with a Prisma repository in Phase 2.
export const reportStore = globalThis.chronicleReportStore ?? new InMemoryReportStore();
if (process.env.NODE_ENV !== "production") globalThis.chronicleReportStore = reportStore;
