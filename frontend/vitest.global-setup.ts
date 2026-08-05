/**
 * Builds the production bundle once, before any test worker starts — Spec
 * §33.11.3 (Phase 23a).
 *
 * The bundle scan reads what actually ships rather than the source, so a build
 * has to happen. Doing it *inside* a test file put a `vite build` alongside the
 * jsdom workers and starved them: three unrelated suites timed out at five
 * seconds while the build held the CPU, which is a flaky suite blaming the
 * wrong file. Global setup runs before the pool exists, so the build competes
 * with nothing and every worker sees a finished `dist/`.
 *
 * It is skipped when the bundle is already newer than every source file, so the
 * common case — running the suite twice without editing — costs nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = join(FRONTEND, 'dist', 'assets');

function newestSourceTime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestSourceTime(path) : statSync(path).mtimeMs,
    );
  }
  return newest;
}

function bundleTime(): number {
  if (!existsSync(DIST_ASSETS)) return 0;
  return readdirSync(DIST_ASSETS)
    .map((name) => statSync(join(DIST_ASSETS, name)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0);
}

export async function setup(): Promise<void> {
  const sources = Math.max(
    newestSourceTime(join(FRONTEND, 'src')),
    newestSourceTime(resolve(FRONTEND, '../shared/src')),
  );
  if (bundleTime() >= sources) return;

  execFileSync('npx', ['vite', 'build'], {
    cwd: FRONTEND,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
