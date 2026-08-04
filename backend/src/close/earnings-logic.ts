/**
 * The §22.1/§22.2/§24.4 earnings registers and kernels, restated for the
 * backend runtime — `shared/src/close/earnings.ts` owns them; the backend
 * cannot import `@proovd/shared` at runtime (the constraint `restated.ts`
 * documents), so they are restated verbatim here and the earnings suite
 * compares them value-for-value with the shared originals.
 *
 * The B.7 vocabulary (`EARNINGS_STATES`, labels, resolver) is NOT restated
 * again here — Phase 17b already restated it in `campaign/editing-logic.ts`
 * and a second backend copy would be exactly the drift these files exist to
 * prevent. Import it from there.
 */

import { percentOfCents } from './logic.js';
import type { EarningsState } from '../campaign/editing-logic.js';

/* ── §22.1: the completion outcomes ────────────────────────────────────────── */

export type CompletionOutcomeKey =
  | 'no_valid_post'
  | 'valid_post_later_incomplete'
  | 'complete_verified'
  | 'disqualified';

export interface CompletionOutcomeDefinition {
  key: CompletionOutcomeKey;
  spec: string;
  fixedDisposition: 'return_full' | 'eligible_full' | 'cancel_or_recover';
  commissionDisposition: 'none' | 'genuine';
}

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

export const COMPLETION_OUTCOME_KEYS = COMPLETION_OUTCOMES.map((o) => o.key);

export function findCompletionOutcome(key: CompletionOutcomeKey): CompletionOutcomeDefinition {
  const found = COMPLETION_OUTCOMES.find((outcome) => outcome.key === key);
  if (!found) throw new Error(`unknown §22.1 completion outcome: ${key}`);
  return found;
}

export interface CompletionConsequence {
  fixed: 'return_full' | 'eligible_full' | 'cancel_or_recover' | 'not_applicable';
  commission: 'none' | 'genuine';
}

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
  triggerUnit: 'attributed_subtotal_cents' | 'unique_attributed_backers';
  threshold: bigint;
  additionalPercent: number;
  maxCombinedPercent: number;
}

export function bonusTriggered(
  terms: EarnedBonusTerms,
  measured: { validSubtotalCents: bigint; uniqueBackers: number },
): boolean {
  if (terms.threshold < 0n) {
    throw new Error(`bonus threshold must be >= 0, got ${terms.threshold}`);
  }
  const value =
    terms.triggerUnit === 'attributed_subtotal_cents'
      ? measured.validSubtotalCents
      : BigInt(measured.uniqueBackers);
  return value >= terms.threshold;
}

export interface EarnedPercentResult {
  earnedBonusPercent: number;
  earnedPercent: number;
}

function assertPercentIn(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer in [0, ${max}], got ${value}`);
  }
}

export function earnedPercentFor(input: {
  lockedTotalPercent: number;
  bonus: EarnedBonusTerms | null;
  bonusTriggered: boolean;
  ceilingPercent: number;
}): EarnedPercentResult {
  assertPercentIn(input.ceilingPercent, 100, 'ceilingPercent');
  assertPercentIn(input.lockedTotalPercent, input.ceilingPercent, 'lockedTotalPercent');

  const earnedBonusPercent =
    input.bonus && input.bonusTriggered ? input.bonus.additionalPercent : 0;
  let combined = input.lockedTotalPercent + earnedBonusPercent;
  if (input.bonus) {
    assertPercentIn(input.bonus.additionalPercent, input.ceilingPercent, 'additionalPercent');
    assertPercentIn(input.bonus.maxCombinedPercent, input.ceilingPercent, 'maxCombinedPercent');
    combined = Math.min(combined, input.bonus.maxCombinedPercent);
  }
  return { earnedBonusPercent, earnedPercent: Math.min(combined, input.ceilingPercent) };
}

/* ── §24.4: per-reservation earned/unearned reconciliation ─────────────────── */

export interface AttributedCaptureRow {
  reservationId: string;
  rewardSubtotalCents: bigint;
  provisionalCents: bigint;
  validlyAttributed: boolean;
}

export interface FinalizedRow {
  reservationId: string;
  earnedCents: bigint;
  unearnedReturnedCents: bigint;
}

export interface FinalizedEarnings {
  perRow: FinalizedRow[];
  validSubtotalCents: bigint;
  provisionalTotalCents: bigint;
  earnedTotalCents: bigint;
  unearnedReturnedTotalCents: bigint;
  commissionCents: bigint;
  bonusCents: bigint;
}

export function finalizeEarningsRows(input: {
  commission: 'none' | 'genuine';
  earnedPercent: number;
  lockedTotalPercent: number;
  ceilingPercent: number;
  rows: readonly AttributedCaptureRow[];
}): FinalizedEarnings {
  assertPercentIn(input.ceilingPercent, 100, 'ceilingPercent');
  assertPercentIn(input.earnedPercent, input.ceilingPercent, 'earnedPercent');
  assertPercentIn(input.lockedTotalPercent, input.ceilingPercent, 'lockedTotalPercent');
  if (input.lockedTotalPercent > input.earnedPercent && input.commission === 'genuine') {
    throw new Error(
      'earnedPercent below the locked percentage — the earned percentage includes the locked portion (§22.1)',
    );
  }

  const perRow: FinalizedRow[] = [];
  let validSubtotalCents = 0n;
  let provisionalTotalCents = 0n;
  let earnedTotalCents = 0n;
  let commissionCents = 0n;

  for (const row of input.rows) {
    provisionalTotalCents += row.provisionalCents;

    const earns = input.commission === 'genuine' && row.validlyAttributed;
    const earnedCents = earns ? percentOfCents(row.rewardSubtotalCents, input.earnedPercent) : 0n;
    if (earnedCents > row.provisionalCents) {
      throw new Error(
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

export const TRANSFER_EARLIEST_DAY = 3;

export function transferTotalCents(components: {
  commissionCents: bigint;
  bonusCents: bigint;
  eligibleFixedCents: bigint;
}): bigint {
  for (const [label, value] of Object.entries(components)) {
    if (value < 0n) throw new Error(`${label} must be >= 0 cents, got ${value}`);
  }
  return components.commissionCents + components.bonusCents + components.eligibleFixedCents;
}

/* ── Appendix B.7: the earnings-state machine (§22.1) ──────────────────────── */

export const EARNINGS_STATE_TRANSITIONS: Readonly<
  Record<EarningsState, readonly EarningsState[]>
> = {
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

export const THANK_YOU_FUNDING_SOURCE = 'proovd_retained_listing_fee_revenue';

export const THANK_YOU_FUNDING_SOURCE_STATEMENT =
  'Funded only from Proovd’s retained listing-fee revenue, after all refund rights resolve. Never deducted from Backer charges, the Founder share, Creator commission, or the fixed allocation (§22.2).';

export const THANK_YOU_DEFAULT_MINIMUM_POSTS = 3;

export const THANK_YOU_ELIGIBILITY_FACTS = [
  {
    key: 'minimum_work_completed',
    label: 'Completed the agreed minimum work (default three posts)',
  },
  { key: 'click_threshold_met', label: 'Met the campaign click threshold' },
  { key: 'brand_aup_compliant', label: 'Complied with brand and AUP rules' },
] as const;

export type ThankYouEligibilityFactKey = (typeof THANK_YOU_ELIGIBILITY_FACTS)[number]['key'];

export const THANK_YOU_KINDS = ['recognition', 'payment'] as const;
export type ThankYouKind = (typeof THANK_YOU_KINDS)[number];

/* ── §22.3's vocabulary, used by the B.7 reason lines (Phase 16a's rule) ───── */

/**
 * `shared/admin`'s banned money-status words, restated — 16a restated
 * `MONEY_STATUSES` but not the ban list, and Phase 19 is the first backend
 * code that composes customer-facing money reasons at runtime. Never a §3.2
 * word where `eligible`, `blocked`, or `released` is accurate (§22.3).
 */
export const BANNED_MONEY_STATUS_WORDS = [
  'held',
  'holding',
  'on hold',
  'in escrow',
  'escrowed',
  'in trust',
] as const;
