import '@testing-library/jest-dom/vitest';
import { expect, afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';
import { invalidateSession } from '../lib/session.js';

expect.extend(toHaveNoViolations);

/**
 * `waitFor`'s deadline, raised from Testing Library's 1s default (Phase 23a).
 *
 * Vitest's `testTimeout` does not govern this one: a `waitFor` gives up on its
 * own clock, and 1s is a bet on how fast the machine is. `npm test` runs the
 * jsdom project beside the backend's Postgres suites, and a render that settles
 * in 40ms alone can take well over a second under that load — which surfaces as
 * `Unable to find role="alert"` and blames the surface for being wrong when it
 * was only late. The assertions are unchanged; only how long they are willing
 * to wait for a render React has not committed yet.
 */
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => cleanup());

/**
 * The session cache is module-scoped, which is right for a page load and wrong
 * for a test file.
 *
 * `lib/session.ts` caches the resolved answer to "who is signed in?" so a
 * layout and the route inside it do not each ask. Nothing in a browser outlives
 * a navigation to a different identity — signing out clears it explicitly. In
 * jsdom the module is loaded once for the whole file, so without this a test
 * that signs in as a Founder leaves every later test in the file believing a
 * Founder is signed in, and route guards then redirect instead of rendering.
 *
 * Clearing it here rather than in each suite means a new test file cannot
 * inherit the hazard by forgetting.
 */
afterEach(() => invalidateSession());

// jsdom is missing browser APIs that Radix and the components touch. None of
// these carry behavior we assert — they exist so a render doesn't throw.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix pointer/scroll helpers absent in jsdom.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};
