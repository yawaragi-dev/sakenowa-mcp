import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    // testcontainers integration tests can be slow to pull/boot an image.
    // `hookTimeout` (not just `testTimeout`) must be raised: container
    // startup happens in `beforeAll`, a hook, which otherwise uses vitest's
    // 10s default and times out when a suite pays the image-pull cost.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
