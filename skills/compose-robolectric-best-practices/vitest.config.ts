import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Each Gradle build compiles and runs Robolectric tests; a cold one takes minutes.
    hookTimeout: 1_200_000,
    coverage: {
      provider: 'v8',
      include: ['tests/support/**/*.ts'],
    },
  },
});
