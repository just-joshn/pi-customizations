import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    isolate: true,
    testTimeout: 60_000,
    exclude: [...configDefaults.exclude, 'skills/**', 'automations/**', 'docs/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
