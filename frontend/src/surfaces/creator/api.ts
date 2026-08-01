/**
 * The token-scoped Creator client — Spec §11, §28.1.
 *
 * Separate from the Admin client and from the Founder draft client, for the
 * reason the draft client documents: these calls carry a raw token in the URL
 * and no session cookie. One module doing all three would eventually send one
 * to another's routes.
 *
 * The token is in the path and stays there. Nothing here writes it to storage,
 * puts it in a query string, or logs it.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';

export { AdminRequestError as CreatorRequestError };
export type { AdminError as CreatorError };

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
      // No credentials: an invitation grants access to one association and
      // nothing else (§33.2.1).
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

const base = (token: string) => `/api/affiliate-invitation/${encodeURIComponent(token)}`;

/* ── What the invitation reveals before an account exists (§33.2.1) ───────── */

export interface CreatorLanding {
  recipientName: string;
  publicHandle: string | null;
  founderName: string | null;
  productName: string | null;
  whyRecruited: string | null;
  reviewedPresence: string | null;
  senderName: string | null;
  reference: string;
}

export interface CreatorField {
  value: string | null;
  /** §11's source label. */
  supplier: 'proovd' | 'affiliate' | null;
  prefilled: string | null;
  editedAt: string | null;
}

export interface CreatorProfile {
  associationId: string;
  campaignId: string;
  fields: Record<string, CreatorField>;
  channelSubtype: string | null;
  phoneVerified: false;
  confirmations: {
    age18Plus: boolean;
    usBased: boolean;
    actualOperator: boolean;
    noDuplicateAccounts: boolean;
    sanctionsEligible: boolean;
  };
  payout: {
    status: string;
    connectedAccountId: string | null;
    requirements: unknown;
    updatedAt: string | null;
  };
  lastSavedAt: string | null;
  claimedAt: string | null;
}

export interface CreatorConditional {
  state: 'not_signed_up' | 'awaiting_founder' | 'preparing' | 'formal_decision_open';
  campaignId: string;
  productName: string | null;
  founderClaimedAt: string | null;
  listingPaidAt: string | null;
  payoutStatus: string;
  reviewAvailable: false;
}

export interface CreatorPolicy {
  slug: string;
  title: string;
  version: string;
  status: 'draft' | 'published';
  route: string;
}

export interface CreatorInvitationState {
  landing: CreatorLanding;
  profile: CreatorProfile;
  conditional: CreatorConditional;
  policies: CreatorPolicy[];
}

export const fetchInvitation = (token: string): Promise<CreatorInvitationState> =>
  call(base(token));

export interface CreatorPatch {
  legalName?: string | null;
  publicHandle?: string | null;
  email?: string | null;
  phone?: string | null;
  channelReference?: string | null;
  audienceNiche?: string | null;
  audienceSize?: string | null;
  bio?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  stateRegion?: string | null;
  confirmAge18Plus?: boolean;
  confirmUsBased?: boolean;
  confirmActualOperator?: boolean;
  confirmNoDuplicateAccounts?: boolean;
  confirmSanctionsEligible?: boolean;
}

export const saveInvitation = (
  token: string,
  patch: CreatorPatch,
): Promise<{ profile: CreatorProfile }> =>
  call(base(token), { method: 'PATCH', body: JSON.stringify(patch) });

/** §11's one primary action: `Confirm and create account`. */
export const completeSignup = (
  token: string,
  body: { password: string; acceptedPolicySlugs: string[] },
): Promise<{ userId: string; campaignId: string; associationId: string }> =>
  call(`${base(token)}/claim`, { method: 'POST', body: JSON.stringify(body) });

export interface PayoutState {
  status: string;
  connectedAccountId: string | null;
  requirements: unknown;
  updatedAt: string | null;
  /** Phase 10 opens this. §1.4: a dead control would be worse than none. */
  onboardingAvailable: false;
}

export const fetchPayoutState = (token: string): Promise<PayoutState> =>
  call(`${base(token)}/payout`);
