import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],

    // Fixtures start real Pi sessions and child processes. Unloaded, with ten workers in parallel, the slowest
    // default-budget test already takes 4.3 s of the 5 s default (integration fixture teardown), so a loaded machine
    // fails tests that are correct. 30 s matches the explicit budgets the process tests set. Waits inside tests stay
    // on observable conditions.
    testTimeout: 30000,
    hookTimeout: 30000,

    // Vitest 5 already defaults clearMocks to true.
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
