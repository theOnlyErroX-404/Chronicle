import { z } from 'zod';
import { config } from '@/lib/config';
import { jobQueue } from '@/modules/processing';
import { requireApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { reportStore } from '@/modules/shared/report-store';
import { readStreamWithLimit } from '@/modules/shared/stream';

export const runtime = 'nodejs';

// Zod at the API boundary: request bodies are validated here so malformed
// payloads fail fast with a 400 instead of surfacing deep inside ingestion.
const jsonReportSchema = z.object({ url: z.url('Provide a valid report URL.') });
const pdfUploadSchema = z.object({ file: z.instanceof(File) });

const zodProblem = (error: unknown): ChronicleError =>
  error instanceof z.ZodError
    ? new ChronicleError(error.issues[0]?.message ?? 'Invalid request.', 400)
    : new ChronicleError('Invalid request.', 400);

// Multipart framing (boundaries, headers) adds a little over the file's own
// bytes, so the raw body may legitimately exceed maxReportBytes. Allow slack for
// the envelope and enforce the real limit on the parsed file size below.
const MULTIPART_FRAMING_SLACK = 256 * 1024;

// Cap on concurrent analyses: each active report costs local CPU/GPU (or hosted-
// model tokens), so submissions are refused with 429 while the cap is reached.
export const MAX_ACTIVE_REPORTS = 8;

export async function POST(request: Request) {
  try {
    requireApiToken(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const rawBody = await readStreamWithLimit(
        request.body,
        config.maxReportBytes,
        'The request body exceeds the configured size limit.',
      );
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        throw new ChronicleError('The request body must be valid JSON.', 400);
      }
      const parsed = jsonReportSchema.safeParse(body);
      if (!parsed.success) throw zodProblem(parsed.error);
      const url = parsed.data.url;
      // The active-report cap is enforced atomically inside the store's create
      // (memory backend) — a separate countActive() pre-check has a TOCTOU
      // window (AUDIT-03).
      const report = await reportStore.create(
        { sourceType: 'url', sourceUrl: url },
        MAX_ACTIVE_REPORTS,
      );
      jobQueue.enqueue({ reportId: report.id, kind: 'url', url });
      return Response.json(
        { report_id: report.id, job_id: report.id, status: report.status },
        { status: 202 },
      );
    }

    if (!contentType.includes('multipart/form-data'))
      throw new ChronicleError(
        'Submit either JSON { url } or multipart/form-data with a PDF file.',
        415,
      );
    const rawBody = await readStreamWithLimit(
      request.body,
      config.maxReportBytes + MULTIPART_FRAMING_SLACK,
      'The request body exceeds the configured size limit.',
    );
    let formData: FormData;
    try {
      // The bytes are already bounded above, so re-parsing the buffered body is
      // safe; this also turns a malformed multipart payload into a 400 instead
      // of an unclassified error.
      formData = await new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: rawBody,
      }).formData();
    } catch {
      throw new ChronicleError('The request body must be valid multipart/form-data.', 400);
    }
    const parsed = pdfUploadSchema.safeParse({ file: formData.get('file') });
    if (!parsed.success) throw zodProblem(parsed.error);
    const file = parsed.data.file;
    if (file.size === 0 || file.size > config.maxReportBytes)
      throw new ChronicleError('The PDF exceeds the configured size limit.', 413);
    if (file.type && file.type !== 'application/pdf')
      throw new ChronicleError('Only PDF uploads are accepted.', 415);
    const report = await reportStore.create(
      { sourceType: 'pdf', filename: file.name },
      MAX_ACTIVE_REPORTS,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    jobQueue.enqueue({ reportId: report.id, kind: 'pdf', filename: file.name, bytes });
    return Response.json(
      { report_id: report.id, job_id: report.id, status: report.status },
      { status: 202 },
    );
  } catch (error) {
    return problemResponse(error);
  }
}
