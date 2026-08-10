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
 * ── Three of the four sections are parked, and they are still shown ─────────
 * Today, Campaigns, and Creators have no workspace yet. Hiding them would make
 * the shell describe a one-section product; showing them enabled would claim a
 * capability that does not exist (§1.4). So they are `aria-disabled`, still
 * reachable by keyboard, and each one names what it is when pressed. Founders
 * is the only real destination, so it is the only real link — a control that
 * navigates is an anchor, and a control that explains itself is a button.
 *
 * ── The environment chip never claims a mode it did not check ───────────────
 * `TEST MODE` is the single most consequential sentence this page could say,
 * and a hardcoded chip says it whether or not anybody asked. So it renders only
 * from `identity.environment`, and its absence renders nothing at all.
 *
 * ── The session gate is a rendering convenience, not a security control ─────
 * `/api/admin/me` decides whether an Admin is signed in, and every other route
 * re-checks independently on the server. This component would be pointless to
 * bypass: doing so would render empty surfaces whose data requests all 401.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Button, StatePanel } from '../../components/index.js';
import {
  fetchAdminIdentity,
  signOut,
  AdminRequestError,
  type AdminEnvironment,
  type AdminIdentity,
} from './api.js';
import { AdminSignIn } from './AdminSignIn.js';
import { useParkedControl } from './founders/parked.js';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** Signed in, but without a registered TOTP factor — §5.1 admits nobody. */
  | { status: 'mfa_required'; title: string; whatHappened?: string | undefined; next?: string | undefined }
  | { status: 'signed_in'; identity: AdminIdentity };

export function AdminLayout() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const identity = await fetchAdminIdentity();
      setSession({ status: 'signed_in', identity });
    } catch (error) {
      if (error instanceof AdminRequestError) {
        if (error.detail.error === 'mfa_enrollment_required') {
          setSession({
            status: 'mfa_required',
            title: error.detail.title,
            whatHappened: error.detail.whatHappened,
            next: error.detail.next,
          });
          return;
        }
      }
      setSession({ status: 'signed_out' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (session.status === 'loading') {
    return (
      <AdminFrame>
        <StatePanel
          state="Checking your session"
          whatHappened="Proovd is confirming who you are before showing anything."
          next="The panel appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin panel"
        />
      </AdminFrame>
    );
  }

  if (session.status === 'signed_out') {
    return (
      <AdminFrame>
        <AdminSignIn onSignedIn={load} />
      </AdminFrame>
    );
  }

  if (session.status === 'mfa_required') {
    return (
      <AdminFrame>
        <StatePanel
          state={session.title}
          whatHappened={
            session.whatHappened ??
            'Admin accounts require an authenticator app. This one does not have it yet.'
          }
          next={session.next ?? 'Register an authenticator app, then sign in again.'}
          owner="You"
          nextUpdate="When you finish enrolling"
          action={
            <Button tier="tertiary" onClick={() => void signOut().then(load)}>
              Sign out
            </Button>
          }
          reference="Admin account security"
          ring
        />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame identity={session.identity} onSignOut={() => void signOut().then(load)}>
      <Outlet />
    </AdminFrame>
  );
}

interface AdminFrameProps {
  children: ReactNode;
  identity?: AdminIdentity;
  onSignOut?: () => void;
}

function AdminFrame({ children, identity, onSignOut }: AdminFrameProps) {
  const parked = useParkedControl();

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
          <button type="button" className="navlink" {...parked('tabs')}>
            Today
          </button>
          {/* The one section that exists, and therefore the one real link. */}
          <NavLink
            to="/admin/founders"
            className={({ isActive }) => (isActive ? 'navlink is-active' : 'navlink')}
          >
            Founders
          </NavLink>
          <button type="button" className="navlink" {...parked('tabs')}>
            Campaigns
          </button>
          <button type="button" className="navlink" {...parked('tabs')}>
            Creators
          </button>
        </nav>

        <div className="topbar__right">
          <EnvironmentChip environment={identity?.environment} />
          {/* Parked: the §26.5 ledger, money controls, and risk panels are
              their own workspaces and are supplied separately. */}
          <Button tier="secondary" small {...parked('tabs')}>
            Explore
          </Button>
          {identity ? (
            <>
              <span className="envmeta">{identity.name || identity.email}</span>
              <Button tier="tertiary" small onClick={onSignOut}>
                Sign out
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <main className="views" id="admin-main" tabIndex={-1}>
        {/* One rendered route rather than the prototype's swapped views: React
            Router owns the swap, so `is-active` is a constant here. */}
        <section className="view is-active">{children}</section>
      </main>
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
