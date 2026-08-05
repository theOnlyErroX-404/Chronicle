import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import type { LookupAddress } from 'node:dns';
import type { SafePublicUrl } from '@/modules/ingestion/security';

const USER_AGENT = 'Chronicle-ThreatGraph/0.1 (report ingestion)';

// Resolver that discards the (attacker-controlled) hostname and returns only
// the addresses that already passed the public-IP validation. The connection is
// therefore made directly to a validated IP — no second DNS resolution, so a
// rebind after validation cannot point the request at a private address.
const pinnedLookup =
  (addresses: LookupAddress[]): LookupFunction =>
  (hostname, options, callback) => {
    const family = typeof options.family === 'number' ? options.family : undefined;
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (options.all) {
      callback(null, candidates);
      return;
    }
    const first = candidates[0];
    if (!first) {
      callback(
        new Error(`No pinned address available for ${hostname}.`) as NodeJS.ErrnoException,
        '',
      );
      return;
    }
    callback(null, first.address, first.family);
  };

const toWebResponse = (incoming: IncomingMessage): Response => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
  }
  const body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array<ArrayBuffer>>;
  return new Response(body, { status: incoming.statusCode ?? 0, headers });
};

// One pinned HTTP(S) request: connect directly to the validated addresses with
// the hostname kept only for TLS SNI and certificate verification. No connection
// reuse, so a request never lands on a socket established against a different
// host, and a wall-clock abort bounds the whole exchange.
export const fetchPinned = (target: SafePublicUrl, timeoutMs: number): Promise<Response> =>
  new Promise((resolve, reject) => {
    const { url, addresses } = target;
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const signal = AbortSignal.timeout(timeoutMs);
    const request = transport(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        lookup: pinnedLookup(addresses),
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        signal,
        agent: false,
      },
      (incoming) => {
        signal.removeEventListener('abort', onAbort);
        resolve(toWebResponse(incoming));
      },
    );
    const onAbort = () => request.destroy(new Error('The report URL request timed out.'));
    signal.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    request.end();
  });
