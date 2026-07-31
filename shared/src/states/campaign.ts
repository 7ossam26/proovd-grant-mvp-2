/**
 * Campaign lifecycle machine — Spec §23.1. Lifecycle ONLY: payment and
 * reconciliation flags live in separate rows (§23.3, `parallel.ts`), never in
 * this status.
 *
 * §23.1 gives each state an entry rule and an exit rule in prose; every edge
 * below cites the rule it implements. Where the spec routes an outcome to
 * "archive/draft handling" without naming a lifecycle state (revoked
 * invitations, wrong-type archive §33.1.7), no edge exists — those are
 * retention/token concerns, not lifecycle transitions, and inventing an
 * `archived` state is prohibited (§1 rule 6).
 *
 * Note: §23.1 defines 27 states (the phase file's "25" undercounts the spec
 * table; the Spec wins, §1.8).
 */

import { defineMachine } from './machine.js';

export const CAMPAIGN_STATUSES = [
  'invited_draft',
  'vetting_submitted',
  'account_claimed',
  'stripe_onboarding_pending',
  'listing_fee_pending',
  'affiliate_response_and_build',
  'pending_review',
  'changes_required',
  'approved',
  'creator_prep',
  'creator_replacement',
  'refunded_no_creator',
  'live',
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
  'suspended',
  'killed',
  'banned_founder',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * States a temporary suspension (§23.1 `suspended`, §29.7) can be entered
 * from — and reinstated back to. "Reinstate" returns to the prior state; the
 * map admits every pair, and the service layer (later phase) narrows to the
 * actual prior state using the append-only history.
 */
const SUSPENDABLE: readonly CampaignStatus[] = [
  'creator_prep',
  'creator_replacement',
  'live',
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
];

export const campaignMachine = defineMachine<CampaignStatus>('campaign', CAMPAIGN_STATUSES, {
  // §23.1: exit "Vetting submitted or invitation revoked/expired" (revoke/expire → retention, no state).
  invited_draft: ['vetting_submitted'],
  // §23.1: exit "Account claimed or archived/replaced".
  vetting_submitted: ['account_claimed'],
  // §23.1: exit "Stripe onboarding/listing preparation begins".
  account_claimed: ['stripe_onboarding_pending'],
  // §23.1: exit "Requirements complete".
  stripe_onboarding_pending: ['listing_fee_pending'],
  // §23.1: exit "Successful payment or archive".
  listing_fee_pending: ['affiliate_response_and_build'],
  // §23.1: exit "Failed/refunded; or both tracks produce review readiness".
  // Roster failure at the 72-hour deadline refunds and terminates pre-charge
  // (§14.6) → ended_no_charge ("pre-charge termination", §23.1). Founder
  // free-cancellation within 48h/not-live (§6) is likewise pre-charge.
  affiliate_response_and_build: ['pending_review', 'ended_no_charge'],
  // §23.1: exit "Approved or changes required". Cancellation while not live → pre-charge termination.
  pending_review: ['approved', 'changes_required', 'ended_no_charge'],
  // §23.1: exit "Founder resubmits; affected Creator reacceptance complete where material".
  changes_required: ['pending_review', 'ended_no_charge'],
  // §23.1: exit "Creator prep starts".
  approved: ['creator_prep', 'ended_no_charge'],
  // §23.1: exit "Live, replacement, cancellation, or suspension".
  creator_prep: ['live', 'creator_replacement', 'ended_no_charge', 'suspended', 'killed'],
  // §23.1: exit "Replacement ready or deadline missed" (§29.6).
  creator_replacement: ['creator_prep', 'refunded_no_creator', 'suspended', 'killed'],
  // §23.1: "Terminal unless explicit new submission path" — no such path exists.
  refunded_no_creator: [],
  // §23.1: exit "Close, suspend, or kill". A pre-charge Admin-approved
  // cancellation of a live campaign is pre-charge termination (§33.3.11).
  live: ['closed_pending_capture', 'suspended', 'killed', 'ended_no_charge'],
  // §23.1: exit "Retry window/no-charge outcome"; §21: threshold miss →
  // ended_no_charge; no retryable failure → straight to reconciling.
  closed_pending_capture: [
    'capture_retry_window',
    'closed_reconciling',
    'ended_no_charge',
    'suspended',
    'killed',
  ],
  // §23.1: exit "48-hour deadline/reconciliation".
  capture_retry_window: ['closed_reconciling', 'suspended', 'killed'],
  // §23.1: exit "Close records reconciled"; §23.1 captured_pending_w9 entry
  // "Founder charge result ready, W-9 missing" — with a W-9 on file the
  // schedule releases directly (Idea single / Product first, §6).
  closed_reconciling: [
    'captured_pending_w9',
    'single_payment_released',
    'first_payment_released',
    'closed_resolved',
    'suspended',
    'killed',
  ],
  // §23.1: exit "W-9 verified/decision".
  captured_pending_w9: [
    'single_payment_released',
    'first_payment_released',
    'suspended',
    'killed',
  ],
  // §23.1: exit "Fulfillment/enforcement continues".
  single_payment_released: ['fulfilled', 'closed_resolved', 'suspended', 'killed'],
  // §23.1: exit "Remaining-payment decision". Early remaining release is
  // evidence-gated (§6) and never skips Day 14 (§33.8.12).
  first_payment_released: ['day_14_review', 'remaining_payment_released', 'suspended', 'killed'],
  // §23.1: exit "Pass/fail and next action".
  day_14_review: ['remaining_payment_released', 'fulfilled', 'closed_resolved', 'suspended', 'killed'],
  // §23.1: exit "Fulfillment/resolution". Day 14 still occurs after an early release (§33.8.12).
  remaining_payment_released: ['day_14_review', 'fulfilled', 'closed_resolved', 'suspended', 'killed'],
  // §23.1: exit "Final resolution if money already reconciled".
  fulfilled: ['closed_resolved'],
  // §23.1: "Terminal; fulfillment may be tracked separately if not done".
  closed_resolved: [],
  // §23.1: "Terminal/support only".
  ended_no_charge: [],
  // §23.1: exit "Reinstate, kill, or resolve".
  suspended: [...SUSPENDABLE, 'killed', 'closed_resolved', 'ended_no_charge'],
  // §23.1: exit "Terminal/recovery/support"; banned_founder entry
  // "Enforcement also bans Founder".
  killed: ['banned_founder'],
  // §23.1: "Terminal".
  banned_founder: [],
});
