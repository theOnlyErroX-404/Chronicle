import { describe, expect, it, vi } from 'vitest';
import { chunkReportText, extractCandidates } from '@/modules/extraction';
import type { LlmClient } from '@/modules/extraction/llm-client';
import type { ExtractedEntity, ExtractedRelationship } from '@/modules/shared/contracts';
import { ChronicleError } from '@/modules/shared/errors';

const entity = (name: string, type: ExtractedEntity['type'] = 'malware'): ExtractedEntity => ({
  type,
  name,
  confidence: 0.9,
  evidence: name,
});

const relationship = (
  source: string,
  target: string,
  type: ExtractedRelationship['type'] = 'uses',
): ExtractedRelationship => ({
  source,
  target,
  type,
  confidence: 1,
  evidence: 'uses',
});

const client = (overrides: Partial<LlmClient> = {}): LlmClient => ({
  extractEntities: vi.fn(async () => []),
  extractRelationships: vi.fn(async () => []),
  ...overrides,
});

describe('chunkReportText', () => {
  it('splits long text into chunks that respect the configured ceiling', () => {
    const chunks = chunkReportText('One sentence. Two sentence. '.repeat(200), 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  it('keeps short text as a single chunk', () => {
    expect(chunkReportText('Only one sentence here.', 120)).toEqual(['Only one sentence here.']);
  });

  it('hard-splits a single sentence longer than the ceiling at word boundaries', () => {
    const longSentence = `${'word '.repeat(60)}end.`;
    const chunks = chunkReportText(longSentence, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(longSentence.trim());
  });

  it('slices an unbroken token longer than the ceiling', () => {
    const chunks = chunkReportText('x'.repeat(500), 120);
    expect(chunks.length).toBe(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });
});

describe('extractCandidates', () => {
  it('merges entity results across chunks', async () => {
    const c = client({ extractEntities: vi.fn(async () => [entity('EvilBoat')]) });
    const merged = await extractCandidates('Short text.', c);
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0].name).toBe('EvilBoat');
  });

  it('deduplicates the same entity extracted from multiple chunks', async () => {
    const c = client({ extractEntities: vi.fn(async () => [entity('APT41', 'threat-actor')]) });
    const merged = await extractCandidates('First sentence. Second sentence.', c, { maxChars: 15 });
    expect(vi.mocked(c.extractEntities)).toHaveBeenCalledTimes(3);
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0].name).toBe('APT41');
  });

  it('merges a repeated entity across chunks through an alias', async () => {
    const calls = [
      [{ ...entity('APT41', 'threat-actor'), confidence: 1 }],
      [{ ...entity('Cozy Bear', 'threat-actor'), aliases: ['APT41'], confidence: 0.7 }],
    ];
    const c = client({
      extractEntities: vi.fn().mockImplementation(async () => calls.shift() ?? []),
    });
    const merged = await extractCandidates('First sentence. Second sentence.', c, { maxChars: 15 });
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0].name).toBe('APT41');
    expect(merged.entities[0].aliases).toContain('Cozy Bear');
  });

  it('skips the relationship pass when no entities were extracted', async () => {
    const c = client();
    const result = await extractCandidates('Short text.', c);
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(vi.mocked(c.extractRelationships)).not.toHaveBeenCalled();
  });

  it('runs the relationship pass against the merged entity set', async () => {
    const c = client({
      extractEntities: vi.fn(async () => [entity('EvilRAT')]),
      extractRelationships: vi.fn(async () => [relationship('APT41', 'EvilRAT')]),
    });
    const merged = await extractCandidates('Short text.', c);
    expect(merged.relationships).toHaveLength(1);
    expect(vi.mocked(c.extractRelationships)).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ name: 'EvilRAT' })]),
    );
  });

  it('deduplicates relationships repeated across chunks', async () => {
    const c = client({
      extractEntities: vi.fn(async () => [entity('APT41', 'threat-actor'), entity('EvilRAT')]),
      extractRelationships: vi.fn(async () => [relationship('APT41', 'EvilRAT')]),
    });
    const merged = await extractCandidates('First sentence. Second sentence.', c, { maxChars: 15 });
    expect(vi.mocked(c.extractRelationships)).toHaveBeenCalledTimes(3);
    expect(merged.relationships).toHaveLength(1);
  });

  it('retries a chunk after malformed output and eventually succeeds', async () => {
    const c = client({
      extractEntities: vi
        .fn()
        .mockRejectedValueOnce(new Error('malformed'))
        .mockResolvedValueOnce([entity('APT29', 'threat-actor')]),
    });
    const merged = await extractCandidates('Short text.', c);
    expect(vi.mocked(c.extractEntities)).toHaveBeenCalledTimes(2);
    expect(merged.entities[0].name).toBe('APT29');
  });

  it('propagates the last error after exhausting retries', async () => {
    const c = client({ extractEntities: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await expect(extractCandidates('Short text.', c)).rejects.toThrow('boom');
    expect(vi.mocked(c.extractEntities)).toHaveBeenCalledTimes(3);
  });

  it('backs off for a full minute window on rate limits instead of the sub-second retry loop', async () => {
    vi.useFakeTimers();
    try {
      const c = client({
        extractEntities: vi.fn(async () => Promise.reject(new ChronicleError('rate limited', 429))),
      });
      const attempt = extractCandidates('Short text.', c);
      attempt.catch(() => {});
      await vi.advanceTimersByTimeAsync(105_000);
      await expect(attempt).rejects.toThrow('rate limited');
      expect(vi.mocked(c.extractEntities)).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('truncates evidence to 60 characters', async () => {
    const c = client({
      extractEntities: vi.fn(async () => [{ ...entity('EvilRAT'), evidence: 'x'.repeat(200) }]),
      extractRelationships: vi.fn(async () => [
        { ...relationship('APT41', 'EvilRAT'), evidence: 'y'.repeat(200) },
      ]),
    });
    const merged = await extractCandidates('Short text.', c);
    expect(merged.entities[0].evidence).toHaveLength(60);
    expect(merged.relationships[0].evidence).toHaveLength(60);
  });
});
