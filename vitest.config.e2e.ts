import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    // e2e suites share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
