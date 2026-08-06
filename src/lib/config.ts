import { MAX_REPORT_BYTES } from '@/lib/presentation';

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export type OpenAiEndpoint = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  maxTokens: number;
};

// Primary endpoint from the flat OPENAI_* variables, plus numbered fallbacks
// (OPENAI_BASE_URL_2/OPENAI_API_KEY_2/OPENAI_CHAT_MODEL_2, then _3, ...) so the
// client can fail over to another provider/model when one hits a rate limit.
const buildOpenAiEndpoints = (): OpenAiEndpoint[] => {
  const endpoints: OpenAiEndpoint[] = [];
  const push = (baseUrl?: string, apiKey?: string, chatModel?: string, maxTokens?: number) => {
    if (!baseUrl || !apiKey || !chatModel) return;
    endpoints.push({ baseUrl, apiKey, chatModel, maxTokens: maxTokens ?? 8_192 });
  };
  push(
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_CHAT_MODEL,
    positiveInteger(process.env.OPENAI_MAX_TOKENS, 0) || undefined,
  );
  for (let index = 2; index <= 9; index += 1) {
    push(
      process.env[`OPENAI_BASE_URL_${index}`],
      process.env[`OPENAI_API_KEY_${index}`],
      process.env[`OPENAI_CHAT_MODEL_${index}`],
      positiveInteger(process.env[`OPENAI_MAX_TOKENS_${index}`], 0) || undefined,
    );
  }
  return endpoints;
};

export const config = {
  apiToken: process.env.CHRONICLE_API_TOKEN,
  // "ollama" (local, default) or "openai" for any OpenAI-compatible hosted
  // endpoint (OpenRouter, Groq, Google Gemini). For a provider, set the three
  // OPENAI_* variables; the two-pass extraction and JSON schemas are identical.
  llmProvider: process.env.LLM_PROVIDER ?? 'ollama',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? 'nemotron-mini:latest',
  // Keep the model warm between reports so a second report skips the load-in.
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE ?? '30m',
  // Small chunks need little context; cap it so memory stays bounded, but keep
  // the default at 4096 — the two-pass system prompt plus JSON schema already
  // consume over 2k tokens before any chunk text.
  ollamaNumCtx: positiveInteger(process.env.OLLAMA_NUM_CTX, 4_096),
  // Display name for the primary hosted model (used by the evaluation harness);
  // the transport config lives in the ordered openAiEndpoints list below.
  openaiChatModel: process.env.OPENAI_CHAT_MODEL ?? '',
  // Ordered endpoint list for the OpenAI-compatible provider. When an endpoint
  // rate-limits, rejects the key, or 5xxes, the client blackouts it for a
  // cooldown and continues with the next one, so one exhausted free tier does
  // not stall the whole extraction.
  openAiEndpoints: buildOpenAiEndpoints(),
  maxReportBytes: positiveInteger(process.env.MAX_REPORT_BYTES, MAX_REPORT_BYTES),
  urlFetchTimeoutMs: positiveInteger(process.env.URL_FETCH_TIMEOUT_MS, 15_000),
  maxRedirects: positiveInteger(process.env.MAX_REDIRECTS, 3),
  // Untrusted PDFs parse inside a worker thread (bounded memory + wall-clock
  // timeout), so a malicious file can only exhaust the worker, not the server.
  pdfParseTimeoutMs: positiveInteger(process.env.PDF_PARSE_TIMEOUT_MS, 30_000),
  // Bounded in-memory store: once the cap is hit, the oldest report that is not
  // currently queued/processing is evicted so a long-running server never grows
  // without bound. Active reports are never evicted.
  reportStoreMaxItems: positiveInteger(process.env.REPORT_STORE_MAX_ITEMS, 100),
  // Phase 2 persistence seam: "memory" (default, bounded in-process store) or
  // "postgres" (durable via Prisma). Postgres requires DATABASE_URL.
  reportStoreBackend: process.env.REPORT_STORE_BACKEND === 'postgres' ? 'postgres' : 'memory',
  // Postgres connection string (prisma uses env("DATABASE_URL") directly for
  // migrations; this mirrors it for the app-side config validation).
  databaseUrl: process.env.DATABASE_URL ?? '',
  // Durable job queue seam: "memory" (default, in-process serialized queue) or
  // "redis" (BullMQ durable queue; run `npm run worker` to consume it).
  jobQueueBackend: process.env.JOB_QUEUE_BACKEND === 'redis' ? 'redis' : 'memory',
  redisUrl: process.env.REDIS_URL ?? '',
  // Extraction tuning. On CPU-only inference a 3B model is far slower than a
  // hosted API: chunks must stay small and per-call timeouts generous, and it
  // must stay under Ollama's ~5 minute server-side request cap. Defaults match
  // the measured nemotron-mini configuration (see docs/decisions).
  llmTimeoutMs: positiveInteger(process.env.LLM_TIMEOUT_MS, 600_000),
  extractionMaxChunkChars: positiveInteger(process.env.EXTRACTION_MAX_CHUNK_CHARS, 2_100),
  // Hard ceiling on the report text fed to extraction. Every chunk costs two LLM
  // calls, so an unbounded page would fan out into tens of thousands of requests;
  // the tail of a huge report is truncated to keep the workload finite.
  maxExtractedChars: positiveInteger(process.env.MAX_EXTRACTED_CHARS, 250_000),
  // Max completion tokens per LLM call; generous enough for a chunk's entity
  // list plus aliases and evidence, small enough to stay fast on CPU.
  extractionMaxTokens: positiveInteger(process.env.EXTRACTION_MAX_TOKENS, 2_048),
  // "json" (loose) proved unreliable with qwen2.5:3b — it invents its own
  // schema (entity/description, capitalized types). "schema" (full JSON-schema
  // constrained generation) is the documented approach and works; ~same speed.
  extractionFormat: process.env.EXTRACTION_FORMAT === 'json' ? 'json' : 'schema',
};
