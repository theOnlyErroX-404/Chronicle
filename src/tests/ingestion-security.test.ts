import { describe, expect, it } from 'vitest';
import { isIP } from 'node:net';
import { resolveSafePublicUrl } from '@/modules/ingestion/security';

const stubResolver = (address: string) => async () => [{ address, family: isIP(address) }];
const publicIpResolver = stubResolver('93.184.216.34');
const resolve = (
  rawUrl: string,
  resolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>,
) => resolveSafePublicUrl(rawUrl, resolver).then(({ url }) => url);

describe('resolveSafePublicUrl', () => {
  it('rejects unsupported schemes', async () => {
    await expect(resolve('file:///etc/passwd')).rejects.toThrow('Only unauthenticated HTTP(S)');
    await expect(resolve('ftp://example.com/a')).rejects.toThrow('Only unauthenticated HTTP(S)');
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(resolve('https://user:pass@example.com/a')).rejects.toThrow(
      'Only unauthenticated HTTP(S)',
    );
  });

  it('rejects loopback and private hosts', async () => {
    await expect(resolve('https://127.0.0.1/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://10.0.0.5/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://169.254.169.254/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://192.168.1.1/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://[::1]/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://[fe80::1]/a')).rejects.toThrow(/not allowed/);
    // The full fe80::/10 link-local range, not just fe80 exact-match.
    await expect(resolve('https://[fe90::1:a:B]/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://[fea0::1]/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://[feb0::1]/a')).rejects.toThrow(/not allowed/);
  });

  it('rejects IPv4-mapped IPv6 forms of private addresses', async () => {
    await expect(resolve('https://[::ffff:127.0.0.1]/a')).rejects.toThrow(/not allowed/);
    await expect(resolve('https://[::ffff:10.1.2.3]/a')).rejects.toThrow(/not allowed/);
  });

  it('accepts a public host', async () => {
    await expect(resolve('https://example.com/report', publicIpResolver)).resolves.toBeInstanceOf(
      URL,
    );
  });

  it('rejects a hostname that resolves to a private address', async () => {
    await expect(
      resolve('https://intranet.example/report', stubResolver('10.1.2.3')),
    ).rejects.toThrow(/not allowed/);
    await expect(
      resolve('https://intranet.example/report', stubResolver('192.168.1.1')),
    ).rejects.toThrow(/not allowed/);
    await expect(
      resolve('https://intranet.example/report', stubResolver('fe80::1')),
    ).rejects.toThrow(/not allowed/);
  });

  it('rejects a host that cannot be resolved', async () => {
    await expect(
      resolve('https://missing.example/report', async () => {
        throw new Error('no such host');
      }),
    ).rejects.toThrow('could not be resolved');
  });
});
