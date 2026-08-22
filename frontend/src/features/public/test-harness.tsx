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
import { PublicLayout } from './PublicLayout.js';
import { CampaignPage } from './campaign/CampaignPage.js';
import { SAMPLE_IDEA_CAMPAIGN, SAMPLE_PRODUCT_CAMPAIGN } from './campaign/campaign.test-fixtures.js';

const CAMPAIGN_FIXTURES = new Map([
  ['/campaign/sample-pre-build', SAMPLE_IDEA_CAMPAIGN],
  ['/campaign/sample-pre-launch', SAMPLE_PRODUCT_CAMPAIGN],
]);

export function renderRoute(path: string): RenderResult {
  const fixture = CAMPAIGN_FIXTURES.get(path);
  const routes = fixture
    ? [{
        path: '/',
        element: <PublicLayout />,
        children: [{ path: path.slice(1), element: <CampaignPage campaign={fixture} /> }],
      }]
    : appRoutes;
  const router = createMemoryRouter(routes, { initialEntries: [path] });
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
