/**
 * The one place the browser learns who is signed in — §5, §1.1.
 *
 * ── This is not a security boundary, and saying so is the point ─────────────
 * Proovd's frontend is a static SPA. `backend/src/app.ts` serves the same
 * `index.html` to everybody, so nothing here can withhold data from anyone —
 * there is no data in it to withhold. Every guard in this module decides what
 * to RENDER. Whether a request may be read or written is decided by
 * `backend/src/auth/guards.ts` and by each handler's own ownership scoping, on
 * the server, on every request, and it stays decided there if this file is
 * deleted, patched in devtools, or replaced by a hand-written fetch.
 *
 * What that buys is worth stating plainly, because it is easy to overclaim:
 *
 *  - It removes the protected-shell flash. Before this, `/admin` rendered the
 *    Admin wordmark, the section nav, and the environment control to anyone who
 *    typed the URL, and only then discovered they were signed out. Nothing
 *    secret leaked — every data request behind it 401s — but a page that shows
 *    an operations chrome to a stranger is telling them what exists.
 *  - It makes the already-signed-in cases deterministic instead of accidental.
 *  - It means one answer to "who is this?" instead of one per surface.
 *
 * ── One request, shared ─────────────────────────────────────────────────────
 * `/api/account/me` is the single source. The in-flight promise is cached at
 * module scope so a layout and the route inside it do not each ask; the
 * RESOLVED value is cached too, and `invalidateSession()` clears both. Sign-out
 * must call it — a cached identity that outlives the cookie is exactly the
 * "client state disagrees with the server" failure this module exists to end.
 */

import { useCallback, useEffect, useState } from 'react';
import { AccountRequestError, fetchAccount, type Account, type AccountRole } from '../surfaces/auth/api.js';

export type { Account, AccountRole };

/**
 * `anonymous` and `unavailable` are deliberately different answers.
 *
 * A 401 means "there is no session"; anything else means "we could not find
 * out". Collapsing them is how a server outage becomes a sign-in prompt that
 * asks somebody to retype a password which cannot help (§1.4) — the mistake
 * `CreatorCampaigns` already had to be corrected for.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'unavailable'; title: string; whatHappened: string; next: string }
  | { status: 'authenticated'; account: Account };

type Resolved = Exclude<SessionState, { status: 'loading' }>;

let cached: Resolved | null = null;
let inFlight: Promise<Resolved> | null = null;

/**
 * Bumped by every invalidation, and checked before a resolution is cached.
 *
 * Without it, `invalidateSession()` clears the cache and the read that was
 * ALREADY in flight then puts the old answer straight back — because its
 * `.then` still runs and still assigns. That is not a theoretical race: the
 * sequence is sign-out (which invalidates) landing while a guard's session read
 * from a moment earlier is still open, and the result is a browser that has
 * been signed out believing it is signed in.
 *
 * Nothing protected leaks from it — every request the stale identity produces
 * is refused by the server — but the person is shown a surface that then fails
 * to load, which is the client/server disagreement this module exists to end.
 */
let generation = 0;

/** Clears the cached identity. Call on sign-out, before navigating. */
export function invalidateSession(): void {
  cached = null;
  inFlight = null;
  generation += 1;
}

async function load(): Promise<Resolved> {
  try {
    const account = await fetchAccount();
    return { status: 'authenticated', account };
  } catch (caught) {
    const detail = caught instanceof AccountRequestError ? caught.detail : null;
    // Only 401/403 mean "not signed in". A 500, a dropped connection, or an
    // HTML error page mean the question was not answered.
    if (detail && (detail.status === 401 || detail.status === 403)) {
      return { status: 'anonymous' };
    }
    return {
      status: 'unavailable',
      title: 'Proovd could not be reached',
      whatHappened:
        detail?.whatHappened ??
        'The request that decides whether you are signed in did not come back, so nothing about your account is known right now.',
      next: detail?.next ?? 'Reload this page. If it keeps happening, contact support.',
    };
  }
}

/** Reads the session, sharing one request across every caller on the page. */
export function readSession(): Promise<Resolved> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    const startedAt = generation;
    inFlight = load().then((resolved) => {
      // Only cache an answer that is still about the current identity. A read
      // that started before an invalidation is answering a question nobody is
      // asking any more; the caller still gets its result (it asked for it),
      // but it must not become what the next caller reads.
      if (generation === startedAt) {
        cached = resolved;
        inFlight = null;
      }
      return resolved;
    });
  }
  return inFlight;
}

export interface SessionHook {
  session: SessionState;
  /** Re-reads from the server, discarding the cache. For sign-in and sign-out. */
  refresh: () => void;
}

export function useSession(): SessionHook {
  const [session, setSession] = useState<SessionState>(
    // A cache hit renders the answer on the first paint rather than flashing a
    // loading state on every navigation within an authenticated area.
    () => cached ?? { status: 'loading' },
  );

  const run = useCallback(() => {
    let live = true;
    void readSession().then((resolved) => {
      if (live) setSession(resolved);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => run(), [run]);

  const refresh = useCallback(() => {
    invalidateSession();
    setSession({ status: 'loading' });
    run();
  }, [run]);

  return { session, refresh };
}

/**
 * Where each role belongs after signing in. Re-exported from the api module so
 * there is one table, not two.
 */
export { roleHome } from '../surfaces/auth/api.js';
