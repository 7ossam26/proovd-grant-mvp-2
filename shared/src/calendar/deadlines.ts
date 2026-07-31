/**
 * Anchor-keyed deadline helpers — Spec §21, §6.
 *
 * The three anchors are dedicated columns, never inferred from
 * created_at/updated_at (§21):
 *
 *   `listing_paid_at`    → 72-hour response/refund clock, 48-hour Founder
 *                          free-cancellation clock
 *   `campaign_live_at`   → Day 1, discovery timing, live obligations
 *   `campaign_close_at`  → capture/retry start, Day 3 / Day 14 payments
 *
 * Each helper takes exactly the anchor that drives it (§33.12.1) — a caller
 * cannot hand one a generic timestamp column without that being visible at
 * the call site. Every window and day number here is named in §6.
 */

import {
  AFFILIATE_RESPONSE_WINDOW_HOURS,
  FOUNDER_FREE_CANCELLATION_WINDOW_HOURS,
  CAPTURE_RETRY_WINDOW_HOURS,
  IDEA_SINGLE_PAYMENT_DAY,
  PRODUCT_FIRST_PAYMENT_DAY,
  PRODUCT_REMAINING_PAYMENT_DAY,
  CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS,
} from '../money/constants.js';
import {
  businessDayDeadline,
  US_FEDERAL_HOLIDAYS,
  type BusinessDayDeadline,
  type HolidayCalendar,
} from './business-days.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** §6: fixed 72 hours from `listing_paid_at`. */
export function affiliateResponseDeadline(listingPaidAt: Date): Date {
  return new Date(listingPaidAt.getTime() + AFFILIATE_RESPONSE_WINDOW_HOURS * HOUR_MS);
}

/** §6: 48 hours from `listing_paid_at`, only while not live. */
export function founderFreeCancellationDeadline(listingPaidAt: Date): Date {
  return new Date(listingPaidAt.getTime() + FOUNDER_FREE_CANCELLATION_WINDOW_HOURS * HOUR_MS);
}

/** §6/§21: fixed 48 hours from the FIRST close-batch failure. */
export function captureRetryDeadline(firstFailureAt: Date): Date {
  return new Date(firstFailureAt.getTime() + CAPTURE_RETRY_WINDOW_HOURS * HOUR_MS);
}

/** §6/§21: Idea single payment — Day 3, anchored at `campaign_close_at`. */
export function ideaSinglePaymentDue(campaignCloseAt: Date): Date {
  return new Date(campaignCloseAt.getTime() + IDEA_SINGLE_PAYMENT_DAY * DAY_MS);
}

/** §6/§21: Product first payment — Day 3, anchored at `campaign_close_at`. */
export function productFirstPaymentDue(campaignCloseAt: Date): Date {
  return new Date(campaignCloseAt.getTime() + PRODUCT_FIRST_PAYMENT_DAY * DAY_MS);
}

/** §6/§21: Product remaining payment — Day 14, anchored at `campaign_close_at`. */
export function productRemainingPaymentDue(campaignCloseAt: Date): Date {
  return new Date(campaignCloseAt.getTime() + PRODUCT_REMAINING_PAYMENT_DAY * DAY_MS);
}

/**
 * §29.6/§6: three US business days from `creator_failure_recorded_at`,
 * calendar-versioned. Store the returned version with the timestamp; use
 * `retainDeadline` so recomputation can never reset it.
 */
export function creatorReplacementDeadline(
  creatorFailureRecordedAt: Date,
  calendar: HolidayCalendar = US_FEDERAL_HOLIDAYS,
): BusinessDayDeadline {
  return businessDayDeadline(
    creatorFailureRecordedAt,
    CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS,
    calendar,
  );
}
