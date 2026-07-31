/**
 * Idea threshold and campaign cap — Spec §6, §14.4, §21, §24.3.
 *
 * Both are pre-tax by construction: the threshold counts unique active
 * Backers (§14.4 "integer order threshold", §21 "calculate unique active
 * Backers") and the cap sums pre-tax reward subtotals. Neither function has a
 * tax parameter, per the §24.3 structural exclusion.
 */

import { CAMPAIGN_CAP_CENTS } from './constants.js';
import { assertCents, type Cents } from './cents.js';
import { MoneyRuleError } from './errors.js';

/**
 * §21 close batch step 4: after duplicate resolution, the Idea threshold is
 * met when the unique active Backer count reaches the integer threshold fixed
 * at `campaign_close_at`.
 */
export function ideaThresholdMet(uniqueActiveBackers: number, threshold: number): boolean {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new MoneyRuleError(`Idea threshold must be a positive integer, got ${threshold}`);
  }
  if (!Number.isInteger(uniqueActiveBackers) || uniqueActiveBackers < 0) {
    throw new MoneyRuleError(
      `unique active Backer count must be a non-negative integer, got ${uniqueActiveBackers}`,
    );
  }
  return uniqueActiveBackers >= threshold;
}

/**
 * §6: US$50,000 aggregate pre-tax active-pre-order value. Sums the pre-tax
 * reward subtotals of currently active reservations only.
 */
export function activePreorderValueCents(activeSubtotals: readonly Cents[]): Cents {
  let total = 0n;
  for (const s of activeSubtotals) {
    assertCents(s, 'active pre-order subtotal');
    total += s;
  }
  return total;
}

/** Would adding this pre-tax subtotal push the aggregate over the cap? */
export function wouldExceedCap(
  currentActivePretaxCents: Cents,
  addedPretaxCents: Cents,
): boolean {
  assertCents(currentActivePretaxCents, 'currentActivePretaxCents');
  assertCents(addedPretaxCents, 'addedPretaxCents');
  return currentActivePretaxCents + addedPretaxCents > CAMPAIGN_CAP_CENTS;
}
