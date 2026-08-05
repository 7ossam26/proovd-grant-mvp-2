/**
 * Completion, future work, and resolution — Spec §22.8, §22.9, §22.10, §22.11,
 * §31.8 (Phase 21b).
 *
 * The last registers in the product. Everything here is a *consequence* of
 * records earlier phases already wrote: §22.8's five criteria are read from
 * readiness, post verification, deliverable decisions, enforcement, and money;
 * §22.11's resolution is read from §21's nine reconciliation items; §31.8's
 * status progression is read from the reservation. Nothing in this file
 * introduces a new fact about a campaign — it decides what the existing facts
 * add up to.
 *
 * That is why the criteria are a register rather than a function body. §22.8
 * says "when all five hold" and §33.10.5 tests exactly that, so "all five" has
 * to be something a test can enumerate rather than a conjunction someone can
 * quietly drop a clause from.
 */

/* ── §22.8 Creator successfully_completed ─────────────────────────────────── */

/**
 * §22.8's five criteria, each named with the record it is read from.
 *
 * `salesPerformance` is deliberately not among them, and the omission is the
 * point: §22.8 states "Sales performance is not required" and §33.10.6 tests a
 * Creator who did everything agreed and sold nothing. Completion measures work
 * delivered, not results achieved — a Creator cannot control whether a product
 * finds buyers, and making them wear that outcome would be a penalty for
 * someone else's campaign.
 */
export const COMPLETION_CRITERIA = [
  {
    key: 'readiness_cleared',
    spec: '§22.8.1: Creator cleared readiness before work.',
    // "every item or none" rather than the crowdfunding phrase §3.2 forbids
    // everywhere, including in an internal description. This string ships in
    // the browser bundle, and Phase 23a's bundle scan is what found it.
    record: 'association_readiness (§16) — the thirteen-item checklist, every item or none',
  },
  {
    key: 'valid_post_verified',
    spec: '§22.8.2: At least one valid post was submitted and verified.',
    record: 'creator_post_submissions (§17) — outcome `passed`',
  },
  {
    key: 'deliverables_resolved',
    spec: '§22.8.3: Every deliverable was verified, or specifically waived by Founder AND Admin with a reason.',
    record: 'creator_completion_decisions (§22.1) — the recorded outcome and its waiver',
  },
  {
    key: 'no_unresolved_case',
    spec: '§22.8.4: No unresolved fraud, invalid-proof, material-breach, or compliance case exists.',
    record: 'affiliate_enforcement_actions (§29) + payment_disputes (§24.11) + day_14_reviews (§22.4)',
  },
  {
    key: 'money_resolved',
    spec: '§22.8.5: Fixed-payment return or payment, commission adjustment, and Transfer are resolved or recorded.',
    record: 'creator_earnings + affiliate_transfers + creator_payment_allocations (§22.1, §24.7)',
  },
] as const;

export type CompletionCriterionKey = (typeof COMPLETION_CRITERIA)[number]['key'];

export const COMPLETION_CRITERION_KEYS = COMPLETION_CRITERIA.map(
  (c) => c.key,
) as CompletionCriterionKey[];

/** What an evaluation found, per criterion: met, or not, with the reason why not. */
export interface CriterionFinding {
  key: CompletionCriterionKey;
  met: boolean;
  /** Why it is not met, in words an Admin can act on. Empty when met. */
  detail: string;
}

/**
 * §22.8: `successfully_completed` needs all five. Anything else is not a
 * partial pass — the status is binary and §23.4 gives it no middle state.
 *
 * Pure, so "all five" is a property a test walks rather than a code path it
 * happens to exercise.
 */
export function completionEligible(findings: readonly CriterionFinding[]): boolean {
  if (findings.length !== COMPLETION_CRITERIA.length) return false;
  const seen = new Set(findings.map((f) => f.key));
  if (seen.size !== COMPLETION_CRITERIA.length) return false;
  return findings.every((f) => f.met);
}

/** The criteria a set of findings failed, in register order. */
export function unmetCriteria(findings: readonly CriterionFinding[]): CriterionFinding[] {
  const byKey = new Map(findings.map((f) => [f.key, f]));
  return COMPLETION_CRITERION_KEYS.map((key) => byKey.get(key)).filter(
    (f): f is CriterionFinding => f !== undefined && !f.met,
  );
}

/**
 * §22.8: "Store status … and disqualifying reason." A Creator who does not meet
 * the criteria is recorded as disqualified WITH the reason, rather than simply
 * left un-completed — §23.4 names `completion_disqualified` as its own state
 * and a silent absence is not a decision anyone can review or appeal.
 */
export const COMPLETION_STATUSES = ['successfully_completed', 'completion_disqualified'] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

/* ── §22.9 the work-again request ─────────────────────────────────────────── */

/**
 * §22.9's lifecycle. `withdrawn` is the Founder's own retraction; there is no
 * `expired`, because §22.9 sets no deadline and inventing one would put a
 * clock on a Creator's answer that nobody agreed to (§1 rule 6).
 */
export const WORK_AGAIN_STATUSES = ['requested', 'accepted', 'declined', 'withdrawn'] as const;
export type WorkAgainStatus = (typeof WORK_AGAIN_STATUSES)[number];

/**
 * §22.9: "Creator can accept/decline without penalty."
 *
 * Pinned, because this is a promise about how Proovd behaves and not an
 * Admin's or a Founder's to reword. §8's `DECLINE_NOTICE` makes the same
 * promise at recruitment; this is the same commitment at the other end of the
 * relationship, and a Creator who has just finished a campaign is exactly the
 * person most likely to fear that saying no costs them something.
 */
export const WORK_AGAIN_NO_PENALTY =
  'Declining does not harm your standing with Proovd in any way, and it does not affect your completion status on this campaign.';

/**
 * §22.9: "Acceptance creates no campaign and bypasses no active-campaign
 * limit, three-month cooldown, or Admin readiness approval."
 *
 * Stated as data so §33.10.8 can assert each clause separately, and pinned as
 * customer copy so the Founder reading an acceptance is told the same thing
 * the database enforces. An acceptance that read as permission would be the
 * §1.4 failure at the moment a Founder is most motivated to hear one.
 */
export const WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING = [
  'This does not create a campaign.',
  'It does not shorten your three-month cooldown.',
  'It does not count as Admin readiness approval.',
  'It does not raise your active-campaign limit.',
] as const;

/* ── §22.10 Founder next-campaign readiness ───────────────────────────────── */

/**
 * §22.10's two gates. They are independent and both are required: §33.10.9
 * tests that the Founder sees "the exact cooldown date AND the separate
 * readiness decision", and the trap names the failure — meeting the cooldown
 * grants nothing by itself.
 */
export const NEXT_CAMPAIGN_GATES = [
  {
    key: 'cooldown',
    spec: '§6, §22.10: at least three months since the previous campaign closed.',
    decidedBy: 'time',
  },
  {
    key: 'admin_readiness',
    spec: '§22.10: `ready for next campaign` only after an Admin decision.',
    decidedBy: 'admin',
  },
] as const;

export type NextCampaignGateKey = (typeof NEXT_CAMPAIGN_GATES)[number]['key'];

/**
 * The earliest date a Founder may request another campaign.
 *
 * ── The anchor is `campaign_close_at`, and it is chosen rather than invented ─
 * §6 states "Founder repeat-campaign cooldown: at least three months" and names
 * no anchor, which leaves exactly one honest choice: an instant the product
 * already stores, that is immutable, and that means "this campaign ended".
 * `campaign_close_at` is all three — §21 makes it one of the three dedicated
 * anchors, never inferred from `created_at`/`updated_at`. Anchoring on
 * fulfillment instead would make the wait depend on how long a Founder took to
 * ship, which turns a cooldown into a second penalty; anchoring on resolution
 * would let a slow reconciliation extend it.
 *
 * Months, not days: §6 says months, and 90 days is a different promise in
 * February. Clamped to the end of a short month so a 31 January close does not
 * silently become 3 May.
 */
export function nextCampaignEarliestAt(closedAt: Date, cooldownMonths: number): Date {
  const result = new Date(closedAt.getTime());
  const targetMonth = result.getUTCMonth() + cooldownMonths;
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  // The last day of the target month, so 31 Jan + 3 months is 30 April rather
  // than rolling into May the way a naive setUTCMonth would.
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** True once the cooldown has elapsed. The time gate, and only the time gate. */
export function cooldownElapsed(closedAt: Date, cooldownMonths: number, now: Date): boolean {
  return now.getTime() >= nextCampaignEarliestAt(closedAt, cooldownMonths).getTime();
}

/**
 * §22.10: "Ability to prepare updates/evidence without opening a new campaign."
 *
 * Pinned so the surface cannot quietly turn this into a "start your next
 * campaign" affordance while the readiness decision is still outstanding.
 */
export const PREPARE_WITHOUT_OPENING =
  'You can prepare updates and evidence now. Nothing here opens a new campaign.';

/* ── §31.8 Backer status progression and satisfaction ─────────────────────── */

/**
 * §31.8's progression, in order. "Derived from real state and never predicts an
 * unconfirmed outcome" is why each step names the reservation statuses that
 * produce it: a step is shown because a stored status says so, never because
 * the previous step suggests it is coming.
 */
export const BACKER_PROGRESSION = [
  { key: 'reserved', label: 'Reserved', from: ['reserved_active'] },
  { key: 'charge_due', label: 'Charge due', from: ['pending_capture'] },
  {
    key: 'no_charge',
    label: 'No charge',
    from: ['threshold_not_met_no_charge', 'killed_no_charge', 'reserved_canceled'],
  },
  { key: 'captured', label: 'Captured', from: ['captured'] },
  { key: 'failed', label: 'Failed', from: ['capture_failed_retrying', 'capture_failed_dropped'] },
  // Delivery due is not a reservation status — it is `captured` plus the
  // campaign owing a delivery. The reservation stays `captured` through it.
  { key: 'delivery_due', label: 'Delivery due', from: ['captured'] },
  { key: 'delivered', label: 'Delivered', from: ['captured'] },
  { key: 'refunded', label: 'Refunded', from: ['refunded', 'reversed', 'disputed'] },
] as const;

export type BackerProgressionKey = (typeof BACKER_PROGRESSION)[number]['key'];

/**
 * §31.8's two answer scales. §31.8 names both — "one-click satisfied/not
 * satisfied or 1–5" — so both are supported and the surface picks one; a
 * product that offered both at once would be two questions in one moment
 * (DNA §5.1).
 */
export const SATISFACTION_SCALES = ['binary', 'rating_1_5'] as const;
export type SatisfactionScale = (typeof SATISFACTION_SCALES)[number];

/**
 * What counts as negative, and therefore what creates the §31.8 follow-up.
 *
 * 3 of 5 is neutral and does NOT open a case: a follow-up nobody asked for on
 * a middling answer trains people to stop answering, and §31.8's task is meant
 * to be an owned response to a real problem rather than a queue of shrugs.
 */
export const NEGATIVE_RATING_AT_OR_BELOW = 2;

export function satisfactionIsNegative(input: {
  scale: SatisfactionScale;
  satisfied?: boolean | undefined;
  rating?: number | undefined;
}): boolean {
  if (input.scale === 'binary') return input.satisfied === false;
  return typeof input.rating === 'number' && input.rating <= NEGATIVE_RATING_AT_OR_BELOW;
}

/**
 * §31.8: "It takes under 30 seconds, does not coerce newsletter consent."
 *
 * The prohibitions are a register so §33.10.10 asserts each absence rather than
 * trusting a reviewer to notice one creeping in. §30's dark-pattern ban is the
 * same rule stated generally; this is it applied to the one moment where a
 * product is most tempted to ask for something else while it has attention.
 */
export const SATISFACTION_PROHIBITIONS = [
  {
    key: 'no_consent_coercion',
    spec: '§31.8: does not coerce newsletter consent.',
    rule: 'No consent control appears in the satisfaction flow, prechecked or otherwise.',
  },
  {
    key: 'no_required_reason',
    spec: '§31.8: "then optional reason".',
    rule: 'The reason field never blocks submission.',
  },
  {
    key: 'no_gated_answer',
    spec: '§31.8: "starts with one click".',
    rule: 'The first answer is recorded on one interaction, with nothing required before it.',
  },
  {
    key: 'no_second_ask',
    spec: '§30: no engagement sequence.',
    rule: 'One response per reservation. A person who answered is never asked again.',
  },
] as const;

/**
 * The one interaction §31.8's "under 30 seconds" allows before an answer is
 * recorded. Stated as a number so the surface test can count controls rather
 * than time a stopwatch — a flow that records on the first click cannot take
 * thirty seconds, whatever the network does.
 */
export const SATISFACTION_CLICKS_TO_ANSWER = 1;

/* ── §22.11 campaign resolution ───────────────────────────────────────────── */

/**
 * §22.11: "`closed_resolved` means charge/retry, Creator Transfer, Founder
 * payment, refund/adjustment, and required close records reconcile."
 *
 * Five named areas, mapped onto the §21 reconciliation items that already
 * record each one. Nothing new is verified here — §21's register is the
 * verification, and this is the statement of which of its items §22.11 is
 * talking about.
 */
export const RESOLUTION_AREAS = [
  {
    key: 'charge_retry',
    spec: '§22.11: charge/retry.',
    reconciliationItems: ['batch_completeness', 'tax_charge_reconciliation'],
  },
  {
    key: 'creator_transfer',
    spec: '§22.11: Creator Transfer.',
    reconciliationItems: ['creator_deliverables', 'creator_bonus_triggers', 'provisional_vs_earned'],
  },
  {
    key: 'founder_payment',
    spec: '§22.11: Founder payment.',
    reconciliationItems: ['unearned_return', 'founder_share_w9'],
  },
  {
    key: 'refund_adjustment',
    spec: '§22.11: refund/adjustment.',
    reconciliationItems: ['refund_risk_dispute'],
  },
  {
    key: 'close_records',
    spec: '§22.11: required close records.',
    reconciliationItems: ['attribution_post_verification'],
  },
] as const;

export type ResolutionAreaKey = (typeof RESOLUTION_AREAS)[number]['key'];

/**
 * §22.11: "Fulfillment may remain active separately until `fulfilled`."
 *
 * Pinned because the sentence exists to stop exactly one mistake, and it is a
 * mistake that reads as a tidy-up: collapsing two states that happen to be
 * true at the same time on most campaigns. Money reconciled does not mean the
 * product shipped, and a Backer waiting on a reward would be told the campaign
 * was resolved.
 */
export const RESOLUTION_IS_NOT_FULFILLMENT =
  'Resolved means the money reconciles. It does not mean the reward has shipped — fulfillment is tracked separately.';

/** Every reconciliation item §22.11 requires, across all five areas. */
export function resolutionRequiredItems(): string[] {
  return [...new Set(RESOLUTION_AREAS.flatMap((a) => [...a.reconciliationItems]))];
}

/**
 * §22.11: resolution is the conjunction over §21's verified items.
 *
 * Takes the set of items verified so far, so the caller cannot pass a summary
 * judgement — the same posture as §22.8's findings, and for the same reason:
 * a boolean supplied by a caller is a claim, and a set compared against a
 * register is a fact.
 */
export function resolutionComplete(verifiedItems: readonly string[]): boolean {
  const verified = new Set(verifiedItems);
  return resolutionRequiredItems().every((item) => verified.has(item));
}

/** Which of §22.11's five areas are still outstanding, in register order. */
export function unresolvedAreas(verifiedItems: readonly string[]): ResolutionAreaKey[] {
  const verified = new Set(verifiedItems);
  return RESOLUTION_AREAS.filter(
    (area) => !area.reconciliationItems.every((item) => verified.has(item)),
  ).map((area) => area.key);
}
