import { Navigate, Outlet, useParams, type RouteObject } from 'react-router';
import { lazy, Suspense } from 'react';
import { POLICY_DOCUMENTS, founderFlowPath } from '@proovd/shared';
import { MotionProvider } from './motion/MotionProvider.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
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
import { AdminSignIn } from './features/admin/AdminSignIn.js';
import { RequireRole, RedirectIfAuthenticated } from './lib/routeGuards.js';
import { roleHome } from './lib/session.js';
import { FoundersList } from './features/admin/founders/FoundersList.js';
import { CreateFounder } from './features/admin/founders/CreateFounder.js';
import { FounderWorkspace } from './features/admin/founders/FounderWorkspace.js';
import { CreatorsDirectory } from './features/admin/creators/CreatorsDirectory.js';
import { CreatorRecord } from './features/admin/creators/CreatorRecord.js';
import { PostReview } from './features/admin/creators/PostReview.js';
import { SupportQueue } from './features/admin/support/SupportQueue.js';
import { SupportCase } from './features/admin/support/SupportCase.js';
import { CampaignsDirectory } from './features/admin/campaigns/CampaignsDirectory.js';
import { CampaignRecord } from './features/admin/campaigns/CampaignRecord.js';
import { BackersWorkspace } from './features/admin/backers/BackersWorkspace.js';
import { LiveModePage } from './features/admin/live-mode/LiveModePage.js';
import { MoneyQueue } from './features/admin/money/MoneyQueue.js';
import { MoneyRecord } from './features/admin/money/MoneyRecord.js';
import { FounderRoster } from './surfaces/founder/RosterView.js';
import { CampaignBuild } from './surfaces/founder/CampaignBuild.js';
import { CampaignPreview } from './surfaces/founder/CampaignPreview.js';
import { CreatorReadiness } from './surfaces/founder/CreatorReadiness.js';
import { CampaignUpdates } from './surfaces/founder/CampaignUpdates.js';
import { CampaignHome } from './surfaces/founder/CampaignHome.js';
import { FounderCampaigns } from './surfaces/founder/FounderCampaigns.js';
import { SignIn, ResetPassword } from './surfaces/auth/SignIn.js';
import { CampaignResults } from './surfaces/founder/CampaignResults.js';
import { Fulfillment } from './surfaces/founder/Fulfillment.js';
import {
  CreatorNotificationSettings,
  FounderNotificationSettings,
} from './surfaces/notifications/NotificationSettings.js';
import { StripeReturn } from './surfaces/payouts/StripeReturn.js';
import { CreatorSignup } from './surfaces/creator/CreatorSignup.js';
import {
  CreatorCampaigns,
  CreatorCampaignKit,
} from './surfaces/creator/CreatorCampaigns.js';
import { FormalOpportunity } from './surfaces/creator/FormalOpportunity.js';
import { CreatorPartnership } from './surfaces/creator/CreatorPartnership.js';
import { CreatorCampaignClose } from './surfaces/creator/CreatorCampaignClose.js';
import { InviteClaim } from './surfaces/founder-flow/InviteClaim.js';
import {
  ProblemConfirm,
  SolutionConfirm,
} from './surfaces/founder-flow/ConfirmAnswer.js';
import { CampaignTypeStep } from './surfaces/founder-flow/CampaignTypeStep.js';
import { BackerPage } from './features/public/backer/BackerPage.js';
import {
  FollowConfirmPage,
  FollowStopPage,
} from './features/public/campaign/FollowAction.js';
import { EmailStep } from './surfaces/founder-flow/EmailStep.js';
import { CodeStep } from './surfaces/founder-flow/CodeStep.js';
import { PositioningStep } from './surfaces/founder-flow/PositioningStep.js';
import { MatchStep } from './surfaces/founder-flow/MatchStep.js';
import { ClaimStep } from './surfaces/founder-flow/ClaimStep.js';
import { VisualsStep } from './surfaces/founder-flow/VisualsStep.js';
import { BrandingStep } from './surfaces/founder-flow/BrandingStep.js';
import { InterviewStep } from './surfaces/founder-flow/InterviewStep.js';
import { StoryStep } from './surfaces/founder-flow/StoryStep.js';
import { SocialsStep } from './surfaces/founder-flow/SocialsStep.js';
import { LastLook } from './surfaces/founder-flow/LastLook.js';
import { PayoutsStep } from './surfaces/founder-flow/PayoutsStep.js';
import { FeeStep } from './surfaces/founder-flow/FeeStep.js';
import { CreatorPaymentStep } from './surfaces/founder-flow/CreatorPaymentStep.js';
import { VoiceStep } from './surfaces/founder-flow/VoiceStep.js';
import { ThresholdStep } from './surfaces/founder-flow/ThresholdStep.js';
import { FaqsStep } from './surfaces/founder-flow/FaqsStep.js';
import { RewardsStep } from './surfaces/founder-flow/RewardsStep.js';
import { InReviewStep } from './surfaces/founder-flow/InReviewStep.js';
import { LiveStep } from './surfaces/founder-flow/LiveStep.js';
import {
  SAMPLE_IDEA_CAMPAIGN,
  SAMPLE_PRODUCT_CAMPAIGN,
} from './features/public/campaign/samples.js';

/**
 * `/draft/:token/vetting` — retired by Founder Flow v2 Session C.
 *
 * Positioning became its own page and took the submission with it. This is a
 * redirect rather than a deleted route because the address shipped in Phase
 * 07 and a Founder may have it bookmarked; landing them on the answer they
 * were part-way through is the DNA §5.12 answer.
 */
function DraftVettingRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={founderFlowPath('positioning', token)} replace />;
}
/** The old possible-creators result address, kept only as a way to the claim. */
function DraftResultRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={`/draft/${encodeURIComponent(token)}/claim`} replace />;
}

/**
 * The retired campaign workspace (Session E, 2026-08-19).
 *
 * Phase 09a's workspace lost its five §12 steps to Session D and its payout and
 * listing-fee panels to Session E. The address survives its component because
 * things this session does not own point at it — §27.3/§27.4 campaign emails
 * sent since Phase 12, Appendix C's §34 walkthrough steps, and whatever a
 * Founder bookmarked — and the listing fee is what they were coming for.
 */
function WorkspaceRedirect() {
  const { campaignId = '' } = useParams();
  return <Navigate to={founderFlowPath('fee', campaignId)} replace />;
}

/*
 * The Affiliate record's retired sibling addresses (Session C, 2026-08-17).
 * Each redirects into the tab that absorbed it, so a bookmark, a Support
 * context link, or a Tasks reference minted before the rebuild still lands on
 * the record it meant rather than a 404.
 */
function RelationshipRedirect() {
  const { prospectId = '', associationId = '' } = useParams();
  return (
    <Navigate
      to={`/admin/creators/${encodeURIComponent(prospectId)}?tab=campaigns&rel=${encodeURIComponent(associationId)}`}
      replace
    />
  );
}

function HistoryRedirect() {
  const { prospectId = '' } = useParams();
  return <Navigate to={`/admin/creators/${encodeURIComponent(prospectId)}?tab=history`} replace />;
}

function ControlsRedirect() {
  const { prospectId = '' } = useParams();
  return (
    <Navigate
      to={`/admin/creators/${encodeURIComponent(prospectId)}?tab=support&section=enforcement`}
      replace
    />
  );
}

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
      {/*
        The boundary sits INSIDE MotionProvider, not outside it. A throw from a
        surface must not take the motion runtime's context down with it — and
        more practically, the provider's own fail-loud notice has to survive a
        crash, since "motion did not load" is frequently the reason for one.
      */}
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
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
      // §5.1, §5.2, §5.3, §5.5. The one sign-in address, and the reset that
      // §5.5 grants all three account roles. Inside the public shell — unlike
      // the token surfaces, these are browsable addresses reached from the
      // header, so the site's header, footer, and staffed-hours chat belong
      // around them. They are deliberately NOT in §18's fourteen-route
      // inventory; see `ACCOUNT_ROUTES` in `features/public/site.ts`.
      // Already-signed-in visitors never see this form: `RedirectIfAuthenticated`
      // sends them to their own home (or to `?next=` when it is a same-site
      // path). Asking somebody to re-enter a password they have already proved
      // is a question with no consequence, and it teaches people to type
      // credentials at any form that asks.
      {
        path: 'signin',
        element: (
          <RedirectIfAuthenticated>
            <SignIn />
          </RedirectIfAuthenticated>
        ),
      },
      // `/reset-password` is deliberately NOT wrapped. Somebody who is signed
      // in on one device and has forgotten the password on another still needs
      // this page, and the token in the emailed link is what authorises the
      // change — not the session.
      { path: 'reset-password', element: <ResetPassword /> },
      { path: '*', element: <NotFoundSurface /> },
    ],
  },
  {
    // §5.1. The Admin door, and the reason it has its own address.
    //
    // It used to be the signed-out branch INSIDE `AdminLayout`, which rendered
    // the Admin wordmark, the section tabs, the Explore control, and the
    // environment chip to anybody who typed `/admin`. Nothing secret leaked —
    // every request behind that chrome 401s — but an operations shell shown to
    // a stranger tells them what exists, and the URL claimed to be the panel
    // while what was on screen was a login form.
    //
    // Outside the `admin` route below, so it is impossible for the protected
    // layout to wrap it. That structural separation is the fix; a conditional
    // inside one component is what created the bug.
    path: 'admin/signin',
    element: (
      <RedirectIfAuthenticated
        // An authenticated non-Admin goes to their OWN home, never to `next` —
        // `next` points into `/admin`, and bouncing them there just produces a
        // refusal one navigation later.
        destinationFor={(role, next) =>
          role === 'admin' ? (next ?? '/admin/founders') : roleHome[role]
        }
      >
        <AdminSignIn />
      </RedirectIfAuthenticated>
    ),
  },
  {
    // Phase 06 (§6, §26). The Admin panel stands outside the public shell: it
    // is the only dashboard-density surface in the MVP (§26), and sharing the
    // site header, footer sitemap, and live-chat gate is how that density
    // leaks into a Founder surface.
    //
    // `RequireRole` decides BEFORE `AdminLayout` renders, so no Admin chrome
    // reaches a visitor who is not a signed-in Admin — an anonymous one is sent
    // to `/admin/signin` carrying where they were going, and an authenticated
    // Founder or Creator is told plainly that this area is not theirs rather
    // than being shown a sign-in form for an identity they have already proved.
    //
    // None of this is the security boundary: `/api/admin/*` is decided by
    // `requireAdmin` on the server for every request, and stays decided there
    // if this guard is bypassed. What it removes is the protected-shell flash.
    path: 'admin',
    element: (
      <RequireRole allow={['admin']} signInPath="/admin/signin">
        <AdminLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <Navigate to="/admin/founders" replace /> },
      // §26.1. Two addresses: everybody, and one person. The workspace is keyed
      // on the PROSPECT rather than on a draft or a campaign, because a Founder
      // whose campaign was archived-and-restarted (§9's wrong-type path) has
      // more than one of each and is still one person.
      //
      // The Admin panel's one remaining section — Today — is parked in the
      // shell rather than routed here. A route with no surface is a claim that
      // a surface exists (§1.4); the shell's parked control says what the
      // destination is instead.
      { path: 'founders', element: <FoundersList /> },
      // Static before dynamic — the router ranks it, but the order documents it.
      { path: 'founders/new', element: <CreateFounder /> },
      { path: 'founders/:prospectId', element: <FounderWorkspace /> },
      // §26.1, §8. The Creator (Affiliate) workspace, keyed on the PERSON for
      // the same reason the Founder one is: a Creator recruited to two
      // campaigns is one person with two `campaign_affiliate_associations`
      // rows, and the deleted campaign-scoped screen could not say so.
      //
      // One record address with the view in the URL (DNA §5.12): `?tab=` for
      // the eight tabs, `?section=` for the tab's sections, `?rel=` for the
      // selected relationship. Session C absorbed the old `/history`,
      // `/controls`, and `/relationships/:associationId` sibling addresses
      // into the tabs; the relationship address redirects so a bookmark, the
      // Support workspace's context link, or a Tasks reference from before
      // the rebuild still lands on the record it meant.
      { path: 'creators', element: <CreatorsDirectory /> },
      { path: 'creators/:prospectId', element: <CreatorRecord /> },
      {
        path: 'creators/:prospectId/relationships/:associationId',
        element: <RelationshipRedirect />,
      },
      { path: 'creators/:prospectId/history', element: <HistoryRedirect /> },
      { path: 'creators/:prospectId/controls', element: <ControlsRedirect /> },
      // §17's decision is its own address, because it is its own act — an
      // Admin part-way through seven checks who reloads gets the checks back.
      {
        path: 'creators/:prospectId/relationships/:associationId/review',
        element: <PostReview />,
      },
      // §26.7, §26.8, §27.8. The Support workspace over the case domain Phase
      // 16b shipped. Two addresses: the queue, and one case.
      //
      // The four tabs are a `?tab=` search param rather than path segments,
      // for the reason the Creator relationship panes are: they are four views
      // of ONE record, and a bookmark to the evidence should still be that
      // case. The queue's filter is a search param for the same reason — a
      // filtered queue is a position, and a position that vanishes on reload
      // is one an Admin cannot send to a colleague (DNA §5.12).
      { path: 'support', element: <SupportQueue /> },
      { path: 'support/:caseId', element: <SupportCase /> },
      // §26.1, §23.1. The Campaigns hub, built 2026-08-15. Two addresses: every
      // campaign, and one campaign.
      //
      // It is a READ. There is no create, edit, approve, launch, pause, or
      // close route here and the API behind it is two GETs — every campaign
      // decision already has a router another workspace owns, and a duplicate
      // control would be a second door into rules those encode.
      //
      // The four tabs are a `?tab=` search param rather than path segments, for
      // the reason the Support case and the Creator relationship panes are:
      // they are four views of ONE record, and a bookmark to the Close tab
      // should still be that campaign (DNA §5.12). The directory's filter is a
      // search param for the same reason.
      { path: 'campaigns', element: <CampaignsDirectory /> },
      { path: 'campaigns/:campaignId', element: <CampaignRecord /> },
      /* §26.1, §26.5, §25.7 — Backers. One address, because §5.4 gives a Backer
         no account and the reference's own promise is "One row per Backer. No
         extra record page." Everything a row holds is on the row; the position
         (view, filters, page) lives in the query string so a drilled-through
         list is a link an Admin can send. */
      { path: 'backers', element: <BackersWorkspace /> },
      /*
        §34, §2.1, Appendix C — the live-mode gate, built 2026-08-19 over the
        API Phase 24 shipped and tested. That phase recorded its own gap: "the
        API exists and is tested; there is no React page for it yet… §1.1 does
        [name one], so this is a real gap rather than a decision."

        There is no override on it and nowhere to add one — the
        `/admin/prerequisites` posture since Phase 06a. The enable form is
        ABSENT while the gate is shut rather than disabled, because §34 is
        released by satisfying it and a disabled control is one somebody looks
        for a way around.
      */
      /*
        §21, §22.1–§22.7, §24.8, §24.11, §26.6 — the Money & Fulfillment
        console, built 2026-08-19. The Campaigns hub has named this destination
        since it was built and carried "Money console not built yet — the
        amounts here come from its records"; this is that console, and that
        sentence is the promise it keeps.

        Two addresses. The queue is ordered by §33.7.12's own rule — interrupted
        batches first, because "an incomplete batch is visibly recoverable" is
        the acceptance test — and the record carries its six views in `?tab=`,
        for the reason the Support case and the Campaigns record do: they are
        six views of ONE campaign's money, and a bookmark to the Founder payment
        should still be that campaign (DNA §5.12).

        Every money decision in the product is made here and nowhere else. A
        second control elsewhere would be a second path into rules — §22.1's one
        Transfer per Creator, §24.8's cause matrix, §22.3's W-9 block — whose
        whole safety is that there is one.
      */
      { path: 'money', element: <MoneyQueue /> },
      { path: 'money/:campaignId', element: <MoneyRecord /> },
      { path: 'live-mode', element: <LiveModePage /> },
    ],
  },
  {
    /*
      Founder Flow v2, Session B (2026-08-18) — the first four of twenty-six
      full-bleed pages, each its own top-level route.

      Outside the public shell, because its header offers a nav bar of things to
      probe and these pages are reached by a personal link rather than by
      browsing. Outside the Admin shell for the opposite reason: §26 licenses
      dashboard density in Admin and nowhere else. And outside every guard,
      because a draft token is not a session.

      One address per page, and `FOUNDER_FLOW_PAGES` is the one list of them —
      the help drawer and §33.11's flow register both read it, so a page cannot
      exist in the router and be missing from either. DNA §5.12 wants position
      to survive interruption, and twenty-six screens is twenty-six positions a
      single stateful page would destroy on reload.

      `draft/:token` is the address in the invitation email and does not move.
    */
    path: 'draft/:token',
    element: <InviteClaim />,
  },
  {
    path: 'draft/:token/problem',
    element: <ProblemConfirm />,
  },
  {
    path: 'draft/:token/solution',
    element: <SolutionConfirm />,
  },
  {
    path: 'draft/:token/campaign-type',
    element: <CampaignTypeStep />,
  },
  {
    /*
      Session C (2026-08-18) — the rest of the draft token. The address, the
      six-digit code, §9's third answer, and §10's relevance signal, which is
      the last screen before the claim.
    */
    path: 'draft/:token/email',
    element: <EmailStep />,
  },
  {
    path: 'draft/:token/code',
    element: <CodeStep />,
  },
  {
    path: 'draft/:token/positioning',
    element: <PositioningStep />,
  },
  {
    path: 'draft/:token/match',
    element: <MatchStep />,
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
    /*
      The campaign follow's confirm and unfollow pages (campaign-page-v2
      Session C — a recorded §1 rule 6 deviation). Outside PublicLayout for the
      same reason the draft and Backer links are: reached by an account-less
      person through a token, not by navigating the site — so they are
      deliberately NOT in `site.ts`'s route inventory and no footer links them.

      They are pages rather than one-click links because a link that acts on
      being FETCHED records the answers email scanners give: a GET confirm
      would let a scanner complete the double opt-in, and a GET unfollow would
      unsubscribe somebody who never clicked.
    */
    path: 'follow/confirm/:token',
    element: <FollowConfirmPage />,
  },
  {
    path: 'follow/stop/:token',
    element: <FollowStopPage />,
  },
  {
    /*
      Retired by Session C (2026-08-18). It was the interim surface that asked
      §9's third answer and submitted; Positioning is now its own page and the
      submission goes with it. A bookmark from before the rebuild lands there
      rather than on nothing — the address shipped from Phase 07 and somebody
      may still be holding it.
    */
    path: 'draft/:token/vetting',
    element: <DraftVettingRedirect />,
  },
  {
    // The result page went with the simplified flow; a bookmarked address
    // lands on the claim, which is where the flow now goes after submission.
    path: 'draft/:token/result',
    element: <DraftResultRedirect />,
  },
  {
    /*
      Founder Flow v2 Session D (2026-08-18). The address does not move — it
      shipped in Phase 07, the match screen has pointed at it since Session C,
      and it is the one stage-2 page there is. What renders changed: the same
      §10 claim, re-presented as a full-bleed flow page.
    */
    path: 'draft/:token/claim',
    element: <ClaimStep />,
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
    /*
     * Every session-scoped CREATOR address, behind one guard.
     *
     * A pathless layout route rather than a wrapper per route: a guard that has
     * to be remembered on each new entry is one that eventually is not. Adding
     * a Creator surface inside this group inherits the check; adding one
     * outside it is a visible choice somebody made.
     *
     * `creator-invitation/:token` is deliberately NOT in here — it is reached
     * with an invitation token and no account, which is the whole of §11.
     *
     * The server decides access regardless: every /api/creator route is behind
     * requireRole(auth, 'affiliate') on every request. This decides rendering.
     */
    element: (
      <RequireRole allow={['affiliate']} signInPath="/signin">
        <Outlet />
      </RequireRole>
    ),
    children: [
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
    // Phase 18b (§21). The Creator's campaign close view: content verified,
    // attributed pre-orders/captures, estimated earnings as Appendix B.7, the
    // next review date, and a factual thank-you — no ranking anywhere (§30).
    path: 'creator/campaigns/:associationId/close',
    element: <CreatorCampaignClose />,
  },
    ],
  },
  {
    /*
     * Every session-scoped FOUNDER address, behind one guard. Same reasoning as
     * the Creator group above. On the server every /api/founder route is behind
     * requireRole(auth, 'founder'), the §29.8 reacceptance gate, and the
     * §26.7/§22.7 standing gate, on every request.
     */
    element: (
      <RequireRole allow={['founder']} signInPath="/signin">
        <Outlet />
      </RequireRole>
    ),
    children: [
      {
    // §1.1, §5.2. Where a Founder lands after signing in. Every other Founder
    // route is `/campaigns/:campaignId/…`, so without this a valid session was
    // only useful to somebody who already had a campaign id in their history.
    // Outside both shells, for the reasons the campaign routes below document.
    path: 'campaigns',
    element: <FounderCampaigns />,
  },
  {
    /*
      Founder Flow v2 Session D (2026-08-18) — stage 3. The five §12 answers
      and the review over all eight, each its own top-level address inside the
      Founder guard.

      Addressed by CAMPAIGN rather than by the draft token every earlier page
      uses, because §10's claim invalidated it and these write through
      /api/founder/campaigns/:id/*. `FOUNDER_FLOW_PAGES` carries which
      parameter each page wants, so nothing here builds a path by hand.

      Twenty-six positions a single stateful page would destroy on reload, and
      the `?from=review` on an edit opened from Last look is in the address for
      the same reason (DNA §5.12).
    */
    path: 'campaigns/:campaignId/setup/visuals',
    element: <VisualsStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/branding',
    element: <BrandingStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/interview',
    element: <InterviewStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/story',
    element: <StoryStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/socials',
    element: <SocialsStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/review',
    element: <LastLook />,
  },
  {
    /*
      Founder Flow v2 Session E (2026-08-19) — stage 4, the money.

      Stripe BEFORE the fee, because `beginListingCheckout` refuses without a
      complete `founder_seller` account and §23.1 orders the two campaign states
      the same way. The reference draws them the other way round, which would
      put a payment control on a page the server declines.
    */
    path: 'campaigns/:campaignId/setup/payouts',
    element: <PayoutsStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/fee',
    element: <FeeStep />,
  },
  {
    /*
      Founder Flow v2 Session F (2026-08-19) — stage 5, and the end of the flow.

      After the fee because Phase 11's effect 4 is what opens the formal Creator
      opportunity: before it there is no Creator to be open to, and §15's review
      has nothing to review. `threshold` is Idea-only — §14.4 gives a Product
      campaign no public threshold — and `buildFlowStepsFor` decides the walk, so
      a Product Founder is never routed there.
    */
    path: 'campaigns/:campaignId/setup/creator-payment',
    element: <CreatorPaymentStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/voice',
    element: <VoiceStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/threshold',
    element: <ThresholdStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/faqs',
    element: <FaqsStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/rewards',
    element: <RewardsStep />,
  },
  {
    /*
      `setup/review` is Last look; this is the other kind of review — §15's, of
      the campaign — so it has its own address rather than a parameter on one
      somebody may have bookmarked.
    */
    path: 'campaigns/:campaignId/setup/in-review',
    element: <InReviewStep />,
  },
  {
    path: 'campaigns/:campaignId/setup/live',
    element: <LiveStep />,
  },
  {
    /*
      Retired 2026-08-19 (Session E), and a redirect rather than a deletion.

      Phase 09a's campaign workspace lost its five §12 steps to Session D and
      its payout and listing-fee panels to Session E, so there is nothing left
      for it to render — and keeping it would be a second surface over the same
      money, which is exactly what one address for §13 and §24.6 exists to stop.

      The address stays because things point at it that this session does not
      own: the §27.3/§27.4 campaign emails sent since Phase 12, Appendix C's
      §34 walkthrough steps, and any link a Founder kept. `/draft/:token/vetting`
      was retired the same way in Session C.
    */
    path: 'campaigns/:campaignId/workspace',
    element: <WorkspaceRedirect />,
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
    // Phase 17a (§20, DNA §5.2, §5.3). The Founder's live campaign home —
    // Glance, one ranked Act, Explore. Beside the other campaign surfaces,
    // outside both shells: §26 licenses dashboard density in Admin only, and
    // this is deliberately a chronological workspace rather than a widget grid.
    path: 'campaigns/:campaignId/home',
    element: <CampaignHome />,
  },
  {
    // Phase 18b (§21, §33.7.11). The Founder's campaign results — the waiting
    // state until `Results ready` fires, then every §21 number with the
    // Admin-reviewed "what this does and does not prove" section.
    path: 'campaigns/:campaignId/results',
    element: <CampaignResults />,
  },
  {
    // Phase 21a (§22.4–§22.6). The Founder's fulfillment surface — the four
    // §22.5 obligations with their real state, the delivery-commitment history
    // with the original preserved first, the §22.6 change path that applies,
    // and the Day 14 checklist. Beside the other campaign surfaces, outside
    // both shells.
    path: 'campaigns/:campaignId/fulfillment',
    element: <Fulfillment />,
  },
  {
    // Phase 22c (§27.7). The first ACCOUNT-level address either role has had —
    // every other authenticated route in the product is scoped to a campaign
    // or an association, because until now everything a Founder or Creator did
    // belonged to one campaign. The digest preference belongs to the person.
    //
    // Deliberately NOT on the campaign home: §27.7 says notification history
    // must not turn the Founder home into a widget dashboard or override the
    // one ranked Act item, and its own address is what makes that structural.
    path: 'settings/notifications',
    element: <FounderNotificationSettings />,
  },
    ],
  },
  {
    // The Creator's half of the same page. Its own one-route guard group rather
    // than being moved up into the Creator block, so the Creator routes stay in
    // one contiguous run in the order they were built.
    element: (
      <RequireRole allow={['affiliate']} signInPath="/signin">
        <Outlet />
      </RequireRole>
    ),
    children: [
      {
        path: 'creator/settings/notifications',
        element: <CreatorNotificationSettings />,
      },
    ],
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
