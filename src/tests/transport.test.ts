import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPinned } from '@/modules/ingestion/transport';
import type { SafePublicUrl } from '@/modules/ingestion/security';

describe('fetchPinned (DNS pinning)', () => {
  let server: Server;
  let port: number;
  let seen: { host?: string; url?: string };

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen = { host: req.headers.host, url: req.url };
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello from pinned address');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects to the validated address, not a re-resolved hostname', async () => {
    // The hostname deliberately does not exist in DNS: the connection still
    // reaches the server, proving no second DNS lookup happens after pinning.
    const target: SafePublicUrl = {
      url: new URL(`http://public.example:${port}/report`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    };
    const response = await fetchPinned(target, 5_000);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello from pinned address');
    expect(seen.url).toBe('/report');
    expect(seen.host).toBe(`public.example:${port}`);
  });

  it('rejects when the connection cannot be established to the pinned address', async () => {
    const target: SafePublicUrl = {
      url: new URL(`http://public.example:1/report`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    };
    await expect(fetchPinned(target, 2_000)).rejects.toBeInstanceOf(Error);
  });

  it('preserves repeated response headers', async () => {
    const multi = createServer((_req, res) => {
      res.setHeader('x-tag', ['one', 'two']);
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => multi.listen(0, '127.0.0.1', resolve));
    const multiPort = (multi.address() as { port: number }).port;
    try {
      const target: SafePublicUrl = {
        url: new URL(`http://public.example:${multiPort}/`),
        addresses: [{ address: '127.0.0.1', family: 4 }],
      };
      const response = await fetchPinned(target, 5_000);
      expect(response.headers.get('x-tag')).toBe('one, two');
    } finally {
      await new Promise<void>((resolve) => multi.close(() => resolve()));
    }
  });

  it('aborts the request when the timeout elapses', async () => {
    const slow = createServer(() => {
      // Never respond; the abort must tear the request down.
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const slowPort = (slow.address() as { port: number }).port;
    try {
      const target: SafePublicUrl = {
        url: new URL(`http://public.example:${slowPort}/x`),
        addresses: [{ address: '127.0.0.1', family: 4 }],
      };
      await expect(fetchPinned(target, 30)).rejects.toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });
});
