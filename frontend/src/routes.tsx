import { Navigate, Outlet, useParams, type RouteObject } from 'react-router';
import { lazy, Suspense } from 'react';
import { POLICY_DOCUMENTS, founderDashboardPath, founderFlowPath } from '@proovd/shared';
import { MotionProvider } from './motion/MotionProvider.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { LinkUnavailable } from './surfaces/LinkUnavailable.js';
import { PublicLayout } from './features/public/PublicLayout.js';
import { Home } from './features/public/Home.js';
import { About } from './features/public/About.js';
import { HowPaymentsWork } from './features/public/HowPaymentsWork.js';
import { Safety } from './features/public/Safety.js';
import { SupportPage } from './features/public/SupportPage.js';
import { PolicyPage } from './features/public/PolicyPage.js';
import { NotFoundSurface, PageLoading } from './features/public/states.js';
import { CampaignPage } from './features/public/campaign/CampaignPage.js';
import { LiveCampaignPage } from './features/public/campaign/LiveCampaignPage.js';
import { AdminLayout } from './features/admin/AdminLayout.js';
import { AdminSignIn } from './features/admin/AdminSignIn.js';
import { SectionPlaceholder, AdminAddressRetired } from './features/admin/SectionPlaceholder.js';
import { RequireRole, RedirectIfAuthenticated } from './lib/routeGuards.js';
import { roleHome } from './lib/session.js';
import { CampaignBuild } from './surfaces/founder/CampaignBuild.js';
import { CampaignPreview } from './surfaces/founder/CampaignPreview.js';
import { FounderDashboard } from './surfaces/founder/FounderDashboard.js';
import { BackersPage } from './surfaces/founder/BackersPage.js';
import { SettingsPage } from './surfaces/founder/SettingsPage.js';
import { FounderCampaigns } from './surfaces/founder/FounderCampaigns.js';
import { SignIn, ResetPassword } from './surfaces/auth/SignIn.js';
import {
  CreatorNotificationSettings,
} from './surfaces/notifications/NotificationSettings.js';
import { StripeReturn } from './surfaces/payouts/StripeReturn.js';
import { WelcomeStep } from './surfaces/creator-flow/WelcomeStep.js';
import { PasswordStep } from './surfaces/creator-flow/PasswordStep.js';
import { ProfileStep } from './surfaces/creator-flow/ProfileStep.js';
import { ChannelStep } from './surfaces/creator-flow/ChannelStep.js';
import { VoiceStep as CreatorVoiceStep } from './surfaces/creator-flow/VoiceStep.js';
import { PresenceStep } from './surfaces/creator-flow/PresenceStep.js';
import { VerifyStep } from './surfaces/creator-flow/VerifyStep.js';
import { AgreeStep } from './surfaces/creator-flow/AgreeStep.js';
import { DoneStep } from './surfaces/creator-flow/DoneStep.js';
import { CreatorHome } from './surfaces/creator-app/CreatorHome.js';
import { CreatorWork } from './surfaces/creator-app/CreatorWork.js';
import { CreatorEarnings } from './surfaces/creator-app/CreatorEarnings.js';
import { CreatorResources } from './surfaces/creator-app/CreatorResources.js';
import { CreatorSettings } from './surfaces/creator-app/CreatorSettings.js';
import { CreatorAppShell } from './surfaces/creator-app/CreatorAppShell.js';
import { CreatorCampaignKit } from './surfaces/creator/CreatorCampaigns.js';
import { CreatorPitches } from './surfaces/creator-app/CreatorPitches.js';
import { CreatorPitch } from './surfaces/creator-app/CreatorPitch.js';
import { CreatorCampaignClose } from './surfaces/creator/CreatorCampaignClose.js';
import { InviteClaim } from './surfaces/founder-flow/InviteClaim.js';
import {
  ProblemConfirm,
  SolutionConfirm,
} from './surfaces/founder-flow/ConfirmAnswer.js';
import { ReachStep } from './surfaces/founder-flow/ReachStep.js';
import { CampaignTypeStep } from './surfaces/founder-flow/CampaignTypeStep.js';
import { BackerPage } from './features/public/backer/BackerPage.js';
import {
  FollowConfirmPage,
  FollowStopPage,
} from './features/public/campaign/FollowAction.js';
import { EmailStep } from './surfaces/founder-flow/EmailStep.js';
import { CodeStep } from './surfaces/founder-flow/CodeStep.js';
import { ConfirmProblem } from './surfaces/founder-flow/ConfirmProblem.js';
import { ConfirmSolution } from './surfaces/founder-flow/ConfirmSolution.js';
import { PositioningStep } from './surfaces/founder-flow/PositioningStep.js';
import { VisualsStep } from './surfaces/founder-flow/VisualsStep.js';
import { BrandingStep } from './surfaces/founder-flow/BrandingStep.js';
import { ColorStep } from './surfaces/founder-flow/ColorStep.js';
import { InterviewStep } from './surfaces/founder-flow/InterviewStep.js';
import { StoryStep } from './surfaces/founder-flow/StoryStep.js';
import { SocialsStep } from './surfaces/founder-flow/SocialsStep.js';
import { LastLook } from './surfaces/founder-flow/LastLook.js';
import { DetailsStep } from './surfaces/founder-flow/DetailsStep.js';
import { PayoutsStep } from './surfaces/founder-flow/PayoutsStep.js';
import { FeeStep } from './surfaces/founder-flow/FeeStep.js';
import { CreatorPaymentStep } from './surfaces/founder-flow/CreatorPaymentStep.js';
import { VoiceStep } from './surfaces/founder-flow/VoiceStep.js';
import { CreatorPayExplainerStep } from './surfaces/founder-flow/CreatorPayExplainerStep.js';
import { ThresholdStep } from './surfaces/founder-flow/ThresholdStep.js';
import { FaqsStep } from './surfaces/founder-flow/FaqsStep.js';
import { RewardsStep } from './surfaces/founder-flow/RewardsStep.js';
import { InReviewStep } from './surfaces/founder-flow/InReviewStep.js';
import { LiveStep } from './surfaces/founder-flow/LiveStep.js';
import { PasswordStep as FounderPasswordStep } from './surfaces/founder-flow/PasswordStep.js';
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
/**
 * The interim signup address Session B parked Phase 08b's page at.
 *
 * Retired to a redirect by Session C rather than deleted, because the address
 * shipped and somebody may have it open. `/agree` is the screen that took its
 * job.
 */
function CreatorFinishRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={`/creator-invitation/${encodeURIComponent(token)}/agree`} replace />;
}

/**
 * The old possible-creators result address. It pointed at the claim until
 * 2026-08-20, when the match and claim screens were removed from the flow;
 * a bookmarked address now lands on Positioning, the last page of the token.
 */
function DraftResultRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={founderFlowPath('positioning', token)} replace />;
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

/**
 * The retired roster and Creator-readiness addresses (Founder Dashboard Session
 * C, 2026-08-19). Chapter 1 absorbed both, so a §27 email or a bookmark minted
 * before the rebuild lands on the chapter that now holds its content.
 */
function ChooseChapterRedirect() {
  const { campaignId = '' } = useParams();
  return <Navigate to={founderDashboardPath(campaignId, 'choose')} replace />;
}

/**
 * `/updates` retired into Chapter 2 (Founder Dashboard Session D, 2026-08-19).
 *
 * Two Founder surfaces over one live campaign would be two places to post the
 * same update — the reasoning that retired `/roster` into Chapter 1, `/vetting`
 * in the flow's Session C, and `/workspace` in its Session E. The address
 * survives its component because §27's campaign emails point at it.
 */
function LiveChapterRedirect() {
  const { campaignId = '' } = useParams();
  return <Navigate to={founderDashboardPath(campaignId, 'live')} replace />;
}

/**
 * `/results` and `/fulfillment` retired into Chapter 3 (Founder Dashboard
 * Session E, 2026-08-19).
 *
 * Two Founder surfaces over one campaign's money would be two places to read
 * an amount, which is the thing §33.8.13 exists to prevent. Both addresses
 * survive their components because §27's close and Day-14 emails point at
 * them, and because Appendix C's §34 walk steps name them.
 */
function PaidChapterRedirect() {
  const { campaignId = '' } = useParams();
  return <Navigate to={founderDashboardPath(campaignId, 'payouts')} replace />;
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
      /*
        §27.1, §27.8 — Founder Dashboard Session B (B5). `/support` was the
        `getHelp` target in every Founder Flow step, in `ErrorBoundary`, in
        §20's Act ranks and in the founder-home 404 body, and it 404ed: the
        only `support` path in this file was inside the `admin` group below,
        which makes it `/admin/support`.

        Inside `PublicLayout` and outside every guard, because the pages that
        link to it include the draft-token flow (no session until §10's claim)
        and a global error boundary that can catch anything. Sending somebody
        whose page just broke to a sign-in form is not a support path.
      */
      { path: 'support', element: <SupportPage /> },
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
      /*
        The five sections, every one a placeholder (2026-08-21).

        The panel is being rebuilt one section at a time, so its screens were
        removed and its nav was not. Each address below still resolves and
        still renders a heading and a state — §33.11 sweeps all five, and a
        route that resolved to nothing would fail that sweep on a missing
        heading rather than on anything real (§1.4).

        Today, Money & Fulfillment and Live mode left the nav by product
        direction. Their BACKENDS are untouched and still mounted, and their
        addresses now render `AdminAddressRetired` through the catch-all below
        rather than a blank shell.

        `Affiliates` keeps the `/admin/creators` PATH: five backend files
        compose links to it and their tests assert those strings, so the label
        is what changed and the address is what the product already points at.

        Each path is a splat (`section/*`) so a deep link still lands on its
        section rather than a blank page. The Tasks panel mints references
        like `/admin/creators/<id>?tab=...`, and §27's internal notices link to
        the same shapes; those addresses outlived their screens, and answering
        them with the section being rebuilt is truthful where nothing is not.

        The server is untouched. Every `/api/admin/*` router is still mounted
        and still tested, so a rebuilt section has its data on day one.
      */
      {
        path: 'founders/*',
        element: <SectionPlaceholder name="Founders" did="hold every Founder's record — their invitation, campaign, money and history" />,
      },
      {
        path: 'creators/*',
        element: <SectionPlaceholder name="Affiliates" did="hold every Affiliate's record — their verification, campaigns, earnings and standing" />,
      },
      {
        path: 'backers/*',
        element: <SectionPlaceholder name="Backers" did="list every pre-order beside the person who placed it" />,
      },
      {
        path: 'campaigns/*',
        element: <SectionPlaceholder name="Campaigns" did="summarise every campaign and link into the workspace that owned each decision" />,
      },
      {
        path: 'support/*',
        element: <SectionPlaceholder name="Support" did="run the support queue with its response promise, evidence and handoff notes" />,
      },
      /* Any other Admin address — including the three retired sections — keeps
         the shell and says so, rather than rendering an empty `Outlet`. */
      { path: '*', element: <AdminAddressRetired /> },
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
    /*
      The reach orbit (2026-08-20). Between the solution and the campaign
      path, which is where the reference's own screen order puts it.
    */
    path: 'draft/:token/reach',
    element: <ReachStep />,
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
    /*
      The reference's `probConfirm` — its `vetting` screen at `vStep` 0, which
      is where its `type` screen goes once the code lands. Built 2026-08-20 by
      product direction, for the problem alone. Not `ConfirmAnswer`: that is
      the reference's `[data-problem]`, a different composition over the same
      record. See `ConfirmProblem.tsx`.
    */
    path: 'draft/:token/confirm-problem',
    element: <ConfirmProblem />,
  },
  {
    /*
      The same reference component at `vStep` 1 — the last look at the
      solution. Built 2026-08-20 by product direction, between the problem and
      Positioning, which is where `stillMine`'s `afterSection({vStep:
      st.vStep+1})` puts it. Two addresses because a page here is an address;
      one component there because every difference is a ternary on `vStep`.
      See `ConfirmSolution.tsx`.
    */
    path: 'draft/:token/confirm-solution',
    element: <ConfirmSolution />,
  },
  {
    path: 'draft/:token/positioning',
    element: <PositioningStep />,
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
  /*
   * The Creator onboarding flow — Creator Flow v2 Session B (2026-08-19).
   *
   * One address per page, outside every shell and every guard, for
   * `CreatorFlowPage`'s reasons. `/creator-invitation/:token` does not move: it
   * is `AFFILIATE_CLAIM_PATH`, it is what the §8 invitation email points at,
   * and every later page hangs below it so the token travels in the path and
   * nowhere else (§28.1).
   *
   * `CREATOR_FLOW_PAGES` is the one list of these, read by the router, the help
   * drawer, and §33.11's flow register. A page here and not there has no help
   * card; a page there and not here is an address that 404s.
   */
  {
    path: 'creator-invitation/:token',
    element: <WelcomeStep />,
  },
  {
    path: 'creator-invitation/:token/password',
    element: <PasswordStep />,
  },
  {
    path: 'creator-invitation/:token/you',
    element: <ProfileStep />,
  },
  {
    path: 'creator-invitation/:token/channel',
    element: <ChannelStep />,
  },
  {
    path: 'creator-invitation/:token/voice',
    element: <CreatorVoiceStep />,
  },
  {
    path: 'creator-invitation/:token/presence',
    element: <PresenceStep />,
  },
  {
    path: 'creator-invitation/:token/verify',
    element: <VerifyStep />,
  },
  {
    path: 'creator-invitation/:token/agree',
    element: <AgreeStep />,
  },
  {
    /*
     * Phase 08b's compact signup lived here for the length of Session B, as the
     * interim tail of the flow. Session C built screens 4–8 and the claim, so
     * `CreatorSignup` is deleted and the address is a redirect — somebody may
     * have it open, and `/agree` is what it was standing in for.
     *
     * The Founder flow retired `/draft/:token/vetting` exactly this way.
     */
    path: 'creator-invitation/:token/finish',
    element: <CreatorFinishRedirect />,
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
    /*
     * Screen 8 of the Creator flow (§11, §33.2.2, §33.2.3) — Session C.
     *
     * Inside the session group and NOT at a `/creator-invitation/:token`
     * address, because the claim revokes the token: every stage-1 address
     * answers the one rejection from the instant the account exists. It is
     * `CREATOR_FLOW_PAGES`' one `param: 'none'` page for that reason.
     *
     * It is also the one signed-in Creator address deliberately OUTSIDE the app
     * shell below: it is the last screen of a full-bleed nine-screen sequence,
     * and a navigation rail on it would offer four ways out of a moment whose
     * whole job is to hand over to Home.
     */
    path: 'creator/welcome',
    element: <DoneStep />,
  },
  {
    /*
     * The Creator app, inside its own shell — Session E.
     *
     * A pathless layout route, the arrangement the guard above already uses and
     * for the same reason: chrome that has to be remembered on each new surface
     * is chrome that eventually is not. Session D built `CreatorAppShell` and
     * `CreatorHome` rendered it itself, so the four surfaces Session F added
     * shipped with no rail and no way back except the browser — a real defect,
     * found by this session's walk and fixed here rather than by adding a fifth
     * copy of the wrapper.
     */
    element: (
      <CreatorAppShell>
        <Outlet />
      </CreatorAppShell>
    ),
    children: [
  {
    /*
     * The Creator's two lists — `Active` and `Pitches` (Session E).
     *
     * Phase 08c's single list lived here and this replaces it at the same
     * address: the rail, Home, and §27.3's emails all point at it. Outside the
     * Admin shell and outside `PublicLayout` — §26 licenses dashboard density
     * in Admin only, and there is nothing here to browse.
     */
    path: 'creator/campaigns',
    element: <CreatorPitches />,
  },
  {
    /*
     * The Creator's home (Creator Flow v2 deviation 5, Session D).
     *
     * Its own address rather than a redirect from `/creator/campaigns`, because
     * the app shell it carries is what Sessions E and F hang the rest of the
     * sections off — and because a Creator who bookmarks it gets it back
     * (DNA §5.12).
     */
    path: 'creator/home',
    element: <CreatorHome />,
  },
  {
    // The one action §10 allows: `Review campaign`. Its own address, so a
    // Creator who bookmarks a campaign gets that campaign back.
    path: 'creator/campaigns/:associationId',
    element: <CreatorCampaignKit />,
  },
  {
    /*
     * Phase 12a (§14.1, §14.2, §33.2.6). The formal opportunity and the three
     * decisions, rebuilt in Session E as the reveal and the recap. Its own
     * address beside the kit: the kit is reading material, this is a commercial
     * decision, and a bookmark to either gets it back — including `?view=recap`,
     * which is why the walk is not something a reload makes you repeat.
     */
    path: 'creator/campaigns/:associationId/opportunity',
    element: <CreatorPitch />,
  },
  {
    /*
     * §17's active-partnership content list — the Creator's work surface.
     *
     * Rebuilt in Creator Flow v2 Session F at the SAME address Phase 14c gave
     * it: §27.3's emails, the Creators workspace, and whatever a Creator
     * bookmarked all point here, and moving it would have been a rename with
     * no benefit.
     */
    path: 'creator/campaigns/:associationId/partnership',
    element: <CreatorWork />,
  },
  {
    /*
     * Every campaign's money in one place (Creator Flow v2 deviation 5).
     *
     * A list of Appendix B.7 blocks from the one resolver, not a dashboard —
     * and with no withdrawal anywhere on it (§22.1).
     */
    path: 'creator/earnings',
    element: <CreatorEarnings />,
  },
  {
    // Deviation 4. Four guides that do not exist, and an interest record that
    // holds no campaign material and cannot become the §31.5 kit.
    path: 'creator/resources',
    element: <CreatorResources />,
  },
  {
    /*
     * §5.3's settings list, editable at last.
     *
     * `/creator/settings/notifications` keeps its own address — §27.7's control
     * shipped there in Phase 22c and is linked from every digest — and this
     * page embeds the same component, so the two cannot drift.
     */
    path: 'creator/settings',
    element: <CreatorSettings />,
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
    /*
      The reference's `[data-brand]` — the second half of the branding answer,
      its own address for the reason every page in this flow has one: `vStep` 4
      is two screens there (`brandStage`), and a position held in a component's
      state is a position a reload destroys (DNA §5.12).
    */
    path: 'campaigns/:campaignId/setup/color',
    element: <ColorStep />,
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
      Screen 16 — Your details. Added 2026-08-21, in the reference's own
      position: Last look's `allGood` is `{si: I('intake')}`, and `intake` is
      this page. Stage 3 — it writes the Founder's own account record and needs
      no `founder_seller` account, so it sits before the money below it.
    */
    path: 'campaigns/:campaignId/setup/details',
    element: <DetailsStep />,
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
    path: 'campaigns/:campaignId/setup/creator-pay-explainer',
    element: <CreatorPayExplainerStep />,
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
      The last page of the flow (2026-08-20, product direction).

      §10 took the password at a screen near the beginning; it is here now, and
      the account is created by submitting the §9 answers instead — §13's
      Stripe onboarding is keyed to a real user, so it could not wait.
      `backend/src/vetting/claim.ts` records the deviation in full.

      Inside the same Founder group as its twenty neighbours — no guard of its
      own, because by the time anybody reaches it they have had a session since
      submission, and a second `RequireRole` here would be a second answer to a
      question the group already asks.
    */
    path: 'campaigns/:campaignId/setup/password',
    element: <FounderPasswordStep />,
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
    /*
      Phase 12a's roster and Phase 13's Creator readiness, retired to redirects
      (Founder Dashboard Session C, 2026-08-19).

      Chapter 1 absorbed both: §14.5's card, the exact deadline, the full-refund
      outcome and §14.2's three responses, plus §16's thirteen-item checklist
      rendered as a section of the chapter. Two Founder surfaces over one roster
      would be two places to answer one proposal — the reasoning that retired
      `/draft/:token/vetting` in the flow's Session C and `/workspace` in its
      Session E. The addresses survive their components because §27.3/§27.4
      emails and Appendix C's §34 walk steps point at them.
    */
    path: 'campaigns/:campaignId/roster',
    element: <ChooseChapterRedirect />,
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
    // Retired with `/roster` above — Chapter 1 renders §16's readiness as a
    // section once somebody's terms are locked.
    path: 'campaigns/:campaignId/creator-readiness',
    element: <ChooseChapterRedirect />,
  },
  {
    /*
      Retired into Chapter 2 (Session D, 2026-08-19). Phase 14c's §18 authoring
      surface is now a panel of the Live chapter, beside the Glance it belongs
      under; the address survives its component because §27's campaign emails
      point at it.
    */
    path: 'campaigns/:campaignId/updates',
    element: <LiveChapterRedirect />,
  },
  {
    /*
      Founder Dashboard Session B (2026-08-19). The Founder's home, and the
      product's first non-Admin authenticated shell: four chapters — Choose,
      Live, Get paid, Wrap — at ONE address.

      The address does not move. `LiveStep`'s "Go to your campaign home" link,
      every §27 email that points here, and any bookmark all keep working; the
      chapter is `?chapter=` beneath it (DNA §5.12), so a position survives a
      reload without minting a second address for one campaign.

      All four chapters are built (Sessions C, D, E and F); `/roster`,
      `/creator-readiness`, `/updates`, `/results` and `/fulfillment` all
      redirect into them.
    */
    path: 'campaigns/:campaignId/home',
    element: <FounderDashboard />,
  },
  {
    /*
      Retired into Chapter 3 (Session E, 2026-08-19). Phase 18b's §21 results —
      the waiting state, every §21 number, and the Admin-reviewed "what this
      does and does not prove" — are now a panel of the Get paid chapter, beside
      the §22.3 schedule they decide. The address survives its component because
      §27's `Results ready` message points at it.
    */
    path: 'campaigns/:campaignId/results',
    element: <PaidChapterRedirect />,
  },
  {
    /*
      Retired into Chapter 3 (Session E, 2026-08-19). Phase 21a's four §22.5
      obligations, the commitment history with the original first, the §22.6
      change path, and the §22.4 Day 14 checklist are panels of the Get paid
      chapter. The address survives because §27's Day-14 and delivery messages
      point at it.
    */
    path: 'campaigns/:campaignId/fulfillment',
    element: <PaidChapterRedirect />,
  },
  {
    /*
      §19's operational share, §20's Explore section 10, and §25.7's ask
      (Founder Dashboard Session F, 2026-08-19).

      A PAGE rather than a chapter, which is the supplied reference's own
      architecture: a chapter's home is a hub, and the list of people behind the
      numbers is its own page reached by a link and left by a back control. It
      is linked from Chapter 2 (a live campaign has people to support) and from
      Chapter 4 (a finished one has rewards to deliver), so it belongs to
      neither and sits at its own address.
    */
    path: 'campaigns/:campaignId/backers',
    element: <BackersPage />,
  },
  {
    // Session G (§5.2). The eleven settings §5.2 names, at one address.
    //
    // The ACCOUNT-level address Phase 22c opened, widened to what §5.2
    // actually lists. Its reasoning is unchanged and still applies: it is
    // deliberately not on the campaign home, because §27.7 says notification
    // history must not turn the Founder home into a widget dashboard or
    // override the one ranked Act item, and its own address is what makes
    // that structural.
    //
    // Account-level rather than campaign-scoped, for the reason Phase 22c's
    // page recorded when it was the only one: `founder_claim_profiles` is
    // unique per campaign, so a Founder with two campaigns would otherwise
    // have two settings pages and correcting a phone number on one would
    // leave the other saying something else.
    path: 'settings',
    element: <SettingsPage />,
  },
  {
    // Phase 22c's own address, retired to a redirect.
    //
    // The digest control and the notification history are now a section of
    // `/settings` — two Founder surfaces over one preference would be two
    // places to answer one question, the reasoning that retired `/roster`,
    // `/updates`, `/results` and `/fulfillment` into the four chapters. The
    // address survives its page because it is the one account-level route the
    // product has had, and something may still point at it.
    path: 'settings/notifications',
    element: <Navigate to="/settings" replace />,
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
