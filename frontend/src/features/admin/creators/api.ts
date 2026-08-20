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
  /** Open §26.7 cases anchored on this person — the Support tab's badge. */
  openCases: number;
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
  /** The Selected-relationship strip's three composed facts (2026-08-17). */
  agreement: string;
  trackingLink: string;
  completion: string;
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
  /** For routing to the campaign record — some blockers live on the Founder. */
  campaignId: string;
  campaignName: string;
  state: string;
  stateLabel: string;
  lastSentAt: string | null;
  hasLiveToken: boolean;
  claimedAt: string | null;
  createdAt: string | null;
  signupStartedAt: string | null;
  tokenExpiresAt: string | null;
  sends: { at: string; by: string; to: string; status: string; confirmed: boolean }[];
  unresolved: string[];
  canSend: boolean;
}

export interface EvidenceFileView {
  id: string;
  category: string;
  categoryLabel: string;
  filename: string | null;
  state: string;
  rejection: string | null;
  dimensions: string | null;
  uploadedBy: string;
  uploadedAt: string | null;
}

export interface MetricDecisionView {
  metric: string;
  label: string;
  decision: string | null;
  detail: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ProposalAccessView {
  key: 'standard' | 'restricted';
  label: string;
  derivedFrom: string | null;
}

export interface CreatorAgreementsView {
  terms: string | null;
  aup: string | null;
  policyState: string;
  publishedVersions: { slug: string; version: string; title: string }[];
  perCampaign: { associationId: string; campaignName: string; state: string }[];
}

export interface CreatorProfilePane {
  summary: { handle: string | null; channelUrl: string | null; platform: string | null };
  blocks: ProfileBlock[];
  verification: VerificationBlock;
  evidenceFiles: { available: boolean; waitingOn: string | null; files: EvidenceFileView[] };
  metricDecisions: MetricDecisionView[];
  proposalAccess: ProposalAccessView;
  agreements: CreatorAgreementsView;
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
  /** The person's delivery record — the §27 key resolves to a label from the
      shared registry in the browser (Phase 22c's rule). */
  communications: CreatorCommunicationView[];
}

export interface CreatorCommunicationView {
  eventKey: string;
  target: string;
  entityType: string;
  entityId: string;
  confirmed: boolean;
  at: string | null;
  occurredAt: string;
}

export interface CreatorCaseView {
  id: string;
  reference: string;
  topic: string;
  subject: string | null;
  status: string;
  open: boolean;
  openedAt: string | null;
  href: string;
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

/* ── Session B: evidence, corrections, asks, and the Stripe re-read ─────────*/

/** The re-read plus the ask's outcome — recorded-but-not-sent is a state. */
export interface AskOutcome {
  detail: CreatorWorkspaceDetail;
  ask: { sent: boolean; reason: string | null };
}

export function requestEvidenceUpload(
  prospectId: string,
  body: {
    category: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    originalFilename?: string | null;
  },
): Promise<{ fileId: string; url: string; requiredHeaders: Record<string, string>; expiresAt: string }> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/evidence/uploads`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyEvidenceUpload(
  prospectId: string,
  fileId: string,
): Promise<CreatorWorkspaceDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/evidence/uploads/${encodeURIComponent(fileId)}/verify`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function removeEvidenceFile(
  prospectId: string,
  fileId: string,
  reason?: string | null,
): Promise<CreatorWorkspaceDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/evidence/uploads/${encodeURIComponent(fileId)}/remove`,
    { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
  );
}

export function recordMetricDecision(
  prospectId: string,
  body: { metric: string; decision: 'verified' | 'more_evidence_needed'; detail: string },
): Promise<AskOutcome> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/evidence/metric-decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function correctAccountField(
  prospectId: string,
  body: { field: string; newValue: string; reason: string },
): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/account-correction`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function requestCorrection(
  prospectId: string,
  body: { subjectLabel: string; note: string },
): Promise<AskOutcome> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/correction-request`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function sendPasswordRecovery(prospectId: string): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/password-recovery`, {
    method: 'POST',
  });
}

export function refreshStripeStatus(prospectId: string): Promise<CreatorWorkspaceDetail> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/stripe-refresh`, {
    method: 'POST',
  });
}

/** §29.8's audience-wide requirement — the one route, unchanged. */
export function requirePolicyReacceptance(body: {
  slug: string;
  version: string;
  audience: 'affiliate';
  reason: string;
}): Promise<unknown> {
  return call('/api/admin/policy-reacceptance', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
    launchFailure: {
      required: boolean;
      failure: {
        status: string;
        dueAt: string | null;
        calendarVersion: string;
        replacementDesignation: string;
        recordedAt: string | null;
      } | null;
    };
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
  /* The Session C blocks (migration 0048). */
  deliverables: {
    items: DeliverableView[];
    resolved: number;
    canRecord: boolean;
    sourceLabel: string | null;
  };
  availability: {
    term: string;
    termSource: string;
    checks: number;
    latest: {
      available: boolean;
      termChecked: string;
      detail: string;
      verifiedBy: string;
      verifiedAt: string | null;
    } | null;
  };
  mediationNotes: { note: string; createdBy: string; createdAt: string | null }[];
  terminationRequests: {
    open: TerminationRequestView | null;
    history: TerminationRequestView[];
  };
  kitAssets: {
    visualsAvailable: boolean;
    waitingOn: string | null;
    files: {
      id: string;
      purpose: string;
      state: string;
      filename: string | null;
      dimensions: string | null;
      approved: boolean;
      removed: boolean;
    }[];
  };
  workAgain: {
    id: string;
    status: string;
    message: string;
    requestedAt: string | null;
    respondedAt: string | null;
    responseNote: string | null;
  }[];
}

export interface DeliverableView {
  id: string;
  title: string;
  source: string;
  state: string;
  stateLabel: string;
  createdAt: string | null;
  latestEvidence: {
    id: string;
    reference: string;
    note: string | null;
    submittedBy: string;
    submittedAt: string | null;
  } | null;
  latestDecision: {
    outcome: string;
    findings: string;
    waiverRecordedBy: string | null;
    waiverReason: string | null;
    decidedBy: string;
    decidedAt: string | null;
  } | null;
}

export interface TerminationRequestView {
  id: string;
  reason: string;
  effectiveAt: string | null;
  cause: string;
  causeLabel: string;
  moneyTreatment: string;
  treatmentLabel: string;
  receivedVia: string;
  requestedAt: string | null;
  recordedBy: string;
  decision: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
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
  /** The person's §26.7 cases. Operating one stays the Support workspace's. */
  cases: CreatorCaseView[];
}

/* ── The Session C relationship records (migration 0048) ───────────────────*/

export function recordDeliverable(
  prospectId: string,
  associationId: string,
  body: { title: string },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/deliverables`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function recordDeliverableEvidence(
  prospectId: string,
  associationId: string,
  deliverableId: string,
  body: { reference: string; note?: string | null },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/deliverables/${encodeURIComponent(deliverableId)}/evidence`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function decideDeliverable(
  prospectId: string,
  associationId: string,
  deliverableId: string,
  body: {
    outcome: string;
    findings: string;
    waiverRecordedBy?: string | null;
    waiverReason?: string | null;
  },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/deliverables/${encodeURIComponent(deliverableId)}/decision`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** The term is composed server-side from records; the body carries the answer. */
export function verifyContentAvailability(
  prospectId: string,
  associationId: string,
  body: { available: boolean; detail: string },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/availability`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function recordMediationNote(
  prospectId: string,
  associationId: string,
  body: { note: string },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/mediation-note`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function recordTerminationRequest(
  prospectId: string,
  associationId: string,
  body: {
    reason: string;
    effectiveAt: string;
    cause: string;
    moneyTreatment: string;
    receivedVia: string;
    requestedAt?: string | null;
  },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/termination-request`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function decideTerminationRequest(
  prospectId: string,
  associationId: string,
  requestId: string,
  body: { decision: 'applied' | 'declined'; note: string },
): Promise<CreatorRelationshipDetail> {
  return call(
    `/api/admin/creators/${encodeURIComponent(prospectId)}/relationships/${encodeURIComponent(associationId)}/termination-request/${encodeURIComponent(requestId)}/decision`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Gap 3 — sends the existing §27 key; the outcome rides beside the re-read. */
export function sendCreatorPayoutReminder(
  prospectId: string,
): Promise<{ detail: CreatorWorkspaceDetail; ask: { sent: boolean; reason: string | null } }> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/payout-reminder`, {
    method: 'POST',
  });
}

/** Gap 7 — opens the case through the ONE intake; no second queue exists. */
export function openCreatorSupportCase(
  prospectId: string,
  body: {
    topic: string;
    message: string;
    subject?: string | null;
    subcategory?: string | null;
    associationId?: string | null;
  },
): Promise<{
  detail: CreatorWorkspaceDetail;
  opened: { caseId: string; reference: string };
}> {
  return call(`/api/admin/creators/${encodeURIComponent(prospectId)}/support-case`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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

/* ── §29.6: the required-Creator failure and its replacement ───────────────*/

/**
 * Records that a required launch Creator did not post.
 *
 * It opens a NON-RESETTABLE three-business-day replacement window on the
 * committed holiday calendar, stored with the version that produced it. The
 * route is idempotent: a retry returns the first record unchanged rather than
 * moving the deadline, which is the whole reason it can be offered twice.
 */
export function recordCreatorFailure(
  campaignId: string,
  body: { failedAssociationId: string; replacementDesignation: string },
): Promise<unknown> {
  return call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/creator-failure`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Marks the replacement ready, returning the campaign to Creator prep. */
export function resolveCreatorReplacement(
  campaignId: string,
  body: { resolutionNote?: string },
): Promise<unknown> {
  return call(
    `/api/admin/campaigns/${encodeURIComponent(campaignId)}/creator-replacement/resolve`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
