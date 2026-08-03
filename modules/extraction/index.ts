import { config } from "@/lib/config";
import { getLlmClient, type LlmClient } from "@/modules/extraction/llm-client";
import type { ExtractionResult } from "@/modules/shared/contracts";
import { ChronicleError } from "@/modules/shared/errors";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export type CircuitBreaker = {
  isOpen(): boolean;
  recordFailure(): void;
  recordSuccess(): void;
};

// Opens after `threshold` consecutive failures and stays open for `cooldownMs`,
// giving the local model server time to recover instead of hammering it.
export const createCircuitBreaker = (threshold = 2, cooldownMs = 30_000): CircuitBreaker => {
  let consecutive = 0;
  let openedAt = 0;
  return {
    isOpen() {
      if (openedAt === 0) return false;
      return Date.now() - openedAt < cooldownMs;
    },
    recordFailure() {
      consecutive += 1;
      if (consecutive >= threshold) openedAt = Date.now();
    },
    recordSuccess() {
      consecutive = 0;
      openedAt = 0;
    },
  };
};

const jitteredDelay = (attempt: number) => {
  const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.min(8_000, exponential) * (0.5 + Math.random() * 0.5);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const chunkReportText = (text: string, maxChars = config.extractionMaxChunkChars) => {
  const sentences = text.match(/[^.!?]+[.!?]+|.+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

export class ExtractionFailureError extends ChronicleError {
  constructor(message: string, public readonly partial: ExtractionResult) {
    super(message, 502, "https://chronicle.local/problems/llm-unavailable");
    this.name = "ExtractionFailureError";
  }
}

export type ExtractionProgress = { current: number; total: number };
export type ExtractOptions = {
  onProgress?: (progress: ExtractionProgress) => void;
  breaker?: CircuitBreaker;
  maxChars?: number;
};

const extractWithRetry = async (client: LlmClient, chunk: string, breaker?: CircuitBreaker) => {
  if (breaker?.isOpen()) {
    throw new ChronicleError("The local model server is cooling down after repeated failures. Try again shortly.", 503, "https://chronicle.local/problems/llm-unavailable");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await client.extract(chunk);
      breaker?.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      breaker?.recordFailure();
      if (attempt < MAX_RETRIES) await sleep(jitteredDelay(attempt));
    }
  }
  throw lastError;
};

export const extractCandidates = async (text: string, client = getLlmClient(), options: ExtractOptions = {}): Promise<ExtractionResult> => {
  const chunks = chunkReportText(text, options.maxChars);
  const results: ExtractionResult[] = [];
  const partial: ExtractionResult = { entities: [], relationships: [] };
  // Deliberately sequential in Phase 1: modest local Ollama hardware normally handles one request well.
  for (let index = 0; index < chunks.length; index += 1) {
    options.onProgress?.({ current: index + 1, total: chunks.length });
    try {
      const result = await extractWithRetry(client, chunks[index], options.breaker);
      results.push(result);
      partial.entities.push(...result.entities);
      partial.relationships.push(...result.relationships);
    } catch (error) {
      // Keep the accumulated results so the job can surface a partial graph
      // instead of discarding everything when a late chunk fails.
      throw new ExtractionFailureError(error instanceof Error ? error.message : "LLM extraction failed.", partial);
    }
  }
  return {
    entities: results.flatMap((result) => result.entities),
    relationships: results.flatMap((result) => result.relationships),
  };
};
