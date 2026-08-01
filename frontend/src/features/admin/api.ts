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
