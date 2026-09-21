import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
