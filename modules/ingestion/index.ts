import { config } from "@/lib/config";
import { assertSafePublicUrl } from "@/modules/ingestion/security";
import { ensureUsableText, normalizeText } from "@/modules/ingestion/text";
import { ChronicleError } from "@/modules/shared/errors";

export type IngestionSource =
  | { kind: "url"; url: string }
  | { kind: "pdf"; filename: string; bytes: Uint8Array };

const readBodyWithinLimit = async (response: Response) => {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > config.maxReportBytes) throw new ChronicleError("The fetched report exceeds the configured size limit.", 413);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > config.maxReportBytes) {
      await reader.cancel();
      throw new ChronicleError("The fetched report exceeds the configured size limit.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const fetchPublicReport = async (rawUrl: string, redirects = 0): Promise<{ bytes: Uint8Array; contentType: string }> => {
  if (redirects > 3) throw new ChronicleError("The report URL redirected too many times.");
  const url = await assertSafePublicUrl(rawUrl);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(config.urlFetchTimeoutMs),
    headers: { "user-agent": "Chronicle-ThreatGraph/0.1 (report ingestion)" },
  }).catch(() => {
    throw new ChronicleError("The report URL could not be fetched.", 502, "https://chronicle.local/problems/fetch-failed");
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new ChronicleError("The report redirect did not include a destination.", 502);
    return fetchPublicReport(new URL(location, url).toString(), redirects + 1);
  }
  if (!response.ok) throw new ChronicleError(`The report host returned HTTP ${response.status}.`, 502);
  return { bytes: await readBodyWithinLimit(response), contentType: response.headers.get("content-type")?.toLowerCase() ?? "" };
};

const extractPdfText = async (bytes: Uint8Array) => {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new ChronicleError("The uploaded file is not a valid PDF.");
  }
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return ensureUsableText(text);
  } catch (error) {
    if (error instanceof ChronicleError) throw error;
    throw new ChronicleError("The PDF could not be safely parsed.", 422, "https://chronicle.local/problems/pdf-parse-failed");
  }
};

export const ingestReport = async (source: IngestionSource) => {
  if (source.kind === "pdf") return extractPdfText(source.bytes);

  const { bytes, contentType } = await fetchPublicReport(source.url);
  if (contentType.includes("pdf") || source.url.toLowerCase().split("?")[0].endsWith(".pdf")) return extractPdfText(bytes);
  if (!contentType.includes("text/") && !contentType.includes("html")) {
    throw new ChronicleError("The URL must resolve to an HTML page or PDF.", 415);
  }
  return ensureUsableText(normalizeText(new TextDecoder().decode(bytes)));
};
