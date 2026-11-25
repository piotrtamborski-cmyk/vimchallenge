import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@vimchallenge/engine', '@vimchallenge/tasks'],
  // Types are checked by `npm run typecheck` at the repository root.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
};

export default config;
