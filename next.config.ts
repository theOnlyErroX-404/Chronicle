import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // CSP honoring Next.js's needs: the framework emits inline bootstrap
  // `<script>self.__next_f.push(...)</script>` and inline `<style>` tags, so
  // 'unsafe-inline' is required (strictest viable policy; nonce-based CSP is
  // the upgrade path if hard-tier isolation is ever wanted).
  // Applied in production only; next dev needs inline scripts for HMR.
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
      "frame-ancestors 'none'; form-action 'self'",
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
