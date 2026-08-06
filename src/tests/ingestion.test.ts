import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingestReport } from '@/modules/ingestion';
import { fetchPinned } from '@/modules/ingestion/transport';
import { ensureUsableText, normalizeText } from '@/modules/ingestion/text';

vi.mock('@/modules/ingestion/security', () => ({
  resolveSafePublicUrl: vi.fn(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: '93.184.216.34', family: 4 }],
  })),
}));

vi.mock('@/modules/ingestion/transport', () => ({ fetchPinned: vi.fn() }));

const htmlReport =
  '<html><body><script>bad()</script><h1>APT41 used EvilBoat.</h1><p>The group targeted Ukrainian energy companies and exfiltrated sensitive data to 198.51.100.7.</p>&nbsp;Sector: banking&nbsp;<style>p{color:red}</style></body></html>';

const response = (
  body: string | Uint8Array<ArrayBuffer>,
  contentType: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(body instanceof Uint8Array ? body : new TextEncoder().encode(body), {
    status,
    headers: { 'content-type': contentType, ...extraHeaders },
  });

const fixture = (): Uint8Array<ArrayBuffer> => {
  const raw = readFileSync(new URL('./fixtures/minimal.pdf', import.meta.url));
  const out = new Uint8Array(raw.byteLength);
  out.set(raw);
  return out;
};

describe('URL report ingestion', () => {
  afterEach(() => {
    vi.mocked(fetchPinned).mockReset();
  });

  it('fetches an HTML report and returns normalized text', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(response(htmlReport, 'text/html; charset=utf-8'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/report.html' });
    expect(text).toContain('APT41 used EvilBoat');
    expect(text).toContain('Sector: banking');
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('&nbsp;');
  });

  it('fetches a plain-text report', async () => {
    const body =
      'APT29 used SLUI in Ukraine. The campaign targeted NATO member states and exploited a zero-day in Outlook 2026.';
    vi.mocked(fetchPinned).mockResolvedValue(response(body, 'text/plain'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/report.txt' });
    expect(text).toContain('APT29 used SLUI');
  });

  it('rejects a URL whose content type is neither text nor PDF with 415', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(response('garbage', 'application/octet-stream'));
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/report.bin' }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects a PDF fetched by URL but parses it through the worker', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(response(fixture(), 'application/pdf'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/report.pdf' });
    expect(text).toContain('APT41 used EvilBoat');
  });

  it('parses a PDF when the URL path ends in .pdf despite a text content type', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(response(fixture(), 'text/html'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/whitepaper.PDF' });
    expect(text).toContain('APT41 used EvilBoat');
  });

  it('classifies a fetch failure as 502', async () => {
    vi.mocked(fetchPinned).mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/report.txt' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('retries a transient fetch failure and succeeds on the second attempt', async () => {
    vi.mocked(fetchPinned)
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockResolvedValueOnce(response(htmlReport, 'text/html'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/report.html' });
    expect(text).toContain('APT41 used EvilBoat');
    expect(vi.mocked(fetchPinned)).toHaveBeenCalledTimes(2);
  });

  it('gives up after all retries fail (bounded, still 502)', async () => {
    vi.mocked(fetchPinned).mockRejectedValue(new TypeError('ECONNRESET'));
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/report.txt' }),
    ).rejects.toMatchObject({ status: 502 });
    expect(vi.mocked(fetchPinned).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('propagates a non-ok HTTP status as 502', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(response('nope', 'text/plain', 500));
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/report.txt' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('follows a redirect and rejects when the redirect cap is exceeded', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(
      response('', 'text/plain', 302, { location: 'https://example.com/next' }),
    );
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/report.txt' }),
    ).rejects.toThrow('redirected too many times');
  });

  it('enforces the size limit from the content-length header with 413', async () => {
    vi.mocked(fetchPinned).mockResolvedValue(
      response('x', 'text/plain', 200, { 'content-length': String(1024 * 1024 * 1024) }),
    );
    await expect(
      ingestReport({ kind: 'url', url: 'https://example.com/huge.txt' }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('truncates extracted text at the configured character cap', async () => {
    const longBody = 'word '.repeat(60_000);
    vi.mocked(fetchPinned).mockResolvedValue(response(longBody, 'text/plain'));
    const text = await ingestReport({ kind: 'url', url: 'https://example.com/long.txt' });
    expect(text.length).toBe(250_000);
  });
});

describe('text normalization', () => {
  it('strips scripts, styles, tags, entities, and collapses whitespace', () => {
    expect(normalizeText('  a\n  b\t c <style>x</style> <noscript>y</noscript> &nbsp; &amp;')).toBe(
      'a b c &',
    );
  });

  it('strips script blocks with attributes or whitespace before the closing >', () => {
    expect(normalizeText('<script type="text/javascript">alert(1)</script >')).toBe('');
    expect(normalizeText('x<script>alert(1)</script foo="bar">y')).toBe('x y');
  });

  it('rejects reports with too little extractable text', () => {
    expect(() => ensureUsableText('too short')).toThrow('did not contain enough extractable text');
    expect(ensureUsableText('x'.repeat(100)).length).toBe(100);
  });

  it('raises a 422 (not a 500) for reports with too little extractable text', () => {
    try {
      ensureUsableText('too short');
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        type: 'https://chronicle.local/problems/insufficient-text',
      });
    }
  });
});
