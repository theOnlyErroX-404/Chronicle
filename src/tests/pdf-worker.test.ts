import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ingestReport, parsePdfInWorker } from '@/modules/ingestion';

const fixture = (): Uint8Array => {
  const raw = readFileSync(new URL('./fixtures/minimal.pdf', import.meta.url));
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
};

describe('PDF ingestion (worker-thread isolation)', () => {
  it('parses a valid PDF through the worker and returns its text', async () => {
    const text = await ingestReport({ kind: 'pdf', filename: 'minimal.pdf', bytes: fixture() });
    expect(text).toContain('APT41 used EvilBoat');
    expect(text.length).toBeGreaterThanOrEqual(100);
  });

  it('rejects bytes that are not a PDF header', async () => {
    await expect(
      ingestReport({
        kind: 'pdf',
        filename: 'fake.pdf',
        bytes: new TextEncoder().encode('not a pdf at all'),
      }),
    ).rejects.toThrow('The uploaded file is not a valid PDF.');
  });

  it('rejects a fake header whose body fails to parse with 422', async () => {
    const junk = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(2000));
    await expect(
      ingestReport({ kind: 'pdf', filename: 'junk.pdf', bytes: junk }),
    ).rejects.toMatchObject({
      name: 'ChronicleError',
      status: 422,
      type: 'https://chronicle.local/problems/pdf-parse-failed',
    });
  });

  it('terminates the worker and fails with 422 when parsing exceeds the timeout', async () => {
    await expect(parsePdfInWorker(fixture(), 1)).rejects.toMatchObject({
      name: 'ChronicleError',
      status: 422,
      type: 'https://chronicle.local/problems/pdf-parse-failed',
    });
  });
});
