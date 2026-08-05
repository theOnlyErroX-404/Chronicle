import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Report as ReportRow } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '@/lib/config';
import type {
  AttckMapping,
  Correction,
  ExtractionResult,
  Graph,
  ReportStatus,
  TimelineEvent,
} from '@/modules/shared/contracts';
import type { ReportRecord } from '@/modules/shared/report-store';

// Narrow persistence surface used by the store. The real Prisma report
// delegate satisfies it; tests pass a hand-rolled fake so the store is
// testable without a live database.
export type ReportDb = {
  create(args: { data: unknown }): Promise<ReportRow>;
  findUnique(args: { where: { id: string } }): Promise<ReportRow | null>;
  update(args: { where: { id: string }; data: unknown }): Promise<ReportRow>;
  count(args: { where: unknown }): Promise<number>;
};

// Constructed lazily on first use: the in-memory backend (the default) never
// loads the Prisma client, and DATABASE_URL is only consulted when a query
// actually runs. Prisma 7 requires a driver adapter (schema no longer carries
// the URL); @prisma/adapter-pg keeps a pg.Pool inside.
let client: PrismaClient | undefined;
const getClient = (): PrismaClient => {
  if (!client) {
    const adapter = new PrismaPg(config.databaseUrl);
    client = new PrismaClient({ adapter });
  }
  return client;
};

const fromRow = (row: ReportRow): ReportRecord => ({
  id: row.id,
  sourceType: row.sourceType as 'url' | 'pdf',
  sourceUrl: row.sourceUrl ?? undefined,
  filename: row.filename ?? undefined,
  status: row.status as ReportStatus,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  errorMessage: row.errorMessage ?? undefined,
  progress: row.progress ?? undefined,
  partial: row.partial ?? undefined,
  rawText: row.rawText ?? undefined,
  extraction: (row.extraction as ExtractionResult | null) ?? undefined,
  graph: (row.graph as Graph | null) ?? undefined,
  stixBundle: (row.stixBundle as Record<string, unknown> | null) ?? undefined,
  feedback: (row.feedback as Correction[] | null) ?? undefined,
  attck: (row.attck as AttckMapping[] | null) ?? undefined,
  timeline: (row.timeline as TimelineEvent[] | null) ?? undefined,
});

// The in-memory store spreads the patch over the current record, so an
// undefined value clears a field. Prisma skips undefined keys in `data`; map
// undefined to SQL NULL so the two backends behave identically.
const toPatch = (patch: Record<string, unknown>): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    data[key] = value === undefined ? null : value;
  }
  return data;
};

export const createPostgresReportStore = (
  db: ReportDb = getClient().report as unknown as ReportDb,
) => ({
  async create(input: {
    sourceType: 'url' | 'pdf';
    sourceUrl?: string;
    filename?: string;
  }): Promise<ReportRecord> {
    const row = await db.create({
      data: {
        id: randomUUID(),
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        filename: input.filename ?? null,
        status: 'queued',
      },
    });
    return fromRow(row);
  },

  async get(id: string): Promise<ReportRecord | undefined> {
    const row = await db.findUnique({ where: { id } });
    return row ? fromRow(row) : undefined;
  },

  async update(
    id: string,
    patch: Partial<Omit<ReportRecord, 'id' | 'createdAt' | 'sourceType'>>,
  ): Promise<ReportRecord> {
    try {
      const row = await db.update({
        where: { id },
        data: toPatch(patch as Record<string, unknown>),
      });
      return fromRow(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new Error(`Report ${id} was not found.`);
      }
      throw error;
    }
  },

  async countActive(): Promise<number> {
    const count = await db.count({
      where: { status: { in: ['queued', 'ingesting', 'extracting', 'modeling'] } },
    });
    return Number(count);
  },
});
