import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCircuitBreaker,
  extractCandidates,
  ExtractionFailureError,
} from '@/modules/extraction';
import { OllamaLlmClient } from '@/modules/extraction/llm-client';
import { ChronicleError } from '@/modules/shared/errors';
import type { ExtractionResult } from '@/modules/shared/contracts';

const sample: ExtractionResult = {
  entities: [{ type: 'malware', name: 'EvilBoat', confidence: 0.9, evidence: 'EvilBoat' }],
  relationships: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OllamaLlmClient error classification', () => {
  const mockFetch = (impl: (input: string, init?: RequestInit) => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(impl as typeof fetch));
  };

  it('classifies a timeout as 504 (llm-timeout)', async () => {
    mockFetch(() => Promise.reject(new DOMException('timeout', 'TimeoutError')));
    const client = new OllamaLlmClient();
    await expect(client.extractEntities('text')).rejects.toMatchObject({
      status: 504,
      type: 'https://chronicle.local/problems/llm-timeout',
    });
  });

  it('classifies a connection failure as 503 (llm-unavailable)', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    const client = new OllamaLlmClient();
    await expect(client.extractEntities('text')).rejects.toMatchObject({
      status: 503,
      type: 'https://chronicle.local/problems/llm-unavailable',
    });
  });

  it('classifies an HTTP error as 503', async () => {
    mockFetch(() => Promise.resolve(new Response('err', { status: 500 })));
    const client = new OllamaLlmClient();
    await expect(client.extractEntities('text')).rejects.toMatchObject({ status: 503 });
  });

  it('classifies invalid output as 502 (invalid-llm-output)', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 }),
      ),
    );
    const client = new OllamaLlmClient();
    await expect(client.extractEntities('text')).rejects.toMatchObject({
      status: 502,
      type: 'https://chronicle.local/problems/invalid-llm-output',
    });
  });

  it('health check flags a missing model as 503 (llm-model-missing)', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: 'other-model' }] }), { status: 200 }),
      ),
    );
    const client = new OllamaLlmClient();
    await expect(client.checkHealth?.()).rejects.toMatchObject({
      status: 503,
      type: 'https://chronicle.local/problems/llm-model-missing',
    });
  });

  it('health check passes when the configured model is present', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }), { status: 200 }),
      ),
    );
    const client = new OllamaLlmClient();
    await expect(client.checkHealth?.()).resolves.toBeUndefined();
  });
});

describe('circuit breaker', () => {
  it('opens after threshold failures and stays closed on success', () => {
    const breaker = createCircuitBreaker(2, 60_000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('resets on success', () => {
    const breaker = createCircuitBreaker(1, 60_000);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
  });

  it('cooldown elapses before the breaker reopens', () => {
    vi.useFakeTimers();
    const breaker = createCircuitBreaker(1, 10);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    vi.advanceTimersByTime(50);
    expect(breaker.isOpen()).toBe(false);
    vi.useRealTimers();
  });
});

describe('extractCandidates partial failure', () => {
  it('surfaces accumulated results as an ExtractionFailureError when a chunk fails', async () => {
    let call = 0;
    const client = {
      extractEntities: vi.fn(async () => {
        call += 1;
        if (call === 1) return sample.entities;
        throw new ChronicleError(
          'Ollama returned HTTP 500.',
          503,
          'https://chronicle.local/problems/llm-unavailable',
        );
      }),
      extractRelationships: vi.fn(async () => []),
    };
    const progress: Array<{ current: number; total: number }> = [];
    const promise = extractCandidates('First chunk. Second chunk.', client, {
      onProgress: (p) => {
        progress.push(p);
      },
      breaker: createCircuitBreaker(2, 1_000),
      maxChars: 20,
    });
    await expect(promise).rejects.toBeInstanceOf(ExtractionFailureError);
    await promise.catch((error: ExtractionFailureError) => {
      expect(error.partial.entities).toHaveLength(1);
      expect(error.partial.entities[0].name).toBe('EvilBoat');
    });
    expect(progress).toEqual([
      { current: 1, total: 4 },
      { current: 2, total: 4 },
    ]);
  });

  it('does not call the client while the breaker is open', async () => {
    const client = {
      extractEntities: vi.fn(async () => sample.entities),
      extractRelationships: vi.fn(async () => []),
    };
    const breaker = createCircuitBreaker(2, 60_000);
    breaker.recordFailure();
    breaker.recordFailure();
    await expect(extractCandidates('text', client, { breaker })).rejects.toBeInstanceOf(
      ChronicleError,
    );
    expect(client.extractEntities).not.toHaveBeenCalled();
    expect(client.extractRelationships).not.toHaveBeenCalled();
  });
});
