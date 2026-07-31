import { Outlet, type RouteObject } from 'react-router';
import { lazy, Suspense } from 'react';
import { POLICY_DOCUMENTS } from '@proovd/shared';
import { MotionProvider } from './motion/MotionProvider.js';
import { LinkUnavailable } from './surfaces/LinkUnavailable.js';
import { PublicLayout } from './features/public/PublicLayout.js';
import { Home } from './features/public/Home.js';
import { About } from './features/public/About.js';
import { HowPaymentsWork } from './features/public/HowPaymentsWork.js';
import { Safety } from './features/public/Safety.js';
import { PolicyPage } from './features/public/PolicyPage.js';
import { NotFoundSurface, PageLoading } from './features/public/states.js';
import { CampaignPage } from './features/public/campaign/CampaignPage.js';
import {
  SAMPLE_IDEA_CAMPAIGN,
  SAMPLE_PRODUCT_CAMPAIGN,
} from './features/public/campaign/samples.js';

/**
 * The route table. Phase 05 fills it with §18's public inventory — all
 * fourteen — plus the catch-all.
 *
 * The route shape for approved live campaigns (`/campaign/:slug`) arrives in
 * Phase 14. Adding it now would turn every mistyped campaign address into a
 * blank page instead of the §30-compliant not-found surface.
 *
 * Kept separate from `router.tsx` so the acceptance suite can mount the real
 * table in a memory router. A test that walks a hand-written copy of the routes
 * proves nothing about the ones that ship.
 *
 * React Router v7 data mode — loaders/actions added per phase.
 */

function Root() {
  return (
    <MotionProvider>
      <Outlet />
    </MotionProvider>
  );
}

// The gallery is a dev-only surface (Phase 02 §8). The dynamic import lives in a
// branch that Vite eliminates in the production build, so its code never ships.
const Gallery = import.meta.env.DEV ? lazy(() => import('./gallery/Gallery.js')) : null;

/** The eight §31.4 policy routes, generated from the one register. */
const policyRoutes: RouteObject[] = POLICY_DOCUMENTS.map((document) => ({
  path: document.route.slice(1),
  element: <PolicyPage document={document} />,
}));

const rootChildren: RouteObject[] = [
  {
    // Pathless layout: header, main, footer, and the staffed-hours chat gate
    // wrap every public route.
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'about', element: <About /> },
      { path: 'how-payments-work', element: <HowPaymentsWork /> },
      { path: 'safety', element: <Safety /> },
      ...policyRoutes,
      {
        path: 'campaign/sample-pre-build',
        element: <CampaignPage campaign={SAMPLE_IDEA_CAMPAIGN} />,
      },
      {
        path: 'campaign/sample-pre-launch',
        element: <CampaignPage campaign={SAMPLE_PRODUCT_CAMPAIGN} />,
      },
      { path: '*', element: <NotFoundSurface /> },
    ],
  },
  {
    // Phase 04 (§5.5). One route for every token failure — invalid, expired,
    // revoked, claimed, malformed, rate-limited, never-existed. Deliberately
    // takes no parameter and reads no state: anything this page could vary on
    // is something a caller could measure to learn whether a link, an account,
    // or a draft exists. It stands outside the public shell for the same
    // reason — a site nav is a list of things to probe.
    path: 'link-unavailable',
    element: <LinkUnavailable />,
  },
];

if (Gallery) {
  rootChildren.push({
    path: '_gallery',
    element: (
      <Suspense fallback={<PageLoading />}>
        <Gallery />
      </Suspense>
    ),
  });
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Root />,
    children: rootChildren,
  },
];
