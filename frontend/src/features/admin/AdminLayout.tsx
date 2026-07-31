/**
 * The Admin shell — Spec §26, DNA §5.2.
 *
 * §26 licenses dashboard density **here and nowhere else**: the Admin panel
 * monitors many users, cases, deadlines, money states, and risks at once, and
 * it is the only surface in the MVP that may look like a dashboard. That
 * licence does not repeal DNA §5.14 — complexity is staged into Glance / Act /
 * Explore, never amputated and never dumped in a wall.
 *
 * Concretely, in this shell: the header is Glance (who you are, whether the
 * live-mode gate is blocking), the nav is Act (the surfaces you work in), and
 * everything below is the surface's own Explore.
 *
 * ── The shell stands outside the public site chrome ─────────────────────────
 * No `PublicLayout`, no site header, no footer sitemap, no live-chat gate.
 * Phase 06's trap: "the Admin panel is a dashboard; nothing else is" — sharing
 * chrome is how its density leaks into a Founder surface.
 *
 * ── The session gate is a rendering convenience, not a security control ─────
 * `/api/admin/me` decides whether an Admin is signed in, and every other route
 * re-checks independently on the server. This component would be pointless to
 * bypass: doing so would render empty surfaces whose data requests all 401.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Button, Mode, StatePanel, Tag } from '../../components/index.js';
import {
  fetchAdminIdentity,
  signOut,
  AdminRequestError,
  type AdminIdentity,
} from './api.js';
import { AdminSignIn } from './AdminSignIn.js';

const NAV = [
  { to: '/admin/founders', label: 'Founders' },
  { to: '/admin/settings', label: 'Global configuration' },
  { to: '/admin/prerequisites', label: 'Production prerequisites' },
];

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** Signed in, but without a registered TOTP factor — §5.1 admits nobody. */
  | { status: 'mfa_required'; title: string; whatHappened?: string | undefined; next?: string | undefined }
  | { status: 'signed_in'; identity: AdminIdentity };

export function AdminLayout() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const location = useLocation();

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
    <AdminFrame
      identity={session.identity}
      onSignOut={() => void signOut().then(load)}
      currentPath={location.pathname}
    >
      <Outlet />
    </AdminFrame>
  );
}

interface AdminFrameProps {
  children: ReactNode;
  identity?: AdminIdentity;
  onSignOut?: () => void;
  currentPath?: string;
}

function AdminFrame({ children, identity, onSignOut }: AdminFrameProps) {
  return (
    <div className="admin">
      <a className="skip-link" href="#admin-main">
        Skip to content
      </a>

      <Mode kind="dark">
        <header className="admin-bar">
          <div className="admin-bar__inner">
            <p className="admin-bar__brand">
              Proovd <Tag variant="mint">Admin</Tag>
            </p>
            {identity ? (
              <div className="admin-bar__who">
                <span className="admin-bar__name">{identity.name || identity.email}</span>
                <Button tier="tertiary" small onClick={onSignOut}>
                  Sign out
                </Button>
              </div>
            ) : null}
          </div>
        </header>
      </Mode>

      {identity ? (
        <nav className="admin-nav" aria-label="Admin sections">
          <ul className="admin-nav__list">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'admin-nav__link is-current' : 'admin-nav__link'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <main className="admin-main" id="admin-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
