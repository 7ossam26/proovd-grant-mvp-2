/**
 * Configured constants — every value here is named in Spec §6 (Phase 0 —
 * Global configuration and production prerequisites). If §6 doesn't name a
 * fee, window, percentage, or duration, it doesn't exist; do not add one.
 */

/** §6: Listing-fee base: US$35. */
export const LISTING_FEE_BASE_CENTS = 3500n;

/** §6: US$2 discount per completed optional item. */
export const LISTING_FEE_ITEM_DISCOUNT_CENTS = 200n;

/** §6: Maximum discount: US$10. */
export const LISTING_FEE_MAX_DISCOUNT_CENTS = 1000n;

/** §6: Minimum listing fee: US$25. */
export const LISTING_FEE_MIN_CENTS = 2500n;

/** §6: Platform fee: 5% of captured pre-tax reward subtotal. */
export const PLATFORM_FEE_PERCENT = 5;

/** §6: Base Affiliate percentage: 30%. */
export const AFFILIATE_BASE_PERCENT_STANDARD = 30;

/**
 * §6: 20% when an accepted Product-Campaign fixed Creator payment exists.
 */
export const AFFILIATE_BASE_PERCENT_WITH_FIXED = 20;

/** §6: Percentage compensation ceiling: 50% per attributed captured charge. */
export const PERCENTAGE_CEILING = 50;

/** §6: Campaign cap: US$50,000 aggregate pre-tax active-pre-order value. */
export const CAMPAIGN_CAP_CENTS = 5_000_000n;

/** §6: Product Campaign default duration: 14 days. */
export const PRODUCT_DEFAULT_DURATION_DAYS = 14;

/** §6: Failed-payment retry window: fixed 48 hours. */
export const CAPTURE_RETRY_WINDOW_HOURS = 48;

/** §6: Affiliate formal-response window: fixed 72 hours from `listing_paid_at`. */
export const AFFILIATE_RESPONSE_WINDOW_HOURS = 72;

/**
 * §6: Founder free-cancellation window: 48 hours from `listing_paid_at`,
 * only while not live.
 */
export const FOUNDER_FREE_CANCELLATION_WINDOW_HOURS = 48;

/**
 * §6: Creator replacement window: three US business days from
 * `creator_failure_recorded_at`.
 */
export const CREATOR_REPLACEMENT_WINDOW_BUSINESS_DAYS = 3;

/** §6: Founder payment schedules — Idea 100% Day 3. */
export const IDEA_SINGLE_PAYMENT_DAY = 3;

/** §6: Product 40% Day 3 / 60% Day 14. */
export const PRODUCT_FIRST_PAYMENT_DAY = 3;
export const PRODUCT_FIRST_PAYMENT_PERCENT = 40;
export const PRODUCT_REMAINING_PAYMENT_DAY = 14;
export const PRODUCT_REMAINING_PAYMENT_PERCENT = 60;

/** §6: Default required promotional post count: three. */
export const REQUIRED_PROMOTIONAL_POSTS = 3;
