/**
 * The Creator (Affiliate) Admin workspace vocabulary — Spec §26.1, §8, §5.3,
 * §11, §14.5, §23.4, §3.1.
 *
 * The workspace is one PERSON seen four ways: the directory (everyone), the
 * record (who they are and what they are running), profile & evidence (what we
 * know and who supplied it), and history (everything that happened). This file
 * owns the words all four use, so no surface invents a second name for a state
 * the product already has one for.
 *
 * ── Two nouns, and the split is the reference's own ──────────────────────────
 * The Admin *section* is called Creators — that is the shell's tab, the name
 * every other Admin surface in this product uses, and the §3.1 substitution for
 * `affiliate`. Inside the workspace the record vocabulary is Affiliate, because
 * the supplied reference pins it there and its own first requirement resolves
 * the question the same way: Founder-facing distribution partners are called
 * Creator; internal records may use Affiliate. §3.1's risk is an internal name
 * reaching a *customer*, and nothing in this file is ever rendered to one — the
 * Founder-visible projection is `listFounderVisibleRoster`, which selects seven
 * columns and none of this vocabulary.
 *
 * ── The registers are total, and that is the point ───────────────────────────
 * `ADMIN_ASSOCIATION_STATUS_LABELS` is typed as a total map over §23.4's
 * nineteen states, so a twentieth without a human label fails the build rather
 * than rendering `readiness_blocked` to somebody on a support call. The same
 * shape is used for verification, payout, and account standing.
 *
 * ── What this file deliberately does NOT decide ──────────────────────────────
 * No eligibility, no deadline, no money, no ranking. §8 makes the internal
 * quality tier assessment data explicitly — never a commission floor — so
 * nothing here orders it, and there is no tier register to import. Where the
 * reference implies a rule the Spec does not state, the rule is absent and the
 * surface says so honestly instead (§1 rule 6, §1.4).
 */

import { ASSOCIATION_STATUSES, type AssociationStatus } from '../states/association.js';
import type { AffiliateRefundTreatment } from '../refunds/index.js';

/* ──────────────────────────────────────────────────────── The directory */

/**
 * The four filter pills, in the reference's order.
 *
 * Each is a question an Admin actually asks when they open the section, and
 * every one of them is answered by the SERVER: the row carries the booleans
 * already resolved, so a pill is a filter over facts rather than a second
 * derivation the browser performs (§26.2 — a value the browser computed has no
 * `prior_value` to override against).
 */
export const CREATOR_DIRECTORY_FILTERS = [
  { key: 'all', label: 'All Affiliates' },
  { key: 'admin', label: 'Admin work' },
  { key: 'verification', label: 'Verification' },
  { key: 'payout', label: 'Payout issues' },
] as const;

export type CreatorDirectoryFilter = (typeof CREATOR_DIRECTORY_FILTERS)[number]['key'];

export const CREATOR_DIRECTORY_FILTER_KEYS = CREATOR_DIRECTORY_FILTERS.map(
  (f) => f.key,
) as readonly CreatorDirectoryFilter[];

export function isCreatorDirectoryFilter(value: string): value is CreatorDirectoryFilter {
  return (CREATOR_DIRECTORY_FILTER_KEYS as readonly string[]).includes(value);
}

/* ────────────────────────────────────────────────── Association standing */

/**
 * Human-readable label for each of §23.4's nineteen association states.
 *
 * Deliberately NOT `FOUNDER_ROSTER_STATUS_LABELS`. That register is §14.5's
 * Founder-facing projection and is lossy on purpose — `readiness_blocked` and
 * `ready` are both "Accepted" there, because §14.5 declines to show a Founder
 * the difference. An Admin who cannot see the difference cannot do the work, so
 * this map is one-to-one and the two must never be swapped for each other.
 *
 * Total by construction — see the file header.
 */
export const ADMIN_ASSOCIATION_STATUS_LABELS = {
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
} as const satisfies Record<AssociationStatus, string>;

export function adminAssociationStatusLabel(status: string): string {
  return (
    (ADMIN_ASSOCIATION_STATUS_LABELS as Record<string, string | undefined>)[status] ?? status
  );
}

export function isAssociationStatus(value: string): value is AssociationStatus {
  return (ASSOCIATION_STATUSES as readonly string[]).includes(value);
}

/**
 * §2.2's cap, restated where a surface renders "n of 3".
 *
 * The number itself lives in `affiliates/slots.ts`, which also owns which
 * states occupy a slot. This is a label helper, not a second answer.
 */
export const ACTIVE_PARTNERSHIP_LABEL = 'Active partnerships' as const;

/* ──────────────────────────────────────────────────────────── Verification */

/**
 * §8's four recorded verification states.
 *
 * The reference shows three — verified, more evidence needed, under review —
 * because its prototype had three. The product records four, and the fourth
 * (`rejected`) is a decision somebody made that the three-state vocabulary
 * cannot express. Collapsing it into "more evidence needed" would tell an Admin
 * to go and collect evidence for a prospect who was turned down.
 *
 * "More evidence needed" survives as a DERIVED sub-line: `missingEvidence`
 * against the §5.3 register for this subtype, which is a count of real gaps
 * rather than a state.
 */
export const VERIFICATION_STATE_LABELS = {
  unverified: 'Not verified yet',
  in_review: 'Verification under review',
  verified: 'Verified',
  rejected: 'Verification rejected',
} as const;

export type VerificationStateKey = keyof typeof VERIFICATION_STATE_LABELS;

export const VERIFICATION_STATE_KEYS = Object.keys(
  VERIFICATION_STATE_LABELS,
) as readonly VerificationStateKey[];

export function verificationStateLabel(status: string): string {
  return (
    (VERIFICATION_STATE_LABELS as Record<string, string | undefined>)[status] ?? status
  );
}

/** The reference's own phrase for an outstanding §5.3 evidence gap. */
export const MORE_EVIDENCE_NEEDED_LABEL = 'More evidence needed' as const;

/** §8: the tier is assessment data. Stated where somebody might sort by it. */
export const QUALITY_TIER_HELPER =
  'Internal assessment data only. §8 makes this explicitly not a commission ' +
  'floor, so nothing in the product reads it to decide a percentage.';

/**
 * §5.3's own qualifier, stated on the evidence block.
 *
 * `recordVerification` refuses `verified` while anything is missing and lets an
 * incomplete record save, for the reason `recruitment.ts` records: refusing the
 * save pushes an Admin to type a placeholder into an evidence field, which is a
 * worse record than an honestly incomplete one.
 */
export const EVIDENCE_IS_REPORTED_NOT_ENFORCED =
  'Missing evidence is reported, never enforced — except on Verified, which ' +
  'is refused while anything on the §5.3 list for this subtype is outstanding.';

/** §5.3, §8: a human decides. Stated where an algorithm would be assumed. */
export const VERIFICATION_IS_HUMAN =
  'Verification is a recorded human decision. Nothing here scores, ranks, or ' +
  'verifies automatically.';

/* ─────────────────────────────────────────────────────────────── Payout */

/**
 * §13's connected-account states, as the payout column records them.
 *
 * Rendered from the STORED status rather than from a live provider read: §13
 * makes Stripe the owner of this fact and Proovd the holder of its status, and
 * a surface that implied it had just asked would be claiming a capability the
 * read does not have (§1.4).
 */
export const PAYOUT_STATE_LABELS = {
  not_started: 'Payout setup not started',
  in_progress: 'Payout setup in progress',
  requirements_due: 'Stripe needs information',
  complete: 'Payout ready',
  restricted: 'Payout restricted',
} as const;

export type PayoutStateKey = keyof typeof PAYOUT_STATE_LABELS;

export const PAYOUT_STATE_KEYS = Object.keys(PAYOUT_STATE_LABELS) as readonly PayoutStateKey[];

export function payoutStateLabel(status: string | null): string {
  if (status === null) return NO_PAYOUT_ACCOUNT_LABEL;
  return (PAYOUT_STATE_LABELS as Record<string, string | undefined>)[status] ?? status;
}

/** Nobody has claimed the account, so there is no payout state — not a zero. */
export const NO_PAYOUT_ACCOUNT_LABEL = 'No payout account yet' as const;

/** §5.3, §13, §25.7: Proovd holds an id and a status, never the data. */
export const PROVIDER_IS_READ_ONLY = 'Stripe supplied · read only' as const;

export const PROVIDER_READ_ONLY_HELPER =
  'Proovd stores the connected-account id and the status Stripe reports. Bank ' +
  'details, tax identifiers, and identity documents are held by Stripe and ' +
  'have no column here.';

/* ───────────────────────────────────────────────────────── Account standing */

/**
 * What a person's Proovd Affiliate account is, right now.
 *
 * Four values and only one of them is stored. "Not claimed yet" is the absence
 * of `affiliate_signup_profiles.claimed_user_id`; "Access suspended" is the
 * latest `affiliate_access_actions` row; "Policy acceptance required" is an
 * open §29.8 requirement; "Eligible" is what is left. Deriving rather than
 * storing is deliberate — a stored status is one a failed write can strand out
 * of step with the records that actually decide it.
 *
 * There is deliberately no "Permanently banned": §22.7's one-strike ban is a
 * FOUNDER record, and §29 records Creator enforcement per association. A
 * fourth value here would be a permanent Creator sanction the Spec does not
 * state (§1 rule 6).
 */
export const CREATOR_ACCOUNT_STATES = [
  'Not claimed yet',
  'Eligible',
  'Access suspended',
  'Policy acceptance required',
] as const;
export type CreatorAccountState = (typeof CREATOR_ACCOUNT_STATES)[number];

/**
 * The two person-level access actions, added 2026-08-11 by product direction.
 *
 * A RECORDED DEVIATION, and the reason is worth keeping: §29 records Creator
 * enforcement per *association*, and `enforcement/standing.ts` has said since
 * Phase 20b that an account-level Creator ban would be §1 rule 6. The supplied
 * reference asks for account-level suspend/restore, the same way the Founders
 * reference asked for `founder_access_actions`, and the same answer was given.
 *
 * What did NOT change: this is a reversible standing review, never a ban. There
 * is no `ban` member, no permanent value, and no lift-a-permanent-sanction
 * path, because the Spec states none for a Creator.
 */
export const CREATOR_ACCESS_ACTIONS = ['suspend', 'restore'] as const;
export type CreatorAccessAction = (typeof CREATOR_ACCESS_ACTIONS)[number];

export const CREATOR_SUSPENSION_IS_NOT_A_BAN =
  'Suspension is a reversible standing review. §29 records Creator enforcement ' +
  'per campaign relationship, and there is no permanent account-level Creator ' +
  'sanction in the Spec.';

/* ───────────────────────────────────────────────────────── Ownership pills */

/**
 * Who owns the next step, in the reference's five values.
 *
 * The pill exists because §27.1's second question — who owns this — is the one
 * a queue answers worst. Every attention line below names an owner, and the
 * owner decides which control the surface offers: an Admin-owned item gets the
 * primary action, and a Stripe- or Affiliate-owned one does not, because
 * offering Proovd a button for somebody else's work is §1.4's failure.
 */
export const ATTENTION_OWNERS = ['Admin', 'Affiliate', 'Founder', 'Stripe', 'System'] as const;
export type AttentionOwner = (typeof ATTENTION_OWNERS)[number];

/**
 * Every reason a Creator record can need attention, and who owns it.
 *
 * A register rather than a chain of `if`s in the composer, so "what can appear
 * here" is a list somebody can read, and so the directory's `Admin work` pill
 * is a filter over a known set rather than a second opinion. Order is priority:
 * the composer takes the first that holds, because a row shows one thing to do
 * (DNA §5.1).
 *
 * Every entry names the RECORD it is derived from. An attention line with no
 * record behind it is a nudge, and §30 forbids those.
 */
export const CREATOR_ATTENTION_KINDS = [
  {
    key: 'account_suspended',
    owner: 'Admin',
    label: 'Account access suspended',
    from: 'affiliate_access_actions',
  },
  {
    key: 'policy_reacceptance',
    owner: 'Affiliate',
    label: 'Policy acceptance required',
    from: 'policy_reacceptance_requirements',
  },
  {
    key: 'transfer_failed',
    owner: 'Admin',
    label: 'Affiliate Transfer failed',
    from: 'affiliate_transfers',
  },
  {
    key: 'payout_blocked',
    owner: 'Stripe',
    label: 'Stripe needs information',
    from: 'affiliate_signup_profiles',
  },
  {
    key: 'post_review_due',
    owner: 'Admin',
    label: 'First post submitted',
    from: 'creator_post_submissions',
  },
  {
    key: 'earnings_decision_due',
    owner: 'Admin',
    label: 'Completion decision ready',
    from: 'creator_earnings',
  },
  {
    key: 'proposal_open',
    owner: 'Founder',
    label: 'Proposal waiting on a decision',
    from: 'proposal_versions',
  },
  {
    key: 'verification_due',
    owner: 'Admin',
    label: 'Verification evidence to review',
    from: 'affiliate_prospects',
  },
  {
    key: 'invitation_unclaimed',
    owner: 'Affiliate',
    label: 'Invitation sent, not yet claimed',
    from: 'affiliate_invitation_sends',
  },
  {
    key: 'invitation_unsent',
    owner: 'Admin',
    label: 'Invitation prepared, not sent',
    from: 'campaign_affiliate_associations',
  },
] as const;

export type CreatorAttentionKind = (typeof CREATOR_ATTENTION_KINDS)[number]['key'];

export const CREATOR_ATTENTION_KEYS = CREATOR_ATTENTION_KINDS.map(
  (a) => a.key,
) as readonly CreatorAttentionKind[];

export function creatorAttention(key: string) {
  return CREATOR_ATTENTION_KINDS.find((a) => a.key === key);
}

/**
 * Which attention kinds the `Admin work` pill selects.
 *
 * Derived from the register rather than listed twice, so a kind that changes
 * owner changes pill membership with it.
 */
export const ADMIN_WORK_ATTENTION_KEYS = CREATOR_ATTENTION_KINDS.filter(
  (a) => a.owner === 'Admin',
).map((a) => a.key) as readonly CreatorAttentionKind[];

/**
 * Deliberately not re-exported under the bare name.
 *
 * `founder-workspace.ts` exports `NO_ATTENTION_LABEL` with the same words, and
 * a barrel that exported both would resolve to whichever file was listed last —
 * a rename in one register silently changing the other surface. Two registers,
 * two names.
 */
export const CREATOR_NO_ATTENTION_LABEL = 'No action needed right now' as const;

/* ───────────────────────────────────────────────────────────── Provenance */

/**
 * Who supplied a value, rendered as a badge above every block that shows one.
 *
 * This is the reference's central idea and the reason its profile screen reads
 * the way it does: a field is not just a value, it is a value somebody is
 * responsible for. §12's rule that the Founder's own words may not be written
 * by Proovd is the same idea in another phase, and §13's "Proovd stores the
 * status, not the document" is the third.
 *
 * The badge is not decoration — it decides what may be edited. `provider` has
 * no edit control anywhere, and `affiliate` is corrected through a route that
 * records a reason, never overwritten.
 */
export const PROVENANCE_BADGES = [
  {
    key: 'affiliate',
    label: 'Affiliate supplied',
    helper: 'Confirmed by the Affiliate when they claimed the account.',
  },
  {
    key: 'admin',
    label: 'Admin researched / authored',
    helper: 'Recorded by Proovd from public research. The Affiliate never typed it.',
  },
  {
    key: 'evidence',
    label: 'Evidence + Admin decision',
    helper: 'Files and metrics on the record, and the decision a named Admin made about them.',
  },
  {
    key: 'provider',
    label: PROVIDER_IS_READ_ONLY,
    helper: PROVIDER_READ_ONLY_HELPER,
  },
] as const;

export type ProvenanceKey = (typeof PROVENANCE_BADGES)[number]['key'];

export function provenanceBadge(key: ProvenanceKey) {
  return PROVENANCE_BADGES.find((p) => p.key === key)!;
}

/* ──────────────────────────────────────────── Subtype-specific metric label */

/**
 * What "engagement" means for each §5.3 subtype.
 *
 * The reference reads it off the subtype string; here it is a total map over
 * the seven subtype ids, so a new subtype without a metric label fails the
 * build rather than silently falling through to "Engagement rate" — which
 * would be the wrong question for a podcast and a course.
 */
export const SUBTYPE_METRIC_LABELS = {
  social_creator: 'Engagement rate',
  newsletter_blog_operator: 'Click-through / engagement',
  podcast_host: 'Listen / completion rate',
  community_owner: 'Active-user engagement',
  course_instructor: 'Ratings / learner engagement',
  student_affiliate: 'Promotion-plan evidence',
  niche_marketer: 'Traffic-plan quality',
} as const;

export type SubtypeMetricKey = keyof typeof SUBTYPE_METRIC_LABELS;

export function subtypeMetricLabel(subtype: string | null): string {
  if (!subtype) return 'Audience evidence';
  return (SUBTYPE_METRIC_LABELS as Record<string, string | undefined>)[subtype] ?? 'Audience evidence';
}

/* ──────────────────────────────────────────────────────────────── History */

/**
 * The six history filters, in the reference's order.
 *
 * These are *categories of thing that happened to this person*, not the §26.8
 * timeline's source tables — an Affiliate-scoped feed spans records the campaign
 * timeline never sees (invitation sends, Stripe account events, policy
 * reacceptance), so the chips are their own vocabulary and the composer maps
 * onto them.
 */
export const CREATOR_HISTORY_CATEGORIES = [
  { key: 'all', label: 'All events' },
  { key: 'account', label: 'Account' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'money', label: 'Money' },
  { key: 'policy', label: 'Policy' },
] as const;

export type CreatorHistoryFilterKey = (typeof CREATOR_HISTORY_CATEGORIES)[number]['key'];
/** Every category except the `all` pseudo-filter — what an entry may carry. */
export type CreatorHistoryCategory = Exclude<CreatorHistoryFilterKey, 'all'>;

export const CREATOR_HISTORY_CATEGORY_KEYS = CREATOR_HISTORY_CATEGORIES.filter(
  (c) => c.key !== 'all',
).map((c) => c.key) as readonly CreatorHistoryCategory[];

export const CREATOR_HISTORY_AUDIT_NOTE =
  'Plain-language history, composed across the records that already hold each ' +
  'fact — there is no separate history table. The system keeps the complete ' +
  'audit record — actor, timestamps, before/after values, reasons, evidence, ' +
  'provider IDs, and reauthentication context — behind each sensitive event.';

/* ────────────────────────────────────────────────────── Retention and asks */

/** §25.8, in the reference's own words. */
export const CREATOR_RETENTION_NOTE =
  'Account, tax and status records · account life plus seven years' as const;

export const CREATOR_DELETION_RETENTION_NOTE =
  'Some campaign, payment, tax, support, and audit records may still need to ' +
  'be retained even if the Affiliate account is closed. There is no “delete ' +
  'everything” action.';

/** §27.2's first rule, stated where somebody might look for an off switch. */
export const CREATOR_REQUIRED_EMAILS_NOTE =
  'Durable · transactional messages cannot be opted out' as const;

/** §27.7, §30: the digest exists only because a person chose it. */
export const CREATOR_DIGEST_IS_NOT_ADMIN_WRITABLE =
  'Only the Affiliate can set this. Proovd never chooses a summary frequency ' +
  'on someone’s behalf.';

/* ────────────────────────────────────────────────────────── The Add flow */

/**
 * The reference's four-step Add Affiliate wizard, as a register.
 *
 * The wizard posts to the existing `POST /api/admin/affiliates`, which already
 * owns §8's required set — this names the steps and their questions so the
 * surface and its test agree on what the flow is, and so a step cannot quietly
 * gain a field the create route does not accept.
 */
export const ADD_AFFILIATE_STEPS = [
  { step: 1, title: 'Who is the campaign prospect?' },
  { step: 2, title: 'What evidence supports the channel?' },
  { step: 3, title: 'How does Admin assess quality and risk?' },
  { step: 4, title: 'Which campaign relationship is being created?' },
] as const;

/**
 * The sentence step 4 ends on.
 *
 * §5.3 and §7 both matter here: recording a prospect creates NO account and
 * sends NO message. The reference states it because an Admin filling four steps
 * of forms reasonably expects something to have been sent at the end.
 */
export const PROSPECT_CREATES_NO_ACCOUNT =
  'Saving the prospect creates no account and sends nothing. The campaign ' +
  'invitation is a separate act.';

/**
 * §5.3, §8, §7: a campaign and a Founder are chosen, never typed.
 *
 * The reference's audit refuses a free-text campaign or Founder field by name,
 * and the reason is the one §7's preview gate exists for — a typed campaign
 * name is a name that matches no campaign, and the invitation composed from it
 * would reference a product that does not exist.
 */
export const CAMPAIGN_IS_CHOSEN_NOT_TYPED =
  'Choose the campaign this invitation belongs to. The Founder follows from ' +
  'it — neither is free text.';

/* ─────────────────────────────────────── The record: tabs and sections */

/**
 * The eight-tab, twenty-five-section record — the supplied reference's own
 * `Vj`/`Gj` registers, verbatim (2026-08-17 rebuild, Session A).
 *
 * The `FOUNDER_RECORD_SECTIONS` shape: one route, view state in the URL
 * (`?tab=` for the eight, `?section=` for the tab's sections, `?rel=` for the
 * selected relationship), and the register is what the rail, the suite, and
 * the reconciliation document all read — a section added to the surface and
 * not here has no address, and one here with no surface fails the suite.
 *
 * `relationshipScoped` marks the three tabs the Selected-relationship
 * switcher scopes (the reference renders the switcher on exactly these).
 * Support & Enforcement reads the selection for its Relationship Requests
 * section but does not carry the switcher — the reference's own arrangement.
 */
export const AFFILIATE_RECORD_TABS = [
  { key: 'overview', label: 'Overview', relationshipScoped: false, sections: [] },
  {
    key: 'profile',
    label: 'Profile & Verification',
    relationshipScoped: false,
    sections: [
      { key: 'profile', label: 'Profile' },
      { key: 'audience', label: 'Audience & Metrics' },
      { key: 'verification', label: 'Verification' },
      { key: 'context', label: 'Internal Context' },
    ],
  },
  {
    key: 'account',
    label: 'Account & Payout Setup',
    relationshipScoped: false,
    sections: [
      { key: 'eligibility', label: 'Account & Eligibility' },
      { key: 'agreements', label: 'Agreements' },
      { key: 'stripe', label: 'Stripe' },
    ],
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    relationshipScoped: true,
    sections: [
      { key: 'relationships', label: 'Relationships' },
      { key: 'negotiations', label: 'Opportunities & Negotiations' },
      { key: 'readiness', label: 'Readiness & Active' },
      { key: 'completion', label: 'Completion & Work Again' },
    ],
  },
  {
    key: 'content',
    label: 'Content & Compliance',
    relationshipScoped: true,
    sections: [
      { key: 'posts', label: 'Posts' },
      { key: 'deliverables', label: 'Deliverables' },
      { key: 'disclosures', label: 'Agreements & Disclosures' },
      { key: 'risk', label: 'Risk & Compliance' },
    ],
  },
  {
    key: 'performance',
    label: 'Performance & Earnings',
    relationshipScoped: true,
    sections: [
      { key: 'performance', label: 'Performance' },
      { key: 'earnings', label: 'Earnings' },
      { key: 'transfers', label: 'Transfers & Payouts' },
      { key: 'adjustments', label: 'Adjustments' },
    ],
  },
  {
    key: 'support',
    label: 'Support & Enforcement',
    relationshipScoped: false,
    sections: [
      { key: 'support', label: 'Support' },
      { key: 'requests', label: 'Relationship Requests' },
      { key: 'enforcement', label: 'Enforcement' },
      { key: 'appeals', label: 'Appeals' },
    ],
  },
  {
    key: 'history',
    label: 'History',
    relationshipScoped: false,
    sections: [
      { key: 'timeline', label: 'Timeline' },
      { key: 'communications', label: 'Communications' },
    ],
  },
] as const;

export type AffiliateRecordTabKey = (typeof AFFILIATE_RECORD_TABS)[number]['key'];

export const AFFILIATE_RECORD_TAB_KEYS = AFFILIATE_RECORD_TABS.map(
  (t) => t.key,
) as readonly AffiliateRecordTabKey[];

export function affiliateRecordTab(key: string) {
  return AFFILIATE_RECORD_TABS.find((t) => t.key === key);
}

/** The switcher's own two lines, pinned — the reference's organising rule. */
export const SELECTED_RELATIONSHIP_LABEL = 'Selected relationship' as const;
export const ACCOUNT_AND_CAMPAIGN_STATE_SEPARATE =
  'Account data stays separate from campaign-specific state' as const;

/* ──────────────────────────────────── Evidence categories and metrics */

/**
 * The reference's four research-evidence categories (its `Xj` register).
 *
 * These group the FILES on the §5.3 research record — orthogonal to the
 * per-subtype evidence INPUTS in `affiliates/subtypes.ts`, which stay the
 * text record `missingEvidence` reports against. The keys are the 0048
 * `affiliate_evidence_files.category` CHECK, one for one.
 */
export const AFFILIATE_EVIDENCE_CATEGORIES = [
  { key: 'channel_permission', label: 'Channel ownership / permission' },
  { key: 'sponsored_history', label: 'Sponsored-content history' },
  { key: 'promotion_plan', label: 'Promotion / traffic plan' },
  { key: 'similar_campaign_performance', label: 'Similar-campaign performance' },
] as const;

export type AffiliateEvidenceCategory =
  (typeof AFFILIATE_EVIDENCE_CATEGORIES)[number]['key'];

/**
 * What an evidence picture upload accepts, stated as the server enforces it.
 *
 * ── A §1.8 resolution, recorded ─────────────────────────────────────────────
 * The reference's copy reads "PNG, JPG, WEBP or HEIC". HEIC is refused:
 * browsers cannot render it, and a stored file nobody can review is not
 * evidence. The sentence names what `ALLOWED_IMAGE_TYPES` actually accepts —
 * and SVG stays excluded for 09a's reason (browsers execute it).
 */
export const EVIDENCE_PICTURES_ACCEPTED =
  'PNG, JPG, WEBP or GIF · multiple pictures allowed' as const;

/** The reference's own rule for category-scoped uploads, kept verbatim. */
export const EVIDENCE_STAYS_WITH_ITS_ITEM =
  'Pictures stay associated with the specific research item.' as const;

/**
 * The five per-metric verification decisions (the reference's evidence
 * dialog), and the 0048 `affiliate_evidence_verifications.metric` CHECK.
 *
 * The whole-record `verification_status` stays the §8 decision the roster and
 * §16 readiness read; these are the evidence trail beneath it, never a second
 * answer to the same question.
 */
export const AFFILIATE_EVIDENCE_METRICS = [
  { key: 'audience_size', label: 'Audience size' },
  { key: 'engagement_rate', label: 'Engagement rate' },
  { key: 'audience_demographics', label: 'Audience demographics' },
  { key: 'channel_ownership', label: 'Channel ownership' },
  { key: 'newsletter_permission_basis', label: 'Newsletter permission basis' },
] as const;

export type AffiliateEvidenceMetric = (typeof AFFILIATE_EVIDENCE_METRICS)[number]['key'];

/* ─────────────────────────────────────── The invitation lifecycle steps */

/**
 * The nine steps the reference's `Review invitation lifecycle` modal renders,
 * in its order — and the one that is deliberately not a recorded fact.
 *
 * ── The `Opened` refusal (§1.8), recorded where the step lives ──────────────
 * §27 ships no tracking pixel. Phase 23b refused an email-open metric
 * outright — a silent read receipt inside a transactional message — and
 * recorded the refusal in §31.9's secondary set. So `opened` carries
 * `absentBecause` and the surface renders the reason where the value would
 * be, the way §31.9's entry states which half is missing rather than
 * reporting the metric as available. The reference itself falls back to
 * "Not supported / not recorded"; this register decides which of those two
 * it is, permanently.
 */
export const INVITATION_LIFECYCLE_STEPS = [
  { key: 'created', label: 'Created', absentBecause: null },
  { key: 'sent', label: 'Sent', absentBecause: null },
  { key: 'delivered', label: 'Delivered', absentBecause: null },
  {
    key: 'opened',
    label: 'Opened',
    absentBecause:
      'Not recorded, deliberately. §27 ships no tracking pixel — an open ' +
      'receipt inside a transactional message is a silent read receipt — so ' +
      'there is no record this step could render.',
  },
  { key: 'signup_started', label: 'Signup started', absentBecause: null },
  { key: 'claimed', label: 'Claimed', absentBecause: null },
  { key: 'expiry', label: 'Expiry', absentBecause: null },
  { key: 'delivery_failure', label: 'Delivery failure', absentBecause: null },
  { key: 'token', label: 'Token', absentBecause: null },
] as const;

export type InvitationLifecycleStep = (typeof INVITATION_LIFECYCLE_STEPS)[number]['key'];

/* ───────────────────────────────────── Tier suggestions, proposal access */

/**
 * The reference's Tier A/B/C, offered as SUGGESTIONS over the free-text
 * column — never an enum (§1.8, resolved in the Spec's favour).
 *
 * §8 makes the tier assessment data, explicitly not a commission floor;
 * `affiliate_quality_tier_not_numeric` refuses a bare number, and a closed
 * list would be the ordering that constraint exists to keep out of the
 * schema. A combobox may offer these three; typing anything else is legal.
 */
export const QUALITY_TIER_SUGGESTIONS = ['Tier A', 'Tier B', 'Tier C'] as const;

/**
 * Proposal access, DERIVED — never stored (§1.8 item most likely to be
 * missed, resolved before any code).
 *
 * The reference shows Standard/Restricted with a control to set it. A stored
 * eligibility flag is §1 rule 6 — and it would be the one field a later phase
 * could read to refuse a proposal automatically. §29 already has
 * `restrict_bidding` and `demote` among its seven actions, each carrying the
 * five customer-facing statement fields and the five-business-day appeal; the
 * badge reads the latest such enforcement record, and "changing proposal
 * access" IS recording one. Migration 0048's header states the column's
 * absence.
 */
export const PROPOSAL_ACCESS_LABELS = {
  standard: 'Standard proposal access',
  restricted: 'Proposal bidding restricted',
} as const;

export type ProposalAccessKey = keyof typeof PROPOSAL_ACCESS_LABELS;

export const PROPOSAL_ACCESS_IS_DERIVED =
  'Derived from §29 enforcement records (restrict bidding / demote), never ' +
  'stored. Changing it records an enforcement action with its full customer ' +
  'statement and appeal route.';

/** §3.1 note: the reference's "Red flags" label renders `sanctions_notes`. */
export const RED_FLAGS_LABEL = 'Red flags' as const;

/* ───────────────────────────── Account corrections and asks (Session B) */

/**
 * The Affiliate-supplied fields an Admin may correct, and the register the
 * correction dialog offers — never a free-text field name, because a route
 * accepting any string would happily record a correction of something that
 * does not exist (16a's overridable-field reasoning, applied to the person's
 * own confirmed record).
 *
 * The reference's dialog offers one combined "Location"; the record stores
 * country and state/region separately, so the register offers the two columns
 * that exist rather than one value two columns would have to be guessed from.
 */
export const AFFILIATE_ACCOUNT_CORRECTION_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'username', label: 'Username' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone number · unverified' },
  { key: 'country', label: 'Country' },
  { key: 'state_region', label: 'State / region' },
] as const;

export type AffiliateAccountCorrectionField =
  (typeof AFFILIATE_ACCOUNT_CORRECTION_FIELDS)[number]['key'];

/** The correction dialog's own consequence line, kept from the reference. */
export const CORRECTION_APPENDS_NEW_VALUE =
  'This correction appends a new current value. The prior value, Admin actor, ' +
  'reason and time remain in history.';

/** The ask dialog's consequence: asking changes nothing (§11, §1.4). */
export const CORRECTION_REQUEST_LEAVES_VALUE =
  'The current value remains until the Affiliate supplies a correction.';

/** The password-recovery confirm's consequence — §5.5, §28.1, verbatim shape. */
export const PASSWORD_RECOVERY_CONSEQUENCE =
  'The link is transactional, rate-limited and non-enumerating. No credential ' +
  'value appears in history.';

/**
 * §29.8 is audience-wide, and the control on one person's record says so.
 *
 * The reference draws "Require current policy reacceptance" on one Affiliate's
 * Agreements section, which reads as a per-person requirement. §29.8's
 * requirement follows a MATERIAL POLICY UPDATE, which is inherently
 * audience-wide — requiring one person to reaccept a text everyone else
 * already holds would be an enforcement act wearing a policy word. The control
 * therefore records the audience-wide requirement through the one §29.8
 * route, and this sentence rides the dialog so nobody reads it as narrower.
 */
export const REACCEPTANCE_IS_AUDIENCE_WIDE =
  'This records a §29.8 requirement for every Affiliate, not only this one — ' +
  'a material policy update applies to the audience, and each person clears ' +
  'it by accepting the published version.';

/* ──────────────────────────── The refused controls (§1.8, Session C) */

/**
 * Controls the reference draws that the Spec forbids — each with the sentence
 * the surface renders WHERE the control would have been, so re-adding one
 * means deleting the sentence that says why it must not exist. The Founders
 * rebuild's `OPERATIONS_ABSENCES` precedent, applied to the Affiliate record.
 *
 * These are not gaps. A gap is a capability the product will gain; every entry
 * here is a control whose existence would break a rule the product already
 * enforces somewhere else, and the sentence names both the rule and the place
 * the real decision lives. A suite test walks the rendered tabs and asserts
 * every sentence appears.
 */
export const AFFILIATE_OPERATIONS_ABSENCES = [
  {
    key: 'createTransfer',
    control: 'Create Affiliate Transfer',
    sentence:
      'The one Transfer per relationship is created from the close-operations ' +
      'queue — decide, finalize, approve, then transfer, under the §11 tax ' +
      'gate and the Day-3 anchor (§22.1). A create control here would be a ' +
      'second path into a Transfer whose stable idempotency key exists to ' +
      'guarantee there is exactly one.',
  },
  {
    key: 'adjustEarnings',
    control: 'Review or adjust earnings',
    sentence:
      'Finalized amounts are immutable by trigger, and every adjustment is a ' +
      '§24.8 cause-classified case through the recorded preview-then-execute ' +
      'path — never a number typed into a box. This surface shows the ' +
      'recorded causes and recoveries; it cannot edit an amount.',
  },
  {
    key: 'fixedOutcome',
    control: 'Decide fixed Creator payment outcome',
    sentence:
      'The fixed payment’s disposition — paid with the Transfer, or returned ' +
      'whole to the Founder — follows from the recorded §22.1 completion ' +
      'outcome through its consequence matrix. Deciding it separately would ' +
      'be a second door into a terminal money state.',
  },
  {
    key: 'workAgainReissue',
    control: 'Reissue work-again request',
    sentence:
      'A §22.9 work-again request is the Founder’s own ask, created from ' +
      'their session. An Admin reissuing one would fabricate a party’s ask — ' +
      'the same reason the Founders workspace refuses “Send work-again ' +
      'request”. The recorded requests render below, read-only.',
  },
  {
    key: 'campaignSuspendKill',
    control: 'Suspend campaign / Kill campaign',
    sentence:
      'Suspending or killing a campaign is §26.7’s recorded decision against ' +
      'the CAMPAIGN, with its complete pre- and post-capture effects — a ' +
      'person’s record does not operate campaigns. The routes are mounted and ' +
      'acceptance-tested; their console returns with the operations rebuild.',
  },
  {
    key: 'tierAccessCombo',
    control: 'Change internal tier or proposal access',
    sentence:
      'Two real paths, deliberately apart: the quality tier is free text on ' +
      'the §8 research record (assessment data, never a commission floor), ' +
      'and proposal access is DERIVED from §29 enforcement records — ' +
      'restricting it is recording a restrict-bidding or demote action with ' +
      'its full customer statement. A combined setter would mint the stored ' +
      'eligibility flag §1 rule 6 forbids.',
  },
  {
    key: 'relationshipEdit',
    control: 'Edit Admin-owned relationship data',
    sentence:
      'The roster designation was recorded when the relationship was created ' +
      'and decides which terms bound the Creator — a mid-campaign addition’s ' +
      'remaining-time terms are frozen by trigger. Recruitment facts are ' +
      'edited through the §8 research record, and a material campaign change ' +
      'goes through §15’s classification machinery, never a free-form ' +
      'reacceptance form.',
  },
] as const;

export type AffiliateOperationsAbsenceKey =
  (typeof AFFILIATE_OPERATIONS_ABSENCES)[number]['key'];

export function affiliateOperationsAbsence(key: AffiliateOperationsAbsenceKey) {
  return AFFILIATE_OPERATIONS_ABSENCES.find((a) => a.key === key)!;
}

/* ─────────────────────────── Deliverables and availability (Session C) */

/**
 * The five states a deliverable row can render, and the three the decision
 * table admits (0048's `association_deliverable_decisions.outcome` CHECK).
 *
 * The two extra states are DERIVED, not stored: `pending` is a deliverable
 * with no evidence and no decision, `evidence_submitted` one with a receipt
 * the latest decision has not answered. Latest decision wins — the §22.3
 * early-release idiom the whole 0048 family follows.
 */
export const DELIVERABLE_OUTCOMES = ['verified', 'more_evidence_needed', 'waived'] as const;
export type DeliverableOutcome = (typeof DELIVERABLE_OUTCOMES)[number];

export const DELIVERABLE_STATE_LABELS = {
  pending: 'Waiting on Affiliate',
  evidence_submitted: 'Evidence submitted',
  verified: 'Verified',
  more_evidence_needed: 'More evidence needed',
  waived: 'Founder/Admin waiver',
} as const;

export type DeliverableStateKey = keyof typeof DELIVERABLE_STATE_LABELS;

/**
 * A deliverable RESTATES the accepted agreement; the availability term is READ
 * from the records both parties accepted. Both sentences are pinned because
 * each control would otherwise read as a place to invent a work item or a
 * period the Spec does not state (§1 rule 6 — the reason both capabilities
 * were parked before migration 0048 gave the AGREED term a record).
 */
export const DELIVERABLE_RESTATES_AGREEMENT =
  'A deliverable restates what the accepted agreement already says — its ' +
  'source names that record. It never invents a work item the Creator did ' +
  'not agree to.';

/*
 * Placement-neutral on purpose: the sentence rides the term on the section
 * (where it renders above the note) and inside the verify dialog (where it
 * renders below), and a "the term below" that pointed the wrong way on one of
 * them is the kind of thing only a browser pass catches.
 */
export const AVAILABILITY_TERM_IS_AGREED =
  'The agreed term is read from the records both parties accepted — never ' +
  'typed here. The check stores it verbatim, so a later change to the ' +
  'agreement vocabulary cannot rewrite what was verified.';

/* ─────────────────────────── Termination requests (§29, §24.8, Session C) */

/**
 * The pinned consequence line on the termination-request intake. The record
 * preserves the ask — reason, effective time, §24.8 cause, money treatment —
 * and its money treatment is CHECK-matrixed to the cause register's own
 * matrix. What it does NOT do is the sentence, because the reference's dialog
 * reads as an act that ends the partnership and moves the money.
 */
export const TERMINATION_DECIDES_NO_MONEY =
  'Recording the request decides no money and ends nothing. Ending the ' +
  'relationship is a §29 enforcement action with its own record, and any ' +
  'money movement is the recorded §24.8 case path — this row is the reason ' +
  'those acts will cite.';

/**
 * Human labels for §24.8's five affiliate treatments, typed against the cause
 * register's own vocabulary so a sixth treatment cannot gain a label here
 * without gaining a rule there first. The permitted set per cause stays the
 * register's — this map only says the words.
 */
export const AFFILIATE_TREATMENT_LABELS: Readonly<Record<AffiliateRefundTreatment, string>> = {
  not_attributed: 'Not attributed — no Affiliate earnings exist on it',
  earnings_remain: 'Valid Affiliate earnings remain',
  cancel_unfinalized: 'Cancel unfinalized earnings on the affected transactions',
  cancel_unpaid_invalid: 'Cancel unpaid invalid earnings',
  contractual_recovery: 'Contractual recovery of the invalid amount',
};

/* ─────────────────────────────── Communications (§27, Session C) */

/**
 * The History tab's Communications section renders `notification_deliveries`
 * — the real record of recipient, event key, delivery state, and dedup
 * entity. Pinned because the reference DERIVES its communications list by
 * regex over event titles, which is a mock, and because a reader should know
 * the list is the delivery record itself rather than an inference.
 */
export const COMMUNICATIONS_ARE_THE_RECORD =
  'Transactional messages keep recipient, template, delivery state, and ' +
  'deduplication key. This list is the delivery record itself — not an ' +
  'inference from event titles.';

/* ────────────────────────────────────────────── Copy the reference pins */

/**
 * Sentences the reference's own acceptance audit checks for, and which say
 * something true that a surface would otherwise imply wrongly.
 *
 * They live here rather than at their call sites for the reason §7's
 * `NO_GUARANTEE_TEXT` does: a promise about how Proovd behaves is not the
 * renderer's to reword.
 */
/**
 * §24.7's fourth money stream, named as §3.2 requires.
 *
 * ── A conflict, resolved in the Spec's favour, and worth recording ──────────
 * The supplied reference calls this an "upfront fee" and its acceptance audit
 * refuses "fixed payment" by name. §3.2 bans the opposite: `upfront fee`,
 * `upfront payout`, and `upfront payment` are UNIVERSALLY banned terms, and
 * §33.11.3 scans the whole shipped bundle for them — so the two rules are exact
 * inverses and only one can hold. §1.8 makes the Spec win on all of it, and
 * §3.2's own mandated replacement is "optional fixed Creator payment / Creator
 * payment funded", which is what these constants say.
 *
 * The reason §3.2 bans the reference's word is the reason the reference wanted
 * it: "upfront" reads as money already handed over. Everything the reference
 * was protecting survives — the Product-only rule, the seven-state chain, and
 * the sentence below that funded is not paid.
 */
export const FIXED_CREATOR_PAYMENT_LABEL = 'Fixed Creator payment' as const;

export const FIXED_PAYMENT_FUNDED_IS_NOT_PAID =
  'Funded means the campaign-specific fixed Creator payment was funded. It ' +
  'does not mean the Creator was paid.';

export const ADMIN_CANNOT_ACCEPT =
  'Admin cannot accept for either party.' as const;

export const SALES_ARE_NOT_A_COMPLETION_REQUIREMENT =
  'Sales performance is not a completion requirement.' as const;

export const FIRST_POST_RELEASES_ZERO =
  'First-post review releases $0.' as const;

export const ATTRIBUTION_FOOTNOTE =
  'Refresh-based · provisional until capture and reconciliation · last valid ' +
  'Creator click on the same browser/device wins · no Backer PII.';

/**
 * §11's boundary, stated on the Admin surface that could most easily breach it.
 *
 * The Admin sees everything; the Founder sees seven columns. Saying so where an
 * Admin reads the sensitive fields is what keeps a support transcript from
 * quoting one into a Founder conversation (§3.1's actual risk).
 */
export const FOUNDER_NEVER_SEES_THIS =
  'The Founder never sees the fields in this block — no email, no phone, no ' +
  'legal name, no quality tier, no evidence, and no internal notes.';
