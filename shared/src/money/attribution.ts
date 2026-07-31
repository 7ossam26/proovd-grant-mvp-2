/**
 * Attribution-scoped results, Creator-specific bonuses, and the provisional
 * Affiliate amount — Spec §14.3, §24.4.
 *
 * §14.3: a Creator-specific bonus uses ONLY that Creator's successfully
 * captured, validly attributed, pre-tax reward subtotal or unique captured
 * attributed-Backer count. Whole-campaign, organic, house, or another
 * Creator's results cannot trigger it. That scoping lives here, in one place:
 * `creatorAttributedResults` is the only way a bonus sees money, and it
 * filters by attribution before anything is summed.
 */

import { PERCENTAGE_CEILING } from './constants.js';
import { assertCents, assertPercent, percentOfCents, type Cents } from './cents.js';
import { MoneyRuleError } from './errors.js';

/** How a captured charge was attributed at capture time. */
export type Attribution =
  | { kind: 'creator'; associationId: string }
  | { kind: 'organic' }
  | { kind: 'house' };

/**
 * The capture facts a bonus or provisional calculation may read. Pre-tax by
 * construction — there is no tax field, per the §24.3 structural exclusion.
 */
export interface CapturedCharge {
  rewardSubtotalCents: Cents;
  /** Successfully captured (§21: captured money, not saved reservations, drives revenue). */
  captured: boolean;
  /** Passed attribution validity verification (§14.3 "validly attributed"). */
  validlyAttributed: boolean;
  attribution: Attribution;
  backerId: string;
}

/** §14.3: trigger unit for a Creator-specific bonus. */
export type BonusTriggerUnit = 'attributed_subtotal_cents' | 'unique_attributed_backers';

/**
 * §14.3: store trigger unit, threshold, additional percentage, and maximum
 * combined percentage per bonus. (Proposal version and earned result are
 * persistence concerns of later phases.)
 */
export interface BonusTerms {
  triggerUnit: BonusTriggerUnit;
  /** Threshold in cents (subtotal unit) or count (unique-Backer unit). */
  threshold: bigint;
  additionalPercent: number;
  /** ≤ 50 (§6 ceiling); stored per §14.3. */
  maxCombinedPercent: number;
}

/**
 * This Creator's — and only this Creator's — captured, validly attributed,
 * pre-tax results.
 */
export function creatorAttributedResults(
  associationId: string,
  charges: readonly CapturedCharge[],
): { subtotalCents: Cents; uniqueBackers: number } {
  const mine = charges.filter(
    (c) =>
      c.captured &&
      c.validlyAttributed &&
      c.attribution.kind === 'creator' &&
      c.attribution.associationId === associationId,
  );
  let subtotalCents = 0n;
  const backers = new Set<string>();
  for (const c of mine) {
    assertCents(c.rewardSubtotalCents, 'rewardSubtotalCents');
    subtotalCents += c.rewardSubtotalCents;
    backers.add(c.backerId);
  }
  return { subtotalCents, uniqueBackers: backers.size };
}

/**
 * The bonus percentage this Creator actually earned: `additionalPercent` when
 * their own attributed results meet the threshold, else 0. The combined
 * percentage is validated against the stored maximum and the ceiling by the
 * caller via `combinedPercent` — this function only answers "triggered?".
 */
export function earnedBonusPercent(
  terms: BonusTerms,
  associationId: string,
  charges: readonly CapturedCharge[],
): number {
  assertPercent(terms.additionalPercent, PERCENTAGE_CEILING, 'additionalPercent');
  assertPercent(terms.maxCombinedPercent, PERCENTAGE_CEILING, 'maxCombinedPercent');
  if (terms.threshold < 0n) {
    throw new MoneyRuleError(`bonus threshold must be >= 0, got ${terms.threshold}`);
  }

  const results = creatorAttributedResults(associationId, charges);
  const measured =
    terms.triggerUnit === 'attributed_subtotal_cents'
      ? results.subtotalCents
      : BigInt(results.uniqueBackers);

  return measured >= terms.threshold ? terms.additionalPercent : 0;
}

/**
 * §24.4: for an attributed charge, provision the MAXIMUM locked percentage
 * that could be owed for that Creator, including any conditional
 * Creator-specific bonus, bounded by the stored maximum combined percentage
 * and the ceiling.
 */
export function provisionalPercent(locked: {
  basePercent: number;
  bidIncreasePercent?: number;
  bonus?: BonusTerms;
}): number {
  assertPercent(locked.basePercent, PERCENTAGE_CEILING, 'basePercent');
  const bid = locked.bidIncreasePercent ?? 0;
  assertPercent(bid, PERCENTAGE_CEILING, 'bidIncreasePercent');

  let max = locked.basePercent + bid + (locked.bonus?.additionalPercent ?? 0);
  if (locked.bonus) {
    assertPercent(locked.bonus.maxCombinedPercent, PERCENTAGE_CEILING, 'maxCombinedPercent');
    max = Math.min(max, locked.bonus.maxCombinedPercent);
  }
  return Math.min(max, PERCENTAGE_CEILING);
}

/** Provisional liability on one validly attributed captured subtotal (§24.4). */
export function computeProvisionalAmount(
  lockedMaxPercent: number,
  attributedSubtotalCents: Cents,
): Cents {
  assertPercent(lockedMaxPercent, PERCENTAGE_CEILING, 'lockedMaxPercent');
  return percentOfCents(attributedSubtotalCents, lockedMaxPercent);
}

/**
 * §24.4 reconciliation, after retry and verification: transfer the earned
 * amount once; return every unearned/untransferred difference to the Founder
 * once. The provisional amount is a liability account and is never Proovd
 * revenue — the two outputs always sum exactly to the provisional input, so
 * no cent can remain with the platform.
 */
export function reconcileProvisional(input: {
  provisionalCents: Cents;
  earnedCents: Cents;
}): { transferCents: Cents; returnedToFounderCents: Cents } {
  assertCents(input.provisionalCents, 'provisionalCents');
  assertCents(input.earnedCents, 'earnedCents');
  if (input.earnedCents > input.provisionalCents) {
    throw new MoneyRuleError(
      'earned amount exceeds the provisioned maximum — the provisional percentage was not the maximum owed (§24.4)',
    );
  }
  return {
    transferCents: input.earnedCents,
    returnedToFounderCents: input.provisionalCents - input.earnedCents,
  };
}
