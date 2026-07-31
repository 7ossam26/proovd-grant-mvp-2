/**
 * Mounts the real route table in a memory router.
 *
 * The suite walks `appRoutes` — the objects `router.tsx` ships — rather than a
 * parallel list. §33.11.6 tests for broken links, and a broken link is exactly
 * what a second copy of the route table produces.
 */

import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '../../routes.js';

export function renderRoute(path: string): RenderResult {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

/** Collapses whitespace so an assertion is about words, not about JSX wrapping. */
export function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Every anchor in a rendered tree, with its href and its accessible-ish text. */
export function anchors(container: HTMLElement): Array<{ href: string; text: string }> {
  return [...container.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href') ?? '',
    text: normalize(a.textContent),
  }));
}
