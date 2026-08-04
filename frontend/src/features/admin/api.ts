/**
 * The Admin API client.
 *
 * One rule shapes this file: the server decides, and its refusal is what the
 * Admin reads. §1.1 requires server-side authorization on every surface, so
 * nothing here treats a client-side check as sufficient, and nothing invents a
 * friendlier message over a server one — the server already answers §27.1's six
 * questions in `whatHappened` / `next` / `action`, and paraphrasing it in the
 * browser is how the two start disagreeing.
 */

/** The failure shape every guarded route returns (`guards.ts`, `admin.ts`). */
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
  sessionEstablishedAt: string;
  prerequisiteKeys: string[];
}

export const fetchAdminIdentity = (): Promise<AdminIdentity> =>
  call<AdminIdentity>('/api/admin/me');

/**
 * Password, then the second factor. Two calls because §5.1 makes them two
 * facts: the password alone never yields a session for an enrolled Admin, and
 * Better Auth answers the first call with `twoFactorRedirect` to say so.
 */
export const signInWithPassword = (
  email: string,
  password: string,
): Promise<{ twoFactorRedirect?: boolean }> =>
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

/* ── Settings (§6) ────────────────────────────────────────────────────────── */

/**
 * The stored state of one setting.
 *
 * Its label, help text, and group are NOT here — those come from
 * `@proovd/shared`'s register, which this app imports directly. One register,
 * rendered once; a copy travelling over the wire is a second version of the
 * same sentence waiting to disagree with the first.
 */
export interface SettingState {
  key: string;
  value: string | null;
  kind: string;
  provenance: 'specified' | 'operator' | 'derived';
  minimum: number | null;
  maximum: number | null;
  specRef: string;
  version: number;
  editable: boolean;
  updatedBy: string;
  updateReason: string;
  updatedAt: string;
}

export const fetchSettings = (): Promise<{ settings: SettingState[] }> =>
  call('/api/admin/settings');

export const saveSetting = (
  key: string,
  value: string,
  reason: string,
): Promise<SettingState & { changed: boolean }> =>
  call(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });

export interface SettingHistoryEntry {
  version: number;
  priorValue: string | null;
  newValue: string | null;
  changedBy: string;
  reason: string;
  occurredAt: string;
}

export const fetchSettingHistory = (
  key: string,
): Promise<{ history: SettingHistoryEntry[] }> =>
  call(`/api/admin/settings/${encodeURIComponent(key)}/history`);

/* ── Prerequisites (§6) ───────────────────────────────────────────────────── */

export interface PrerequisiteItem {
  key: string;
  label: string;
  specRef: string;
  verification: 'automatic' | 'recorded';
  requirement: string;
  satisfied: boolean;
  detail: string;
  subjectKeys: string[];
  attestation: {
    status: 'satisfied' | 'not_satisfied';
    recordedBy: string;
    recordedAt: string;
    note: string;
    evidenceLinks: string[] | null;
  } | null;
}

export interface PrerequisitePanel {
  blocking: boolean;
  unsatisfiedKeys: string[];
  items: PrerequisiteItem[];
}

export const fetchPrerequisites = (): Promise<PrerequisitePanel> =>
  call('/api/admin/prerequisites');

/* ── Founders and invitations (§7, §26.1, §26.2) ──────────────────────────── */

export interface FounderRow {
  prospectId: string;
  draftId: string;
  campaignId: string;
  legalName: string | null;
  email: string | null;
  productName: string | null;
  status: 'draft' | 'sent' | 'revoked' | 'claimed' | 'expired';
  invitationSource: string | null;
  internalOwner: string | null;
  lastSentAt: string | null;
  retentionDueAt: string | null;
  claimedAt: string | null;
  anonymisedAt: string | null;
  createdAt: string;
}

export const fetchFounders = (): Promise<{ founders: FounderRow[] }> =>
  call('/api/admin/founders');

export interface CreateProspectBody {
  legalName: string;
  preferredName?: string;
  email: string;
  phone?: string;
  productName: string;
  productUrl?: string;
  launchFrame?: string;
  usAgeFit?: string;
  deliveryFeasibility?: string;
  compensationExpectations?: string;
  affiliateSourcingHypothesis?: string;
  adminNotes?: string;
  discoveryEvidence?: string[];
  invitationSource: string;
  internalOwner: string;
}

export const createProspect = (
  body: CreateProspectBody,
): Promise<{ draftId: string; campaignId: string; prospectId: string }> =>
  call('/api/admin/founders', { method: 'POST', body: JSON.stringify(body) });

export interface FounderDetail {
  draft: {
    id: string;
    campaignId: string;
    prospectId: string;
    status: FounderRow['status'];
    whatWeUnderstood: string | null;
    whyInvited: string | null;
    senderName: string | null;
    senderEmail: string | null;
    expectedSetupTime: string | null;
    anonymisedAt: string | null;
    createdAt: string;
  };
  prospect: Record<string, unknown> & {
    legalName: string | null;
    preferredName: string | null;
    email: string | null;
    productName: string | null;
    productUrl: string | null;
    invitationSource: string | null;
    internalOwner: string | null;
    claimedAt: string | null;
    anonymisedAt: string | null;
  };
  campaign: {
    id: string;
    type: string | null;
    typeLockedAt: string | null;
    status: string;
    affiliateRosterStatus: string;
    campaignBuildStatus: string;
    listingPaidAt: string | null;
    campaignLiveAt: string | null;
    campaignCloseAt: string | null;
    createdAt: string;
  } | null;
  sends: Array<{
    id: string;
    sentAt: string;
    recipientEmail: string | null;
    senderName: string;
    notificationId: string | null;
    tokenVersion: number;
    tokenExpiresAt: string | null;
    sentBy: string;
  }>;
  lastSentAt: string | null;
  retentionDueAt: string | null;
  hasLiveToken: boolean;

  /* ── §9 / §10, added Phase 07. All read — Admin does not re-enter Founder
     data (§9). The one exception is the Problem/Solution prefill, which §9
     asks for by name and which has its own route. ─────────────────────────*/
  vetting: AdminVettingState | null;
  vettingEdits: VettingFieldEdit[];
  claimProfile: AdminClaimProfile | null;
  creatorSignal: PossibleCreatorSignal | null;
  signupComplete: { campaignId: string; founderUserId: string; occurredAt: string } | null;
}

export interface AdminFieldProvenance {
  supplier: 'proovd' | 'founder' | null;
  /** Absent on Competition — §9 gives it no prefill and §33.1.5 tests it. */
  prefilledText?: string | null;
  prefilledAt?: string | null;
  firstEditedAt: string | null;
  lastEditedAt: string | null;
}

export interface AdminVettingState {
  draftId: string;
  campaignId: string;
  selectedType: 'pre_build' | 'pre_launch' | null;
  problem: string | null;
  solution: string | null;
  competition: string | null;
  provenance: {
    problem: AdminFieldProvenance;
    solution: AdminFieldProvenance;
    competition: AdminFieldProvenance;
  };
  lastSavedAt: string | null;
  resumeStep: string | null;
  submittedAt: string | null;
  completeness: Record<'campaign_path' | 'problem' | 'solution' | 'competition', boolean>;
  campaignStatus: string;
  lockedType: 'pre_build' | 'pre_launch' | null;
  typeLockedAt: string | null;
}

export interface VettingFieldEdit {
  record: string;
  field: string;
  priorValue: string | null;
  newValue: string | null;
  supplier: 'proovd' | 'founder';
  editedBy: string;
  occurredAt: string;
}

export interface AdminClaimProfile {
  draftId: string;
  campaignId: string;
  fields: Record<
    string,
    { value: string | null; supplier: 'proovd' | 'founder' | null; prefilled: string | null; editedAt: string | null }
  >;
  soleProprietor: boolean | null;
  emailOwnership: string | null;
  phoneVerified: false;
  representations: { usPerson: boolean; age18Plus: boolean; sanctions: boolean };
  lastSavedAt: string | null;
  claimedAt: string | null;
}

export interface PossibleCreatorSignal {
  count: number;
  basis: string;
  recordedBy: string;
  recordedAt: string;
}

export const fetchFounderDetail = (draftId: string): Promise<FounderDetail> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}`);

/**
 * §9: Problem and Solution are prefilled by Proovd from discovery.
 *
 * There is no `competition` key in this body and no route that accepts one.
 * §9 states the rule twice and §33.1.5 tests it.
 */
export const prefillVetting = (
  draftId: string,
  body: { problem?: string; solution?: string },
): Promise<AdminVettingState> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/vetting-prefill`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const recordCreatorSignal = (
  campaignId: string,
  count: number,
  basis: string,
): Promise<PossibleCreatorSignal> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/creator-signal`, {
    method: 'POST',
    body: JSON.stringify({ count, basis }),
  });

export const archiveAndRestart = (
  campaignId: string,
  reason: string,
): Promise<{ archivedCampaignId: string; campaignId: string; draftId: string }> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/archive-and-restart`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export interface ComposeBody {
  whatWeUnderstood: string;
  whyInvited: string;
  senderName: string;
  senderEmail: string;
  expectedSetupTime: string;
}

export const composeInvitation = (
  draftId: string,
  body: ComposeBody,
): Promise<{ ok: true }> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/invitation`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export interface InvitationPreview {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string | null;
  /** Bracketed markers still in the rendered message. §7's gate. */
  unresolved: string[];
  blocked: boolean;
}

export const fetchInvitationPreview = (draftId: string): Promise<InvitationPreview> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/preview`);

export const sendInvitation = (
  draftId: string,
): Promise<{ sendId: string; tokenVersion: number; resent: boolean }> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const revokeInvitation = (
  draftId: string,
  reason: string,
): Promise<{ ok: true; tokensRevoked: number }> =>
  call(`/api/admin/founders/${encodeURIComponent(draftId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export interface InvitationCopy {
  processSummary: string[];
  noGuarantee: string;
  retentionDays: number;
}

export const fetchInvitationCopy = (): Promise<InvitationCopy> =>
  call('/api/admin/founders/invitation-copy');

/* ── The draft landing state (§7) — no account, no session ────────────────── */

export interface DraftLanding {
  recipientName: string;
  productName: string;
  whatWeUnderstood: string | null;
  senderName: string | null;
  expectedSetupTime: string | null;
  reference: string;
  processSummary: string[];
  noGuarantee: string;
}

export const fetchDraftLanding = (token: string): Promise<DraftLanding> =>
  call(`/api/draft/${encodeURIComponent(token)}`);

/* ── Campaign Creators (§8, §5.3, §25.4) — added Phase 08a ────────────────── */

/**
 * The §5.3 register the server validates against, and §8's fixed copy.
 *
 * Labels, help text, and every `basis` string are NOT here: the Admin bundle
 * imports `@proovd/shared`'s register directly through Vite, and copy that
 * travels over the wire is a second version of the same sentence waiting to
 * disagree with the first. What comes back is only what the server enforces.
 */
export interface AffiliateRegistry {
  subtypes: string[];
  requiredEvidence: Record<string, string[]>;
  verificationStatuses: string[];
  /** §8's two promises and the never-asks line. Read-only; no route edits them. */
  fixedCopy: {
    preparingNotice: string;
    declineNotice: string;
    neverAsksNotice: string;
  };
}

export const fetchAffiliateRegistry = (): Promise<AffiliateRegistry> =>
  call('/api/admin/affiliates/registry');

export interface AffiliateRosterRow {
  associationId: string;
  prospectId: string;
  campaignId: string;
  legalName: string | null;
  publicHandle: string | null;
  email: string | null;
  subtype: string | null;
  status: string;
  invitationStatus: 'draft' | 'sent' | 'revoked' | 'claimed' | 'expired';
  rosterMembership: 'initial_roster' | 'mid_campaign';
  verificationStatus: 'unverified' | 'in_review' | 'verified' | 'rejected';
  recruitingAdmin: string | null;
  lastSentAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export const fetchCampaignAffiliates = (
  campaignId: string,
): Promise<{ affiliates: AffiliateRosterRow[] }> =>
  call(`/api/admin/affiliates?campaignId=${encodeURIComponent(campaignId)}`);

export interface RecruitBody {
  legalName: string;
  publicHandle: string;
  email: string;
  phone?: string;
  subtype: string;
  channelReference: string;
  audienceNiche: string;
  campaignFit: string;
  audienceSize?: string;
  engagementEvidence?: Record<string, string>;
  audienceDemographics?: string;
  permissionBasis: string;
  priorSponsoredContent?: string;
  adminBio: string;
  /** §8: assessment data only. A bare number or percentage is refused. */
  qualityTier?: string;
  conflictNotes?: string;
  sanctionsNotes?: string;
  internalComments?: string;
  recruitmentSource: string;
  recruitingAdmin: string;
  campaignId: string;
  rosterIntent: 'initial_roster' | 'mid_campaign';
}

export const recruitAffiliate = (
  body: RecruitBody,
): Promise<{ prospectId: string; associationId: string }> =>
  call('/api/admin/affiliates', { method: 'POST', body: JSON.stringify(body) });

export interface AffiliateDetail {
  association: {
    id: string;
    campaignId: string;
    status: string;
    rosterMembership: 'initial_roster' | 'mid_campaign';
    invitationStatus: AffiliateRosterRow['invitationStatus'];
    recruitmentSource: string | null;
    recruitingAdmin: string | null;
    recruitedAt: string | null;
  };
  prospect: Record<string, unknown> & {
    id: string;
    legalName: string | null;
    publicHandle: string | null;
    email: string | null;
    phone: string | null;
    subtype: string | null;
    channelReference: string | null;
    audienceNiche: string | null;
    campaignFit: string | null;
    audienceSize: string | null;
    engagementEvidence: Record<string, string> | null;
    audienceDemographics: string | null;
    permissionBasis: string | null;
    priorSponsoredContent: string | null;
    adminBio: string | null;
    qualityTier: string | null;
    verificationStatus: AffiliateRosterRow['verificationStatus'];
    verificationEvidence: Record<string, string> | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
    conflictNotes: string | null;
    sanctionsNotes: string | null;
    internalComments: string | null;
    claimedAt: string | null;
  };
  /** §5.3 evidence still missing for this subtype. Reported, not enforced. */
  missingEvidence: string[];
  /** §2.2, across every campaign. Phase 08 can never make this non-zero. */
  slots: { used: number; limit: number; remaining: number; atLimit: boolean };
  invitation: {
    whyRecruited: string | null;
    reviewedPresence: string | null;
    senderName: string | null;
    senderEmail: string | null;
    founderName: string | null;
    productName: string | null;
    hasLiveToken: boolean;
    lastSentAt: string | null;
    sends: Array<{
      id: string;
      sentAt: string;
      recipientEmail: string | null;
      senderName: string;
      notificationId: string | null;
      tokenVersion: number;
      tokenExpiresAt: string | null;
      sentBy: string;
      /** §1.4: false means "recorded, not confirmed delivered". */
      deliveryConfirmed: boolean;
    }>;
  } | null;
}

export const fetchAffiliateDetail = (associationId: string): Promise<AffiliateDetail> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}`);

export const updateAffiliateProspect = (
  associationId: string,
  body: Partial<Omit<RecruitBody, 'campaignId' | 'rosterIntent' | 'subtype'>>,
): Promise<{ ok: true }> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/prospect`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const recordAffiliateVerification = (
  associationId: string,
  body: { status: string; verifiedBy: string; evidence?: Record<string, string> },
): Promise<{ ok: true }> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/verification`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface AffiliateComposeBody {
  whyRecruited: string;
  reviewedPresence: string;
  senderName: string;
  senderEmail: string;
}

export const composeAffiliateInvitation = (
  associationId: string,
  body: AffiliateComposeBody,
): Promise<{ ok: true }> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/invitation`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export interface AffiliateInvitationPreview {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string | null;
  /** Bracketed markers still in the rendered message. §8's gate. */
  unresolved: string[];
  blocked: boolean;
  /** The route shape only — §28.1 makes the real link unrecoverable. */
  claimUrlShape: string;
}

export const fetchAffiliateInvitationPreview = (
  associationId: string,
): Promise<AffiliateInvitationPreview> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/preview`);

export const sendAffiliateInvitation = (
  associationId: string,
): Promise<{ sendId: string; tokenVersion: number; resent: boolean }> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const revokeAffiliateInvitation = (
  associationId: string,
  reason: string,
): Promise<{ ok: true; revoked: number }> =>
  call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const recordPrerequisite = (
  key: string,
  status: 'satisfied' | 'not_satisfied',
  note: string,
  evidenceLinks: string[],
): Promise<{ blocking: boolean; unsatisfiedKeys: string[] }> =>
  call(`/api/admin/prerequisites/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: JSON.stringify({ status, note, evidenceLinks }),
  });

/* ── Phase 09a: the §12 optional items, evidence, and the fee ─────────────── */

export type AdminOptionalItemKey = 'visuals' | 'branding' | 'interview' | 'story' | 'socials';

/**
 * §12 Admin: "every item, evidence, status, discount line, high-effort inputs,
 * fee preview, interview state, invalidation history, and override."
 *
 * `evidence` and `invalidatedReason` are the two fields the Founder never sees:
 * the snapshot each decision rested on, and §25.6's internal reason, which is
 * kept in its own column precisely so it can stay internal.
 */
export interface AdminOptionalItem {
  item: AdminOptionalItemKey;
  complete: boolean;
  completedAt: string | null;
  decisionSource: string | null;
  rejections: string[];
  locked: boolean;
  invalidated: { at: string | null; explanation: string | null };
  evidence: unknown;
  invalidatedReason: string | null;
  invalidatedBy: string | null;
  evaluatedAt: string | null;
}

export interface AdminWorkspace {
  campaignId: string;
  items: AdminOptionalItem[];
  fee: {
    baseCents: string;
    itemDiscountCents: string;
    completedItems: number;
    discountLines: Array<{ item: AdminOptionalItemKey; discountCents: string }>;
    discountCents: string;
    subtotalCents: string;
    minSubtotalCents: string;
    calculatedAt: string | null;
    locked: boolean;
    separateStreamNote: string;
  } | null;
  highEffort: {
    visualsCompleted: boolean;
    brandingCompleted: boolean;
    interviewScheduledOrConfirmed: boolean;
    highEffort: boolean;
    calculatedAt: string | null;
  } | null;
  assets: Array<{
    id: string;
    purpose: string;
    state: string;
    rejection: string | null;
    approved: boolean;
    removed: boolean;
    filename: string | null;
    contentType: string;
    byteSize: string | null;
    width: number | null;
    height: number | null;
    storageKey: string;
    createdBy: string;
    createdAt: string;
  }>;
  socials: Array<{
    id: string;
    url: string;
    accessible: boolean | null;
    httpStatus: number | null;
    rejection: string | null;
    controlsConfirmedByFounder: boolean;
    removed: boolean;
    checkedAt: string | null;
  }>;
  interview: {
    configuration: {
      bookable: boolean;
      missingSettings: string[];
      providers: string[];
      interviewers: string[];
      availability: string | null;
      reminderLeadHours: number | null;
    };
    booking: Record<string, unknown> | null;
    history: Array<Record<string, unknown>>;
  };
  itemHistory: Array<{
    id: string;
    item: AdminOptionalItemKey;
    event: string;
    priorComplete: boolean | null;
    newComplete: boolean | null;
    reason: string | null;
    customerExplanation: string | null;
    actor: string;
    occurredAt: string;
  }>;
}

export interface AdminWorkspaceResponse {
  workspace: AdminWorkspace | null;
  whatHappened?: string;
}

const workspaceBase = (campaignId: string) =>
  `/api/admin/campaigns/${encodeURIComponent(campaignId)}/workspace`;

export const fetchAdminWorkspace = (campaignId: string): Promise<AdminWorkspaceResponse> =>
  call(workspaceBase(campaignId));

export const recheckWorkspace = (campaignId: string): Promise<AdminWorkspaceResponse> =>
  call(`${workspaceBase(campaignId)}/recheck`, { method: 'POST', body: JSON.stringify({}) });

export const invalidateOptionalItem = (
  campaignId: string,
  item: AdminOptionalItemKey,
  body: { reason: string; explanation: string },
): Promise<AdminWorkspaceResponse> =>
  call(`${workspaceBase(campaignId)}/items/${item}/invalidate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const reinstateOptionalItem = (
  campaignId: string,
  item: AdminOptionalItemKey,
  reason: string,
): Promise<AdminWorkspaceResponse> =>
  call(`${workspaceBase(campaignId)}/items/${item}/reinstate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/** §12: an override requires reason, explanation, and the evidence it rests on. */
export const overrideOptionalItem = (
  campaignId: string,
  item: AdminOptionalItemKey,
  body: { complete: boolean; reason: string; explanation: string; evidence: string },
): Promise<AdminWorkspaceResponse> =>
  call(`${workspaceBase(campaignId)}/items/${item}/override`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── Creator readiness and fixed-payment funding (§16) — Phase 13 ───────────── */

export interface AdminReadinessItem {
  key: string;
  label: string;
  owner: string;
  specRef: string;
  complete: boolean;
  applicable: boolean;
}

export interface AdminReadinessFixedPayment {
  applicable: boolean;
  status?: string;
  label?: string;
  amountCents?: string;
  fundingDeadlineAt?: string | null;
  fundedAt?: string | null;
  canceledAt?: string | null;
  proposalVersionId?: string | null;
}

export interface AdminReadinessCreator {
  associationId: string;
  publicHandle: string | null;
  legalName: string | null;
  status: string;
  canBeginWork: boolean;
  items: AdminReadinessItem[];
  fixedPayment: AdminReadinessFixedPayment;
}

export interface AdminReadiness {
  campaignId: string;
  campaignStatus: string;
  campaignLiveAt: string | null;
  scheduleBlockers: string[];
  canScheduleLive: boolean;
  creators: AdminReadinessCreator[];
}

const readinessBase = (campaignId: string) =>
  `/api/admin/campaigns/${encodeURIComponent(campaignId)}`;

export const fetchAdminCreatorReadiness = (
  campaignId: string,
): Promise<{ readiness: AdminReadiness }> =>
  call(`${readinessBase(campaignId)}/creator-readiness`);

export const confirmCreatorDeliverables = (
  campaignId: string,
  associationId: string,
  confirmed: boolean,
): Promise<unknown> =>
  call(`${readinessBase(campaignId)}/creators/${encodeURIComponent(associationId)}/confirm-deliverables`, {
    method: 'POST',
    body: JSON.stringify({ confirmed }),
  });

export const setFundingDeadline = (
  campaignId: string,
  associationId: string,
  deadlineAt: string,
): Promise<unknown> =>
  call(`${readinessBase(campaignId)}/creators/${encodeURIComponent(associationId)}/funding-deadline`, {
    method: 'POST',
    body: JSON.stringify({ deadlineAt }),
  });

export const cancelFundingLapse = (
  campaignId: string,
  associationId: string,
  reason: string,
): Promise<unknown> =>
  call(`${readinessBase(campaignId)}/creators/${encodeURIComponent(associationId)}/cancel-funding-lapse`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const scheduleCampaignLive = (
  campaignId: string,
  liveAt: string,
): Promise<{ campaign: { campaignLiveAt: string } }> =>
  call(`${readinessBase(campaignId)}/schedule-live`, {
    method: 'POST',
    body: JSON.stringify({ liveAt }),
  });

/* ── Phase 16a: §26.5 ledger, §26.6 money, §31.7 risk, §33.12.4 overrides ─── */

export interface LedgerRowState {
  reservationId: string;
  campaignId: string;
  campaignType: string | null;
  status: string;
  reservedAt: string | null;
  rewardSku: string | null;
  rewardTitle: string | null;
  rewardSubtotalCents: string;
  salesTaxCents: string;
  totalAuthorizedCents: string | null;
  totalCapturedCents: string;
  taxJurisdiction: string | null;
  taxabilityReason: string | null;
  taxCalculationExpiresAt: string | null;
  taxCloseUsable: boolean | null;
  consentAppendix: string | null;
  consentVersion: string | null;
  founderMarketingConsent: boolean;
  newsletterConsent: boolean;
  attributionSource: string | null;
  attributionStatus: string | null;
  linkActivatedAt: string | null;
  capResult: string | null;
  duplicateCaseStatus: string | null;
  /** §25.7 restricted — rendered on screen, never written into an export. */
  backerEmail: string | null;
  backerPhone: string | null;
}

export interface LedgerPageState {
  dimensions: string[];
  rows: LedgerRowState[];
  total: number;
  summary: {
    uniqueBackers: number;
    transactions: number;
    subtotalCents: string;
    taxCents: string;
    capturedCents: string;
  };
}

export const fetchLedger = (query: string): Promise<LedgerPageState> =>
  call<LedgerPageState>(`/api/admin/ledger${query ? `?${query}` : ''}`);

export interface MoneyControlLineState {
  key: string;
  amounts: Record<string, string>;
  populated: boolean;
  populatedBy: string;
  awaiting: string | null;
}

export interface MoneyPanelState {
  campaignId: string;
  campaignStatus: string;
  lines: MoneyControlLineState[];
  provisionalReconciles: boolean | null;
  taxExcludedFromFees: boolean | null;
}

export const fetchMoneyControls = (campaignId: string): Promise<MoneyPanelState> =>
  call<MoneyPanelState>(`/api/admin/money/${encodeURIComponent(campaignId)}`);

export interface RiskSignalState {
  key: string;
  severity: 'blocking' | 'review' | 'monitor';
  count: number;
  instances: Array<{ id: string; detail: string }>;
  notYetObservable: boolean;
}

export interface RiskPanelState {
  campaignId: string | null;
  signals: RiskSignalState[];
  blockingKeys: string[];
  sellerTaxReadiness: {
    recorded: boolean;
    ready: boolean;
    missingFacts: string[];
    recordedBy: string | null;
    evidenceReference: string | null;
    recordedAt: string | null;
  };
}

export const fetchRiskPanel = (campaignId?: string): Promise<RiskPanelState> =>
  call<RiskPanelState>(
    `/api/admin/risk${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`,
  );

export const recordSellerTaxReadiness = (
  campaignId: string,
  body: Record<string, string>,
): Promise<{ ready: boolean; missingFacts: string[] }> =>
  call(`/api/admin/risk/${encodeURIComponent(campaignId)}/seller-tax-readiness`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface OverridePreviewState {
  previewId: string;
  consequences: Array<{ audience: string; text: string }>;
  expiresAt: string;
}

export const previewOverride = (
  fieldKey: string,
  targetId: string,
  newValue: unknown,
): Promise<OverridePreviewState> =>
  call('/api/admin/overrides/preview', {
    method: 'POST',
    body: JSON.stringify({ fieldKey, targetId, newValue }),
  });

export const executeOverride = (body: {
  fieldKey: string;
  targetId: string;
  newValue: unknown;
  internalReason: string;
  customerExplanation: string;
  previewId: string;
}): Promise<{ overrideId: string; priorValue: unknown; newValue: unknown; replayed: boolean }> =>
  call('/api/admin/overrides', { method: 'POST', body: JSON.stringify(body) });

/* ── Phase 16b: §26.7/§27.8 support, §26.7 enforcement, §26.8 timeline ────── */

export interface QueueEntryState {
  caseId: string;
  reference: string;
  topic: string;
  owner: string;
  status: string;
  humanResponseDueAt: string;
  nextPromisedUpdateAt: string | null;
  founderFollowupDueAt: string | null;
  responseOverdue: boolean;
  promiseOverdue: boolean;
  founderFollowupOverdue: boolean;
  requesterEmail: string;
  campaignId: string | null;
}

export interface SupportQueueState {
  entries: QueueEntryState[];
  dueCount: number;
  overdueCount: number;
}

export const fetchSupportQueue = (): Promise<SupportQueueState> =>
  call<SupportQueueState>('/api/admin/support/queue');

export interface CaseDetailState {
  reference: string;
  topic: string;
  owner: string;
  status: string;
  humanResponseDueAt: string;
  nextPromisedUpdateAt: string | null;
  founderFollowupDueAt: string | null;
  requesterEmail: string;
  campaign: { id: string; title: string | null; status: string } | null;
  reservation: {
    id: string;
    status: string;
    rewardTitle: string | null;
    subtotalCents: string;
    taxCents: string;
    totalAuthorizedCents: string | null;
    statementDescriptor: string | null;
    reservedAt: string | null;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    customerFacing: boolean;
    body: string;
    author: string;
    occurredAt: string;
  }>;
  handoffs: Array<{
    id: string;
    verifiedFacts: string;
    currentOwner: string;
    nextCustomerPromise: string;
    statementsToKeepConsistent: string;
    occurredAt: string;
  }>;
  templates: Array<{ key: string; label: string; specRef: string; useWhen: string }>;
}

export const fetchCase = (caseId: string): Promise<CaseDetailState> =>
  call<CaseDetailState>(`/api/admin/support/cases/${encodeURIComponent(caseId)}`);

export const fetchTemplateDraft = (
  caseId: string,
  templateKey: string,
): Promise<{ key: string; label: string; draft: string; preservedFacts: Record<string, string>; note: string }> =>
  call(
    `/api/admin/support/cases/${encodeURIComponent(caseId)}/templates/${encodeURIComponent(templateKey)}`,
  );

export const addCaseMessage = (
  caseId: string,
  body: { direction: 'inbound' | 'outbound'; customerFacing: boolean; body: string; templateKey?: string },
): Promise<{ messageId: string }> =>
  call(`/api/admin/support/cases/${encodeURIComponent(caseId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const transferCase = (
  caseId: string,
  body: {
    toOwner: string;
    verifiedFacts: string;
    currentOwner: string;
    nextCustomerPromise: string;
    statementsToKeepConsistent: string;
  },
): Promise<{ handoffId: string }> =>
  call(`/api/admin/support/cases/${encodeURIComponent(caseId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface TimelineState {
  subject: string;
  subjectId: string;
  entries: Array<{
    kind: string;
    occurredAt: string;
    summary: string;
    actor: string | null;
    composedFrom: string;
    detail?: Record<string, unknown>;
  }>;
  sourcesRead: string[];
}

export const fetchTimeline = (subject: string, subjectId: string): Promise<TimelineState> =>
  call<TimelineState>(
    `/api/admin/timeline/${encodeURIComponent(subject)}/${encodeURIComponent(subjectId)}`,
  );

export interface EnforcementState {
  actions: Array<{
    id: string;
    action: string;
    phase: string;
    reasonCategory: string;
    reasonDetail: string;
    customerExplanation: string;
    priorCampaignStatus: string;
    newCampaignStatus: string;
    effectsApplied: string[];
    reservationsClosed: number;
    paymentMethodsDetached: number;
    actor: string;
    occurredAt: string;
  }>;
  reasonCategories: string[];
}

export const fetchEnforcement = (campaignId: string): Promise<EnforcementState> =>
  call<EnforcementState>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/enforcement`);

export const enforceCampaign = (
  campaignId: string,
  body: {
    action: string;
    reasonCategory: string;
    reasonDetail: string;
    customerExplanation: string;
  },
): Promise<{ phase: string; reservationsClosed: number; effectsApplied: string[] }> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/enforcement`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const fetchRelationshipTouches = (
  campaignId: string,
): Promise<{
  touches: Array<{ id: string; kind: string; note: string; recordedBy: string; occurredAt: string }>;
  kinds: string[];
  note: string;
}> => call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/relationship-touches`);

export const recordRelationshipTouch = (
  campaignId: string,
  body: { kind: string; note: string },
): Promise<{ touchId: string }> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/relationship-touches`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── §21 close operations (Phase 18b) ──────────────────────────────────────── */

export interface CloseOperationsState {
  operations: {
    incomplete: Array<{
      campaignId: string;
      batchStatus: string;
      campaignStatus: string;
      startedAt: string;
      lockedReservations: number;
      unresolvedAttempts: number;
      openDedupCases: number;
      recovery: string;
    }>;
    retryWindow: Array<{
      campaignId: string;
      firstFailureAt: string | null;
      retryDeadlineAt: string | null;
      retrying: number;
    }>;
    reconciling: Array<{
      campaignId: string;
      campaignStatus: string;
      requiredItemsVerified: number;
      requiredItemsTotal: number;
      resultsPrepared: boolean;
    }>;
  };
  reconciliationItems: Array<{
    key: string;
    spec: string;
    evaluation: 'app' | 'admin';
    requiredForResults: boolean;
    waitsOn: string | null;
  }>;
  narrativeFields: Array<{ key: string; label: string }>;
}

export interface CloseBatchDetailState {
  detail: {
    campaignId: string;
    campaignStatus: string;
    batch: {
      status: string;
      startedAt: string;
      completedAt: string | null;
      thresholdDecision: { met: boolean; unique: number; required: number } | null;
      retryWindowHours: number;
      firstFailureAt: string | null;
      retryDeadlineAt: string | null;
    } | null;
    reservationsByStatus: Record<string, number>;
    attempts: Array<{
      reservationId: string;
      attemptNumber: number;
      idempotencyKey: string;
      amountCents: string;
      outcome: string | null;
      paymentIntentId: string | null;
      requestedAt: string;
      resolvedAt: string | null;
    }>;
  };
  reconciliation: {
    campaignId: string;
    campaignStatus: string;
    open: boolean;
    openReason: string | null;
    items: Array<{
      key: string;
      spec: string;
      evaluation: 'app' | 'admin';
      requiredForResults: boolean;
      derived: Record<string, unknown> | null;
      waitsOn: string | null;
      latest: { result: string; note: string; actor: string; recordedAt: string } | null;
      history: Array<{ result: string; note: string; actor: string; recordedAt: string }>;
    }>;
    resultsPrepared: boolean;
  } | null;
}

export const fetchCloseOperations = (): Promise<CloseOperationsState> =>
  call<CloseOperationsState>('/api/admin/close');

export const fetchCloseDetail = (campaignId: string): Promise<CloseBatchDetailState> =>
  call<CloseBatchDetailState>(`/api/admin/close/${encodeURIComponent(campaignId)}`);

export const resumeCloseBatch = (
  campaignId: string,
): Promise<{ batch: { status: string }; windowEnd: { status: string } }> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const recordCloseReconciliation = (
  campaignId: string,
  body: { itemKey: string; result: 'verified' | 'discrepancy'; note: string },
): Promise<{ record: unknown }> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/reconciliation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const prepareCloseResults = (
  campaignId: string,
  body: {
    strongestSignal: string;
    weakestSignal: string;
    leadingSurveyReason: string;
    whatThisProves: string;
    whatThisDoesNotProve: string;
  },
): Promise<{ results: unknown }> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/results`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── §22.1/§22.2 Creator earnings (Phase 19a) ──────────────────────────────── */

export interface EarningsCreatorRow {
  associationId: string;
  associationStatus: string;
  publicHandle: string | null;
  email: string | null;
  attributedCaptured: number;
  validSubtotalCents: string;
  latestDecision: {
    id: string;
    outcome: string;
    deliverablesNote: string;
    waiver: string | null;
    decidedBy: string;
    decidedAt: string;
  } | null;
  earnings: {
    id: string;
    state: string;
    earnedPercent: number;
    earnedBonusPercent: number;
    commissionCents: string;
    bonusCents: string;
    eligibleFixedCents: string;
    provisionalTotalCents: string;
    earnedTotalCents: string;
    unearnedReturnedCents: string;
  } | null;
  transfer: {
    id: string;
    status: string;
    totalCents: string;
    providerTransferId: string | null;
    attemptCount: number;
  } | null;
  allocation: { status: string; amountCents: string } | null;
  thankYou: Array<{ kind: string; amountCents: string | null; createdAt: string }>;
  transferEarliestAt: string | null;
}

export interface CampaignEarningsState {
  creators: EarningsCreatorRow[];
  completionOutcomes: Array<{ key: string; spec: string }>;
  thankYouEligibilityFacts: Array<{ key: string; label: string }>;
}

export const fetchCampaignEarnings = (campaignId: string): Promise<CampaignEarningsState> =>
  call<CampaignEarningsState>(`/api/admin/close/${encodeURIComponent(campaignId)}/earnings`);

export const recordCompletionDecision = (
  associationId: string,
  body: {
    outcome: string;
    deliverablesNote: string;
    waiver?: string;
    waiverAgreedByFounder?: boolean;
    waiverAgreedByAdmin?: boolean;
  },
): Promise<{ decision: unknown; fixedAction: string }> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/completion`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const finalizeCreatorEarnings = (associationId: string): Promise<{ earnings: unknown }> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/finalize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const approveCreatorEarnings = (associationId: string): Promise<{ earnings: unknown }> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const createCreatorTransfer = (associationId: string): Promise<{ transfer: unknown }> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const recordCreatorThankYou = (
  associationId: string,
  body: {
    kind: 'recognition' | 'payment';
    reason: string;
    amountCents?: string;
    minimumWorkCompleted: boolean;
    clickThresholdMet: boolean;
    brandAupCompliant: boolean;
    approvalReference?: string;
    approvedBy?: string;
    taxTreatment?: string;
  },
): Promise<{ record: unknown }> =>
  call(`/api/admin/close/creators/${encodeURIComponent(associationId)}/thank-you`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── §22.3: the Founder payment queue (Phase 19b) ──────────────────────────── */

export interface AdminFounderPaymentLine {
  kind: 'single_payment' | 'first_payment' | 'remaining_payment';
  label: string;
  percent: number;
  amountCents: string;
  amountExact: boolean;
  status: 'blocked' | 'eligible' | 'released';
  blockers: string[];
  secureAction: string | null;
  noActionNeeded: boolean;
  dueAt: string;
  releasedAt: string | null;
  releasedEarly: boolean;
}

export interface AdminFounderPaymentState {
  status: {
    campaignId: string;
    model: 'idea' | 'product';
    campaignStatus: string;
    applicable: boolean;
    notApplicableReason: string | null;
    w9: {
      state: 'not_requested' | 'requested' | 'submitted' | 'verified';
      line: string;
      action: string;
      requestedAt: string | null;
      submittedAt: string | null;
      verifiedAt: string | null;
      returnReason: string | null;
      blocksPayments: boolean;
    };
    eligibleShare: { exact: boolean; amountCents: string; note: string };
    payments: AdminFounderPaymentLine[];
    nextReviewDate: string | null;
    day14: { dueAt: string; line: string } | null;
    earlyRelease: {
      settingEnabled: boolean;
      evidence: { id: string; recordedAt: string; missingFacts: string[] } | null;
      pendingRequest: { id: string; createdAt: string } | null;
      neverSkipsDay14: string;
    } | null;
  };
  requests: Array<{
    id: string;
    status: 'pending' | 'approved' | 'declined';
    message: string;
    requestedBy: string;
    createdAt: string;
    decisionReason: string | null;
  }>;
  evidenceFacts: Array<{ key: string; label: string; note: string | null }>;
}

const founderPaymentsBase = (campaignId: string) =>
  `/api/admin/close/${encodeURIComponent(campaignId)}/founder-payments`;

export const fetchFounderPaymentQueue = (campaignId: string): Promise<AdminFounderPaymentState> =>
  call<AdminFounderPaymentState>(founderPaymentsBase(campaignId));

export const requestW9 = (campaignId: string): Promise<{ record: unknown }> =>
  call(`${founderPaymentsBase(campaignId)}/w9/request`, { method: 'POST', body: JSON.stringify({}) });

export const recordW9Receipt = (
  campaignId: string,
  reference: string,
): Promise<{ record: unknown }> =>
  call(`${founderPaymentsBase(campaignId)}/w9/submitted`, {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });

export const decideW9 = (
  campaignId: string,
  decision: 'verified' | 'resubmission_required',
  note: string,
): Promise<{ record: unknown; status: string }> =>
  call(`${founderPaymentsBase(campaignId)}/w9/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  });

export const recordEarlyEvidence = (
  campaignId: string,
  facts: Record<string, { recorded: boolean; detail: string }>,
): Promise<{ evidence: unknown; missing: string[] }> =>
  call(`${founderPaymentsBase(campaignId)}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ facts }),
  });

export const decideEarlyRelease = (
  campaignId: string,
  decision: 'approved' | 'declined',
  reason: string,
): Promise<{ request: unknown; status: string }> =>
  call(`${founderPaymentsBase(campaignId)}/early-release/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });

export const createFounderPayment = (
  campaignId: string,
  body: { kind: string; checksNote?: string; approvedBy?: string },
): Promise<{ payment: unknown }> =>
  call(founderPaymentsBase(campaignId), { method: 'POST', body: JSON.stringify(body) });

export const releaseFounderPayment = (
  campaignId: string,
  kind: string,
): Promise<{ payment: unknown }> =>
  call(`${founderPaymentsBase(campaignId)}/${encodeURIComponent(kind)}/release`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
