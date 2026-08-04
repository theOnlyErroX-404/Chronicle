import { config } from "@/lib/config";
import { getLlmClient, type LlmClient } from "@/modules/extraction/llm-client";
import { canonicalizeEndpoints, mergeExtractedEntities, mergeRelationships } from "@/modules/knowledge-modeling";
import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from "@/modules/shared/contracts";
import { ChronicleError } from "@/modules/shared/errors";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>;

// Opens after `threshold` consecutive failures and stays open for `cooldownMs`,
// giving the local model server time to recover instead of hammering it.
export const createCircuitBreaker = (threshold = 2, cooldownMs = 30_000) => {
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

// Hosted free tiers rate-limit per minute; the sub-second recovery backoff above
// would only make the throttle worse. Wait out the minute window instead.
const RATE_LIMIT_DELAYS_MS = [15_000, 30_000, 60_000];
const rateLimitDelay = (attempt: number) => RATE_LIMIT_DELAYS_MS[Math.min(attempt, RATE_LIMIT_DELAYS_MS.length) - 1] ?? 60_000;

const isRateLimit = (error: unknown) => error instanceof ChronicleError && error.status === 429;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const chunkReportText = (text: string, maxChars = config.extractionMaxChunkChars) => {
  const sentences = text.match(/[^.!?]+[.!?]+|.+$/g) ?? [text];
  const chunks: string[] = [];
  const add = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
  };
  // Emit a piece, slicing any token that alone exceeds the ceiling so the
  // invariant "every chunk <= maxChars" always holds.
  const emit = (piece: string) => {
    if (piece.length <= maxChars) {
      add(piece);
      return;
    }
    for (let start = 0; start < piece.length; start += maxChars) add(piece.slice(start, start + maxChars));
  };
  let current = "";
  const flush = () => {
    emit(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Hard split: a single sentence longer than the ceiling must still
      // respect it (word boundary when possible), or one oversized chunk would
      // blow the model's time/context budget and defeat chunking entirely.
      flush();
      let piece = "";
      for (const word of sentence.match(/\S+\s*/g) ?? [sentence]) {
        if (piece && piece.length + word.length > maxChars) {
          emit(piece);
          piece = "";
        }
        piece += word;
      }
      emit(piece);
      continue;
    }
    if (current && current.length + sentence.length > maxChars) flush();
    current += `${sentence} `;
  }
  flush();
  return chunks;
};

export class ExtractionFailureError extends ChronicleError {
  constructor(
    message: string,
    public readonly partial: ExtractionResult,
    status = 502,
    type = "https://chronicle.local/problems/llm-unavailable",
  ) {
    super(message, status, type);
    this.name = "ExtractionFailureError";
  }
}

export const MAX_EVIDENCE_CHARS = 60;

// Service-side cap: the prompt asks the model to keep evidence under 60 chars,
// but free-tier models exceed it. Truncate after extraction so the stored
// contract (evidence <= 60) holds regardless of what the model returned.
export const capEvidence = (extraction: ExtractionResult, maxChars = MAX_EVIDENCE_CHARS): ExtractionResult => {
  const truncate = (evidence: string) => (evidence.length > maxChars ? evidence.slice(0, maxChars) : evidence);
  return {
    entities: extraction.entities.map((entity) => ({ ...entity, evidence: truncate(entity.evidence) })),
    relationships: extraction.relationships.map((relationship) => ({ ...relationship, evidence: truncate(relationship.evidence) })),
  };
};

export type ExtractionProgress = { current: number; total: number };
export type ExtractOptions = {
  // Async so durable backends can persist progress in order; callers that
  // don't care (e.g. in-memory) may ignore the returned promise.
  onProgress?: (progress: ExtractionProgress) => void | Promise<void>;
  breaker?: CircuitBreaker;
  maxChars?: number;
};

const withRetry = async <T>(operation: () => Promise<T>, breaker?: CircuitBreaker): Promise<T> => {
  if (breaker?.isOpen()) {
    throw new ChronicleError("The local model server is cooling down after repeated failures. Try again shortly.", 503, "https://chronicle.local/problems/llm-unavailable");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await operation();
      breaker?.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      breaker?.recordFailure();
      if (attempt < MAX_RETRIES) await sleep(isRateLimit(error) ? rateLimitDelay(attempt) : jitteredDelay(attempt));
    }
  }
  throw lastError;
};

export const extractCandidates = async (text: string, client = getLlmClient(), options: ExtractOptions = {}): Promise<ExtractionResult> => {
  const chunks = chunkReportText(text, options.maxChars);
  const totalPasses = chunks.length * 2;
  const reportProgress = async (done: number) => {
    await options.onProgress?.({ current: done, total: totalPasses });
  };

  const entitiesByChunk: ExtractedEntity[][] = [];
  const partial: ExtractionResult = { entities: [], relationships: [] };
  const failPartial = (error: unknown): never => {
    // Reflect the real failure (rate limit, timeout, invalid output, upstream
    // error) instead of hardcoding 502/llm-unavailable, so callers can tell why
    // a partial extraction stopped.
    const status = error instanceof ChronicleError ? error.status : 502;
    const type = error instanceof ChronicleError ? error.type : "https://chronicle.local/problems/llm-unavailable";
    throw new ExtractionFailureError(error instanceof Error ? error.message : "LLM extraction failed.", capEvidence(partial), status, type);
  };

  // Phase 1: entity pass per chunk, schema stays small (one chunk's entities).
  // Deliberately sequential in Phase 1: modest local Ollama hardware normally
  // handles one request well, and hosted free tiers rate-limit bursts.
  for (let index = 0; index < chunks.length; index += 1) {
    await reportProgress(index + 1);
    try {
      entitiesByChunk.push(await withRetry(() => client.extractEntities(chunks[index]), options.breaker));
    } catch (error) {
      partial.entities = mergeExtractedEntities(entitiesByChunk.flat());
      failPartial(error);
    }
  }

  // Cross-chunk merge: one canonical entity set for the whole report, so a
  // duplicate entity emitted by several chunks becomes a single record and the
  // relationship passes below can link entities mentioned in different chunks.
  const entities = mergeExtractedEntities(entitiesByChunk.flat());
  partial.entities = entities;
  if (entities.length === 0) return { entities: [], relationships: [] };

  // Phase 2: relationship pass per chunk, but against the full merged entity
  // set. Chunk text still limits what the model may cite as evidence, while the
  // schema enum covers every entity in the report (cross-chunk links included).
  const allRelationships: ExtractedRelationship[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    await reportProgress(chunks.length + index + 1);
    try {
      const found = await withRetry(() => client.extractRelationships(chunks[index], entities), options.breaker);
      allRelationships.push(...found);
    } catch (error) {
      partial.relationships = mergeRelationships(allRelationships);
      failPartial(error);
    }
  }

  return capEvidence({
    entities,
    relationships: mergeRelationships(canonicalizeEndpoints(allRelationships, entities)),
  });
};
