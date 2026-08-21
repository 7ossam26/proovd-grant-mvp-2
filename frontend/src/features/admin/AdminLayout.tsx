/**
 * The Admin shell — Spec §26, DNA §5.2.
 *
 * §26 licenses dashboard density **here and nowhere else**: the Admin panel
 * monitors many users, cases, deadlines, money states, and risks at once, and
 * it is the only surface in the MVP that may look like a dashboard. That
 * licence does not repeal DNA §5.14 — complexity is staged into Glance / Act /
 * Explore, never amputated and never dumped in a wall.
 *
 * Concretely, in this shell: the wordmark and the environment chip are Glance,
 * the four sections are Act, and everything below is the surface's own Explore.
 *
 * ── The shell stands outside the public site chrome ─────────────────────────
 * No `PublicLayout`, no site header, no footer sitemap, no live-chat gate.
 * Phase 06's trap: "the Admin panel is a dashboard; nothing else is" — sharing
 * chrome is how its density leaks into a Founder surface.
 *
 * ── This component is now PROTECTED-ONLY, and that is the fix ───────────────
 * It used to carry three branches: loading, signed-out, and signed-in — and the
 * signed-out one rendered `AdminSignIn` INSIDE the frame. So the wordmark, the
 * section tabs, the Explore control, and the environment chip were on screen
 * for anybody who typed `/admin`. No data leaked; every request behind them
 * 401s. But an operations chrome shown to a stranger tells them what exists,
 * and the URL said `/admin` while what you were looking at was a login form.
 *
 * There is no signed-out branch any more. `RequireRole` in `routes.tsx` decides
 * before this component renders at all, and sends an unauthenticated visitor to
 * `/admin/signin` — its own address, its own minimal shell. The absence of the
 * branch is what keeps the leak from coming back: there is nowhere to put it.
 *
 * ── The sections were removed to be rebuilt (2026-08-21) ────────────────
 * Every screen below this shell was deleted so the panel can be rebuilt one
 * section at a time. The nav survived deliberately: it is the map of what the
 * panel IS, and dismantling it too would leave nothing to rebuild against.
 * Each tab is still a real link to a real address; what it renders is
 * `SectionPlaceholder` until its own section is built.
 *
 * The Explore control went with them — it was the last `useParkedControl`
 * caller, and a control that exists only to explain why it does nothing is
 * exactly the dead code this removal was asked to avoid. The server is
 * untouched: every `/api/admin/*` router is still mounted and still tested.
 *
 * ── The environment chip never claims a mode it did not check ───────────────
 * `TEST MODE` is the single most consequential sentence this page could say,
 * and a hardcoded chip says it whether or not anybody asked. So it renders only
 * from `identity.environment`, and its absence renders nothing at all.
 *
 * ── None of this is the security boundary ───────────────────────────────────
 * `/api/admin/*` is decided by `requireAdmin` on the server for every request.
 * This component decides what is drawn.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button, Measure, Section, StatePanel } from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { invalidateSession } from '../../lib/session.js';
import {
  fetchAdminIdentity,
  signOut,
  AdminRequestError,
  type AdminEnvironment,
  type AdminIdentity,
} from './api.js';
import { TasksPanel } from './tasks/TasksPanel.js';

type IdentityState =
  | { status: 'loading' }
  | { status: 'ready'; identity: AdminIdentity }
  /**
   * `RequireRole` said this session is an Admin and `/api/admin/me` then
   * refused it. In practice that means the session ended in the moment between
   * the two reads.
   *
   * It is rendered as a terminal state with a LINK, deliberately, rather than
   * an automatic redirect to `/admin/signin`. An automatic one is a redirect
   * loop waiting for the two reads to disagree persistently: the door would see
   * a valid Admin session, send them to the panel, the panel would be refused
   * again, and the two would bounce forever with nothing on screen. A link ends
   * the loop by requiring a person, and it says what happened on the way.
   */
  | { status: 'signed_out' }
  | { status: 'unavailable'; title: string; whatHappened: string; next: string };

export function AdminLayout() {
  const navigate = useNavigate();
  const [state, setState] = useState<IdentityState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const identity = await fetchAdminIdentity();
      setState({ status: 'ready', identity });
    } catch (error) {
      const detail = error instanceof AdminRequestError ? error.detail : null;
      if (detail && (detail.status === 401 || detail.status === 403)) {
        setState({ status: 'signed_out' });
        return;
      }
      setState({
        status: 'unavailable',
        title: detail?.title ?? 'Proovd could not be reached',
        whatHappened:
          detail?.whatHappened ??
          'The request that loads the Admin panel did not come back. Nothing has been changed.',
        next: detail?.next ?? 'Reload this page. If it keeps happening, contact support.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The cached identity is cleared as soon as the two reads disagree, so the
  // next thing the person does re-asks the server rather than acting on an
  // answer that has already been contradicted. The navigation is NOT automatic
  // — see the note on `signed_out` above.
  useEffect(() => {
    if (state.status === 'signed_out') invalidateSession();
  }, [state.status]);

  const onSignOut = useCallback(async () => {
    try {
      await signOut();
    } finally {
      // Cleared whether or not the call succeeded. A cached identity that
      // outlives the cookie is the client/server disagreement this whole
      // module exists to end — and if sign-out failed, the next server request
      // will refuse anyway, which is the truthful outcome.
      invalidateSession();
      navigate('/admin/signin', { replace: true });
    }
  }, [navigate]);

  // Both of the states below render OUTSIDE `AdminFrame`, deliberately. A
  // person who is not — or is no longer — an authorized Admin never sees the
  // shell, including for the fraction of a second the identity read takes.
  if (state.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening the Admin panel"
            whatHappened="Proovd is confirming your account before showing anything."
            next="The panel appears as soon as that comes back."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Admin panel"
          />
        </Measure>
      </Section>
    );
  }

  if (state.status === 'signed_out') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Your session has ended"
            whatHappened="Proovd checked your account and the Admin panel would not open for it. That usually means the session expired while this page was loading."
            next="Sign in again and you will come straight back here. Nothing has been changed."
            owner="You"
            nextUpdate="When you sign in"
            action={
              <Button tier="primary" onClick={() => navigate('/admin/signin', { replace: true })}>
                Sign in to Proovd Admin
              </Button>
            }
            reference="Admin panel"
            getHelp={{ href: supportMailto('My Admin session keeps ending') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state={state.title}
            whatHappened={state.whatHappened}
            next={state.next}
            owner="Proovd"
            nextUpdate="When you reload"
            action={
              <Button tier="primary" onClick={() => void load()}>
                Try again
              </Button>
            }
            reference="Admin panel"
            getHelp={{ href: supportMailto('The Admin panel will not load') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  return (
    <AdminFrame identity={state.identity} onSignOut={() => void onSignOut()}>
      <Outlet />
    </AdminFrame>
  );
}

interface AdminFrameProps {
  children: ReactNode;
  /**
   * Required, not optional. The frame used to accept `undefined` so it could
   * wrap the signed-out sign-in form; making it required is what makes it
   * impossible to render this chrome without an authenticated identity behind
   * it.
   */
  identity: AdminIdentity;
  onSignOut: () => void;
}

function AdminFrame({ children, identity, onSignOut }: AdminFrameProps) {
  return (
    <>
      <a className="skip-link" href="#admin-main">
        Skip to content
      </a>

      <header className="topbar">
        <span className="wordmark">
          proovd<span className="adm">Admin</span>
        </span>

        <nav className="topnav" aria-label="Admin sections">
          {/*
            The five sections the panel is being rebuilt as (2026-08-21).

            Today, Money & Fulfillment and Live mode were removed from the nav
            by product direction. Their BACKENDS are untouched and still
            mounted — `/api/admin/today`, the close/refund/dispute routers and
            `/api/admin/live-mode` all still answer and are still driven by
            their §33 suites and by pg-boss jobs. What went is the tab.

            `Affiliates` is a deliberate rename of what this tab said until
            today (`Creators`), and it does not breach §3.1. That rule governs
            what reaches a FOUNDER or a BACKER; the Admin panel is internal,
            and the workspace behind this tab has used the Affiliate record
            vocabulary since 2026-08-11 for exactly that reason. The tab and
            the record now agree.

            Its ADDRESS stays `/admin/creators`. Five backend files compose
            links to it — the §27 mid-campaign notices, the campaign hub’s
            roster link, the §26.8 support context, and the Tasks reference
            register — and their tests assert those strings. Renaming the path
            would mean editing backend files this removal deliberately does
            not touch. The label is what a person reads; the path is what the
            product already points at.
          */}
          <NavLink
            to="/admin/founders"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Founders
          </NavLink>
          <NavLink
            to="/admin/creators"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Affiliates
          </NavLink>
          <NavLink
            to="/admin/backers"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Backers
          </NavLink>
          <NavLink
            to="/admin/campaigns"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Campaigns
          </NavLink>
          <NavLink
            to="/admin/support"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Support
          </NavLink>
        </nav>

        <div className="topbar__right">
          <EnvironmentChip environment={identity.environment} />
          <span className="envmeta">{identity.name || identity.email}</span>
          <Button tier="tertiary" small onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="views" id="admin-main" tabIndex={-1}>
        {/* One rendered route rather than the prototype's swapped views: React
            Router owns the swap, so `is-active` is a constant here. */}
        <section className="view is-active">{children}</section>
      </main>

      {/*
        The Tasks panel, built 2026-08-16. A sibling of `main`, deliberately:
        it floats on its own layer (850–899 band) and never takes part in the
        page's layout, and mounting it here — inside `RequireRole`, inside
        `MotionProvider`, above every route — is what makes it render on every
        Admin address, on none outside `/admin`, and survive navigation
        between sections. It is a note panel, not a queue: no assignee, no
        schedule, no message (§30) — see `features/admin/tasks/TasksPanel.tsx`.
      */}
      <TasksPanel />
    </>
  );
}

/**
 * The mode chip and the two facts beside it.
 *
 * All three come from the server or none of them render. §34 gates live money
 * on somebody having verified that test and live are separated, and a chip that
 * asserts `TEST MODE` from a string literal is the reassurance that check
 * exists to replace.
 */
function EnvironmentChip({ environment }: { environment: AdminEnvironment | undefined }) {
  if (!environment) return null;

  const lastWebhook = environment.webhooksLastEventAt
    ? `last webhook ${new Date(environment.webhooksLastEventAt).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : 'no webhook received yet';

  return (
    <>
      <span className="envchip">
        {environment.stripeMode === 'live' ? 'LIVE MODE' : 'TEST MODE'}
      </span>
      <span className="envmeta">
        {environment.stripeApiVersion} · {lastWebhook}
      </span>
    </>
  );
}
