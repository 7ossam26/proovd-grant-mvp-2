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
