const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  apiToken: process.env.CHRONICLE_API_TOKEN,
  llmProvider: process.env.LLM_PROVIDER ?? "ollama",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5:3b",
  maxReportBytes: positiveInteger(process.env.MAX_REPORT_BYTES, 10 * 1024 * 1024),
  urlFetchTimeoutMs: positiveInteger(process.env.URL_FETCH_TIMEOUT_MS, 15_000),
  // Extraction tuning. On CPU-only inference a 3B model is far slower than a
  // hosted API: chunks must stay small and per-call timeouts generous, and it
  // must stay under Ollama's ~5 minute server-side request cap.
  llmTimeoutMs: positiveInteger(process.env.LLM_TIMEOUT_MS, 180_000),
  extractionMaxChunkChars: positiveInteger(process.env.EXTRACTION_MAX_CHUNK_CHARS, 1_200),
  // "json" (loose) proved unreliable with qwen2.5:3b — it invents its own
  // schema (entity/description, capitalized types). "schema" (full JSON-schema
  // constrained generation) is the documented approach and works; ~same speed.
  extractionFormat: process.env.EXTRACTION_FORMAT === "json" ? "json" : "schema",
};
