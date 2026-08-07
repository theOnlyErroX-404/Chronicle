import { requireApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { jobQueue } from '@/modules/processing';
import { reportStore } from '@/modules/shared/report-store';

export const runtime = 'nodejs';

// Cancels a report that has not finished. Queued jobs are dropped outright and
// marked cancelled; jobs already in a pipeline stage get a `cancelled` flag the
// worker polls between stages and will stop at the next chunk boundary. The
// status flip to 'cancelled' is persisted by whoever notices first.
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

    await reportStore.update(id, { cancelled: true, progress: 'cancelled' });

    if (report.status === 'queued') {
      // Drop a not-yet-started job from the durable queue (in-memory backend
      // leaves the task in place: the worker's own cancel check aborts it).
      jobQueue.remove?.(id);
      await reportStore.update(id, {
        status: 'cancelled',
        errorMessage: 'Analysis cancelled by the user before it started.',
      });
    }

    return Response.json({ report_id: id, status: 'cancelled' }, { status: 200 });
  } catch (error) {
    return problemResponse(error);
  }
}
