import { requireApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { jobQueue } from '@/modules/processing';
import { reportStore } from '@/modules/shared/report-store';

export const runtime = 'nodejs';

// Cancels a report that has not finished. 'cancelled' is a durable status in
// both store backends (in-memory spread and the Postgres row), so the cancel
// flips it immediately and the running pipeline — which polls the status
// between stages and at every chunk boundary — aborts shortly after. Jobs that
// were still queued are also dropped from the work queue as a best effort
// (in-memory there is nothing to drop: the queued task is fine, its first
// status check aborts it).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const id = (await params).id;
    const report = await reportStore.get(id);
    if (!report)
      throw new ChronicleError('Job not found.', 404, 'https://chronicle.local/problems/not-found');

    const terminal = new Set(['done', 'failed', 'cancelled']);
    if (terminal.has(report.status)) {
      throw new ChronicleError(
        `The analysis is already ${report.status}; nothing to cancel.`,
        409,
        'https://chronicle.local/problems/not-running',
      );
    }

    await reportStore.update(id, {
      status: 'cancelled',
      errorMessage: 'Analysis cancelled by the user.',
      progress: undefined,
      partial: undefined,
    });

    if (report.status === 'queued') {
      jobQueue.remove?.(id);
    }

    return Response.json({ report_id: id, status: 'cancelled' }, { status: 200 });
  } catch (error) {
    return problemResponse(error);
  }
}
