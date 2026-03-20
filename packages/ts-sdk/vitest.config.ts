import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@feature-flags/flag-evaluation": resolve(
        __dirname,
        "../flag-evaluation/src/index.ts"
      ),
    },
  },
  test: {
    globals: true,
  },
});
