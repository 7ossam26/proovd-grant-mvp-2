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
 * `twoFactorRedirect` is Better Auth telling us the password was right and the
 * session is not issued yet, because this account has a registered second
 * factor. §5.1 makes that mandatory for Admin and §5.2/§5.3 give neither of
 * the other roles one — but this client does not assume that, because an
 * account's factor is a fact about the account, not about the route it signs
 * in through.
 */
export interface PasswordSignInResult {
  twoFactorRedirect?: boolean;
}

export const signInWithPassword = (
  email: string,
  password: string,
): Promise<PasswordSignInResult> =>
  call('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const verifyTotp = (code: string): Promise<unknown> =>
  call('/api/auth/two-factor/verify-totp', {
    method: 'POST',
    body: JSON.stringify({ code }),
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

/* ── Public Founder signup ────────────────────────────────────────────────── */

/**
 * §10's three documents, in §10's order. Restated here rather than imported
 * from the backend for the reason every shared fact in this repo is restated
 * across that boundary — the backend compiles under its own `rootDir` and
 * ships only `dist`. The labels come from the shared policy register, so the
 * text a person accepts is the same text the footer links to.
 */
export const SIGNUP_POLICY_SLUGS = ['terms', 'aup', 'privacy'] as const;
export type SignupPolicySlug = (typeof SIGNUP_POLICY_SLUGS)[number];

export type SignupAvailability =
  | { open: true }
  | { open: false; reason: 'policies_unpublished' | 'unavailable'; missing?: string[] };

export const fetchSignupAvailability = (): Promise<SignupAvailability> =>
  call<SignupAvailability>('/api/account/signup');

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  acceptedPolicySlugs: readonly string[];
}

/**
 * Creates the account and nothing else — deliberately no session. The surface
 * signs in afterwards through `signInWithPassword`, so there is exactly one
 * path in the product that issues a session.
 */
export const createAccount = (input: SignupInput): Promise<{ ok: true; email: string }> =>
  call('/api/account/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
