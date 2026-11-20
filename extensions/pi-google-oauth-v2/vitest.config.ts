import { defineConfig } from 'vitest/config';

const BRANCH_THRESHOLD = 80;

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    isolate: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { branches: BRANCH_THRESHOLD },
    },
  },
});
