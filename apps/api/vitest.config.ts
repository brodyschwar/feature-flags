import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the shared evaluation package to its TypeScript source so
      // tests don't require a prior build step.
      '@feature-flags/flag-evaluation': resolve(__dirname, '../../packages/flag-evaluation/src/index.ts'),
    },
  },
  test: {
    globals: true,
    // Run test files sequentially to prevent multiple MongoMemoryServer
    // instances competing for the binary lock file at startup.
    fileParallelism: false,
  },
});
