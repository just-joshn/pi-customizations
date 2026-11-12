import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    isolate: true,
    testTimeout: 60_000,
    globalSetup: ['tests/global-tmux.ts'],
    env: { PSTACK_TMUX_SOCKET: `pstack-test-run-${process.pid}` },
    exclude: [...configDefaults.exclude, 'automations/**', 'docs/**', 'vendor/**', 'generated/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
