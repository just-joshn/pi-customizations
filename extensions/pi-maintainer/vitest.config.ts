import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',

    // Vitest 5 already defaults clearMocks to true.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,

    expect: {
      requireAssertions: true,
    },

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'index.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
