import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'backend',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@proovd/shared': resolve(new URL('.', import.meta.url).pathname, '../shared/src/index.ts'),
    },
  },
});
