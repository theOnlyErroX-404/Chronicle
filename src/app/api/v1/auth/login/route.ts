import { config } from '@/lib/config';
import { SESSION_COOKIE, verifyApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { readStreamWithLimit } from '@/modules/shared/stream';

export const runtime = 'nodejs';

// Browser login: the operator enters the static API token once, the server
// verifies it (constant-time) and hands it back as an HttpOnly session cookie.
// HttpOnly + SameSite=Strict keeps the token out of reach of injected scripts
// and cross-site requests; the API token itself never changes.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(request: Request) {
  try {
    if (!config.apiToken) throw new ChronicleError('Server authentication is not configured.', 503);
    const rawBody = await readStreamWithLimit(
      request.body,
      16 * 1024,
      'The request body exceeds the size limit.',
    );
    let body: { token?: unknown };
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      throw new ChronicleError('The request body must be valid JSON.', 400);
    }
    if (typeof body.token !== 'string' || !verifyApiToken(body.token)) {
      throw new ChronicleError(
        'Invalid token.',
        401,
        'https://chronicle.local/problems/unauthorized',
      );
    }
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return new Response(null, {
      status: 204,
      headers: {
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(
          body.token,
        )}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
      },
    });
  } catch (error) {
    return problemResponse(error);
  }
}
