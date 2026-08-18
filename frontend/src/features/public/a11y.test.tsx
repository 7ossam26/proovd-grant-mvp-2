/**
 * Accessibility acceptance for the public site — Spec §28.5, §33.11.1,
 * §33.11.2.
 *
 * §33.11 makes accessibility a mandatory acceptance test, not a polish pass.
 * What can be proved in jsdom is proved here: axe on every one of §18's
 * fourteen routes, a complete keyboard path into the content, heading
 * structure, landmark structure, and accessible names on every control.
 *
 * What cannot be proved here — 320px reflow, real focus visibility, 44px tap
 * targets, and an actual screen-reader pass — is a manual gate. §33.11.1 asks
 * for all four, and this file is not a substitute for any of them; the 44px
 * minimum is carried by `--touch` in `proovd.css`, which has no layout in
 * jsdom to measure.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { axe } from 'jest-axe';
import userEvent from '@testing-library/user-event';
import { renderRoute } from './test-harness.js';
import { PUBLIC_ROUTE_PATHS } from './site.js';

describe('§33.11.1 — axe on every public route', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s has no automatically detectable violation', async (path) => {
    const { container } = renderRoute(path);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the not-found surface has none either', async () => {
    const { container } = renderRoute('/no-such-page');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('§33.11.1 — the keyboard path reaches the content', () => {
  it('opens the tab order with a skip link that targets the main landmark', async () => {
    const user = userEvent.setup();
    const { container } = renderRoute('/');

    await user.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.className).toContain('skip-link');
    expect(focused).toHaveAttribute('href', '#main');
    expect(container.querySelector('#main')).not.toBeNull();
  });

  it('reaches the header navigation and the footer links by keyboard', async () => {
    const user = userEvent.setup();
    const { container } = renderRoute('/');
    const focusable = [
      ...container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ];
    expect(focusable.length).toBeGreaterThan(10);

    // Every one of them is reachable and carries an accessible name.
    for (const element of focusable) {
      expect(
        (element.textContent ?? '').trim().length > 0 ||
          element.hasAttribute('aria-label'),
        `unnamed control: ${element.outerHTML.slice(0, 80)}`,
      ).toBe(true);
    }

    await user.tab();
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('moves focus into the new page on navigation', async () => {
    const user = userEvent.setup();
    const { container, findByRole } = renderRoute('/');
    await user.click(container.querySelector('a[href="/safety"]') as HTMLElement);
    await findByRole('heading', { level: 1, name: /reviewed by a person/i });
    expect((document.activeElement as HTMLElement)?.id).toBe('main');
  });
});

describe('§33.11.2 — structure a screen reader can navigate', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s has one h1 and no skipped heading level', (path) => {
    const { container } = renderRoute(path);
    const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    const levels = headings.map((h) => Number(h.tagName[1]));

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0], `${path} does not open with its h1`).toBe(1);

    let previous = 1;
    for (const level of levels) {
      expect(level - previous, `${path} skips from h${previous} to h${level}`).toBeLessThanOrEqual(1);
      previous = level;
    }
  });

  it.each(PUBLIC_ROUTE_PATHS)('%s exposes banner, main, and footer landmarks', (path) => {
    const { container } = renderRoute(path);
    expect(container.querySelector('header.site-header')).not.toBeNull();
    expect(container.querySelector('main#main')).not.toBeNull();
    expect(container.querySelector('footer.site-footer')).not.toBeNull();
    // Each nav is named, so "navigation" is never ambiguous in a landmark list.
    for (const nav of container.querySelectorAll('nav')) {
      expect(
        nav.hasAttribute('aria-label') || nav.hasAttribute('aria-labelledby'),
        `unnamed nav on ${path}`,
      ).toBe(true);
    }
  });

  it('gives every image an accessible name (§28.5)', () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const { container, unmount } = renderRoute(path);
      for (const image of container.querySelectorAll('img')) {
        expect(image.hasAttribute('alt'), `${path}: <img> without alt`).toBe(true);
      }
      unmount();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The stylesheet itself — Founder Flow v2, Session C
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Two ways `proovd.css` can be silently wrong, and both have now happened.
 *
 * Session B shipped a comment containing `*​/` inside it, which ENDS the comment
 * — so the whole `PHASE 34` token block parsed as garbage and every page in the
 * flow rendered at browser-default type. Session C shipped `gap: var(--sp-20)`
 * against a scale that has no `--sp-20`, so the declaration was invalid and the
 * gap collapsed to zero on the one screen with the most stacked prose in it.
 *
 * Neither is visible to jsdom, to axe, or to the type checker: the markup is
 * correct, the accessible names are correct, and the build succeeds. Only a
 * screenshot showed them — which is the right way to find one of them and a
 * ridiculous way to find the second one twice. These two scans are cheap and
 * they run on every commit.
 */
describe('proovd.css parses as its author intended', () => {
  const css = readFileSync(
    path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'public', 'proovd.css'),
    'utf8',
  );

  it('closes every comment exactly once', () => {
    // A `*` followed by `/` inside a comment closes it early, and everything
    // after it up to the next `*/` is parsed as declarations. The depth never
    // rises above 1 and ends at 0, or something is unbalanced.
    let depth = 0;
    let index = 0;
    let maxDepth = 0;
    while (index < css.length) {
      if (css.startsWith('/*', index)) {
        depth += 1;
        maxDepth = Math.max(maxDepth, depth);
        index += 2;
        continue;
      }
      if (css.startsWith('*/', index)) {
        depth -= 1;
        expect(depth, `a comment closed that was never opened, near char ${index}`).toBeGreaterThanOrEqual(0);
        index += 2;
        continue;
      }
      index += 1;
    }
    expect(depth, 'an unclosed comment swallows the rest of the file').toBe(0);
    expect(maxDepth, 'CSS comments do not nest, so a depth above 1 means one closed early').toBe(1);
  });

  /*
   * The two token scans read the file with comments STRIPPED, and the
   * comment-balance one above deliberately does not.
   *
   * This file explains, at length, which tokens it deliberately does not
   * define and which mistyped one caused which defect. A scan that could not
   * tell an explanation from a usage would force those explanations out, and
   * the reasoning is the more valuable half — `backend/src/notifications` makes
   * the same split for the same reason. The very first version of this test
   * failed on its own comment naming `var(--paper)`.
   */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses no spacing token the scale does not define', () => {
    const defined = new Set([...css.matchAll(/--sp-(\d+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...code.matchAll(/var\(--sp-(\d+)\)/g)].map((m) => m[1]));
    const missing = [...used].filter((token) => !defined.has(token));
    expect(missing, `var(--sp-N) with no --sp-N in the scale: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses no colour, radius, or motion token the file does not define', () => {
    /*
     * The same failure in the other custom-property families. `var(--x)` with
     * no `--x` is not an error anywhere — the declaration is simply dropped —
     * so a mistyped token is a rule that quietly does nothing.
     *
     * `var(--x, fallback)` is EXEMPT, and the distinction is the point: a
     * property a component sets inline (`--track`, `--sweep`, `--p`) is
     * deliberately undefined in this file and carries its own default. A
     * property with no fallback and no definition is a typo, which is how
     * `.cr-file` came to have no background at all.
     */
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set(
      [...code.matchAll(/var\((--[a-z0-9-]+)\s*(,?)/g)]
        .filter((m) => m[2] !== ',')
        .map((m) => m[1]),
    );
    const missing = [...used].filter((token) => !defined.has(token));
    expect(missing, `undefined custom properties: ${missing.join(', ')}`).toEqual([]);
  });
});
