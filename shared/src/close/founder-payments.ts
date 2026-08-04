/**
 * The Founder W-9 and payment schedule — Spec §22.3, §24.5, §23.3 (Phase 19b).
 *
 * The registers and pure kernels only. The backend gathers the campaign's
 * captured ledger, the §22.1 finalized Creator compensation, the W-9 record,
 * and the recorded early-release evidence, and these decide — the same
 * arrangement as `earnings.ts` (19a) and `deriveCreatorReadiness` (§16).
 *
 * ── The eligible share READS 19a's finalized amounts ────────────────────────
 * §22.3: eligible Founder share = captured pre-tax reward subtotal − Proovd 5%
 * − Creator percentage compensation − applicable cause-based adjustments −
 * Stripe fees allocated to the Founder under the approved configuration. The
 * Creator compensation term is the §22.1 FINALIZED earned total (commission +
 * bonus) — never recomputed here, because §24.3 permits one implementation of
 * every percentage and 19a already ran it. The fixed Creator payment never
 * appears: it is §24.7's separate stream, funded by its own charge, and was
 * never inside the Backer subtotal. Sales tax has no field in the input type —
 * §22.3's own last sentence ("Tax is separate."), §24.3's structural exclusion.
 *
 * ── The §3.2 money-status words never appear here ───────────────────────────
 * §22.3 forbids the §3.2 account euphemisms wherever `eligible`, `blocked`,
 * or `released` is accurate. The status vocabulary is 16a's `MONEY_STATUSES` —
 * this module adds no fourth word and no synonym, and the suite scans this
 * file for the banned list.
 */

import { MoneyRuleError } from '../money/errors.js';
import { assertCents, assertPercent, percentOfCents, type Cents } from '../money/cents.js';

/* ── §22.3: the W-9 record ─────────────────────────────────────────────────── */

/**
 * Three states, not a boolean. §22.3 asks the Founder payment status to show
 * "submitted/verified state" and `No action needed` while under review — so
 * requested (the Founder owes the form), submitted (Proovd owes the review),
 * and verified are three different answers to "whose move is it".
 */
export const W9_STATUSES = ['requested', 'submitted', 'verified'] as const;
export type W9Status = (typeof W9_STATUSES)[number];

/**
 * `submitted → requested` is the resubmission path: a form Proovd could not
 * verify goes back to the Founder with the reason recorded. `verified` is
 * terminal — payments were made on its basis, so un-verifying it would rewrite
 * the ground a released payment stood on; a later problem is an enforcement
 * act with its own record, never an edit here.
 */
export const W9_STATE_TRANSITIONS: Readonly<Record<W9Status, readonly W9Status[]>> = {
  requested: ['submitted'],
  submitted: ['verified', 'requested'],
  verified: [],
};

export function canMoveW9State(from: W9Status, to: W9Status): boolean {
  return W9_STATE_TRANSITIONS[from].includes(to);
}

/**
 * §22.3's "secure action", pinned. The W-9 travels through the
 * context-preserving support route and Proovd records receipt and
 * verification; no Proovd surface collects the form itself and no Proovd
 * column can take a taxpayer identification number (§11: never duplicate the
 * sensitive data the provider keeps — enforced by the same CHECK shape as the
 * 10b tax-accountability record).
 */
export const W9_SECURE_ACTION =
  'Follow the secure W-9 submission instructions in your W-9 request message — Proovd records receipt and verification, and never stores your tax identification number.';

/** §11's exact phrase, restated where §22.3 requires it "while under review". */
export const W9_NO_ACTION_NEEDED = 'No action needed';

/** The Founder-facing line and action for each W-9 state (§22.3, §27.1). */
export const W9_STATE_LINES: Readonly<
  Record<W9Status, { line: string; action: string }>
> = {
  requested: {
    line: 'Proovd has requested your W-9. No Founder payment can be made until it is received and verified.',
    action: W9_SECURE_ACTION,
  },
  submitted: {
    line: 'Your W-9 was received and is under review.',
    action: W9_NO_ACTION_NEEDED,
  },
  verified: {
    line: 'Your W-9 is verified.',
    action: W9_NO_ACTION_NEEDED,
  },
};

/* ── §22.3: the payment schedule ───────────────────────────────────────────── */

/**
 * §3.1: these are internal names. A Founder reads the labels below; the
 * internal keys never render to a Founder or Backer.
 */
export const FOUNDER_PAYMENT_KINDS = [
  'single_payment',
  'first_payment',
  'remaining_payment',
] as const;
export type FounderPaymentKind = (typeof FOUNDER_PAYMENT_KINDS)[number];

/** §3.1's customer-facing names, the only ones a Founder surface may render. */
export const FOUNDER_PAYMENT_KIND_LABELS: Readonly<Record<FounderPaymentKind, string>> = {
  single_payment: 'Single Founder payment',
  first_payment: 'First payment',
  remaining_payment: 'Remaining payment',
};

export interface FounderPaymentScheduleEntry {
  kind: FounderPaymentKind;
  /** The §6 settings that govern it — read at decision time, never hardcoded. */
  daySettingKey: string;
  percentSettingKey: string;
  /** §22.3's own numbers — the seed defaults the §6 register carries. */
  defaultDay: number;
  defaultPercent: number;
  /**
   * `percent` computes the amount from the eligible share; `remainder` is the
   * exact rest after the first payment — "remaining" is the rule, so no cent
   * is lost to two independent floors (§24.3's remainder pattern).
   */
  amountRule: 'percent' | 'remainder';
}

/**
 * §22.3's two schedules. Idea: one `single_payment` object only — Day 14 is
 * fulfillment/enforcement review and creates no second payment (§33.8.10).
 * Product: first at Day 3, remaining at Day 14 by default (§33.8.11).
 */
export const FOUNDER_PAYMENT_SCHEDULES: Readonly<
  Record<'idea' | 'product', readonly FounderPaymentScheduleEntry[]>
> = {
  idea: [
    {
      kind: 'single_payment',
      daySettingKey: 'idea_single_payment_day',
      percentSettingKey: 'idea_single_payment_percent',
      defaultDay: 3,
      defaultPercent: 100,
      amountRule: 'percent',
    },
  ],
  product: [
    {
      kind: 'first_payment',
      daySettingKey: 'product_first_payment_day',
      percentSettingKey: 'product_first_payment_percent',
      defaultDay: 3,
      defaultPercent: 40,
      amountRule: 'percent',
    },
    {
      kind: 'remaining_payment',
      daySettingKey: 'product_remaining_payment_day',
      percentSettingKey: 'product_remaining_payment_percent',
      defaultDay: 14,
      defaultPercent: 60,
      amountRule: 'remainder',
    },
  ],
};

/** The §6 key gating early remaining release — disabled by default (§22.3). */
export const EARLY_REMAINING_SETTING_KEY = 'product_early_remaining_payment_enabled';

/* ── §22.3: the eligible Founder share ─────────────────────────────────────── */

export interface EligibleFounderShareInput {
  rewardSubtotalCapturedCents: Cents;
  proovdFeeCents: Cents;
  /**
   * The §22.1 FINALIZED Creator percentage compensation — commission + earned
   * bonus, read from the finalization records (19a), never recomputed.
   */
  finalizedCreatorCompensationCents: Cents;
  /** §24.8's cause-based allocation records. Phase 20 writes them; until then
      the only honest value is the sum of the records that exist: zero. */
  causeBasedAdjustmentsCents: Cents;
  /** §24.5: the fees allocated to the Founder under the approved
      configuration, as the capture ledger recorded them. */
  stripeFeesAllocatedToFounderCents: Cents;
}

/** §22.3's own last sentence, rendered wherever the share is (§27.1). */
export const FOUNDER_SHARE_TAX_NOTE =
  'Sales tax is separate: it is excluded from every percentage and never part of the Founder share (§24.3).';

/**
 * §22.3's formula, stated as one subtraction so a service cannot quietly drop
 * a term. A negative result is a ledger that does not balance — thrown, never
 * clamped, because clamping would hide the reconciliation failure §26.6
 * exists to catch.
 */
export function eligibleFounderShareCents(input: EligibleFounderShareInput): Cents {
  assertCents(input.rewardSubtotalCapturedCents, 'rewardSubtotalCapturedCents');
  assertCents(input.proovdFeeCents, 'proovdFeeCents');
  assertCents(input.finalizedCreatorCompensationCents, 'finalizedCreatorCompensationCents');
  assertCents(input.causeBasedAdjustmentsCents, 'causeBasedAdjustmentsCents');
  assertCents(input.stripeFeesAllocatedToFounderCents, 'stripeFeesAllocatedToFounderCents');

  const share =
    input.rewardSubtotalCapturedCents -
    input.proovdFeeCents -
    input.finalizedCreatorCompensationCents -
    input.causeBasedAdjustmentsCents -
    input.stripeFeesAllocatedToFounderCents;
  if (share < 0n) {
    throw new MoneyRuleError(
      `eligible Founder share is negative (${share}) — the ledger does not balance (§22.3, §26.6)`,
    );
  }
  return share;
}

/**
 * The amount of one scheduled payment. `single_payment`/`first_payment` take
 * their percentage of the eligible share (floor, matching every §24.3
 * percentage); `remaining_payment` is the exact remainder after the first, so
 * first + remaining = eligible share holds to the cent (§33.8.11).
 */
export function founderPaymentAmountCents(input: {
  kind: FounderPaymentKind;
  eligibleShareCents: Cents;
  percent: number;
  /** Required for `remaining_payment` — the first payment's recorded amount. */
  firstPaymentCents?: Cents | undefined;
}): Cents {
  assertCents(input.eligibleShareCents, 'eligibleShareCents');
  assertPercent(input.percent, 100, 'percent');

  if (input.kind === 'remaining_payment') {
    if (input.firstPaymentCents === undefined) {
      throw new MoneyRuleError(
        'remaining_payment needs the first payment amount — "remaining" is the exact rest (§22.3)',
      );
    }
    assertCents(input.firstPaymentCents, 'firstPaymentCents');
    if (input.firstPaymentCents > input.eligibleShareCents) {
      throw new MoneyRuleError(
        `first payment ${input.firstPaymentCents} exceeds the eligible share ${input.eligibleShareCents} (§22.3)`,
      );
    }
    return input.eligibleShareCents - input.firstPaymentCents;
  }
  return percentOfCents(input.eligibleShareCents, input.percent);
}

/* ── §22.3: what the Founder payment status must show ──────────────────────── */

/**
 * §22.3's display contract, as a register the §33.8.13 consistency pass walks:
 * every money surface must answer all six, identically.
 */
export const FOUNDER_PAYMENT_STATUS_FACTS = [
  { key: 'exact_amount_affected', spec: '§22.3: the exact amount affected' },
  { key: 'requirement_or_blocker', spec: '§22.3: the requirement or blocker, named' },
  { key: 'secure_action', spec: '§22.3: a secure action' },
  { key: 'submitted_verified_state', spec: '§22.3: submitted and verified state' },
  { key: 'next_review_date', spec: '§22.3: the next review date' },
  {
    key: 'no_action_needed_under_review',
    spec: '§22.3: `No action needed` while under review',
  },
] as const;

/* ── §22.3: early remaining release ────────────────────────────────────────── */

/**
 * The four recorded proofs, all four, each with its evidence detail — the
 * §31.7 seller-tax-readiness shape, because §22.3 names four separate things
 * and a single flag would let three-quarters read as done. The first carries
 * §22.3's own warning: internal readiness alone is insufficient.
 */
export const EARLY_RELEASE_EVIDENCE_FACTS = [
  {
    key: 'delivery_available',
    label: 'The promised reward or access is actually available to affected Backers',
    note: 'Internal readiness alone is insufficient (§22.3) — this is proof of what affected Backers can actually reach, not of what is ready internally.',
  },
  {
    key: 'communication_sent',
    label: 'The required communication was sent',
    note: null,
  },
  {
    key: 'tax_payment_complete',
    label: 'Tax and payment requirements are complete',
    note: null,
  },
  {
    key: 'no_immediate_risk',
    label: 'No immediate risk flag exists',
    note: null,
  },
] as const;

export type EarlyReleaseEvidenceFactKey = (typeof EARLY_RELEASE_EVIDENCE_FACTS)[number]['key'];

/**
 * §22.3's sentence, pinned — rendered on the early-release decision, the
 * release notice, and the Founder payment status, because an early release
 * that reads as "done" is exactly how the Day 14 review gets skipped in
 * practice (§33.8.12).
 */
export const EARLY_RELEASE_NEVER_SKIPS_DAY_14 =
  'Early release does not skip the Day 14 status review or your ongoing delivery, refund, and support duties.';
