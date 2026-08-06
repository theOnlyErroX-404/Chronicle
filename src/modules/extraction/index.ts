import { config } from '@/lib/config';
import { getLlmClient, type LlmClient } from '@/modules/extraction/llm-client';
import {
  canonicalizeEndpoints,
  mergeExtractedEntities,
  mergeRelationships,
} from '@/modules/knowledge-modeling';
import type {
  ExtractedEntity,
  ExtractedRelationship,
  ExtractionResult,
  ExtractionStats,
} from '@/modules/shared/contracts';
import { ChronicleError } from '@/modules/shared/errors';

export { getLlmClient } from '@/modules/extraction/llm-client';

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
    // Milliseconds left in the cooldown, 0 when closed — lets callers sleep once
    // for the remaining window instead of polling isOpen.
    remainingMs() {
      if (openedAt === 0) return 0;
      const left = openedAt + cooldownMs - Date.now();
      return left > 0 ? left : 0;
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
const rateLimitDelay = (attempt: number) =>
  RATE_LIMIT_DELAYS_MS[Math.min(attempt, RATE_LIMIT_DELAYS_MS.length) - 1] ?? 60_000;

const isRateLimit = (error: unknown) => error instanceof ChronicleError && error.status === 429;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const chunkReportText = (text: string, maxChars = config.extractionMaxChunkChars) => {
  // `[\s\S]+$` (not `.+$`): the tail alternative must capture an unterminated
  // final sentence even when it is followed by a newline or other whitespace —
  // `.+$` without /m only matches the final line, silently dropping the last
  // sentence of a truncated report (exactly what MAX_EXTRACTED_CHARS produces).
  const sentences = text.match(/[^.!?]+[.!?]+|[\s\S]+$/g) ?? [text];
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
    for (let start = 0; start < piece.length; start += maxChars)
      add(piece.slice(start, start + maxChars));
  };
  let current = '';
  const flush = () => {
    emit(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Hard split: a single sentence longer than the ceiling must still
      // respect it (word boundary when possible), or one oversized chunk would
      // blow the model's time/context budget and defeat chunking entirely.
      flush();
      let piece = '';
      for (const word of sentence.match(/\S+\s*/g) ?? [sentence]) {
        if (piece && piece.length + word.length > maxChars) {
          emit(piece);
          piece = '';
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
    type = 'https://chronicle.local/problems/llm-unavailable',
  ) {
    super(message, status, type);
    this.name = 'ExtractionFailureError';
  }
}

export const MAX_EVIDENCE_CHARS = 60;

// Service-side cap: the prompt asks the model to keep evidence under 60 chars,
// but free-tier models exceed it. Truncate after extraction so the stored
// contract (evidence <= 60) holds regardless of what the model returned.
export const capEvidence = (
  extraction: ExtractionResult,
  maxChars = MAX_EVIDENCE_CHARS,
): ExtractionResult => {
  // Array.from splits by code point, so an emoji (surrogate pair) is never cut
  // in half by slice().
  const truncate = (evidence: string) =>
    evidence.length > maxChars ? Array.from(evidence).slice(0, maxChars).join('') : evidence;
  return {
    entities: extraction.entities.map((entity) => ({
      ...entity,
      evidence: truncate(entity.evidence),
    })),
    relationships: extraction.relationships.map((relationship) => ({
      ...relationship,
      evidence: truncate(relationship.evidence),
    })),
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
  // A tripped breaker means the model server needs its cooldown, not that the
  // run is over: fail-fast here would abort every remaining chunk on an open
  // breaker and blow the run's failure threshold off a single flaky chunk.
  // Wait out the remaining cooldown in one sleep (remainingMs is a pure time
  // check, so this is bounded), then proceed as normal.
  const remaining = breaker?.remainingMs() ?? 0;
  if (remaining > 0) await sleep(remaining + 25);
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await operation();
      breaker?.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      breaker?.recordFailure();
      if (attempt < MAX_RETRIES)
        await sleep(isRateLimit(error) ? rateLimitDelay(attempt) : jitteredDelay(attempt));
    }
  }
  throw lastError;
};

export const extractCandidates = async (
  text: string,
  client = getLlmClient(),
  options: ExtractOptions = {},
): Promise<ExtractionResult> => {
  const chunks = chunkReportText(text, options.maxChars);
  const totalChunks = chunks.length;
  const totalPasses = chunks.length * 2;
  const reportProgress = async (done: number) => {
    await options.onProgress?.({ current: done, total: totalPasses });
  };

  // A single flaky chunk must not discard the whole extraction: a transient
  // failure is recorded and the next chunk is tried. We only abort when the
  // chunk failure count is actually insurmountable (all chunks failed, or
  // more than ~1/4 of them did) — otherwise a mostly-healthy run still ships.
  const maxFailed = Math.max(2, Math.ceil(totalChunks * 0.25));
  const abortAfter = (failed: number) => failed >= totalChunks || failed > maxFailed;

  const entitiesByChunk: ExtractedEntity[][] = [];
  const allRelationships: ExtractedRelationship[] = [];
  const partial: ExtractionResult = { entities: [], relationships: [] };
  const failureMessage = (index: number, error: unknown) =>
    `chunk ${index + 1}/${totalChunks}: ${
      error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
    }`;

  // ponytail: per-chunk retries stay (withRetry, shared breaker) but a failed
  // chunk no longer aborts the run — failures are counted and surfaced via
  // stats. Upgrade path: weighted chunk retries when a specific phase shows a
  // systematic failure pattern.
  let phaseName: ExtractionStats['phase'] = 'entities';
  let failed = 0;
  const reasons: string[] = [];
  const statsOf = (stopPhase: ExtractionStats['phase']): ExtractionStats => ({
    totalChunks,
    failedChunks: failed,
    phase: stopPhase,
    reasons: reasons.slice(0, 20),
  });
  const failPartial = (phase: ExtractionStats['phase'], error: unknown): never => {
    // Reflect the real failure (rate limit, timeout, invalid output, upstream
    // error) instead of hardcoding 502/llm-unavailable, so callers can tell why
    // a partial extraction stopped.
    const status = error instanceof ChronicleError ? error.status : 502;
    const type =
      error instanceof ChronicleError
        ? error.type
        : 'https://chronicle.local/problems/llm-unavailable';
    throw new ExtractionFailureError(
      error instanceof Error ? error.message : 'LLM extraction failed.',
      { ...capEvidence(partial), stats: statsOf(phase) },
      status,
      type,
    );
  };

  // Phase 1: entity pass per chunk, schema stays small (one chunk's entities).
  // Deliberately sequential in Phase 1: modest local Ollama hardware normally
  // handles one request well, and hosted free tiers rate-limit bursts.
  for (let index = 0; index < chunks.length; index += 1) {
    await reportProgress(index + 1);
    try {
      entitiesByChunk.push(
        await withRetry(() => client.extractEntities(chunks[index]), options.breaker),
      );
    } catch (error) {
      partial.entities = mergeExtractedEntities(entitiesByChunk.flat());
      failed += 1;
      reasons.push(`[entities] ${failureMessage(index, error)}`);
      if (abortAfter(failed)) failPartial('entities', error);
    }
  }

  // Cross-chunk merge: one canonical entity set for the whole report, so a
  // duplicate entity emitted by several chunks becomes a single record and the
  // relationship passes below can link entities mentioned in different chunks.
  const entities = mergeExtractedEntities(entitiesByChunk.flat());
  partial.entities = entities;
  if (entities.length === 0) {
    return {
      entities: [],
      relationships: [],
      stats: statsOf(phaseName),
    };
  }

  // Phase 2: relationship pass per chunk, but against the full merged entity
  // set. Chunk text still limits what the model may cite as evidence, while the
  // schema enum covers every entity in the report (cross-chunk links included).
  phaseName = 'relationships';
  for (let index = 0; index < chunks.length; index += 1) {
    await reportProgress(chunks.length + index + 1);
    try {
      const found = await withRetry(
        () => client.extractRelationships(chunks[index], entities),
        options.breaker,
      );
      allRelationships.push(...found);
    } catch (error) {
      // Partial path mirrors the success path: endpoints are canonicalized
      // against the merged entity set so a partial graph links variant names to
      // the canonical node instead of synthesizing duplicate nodes.
      partial.relationships = canonicalizeEndpoints(mergeRelationships(allRelationships), entities);
      failed += 1;
      reasons.push(`[relationships] ${failureMessage(index, error)}`);
      if (abortAfter(failed)) failPartial('relationships', error);
    }
  }
  phaseName = null;

  const merged = mergeRelationships(canonicalizeEndpoints(allRelationships, entities));
  return {
    ...capEvidence({ entities, relationships: merged }),
    stats: statsOf(phaseName),
  };
};
