import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',

    globals: false,

    pool: 'forks',
    isolate: true,

    exclude: [...configDefaults.exclude, 'dist/**'],

    coverage: {
      provider: 'v8',
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },

      include: ['parity/**/*.ts'],

      exclude: ['parity/**/*.d.ts', 'parity/**/*.{test,spec}.ts', 'parity/**/__tests__/**'],
    },
  },
});
