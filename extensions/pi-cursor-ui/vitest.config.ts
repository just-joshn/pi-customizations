import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { FORCE_COLOR: '3' },

    // The fuzz suite renders 5000-line expanded results across every width. Under
    // v8 coverage on a loaded machine those few cases need more than the 5s default.
    testTimeout: 30_000,

    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,

    expect: {
      requireAssertions: true,
    },

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
