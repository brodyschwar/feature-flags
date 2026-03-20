import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Run test files sequentially to prevent multiple MongoMemoryServer
    // instances competing for the binary lock file at startup.
    fileParallelism: false,
  },
});
