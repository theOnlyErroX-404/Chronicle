import { timingSafeEqual } from 'node:crypto';
import { config } from '@/lib/config';
import { ChronicleError } from '@/modules/shared/errors';

const safeEqual = (a: string, b: string) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first; the
  // early return leaks only the length, never the contents.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

// Session cookie name for browser clients. The cookie holds the same static
// token the Authorization header carries, but as an HttpOnly cookie it is
// invisible to injected scripts — the localStorage token storage it replaces
// was readable by any XSS and flagged by CodeQL (CWE-312/CWE-315).
export const SESSION_COOKIE = 'chronicle_session';

export const verifyApiToken = (presented: string | null | undefined): boolean =>
  Boolean(config.apiToken && presented && safeEqual(presented, config.apiToken));

const cookieValue = (request: Request, name: string): string | null => {
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
};

export const requireApiToken = (request: Request) => {
  // Local setup remains frictionless; deployed instances must define a token.
  if (!config.apiToken) {
    if (process.env.NODE_ENV === 'production') {
      throw new ChronicleError('Server authentication is not configured.', 503);
    }
    return;
  }

  // Browser sessions present the token as an HttpOnly cookie; API/CLI clients
  // keep using the Authorization header. Both go through the same constant-time
  // comparison, so neither path can be shortcut.
  const presented =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    cookieValue(request, SESSION_COOKIE);
  if (!verifyApiToken(presented)) {
    throw new ChronicleError(
      'A valid bearer token is required.',
      401,
      'https://chronicle.local/problems/unauthorized',
    );
  }
};
