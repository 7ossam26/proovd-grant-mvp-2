/**
 * The token-scoped Founder client — Spec §9, §10, §28.1.
 *
 * Separate from the Admin client on purpose. These calls carry a raw token in
 * the URL and no session cookie; the Admin ones carry a session and no token.
 * One module doing both would eventually send one to the other's routes.
 *
 * ── The token is in the path and stays there ────────────────────────────────
 * §28.1 keeps the raw value in the delivered URL and nowhere else. Nothing here
 * writes it to storage, puts it in a query string that a Referer would carry to
 * a third party, or logs it. The server redacts it out of its own logs
 * (`token-routes.ts`); this side simply never copies it anywhere.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';

export { AdminRequestError as DraftRequestError };
export type { AdminError as DraftError };

function opaque(status: number): AdminError {
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
        ? 'Check your connection and try again. Everything you have typed is still on this page.'
        : 'Reload to see what is stored before trying again.',
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      // No credentials: a draft link grants access to one draft and nothing
      // else (§33.1.1), and sending a session cookie alongside it would be the
      // beginning of the two being confused.
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

const base = (token: string) => `/api/draft/${encodeURIComponent(token)}`;

/* ── The vetting sequence (simplified flow) ───────────────────────────────── */

export type CampaignTypeValue = 'pre_build' | 'pre_launch';

export interface FieldProvenance {
  supplier: 'proovd' | 'founder' | null;
  prefilledText?: string | null;
  prefilledAt?: string | null;
  firstEditedAt: string | null;
  lastEditedAt: string | null;
}

export interface VettingState {
  draftId: string;
  campaignId: string;
  /** §9 step 1, the Founder's own choice; pre-selected from Admin's where set. */
  selectedType: CampaignTypeValue | null;
  problem: string | null;
  solution: string | null;
  /** §9 step 4. Always the Founder's own words — never prefilled (§33.1.5). */
  competition: string | null;
  /**
   * A stored amount-of-views answer, where one exists. Retired from collection
   * on 2026-08-18; read-only here and asked for by no step.
   */
  views: import('@proovd/shared').ViewsRangeId | null;
  provenance: {
    problem: FieldProvenance;
    solution: FieldProvenance;
    competition: FieldProvenance;
  };
  lastSavedAt: string | null;
  resumeStep: string | null;
  submittedAt: string | null;
  completeness: Record<'problem' | 'solution' | 'competition', boolean>;
  campaignStatus: string;
  /** Founder Flow v2 Session C. A deployment fact, carried with the read. */
  transcription?: TranscriptionAvailability;
  lockedType: CampaignTypeValue | null;
  typeLockedAt: string | null;
}

/**
 * Whether dictation is available on this deployment, and why not when it is not.
 *
 * It rides the vetting read rather than being discovered at the microphone,
 * because a 503 at the point of use arrives after somebody has already pressed
 * record. The sentence is the port’s own, so the screen and the server log
 * cannot disagree about the reason.
 */
export type TranscriptionAvailability =
  | { available: true }
  | { available: false; absentBecause: string };
export interface VettingPatch {
  problem?: string | null;
  solution?: string | null;
  competition?: string | null;
  selectedType?: CampaignTypeValue | null;
  resumeStep?: string;
}

/* ── §5.2 the six-digit email code (Founder Flow v2, Session C) ─────────── */

/**
 * The one answer to "send me a code", whatever happened.
 *
 * The route returns this for a hit, a draft with no address on it, a provider
 * that refused, and a caller over the limit — at 202 in every case, never a
 * 429. Nothing here branches on it, because there is nothing to branch on;
 * the result of the request arrives in the person’s inbox.
 */
export interface EmailCodeAck {
  status: 'sent';
  title: string;
  whatHappened: string;
  next: string;
}

export const requestEmailCode = (token: string): Promise<EmailCodeAck> =>
  call(`${base(token)}/email-code`, { method: 'POST', body: JSON.stringify({}) });

/**
 * Checks a code. Throws `DraftRequestError` carrying the frozen link-unavailable
 * body for every failure mode — wrong, expired, already used, too many tries,
 * never requested. The surface renders one sentence for all of them, because
 * the server tells it nothing more (§5.5).
 */
export const verifyEmailCode = (token: string, code: string): Promise<{ verified: true }> =>
  call(`${base(token)}/email-code/verify`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Dictation (deviation 2). Sends the recording and gets back what was said.
 *
 * Nothing is stored: no bucket key comes back, no id, no handle. The text
 * lands in the Founder’s own textarea and saves through the ordinary autosave
 * as their words, which is what keeps §9’s "never represented as
 * AI-generated" true on the Positioning step.
 */
export const transcribeAudio = (token: string, audio: Blob): Promise<{ text: string }> =>
  call(`${base(token)}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': audio.type || 'audio/webm' },
    body: audio,
  });
/*
 * Founder-flow pages are separate routes, but they all read the same vetting
 * record. Keeping the successful read for this browser session prevents the
 * next route from rendering its generic "Opening..." StatePanel for one
 * frame while it repeats an identical request. Writes below refresh the same
 * entry, so this is a read-through cache rather than a stale snapshot.
 */
const vettingCache = new Map<string, VettingState>();

export const fetchVetting = async (token: string): Promise<VettingState> => {
  const cached = vettingCache.get(token);
  if (cached) return cached;

  const state = await call<VettingState>(`${base(token)}/vetting`);
  vettingCache.set(token, state);
  return state;
};

export const saveVetting = async (
  token: string,
  patch: VettingPatch,
): Promise<VettingState> => {
  const state = await call<VettingState>(`${base(token)}/vetting`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  vettingCache.set(token, state);
  return state;
};

export const submitVetting = async (token: string): Promise<VettingState> => {
  const state = await call<VettingState>(`${base(token)}/vetting/submit`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  vettingCache.set(token, state);
  return state;
};

/* ── §10 the account claim ────────────────────────────────────────────────── */

export interface ClaimFieldState {
  value: string | null;
  supplier: 'proovd' | 'founder' | null;
  prefilled: string | null;
  editedAt: string | null;
}

export type ClaimFieldName =
  | 'legalName'
  | 'preferredName'
  | 'email'
  | 'phone'
  | 'dateOfBirth'
  | 'country'
  | 'stateRegion'
  | 'businessName'
  | 'businessEntityType';

export interface ClaimProfileState {
  draftId: string;
  campaignId: string;
  fields: Record<ClaimFieldName, ClaimFieldState>;
  soleProprietor: boolean | null;
  /**
   * §5.2. `code_verified` is Founder Flow v2 Session C (a recorded §1 rule 6
   * deviation) and the only one of the four that is evidence rather than
   * provenance: a code we sent to that exact address came back.
   */
  emailOwnership:
    | 'invited_link'
    | 'google_oauth'
    | 'self_supplied_unverified'
    | 'code_verified'
    | null;
  phoneVerified: false;
  representations: { usPerson: boolean; age18Plus: boolean; sanctions: boolean };
  lastSavedAt: string | null;
  claimedAt: string | null;
}

export interface ClaimPolicy {
  slug: string;
  route: string | null;
  title: string;
  version: string | null;
  status: 'draft' | 'published' | 'missing';
}

export interface ClaimView {
  profile: ClaimProfileState;
  policies: ClaimPolicy[];
}

export interface ClaimPatch {
  legalName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  stateRegion?: string | null;
  soleProprietor?: boolean | null;
  businessName?: string | null;
  businessEntityType?: string | null;
  representationUsPerson?: boolean;
  representationAge18Plus?: boolean;
  representationSanctions?: boolean;
}

const claimCache = new Map<string, ClaimView>();

export const fetchClaim = async (token: string): Promise<ClaimView> => {
  const cached = claimCache.get(token);
  if (cached) return cached;
  const claim = await call<ClaimView>(`${base(token)}/claim`);
  claimCache.set(token, claim);
  return claim;
};

export const saveClaim = async (
  token: string,
  patch: ClaimPatch,
): Promise<ClaimProfileState> => {
  const profile = await call<ClaimProfileState>(`${base(token)}/claim`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const cached = claimCache.get(token);
  if (cached) claimCache.set(token, { ...cached, profile });
  return profile;
};
