import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Frontend runs in jsdom. proovd-motion.js is a <script> in index.html and is
// never imported, so window.Proovd is absent in tests — components must stay
// fully functional with the motion runtime null (DNA §6.6). Tests assert
// semantics, roles, labels, and keyboard paths (Spec §33.11.2), not motion.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@proovd/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    name: 'frontend',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
  },
});
