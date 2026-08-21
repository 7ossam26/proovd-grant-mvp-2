/**
 * The Admin API client — reduced to its shared core (2026-08-21).
 *
 * The Admin panel's screens were removed so the panel can be rebuilt section by
 * section. Everything in this module that existed to serve those screens — the
 * Founder workspace payload and its ~40 calls, the invitation machinery, the
 * campaign workspace, the access and deletion records — went out with them. A
 * client function with no caller is a claim that a surface exists (§1.4), and
 * this module is where that claim would be least visible.
 *
 * ── What is left, and why each part survives a gutting ──────────────────────
 * 1. `AdminError` / `AdminRequestError` / `call` — despite living under
 *    `features/admin`, this is the app's shared fetch helper. The Founder flow,
 *    the Creator, Draft, Payouts and Auth clients and `lib/useAutosave` all
 *    import the error class from here to classify a refusal. It is not
 *    Admin-specific and never was; only its address is.
 * 2. `AdminEnvironment` / `AdminIdentity` / `fetchAdminIdentity` / `signOut` —
 *    the session, which `AdminLayout` reads before it renders any chrome. The
 *    shell survives the rebuild, so its identity read does too.
 * 3. `DraftLanding` / `fetchDraftLanding` — the one un-authenticated read
 *    (`/api/draft/:token`), consumed by `InviteClaim`, `ReachStep` and
 *    `ConfirmSolution` in the Founder flow. It has always borrowed this
 *    module's fetch helper and has nothing to do with the Admin panel.
 *
 * ── The server is untouched ─────────────────────────────────────────────────
 * Every `/api/admin/*` router is still mounted and still tested. This file
 * shrank because its callers went; the endpoints did not. A rebuilt section
 * adds its calls back here (or, better, in its own module beside its surface).
 *
 * One rule still shapes what returns: the server decides, and its refusal is
 * what the Admin reads. §1.1 requires server-side authorization on every
 * surface, so nothing here treats a client-side check as sufficient, and
 * nothing invents a friendlier message over a server one — the server already
 * answers §27.1's six questions in `whatHappened` / `next` / `action`, and
 * paraphrasing it in the browser is how the two start disagreeing.
 */

export interface AdminError {
  error: string;
  title: string;
  whatHappened?: string;
  next?: string;
  action?: string;
  support?: string;
  status: number;
}

export class AdminRequestError extends Error {
  readonly detail: AdminError;
  constructor(detail: AdminError) {
    super(detail.title);
    this.name = 'AdminRequestError';
    this.detail = detail;
  }
}

/**
 * A failure with no usable body — the network dropped, or something returned
 * HTML. §30 forbids a generic error with no data status and no recovery, so
 * even this one says what is and is not known.
 */
function opaqueFailure(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so nothing was saved and nothing was changed.'
        : `The server answered ${status} with no explanation, so it is not certain whether the change was applied.`,
    next:
      status === 0
        ? 'Check your connection and try again.'
        : 'Reload this page to see the current stored values before trying again.',
  };
}

/**
 * Exported for `creators/api.ts`, which is the Creator workspace's own client.
 *
 * One fetch helper, not two: §27.1's answers arrive in `whatHappened` / `next`
 * / `action`, and a second `call` would be a second place for the rule that the
 * server's refusal is rendered verbatim to drift.
 */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaqueFailure(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title
        ? { ...(body as AdminError), status: response.status }
        : opaqueFailure(response.status),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Session ──────────────────────────────────────────────────────────────── */

/**
 * The environment facts the shell's chip reports.
 *
 * Optional, and rendered only when it arrives. §34 forbids claiming a mode
 * nobody checked, and a chip hardcoded to `TEST MODE` says the one thing that
 * must never be said by a page that did not ask — so the absence of this key
 * renders no chip at all rather than a reassuring default.
 */
export interface AdminEnvironment {
  stripeMode: 'test' | 'live';
  /** The pinned §32.2 API version, so a mismatch is visible without a deploy log. */
  stripeApiVersion: string;
  /** The last signed webhook this deployment accepted, or null if none yet. */
  webhooksLastEventAt: string | null;
}

export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
  sessionEstablishedAt: string;
  prerequisiteKeys: string[];
  environment?: AdminEnvironment;
}

export const fetchAdminIdentity = (): Promise<AdminIdentity> =>
  call<AdminIdentity>('/api/admin/me');

/*
 * Signing in is NOT here any more.
 *
 * `signInWithPassword` and `verifyTotp` used to live in this module, which put
 * two implementations of "sign in" in the codebase — one for Admin, one for
 * everybody else — differing in their refusal wording and in how they
 * classified a failure. That is the shape a leak takes: the copy nobody is
 * looking at grows a helpful branch.
 *
 * Both doors now call `surfaces/auth/api.ts`, and both render the refusal from
 * `surfaces/auth/refusal.ts`. The second factor `verifyTotp` drove was removed
 * on 2026-08-10 (see `backend/src/auth/auth.ts`).
 */

export const signOut = (): Promise<unknown> =>
  call('/api/auth/sign-out', { method: 'POST', body: JSON.stringify({}) });
/* ── The draft landing state (§7) — no account, no session ────────────────── */

export interface DraftLanding {
  recipientName: string;
  /** The address the invitation reached — the Founder's own (§26.2). */
  recipientEmail: string | null;
  productName: string;
  whatWeUnderstood: string | null;
  senderName: string | null;
  expectedSetupTime: string | null;
  /** §7's "when we last spoke", as an ISO instant. Null when unrecorded. */
  lastContactAt: string | null;
  reference: string;
  processSummary: string[];
  noGuarantee: string;
}

/* The invite, reach and solution screens share this immutable-in-flow read.
   Reusing it prevents a route transition from exposing a loading panel while
   the next screen repeats the same request. A full reload starts fresh. */
const draftLandingCache = new Map<string, DraftLanding>();

export const fetchDraftLanding = async (token: string): Promise<DraftLanding> => {
  const cached = draftLandingCache.get(token);
  if (cached) return cached;
  const draft = await call<DraftLanding>(`/api/draft/${encodeURIComponent(token)}`);
  draftLandingCache.set(token, draft);
  return draft;
};
