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
    // §33.11.3's scan reads the shipped bundle, so one has to exist. Building
    // it here — before the worker pool — keeps `vite build` from competing with
    // the jsdom workers; see `vitest.global-setup.ts`.
    globalSetup: ['./vitest.global-setup.ts'],
    // Phase 23a’s sweep renders every principal flow, roughly tripling the
    // jsdom work in this project, and `npm test` runs it beside the backend's
    // Postgres suites. The handful of tests that render a whole surface — the
    // footer across all fourteen public routes, the §6 settings register, the
    // listing-payment record — sit near Vitest's 5s default and tip over it
    // when the machine is busy. They are slow because they render a lot, not
    // because anything is wrong, and a suite that fails on machine load is a
    // suite people stop believing.
    testTimeout: 30_000,
    // And capped, for the other half of the same problem. `npm test` runs this
    // project beside the backend's Postgres suites; unbounded workers had a
    // dozen jsdom+axe renders competing for the same cores, and a single axe
    // pass that takes 40ms alone took 24 seconds under that load — then left
    // axe-core mid-run, so the next assertions failed instantly and blamed the
    // page. Four workers is still parallel and is not a race.
    poolOptions: { threads: { maxThreads: 4 } },
    css: false,
  },
});
