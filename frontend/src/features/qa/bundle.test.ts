/**
 * The built bundle — Spec §33.11.3, §3.2 (Phase 23a).
 *
 * Phase 23's own trap: "grep the built bundle, not the source. Banned
 * vocabulary hides in generated strings and template literals." A source grep
 * misses a register imported from `@proovd/shared`, a string assembled from
 * two halves, and anything a dependency ships — and the bundle is what a person
 * actually receives.
 *
 * What is scanned here is §3.2's half of the naming contract: `pledge`,
 * `escrow`, `all-or-nothing`, `custody`. Those bind every audience *including*
 * internal names, log lines, and identifiers, so scanning the whole bundle is
 * exactly right — and this is the check that found `all-or-nothing` sitting in
 * a §22.8 register's description, shipped to every browser and invisible to
 * every source grep of `frontend/`.
 *
 * §3.1's internal names are deliberately NOT scanned here. `reservation` and
 * `affiliate` are permitted in the Admin panel — that is the table an Admin is
 * reading the ledger against — and one bundle carries both the Admin panel and
 * the Backer's page, so a bundle-wide scan for them would flag correct copy and
 * have to be silenced. They are checked in `qa.test.tsx` against the *rendered
 * text* of every customer-facing flow instead, which is the stronger check.
 * `BUNDLE_SCAN_SCOPE` states this split where both halves can see it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UNIVERSALLY_BANNED_TERMS, isReadableCopy, BUNDLE_SCAN_SCOPE } from '@proovd/shared';

const FRONTEND = resolve(__dirname, '../../..');
const DIST = join(FRONTEND, 'dist');

/**
 * Reads the bundle `vitest.global-setup.ts` built before the workers started.
 * The build lives there rather than here so it cannot compete with the jsdom
 * workers — and a missing `dist/` is a loud failure rather than a skip, because
 * a scan that quietly does not run is worse than no scan.
 */
function readBundle(): string {
  const assets = join(DIST, 'assets');
  if (!existsSync(assets)) {
    throw new Error(
      'frontend/dist is missing — vitest.global-setup.ts should have built it before this ran.',
    );
  }
  const parts = readdirSync(assets)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => readFileSync(join(assets, name), 'utf8'));
  parts.push(readFileSync(join(DIST, 'index.html'), 'utf8'));
  return parts.join('\n');
}

let bundle = '';

beforeAll(() => {
  bundle = readBundle();
});

describe('§33.11.3 — the shipped bundle', () => {
  it('is the real build, not an empty file', () => {
    expect(bundle.length).toBeGreaterThan(100_000);
    // A sanity anchor: copy that must be in there.
    expect(bundle).toContain('Proovd');
  });

  it.each(Object.entries(UNIVERSALLY_BANNED_TERMS))(
    'contains no §3.2 %s anywhere',
    (term, definition) => {
      const hits = [...bundle.matchAll(new RegExp(definition.pattern.source, 'gi'))].map(
        (match) => bundle.slice(Math.max(0, match.index - 90), match.index + 90),
      );
      expect(
        hits,
        `${term} (${definition.specRef}) → ${definition.replacement}`,
      ).toEqual([]);
    },
  );

  it('states which half of §3 a bundle scan can decide', () => {
    // The reasoning above, kept where a reader of the register meets it too.
    expect(BUNDLE_SCAN_SCOPE.universal).toContain('§3.2');
    expect(BUNDLE_SCAN_SCOPE.customerOnly).toContain('§3.1');
  });

  it('carries readable copy a scan can decide, and not only identifiers', () => {
    // `isReadableCopy` is what makes the scan above a scan of *copy* rather
    // than of a minified module graph. This asserts it finds real sentences in
    // the real bundle, so a change that broke it would fail here rather than
    // silently turning the §3.2 check into a check of nothing.
    const literals = [...bundle.matchAll(/"((?:[^"\\\n]|\\.){12,240})"/g)]
      .map((match) => match[1] ?? '')
      .filter(isReadableCopy);
    expect(literals.length).toBeGreaterThan(50);

    // An unresolved *marker* is deliberately not checked here, and the reason
    // is worth stating: the bundle contains §20's and the Appendices' templates
    // — `Campaign ends [LOCAL CLOSE]`, `No change since [DATE]` — beside the
    // code that resolves them. A bracket in the bundle is therefore a template,
    // not a defect, and only a *rendered* surface can tell the two apart. That
    // check lives in `qa.test.tsx`, against the DOM, where the answer is real.
  });
});
