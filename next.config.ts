import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf'],
  output: 'standalone',
};

export default nextConfig;
