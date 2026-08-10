/**
 * The account client — Spec §5.
 *
 * Session-bearing and role-agnostic, which is what separates it from the three
 * clients that already exist: `features/admin/api.ts` talks to `/api/admin`,
 * `surfaces/creator/api.ts` carries a raw invitation token, and
 * `surfaces/founder/api.ts` is scoped to one campaign. Sign-in happens before
 * any of those is meaningful — before there is a role, a campaign, or a token
 * — so it needs its own module rather than being smuggled into one of theirs.
 *
 * Nothing here stores a credential. The password is a form value, passed once
 * and never held; the session is Better Auth's cookie, which this code cannot
 * read and never tries to.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';

export { AdminRequestError as AccountRequestError };
export type { AdminError as AccountError };

function opaque(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so you are not signed in and nothing about your account changed.'
        : `The server answered ${status} with no explanation, so it is not certain whether you are signed in.`,
    next:
      status === 0
        ? 'Check your connection and try again.'
        : 'Reload this page. If it still will not sign you in, contact support.',
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      // The session cookie is the point of this client — every call either
      // establishes one or reads one.
      credentials: 'include',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaque(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title ? { ...(body as AdminError), status: response.status } : opaque(response.status),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Signing in (§5.1, §5.2, §5.3) ────────────────────────────────────────── */

/**
 * One call. A successful password establishes the session outright.
 *
 * There used to be a `twoFactorRedirect` flag here — Better Auth's way of
 * saying "the password was right and the session is not issued yet, because
 * this account has a registered second factor". The Admin second factor was
 * removed on 2026-08-10 (see `backend/src/auth/auth.ts`) and no role has one,
 * so the flag can no longer be returned and a client branch on it would be
 * dead code that looks like a security step.
 *
 * The response body is deliberately not inspected for anything else. What
 * matters — who this is, and therefore where they belong — is read from
 * `/api/account/me` afterwards, because the server decides that and the
 * sign-in response is not where the product should learn it.
 */
export const signInWithPassword = (email: string, password: string): Promise<unknown> =>
  call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const signOut = (): Promise<unknown> =>
  call('/api/auth/sign-out', { method: 'POST', body: JSON.stringify({}) });

/* ── Who is signed in (§5, §3.1) ──────────────────────────────────────────── */

/**
 * The INTERNAL role. §3.1 forbids rendering `affiliate` to anyone; it is used
 * to choose a route and never printed. `roleHome` below is the only thing that
 * reads it.
 */
export type AccountRole = 'admin' | 'founder' | 'affiliate';

export interface Account {
  role: AccountRole;
  email: string;
  name: string;
}

export const fetchAccount = (): Promise<Account> =>
  call<{ account: Account }>('/api/account/me').then((body) => body.account);

/**
 * Where each role belongs. §5.1 seeds Admins into the operations panel, §5.2
 * gives a Founder their campaigns, §5.3 gives a Creator theirs.
 *
 * Exhaustive by type: adding a fourth account actor would fail to compile here
 * rather than silently landing them on a Founder surface.
 */
export const roleHome: Record<AccountRole, string> = {
  admin: '/admin',
  founder: '/campaigns',
  affiliate: '/creator/campaigns',
};

/* ── The password reset (§5.5) ────────────────────────────────────────────── */

/**
 * §5.5's non-enumeration rule, applied to the ask.
 *
 * A reset request that answered differently for a known and an unknown address
 * is an account-existence oracle — the same one `token-rejection.ts` exists to
 * close and the same one §5.5's magic-link reissue answers with one frozen
 * acknowledgement. So this resolves on every outcome and the surface renders
 * one sentence: a hit, a miss, a malformed address, and a provider failure are
 * indistinguishable to the caller.
 *
 * The failure is deliberately swallowed rather than surfaced. That is a real
 * cost — a person whose reset genuinely failed is told it was sent — and it is
 * the cost §5.5 chooses, because the alternative publishes the account roster.
 * The failure is recorded server-side, where support can read it.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  try {
    await call('/api/auth/forget-password', {
      method: 'POST',
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    });
  } catch {
    // Intentionally ignored. See above.
  }
};

export const resetPassword = (token: string, newPassword: string): Promise<unknown> =>
  call('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
