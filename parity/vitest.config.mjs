import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['scripts/*.mjs'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
