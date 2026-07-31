import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    name: 'backend',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    // Test files share one database and each runs the migrator on startup;
    // parallel files would race concurrent migrate() calls.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // URL.pathname yields "/C:/…" on Windows; fileURLToPath is portable.
      '@proovd/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
