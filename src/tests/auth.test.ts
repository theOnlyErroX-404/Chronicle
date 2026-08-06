import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireApiToken } from '@/modules/shared/auth';

// Mutable holder so each test can flip the configured token.
const mockConfig = vi.hoisted(() => ({ apiToken: undefined as string | undefined }));
vi.mock('@/lib/config', () => ({ config: mockConfig }));

const request = (authorization?: string) =>
  new Request('http://chronicle.local/api/v1/reports', {
    headers: authorization ? { authorization } : undefined,
  });

const caught = (action: () => void): unknown => {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('requireApiToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes through in non-production when no token is configured', () => {
    mockConfig.apiToken = undefined;
    expect(() => requireApiToken(request())).not.toThrow();
  });

  it('fails closed in production when no token is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockConfig.apiToken = undefined;
    expect(caught(() => requireApiToken(request()))).toMatchObject({ status: 503 });
  });

  it('rejects a missing Authorization header with 401', () => {
    mockConfig.apiToken = 'secret';
    expect(caught(() => requireApiToken(request()))).toMatchObject({
      status: 401,
      type: 'https://chronicle.local/problems/unauthorized',
    });
  });

  it('rejects a wrong token with 401', () => {
    mockConfig.apiToken = 'secret';
    expect(caught(() => requireApiToken(request('Bearer wrong')))).toMatchObject({ status: 401 });
  });

  it('rejects a header that is not a bearer token with 401', () => {
    mockConfig.apiToken = 'secret';
    expect(caught(() => requireApiToken(request('Basic dXNlcjpwYXNz')))).toMatchObject({
      status: 401,
    });
  });

  it('accepts a matching bearer token', () => {
    mockConfig.apiToken = 'secret';
    expect(() => requireApiToken(request('Bearer secret'))).not.toThrow();
  });

  it('accepts a case-insensitive bearer scheme', () => {
    mockConfig.apiToken = 'secret';
    expect(() => requireApiToken(request('bearer secret'))).not.toThrow();
  });

  it('rejects a malformed session cookie with 401 instead of throwing', () => {
    mockConfig.apiToken = 'secret';
    const req = new Request('http://chronicle.local/api/v1/reports', {
      headers: { cookie: 'chronicle_session=not%zzescaped' },
    });
    expect(caught(() => requireApiToken(req))).toMatchObject({ status: 401 });
  });

  it('accepts a well-formed session cookie', () => {
    mockConfig.apiToken = 'secret';
    const req = new Request('http://chronicle.local/api/v1/reports', {
      headers: { cookie: `chronicle_session=${encodeURIComponent('secret')}` },
    });
    expect(() => requireApiToken(req)).not.toThrow();
  });
});
