/**
 * The Money & Fulfillment console — Spec §21, §22.1–§22.7, §24.8, §24.11, §26.6.
 *
 * The Campaigns hub has named this destination since it was built and carried
 * `absentBecause: 'Money console not built yet — the amounts here come from its
 * records.'` This is that console, and the sentence it replaces is the promise
 * it has to keep: every number here is READ from the record the service wrote,
 * so the hub and this page cannot disagree.
 *
 * ── It operates services; it owns none ──────────────────────────────────────
 * §21's batch, §22.1's four money acts, §22.2's thank-you, §22.3's W-9 and
 * payment schedule, §24.8's cause-classified refund, §24.11's dispute, and
 * §22.4–§22.7's Day 14 and ban are all built, acceptance-tested, and idempotent.
 * The console CALLS them. There is no arithmetic in this feature, no second
 * eligibility rule, and no branch that decides an outcome — a control that
 * computed a Transfer amount would be a second answer to a question the §24.4
 * identity already has one answer to.
 *
 * That is also why `MONEY_OPERATIONS_ABSENCES` exists. The controls an operator
 * would reach for and must not find are named here with the rule that refuses
 * each, and the surface renders those sentences where the control would have
 * been — so re-adding one means deleting the sentence that says why it cannot
 * exist. The `AFFILIATE_OPERATIONS_ABSENCES` arrangement, applied to money.
 */

/* ── The record's tabs ──────────────────────────────────────────────────────*/

/**
 * Six views of ONE campaign's money, in the order the lifecycle runs.
 *
 * Close before reconciliation because §21 reconciles only after the window
 * shuts; creators before founder because §22.3's eligible share subtracts the
 * FINALIZED Creator compensation and a Founder payment refuses until every
 * provisioned cent has resolved. The order is the dependency, so an Admin who
 * works left to right never meets a refusal they could have avoided.
 */
export const MONEY_RECORD_TABS = [
  'close',
  'reconciliation',
  'creators',
  'founder',
  'refunds',
  'fulfillment',
] as const;

export type MoneyRecordTab = (typeof MONEY_RECORD_TABS)[number];

export const MONEY_RECORD_TAB_LABELS: Record<MoneyRecordTab, string> = {
  close: 'Close batch',
  reconciliation: 'Reconciliation & results',
  creators: 'Creator earnings',
  founder: 'Founder payment',
  refunds: 'Refunds & disputes',
  fulfillment: 'Fulfillment & Day 14',
};

/** What each tab is for, one line, rendered under its heading. */
export const MONEY_RECORD_TAB_BLURBS: Record<MoneyRecordTab, string> = {
  close:
    'The one close batch, the threshold decision it froze, every capture attempt, and the 48-hour window.',
  reconciliation:
    'The nine items a person verifies, and the results a Founder can only see once four of them are done.',
  creators:
    'Deliverables verified, earnings finalized, the amount approved, and the one Transfer.',
  founder: 'The W-9, what the Founder is owed, and what is holding it.',
  refunds: 'Refunds classified by cause, and disputes with their 24-hour task.',
  fulfillment: 'What was promised, what shipped, and the Day 14 check.',
};

/* ── The queue ──────────────────────────────────────────────────────────────*/

/**
 * The three groups, in §33.7.12's own order.
 *
 * "An incomplete batch is visibly recoverable" is the acceptance test, so the
 * incomplete batches lead — not the newest, not the largest. A retry window is
 * second because it has a deadline nobody can extend, and reconciliation last
 * because it waits on the window anyway.
 */
export const MONEY_QUEUE_GROUPS = ['incomplete', 'retryWindow', 'reconciling'] as const;
export type MoneyQueueGroup = (typeof MONEY_QUEUE_GROUPS)[number];

export const MONEY_QUEUE_GROUP_LABELS: Record<MoneyQueueGroup, string> = {
  incomplete: 'Interrupted — resume these first',
  retryWindow: 'Inside the 48-hour retry window',
  reconciling: 'Charges final — reconcile and prepare results',
};

export const MONEY_QUEUE_GROUP_BLURBS: Record<MoneyQueueGroup, string> = {
  incomplete:
    'The close batch stopped part-way. Reservations are still locked and no money has been double-moved — resuming runs the same machine the sweep runs, under the same keys.',
  retryWindow:
    'A card failed and the window is open. Recoveries inside it count as captured; anything still failing when it shuts closes at US$0.00.',
  reconciling:
    'Nothing more will be charged. Nine items get verified by a person, and four of them gate the results the Founder sees.',
};

export const MONEY_QUEUE_EMPTY = 'No campaign has close work outstanding.' as const;

/* ── The sentences the surface pins ─────────────────────────────────────────*/

/**
 * §33.7.12, stated where an Admin presses Resume.
 *
 * The guarantee is the stable attempt keys and the per-entity dedups, not this
 * console being careful — and saying so is what stops somebody "helping" by
 * adding a confirmation step that implies the opposite.
 */
export const RESUME_IS_THE_SAME_MACHINE =
  'Resuming runs the same batch the scheduled sweep runs. Every capture retries under the key it was first claimed with, so a resume cannot charge a card twice or send a second receipt.' as const;

/** §21: the threshold decision is frozen at close and the database refuses to move it. */
export const THRESHOLD_DECISION_IS_FROZEN =
  'This was decided from the state at exactly close and cannot be changed. A later payment failure moves the campaign into the retry window; it never reopens this.' as const;

/** §21, rendered wherever reconciliation is offered before it is open. */
export const RECONCILIATION_WAITS_FOR_THE_WINDOW =
  'Reconciliation begins only after the retry window closes.' as const;

/** §22.1's Day 3 anchor and the one-per-Creator rule, together. */
export const TRANSFER_IS_ONE_PER_CREATOR =
  'One Transfer per Creator, on or after Day 3 from close. A failed provider call is re-driven by the retry sweep under the same key — it is the same Transfer, not a second one.' as const;

/** §22.2: Admin may record recognition but cannot promise or send money. */
export const THANK_YOU_COMPUTES_NOTHING =
  'Nothing here suggests an amount. A thank-you payment is funded only from retained listing-fee revenue, needs the recorded tax and accounting approval, and is never drawn from campaign money.' as const;

/** §11, beside the W-9 receipt field. */
export const W9_REFERENCE_NEVER_HOLDS_A_TIN =
  'The reference names where the form is kept. It may never contain a taxpayer identification number.' as const;

/** §24.8, above the cause control. */
export const REFUND_CAUSE_DECIDES_THE_TREATMENT =
  'The cause decides which treatments may be recorded. Choosing it narrows the rest of this form, and the database refuses a combination the cause does not permit.' as const;

/** §26.6's third and fourth requirements, said once above the execute step. */
export const PREVIEW_BEFORE_EXECUTE =
  'A refund is previewed and then executed. The preview records the customer-visible consequences and is consumed exactly once, against the exact amount it was issued for.' as const;

/** §22.4: the Founder and the Admin read one checklist. */
export const DAY_14_IS_ONE_CHECKLIST =
  'The Founder sees this checklist and this evidence list. Both surfaces call one function, so there is no Admin-only item.' as const;

/* ── What this console deliberately does not offer ──────────────────────────*/

/**
 * Nine controls an operator would look for, and the rule that refuses each.
 *
 * Every sentence is rendered where the control would have been. A later session
 * that wants one back has to delete the sentence that refuses it, which is the
 * point — these are not gaps, and a blank space where a control might go says
 * nothing at all (§1.4).
 */
export interface MoneyOperationsAbsence {
  readonly key: string;
  /** The control the reference — or an operator's instinct — would put here. */
  readonly control: string;
  /** Which tab renders the refusal. */
  readonly tab: MoneyRecordTab;
  /** The sentence the surface shows. No Spec citation: an operator reads it. */
  readonly sentence: string;
  /** Why, for the next person reading this file. Never rendered. */
  readonly rule: string;
}

export const MONEY_OPERATIONS_ABSENCES = [
  {
    key: 'edit_threshold_decision',
    control: 'Change the threshold decision',
    tab: 'close',
    sentence:
      'The threshold decision cannot be edited. It was taken from the state at exactly close, and a campaign that missed does not become one that met.',
    rule: '§21 decides it once and migration 0028 makes it immutable by trigger — a service that offered this would be refused by the database anyway.',
  },
  {
    key: 'extend_retry_window',
    control: 'Extend the retry window',
    tab: 'close',
    sentence:
      'The 48-hour window cannot be extended or shortened. Its length was read from settings when the batch started and stored on the batch.',
    rule: '§29.6: a retry or an edit can never silently reset a deadline. 0028 CHECK-pins the deadline to first failure + the stored hours and refuses to move either.',
  },
  {
    key: 'force_capture',
    control: 'Capture now / capture all',
    tab: 'close',
    sentence:
      'There is no capture-now control. Resuming the batch attempts every reservation that is still due, under the key each was first claimed with.',
    rule: 'A bulk control beside an idempotent per-reservation machine is a second path into the money, and the only thing it could add is a way to skip a step.',
  },
  {
    key: 'delete_reconciliation',
    control: 'Remove or edit a recorded verification',
    tab: 'reconciliation',
    sentence:
      'A recorded verification stays. A discrepancy that is later resolved is recorded again, and both answers remain.',
    rule: '§21/§25.6: `campaign_reconciliations` is insert-only and the app role has no UPDATE or DELETE on it.',
  },
  {
    key: 'unprepare_results',
    control: 'Withdraw results',
    tab: 'reconciliation',
    sentence:
      'Results cannot be unsent. Once they are prepared the Founder has been told, and a correction is a new record rather than an erasure.',
    rule: '§33.7.11: `campaign_results` is insert-only and the `results_ready` flag is a §23.3 payment-flag row.',
  },
  {
    key: 'set_earnings_amount',
    control: 'Type an earnings amount',
    tab: 'creators',
    sentence:
      'Finalized amounts are not editable. They are computed once from the locked percentage over the validly attributed captured subtotal, and an adjustment is a refund case with its own recorded cause.',
    rule: '§24.4/§24.8: the amounts are trigger-immutable and `applyCauseBasedAffiliateAdjustment` is the one writer that can move them.',
  },
  {
    key: 'set_fixed_payment_outcome',
    control: 'Choose the fixed-payment outcome',
    tab: 'creators',
    sentence:
      'The fixed payment follows from the completion outcome. Recording the outcome is the whole decision — there is no second choice to make about the money.',
    rule: '§22.1: `completionConsequence(outcome, hasFixedArrangement)` is the matrix, and a separate control would let the two disagree.',
  },
  {
    key: 'skip_w9',
    control: 'Release without a verified W-9',
    tab: 'founder',
    sentence:
      'A Founder payment cannot exist without a verified W-9. There is no override, and a payment written by hand is refused by the database as well.',
    rule: '§22.3: `founder_payments.w9_record_id` is NOT NULL and 0031 refuses any row whose W-9 is not verified for its own campaign.',
  },
  {
    key: 'voluntary_refund',
    control: 'Issue a goodwill refund',
    tab: 'refunds',
    sentence:
      'Every refund is recorded against one of the defined causes. On an Idea campaign it additionally needs one of the eight exceptions, and there is no change-of-mind path.',
    rule: '§24.9: there is no `change_of_mind` value anywhere, so the voluntary refund has no representable row.',
  },
] as const satisfies readonly MoneyOperationsAbsence[];

export type MoneyAbsenceKey = (typeof MONEY_OPERATIONS_ABSENCES)[number]['key'];

/** The refusals one tab renders. */
export function moneyAbsencesFor(tab: MoneyRecordTab): readonly MoneyOperationsAbsence[] {
  return MONEY_OPERATIONS_ABSENCES.filter((a) => a.tab === tab);
}
