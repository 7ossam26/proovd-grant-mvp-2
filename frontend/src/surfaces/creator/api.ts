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

/** Screen 4's record (0055). A SET, superseded rather than edited. */
export interface CreatorVoice {
  tones: string[];
  customTones: string[];
  flexible: boolean;
  recordedAt: string | null;
}

/** Screen 6's record (0055). One live row per metric; absent means unanswered. */
export interface CreatorMetrics {
  values: Record<string, string>;
  recordedAt: string | null;
}

export interface CreatorInvitationState {
  landing: CreatorLanding;
  profile: CreatorProfile;
  conditional: CreatorConditional;
  policies: CreatorPolicy[];
  voice: CreatorVoice;
  metrics: CreatorMetrics;
  /**
   * The §5.3 figures this Creator's own channel is asked for.
   *
   * Sent by the server rather than derived here, so the question somebody
   * answers and the set the write accepts come from one place — the surface
   * cannot show a field the route would refuse.
   */
  metricsAsked: string[];
  /** Track A4. `false` renders a named absence, never a dead control (§1.4). */
  uploads: { available: boolean };
}

export const fetchInvitation = (token: string): Promise<CreatorInvitationState> =>
  call(base(token));

export interface CreatorPatch {
  legalName?: string | null;
  publicHandle?: string | null;
  email?: string | null;
  phone?: string | null;
  channelReference?: string | null;
  /** The Creator's own tile (0055). Never `channelSubtype`, which is Admin's. */
  channelType?: string | null;
  audienceNiche?: string | null;
  audienceSize?: string | null;
  nicheDescription?: string | null;
  /** §5.3's `promotion_plan`, asked only of a student channel (0055). */
  outreachPlan?: string | null;
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

export const saveCreatorVoice = (
  token: string,
  body: { tones: string[]; customTones: string[]; flexible: boolean },
): Promise<{ voice: CreatorVoice }> =>
  call(`${base(token)}/voice`, { method: 'PUT', body: JSON.stringify(body) });

export const saveCreatorMetrics = (
  token: string,
  values: Record<string, string>,
): Promise<{ metrics: CreatorMetrics }> =>
  call(`${base(token)}/metrics`, { method: 'PUT', body: JSON.stringify({ values }) });

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

/* ── The signed-in Creator (§10, §31.5) — session, not token ──────────────── */

/**
 * These calls carry a session cookie and no token: the invitation link was
 * burned when the account was created, so from here on a Creator arrives
 * signed in. `credentials: 'same-origin'` is set only for this group — the
 * token calls above deliberately send no cookie.
 */
async function sessionCall<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
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
  return (await response.json()) as T;
}

export interface CreatorCampaign {
  associationId: string;
  campaignId: string;
  productName: string | null;
  status: string;
  revealedAt: string | null;
  revoked: boolean;
  /** True only when there is something to read. Drives the one action. */
  reviewAvailable: boolean;
}

export const fetchCreatorCampaigns = (): Promise<{ campaigns: CreatorCampaign[] }> =>
  sessionCall('/api/creator/campaigns');

export interface PreparingKit {
  associationId: string;
  campaignId: string;
  campaignStatus: string;
  associationStatus: string;
  founder: { name: string | null; entity: string | null; soleProprietor: boolean | null };
  productName: string | null;
  problem: string | null;
  solution: string | null;
  competition: string | null;
  campaignType: string | null;
  /** §14.1 items that do not exist yet, each with the reason. */
  notYetAvailable: Array<{ item: string; because: string }>;
  /** §31.5: the pre-view grants no work permission. Always false here. */
  workPermitted: false;
  /** §10: accept/decline/propose are unreachable until listing payment. */
  decisionsAvailable: false;
}

export const fetchPreparingKit = (
  associationId: string,
  section: 'campaign_information' | 'campaign_kit' = 'campaign_information',
): Promise<{ kit: PreparingKit }> =>
  sessionCall(
    `/api/creator/campaigns/${encodeURIComponent(associationId)}?section=${section}`,
  );

/* ── The formal opportunity and the three decisions (§14.1, §14.2) ────────── */

export interface FormalOpportunity {
  associationId: string;
  campaignId: string;
  associationStatus: string;
  whyThisFitsYourAudience: string | null;
  campaignStateLabel: string;
  responseDeadlineAt: string | null;
  highEffort: {
    result: boolean;
    basis: {
      visualsCompleted: boolean;
      brandingCompleted: boolean;
      interviewScheduledOrConfirmed: boolean;
    } | null;
  };
  compensation: {
    basePercent: number;
    basePercentWithFixed: number | null;
    bidAllowed: boolean;
    fixedPaymentAvailable: boolean;
    ceilingPercent: number;
  };
  decisionsAvailable: boolean;
  versions: Array<{
    id: string;
    versionNumber: number;
    proposedBy: string;
    bidTotalPercent: number | null;
    fixedPaymentRequestCents: string | null;
    state: string;
    createdAt: string;
  }>;
  agreement: { totalPercent: number; fixedPaymentCents: string | null; source: string } | null;
  trackingLink: {
    url: string;
    testUrl: string;
    active: boolean;
    disclosureText: string;
  } | null;
}

export const fetchFormalOpportunity = (
  associationId: string,
): Promise<{ opportunity: FormalOpportunity }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/opportunity`);

/** §28.4: four separate confirmations from four separate controls. */
export interface DecisionConfirmations {
  compensationTerms: boolean;
  ipAgreement: boolean;
  ftcDisclosure: boolean;
  termsAup: boolean;
}

export const acceptStandardTerms = (
  associationId: string,
  confirmations: DecisionConfirmations,
): Promise<{ accepted: { totalPercent: number } }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/accept`, {
    method: 'POST',
    body: JSON.stringify(confirmations),
  });

export const declineOpportunity = (
  associationId: string,
  reason: string,
): Promise<{ declined: { recordedAt: string } }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/decline`, {
    method: 'POST',
    body: JSON.stringify(reason.trim() ? { reason } : {}),
  });

export const submitProposal = (
  associationId: string,
  proposal: { bidTotalPercent?: number; fixedPaymentRequestCents?: string },
): Promise<{ proposal: { versionId: string; versionNumber: number } }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/proposals`, {
    method: 'POST',
    body: JSON.stringify(proposal),
  });

export const respondToVersion = (
  versionId: string,
  body:
    | ({ action: 'accept' } & DecisionConfirmations)
    | { action: 'decline' }
    | { action: 'counter'; bidTotalPercent?: number; fixedPaymentRequestCents?: string },
): Promise<{ response: { outcome: string } }> =>
  sessionCall(`/api/creator/proposals/${encodeURIComponent(versionId)}/respond`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** §5.3: email + password. No second factor — §5.1 makes that Admin's rule. */
export const creatorSignIn = (email: string, password: string): Promise<unknown> =>
  sessionCall('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const creatorSignOut = (): Promise<unknown> =>
  sessionCall('/api/auth/sign-out', { method: 'POST', body: JSON.stringify({}) });

/* ── The active-partnership surface (§18, Phase 14c) ──────────────────────── */

export interface CreatorPartnership {
  associationId: string;
  campaignId: string;
  status: string;
  joinedAt: string;
  rosterMembership: string;
  founder: { displayName: string };
  product: { title: string; model: 'idea' | 'product'; publicUrl: string; closesAt: string | null };
  trackingLink: {
    url: string;
    testUrl: string;
    active: boolean;
    activatedAt: string | null;
    pausedAt: string | null;
    disclosureText: string;
  } | null;
  brandRules: {
    requiredWording: string | null;
    prohibitedClaims: string | null;
    brandPerception: string | null;
    brandVoice: string | null;
  };
  rewards: Array<{ title: string; priceCents: string; delivery: string }>;
  compensation: {
    basePercent: number;
    bidIncreasePercent: number;
    totalPercent: number;
    fixedPaymentCents: string | null;
  } | null;
  fixedPayment:
    | { applicable: true; status: string; label: string; amountCents: string | null; fundedAt: string | null }
    | { applicable: false };
  firstPost: {
    status: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    correctionDetail: string | null;
  };
  readiness: { state: string; ready: boolean; label: string };
  clicks: { total: number; attributed: number };
  /** §17: attributed pre-orders, conversion, and the captured amount. */
  performance: {
    attributedPreorders: number;
    activePreorders: number;
    capturedPreorders: number;
    capturedSubtotalCents: string;
    /** Null over zero clicks — a rate with no denominator is absent (§16a). */
    conversionRate: number | null;
    attributionNote: string;
  };
  /** §14.3: this Creator's own agreed bonus, or null where none was agreed. */
  bonus: {
    triggerUnit: string;
    thresholdValue: string;
    additionalPercent: number;
    maxCombinedPercent: number;
    progressValue: string;
    note: string;
    earnedPercent: number | null;
  } | null;
  /** §31.5 kit material, downloaded and never generated (§30, §12). */
  materials: {
    available: boolean;
    unavailableBecause: string | null;
    assets: Array<{ id: string; purpose: string; filename: string | null; contentType: string }>;
  };
  obligations: Array<{ key: string; statement: string; enforcement: string }>;
  earnings: {
    state: string;
    label: string;
    amountCents: string | null;
    reason: string;
    owner: string;
    nextUpdate: string;
    action: string;
    actionRequired: boolean;
    statusBlock: string | null;
  };
  midCampaign: {
    joinedWithHoursRemaining: number;
    adjustedDeliverables: string;
    attributionNote: string;
  } | null;
  updatedAt: string;
}

/**
 * §17 step 4: the Creator submits the public post URL.
 *
 * The route has existed since Phase 14a and had no surface — the reference's
 * `I published my first post` sets a boolean from a click and claims tracking
 * starts there, both of which §17 contradicts.
 */
export const submitFirstPost = (
  associationId: string,
  body: { postUrl: string; channel?: string },
): Promise<{ submission: { id: string; status: string } }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/submit-post`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const fetchPartnership = (
  associationId: string,
): Promise<{ partnership: CreatorPartnership }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/partnership`);

/* ── §21 Creator close view (Phase 18b) ────────────────────────────────────── */

export interface CreatorCloseView {
  associationId: string;
  campaignId: string;
  campaignTitle: string;
  campaignStatus: string;
  closedAt: string | null;
  contentVerified: { status: string | null; line: string };
  attributed: { preorders: number; captured: number; capturedSubtotalCents: string };
  earnings: {
    /** Appendix B.7's states — `estimated` until §22.1 finalization records
        the numbers (Phase 19a), then the real recorded state. */
    state:
      | 'estimated'
      | 'finalized'
      | 'approved_for_transfer'
      | 'transferred'
      | 'paid_out'
      | 'payout_failed'
      | 'adjusted';
    label: string;
    lockedPercent: number | null;
    estimatedCents: string;
    reason: string;
    nextUpdate: string;
    action: string;
    statusBlock: string;
    finalization: 'pending' | 'recorded';
    finalizationNote: string;
    final: {
      earnedPercent: number;
      commissionCents: string;
      bonusCents: string;
      eligibleFixedCents: string;
      totalCents: string;
    } | null;
  };
  bonus: { recorded: number; finalization: 'pending' | 'recorded'; note: string } | null;
  fixedPayment: { applicable: true; status: string; amountCents: string } | { applicable: false };
  nextReviewAt: string | null;
  nextReviewLine: string;
  thankYou: string;
}

export const fetchCreatorClose = (
  associationId: string,
): Promise<{ close: CreatorCloseView }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/close`);

/* ── Home (Creator Flow v2 deviation 5, Session D) ────────────────────────── */

export interface CreatorHomePitch {
  associationId: string;
  campaignId: string;
  productName: string | null;
  kind: 'opportunity' | 'proposal';
}

export interface CreatorHomeStanding {
  score: number;
  tier: string;
  /** `null` while the cohort is short. Never a percentile computed anyway. */
  percentile: number | null;
  inputs: Record<string, number>;
  computedAt: string;
}

export interface CreatorHomeLeader {
  handle: string;
  score: number;
  tier: string;
  isYou: boolean;
}

export interface CreatorHomeWorkAgain {
  requestId: string;
  associationId: string;
  productName: string | null;
  message: string;
  requestedAt: string;
}

export interface CreatorHomeReferral {
  id: string;
  referredName: string;
  state: string;
  recordedAt: string;
}

export interface CreatorHomeView {
  firstName: string | null;
  pitches: CreatorHomePitch[];
  standing: CreatorHomeStanding | null;
  leaders: CreatorHomeLeader[];
  cohortMinimum: number;
  trackRecord: {
    launched: number;
    verified: number;
    /** Integer cents as a string. Nothing in the browser computes on it. */
    backedCents: string;
  };
  workAgain: CreatorHomeWorkAgain[];
  referrals: CreatorHomeReferral[];
}

export const fetchCreatorHome = (): Promise<{ home: CreatorHomeView }> =>
  sessionCall('/api/creator/home');

/**
 * Record a referral — deviation 3.
 *
 * There is no referrer in this body. The server resolves it from the session,
 * because a caller that could name its own referrer could attribute a vouch to
 * somebody else.
 */
export const saveCreatorReferral = (input: {
  referredName: string;
  referredContact: string;
  relationship: string;
  why: string;
  note?: string;
}): Promise<{ referrals: CreatorHomeReferral[] }> =>
  sessionCall('/api/creator/referrals', { method: 'POST', body: JSON.stringify(input) });

/** §22.9's answer. The route and its service are Phase 21b's, unchanged. */
export const respondToWorkAgainRequest = (
  requestId: string,
  accept: boolean,
): Promise<{ status: string }> =>
  sessionCall(`/api/creator/work-again/${encodeURIComponent(requestId)}/respond`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  });

/* ── Session F: Earnings, Resources, Settings, and the asks ───────────────── */

export interface CreatorEarningsRow {
  associationId: string;
  campaignId: string;
  campaignTitle: string;
  /** The campaign's own close view, or null while it has not closed (§16a). */
  close: CreatorCloseView | null;
  waitingOn: string | null;
}

export interface CreatorEarningsView {
  lifetimeRecordedCents: string;
  recordedCampaigns: number;
  rows: CreatorEarningsRow[];
}

export const fetchCreatorEarnings = (): Promise<{ earnings: CreatorEarningsView }> =>
  sessionCall('/api/creator/earnings');

export interface CreatorResourcesView {
  interested: string[];
}

export const fetchCreatorResources = (): Promise<{ resources: CreatorResourcesView }> =>
  sessionCall('/api/creator/resources');

export const recordResourceInterest = (
  resourceId: string,
): Promise<{ resources: CreatorResourcesView }> =>
  sessionCall(`/api/creator/resources/${encodeURIComponent(resourceId)}`, { method: 'POST' });

export interface CreatorSettingsField {
  id: string;
  label: string;
  value: string | null;
  /** §11's source label. Null where the field carries no provenance triple. */
  supplier: string | null;
  guarded: boolean;
}

export interface CreatorSettingsView {
  profileId: string;
  prospectId: string;
  fields: CreatorSettingsField[];
  channelSubtype: string | null;
  payout: { state: string | null; payoutsEnabled: boolean; accountPresent: boolean };
  signed: Array<{ label: string; version: string | null; acceptedAt: string }>;
  deletionRequestedAt: string | null;
}

export const fetchCreatorSettings = (): Promise<{ settings: CreatorSettingsView }> =>
  sessionCall('/api/creator/settings');

export const saveCreatorSetting = (
  fieldId: string,
  body: { value: string; reason: string },
): Promise<{ settings: CreatorSettingsView }> =>
  sessionCall(`/api/creator/settings/${encodeURIComponent(fieldId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const requestAccountDeletion = (
  detail: string,
): Promise<{ settings: CreatorSettingsView }> =>
  sessionCall('/api/creator/settings/delete-account', {
    method: 'POST',
    body: JSON.stringify({ detail }),
  });

export const requestPartnershipEnd = (
  associationId: string,
  body: { reasonId: string; detail: string },
): Promise<{ reference: string; acknowledgement: string }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/end-request`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const discloseOwnPreorder = (
  associationId: string,
  body: { intentNote: string; selfFundedCertified: boolean; identityDisclosed: boolean },
): Promise<{ recorded: true }> =>
  sessionCall(
    `/api/creator/campaigns/${encodeURIComponent(associationId)}/self-preorder-disclosure`,
    { method: 'POST', body: JSON.stringify(body) },
  );

export const discloseConflict = (
  associationId: string,
  body: { relationshipKind: string; detail: string },
): Promise<{ recorded: true }> =>
  sessionCall(`/api/creator/campaigns/${encodeURIComponent(associationId)}/conflict-disclosure`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
