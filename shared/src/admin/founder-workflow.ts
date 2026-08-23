/**
 * The Admin Founder panel's eleven-stage workflow — 2026-08-22.
 *
 * ── Why this is a register ──────────────────────────────────────────────────
 * Five things have to agree about a stage: the workflow menu (which is current,
 * which are reachable, which are inactive), the directory's `Now` and `Status`
 * columns, the record bar, the router, and the stage screen itself. Five
 * hand-written lists is four chances to disagree, and the disagreement shows up
 * as a menu entry that opens nothing.
 *
 * The labels below are the reference's own (`Ge` in `ProovdAdminFounder.html`),
 * verbatim and in its order (`on`).
 *
 * ── Reachability is a ratchet, not an index of the current status ───────────
 * `campaigns.status` moves BACKWARD — `changes_required` follows
 * `pending_review`, `capture_retry_window` follows `closed_pending_capture` —
 * so "furthest reached" cannot be derived from it. Migration 0059 adds
 * `campaigns.workflow_stage_reached` with a trigger that refuses a lower index,
 * and that column is what unlocks the menu. Deriving reachability from `status`
 * would relock a screen somebody has already used.
 *
 * ── Four lifecycle states map to no stage, deliberately ─────────────────────
 * `refunded_no_creator`, `suspended`, `killed` and `banned_founder` are not
 * positions in a workflow — they are exits from it. Folding them into
 * `complete` would be the panel inventing a position (§1.4), so `stageForStatus`
 * returns null and the surface renders the §23.1 label with its reason.
 */

/* ── The eleven, in the reference's order ─────────────────────────────────── */

export const FOUNDER_WORKFLOW_STAGE_IDS = [
  'invite',
  'onboarding',
  'review',
  'fee',
  'matching',
  'setup',
  'launch',
  'live',
  'ended',
  'delivery',
  'complete',
] as const;

export type FounderWorkflowStageId = (typeof FOUNDER_WORKFLOW_STAGE_IDS)[number];

/** The reference's `Ge`, verbatim. */
export const FOUNDER_WORKFLOW_LABELS: Record<FounderWorkflowStageId, string> = {
  invite: 'Invite',
  onboarding: 'Onboarding',
  review: 'Application review',
  fee: 'Listing fee',
  matching: 'Matching',
  setup: 'Campaign setup',
  launch: 'Ready to launch',
  live: 'Live',
  ended: 'Campaign ended',
  delivery: 'Delivery and payments',
  complete: 'Complete',
};

export function isFounderWorkflowStage(value: string): value is FounderWorkflowStageId {
  return (FOUNDER_WORKFLOW_STAGE_IDS as readonly string[]).includes(value);
}

export function workflowStageIndex(id: FounderWorkflowStageId): number {
  return FOUNDER_WORKFLOW_STAGE_IDS.indexOf(id);
}

/**
 * The reference's rule, verbatim in behaviour:
 * `available = on.indexOf(s) <= on.indexOf(al)` where `al` is the furthest
 * stage ever reached.
 */
export function workflowStageAvailable(
  id: FounderWorkflowStageId,
  reached: FounderWorkflowStageId,
): boolean {
  return workflowStageIndex(id) <= workflowStageIndex(reached);
}

/* ── Which lifecycle states put a campaign AT a stage ──────────────────────── */

/**
 * Keyed on `campaigns.status`, which §23.1 makes lifecycle-only — so this
 * mapping can never drift into money.
 *
 * `review` has no entry on purpose: §9 defines no application-review lifecycle
 * state, and migration 0059 gives the decision its own record rather than
 * overloading a status. A campaign sits at `review` when vetting is submitted
 * and an open `campaign_application_reviews` row exists; the derivation lives
 * with the query that can see that row, not here.
 */
export const FOUNDER_WORKFLOW_STATUSES: Record<FounderWorkflowStageId, readonly string[]> = {
  invite: ['invited_draft'],
  onboarding: ['vetting_submitted', 'account_claimed', 'stripe_onboarding_pending'],
  review: [],
  fee: ['listing_fee_pending'],
  matching: ['affiliate_response_and_build'],
  setup: ['pending_review', 'changes_required'],
  launch: ['approved', 'creator_prep', 'creator_replacement'],
  live: ['live'],
  ended: [
    'closed_pending_capture',
    'capture_retry_window',
    'closed_reconciling',
    'ended_no_charge',
  ],
  delivery: [
    'captured_pending_w9',
    'single_payment_released',
    'first_payment_released',
    'day_14_review',
    'remaining_payment_released',
  ],
  complete: ['fulfilled', 'closed_resolved'],
};

/**
 * Exits from the workflow rather than positions in it. A record in one of these
 * has no stage, and the surface says so.
 */
export const FOUNDER_WORKFLOW_EXIT_STATUSES: readonly string[] = [
  'refunded_no_creator',
  'suspended',
  'killed',
  'banned_founder',
];

/** Null for an exit status, an unknown status, or no campaign at all. */
export function stageForStatus(status: string | null | undefined): FounderWorkflowStageId | null {
  if (!status) return null;
  if (FOUNDER_WORKFLOW_EXIT_STATUSES.includes(status)) return null;
  for (const id of FOUNDER_WORKFLOW_STAGE_IDS) {
    if (FOUNDER_WORKFLOW_STATUSES[id].includes(status)) return id;
  }
  return null;
}

/* ── The nine-value affiliate taxonomy the Invite stage prefills ──────────── */

/**
 * The reference's OWN list, and deliberately NOT `AFFILIATE_SUBTYPES` (seven
 * values, `shared/src/affiliates/subtypes.ts`).
 *
 * The reference splits `newsletter_blog_operator` into Newsletter and Blog, and
 * `student_affiliate` into Student affiliate and Network distributor, and drops
 * "distribution partner" from Niche marketer. Reusing the seven-value enum would
 * silently rename two of its options, so this is its own register — and the
 * drift test between the two must assert they are DELIBERATELY DIFFERENT rather
 * than equal.
 *
 * This is an Admin prefill about who a campaign should be pitched to. It is not
 * the §5.3 subtype of any actual Creator, which stays on the Creator's record.
 */
export const PREFILL_AFFILIATE_TYPES = [
  { id: 'social_media_creator', label: 'Social media creator', pluralLabel: 'Social media creators' },
  { id: 'newsletter_operator', label: 'Newsletter operator', pluralLabel: 'Newsletter operators' },
  { id: 'blog_operator', label: 'Blog operator', pluralLabel: 'Blog operators' },
  { id: 'podcast_host', label: 'Podcast host', pluralLabel: 'Podcast hosts' },
  { id: 'community_owner', label: 'Community owner', pluralLabel: 'Community owners' },
  { id: 'course_instructor', label: 'Course instructor', pluralLabel: 'Course instructors' },
  { id: 'student_affiliate', label: 'Student affiliate', pluralLabel: 'Student affiliates' },
  { id: 'network_distributor', label: 'Network distributor', pluralLabel: 'Network distributors' },
  { id: 'niche_marketer', label: 'Niche marketer', pluralLabel: 'Niche marketers' },
] as const;

export type PrefillAffiliateTypeId = (typeof PREFILL_AFFILIATE_TYPES)[number]['id'];

export const PREFILL_AFFILIATE_TYPE_IDS: readonly string[] = PREFILL_AFFILIATE_TYPES.map(
  (t) => t.id,
);

export function prefillAffiliateTypeLabel(id: string | null | undefined): string | null {
  return PREFILL_AFFILIATE_TYPES.find((t) => t.id === id)?.label ?? null;
}

export function summarizePrefillAffiliateTypes(
  ids: readonly string[] | null | undefined,
): string | null {
  if (!ids?.length) return null;

  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const labels = Array.from(counts, ([id, count]) => {
    const type = PREFILL_AFFILIATE_TYPES.find((candidate) => candidate.id === id);
    if (!type) return null;
    return count === 1 ? type.label : `${count} ${type.pluralLabel}`;
  }).filter((label): label is string => label !== null);

  return labels.length ? labels.join(' · ') : null;
}

/* ── The application-review outcomes (migration 0059) ──────────────────────── */

/** The reference's own seven, in its order. */
export const APPLICATION_REVIEW_OUTCOMES = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'in_review', label: 'In review' },
  { id: 'needs_information', label: 'Needs information' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'resubmitted', label: 'Resubmitted' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
] as const;

export type ApplicationReviewOutcome = (typeof APPLICATION_REVIEW_OUTCOMES)[number]['id'];

export const APPLICATION_REVIEW_OUTCOME_IDS: readonly string[] =
  APPLICATION_REVIEW_OUTCOMES.map((o) => o.id);

export function applicationReviewLabel(id: string): string {
  return APPLICATION_REVIEW_OUTCOMES.find((o) => o.id === id)?.label ?? id;
}
