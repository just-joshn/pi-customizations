import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',

    globals: false,

    pool: 'forks',
    isolate: true,

    exclude: [
      ...configDefaults.exclude,
      'dist/**',
    ],

    coverage: {
      provider: 'v8',

      include: [
        'src/**/*.ts',
      ],

      exclude: [
        'src/**/*.d.ts',
        'src/**/*.{test,spec}.ts',
        'src/**/__tests__/**',
      ],
    },
  },
})