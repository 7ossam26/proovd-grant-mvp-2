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
  /** The campaign path Admin set from discovery. Read-only here. */
  selectedType: CampaignTypeValue | null;
  problem: string | null;
  solution: string | null;
  /** The amount-of-views answer, as a shared range id. */
  views: import('@proovd/shared').ViewsRangeId | null;
  provenance: {
    problem: FieldProvenance;
    solution: FieldProvenance;
  };
  lastSavedAt: string | null;
  resumeStep: string | null;
  submittedAt: string | null;
  completeness: Record<'problem' | 'solution' | 'views', boolean>;
  campaignStatus: string;
  lockedType: CampaignTypeValue | null;
  typeLockedAt: string | null;
}

export interface VettingPatch {
  problem?: string | null;
  solution?: string | null;
  views?: string | null;
  resumeStep?: string;
}

export const fetchVetting = (token: string): Promise<VettingState> =>
  call(`${base(token)}/vetting`);

export const saveVetting = (token: string, patch: VettingPatch): Promise<VettingState> =>
  call(`${base(token)}/vetting`, { method: 'PATCH', body: JSON.stringify(patch) });

export const submitVetting = (token: string): Promise<VettingState> =>
  call(`${base(token)}/vetting/submit`, { method: 'POST', body: JSON.stringify({}) });

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
  emailOwnership: 'invited_link' | 'google_oauth' | 'self_supplied_unverified' | null;
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

export const fetchClaim = (token: string): Promise<ClaimView> => call(`${base(token)}/claim`);

export const saveClaim = (token: string, patch: ClaimPatch): Promise<ClaimProfileState> =>
  call(`${base(token)}/claim`, { method: 'PATCH', body: JSON.stringify(patch) });

export const completeClaim = (
  token: string,
  body: { password?: string; acceptedPolicySlugs: string[] },
): Promise<{ ok: true; campaignId: string }> =>
  call(`${base(token)}/claim`, { method: 'POST', body: JSON.stringify(body) });
