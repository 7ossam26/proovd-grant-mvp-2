/**
 * Listing-fee calculation — Spec §12.
 *
 *   base = US$35
 *   discount = US$2 × completed optional items (cap US$10)
 *   listing fee subtotal = max(US$25, US$35 − discount)
 *
 * Tax on the listing fee is Stripe Tax's job at Checkout (§12); it never
 * enters this calculation. The five optional items are the §12 list — the
 * caller passes each item's objective completion status, giving the 32
 * combinations §33.3.2 tests.
 */

import {
  LISTING_FEE_BASE_CENTS,
  LISTING_FEE_ITEM_DISCOUNT_CENTS,
  LISTING_FEE_MAX_DISCOUNT_CENTS,
  LISTING_FEE_MIN_CENTS,
} from './constants.js';
import type { Cents } from './cents.js';

/** The five §12 optional items, by objective completion status. */
export interface OptionalItemCompletion {
  visuals: boolean;
  branding: boolean;
  /** §12: only a `confirmed` booking counts — selected/canceled/abandoned do not. */
  interviewConfirmed: boolean;
  story: boolean;
  socials: boolean;
}

export interface ListingFeeCalculation {
  baseCents: Cents;
  completedItems: number;
  /** Itemized US$2 lines, one per completed item (§13: each saving is its own labeled line). */
  discountLines: Array<{ item: keyof OptionalItemCompletion; discountCents: Cents }>;
  discountCents: Cents;
  subtotalCents: Cents;
}

export function computeListingFee(items: OptionalItemCompletion): ListingFeeCalculation {
  const keys: Array<keyof OptionalItemCompletion> = [
    'visuals',
    'branding',
    'interviewConfirmed',
    'story',
    'socials',
  ];
  const completed = keys.filter((k) => items[k]);

  const rawDiscount = LISTING_FEE_ITEM_DISCOUNT_CENTS * BigInt(completed.length);
  const discountCents =
    rawDiscount > LISTING_FEE_MAX_DISCOUNT_CENTS ? LISTING_FEE_MAX_DISCOUNT_CENTS : rawDiscount;

  const reduced = LISTING_FEE_BASE_CENTS - discountCents;
  const subtotalCents = reduced < LISTING_FEE_MIN_CENTS ? LISTING_FEE_MIN_CENTS : reduced;

  return {
    baseCents: LISTING_FEE_BASE_CENTS,
    completedItems: completed.length,
    discountLines: completed.map((item) => ({
      item,
      discountCents: LISTING_FEE_ITEM_DISCOUNT_CENTS,
    })),
    discountCents,
    subtotalCents,
  };
}
