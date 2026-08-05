import { requireApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { jobQueue } from '@/modules/processing';
import { reportStore } from '@/modules/shared/report-store';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const report = await reportStore.get((await params).id);
    if (!report)
      throw new ChronicleError('Job not found.', 404, 'https://chronicle.local/problems/not-found');
    const pending = await jobQueue.pending();
    const running = await jobQueue.running();
    return Response.json({
      id: report.id,
      report_id: report.id,
      status: report.status,
      progress: report.progress,
      partial: report.partial,
      error: report.errorMessage,
      // queue_position counts the running job plus everything queued behind it,
      // so a job right behind the one in flight reports position 1, not 0.
      queue_position: report.status === 'queued' ? pending + (running ? 1 : 0) : undefined,
      created_at: report.createdAt,
      updated_at: report.updatedAt,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
