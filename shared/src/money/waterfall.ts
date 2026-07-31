/**
 * The money waterfall — Spec §24.3. One implementation; both the checkout
 * preview and the close batch call this module. Never write a second one.
 *
 * ── Structural tax exclusion ────────────────────────────────────────────────
 * Sales tax is excluded from the Proovd 5%, every Creator percentage, the Idea
 * threshold, and the campaign cap (§24.3). That exclusion is structural here:
 * `computeWaterfall` takes only the pre-tax reward subtotal and has no tax
 * parameter at all, so including tax is impossible rather than discouraged.
 * Tax appears in exactly one function — `computeTotalCaptured` — whose only
 * job is the amount the Backer's card is charged.
 */

import { PLATFORM_FEE_PERCENT, PERCENTAGE_CEILING } from './constants.js';
import { assertCents, assertPercent, percentOfCents, type Cents } from './cents.js';

/**
 * The §24.3 waterfall for one captured transaction. All three components sum
 * exactly to the reward subtotal: the fee and compensation floor-round, and
 * the Founder gross share is the exact remainder.
 */
export interface CaptureWaterfall {
  rewardSubtotalCents: Cents;
  proovdFeeCents: Cents;
  affiliateCompensationCents: Cents;
  founderGrossShareCents: Cents;
}

/**
 * §24.3:
 *   proovd_fee               = 5% × captured reward_subtotal
 *   affiliate_compensation   = locked earned % × captured validly attributed reward_subtotal
 *   founder_gross_share      = reward_subtotal − proovd_fee − affiliate_compensation
 *
 * `affiliatePercent` is the locked earned percentage for the validly attributed
 * Creator; pass 0 for an organic/house/unattributed charge. The ceiling (§6)
 * bounds it at 50.
 */
export function computeWaterfall(input: {
  rewardSubtotalCents: Cents;
  affiliatePercent: number;
}): CaptureWaterfall {
  const { rewardSubtotalCents, affiliatePercent } = input;
  assertCents(rewardSubtotalCents, 'rewardSubtotalCents');
  assertPercent(affiliatePercent, PERCENTAGE_CEILING, 'affiliatePercent');

  const proovdFeeCents = percentOfCents(rewardSubtotalCents, PLATFORM_FEE_PERCENT);
  const affiliateCompensationCents = percentOfCents(rewardSubtotalCents, affiliatePercent);
  const founderGrossShareCents =
    rewardSubtotalCents - proovdFeeCents - affiliateCompensationCents;

  return {
    rewardSubtotalCents,
    proovdFeeCents,
    affiliateCompensationCents,
    founderGrossShareCents,
  };
}

/**
 * §24.3: total_captured = reward_subtotal + sales_tax. The single place in
 * shared/money where a tax figure exists — it is the charge amount, and it
 * feeds nothing downstream.
 */
export function computeTotalCaptured(rewardSubtotalCents: Cents, salesTaxCents: Cents): Cents {
  assertCents(rewardSubtotalCents, 'rewardSubtotalCents');
  assertCents(salesTaxCents, 'salesTaxCents');
  return rewardSubtotalCents + salesTaxCents;
}

/**
 * §24.3: founder_net = founder_gross_share − allocated Stripe fees −
 * cause-based adjustments. May legitimately go negative when refunds or
 * cause-based adjustments exceed the remaining share; the caller decides what
 * a negative balance means (§24.8 recovery), the arithmetic just reports it.
 */
export function computeFounderNet(
  founderGrossShareCents: Cents,
  allocatedStripeFeesCents: Cents,
  causeBasedAdjustmentsCents: Cents,
): Cents {
  assertCents(founderGrossShareCents, 'founderGrossShareCents');
  assertCents(allocatedStripeFeesCents, 'allocatedStripeFeesCents');
  assertCents(causeBasedAdjustmentsCents, 'causeBasedAdjustmentsCents');
  return founderGrossShareCents - allocatedStripeFeesCents - causeBasedAdjustmentsCents;
}
