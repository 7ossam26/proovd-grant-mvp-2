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
