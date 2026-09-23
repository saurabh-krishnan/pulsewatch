import { defineConfig } from 'vitest/config';

// Test projects live in vitest.workspace.ts. This file holds the options that
// apply across all of them.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**'],
      exclude: ['packages/shared/src/**/*.test.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
