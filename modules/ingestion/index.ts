import path from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { config } from "@/lib/config";
import { resolveSafePublicUrl } from "@/modules/ingestion/security";
import { fetchPinned } from "@/modules/ingestion/transport";
import { ensureUsableText, normalizeText } from "@/modules/ingestion/text";
import type { PdfWorkerInput, PdfWorkerOutput } from "@/modules/ingestion/pdf-worker-protocol";
import { ChronicleError } from "@/modules/shared/errors";
import { readStreamWithLimit } from "@/modules/shared/stream";

export type IngestionSource =
  | { kind: "url"; url: string }
  | { kind: "pdf"; filename: string; bytes: Uint8Array };

const fetchPublicReport = async (rawUrl: string, redirects = 0): Promise<{ bytes: Uint8Array; contentType: string }> => {
  if (redirects > config.maxRedirects) throw new ChronicleError("The report URL redirected too many times.");
  const target = await resolveSafePublicUrl(rawUrl);
  const response = await fetchPinned(target, config.urlFetchTimeoutMs).catch(() => {
    throw new ChronicleError("The report URL could not be fetched.", 502, "https://chronicle.local/problems/fetch-failed");
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    // Release the redirect response's socket before following; the body is
    // discarded (and never read) on purpose.
    await response.body?.cancel();
    if (!location) throw new ChronicleError("The report redirect did not include a destination.", 502);
    return fetchPublicReport(new URL(location, target.url).toString(), redirects + 1);
  }
  if (!response.ok) throw new ChronicleError(`The report host returned HTTP ${response.status}.`, 502);
  // Fail fast on a lying content-length header before streaming; the stream is
  // still capped so a missing/understated header cannot bypass the limit.
  if (Number(response.headers.get("content-length") ?? 0) > config.maxReportBytes) {
    throw new ChronicleError("The fetched report exceeds the configured size limit.", 413);
  }
  return {
    bytes: await readStreamWithLimit(response.body, config.maxReportBytes, "The fetched report exceeds the configured size limit."),
    contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
  };
};

const pdfParseFailed = () =>
  new ChronicleError("The PDF could not be safely parsed.", 422, "https://chronicle.local/problems/pdf-parse-failed");

// The worker file is loaded by node:worker_threads directly, not by the Next
// bundler, so resolve it to the real source file in the project tree.
const pdfWorkerUrl = () => pathToFileURL(path.join(process.cwd(), "modules", "ingestion", "pdf-worker.ts"));

// Parse an untrusted PDF inside a worker thread. resourceLimits bound the
// worker's heap/stack so a pathological file cannot OOM the server, and the
// wall-clock timeout + terminate() bounds CPU time. The worker posts back only
// the extracted text (or an error tag) — no data from the PDF ever reaches the
// main process except the parse result.
export const parsePdfInWorker = (bytes: Uint8Array, timeoutMs = config.pdfParseTimeoutMs): Promise<string> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(pdfWorkerUrl(), {
      workerData: { bytes } satisfies PdfWorkerInput,
      resourceLimits: {
        maxYoungGenerationSizeMb: 64,
        maxOldGenerationSizeMb: 256,
        codeRangeSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    const settle = (result: PdfWorkerOutput) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.kind === "ok") resolve(result.text);
      else reject(pdfParseFailed());
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(pdfParseFailed());
    }, timeoutMs);
    worker.once("message", (result: PdfWorkerOutput) => settle(result));
    worker.once("error", () => {
      clearTimeout(timer);
      reject(pdfParseFailed());
    });
  });

const extractPdfText = async (bytes: Uint8Array) => {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new ChronicleError("The uploaded file is not a valid PDF.");
  }
  try {
    return capExtractedText(ensureUsableText(await parsePdfInWorker(bytes)));
  } catch (error) {
    if (error instanceof ChronicleError) throw error;
    throw pdfParseFailed();
  }
};

export const ingestReport = async (source: IngestionSource) => {
  if (source.kind === "pdf") return extractPdfText(source.bytes);

  const { bytes, contentType } = await fetchPublicReport(source.url);
  if (contentType.includes("pdf") || source.url.toLowerCase().split("?")[0].endsWith(".pdf")) return extractPdfText(bytes);
  if (!contentType.includes("text/") && !contentType.includes("html")) {
    throw new ChronicleError("The URL must resolve to an HTML page or PDF.", 415);
  }
  return capExtractedText(ensureUsableText(normalizeText(new TextDecoder().decode(bytes))));
};

// Bound the extraction workload even for a huge report: each chunk costs two
// LLM calls, so without a cap a 10 MB page would fan out into tens of thousands
// of requests. Truncate to the configured ceiling after the usable-text check.
const capExtractedText = (text: string) => (text.length > config.maxExtractedChars ? text.slice(0, config.maxExtractedChars) : text);
