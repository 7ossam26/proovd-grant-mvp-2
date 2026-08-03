import { Navigate, Outlet, type RouteObject } from 'react-router';
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
import { LiveCampaignPage } from './features/public/campaign/LiveCampaignPage.js';
import { AdminLayout } from './features/admin/AdminLayout.js';
import { SettingsPage } from './features/admin/SettingsPage.js';
import { PrerequisitesPage } from './features/admin/PrerequisitesPage.js';
import { FoundersPage } from './features/admin/FoundersPage.js';
import { FounderDetail } from './features/admin/FounderDetail.js';
import { CampaignCreators } from './features/admin/CampaignCreators.js';
import { CampaignWorkspacePanel } from './features/admin/CampaignWorkspace.js';
import { CampaignWorkspace } from './surfaces/founder/Workspace.js';
import { FounderRoster } from './surfaces/founder/RosterView.js';
import { CampaignBuild } from './surfaces/founder/CampaignBuild.js';
import { CampaignPreview } from './surfaces/founder/CampaignPreview.js';
import { CreatorReadiness } from './surfaces/founder/CreatorReadiness.js';
import { CampaignUpdates } from './surfaces/founder/CampaignUpdates.js';
import { CreatorReadinessPanel } from './features/admin/CreatorReadiness.js';
import { StripeReturn } from './surfaces/payouts/StripeReturn.js';
import { CreatorSignup } from './surfaces/creator/CreatorSignup.js';
import {
  CreatorCampaigns,
  CreatorCampaignKit,
} from './surfaces/creator/CreatorCampaigns.js';
import { FormalOpportunity } from './surfaces/creator/FormalOpportunity.js';
import { CreatorPartnership } from './surfaces/creator/CreatorPartnership.js';
import { DraftLanding } from './surfaces/DraftLanding.js';
import { BackerPage } from './features/public/backer/BackerPage.js';
import { VettingFlow } from './surfaces/draft/VettingFlow.js';
import { CreatorResult } from './surfaces/draft/CreatorResult.js';
import { AccountClaim } from './surfaces/draft/AccountClaim.js';
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
      // Phase 14b (§18, §33.6). Approved live campaigns, by id. The two static
      // sample paths above take precedence over this dynamic one, so
      // `/campaign/sample-pre-build` still renders the sample. A `/c/:code`
      // tracking-link click redirects here after setting the attribution cookie.
      {
        path: 'campaign/:campaignId',
        element: <LiveCampaignPage />,
      },
      { path: '*', element: <NotFoundSurface /> },
    ],
  },
  {
    // Phase 06 (§6, §26). The Admin panel stands outside the public shell: it
    // is the only dashboard-density surface in the MVP (§26), and sharing the
    // site header, footer sitemap, and live-chat gate is how that density
    // leaks into a Founder surface. Access is decided by the server on every
    // request — the layout's session check only decides what to render.
    path: 'admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/founders" replace /> },
      { path: 'founders', element: <FoundersPage /> },
      { path: 'founders/:draftId', element: <FounderDetail /> },
      // Phase 08a (§8, §5.3, §25.4). Scoped to one campaign by query string,
      // because §8's recruitment is always for one campaign and §11 keeps the
      // Creator tied to it.
      { path: 'creators', element: <CampaignCreators /> },
      // Phase 09a (§12 Admin, §26.2). Scoped to one campaign by query string,
      // like the Creators panel and for the same reason: §12's optional items
      // are always one campaign's.
      { path: 'optional-items', element: <CampaignWorkspacePanel /> },
      // Phase 13 (§16). Scoped to one campaign by query string, like the
      // Creators and optional-items panels: readiness is always one campaign's.
      { path: 'creator-readiness', element: <CreatorReadinessPanel /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'prerequisites', element: <PrerequisitesPage /> },
    ],
  },
  {
    // Phase 06b (§7, §33.1.1). The Founder's invited draft. Outside the public
    // shell — its header offers a nav bar of things to probe, and this page is
    // reached by a personal link, not by browsing. Outside the Admin shell for
    // the opposite reason: §26 licenses dashboard density in Admin and nowhere
    // else, and this is a Founder surface.
    path: 'draft/:token',
    element: <DraftLanding />,
  },
  {
    // Phase 15 (§19, §20). The Backer's long-lived campaign-scoped magic-link
    // page: their transactions, the not-charged fact, and cancel-before-close.
    // Outside PublicLayout for the same reason the draft link is — it is reached
    // by an account-less Backer through a token, not a navigable site path.
    path: 'backer/:token',
    element: <BackerPage />,
  },
  {
    // Phase 07 (§9, §10). The vetting sequence, its result, and the account
    // claim. Four separate addresses rather than one stateful page, because
    // DNA §5.12 requires position to survive interruption and a URL is the
    // cheapest durable position there is — a Founder who bookmarks the middle
    // of their form gets the middle of their form back.
    path: 'draft/:token/vetting',
    element: <VettingFlow />,
  },
  {
    path: 'draft/:token/result',
    element: <CreatorResult />,
  },
  {
    path: 'draft/:token/claim',
    element: <AccountClaim />,
  },
  {
    // Phase 08b (§11, §33.2.2, §33.2.3). The Creator's compact signup — ONE
    // address, because §11 gives it one flow with one primary action and
    // forbids a multi-page sequence. The same address serves the waiting state
    // after the account exists: §11 says "the same surface confirms signup",
    // and a redirect to a second page would be the sequence it rules out.
    //
    // Outside the public shell and outside the Admin shell, for the reasons the
    // Founder draft route documents.
    path: 'creator-invitation/:token',
    element: <CreatorSignup />,
  },
  {
    // Phase 08c (§10, §31.5, §33.2.4). The signed-in Creator. Outside both
    // shells: §26 licenses dashboard density in Admin only, and this is not a
    // public page — it is reached by signing in, and everything on it is
    // scoped to the session.
    path: 'creator/campaigns',
    element: <CreatorCampaigns />,
  },
  {
    // The one action §10 allows: `Review campaign`. Its own address, so a
    // Creator who bookmarks a campaign gets that campaign back.
    path: 'creator/campaigns/:associationId',
    element: <CreatorCampaignKit />,
  },
  {
    // Phase 12a (§14.1, §14.2, §33.2.6). The formal opportunity and the three
    // decisions. Its own address beside the kit: the kit is reading material,
    // this is a commercial decision, and a bookmark to either gets it back.
    path: 'creator/campaigns/:associationId/opportunity',
    element: <FormalOpportunity />,
  },
  {
    // Phase 14c (§18). The Creator's active-partnership dashboard once accepted:
    // their link, disclosure, terms, readiness, first-post state, and clicks.
    path: 'creator/campaigns/:associationId/partnership',
    element: <CreatorPartnership />,
  },
  {
    // Phase 09a (§12, DNA §5.9). The signed-in Founder's campaign workspace.
    // Outside the public shell and outside the Admin shell, for the reasons the
    // Creator routes document: §26 licenses dashboard density in Admin only,
    // and this is not a public page — everything on it is scoped to the
    // session and re-checked against the caller's own claim on every request.
    path: 'campaigns/:campaignId/workspace',
    element: <CampaignWorkspace />,
  },
  {
    // Phase 12a (§14.5). The Founder's roster view during the 72-hour clock.
    // Beside the workspace, outside both shells, for the same reasons.
    path: 'campaigns/:campaignId/roster',
    element: <FounderRoster />,
  },
  {
    // Phase 12b (§14.4, §15). The Founder's parallel campaign build and the
    // review submission. Its own address beside the workspace and roster.
    path: 'campaigns/:campaignId/build',
    element: <CampaignBuild />,
  },
  {
    // Phase 12b (§15). The Founder preview — the public campaign as a Backer
    // will see it, collecting no payment information.
    path: 'campaigns/:campaignId/preview',
    element: <CampaignPreview />,
  },
  {
    // Phase 13 (§16). The Founder's Creator-readiness and fixed-payment funding.
    // Beside the workspace, roster, build, and preview, outside both shells.
    path: 'campaigns/:campaignId/creator-readiness',
    element: <CreatorReadiness />,
  },
  {
    // Phase 14c (§18). The Founder posts and reviews campaign updates once live.
    // Beside the other campaign surfaces, outside both shells.
    path: 'campaigns/:campaignId/updates',
    element: <CampaignUpdates />,
  },
  {
    // Phase 10b (§32.2, §13). Where Stripe sends someone back to. Two landing
    // points — finished, and link-expired — and both land on one of §13's four
    // human-readable states rather than on a spinner. Outside both shells: this
    // is reached by returning from a third party, not by browsing.
    path: 'stripe/return',
    element: <StripeReturn event="returned" />,
  },
  {
    path: 'stripe/refresh',
    element: <StripeReturn event="refreshed" />,
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
