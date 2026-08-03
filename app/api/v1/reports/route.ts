import { config } from "@/lib/config";
import { processReport } from "@/modules/processing/process-report";
import { jobQueue } from "@/modules/processing/queue";
import { requireApiToken } from "@/modules/shared/auth";
import { ChronicleError, problemResponse } from "@/modules/shared/errors";
import { reportStore } from "@/modules/shared/report-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireApiToken(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { url?: unknown };
      if (typeof body.url !== "string" || !body.url.trim()) throw new ChronicleError("Provide a non-empty report URL.");
      const url = body.url;
      const report = reportStore.create({ sourceType: "url", sourceUrl: url });
      jobQueue.enqueue(() => processReport(report.id, { kind: "url", url }));
      return Response.json({ report_id: report.id, job_id: report.id, status: report.status }, { status: 202 });
    }

    if (!contentType.includes("multipart/form-data")) throw new ChronicleError("Submit either JSON { url } or multipart/form-data with a PDF file.", 415);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ChronicleError("Attach a PDF using the file field.");
    if (file.size === 0 || file.size > config.maxReportBytes) throw new ChronicleError("The PDF exceeds the configured size limit.", 413);
    if (file.type && file.type !== "application/pdf") throw new ChronicleError("Only PDF uploads are accepted.", 415);
    const report = reportStore.create({ sourceType: "pdf", filename: file.name });
    const bytes = new Uint8Array(await file.arrayBuffer());
    jobQueue.enqueue(() => processReport(report.id, { kind: "pdf", filename: file.name, bytes }));
    return Response.json({ report_id: report.id, job_id: report.id, status: report.status }, { status: 202 });
  } catch (error) {
    return problemResponse(error);
  }
}
