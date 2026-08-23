/**
 * The Admin Founder panel's eleven-stage workflow, restated for the backend.
 *
 * `shared/src/admin/founder-workflow.ts` is the source of truth. The backend
 * cannot import it — it compiles under `rootDir: src` and the image ships only
 * `backend/dist`, so a cross-package import does not resolve at runtime. The
 * answer this repo has used since Phase 01 for the state enums, since 06a for
 * the §6 settings, and in `founders/logic.ts` for the workspace vocabulary is
 * the same one here: restate the data, and fail the suite if the two ever
 * disagree. `src/tests/admin-founder-panel-registers.test.ts` is that
 * comparison — test files sit outside the build's rootDir, so they are the one
 * place both packages can be imported at once.
 *
 * Restating rather than deriving is deliberate. A third copy could drift; a
 * copy a test compares cannot drift without somebody being told.
 *
 * ── Reachability is a ratchet, not an index of the current status ───────────
 * `campaigns.status` moves BACKWARD — `changes_required` follows
 * `pending_review`, `capture_retry_window` follows `closed_pending_capture` —
 * so "furthest reached" cannot be derived from it. Migration 0059 adds
 * `campaigns.workflow_stage_reached` with a trigger that refuses a lower index,
 * and that column is what unlocks the menu.
 */

/* ── The eleven, in the reference's order ─────────────────────────────────── */

export const FOUNDER_WORKFLOW_STAGE_IDS = [
  'invite',
  'onboarding',
  'review',
  'fee',
  'setup',
  'matching',
  'launch',
  'live',
  'ended',
  'delivery',
  'complete',
] as const;

export type FounderWorkflowStageId = (typeof FOUNDER_WORKFLOW_STAGE_IDS)[number];

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
 * and an undecided `campaign_application_reviews` row exists; that derivation
 * lives in `service.ts`, with the query that can see the row.
 */
export const FOUNDER_WORKFLOW_STATUSES: Record<FounderWorkflowStageId, readonly string[]> = {
  invite: ['invited_draft'],
  onboarding: ['vetting_submitted', 'account_claimed', 'stripe_onboarding_pending'],
  review: [],
  fee: ['listing_fee_pending'],
  setup: ['affiliate_response_and_build'],
  matching: ['pending_review', 'changes_required'],
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
 * has no stage, and the surface says so rather than folding it into `complete`.
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
 * values). The reference splits `newsletter_blog_operator` into Newsletter and
 * Blog and `student_affiliate` into Student affiliate and Network distributor,
 * so reusing that enum would silently rename two of its options. The drift test
 * asserts the two are DELIBERATELY DIFFERENT rather than equal.
 *
 * This is an Admin prefill about who a campaign should be pitched to. It is not
 * the §5.3 subtype of any actual Creator, which stays on the Creator's record.
 */
export const PREFILL_AFFILIATE_TYPES = [
  { id: 'social_media_creator', label: 'Social media creator' },
  { id: 'newsletter_operator', label: 'Newsletter operator' },
  { id: 'blog_operator', label: 'Blog operator' },
  { id: 'podcast_host', label: 'Podcast host' },
  { id: 'community_owner', label: 'Community owner' },
  { id: 'course_instructor', label: 'Course instructor' },
  { id: 'student_affiliate', label: 'Student affiliate' },
  { id: 'network_distributor', label: 'Network distributor' },
  { id: 'niche_marketer', label: 'Niche marketer' },
] as const;

export type PrefillAffiliateTypeId = (typeof PREFILL_AFFILIATE_TYPES)[number]['id'];

export const PREFILL_AFFILIATE_TYPE_IDS: readonly string[] = PREFILL_AFFILIATE_TYPES.map(
  (t) => t.id,
);

export function prefillAffiliateTypeLabel(id: string | null | undefined): string | null {
  return PREFILL_AFFILIATE_TYPES.find((t) => t.id === id)?.label ?? null;
}

/* ── The application-review outcomes (migration 0059) ──────────────────────── */

/** The reference's own seven, in its order. CHECK-pinned by migration 0059. */
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

export const APPLICATION_REVIEW_OUTCOME_IDS: readonly string[] = APPLICATION_REVIEW_OUTCOMES.map(
  (o) => o.id,
);

export function isApplicationReviewOutcome(value: string): value is ApplicationReviewOutcome {
  return APPLICATION_REVIEW_OUTCOME_IDS.includes(value);
}

export function applicationReviewLabel(id: string): string {
  return APPLICATION_REVIEW_OUTCOMES.find((o) => o.id === id)?.label ?? id;
}

/**
 * The three outcomes that END a round.
 *
 * `waiting`, `in_review`, `needs_information` and `resubmitted` are positions
 * within an open round; the three below are decisions, and a decided round is
 * closed — a further decision opens a new one. That distinction is what makes
 * `Application version` (max round) mean something.
 */
export const APPLICATION_REVIEW_TERMINAL_OUTCOMES: readonly ApplicationReviewOutcome[] = [
  'changes_requested',
  'approved',
  'rejected',
];

export function applicationReviewDecided(outcome: string): boolean {
  return (APPLICATION_REVIEW_TERMINAL_OUTCOMES as readonly string[]).includes(outcome);
}
