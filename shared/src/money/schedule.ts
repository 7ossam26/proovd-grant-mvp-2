/**
 * Founder payment schedule split — Spec §6: Idea 100% Day 3; Product 40%
 * Day 3 / 60% Day 14. The Day 3/Day 14 timestamps anchor on
 * `campaign_close_at` (§21) and live in shared/calendar; this module owns the
 * amount split only.
 *
 * Naming (§3): `single_payment` / `first_payment` / `remaining_payment` are
 * internal; customer-facing copy says "Single Founder payment" / "First
 * payment" / "remaining payment".
 */

import { PRODUCT_FIRST_PAYMENT_PERCENT } from './constants.js';
import { assertCents, percentOfCents, type Cents } from './cents.js';

/** Idea: one payment, the full amount (§6). */
export function ideaSinglePayment(founderAmountCents: Cents): { singlePaymentCents: Cents } {
  assertCents(founderAmountCents, 'founderAmountCents');
  return { singlePaymentCents: founderAmountCents };
}

/**
 * Product: 40% first / 60% remaining (§6). The first payment floor-rounds and
 * the remaining payment is the exact remainder, so the two always sum to the
 * input with no lost cent.
 */
export function productPaymentSplit(founderAmountCents: Cents): {
  firstPaymentCents: Cents;
  remainingPaymentCents: Cents;
} {
  assertCents(founderAmountCents, 'founderAmountCents');
  const firstPaymentCents = percentOfCents(founderAmountCents, PRODUCT_FIRST_PAYMENT_PERCENT);
  return {
    firstPaymentCents,
    remainingPaymentCents: founderAmountCents - firstPaymentCents,
  };
}
