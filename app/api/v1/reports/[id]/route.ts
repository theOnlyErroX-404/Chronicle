import { requireApiToken } from "@/modules/shared/auth";
import { ChronicleError, problemResponse } from "@/modules/shared/errors";
import { reportStore } from "@/modules/shared/report-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const report = reportStore.get((await params).id);
    if (!report) throw new ChronicleError("Report not found.", 404, "https://chronicle.local/problems/not-found");
    return Response.json({ id: report.id, source_type: report.sourceType, source_url: report.sourceUrl, filename: report.filename, status: report.status, created_at: report.createdAt });
  } catch (error) {
    return problemResponse(error);
  }
}
