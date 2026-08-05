import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Strict CSP: all app assets are same-origin files in the standalone build.
  // Applied in production only; next dev needs inline scripts for HMR.
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf'],
  output: 'standalone',
  ...(process.env.NODE_ENV === 'production'
    ? { headers: async () => [{ source: '/(.*)', headers: securityHeaders }] }
    : {}),
};

export default nextConfig;
