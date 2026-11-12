import { configDefaults, defineConfig } from 'vitest/config';

// The upstream statechart suite has tests that signal a command inside a window of tens of milliseconds, so it runs
// as the last group, with none of this package's other test files running beside it.
const EXCLUSIVE = 'tests/packaging/statechart-suite.test.ts';

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
    projects: [
      { extends: true, test: { name: 'parallel', exclude: [...configDefaults.exclude, 'automations/**', 'docs/**', 'vendor/**', 'generated/**', EXCLUSIVE], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'exclusive', include: [EXCLUSIVE], sequence: { groupOrder: 1 } } },
    ],
  },
});
