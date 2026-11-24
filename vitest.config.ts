import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts', 'packages/vim-core/test-fork/**/*.test.ts'] } });
