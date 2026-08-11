/**
 * The Creator (Affiliate) workspace API client.
 *
 * One rule, the same one `features/admin/api.ts` states: the server decides,
 * and its refusal is what the Admin reads. Nothing here invents a friendlier
 * message over a server one — the server already answers §27.1's six questions
 * in `whatHappened` / `next` / `action`, and paraphrasing it in the browser is
 * how the two start disagreeing.
 *
 * ── Two routers, and that is deliberate ─────────────────────────────────────
 * `/api/admin/creators/*` is keyed on the PERSON: the directory, the record,
 * the history, and the three person-level writes. `/api/admin/affiliates/*` is
 * keyed on ONE campaign relationship: recruiting, the research record, the
 * verification decision, and the private invitation. Both are called from this
 * surface because the workspace shows both — a person and their relationships —
 * and collapsing them into one address would mean either the person or the
 * relationship losing its own identity.
 *
 * ── The types are restated, not imported ────────────────────────────────────
 * `backend/src/affiliates/workspace/types.ts` is the contract. The frontend
 * mirrors it name-for-name rather than importing it, because the two packages
 * have separate build roots — the same arrangement the Founder workspace uses.
 * The vocabulary types DO come from `@proovd/shared`, which both sides import.
 */

import type {
  AttentionOwner,
  CreatorAccountState,
  CreatorAttentionKind,
  CreatorHistoryCategory,
  ProvenanceKey,
} from '@proovd/shared';
import { AdminRequestError, call } from '../api.js';

export { AdminRequestError };
export type { AdminError } from '../api.js';

/* ── The contract ───────────────────────────────────────────────────────────*/

export type CreatorAttention =
  | { needed: false }
  | {
      needed: true;
      kind: CreatorAttentionKind;
      owner: AttentionOwner;
      label: string;
      detail: string;
      associationId: string | null;
    };

export interface CreatorDirectoryRow {
  prospectId: string;
  initials: string;
  name: string;
  handle: string | null;
  subtype: string | null;
  platform: string | null;
  niche: string | null;
  verification: { state: string; label: string; at: string | null; missing: number };
  campaigns: {
    total: number;
    activeSlots: number;
    slotLimit: number;
    leadLabel: string | null;
  };
  payout: { state: string | null; label: string };
  account: CreatorAccountState;
  attention: CreatorAttention;
  filters: { adminWork: boolean; verification: boolean; payout: boolean };
  searchText: string;
  recruitedAt: string | null;
}

export type CreatorMenuAction = 'assign' | 'suspend' | 'restore' | 'deletion' | 'verify';

export interface CreatorHeader {
  prospectId: string;
  initials: string;
  name: string;
  handle: string | null;
  channelUrl: string | null;
  platform: string | null;
  subtype: string | null;
  niche: string | null;
  location: string | null;
  verification: { state: string; label: string; at: string | null; missing: string[] };
  slots: { used: number; limit: number; remaining: number; atLimit: boolean };
  payout: { state: string | null; label: string };
  account: CreatorAccountState;
  attention: CreatorAttention;
  availableActions: CreatorMenuAction[];
}

export interface CreatorRelationshipSummary {
  associationId: string;
  campaignId: string;
  campaignName: string;
  founderName: string | null;
  campaignType: string | null;
  campaignTypeRaw: 'pre_build' | 'pre_launch' | null;
  status: string;
  statusRaw: string;
  designation: string;
  owner: AttentionOwner;
  activatedAt: string | null;
  closesAt: string | null;
  holdsSlot: boolean;
}

export interface ProfileField {
  key: string;
  label: string;
  value: string | null;
  helper: string | null;
  emptyLabel: string;
  wide?: boolean;
}

export interface ProfileBlock {
  provenance: ProvenanceKey;
  title: string;
  fields: ProfileField[];
}

export interface EvidenceItem {
  id: string;
  label: string;
  basis: string;
  value: string | null;
  required: boolean;
}

export interface VerificationBlock {
  state: string;
  label: string;
  at: string | null;
  by: string | null;
  metricLabel: string;
  metrics: ProfileField[];
  evidence: EvidenceItem[];
  missing: string[];
}

export interface ProviderBlock {
  populated: boolean;
  waitingOn: string | null;
  accountId: string | null;
  state: string | null;
  label: string;
  transferCapability: string;
  requirements: string[];
  requirementsLabel: string;
  lastUpdated: string | null;
}

export interface CreatorInvitationView {
  associationId: string;
  campaignName: string;
  state: string;
  stateLabel: string;
  lastSentAt: string | null;
  hasLiveToken: boolean;
  claimedAt: string | null;
  sends: { at: string; by: string; to: string; status: string; confirmed: boolean }[];
  unresolved: string[];
  canSend: boolean;
}

export interface CreatorProfilePane {
  summary: { handle: string | null; channelUrl: string | null; platform: string | null };
  blocks: ProfileBlock[];
  verification: VerificationBlock;
  provider: ProviderBlock;
  invitations: CreatorInvitationView[];
  support: ProfileField[];
  deletionRequest: {
    id: string;
    detail: string;
    requestedAt: string;
    receivedVia: string;
    reviews: { note: string; actor: string; at: string }[];
  } | null;
}

export interface CreatorHistoryEntry {
  category: CreatorHistoryCategory;
  at: string;
  occurredAt: string;
  title: string;
  detail: string;
  actor: string;
  source: string;
  reference: string;
}

export interface CreatorWorkspaceDetail {
  header: CreatorHeader;
  relationships: CreatorRelationshipSummary[];
  profile: CreatorProfilePane;
  standing: CreatorStandingPane;
  history: CreatorHistoryEntry[];
  historyCounts: Record<string, number>;
}

/* ── Person-scoped: /api/admin/creators ─────────────────────────────────────*/

export function fetchCreators(): Promise<{ creators: CreatorDirectoryRow[] }> {
  return call('/api/admin/creators');
}

export function fetchCreator(prospectId: string): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}`);
}

export interface AssignCampaignBody {
  campaignId: string;
  rosterIntent: 'initial_roster' | 'mid_campaign';
  recruitmentSource?: string | null;
  whyRecruited?: string | null;
}

export function assignToCampaign(
  prospectId: string,
  body: AssignCampaignBody,
): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/assign-campaign`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordDeletionRequest(
  prospectId: string,
  body: { detail: string; receivedVia: string; requestedAt?: string | null },
): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/deletion-request`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordDeletionReview(
  prospectId: string,
  requestId: string,
  body: { note: string },
): Promise<CreatorWorkspaceDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/deletion-request/${encodeURIComponent(requestId)}/reviews`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/* ── Relationship-scoped: /api/admin/affiliates ─────────────────────────────*/

/** §5.3's seven subtypes, their required evidence, and §8's fixed copy. */
export interface AffiliateRegistry {
  subtypes: readonly string[];
  requiredEvidence: Record<string, readonly string[]>;
  verificationStatuses: readonly string[];
  fixedCopy: { preparingNotice: string; declineNotice: string; neverAsksNotice: string };
}

export function fetchAffiliateRegistry(): Promise<AffiliateRegistry> {
  return call('/api/admin/affiliates/registry');
}

/**
 * Recruiting a new Affiliate — the reference's four-step Add flow.
 *
 * Posts to the route §8 already owns. The wizard collects what that route
 * requires and nothing else: a field the route would ignore is a field the
 * form should not have asked for.
 */
export interface CreateAffiliateBody {
  legalName: string;
  publicHandle: string;
  email: string;
  phone?: string | null;
  subtype: string;
  channelReference: string;
  audienceNiche: string;
  audienceSize?: string | null;
  engagementEvidence?: Record<string, string> | null;
  audienceDemographics?: string | null;
  permissionBasis: string;
  priorSponsoredContent?: string | null;
  adminBio: string;
  qualityTier?: string | null;
  conflictNotes?: string | null;
  sanctionsNotes?: string | null;
  internalComments?: string | null;
  recruitmentSource: string;
  recruitingAdmin: string;
  campaignId: string;
  rosterIntent?: 'initial_roster' | 'mid_campaign';
}

export function createAffiliate(
  body: CreateAffiliateBody,
): Promise<{ associationId: string; prospectId: string }> {
  return call('/api/admin/affiliates', { method: 'POST', body: JSON.stringify(body) });
}

/** A partial research update. A key absent from the body writes nothing. */
export function updateAffiliateProspect(
  associationId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/prospect`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function recordVerification(
  associationId: string,
  body: { status: string; evidence?: Record<string, string>; verifiedBy: string },
): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/verification`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function composeInvitation(
  associationId: string,
  body: {
    whyRecruited?: string | null;
    reviewedPresence?: string | null;
    senderName?: string | null;
    senderEmail?: string | null;
  },
): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/invitation`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export interface InvitationPreview {
  subject: string;
  html: string;
  text: string;
  unresolved: string[];
  recipientEmail: string | null;
  blocked: boolean;
  claimUrlShape: string;
}

export function previewInvitation(associationId: string): Promise<InvitationPreview> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/preview`);
}

export function sendInvitation(associationId: string): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/send`, {
    method: 'POST',
  });
}

export function revokeInvitation(
  associationId: string,
  body: { reason: string },
): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── The campaign picker ────────────────────────────────────────────────────*/

/**
 * A campaign an Affiliate can be attached to.
 *
 * The Founder rides along because the reference's audit refuses a free-text
 * Founder field: the Founder follows from the campaign rather than being a
 * second choice somebody could mismatch.
 */
export interface AssignableCampaign {
  campaignId: string;
  name: string;
  founderName: string | null;
  type: string | null;
  status: string;
}

export function fetchAssignableCampaigns(): Promise<{ campaigns: AssignableCampaign[] }> {
  return call('/api/admin/creators/campaigns');
}

/* ── One campaign relationship ──────────────────────────────────────────────*/

export interface RelationshipTask {
  kind: 'task' | 'waiting';
  owner: AttentionOwner;
  title: string;
  meta: string;
  action: { label: string; to: 'review' | 'agreement' | 'money' | 'profile' } | null;
}

export interface RelationshipSection<T> {
  populated: boolean;
  waitingOn: string | null;
  value: T | null;
}

export interface RelationshipBand {
  campaignName: string;
  campaignType: string | null;
  founderName: string | null;
  status: string;
  statusRaw: string;
  owner: AttentionOwner;
  designation: string;
  activatedAt: string | null;
  closesAt: string | null;
  responseDeadlineAt: string | null;
}

export interface RelationshipLink {
  state: 'inactive' | 'active' | 'paused';
  label: string;
  url: string | null;
  code: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  pausedReason: string | null;
  testUrl: string | null;
}

export interface CreatorRelationshipDetail {
  associationId: string;
  prospectId: string;
  campaignId: string;
  creatorName: string;
  band: RelationshipBand;
  overview: {
    tasks: RelationshipTask[];
    link: RelationshipLink | null;
    readiness: {
      complete: number;
      applicable: number;
      canBeginWork: boolean;
      items: {
        key: string;
        label: string;
        owner: string;
        complete: boolean;
        applicable: boolean;
      }[];
    } | null;
    kit: {
      revealedAt: string | null;
      revokedAt: string | null;
      revokedReason: string | null;
      accessCount: number;
      lastAccessAt: string | null;
    };
  };
  agreement: {
    lockState: string;
    headlinePercent: string | null;
    headlineRest: string;
    bonus: string | null;
    versions: {
      id: string;
      number: number;
      proposedBy: string;
      totalPercent: number | null;
      fixedPaymentCents: string | null;
      state: string;
      affiliateDecision: string | null;
      founderDecision: string | null;
      createdAt: string | null;
      lockedAt: string | null;
    }[];
    agreement: {
      basePercent: number;
      bidIncreasePercent: number;
      totalPercent: number;
      fixedPayment: string | null;
      acceptedAt: string | null;
    } | null;
    fixedPayment: {
      available: boolean;
      rule: string;
      status: string;
      amount: string | null;
      source: string;
      fundedAt: string | null;
      deadlineAt: string | null;
    };
  };
  content: {
    submission: {
      id: string;
      version: number;
      url: string;
      status: string;
      statusLabel: string;
      submittedAt: string | null;
      verifiedAt: string | null;
      verifiedBy: string | null;
      correctionDetail: string | null;
      correctionDueAt: string | null;
      enforcementReason: string | null;
      checklist: { id: string; label: string; passed: boolean }[] | null;
    } | null;
    history: { version: number; url: string; status: string; submittedAt: string | null }[];
    performance: RelationshipSection<{
      clicks: number;
      attributedReservations: number;
      capturedAttributed: number;
      conversion: string | null;
      capturedSubtotal: string;
      freshness: string;
    }>;
  };
  money: {
    headline: { status: string; label: string; amount: string; owner: string };
    earnings: RelationshipSection<{
      validSubtotal: string;
      commission: string;
      bonus: string;
      fixedPayment: string;
      taxInBase: string;
      lockedPercent: number;
      earnedPercent: number;
      provisionalTotal: string;
      earnedTotal: string;
      unearnedReturned: string;
      state: string;
      stateHistory: { at: string; from: string | null; to: string; reason: string | null }[];
    }>;
    transfer: RelationshipSection<{
      status: string;
      total: string;
      requestedAt: string | null;
      confirmedAt: string | null;
      attempts: number;
    }>;
    completion: {
      outcome: string | null;
      decidedAt: string | null;
      deliverablesNote: string | null;
    } | null;
  };
}

export function fetchRelationship(
  prospectId: string,
  associationId: string,
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}`,
  );
}

/**
 * Pausing or reactivating the tracking link.
 *
 * Answers with the whole relationship re-read, so the surface never patches a
 * link state locally — a locally-flipped pause is a claim about attribution
 * nobody confirmed.
 */
export function setLinkPaused(
  prospectId: string,
  associationId: string,
  body: { action: 'pause' | 'reactivate'; reason?: string | null },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/link`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * The §17 verification, at the route that already owns it.
 *
 * Addressed by SUBMISSION id, not by association: §17 verifies one submitted
 * post, and a corrected resubmission is a new record with its own decision.
 * Building a second verify route here would be a second set of §17's three
 * outcomes and their effects.
 */
export function verifyPost(
  submissionId: string,
  body: {
    outcome: 'passed' | 'correction_needed' | 'rejected';
    checklist: Record<string, boolean>;
    correctionDetail?: string;
    correctionDueAt?: string;
    enforcementReason?: string;
  },
): Promise<unknown> {
  return call(`/api/admin/post-submissions/${encodeURIComponent(submissionId)}/verify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── Policy, cases, and access (§26.7, §29) ────────────────────────────────*/

export interface CreatorStandingPane {
  account: {
    state: CreatorAccountState;
    latest: {
      action: string;
      reason: string;
      evidence: string | null;
      reviewOwner: string | null;
      nextReviewAt: string | null;
      actor: string;
      at: string;
    } | null;
    history: { action: string; reason: string; actor: string; at: string }[];
  };
  enforcement: {
    id: string;
    associationId: string;
    campaignName: string;
    actionKind: string;
    reasonCategory: string;
    statement: {
      evidenceAndBehavior: string;
      ruleViolated: string;
      immediateEffect: string;
      correctionPath: string;
      humanRoute: string;
    };
    appealDueAt: string | null;
    appeal: {
      id: string;
      grounds: string;
      decision: string | null;
      decidedAt: string | null;
    } | null;
    at: string;
  }[];
  disclosures: {
    kind: 'conflict' | 'self_preorder';
    associationId: string;
    campaignName: string;
    detail: string;
    at: string;
  }[];
  policyReacceptanceOpen: boolean;
}

/**
 * The §26.7 access decision.
 *
 * Two actions and no third: there is no permanent Creator sanction in the Spec,
 * and the column admits nothing else.
 */
export function recordAccessDecision(
  prospectId: string,
  body: {
    action: 'suspend' | 'restore';
    reason: string;
    evidence?: string | null;
    reviewOwner?: string | null;
    nextReviewAt?: string | null;
  },
): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/access`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── §29 enforcement, appeals, and disclosures ─────────────────────────────*/

/**
 * The §29.4 action, at the route that already owns it.
 *
 * Association-scoped, because §29 records Creator enforcement per campaign
 * relationship — a Creator paused on one campaign is not paused on another.
 * All five customer-facing statement fields are required by the schema, by the
 * service, and by a CHECK: a record with no row shape for them cannot exist.
 */
export function recordEnforcement(
  associationId: string,
  body: {
    actionKind: string;
    reasonCategory: string;
    internalReason: string;
    evidenceAndBehavior: string;
    ruleViolated: string;
    immediateEffect: string;
    correctionPath: string;
    humanRoute: string;
    terminationValidity?: string | null;
  },
): Promise<unknown> {
  return call(`/api/admin/associations/${encodeURIComponent(associationId)}/enforcement`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** §29.4's appeal. Write-once — "final" means the decision does not move. */
export function decideAppeal(
  appealId: string,
  body: { decision: 'upheld' | 'overturned'; note?: string },
): Promise<unknown> {
  return call(`/api/admin/appeals/${encodeURIComponent(appealId)}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** §29.1. Recording what somebody told us — it decides nothing. */
export function recordConflictDisclosure(
  associationId: string,
  body: { relationshipKind: string; detail: string; disclosedBy: string },
): Promise<unknown> {
  return call(
    `/api/admin/associations/${encodeURIComponent(associationId)}/conflict-disclosures`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * §29.2. Both certifications are required and CHECK-pinned true.
 *
 * The consequence — the own-link reservation's attribution moving to `blocked`,
 * so it earns no commission — follows from the recorded fact rather than from
 * an Admin's discretion.
 */
export function recordSelfPreorderDisclosure(
  associationId: string,
  body: {
    reservationId?: string | null;
    intentNote: string;
    selfFundedCertified: boolean;
    identityDisclosed: boolean;
  },
): Promise<unknown> {
  return call(
    `/api/admin/associations/${encodeURIComponent(associationId)}/self-preorder-disclosures`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/* ── Relationship operations, at the routes that already own them ──────────*/

/**
 * §14.2's one Admin action on a proposal: rejecting a policy violation.
 *
 * Admin may observe, mediate, and reject — and may never accept for either
 * party. §25.6 requires both an internal reason and a customer-facing
 * explanation, and the route refuses without both.
 */
export function rejectProposalVersion(
  versionId: string,
  body: { internalReason: string; customerExplanation: string },
): Promise<unknown> {
  return call(`/api/admin/proposals/${encodeURIComponent(versionId)}/reject`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** §16: Admin confirms the deliverables item. Readiness re-derives after it. */
export function confirmDeliverables(
  campaignId: string,
  associationId: string,
  body: { confirmed: boolean },
): Promise<unknown> {
  return call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/creators/${encodeURIComponent(associationId)}/confirm-deliverables`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * §16: re-derive readiness from the thirteen live facts.
 *
 * It grants nothing. The derivation is what moves the association between
 * `ready` and `readiness_blocked`, and an Admin cannot mark an item complete by
 * hand from anywhere.
 */
export function evaluateReadiness(
  campaignId: string,
  associationId: string,
): Promise<unknown> {
  return call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/creators/${encodeURIComponent(associationId)}/evaluate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/** §16, §24.7: the Admin-configured funding deadline for a fixed payment. */
export function setFundingDeadline(
  campaignId: string,
  associationId: string,
  body: { deadlineAt: string },
): Promise<unknown> {
  return call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/creators/${encodeURIComponent(associationId)}/funding-deadline`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** §31.5: every kit read, in order. The evidence the exception was operated. */
export function fetchKitAccessLog(associationId: string): Promise<{
  access: { id: string; section: string; affiliateUserId: string | null; occurredAt: string }[];
}> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/access-log`);
}

/** §31.5: withdrawing the pre-view. One-way at the database. */
export function revokeKitAccess(
  associationId: string,
  body: { reason: string },
): Promise<unknown> {
  return call(`/api/admin/affiliates/${encodeURIComponent(associationId)}/revoke-kit-access`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** §10's reveal, re-run. Idempotent — the reason it can be offered at all. */
export function revealPreparing(campaignId: string): Promise<unknown> {
  return call('/api/admin/affiliates/reveal', {
    method: 'POST',
    body: JSON.stringify({ campaignId }),
  });
}

/** §22.8's five criteria, evaluated from the record. Never asserted. */
export interface CompletionFindings {
  findings: { key: string; met: boolean; detail: string }[];
  current: { status: string; decidedAt: string | null } | null;
}

export function fetchCompletion(associationId: string): Promise<CompletionFindings> {
  return call(`/api/admin/completion/${encodeURIComponent(associationId)}`);
}

export function assignCompletion(
  associationId: string,
  body: {
    status: 'successfully_completed' | 'completion_disqualified';
    evidenceNote?: string | null;
    disqualifyingReason?: string;
  },
): Promise<unknown> {
  return call(`/api/admin/completion/${encodeURIComponent(associationId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
