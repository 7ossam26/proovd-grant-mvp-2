/**
 * §20's registers and derivations, restated for the runtime.
 *
 * The backend cannot import `@proovd/shared` at runtime — that package exports
 * TypeScript source, the backend compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. Same constraint as the state enums
 * in `db/schema/domain.ts`, the policy slugs in `policy-gate.ts`, the launch
 * checklist in `launch/logic.ts`, and the support registers in
 * `support/logic.ts`; same answer — restate what the server needs and let a drift
 * test fail the suite if the two ever disagree.
 *
 * `src/tests/live-operations.test.ts` walks every register and every derivation
 * below against `@proovd/shared`. A sixth Act rank, a twelfth Explore section, a
 * changed crossing rule, or a reworded done-moment fails there before it reaches
 * a Founder.
 */

export const ACT_ACTION_KINDS = [
  'safety_compliance_blocker',
  'delivery_refund_date_review',
  'unanswered_backer_question',
  'required_campaign_update',
  'optional_milestone_update',
] as const;
export type ActActionKind = (typeof ACT_ACTION_KINDS)[number];

/** §20's ranking, as data. Rank 1 is the highest priority. */
export const ACT_RANK_BY_KIND: Readonly<Record<ActActionKind, 1 | 2 | 3 | 4 | 5>> = {
  safety_compliance_blocker: 1,
  delivery_refund_date_review: 2,
  unanswered_backer_question: 3,
  required_campaign_update: 4,
  optional_milestone_update: 5,
};

export const ACT_LABELS: Readonly<Record<ActActionKind, string>> = {
  safety_compliance_blocker: 'Resolve a safety or compliance block',
  delivery_refund_date_review: 'Review a delivery, refund, or date change',
  unanswered_backer_question: 'Answer a Backer question',
  required_campaign_update: 'Post the required campaign update',
  optional_milestone_update: 'Share a milestone update',
};

export const ACT_CORRECTION_KINDS = [
  'correction',
  'dismissal',
  'reclassification',
  'safety_override',
] as const;
export type ActCorrectionKind = (typeof ACT_CORRECTION_KINDS)[number];

export const MILESTONE_KINDS = [
  'first_preorder',
  'halfway',
  'threshold_met',
  'campaign_ended',
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_LABELS: Readonly<Record<MilestoneKind, string>> = {
  first_preorder: 'Your first pre-order',
  halfway: 'Halfway to your order threshold',
  threshold_met: 'Your order threshold is met',
  campaign_ended: 'Your campaign ended',
};

export const EXPLORE_SECTION_KEYS = [
  'clicks',
  'preorder_counts',
  'reserved_totals',
  'conversion_and_time',
  'creator_results',
  'survey_answers',
  'funnel',
  'attribution_breakdown',
  'comments_and_updates',
  'exports',
  'definitions_and_freshness',
] as const;
export type ExploreSectionKey = (typeof EXPLORE_SECTION_KEYS)[number];

export const ATTRIBUTION_BREAKDOWN_SOURCES = ['direct', 'organic', 'house', 'creator'] as const;
export type AttributionBreakdownSource = (typeof ATTRIBUTION_BREAKDOWN_SOURCES)[number];

/** §20/§30: freshness is a time, never a claim about immediacy. */
export const BANNED_FRESHNESS_TERMS = [
  'real time',
  'real-time',
  'realtime',
  'live data',
  'live count',
  'streaming',
  'up to the second',
  'up-to-the-second',
] as const;

export const ACT_CAUGHT_UP = "You're all caught up. Results land [LOCAL CLOSE].";
export const GLANCE_NOT_YET_CHARGED =
  'These people selected an offer and agreed to the charge rules. ' +
  'They have not been charged yet.';

/* ── Derivations (restated; drift-tested against shared) ───────────────────── */

export type ThresholdState = 'reached' | 'below';
export type ThresholdCrossing = 'reached' | 'lost';

export function thresholdStateFor(uniqueActiveBackers: number, threshold: number): ThresholdState {
  return uniqueActiveBackers >= threshold ? 'reached' : 'below';
}

/**
 * §20: each crossing is its own event, "deduplicated by state transition".
 *
 * Compared against the last crossing actually recorded, so a campaign that
 * crosses up, down, and up again emits three events and two evaluations with no
 * crossing between them emit nothing. That is what makes calling this on every
 * pre-order and every cancellation safe, and it is the same rule migration 0026's
 * alternation trigger enforces underneath.
 */
export function crossingFor(
  lastRecorded: ThresholdCrossing | null,
  current: ThresholdState,
): ThresholdCrossing | null {
  if (current === 'reached') return lastRecorded === 'reached' ? null : 'reached';
  return lastRecorded === 'reached' ? 'lost' : null;
}

/**
 * §33.6.9. `otherExits` is a reservation that left the active set without being a
 * cancellation — a kill (§26.7) closes one `killed_no_charge`. Folding those into
 * cancellations would misreport how many Backers changed their own minds.
 */
export function reconcileCounts(input: {
  newCount: number;
  canceledCount: number;
  otherExits: number;
  activeCount: number;
}): { newCount: number; canceledCount: number; otherExits: number; activeCount: number; netChange: number } {
  const netChange = input.newCount - input.canceledCount;
  const expectedActive = netChange - input.otherExits;
  if (expectedActive !== input.activeCount) {
    throw new Error(
      `pre-order counts do not reconcile: ${input.newCount} new − ${input.canceledCount} canceled ` +
        `− ${input.otherExits} other = ${expectedActive}, but ${input.activeCount} are active (§33.6.9)`,
    );
  }
  return { ...input, netChange };
}

/** §20's four milestones. Halfway and threshold are Idea-only (§14.4). */
export function reachedMilestones(input: {
  model: 'idea' | 'product';
  everHadPreorder: boolean;
  uniqueActiveBackers: number;
  threshold?: number | undefined;
  ended: boolean;
}): MilestoneKind[] {
  const reached: MilestoneKind[] = [];
  if (input.everHadPreorder) reached.push('first_preorder');
  if (input.model === 'idea' && input.threshold !== undefined) {
    if (input.uniqueActiveBackers * 2 >= input.threshold) reached.push('halfway');
    if (thresholdStateFor(input.uniqueActiveBackers, input.threshold) === 'reached') {
      reached.push('threshold_met');
    }
  }
  if (input.ended) reached.push('campaign_ended');
  return reached;
}
