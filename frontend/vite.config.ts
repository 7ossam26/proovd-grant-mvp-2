import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],

  // frontend/public/ is served verbatim — GSAP vendor files, proovd.css, and
  // proovd-motion.js must not be bundled or transformed (DNA §6.7).
  publicDir: 'public',

  build: {
    outDir: 'dist',
  },

  resolve: {
    alias: {
      '@proovd/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },

  server: {
    port: 5173,
    // In development, proxy /api/* and /healthz to the backend.
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
