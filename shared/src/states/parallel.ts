/**
 * Parallel build/readiness fields and payment/reconciliation flags — Spec
 * §23.2, §23.3. Kept SEPARATE from the campaign lifecycle: `campaigns.status`
 * is lifecycle only, and putting a payment flag in it is the single most
 * common way this model goes wrong (phase-03 traps).
 */

/** §23.2. */
export const AFFILIATE_ROSTER_STATUSES = ['forming', 'launch_ready', 'failed'] as const;
export type AffiliateRosterStatus = (typeof AFFILIATE_ROSTER_STATUSES)[number];

/** §23.2. */
export const CAMPAIGN_BUILD_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export type CampaignBuildStatus = (typeof CAMPAIGN_BUILD_STATUSES)[number];

/**
 * `review_ready` is derived from Campaign Setup and never stored. Creator
 * matching is a separate stage and cannot block submission for review.
 */
export function deriveReviewReady(
  _rosterStatus: AffiliateRosterStatus,
  buildStatus: CampaignBuildStatus,
): boolean {
  return buildStatus === 'complete';
}

/**
 * §23.3: payment/reconciliation flags. Each is an independent row carrying
 * timestamp, amount, actor, evidence, and provider IDs — never an enum value
 * on the campaign lifecycle.
 */
export const PAYMENT_FLAGS = [
  'retrying',
  'founder_payment_eligible',
  'founder_payment_paid',
  'affiliate_earnings_adjusted',
  'affiliate_transfer_eligible',
  'affiliate_transfer_paid',
  'results_ready',
  'fulfillment_active',
] as const;
export type PaymentFlag = (typeof PAYMENT_FLAGS)[number];

/** §23.4: initial-roster vs mid-campaign membership, stored separately. */
export const ROSTER_MEMBERSHIPS = ['initial_roster', 'mid_campaign'] as const;
export type RosterMembership = (typeof ROSTER_MEMBERSHIPS)[number];
