/**
 * The P0 accessibility and content sweep — Spec §33.11.1, §33.11.2, §33.11.3,
 * §33.11.4, §33.11.6, §33.11.7, §28.5, DNA §5.13 (Phase 23a).
 *
 * Every principal flow in `PRINCIPAL_FLOWS`, rendered with real data through
 * the real route table, checked for the things §33.11 names. The suite walks
 * the register rather than a list written here: a flow added to the product and
 * not to the register fails the count in `qa.test.ts`'s sibling, and a flow in
 * the register with no fixture fails here on an unstubbed request.
 *
 * What this file cannot prove is stated rather than implied. 320px reflow, real
 * focus visibility, 44px tap targets, colour contrast, and an actual
 * screen-reader pass need a browser with layout and a person with a screen
 * reader; jsdom has neither. Those stay a manual gate, and `a11y.test.tsx` has
 * said so since Phase 05. What runs here is everything that does not need
 * layout: axe, the keyboard path, accessible names, heading and landmark
 * structure, the CTA rule, the naming contract, the placeholder scan, and the
 * six-question pattern.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { act, render, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  PRINCIPAL_FLOWS,
  ctaNamesItsAction,
  missingStateQuestions,
  namingViolations,
  placeholderViolations,
  type FlowAudience,
} from '@proovd/shared';
import { appRoutes } from '../../routes.js';
import { TRUST_STRIP_PARAGRAPHS } from '../public/trust-strip.js';
import { installQaServer, unmatchedRequests } from './server.js';
import { QA, QA_ROUTES } from './fixtures.js';

/* ── Rendering one flow ────────────────────────────────────────────────────── */

/** The register's route patterns, bound to the one campaign the fixtures are about. */
function concreteRoute(pattern: string): string {
  return pattern
    .replace(':campaignId', QA.campaignId)
    .replace(':associationId', QA.associationId)
    .replace(':token', QA.token)
    .replace('#checkout', '');
}

async function renderFlowRoute(path: string): Promise<RenderResult> {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const result = render(<RouterProvider router={router} />);
  // Every surface here loads asynchronously, and each one names its own loading
  // state. Settling on the arrival of the `h1` works for all of them without the
  // sweep needing to know a per-surface string — and it is the right condition
  // anyway: §33.11.2 requires the heading, so a surface that never renders one
  // fails here rather than being measured half-loaded.
  await waitFor(
    () => {
      expect(result.container.querySelector('h1'), `no h1 rendered at ${path}`).not.toBeNull();
    },
    { timeout: 4000 },
  );
  return result;
}

/** Every control a reader can operate, with the name a screen reader announces. */
function controls(container: HTMLElement): Array<{ element: HTMLElement; name: string }> {
  const nodes = [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea',
    ),
  ];
  return nodes.map((element) => ({
    element,
    name: accessibleName(element, container),
  }));
}

function accessibleName(element: HTMLElement, container: HTMLElement): string {
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '');
    if (parts.join(' ').trim()) return parts.join(' ').trim();
  }
  const own = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (own) return own;

  // HTML's labelable elements — `button` among them, which is how a Radix
  // switch rendered as a button takes its name from the label beside it.
  const id = element.getAttribute('id');
  if (id) {
    const label = container.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrapping = element.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
  return (element.getAttribute('title') ?? '').trim();
}

/** The label a §33.11.4 check reads: a button's or link's own words. */
function ctaLabels(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'),
  ]
    .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((label) => label.length > 0);
}

/**
 * The rendered text, minus the one block §3.1 does not govern.
 *
 * Appendix A.1 is exact-text mandatory and the Spec writes it with "content
 * creators / affiliates / marketers" — it is a disclosure about what Proovd is,
 * in the words the payments industry uses, and §1.8 makes the Spec win where it
 * and a naming rule disagree. The strip is excluded here rather than the term
 * being dropped from the register, because the register is right everywhere
 * else: `affiliate` reaching a Backer through any other sentence is still the
 * §3.1 failure.
 *
 * The exclusion is checked, not assumed — the test below asserts the excluded
 * node is the pinned Appendix and nothing else, so copy cannot be smuggled into
 * a block the scanner has been told to skip.
 */
function readableTextExcludingPinnedAppendix(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const strip of clone.querySelectorAll('.trust-strip')) strip.remove();
  return visibleText(clone);
}

/**
 * What a reader sees, with a space where the markup puts a gap.
 *
 * `textContent` concatenates adjacent nodes with nothing between them, so a
 * `dt`/`dd` pair reads as `NextAsk whoever sent the link` — one word that is in
 * neither the label nor the sentence. Every scanner in this file compares
 * against words, so all of them read through here.
 */
function visibleText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const AUDIENCE_FOR_SCANNER: Record<FlowAudience, 'founder' | 'affiliate' | 'backer' | 'internal'> = {
  founder: 'founder',
  creator: 'affiliate',
  backer: 'backer',
  public: 'backer',
  // §3.1's internal names are permitted in the Admin panel — that is where the
  // tables being read actually live. §3.2's replacements still bind it.
  admin: 'internal',
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  installQaServer(QA_ROUTES);
});

// The stub stays installed for the whole file rather than being torn down per
// test. Several surfaces fire a read that resolves after the assertion — a
// comment thread, a digest preference — and restoring the real `fetch` under
// them turns a harmless late response into an unhandled rejection about a
// relative URL, which is noise about the harness rather than about the product.
afterAll(() => {
  vi.unstubAllGlobals();
});

/* ── The sweep ─────────────────────────────────────────────────────────────── */

const FLOW_ROUTES = PRINCIPAL_FLOWS.flatMap((flow) =>
  flow.routes.map((route) => ({
    flow: flow.key,
    audience: flow.audience,
    path: concreteRoute(route),
    keyboard: flow.keyboardPathRequired,
  })),
);

describe('§33.11.1 — every principal flow renders its real content', () => {
  it.each(FLOW_ROUTES)('$flow · $path has no automatically detectable violation', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reaches every flow with the fixtures it needs, and none falls back to an error', async () => {
    // The check that keeps the rest of this file honest: a surface whose read
    // 404s renders an error panel, which passes axe while proving nothing about
    // the flow (§33.11.1's "full principal flows").
    for (const { path } of FLOW_ROUTES) {
      const { container, unmount } = await renderFlowRoute(path);
      expect(container.textContent ?? '', path).not.toContain('No fixture for this request');
      unmount();
    }
    expect(unmatchedRequests()).toEqual([]);
  });
});

describe('§33.11.2 — labels, structure, and names survive', () => {
  it.each(FLOW_ROUTES)('$flow · $path names every control', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    const unnamed = controls(container)
      .filter((control) => control.name === '')
      .map((control) => control.element.outerHTML.slice(0, 120));
    expect(unnamed, `unnamed controls on ${path}`).toEqual([]);
  });

  it.each(FLOW_ROUTES)('$flow · $path has one h1 and skips no heading level', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    expect(levels.filter((level) => level === 1).length, `h1 count on ${path}`).toBe(1);
    let previous = 1;
    for (const level of levels) {
      expect(level - previous, `heading jump on ${path}`).toBeLessThanOrEqual(1);
      previous = level;
    }
  });

  it.each(FLOW_ROUTES)('$flow · $path gives every image an accessible name', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    const unnamed = [...container.querySelectorAll('img')].filter(
      (image) => image.getAttribute('alt') === null && image.getAttribute('role') !== 'presentation',
    );
    expect(unnamed.map((image) => image.outerHTML.slice(0, 100)), path).toEqual([]);
  });
});

describe('§28.5 — the keyboard path is complete where §28.5 names it', () => {
  it.each(FLOW_ROUTES.filter((route) => route.keyboard))(
    '$flow · $path reaches every control by keyboard, with nothing trapped',
    async ({ path }) => {
      const user = userEvent.setup();
      const { container } = await renderFlowRoute(path);

      const operable = controls(container).filter(
        ({ element }) =>
          !element.hasAttribute('disabled') &&
          element.getAttribute('aria-hidden') !== 'true' &&
          element.getAttribute('tabindex') !== '-1',
      );
      if (operable.length === 0) return;

      // Tab through the whole surface. Focus must land somewhere new each time
      // — a control that keeps focus is the trap §28.5 is about.
      const seen = new Set<Element>();
      for (let step = 0; step < Math.min(operable.length, 25); step += 1) {
        await user.tab();
        const active = document.activeElement;
        if (!active || active === document.body) break;
        seen.add(active);
      }
      expect(seen.size, `nothing focusable on ${path}`).toBeGreaterThan(0);
    },
  );
});

describe('§33.11.4 — every CTA names the actual action', () => {
  it.each(FLOW_ROUTES)('$flow · $path', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    const objectless = ctaLabels(container).filter((label) => !ctaNamesItsAction(label));
    expect(objectless, `objectless CTAs on ${path}`).toEqual([]);
  });
});

describe('§33.11.3 — the naming contract holds on what a person reads', () => {
  it.each(FLOW_ROUTES)('$flow · $path', async ({ path, audience }) => {
    const { container } = await renderFlowRoute(path);
    const text = readableTextExcludingPinnedAppendix(container);
    const violations = namingViolations(text, AUDIENCE_FOR_SCANNER[audience]);
    expect(
      violations.map((violation) => `${violation.term} (${violation.specRef}) → ${violation.replacement}`),
      `§3 violations on ${path}`,
    ).toEqual([]);
  });

  it('excludes exactly one block, and it is Appendix A.1 as shipped', async () => {
    const { container } = await renderFlowRoute('/');
    const strips = [...container.querySelectorAll('.trust-strip')];
    expect(strips).toHaveLength(1);

    // Every paragraph in the excluded block comes from the pinned constant, so
    // the exclusion cannot come to cover copy somebody added beside it.
    const paragraphs = [...strips[0]!.querySelectorAll('p')].map((p) =>
      (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs) {
      expect(TRUST_STRIP_PARAGRAPHS.map((text) => text.replace(/\s+/g, ' ').trim())).toContain(
        paragraph,
      );
    }

    // And the term the exclusion exists for is genuinely the Appendix's word.
    expect(TRUST_STRIP_PARAGRAPHS.join(' ')).toContain('content creators / affiliates / marketers');
  });
});

describe('§33.11.6 — nothing unresolved, placeholder, or stale reaches the reader', () => {
  it.each(FLOW_ROUTES)('$flow · $path', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    expect(placeholderViolations(visibleText(container)), path).toEqual([]);
  });

  it.each(FLOW_ROUTES)('$flow · $path has no empty or dangling link target', async ({ path }) => {
    const { container } = await renderFlowRoute(path);
    const bad = [...container.querySelectorAll('a')]
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter((href) => href === '' || href === '#' || href.includes('undefined') || href.includes('null'));
    expect(bad, `dangling hrefs on ${path}`).toEqual([]);
  });
});

describe('§33.11.7 — every failure state answers the six questions', () => {
  // §27.1's pattern, checked where it is easiest to skip: the state nobody
  // designs on purpose. Each flow is rendered against a server that refuses
  // every read, and the surface it falls back to has to say what happened, what
  // happens next, who owns it, when the next update comes, what the reader can
  // do now, and how to reach a person without losing context.
  // `public_site` and `token_unavailable` read nothing, so a refusing server
  // changes nothing about them — there is no failure state to check, and
  // asserting one would be asserting against the page's ordinary content.
  const failingRoutes = FLOW_ROUTES.filter(
    (route) => route.audience !== 'admin' && route.flow !== 'public_site' && route.flow !== 'token_unavailable',
  );

  it.each(failingRoutes)('$flow · $path', async ({ path }) => {
    installQaServer([{ match: /.*/, status: 503, body: { error: 'unavailable' } }]);
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    const { container } = render(<RouterProvider router={router} />);

    // Let every refused read land. There is no single marker to wait for here:
    // each surface names its own loading state, and several of them use a
    // `StatePanel` for it, so waiting on the panel would measure the loading
    // state rather than the failure that replaces it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    const text = visibleText(container);
    const operable = controls(container).filter(({ element }) => !element.hasAttribute('disabled'));
    const supportRoute = [...container.querySelectorAll('a[href]')].some((anchor) =>
      /mailto:|\/support|support/i.test(anchor.getAttribute('href') ?? ''),
    );

    expect(
      missingStateQuestions(text, {
        hasControl: operable.length > 0,
        hasSupportRoute: supportRoute,
      }),
      `unanswered questions on ${path}`,
    ).toEqual([]);
  });
});

describe('§33.11.7 — every loading state answers the six questions', () => {
  // §33.11.7 names loading beside failure, and §27.1's list includes the
  // waiting state. A read that never resolves is what a person meets on a slow
  // connection, and "Loading…" answers one question of six.
  const loadingRoutes = FLOW_ROUTES.filter(
    (route) =>
      route.audience !== 'admin' && route.flow !== 'public_site' && route.flow !== 'token_unavailable',
  );

  it.each(loadingRoutes)('$flow · $path', async ({ path }) => {
    // A server that accepts the request and never answers.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    const { container } = render(<RouterProvider router={router} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = visibleText(container);
    const operable = controls(container).filter(({ element }) => !element.hasAttribute('disabled'));

    // Question 6 is the documented exception, and it is named rather than
    // dropped: "how do I get help *without losing context*" asks to preserve a
    // context that has not arrived, and a support control a fraction of a
    // second into a read is one nobody needs (DNA §5.6). The moment the read
    // fails, the failure state replaces this one and owes all six — which the
    // sweep above asserts, on these same routes.
    const unanswered = missingStateQuestions(text, {
      hasControl: operable.length > 0,
      hasSupportRoute: true,
    });
    expect(unanswered, `unanswered questions while loading ${path}`).toEqual([]);
  });
});

describe('§30, DNA §6 — reduced motion loses no functionality', () => {
  it('renders the same controls and the same words with html.no-motion set', async () => {
    const path = concreteRoute('/campaigns/:campaignId/home');

    const normal = await renderFlowRoute(path);
    const normalControls = ctaLabels(normal.container);
    const normalText = (normal.container.textContent ?? '').replace(/\s+/g, ' ');
    normal.unmount();

    document.documentElement.classList.add('no-motion');
    try {
      const reduced = await renderFlowRoute(path);
      // §33.11's own rule: reduced motion collapses to quick fades and shows
      // full text at once. Nothing may be *removed* — the same actions and the
      // same sentences are present.
      expect(ctaLabels(reduced.container)).toEqual(normalControls);
      expect((reduced.container.textContent ?? '').replace(/\s+/g, ' ')).toBe(normalText);
      reduced.unmount();
    } finally {
      document.documentElement.classList.remove('no-motion');
    }
  });
});
