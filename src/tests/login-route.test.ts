import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/v1/auth/login/route';

const mockConfig = vi.hoisted(() => ({ apiToken: 'secret' as string | undefined }));
vi.mock('@/lib/config', () => ({ config: mockConfig }));

const login = () =>
  new Request('http://chronicle.local/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'wrong-token' }),
  });

describe('POST /api/v1/auth/login', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects wrong tokens with 401 and throttles to 429 after 10 attempts in a minute', async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await POST(login());
      expect(response.status).toBe(401);
    }
    const throttled = await POST(login());
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toMatchObject({
      type: 'https://chronicle.local/problems/rate-limited',
    });

    // The sliding window resets after a minute, so a brute force cannot spread
    // the same 10 attempts endlessly; a fresh minute allows new attempts.
    vi.setSystemTime(Date.now() + 61_000);
    const afterWindow = await POST(login());
    expect(afterWindow.status).toBe(401);
  });
});
