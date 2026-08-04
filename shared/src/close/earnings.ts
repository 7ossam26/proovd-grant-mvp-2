/**
 * Creator completion, earnings finalization, the one Transfer, and the
 * discretionary thank-you — Spec §22.1, §22.2, §24.4 (Phase 19a).
 *
 * The registers and pure kernels only. The backend gathers each association's
 * captured attributed rows, its locked agreement, its bonus terms, and the
 * recorded §22.1 completion decision, and these decide — so §33.8.5–§33.8.7
 * are assertable as facts over a snapshot rather than as a simulated network,
 * the same arrangement as `deriveCreatorReadiness` (§16) and `decideItems`
 * (§12).
 *
 * ── The five §22.1 cases are a register, not a switch in a service ──────────
 * Four are decision outcomes an Admin records; the fifth — "no fixed
 * arrangement: commission only" — is the *absence* of an allocation, not a
 * different decision, so it is a parameter of `completionConsequence` rather
 * than a fifth row. A consequence written as prose in a service would be a
 * consequence nobody can drift-test against the Spec's own table.
 *
 * ── Money never appears here that §24.3 did not define ──────────────────────
 * Commission uses the locked percentage over the captured, VALIDLY attributed,
 * pre-tax reward subtotal; the bonus uses only that Creator's captured results
 * (§14.3's filter, already the only way a bonus sees money); the combined
 * percentage never exceeds the stored maximum or the §6 ceiling. Sales tax has
 * no field in any input type — §24.3's structural exclusion, restated.
 */

import { MoneyRuleError } from '../money/errors.js';
import { assertCents, assertPercent, percentOfCents, type Cents } from '../money/cents.js';
import type { BonusTriggerUnit } from '../money/attribution.js';
import { type EarningsState } from '../live/earnings.js';

/* ── §22.1: the completion outcomes ────────────────────────────────────────── */

export type CompletionOutcomeKey =
  | 'no_valid_post'
  | 'valid_post_later_incomplete'
  | 'complete_verified'
  | 'disqualified';

export interface CompletionOutcomeDefinition {
  key: CompletionOutcomeKey;
  /** The §22.1 case this implements, in the Spec's own words. */
  spec: string;
  /** What happens to a funded fixed allocation, when one exists. */
  fixedDisposition: 'return_full' | 'eligible_full' | 'cancel_or_recover';
  /** Whether genuine commission from compliant captured attributed sales remains. */
  commissionDisposition: 'none' | 'genuine';
}

/**
 * §22.1's fixed-payment outcome table, row for row. The tempting simplification
 * on the second row — cancel everything — is exactly what §33.8.6 forbids: a
 * valid compliant attributed post with incomplete later work returns the fixed
 * amount but KEEPS genuine commission. And the third row is §33.8.7: sales
 * performance is not a completion criterion.
 */
export const COMPLETION_OUTCOMES = [
  {
    key: 'no_valid_post',
    spec: '§22.1: No valid compliant post — return 100% of the fixed allocation; no commission.',
    fixedDisposition: 'return_full',
    commissionDisposition: 'none',
  },
  {
    key: 'valid_post_later_incomplete',
    spec: '§22.1: At least one valid compliant attributed post, later deliverables incomplete — return 100% of the allocation; genuine commission from compliant captured attributed sales may remain.',
    fixedDisposition: 'return_full',
    commissionDisposition: 'genuine',
  },
  {
    key: 'complete_verified',
    spec: '§22.1: All deliverables complete and verified — full fixed amount is eligible even if sales were poor.',
    fixedDisposition: 'eligible_full',
    commissionDisposition: 'genuine',
  },
  {
    key: 'disqualified',
    spec: '§22.1: Fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach — cancel unpaid invalid amounts; if already transferred, create a negative balance and contractual recovery record.',
    fixedDisposition: 'cancel_or_recover',
    commissionDisposition: 'none',
  },
] as const satisfies readonly CompletionOutcomeDefinition[];

export function findCompletionOutcome(
  key: CompletionOutcomeKey,
): CompletionOutcomeDefinition {
  const found = COMPLETION_OUTCOMES.find((outcome) => outcome.key === key);
  if (!found) throw new MoneyRuleError(`unknown §22.1 completion outcome: ${key}`);
  return found;
}

export interface CompletionConsequence {
  /** `not_applicable` is §22.1's fifth case: no fixed arrangement, commission only. */
  fixed: 'return_full' | 'eligible_full' | 'cancel_or_recover' | 'not_applicable';
  commission: 'none' | 'genuine';
}

/**
 * The §22.1 matrix as one pure decision: the recorded outcome crossed with
 * whether a fixed arrangement exists for this Creator.
 */
export function completionConsequence(
  outcome: CompletionOutcomeKey,
  hasFixedArrangement: boolean,
): CompletionConsequence {
  const definition = findCompletionOutcome(outcome);
  return {
    fixed: hasFixedArrangement ? definition.fixedDisposition : 'not_applicable',
    commission: definition.commissionDisposition,
  };
}

/* ── §22.1: the earned percentage ──────────────────────────────────────────── */

export interface EarnedBonusTerms {
  triggerUnit: BonusTriggerUnit;
  /** Cents for the subtotal unit, a count for the unique-Backer unit. */
  threshold: bigint;
  additionalPercent: number;
  maxCombinedPercent: number;
}

/**
 * §14.3/§22.1: the bonus triggers on this Creator's own captured, validly
 * attributed results — measured against the stored threshold, nothing else.
 */
export function bonusTriggered(
  terms: EarnedBonusTerms,
  measured: { validSubtotalCents: Cents; uniqueBackers: number },
): boolean {
  if (terms.threshold < 0n) {
    throw new MoneyRuleError(`bonus threshold must be >= 0, got ${terms.threshold}`);
  }
  const value =
    terms.triggerUnit === 'attributed_subtotal_cents'
      ? measured.validSubtotalCents
      : BigInt(measured.uniqueBackers);
  return value >= terms.threshold;
}

export interface EarnedPercentResult {
  /** The bonus percentage actually earned — 0 when not triggered. */
  earnedBonusPercent: number;
  /**
   * locked + earned bonus, bounded by the bonus's own stored maximum and the
   * §6 ceiling (§22.1: "Total percentage never exceeds 50%").
   */
  earnedPercent: number;
}

export function earnedPercentFor(input: {
  lockedTotalPercent: number;
  bonus: EarnedBonusTerms | null;
  bonusTriggered: boolean;
  ceilingPercent: number;
}): EarnedPercentResult {
  assertPercent(input.ceilingPercent, 100, 'ceilingPercent');
  assertPercent(input.lockedTotalPercent, input.ceilingPercent, 'lockedTotalPercent');

  const earnedBonusPercent =
    input.bonus && input.bonusTriggered ? input.bonus.additionalPercent : 0;
  let combined = input.lockedTotalPercent + earnedBonusPercent;
  if (input.bonus) {
    assertPercent(input.bonus.additionalPercent, input.ceilingPercent, 'additionalPercent');
    assertPercent(input.bonus.maxCombinedPercent, input.ceilingPercent, 'maxCombinedPercent');
    combined = Math.min(combined, input.bonus.maxCombinedPercent);
  }
  return { earnedBonusPercent, earnedPercent: Math.min(combined, input.ceilingPercent) };
}

/* ── §24.4: per-reservation earned/unearned reconciliation ─────────────────── */

/**
 * One captured reservation attributed to this Creator, as the ledger stored it
 * at capture. `validlyAttributed` is the §18/§22.1 verification result — a
 * charge whose attribution did not verify earns nothing, and its whole
 * provisional amount returns.
 */
export interface AttributedCaptureRow {
  reservationId: string;
  rewardSubtotalCents: Cents;
  /** What capture provisioned on this row (the maximum, §24.4). */
  provisionalCents: Cents;
  validlyAttributed: boolean;
}

export interface FinalizedRow {
  reservationId: string;
  earnedCents: Cents;
  unearnedReturnedCents: Cents;
}

export interface FinalizedEarnings {
  perRow: FinalizedRow[];
  /** Σ subtotal over the validly attributed rows — what percentages apply to. */
  validSubtotalCents: Cents;
  provisionalTotalCents: Cents;
  earnedTotalCents: Cents;
  unearnedReturnedTotalCents: Cents;
  /** The locked-percentage portion of the earned total (§22.1 "finalized commission"). */
  commissionCents: Cents;
  /** The bonus portion — the exact remainder, so the two always sum to earned. */
  bonusCents: Cents;
}

/**
 * §24.4's reconciliation, row by row: the earned percentage applied to each
 * validly attributed captured subtotal, everything else returned. Row identity
 * `earned + returned = provisional` holds per reservation and therefore in the
 * aggregate — which is what makes the §26.6 `provisionalReconciles` comparison
 * a fact rather than a hope. Floor-rounding matches capture's: each row rounds
 * down independently, so `earned_i ≤ provisional_i` because the earned
 * percentage never exceeds the provisioned maximum on the same subtotal.
 */
export function finalizeEarningsRows(input: {
  commission: 'none' | 'genuine';
  earnedPercent: number;
  lockedTotalPercent: number;
  ceilingPercent: number;
  rows: readonly AttributedCaptureRow[];
}): FinalizedEarnings {
  assertPercent(input.ceilingPercent, 100, 'ceilingPercent');
  assertPercent(input.earnedPercent, input.ceilingPercent, 'earnedPercent');
  assertPercent(input.lockedTotalPercent, input.ceilingPercent, 'lockedTotalPercent');
  if (input.lockedTotalPercent > input.earnedPercent && input.commission === 'genuine') {
    throw new MoneyRuleError(
      'earnedPercent below the locked percentage — the earned percentage includes the locked portion (§22.1)',
    );
  }

  const perRow: FinalizedRow[] = [];
  let validSubtotalCents = 0n;
  let provisionalTotalCents = 0n;
  let earnedTotalCents = 0n;
  let commissionCents = 0n;

  for (const row of input.rows) {
    assertCents(row.rewardSubtotalCents, 'rewardSubtotalCents');
    assertCents(row.provisionalCents, 'provisionalCents');
    provisionalTotalCents += row.provisionalCents;

    const earns = input.commission === 'genuine' && row.validlyAttributed;
    const earnedCents = earns ? percentOfCents(row.rewardSubtotalCents, input.earnedPercent) : 0n;
    if (earnedCents > row.provisionalCents) {
      throw new MoneyRuleError(
        `earned ${earnedCents} exceeds provisional ${row.provisionalCents} on reservation ${row.reservationId} — the provisional percentage was not the maximum owed (§24.4)`,
      );
    }
    if (earns) {
      validSubtotalCents += row.rewardSubtotalCents;
      commissionCents += percentOfCents(row.rewardSubtotalCents, input.lockedTotalPercent);
    }
    earnedTotalCents += earnedCents;
    perRow.push({
      reservationId: row.reservationId,
      earnedCents,
      unearnedReturnedCents: row.provisionalCents - earnedCents,
    });
  }

  return {
    perRow,
    validSubtotalCents,
    provisionalTotalCents,
    earnedTotalCents,
    unearnedReturnedTotalCents: provisionalTotalCents - earnedTotalCents,
    commissionCents,
    bonusCents: earnedTotalCents - commissionCents,
  };
}

/* ── §22.1: the one Transfer ───────────────────────────────────────────────── */

/**
 * §22.1: "Admin creates one campaign-specific Affiliate Transfer on or after
 * Day 3." The anchor is `campaign_close_at` (§21's own anchor); §6 names no
 * setting for this day, so the Spec's number is the value.
 */
export const TRANSFER_EARLIEST_DAY = 3;

/**
 * §33.8.3: the one Transfer combines finalized commission, earned bonus, and
 * the eligible fixed amount. Stated as an identity so a service cannot quietly
 * transfer a different total.
 */
export function transferTotalCents(components: {
  commissionCents: Cents;
  bonusCents: Cents;
  eligibleFixedCents: Cents;
}): Cents {
  assertCents(components.commissionCents, 'commissionCents');
  assertCents(components.bonusCents, 'bonusCents');
  assertCents(components.eligibleFixedCents, 'eligibleFixedCents');
  return components.commissionCents + components.bonusCents + components.eligibleFixedCents;
}

/* ── Appendix B.7: the earnings-state machine (§22.1) ──────────────────────── */

/**
 * The seven states are `shared/live/earnings.ts`'s (Phase 17b rendered them);
 * Phase 19 gives them their transitions. `payout_failed` routes to the
 * Stripe-managed update path and back (§22.1); `adjusted` is the §22.1 fraud
 * case discovered at any point after finalization, and is terminal — the
 * negative balance and contractual recovery record carry what follows.
 * A synchronous Transfer-creation failure is NOT a state change: §32.3 makes
 * it a recorded retry-job case, and the amount stays `approved_for_transfer`
 * with the retry named as its reason.
 */
export const EARNINGS_STATE_TRANSITIONS: Readonly<Record<EarningsState, readonly EarningsState[]>> = {
  estimated: ['finalized'],
  finalized: ['approved_for_transfer', 'adjusted'],
  approved_for_transfer: ['transferred', 'adjusted'],
  transferred: ['paid_out', 'payout_failed', 'adjusted'],
  payout_failed: ['paid_out', 'adjusted'],
  paid_out: ['adjusted'],
  adjusted: [],
};

export function canMoveEarningsState(from: EarningsState, to: EarningsState): boolean {
  return EARNINGS_STATE_TRANSITIONS[from].includes(to);
}

/* ── §22.2: the discretionary thank-you ────────────────────────────────────── */

/**
 * §22.2's funding source, pinned. There is exactly one permitted source and it
 * is not a choice a caller makes — a parameterized source would be a route to
 * funding it from a campaign balance.
 */
export const THANK_YOU_FUNDING_SOURCE = 'proovd_retained_listing_fee_revenue';

export const THANK_YOU_FUNDING_SOURCE_STATEMENT =
  'Funded only from Proovd’s retained listing-fee revenue, after all refund rights resolve. Never deducted from Backer charges, the Founder share, Creator commission, or the fixed allocation (§22.2).';

/** §22.2: "the agreed minimum work, default three posts". */
export const THANK_YOU_DEFAULT_MINIMUM_POSTS = 3;

/**
 * §22.2's three eligibility facts. Each is an Admin-confirmed fact recorded
 * with the decision — never computed, because a computation is an estimate and
 * §22.2 forbids the product estimating this payment. There is no scoring
 * function over these on purpose.
 */
export const THANK_YOU_ELIGIBILITY_FACTS = [
  {
    key: 'minimum_work_completed',
    label: 'Completed the agreed minimum work (default three posts)',
  },
  { key: 'click_threshold_met', label: 'Met the campaign click threshold' },
  { key: 'brand_aup_compliant', label: 'Complied with brand and AUP rules' },
] as const;

export type ThankYouEligibilityFactKey = (typeof THANK_YOU_ELIGIBILITY_FACTS)[number]['key'];

/**
 * §22.2: "If the approval or path is absent, Admin may record recognition but
 * cannot promise or send money." Two kinds, one table — recognition carries no
 * amount and no provider object, and the database refuses the mixture.
 */
export const THANK_YOU_KINDS = ['recognition', 'payment'] as const;
export type ThankYouKind = (typeof THANK_YOU_KINDS)[number];
