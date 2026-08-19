/**
 * The Creator app shell — Creator Flow v2 **deviation 5**, Session D, 2026-08-19.
 *
 * The rail, the menu drawer, and the notification drawer. It is the first
 * persistent chrome a Creator has ever had, and §26 is why it needed a recorded
 * deviation to exist at all: *"The Admin panel is the only dashboard-style
 * product in MVP."*
 *
 * ── Not the Admin shell, and not `PublicLayout` ────────────────────────────
 * `AdminFrame` licenses §26's density and carries the Tasks panel, the
 * environment cluster, and eight Admin sections; none of that belongs on a
 * customer surface. `PublicLayout` offers a nav bar of things to browse, and
 * there is nothing here to browse — §5.3 admits a Creator only through a
 * private invitation to a specific campaign.
 *
 * ── Every section is either reachable or explained ────────────────────────
 * `CREATOR_APP_SECTIONS` carries `href` XOR `unavailableBecause`, asserted in
 * both directions — the `CAMPAIGN_DESTINATIONS` arrangement. A section with no
 * address renders as a disabled item with a short honest line, and the full
 * reason one gesture away in the menu (DNA §5.12: Glance, then Explore). It is
 * `aria-disabled` rather than `disabled` so a keyboard user meets the
 * explanation a sighted user can see (§28.5) — the Support workspace's own
 * rule, and the reason it is still in the tab order.
 *
 * ── The notification drawer must not become a dashboard ───────────────────
 * It renders 22c's `NotificationHistory` against 22c's own client, so there is
 * no second read, no count, and no place to put a badge: the payload's keys are
 * `entries` and `nextCursor`, the router's only write verb is the digest
 * preference, and no `unread`/`read_at`/`last_opened_at` column exists. The
 * reference draws `Updates · 2 new` in two places and both are refused in
 * `CREATOR_APP_ABSENCES` — a badge would have to be computed from a column that
 * deliberately does not exist.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  CREATOR_APP_MENU_LABEL,
  CREATOR_APP_SECTIONS,
  CREATOR_APP_SIGN_OUT_LABEL,
  CREATOR_APP_UPDATES_LABEL,
  CREATOR_UPDATES_ARE_A_RECORD,
} from '@proovd/shared';
import { Button } from '../../components/Button.js';
import { Drawer } from '../../components/Drawer.js';
import { NotificationHistory } from '../notifications/NotificationHistory.js';
import { fetchNotificationHistory } from '../notifications/api.js';
import type { HistoryEntry } from '../notifications/NotificationHistory.js';
import { creatorSignOut } from '../creator/api.js';
import { invalidateSession } from '../../lib/session.js';

/** The one short line a disabled section shows in the rail. Never a date. */
const NOT_OPEN_YET = 'Not open yet';

function SectionList({ compact }: { compact: boolean }) {
  const { pathname } = useLocation();
  return (
    <ul className={compact ? 'cra-menu__list' : 'cra-rail__list'}>
      {CREATOR_APP_SECTIONS.map((section) => {
        const current = section.href
          ? pathname === section.href || pathname.startsWith(`${section.href}/`)
          : false;
        return (
          <li key={section.id}>
            {section.href ? (
              <Link
                className="cra-nav__item"
                to={section.href}
                {...(current ? { 'aria-current': 'page' as const } : {})}
              >
                {section.label}
              </Link>
            ) : (
              <span
                className="cra-nav__item cra-nav__item--off"
                aria-disabled="true"
                tabIndex={0}
              >
                <span>{section.label}</span>
                <span className="cra-nav__off">
                  {compact ? section.unavailableBecause : NOT_OPEN_YET}
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function UpdatesDrawer({ trigger }: { trigger: ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    // Read on open rather than on mount: the drawer is the only thing that
    // needs it, and a shell that fetched it everywhere would be a shell with a
    // number it could be tempted to render.
    if (entries || failed) return;
    void fetchNotificationHistory('creator')
      .then((page) => setEntries(page.entries))
      .catch(() => setFailed(true));
  }, [entries, failed]);

  return (
    <Drawer
      trigger={
        <button type="button" className="cra-nav__item" onClick={load}>
          {trigger}
        </button>
      }
      title={CREATOR_APP_UPDATES_LABEL}
    >
      <p className="cra-drawer__lede">{CREATOR_UPDATES_ARE_A_RECORD}</p>
      {failed ? (
        <p className="cra-drawer__lede" role="alert">
          We could not load what we have emailed you. Nothing is lost — the
          messages are in your inbox, and this list will load next time.
        </p>
      ) : entries === null ? (
        <p className="cra-drawer__lede">Loading what we have emailed you…</p>
      ) : (
        <NotificationHistory entries={entries} />
      )}
    </Drawer>
  );
}

export function CreatorAppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const onSignOut = useCallback(async () => {
    try {
      await creatorSignOut();
    } finally {
      // Cleared whether or not the call succeeded — `AdminLayout`'s reasoning:
      // a cached identity that outlives the cookie is exactly the client/server
      // disagreement `lib/session.ts` exists to end, and if sign-out failed the
      // next server request refuses anyway, which is the truthful outcome.
      //
      // §5.3, disagreement 24: this ENDS the session. The reference's
      // `signOut()` returns to step 0 of the onboarding wizard, which is a
      // prototype artifact — the invitation token was claimed and revoked when
      // the account was created, so there is nothing to return to.
      invalidateSession();
      navigate('/signin', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="cra">
      <nav className="cra-rail mode-dark" aria-label="Creator sections">
        <Link className="cra-rail__brand" to="/creator/home">
          <span className="cra-rail__mark" aria-hidden="true" />
          proovd
        </Link>
        <SectionList compact={false} />
        <div className="cra-rail__foot">
          <UpdatesDrawer trigger={CREATOR_APP_UPDATES_LABEL} />
          <button type="button" className="cra-nav__item" onClick={() => void onSignOut()}>
            {CREATOR_APP_SIGN_OUT_LABEL}
          </button>
        </div>
      </nav>

      <div className="cra-bar mode-dark">
        <Link className="cra-rail__brand" to="/creator/home">
          <span className="cra-rail__mark" aria-hidden="true" />
          proovd
        </Link>
        <div className="cra-bar__acts">
          <UpdatesDrawer trigger={CREATOR_APP_UPDATES_LABEL} />
          <Drawer
            trigger={
              <button type="button" className="cra-nav__item">
                {CREATOR_APP_MENU_LABEL}
              </button>
            }
            title={CREATOR_APP_MENU_LABEL}
          >
            <SectionList compact />
            <div className="cra-menu__foot">
              <Button tier="tertiary" onClick={() => void onSignOut()}>
                {CREATOR_APP_SIGN_OUT_LABEL}
              </Button>
            </div>
          </Drawer>
        </div>
      </div>

      <main className="cra-main" id="main">
        {children}
      </main>
    </div>
  );
}
