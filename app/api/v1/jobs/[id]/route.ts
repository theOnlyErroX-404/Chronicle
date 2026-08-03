import { requireApiToken } from "@/modules/shared/auth";
import { ChronicleError, problemResponse } from "@/modules/shared/errors";
import { jobQueue } from "@/modules/processing/queue";
import { reportStore } from "@/modules/shared/report-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const report = reportStore.get((await params).id);
    if (!report) throw new ChronicleError("Job not found.", 404, "https://chronicle.local/problems/not-found");
    return Response.json({
      id: report.id,
      report_id: report.id,
      status: report.status,
      progress: report.progress,
      partial: report.partial,
      error: report.errorMessage,
      queue_position: report.status === "queued" ? jobQueue.pending() : undefined,
      created_at: report.createdAt,
      updated_at: report.updatedAt,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
