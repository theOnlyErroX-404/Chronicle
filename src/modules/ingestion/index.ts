import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { config } from '@/lib/config';
import { resolveSafePublicUrl } from '@/modules/ingestion/security';
import { fetchPinned } from '@/modules/ingestion/transport';
import type { SafePublicUrl } from '@/modules/ingestion/security';
import { ensureUsableText, normalizeText } from '@/modules/ingestion/text';
import type { PdfWorkerInput, PdfWorkerOutput } from '@/modules/ingestion/pdf-worker-protocol';
import { ChronicleError } from '@/modules/shared/errors';
import { readStreamWithLimit } from '@/modules/shared/stream';

export type IngestionSource =
  { kind: 'url'; url: string } | { kind: 'pdf'; filename: string; bytes: Uint8Array };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Transient network failures (connection reset, TLS hiccup, momentary DNS
// miss) are common against real vendor sites: a single-shot fetch turns one
// hiccup into a failed report. Retry the pinned request a bounded number of
// times with a short backoff. Total worst-case added latency stays under
// (attempts - 1) * maxRetryDelayMs; each attempt still carries the full
// URL_FETCH_TIMEOUT_MS deadline, so a genuinely slow host is not masked.
const retryPinnedFetch = async (target: SafePublicUrl, attemptsLeft = 3): Promise<Response> => {
  try {
    return await fetchPinned(target, config.urlFetchTimeoutMs);
  } catch (error) {
    if (attemptsLeft <= 1) throw error;
    await sleep(300 * (4 - attemptsLeft));
    return retryPinnedFetch(target, attemptsLeft - 1);
  }
};

const fetchPublicReport = async (
  rawUrl: string,
  redirects = 0,
): Promise<{ bytes: Uint8Array; contentType: string }> => {
  if (redirects > config.maxRedirects)
    throw new ChronicleError('The report URL redirected too many times.');
  const target = await resolveSafePublicUrl(rawUrl);
  // Network-level failures (DNS/conn refused/reset, TLS, timeouts) are often
  // transient — a vendor site that hiccups once shouldn't fail the whole
  // report. Retry the raw socket pass with a short backoff; anything outward
  // (a redirect, an HTTP status, a parsed body) is handled below, not here.
  let response: Response;
  try {
    response = await retryPinnedFetch(target);
  } catch {
    throw new ChronicleError(
      'The report URL could not be fetched.',
      502,
      'https://chronicle.local/problems/fetch-failed',
    );
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    // Release the redirect response's socket before following; the body is
    // discarded (and never read) on purpose.
    await response.body?.cancel();
    if (!location)
      throw new ChronicleError('The report redirect did not include a destination.', 502);
    return fetchPublicReport(new URL(location, target.url).toString(), redirects + 1);
  }
  if (!response.ok)
    throw new ChronicleError(`The report host returned HTTP ${response.status}.`, 502);
  // Fail fast on a lying content-length header before streaming; the stream is
  // still capped so a missing/understated header cannot bypass the limit.
  if (Number(response.headers.get('content-length') ?? 0) > config.maxReportBytes) {
    throw new ChronicleError('The fetched report exceeds the configured size limit.', 413);
  }
  try {
    return {
      bytes: await readStreamWithLimit(
        response.body,
        config.maxReportBytes,
        'The fetched report exceeds the configured size limit.',
      ),
      contentType: response.headers.get('content-type')?.toLowerCase() ?? '',
    };
  } catch (error) {
    // The pinned fetch's abort signal covers the body read too (see
    // transport.ts): a timeout there surfaces as a raw stream destroy error,
    // which must become a sanitized 502 rather than a generic 500.
    if (error instanceof ChronicleError) throw error;
    throw new ChronicleError(
      'The report URL could not be fetched.',
      502,
      'https://chronicle.local/problems/fetch-failed',
    );
  }
};

const pdfParseFailed = () =>
  new ChronicleError(
    'The PDF could not be safely parsed.',
    422,
    'https://chronicle.local/problems/pdf-parse-failed',
  );

// The worker file is loaded by node:worker_threads directly, not by the Next
// bundler, so resolve it to the real source file in the project tree.
const pdfWorkerUrl = () =>
  pathToFileURL(path.join(process.cwd(), 'src', 'modules', 'ingestion', 'pdf-worker.ts'));

// Parse an untrusted PDF inside a worker thread. resourceLimits bound the
// worker's heap/stack so a pathological file cannot OOM the server, and the
// wall-clock timeout + terminate() bounds CPU time. The worker posts back only
// the extracted text (or an error tag) — no data from the PDF ever reaches the
// main process except the parse result.
export const parsePdfInWorker = (
  bytes: Uint8Array,
  timeoutMs = config.pdfParseTimeoutMs,
): Promise<string> =>
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
      if (result.kind === 'ok') resolve(result.text);
      else reject(pdfParseFailed());
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(pdfParseFailed());
    }, timeoutMs);
    worker.once('message', (result: PdfWorkerOutput) => settle(result));
    worker.once('error', () => {
      clearTimeout(timer);
      reject(pdfParseFailed());
    });
  });

const extractPdfText = async (bytes: Uint8Array) => {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new ChronicleError('The uploaded file is not a valid PDF.');
  }
  try {
    return capExtractedText(ensureUsableText(await parsePdfInWorker(bytes)));
  } catch (error) {
    if (error instanceof ChronicleError) throw error;
    throw pdfParseFailed();
  }
};

export const ingestReport = async (source: IngestionSource) => {
  if (source.kind === 'pdf') return extractPdfText(source.bytes);

  const { bytes, contentType } = await fetchPublicReport(source.url);
  if (contentType.includes('pdf') || source.url.toLowerCase().split('?')[0].endsWith('.pdf'))
    return extractPdfText(bytes);
  if (!contentType.includes('text/') && !contentType.includes('html')) {
    throw new ChronicleError('The URL must resolve to an HTML page or PDF.', 415);
  }
  return capExtractedText(ensureUsableText(normalizeText(new TextDecoder().decode(bytes))));
};

// Bound the extraction workload even for a huge report: each chunk costs two
// LLM calls, so without a cap a 10 MB page would fan out into tens of thousands
// of requests. Truncate to the configured ceiling after the usable-text check.
const capExtractedText = (text: string) =>
  text.length > config.maxExtractedChars ? text.slice(0, config.maxExtractedChars) : text;
