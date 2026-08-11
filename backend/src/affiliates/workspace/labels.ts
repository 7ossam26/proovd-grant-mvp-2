/**
 * The backend's runtime copy of the Creator-workspace vocabulary.
 *
 * The backend cannot import `@proovd/shared` at runtime — it compiles under
 * `rootDir: src` and ships only `backend/dist` — so the registers are restated
 * here and drift-tested against the canonical ones in
 * `shared/src/admin/creator-workspace.ts` (`tests/creator-workspace.test.ts`).
 * That is the same arrangement the state enums, the §6 settings, and the §27
 * notification keys already use.
 *
 * What is NOT restated: the long copy constants and the parked messages. Those
 * are rendered by the browser, which imports shared directly, so a second copy
 * here would be a third place for one sentence to live. Only what the SERVER
 * decides with is duplicated.
 */

/* ── Directory filters ──────────────────────────────────────────────────────*/

export const CREATOR_DIRECTORY_FILTER_KEYS = [
  'all',
  'admin',
  'verification',
  'payout',
] as const;
export type CreatorDirectoryFilter = (typeof CREATOR_DIRECTORY_FILTER_KEYS)[number];

/* ── Association standing ───────────────────────────────────────────────────*/

/**
 * §23.4's nineteen states in Admin's vocabulary — one label each.
 *
 * Deliberately NOT `roster-labels.ts`. That register is §14.5's Founder-facing
 * projection and is lossy on purpose: `readiness_blocked` and `ready` are both
 * "Accepted" there, because §14.5 declines to show a Founder the difference. An
 * Admin who cannot see the difference cannot do the work.
 */
export const ADMIN_ASSOCIATION_STATUS_LABELS: Record<string, string> = {
  prospect: 'Prospect · not invited',
  invited: 'Invited',
  signup_started: 'Signup started',
  signed_up_waiting_for_founder: 'Signed up · waiting for Founder',
  preparing: 'Preparing campaign',
  formal_decision_open: 'Formal decision open',
  reviewing: 'Reviewing terms',
  proposal_pending: 'Proposal pending',
  accepted: 'Accepted',
  declined: 'Declined',
  expired_no_acceptance: 'Expired · no acceptance',
  readiness_blocked: 'Readiness blocked',
  ready: 'Ready to launch',
  active: 'Active partnership',
  paused: 'Paused',
  ended: 'Ended',
  removed: 'Removed',
  successfully_completed: 'Successfully completed',
  completion_disqualified: 'Completion disqualified',
};

export function adminAssociationStatusLabel(status: string): string {
  return ADMIN_ASSOCIATION_STATUS_LABELS[status] ?? status;
}

/**
 * §2.2: a slot runs from tracking-link activation until campaign close or
 * recorded removal. `paused` counts — a paused Creator is not a closed
 * campaign, and excluding it would let one person hold four campaigns by having
 * one go wrong. Restated from `registry.ts`, which restates shared.
 */
export const SLOT_OCCUPYING_STATUSES: readonly string[] = ['active', 'paused'];
export const ACTIVE_PARTNERSHIP_SLOT_LIMIT = 3;

/* ── Verification ───────────────────────────────────────────────────────────*/

export const VERIFICATION_STATE_LABELS: Record<string, string> = {
  unverified: 'Not verified yet',
  in_review: 'Verification under review',
  verified: 'Verified',
  rejected: 'Verification rejected',
};

export function verificationStateLabel(status: string): string {
  return VERIFICATION_STATE_LABELS[status] ?? status;
}

export const MORE_EVIDENCE_NEEDED_LABEL = 'More evidence needed';

/* ── Payout ─────────────────────────────────────────────────────────────────*/

export const PAYOUT_STATE_LABELS: Record<string, string> = {
  not_started: 'Payout setup not started',
  in_progress: 'Payout setup in progress',
  requirements_due: 'Stripe needs information',
  complete: 'Payout ready',
  restricted: 'Payout restricted',
};

export const NO_PAYOUT_ACCOUNT_LABEL = 'No payout account yet';

export function payoutStateLabel(status: string | null): string {
  if (status === null) return NO_PAYOUT_ACCOUNT_LABEL;
  return PAYOUT_STATE_LABELS[status] ?? status;
}

/* ── Account standing ───────────────────────────────────────────────────────*/

export const CREATOR_ACCOUNT_STATES = [
  'Not claimed yet',
  'Eligible',
  'Access suspended',
  'Policy acceptance required',
] as const;
export type CreatorAccountState = (typeof CREATOR_ACCOUNT_STATES)[number];

export const CREATOR_ACCESS_ACTIONS = ['suspend', 'restore'] as const;
export type CreatorAccessAction = (typeof CREATOR_ACCESS_ACTIONS)[number];

export function isCreatorAccessAction(value: string): value is CreatorAccessAction {
  return (CREATOR_ACCESS_ACTIONS as readonly string[]).includes(value);
}

/**
 * What a person's Affiliate account is, right now — derived, never stored.
 *
 * Order matters and is the priority the surface reads: a suspended account is
 * suspended whatever else is open, and an unclaimed one has no policy state to
 * be blocked on. A stored status is one a failed write can strand out of step
 * with the records that actually decide it.
 *
 * There is deliberately no banned value — see the schema header. §22.7 is a
 * Founder record; the Spec states no permanent Creator sanction.
 */
export function deriveCreatorAccountState(facts: {
  claimed: boolean;
  latestAccessAction: string | null;
  policyReacceptanceOpen: boolean;
}): CreatorAccountState {
  if (facts.latestAccessAction === 'suspend') return 'Access suspended';
  if (!facts.claimed) return 'Not claimed yet';
  if (facts.policyReacceptanceOpen) return 'Policy acceptance required';
  return 'Eligible';
}

/* ── Attention ──────────────────────────────────────────────────────────────*/

export const ATTENTION_OWNERS = ['Admin', 'Affiliate', 'Founder', 'Stripe', 'System'] as const;
export type AttentionOwner = (typeof ATTENTION_OWNERS)[number];

export interface CreatorAttentionDefinition {
  readonly key: string;
  readonly owner: AttentionOwner;
  readonly label: string;
  readonly from: string;
}

/**
 * Every reason a Creator record can need attention, and who owns it.
 *
 * Order is priority: the composer takes the first that holds, because a row
 * shows one thing to do (DNA §5.1). Every entry names the RECORD it is derived
 * from — an attention line with no record behind it is a nudge, and §30 forbids
 * those.
 */
export const CREATOR_ATTENTION_KINDS: readonly CreatorAttentionDefinition[] = [
  { key: 'account_suspended', owner: 'Admin', label: 'Account access suspended', from: 'affiliate_access_actions' },
  { key: 'policy_reacceptance', owner: 'Affiliate', label: 'Policy acceptance required', from: 'policy_reacceptance_requirements' },
  { key: 'transfer_failed', owner: 'Admin', label: 'Affiliate Transfer failed', from: 'affiliate_transfers' },
  { key: 'payout_blocked', owner: 'Stripe', label: 'Stripe needs information', from: 'affiliate_signup_profiles' },
  { key: 'post_review_due', owner: 'Admin', label: 'First post submitted', from: 'creator_post_submissions' },
  { key: 'earnings_decision_due', owner: 'Admin', label: 'Completion decision ready', from: 'creator_earnings' },
  { key: 'proposal_open', owner: 'Founder', label: 'Proposal waiting on a decision', from: 'proposal_versions' },
  { key: 'verification_due', owner: 'Admin', label: 'Verification evidence to review', from: 'affiliate_prospects' },
  { key: 'invitation_unclaimed', owner: 'Affiliate', label: 'Invitation sent, not yet claimed', from: 'affiliate_invitation_sends' },
  { key: 'invitation_unsent', owner: 'Admin', label: 'Invitation prepared, not sent', from: 'campaign_affiliate_associations' },
];

export type CreatorAttentionKind = (typeof CREATOR_ATTENTION_KINDS)[number]['key'];

export function creatorAttention(key: string): CreatorAttentionDefinition | undefined {
  return CREATOR_ATTENTION_KINDS.find((a) => a.key === key);
}

/** Derived from the register rather than listed twice. */
export const ADMIN_WORK_ATTENTION_KEYS: readonly string[] = CREATOR_ATTENTION_KINDS.filter(
  (a) => a.owner === 'Admin',
).map((a) => a.key);

/* ── Provenance ─────────────────────────────────────────────────────────────*/

export const PROVENANCE_KEYS = ['affiliate', 'admin', 'evidence', 'provider'] as const;
export type ProvenanceKey = (typeof PROVENANCE_KEYS)[number];

/* ── Subtype metric labels ──────────────────────────────────────────────────*/

export const SUBTYPE_METRIC_LABELS: Record<string, string> = {
  social_creator: 'Engagement rate',
  newsletter_blog_operator: 'Click-through / engagement',
  podcast_host: 'Listen / completion rate',
  community_owner: 'Active-user engagement',
  course_instructor: 'Ratings / learner engagement',
  student_affiliate: 'Promotion-plan evidence',
  niche_marketer: 'Traffic-plan quality',
};

export function subtypeMetricLabel(subtype: string | null): string {
  if (!subtype) return 'Audience evidence';
  return SUBTYPE_METRIC_LABELS[subtype] ?? 'Audience evidence';
}

/**
 * The §5.3 subtype's human label.
 *
 * Restated from the shared subtype register — the backend already restates the
 * ids in `registry.ts`, and this adds the words the Admin surface renders so a
 * raw `newsletter_blog_operator` never reaches a screen (§3.1).
 */
export const SUBTYPE_LABELS: Record<string, string> = {
  social_creator: 'Social Creator',
  newsletter_blog_operator: 'Newsletter / blog operator',
  podcast_host: 'Podcast host',
  community_owner: 'Community owner',
  course_instructor: 'Course instructor',
  student_affiliate: 'Student affiliate',
  niche_marketer: 'Niche distribution partner',
};

export function subtypeLabel(subtype: string | null): string | null {
  if (!subtype) return null;
  return SUBTYPE_LABELS[subtype] ?? subtype;
}

/* ── History ────────────────────────────────────────────────────────────────*/

export const CREATOR_HISTORY_CATEGORY_KEYS = [
  'account',
  'campaign',
  'evidence',
  'money',
  'policy',
] as const;
export type CreatorHistoryCategory = (typeof CREATOR_HISTORY_CATEGORY_KEYS)[number];

export function isCreatorHistoryCategory(value: string): value is CreatorHistoryCategory {
  return (CREATOR_HISTORY_CATEGORY_KEYS as readonly string[]).includes(value);
}

/* ── Campaign type ──────────────────────────────────────────────────────────*/

/** §3.1's two mandated substitutions. `pre_build`/`pre_launch` are internal. */
export const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  pre_build: 'Idea Campaign',
  pre_launch: 'Product Campaign',
};

export function campaignTypeLabel(type: string | null): string | null {
  if (!type) return null;
  return CAMPAIGN_TYPE_LABELS[type] ?? type;
}

/** §23.4's roster membership, in the reference's words. */
export const ROSTER_MEMBERSHIP_LABELS: Record<string, string> = {
  initial_roster: 'Initial launch roster',
  mid_campaign: 'Mid-campaign addition',
};

export function rosterMembershipLabel(membership: string): string {
  return ROSTER_MEMBERSHIP_LABELS[membership] ?? membership;
}

/* ── Small helpers the composers share ──────────────────────────────────────*/

/**
 * A campaign's human name.
 *
 * `campaigns` deliberately has no `name` column — the public title lives on
 * `campaign_build` and only exists once the Founder has written one, so before
 * the build the honest name is the product the invitation was about.
 * `founders/workspace.ts` resolves it the same way, and the two must agree or
 * one campaign has two names on two Admin surfaces.
 */
export function campaignNameOf(title: string | null, productName: string | null): string {
  return title ?? productName ?? 'Untitled campaign';
}

/**
 * Two letters for the monogram square.
 *
 * From the name where there is one, from the handle otherwise, and `··` when
 * there is neither — never a blank square, which reads as a broken image.
 */
export function initialsOf(name: string | null, handle: string | null): string {
  const source = (name ?? handle ?? '').trim();
  if (!source) return '··';
  const words = source.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Where they publish, from the §8 channel reference.
 *
 * The host, tidied of `www.` — never a guess at the platform's brand name. A
 * reference that is not a URL is shown as it was recorded, because §8 permits a
 * handle, a newsletter name, or a community reference there.
 */
export function platformOf(channelReference: string | null): string | null {
  if (!channelReference) return null;
  const trimmed = channelReference.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '');
    return host || trimmed;
  } catch {
    return trimmed;
  }
}

/** A channel reference only when it is genuinely a link somebody can open. */
export function channelUrlOf(channelReference: string | null): string | null {
  if (!channelReference) return null;
  const trimmed = channelReference.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
