import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    // testcontainers integration tests can be slow to pull/boot an image.
    testTimeout: 120_000,
  },
});
