import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

/** Commit the build was made from, shown by /api/health (deploy/release.sh builds from a clone). */
function release(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No page of the site is meant to be framed by another site.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Browsers only honour it over HTTPS, which Cloudflare terminates in production.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@vimchallenge/engine', '@vimchallenge/tasks'],
  // Types are checked by `npm run typecheck` at the repository root.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  env: { VC_RELEASE: release() },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
