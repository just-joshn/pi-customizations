import { defineConfig } from 'vitest/config';

const COLD_GRADLE_ROBOLECTRIC_BUILD_MS = 1_200_000;

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    hookTimeout: COLD_GRADLE_ROBOLECTRIC_BUILD_MS,
    coverage: {
      provider: 'v8',
      include: ['tests/support/**/*.ts'],
    },
  },
});
