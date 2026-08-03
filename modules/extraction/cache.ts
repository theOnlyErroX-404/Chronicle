import { createHash } from "node:crypto";

export interface LlmCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
  clear(): void;
  readonly size: number;
}

// Small in-memory LRU. Extraction is deterministic (temperature 0, fixed seed),
// so re-running the same chunk with the same prompt and model returns the same
// result. The cache turns repeated full-file runs (prompt iteration, golden
// eval, a report submitted twice) into no-op LLM calls. Keyed per (model,
// prompt fingerprint, chunk) so prompt or schema edits auto-invalidate. Phase 1
// keeps it small and in-process; a Redis layer can replace it later.
export const createLlmCache = (maxEntries = 100): LlmCache => {
  const entries = new Map<string, unknown>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
};

export const llmCacheKey = (parts: Array<string | number>): string =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex");
