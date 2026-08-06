import { requireApiToken } from '@/modules/shared/auth';
import { problemResponse } from '@/modules/shared/errors';

export const runtime = 'nodejs';

// Explicit session probe for the workbench: 200 when the cookie/header
// authenticates, 401 otherwise (AUDIT-14 — the previous 404-on-missing-route
// probe reported a session even when logged out).
export async function GET(request: Request) {
  try {
    requireApiToken(request);
    return Response.json({ ok: true });
  } catch (error) {
    return problemResponse(error);
  }
}
