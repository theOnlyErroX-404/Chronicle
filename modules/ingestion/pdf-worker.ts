// Runs untrusted PDF parsing in its own worker thread (see index.ts), so a
// malicious file can exhaust the worker's memory/CPU budget instead of the
// Next.js process. The parent enforces resourceLimits plus a wall-clock timeout
// and terminates the worker when either is exceeded. Loaded by node:worker_threads,
// not by the Next bundler, so keep this file free of the "@/" alias and rely on
// Node's own module resolution.
import { parentPort, workerData } from "node:worker_threads";
import type { PdfWorkerInput, PdfWorkerOutput } from "./pdf-worker-protocol";

const input = workerData as PdfWorkerInput;

const parse = async (): Promise<PdfWorkerOutput> => {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(input.bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return { kind: "ok", text };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "unknown parse failure" };
  }
};

void parse().then((result) => parentPort?.postMessage(result));
