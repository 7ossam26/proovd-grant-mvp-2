/**
 * Notification event registry — Spec §27.3–27.6.
 *
 * The typed key set for every transactional event the Spec names. Templates
 * and sends arrive with the phases that own them; Phase 22 sweeps this
 * registry for coverage, so the acceptance suite can assert coverage against
 * keys instead of grepping templates.
 *
 * §27.3–27.6 name their events as ~70 prose bullets; several bullets bundle
 * multiple distinct messages ("Interview confirmation/reminder/reschedule/
 * cancel"). Bundles are split into one key per distinct message, because the
 * delivery-dedup unique constraint is (event, target, entity)
 * (`notification_deliveries`, §27.2/§28.3): if a reminder shared a key with
 * the confirmation for the same entity, dedup would wrongly swallow it.
 * `specRef` ties each key back to the §27 bullet it came from.
 *
 * §27.2: transactional email is never opt-out-able, duplicate webhook/job
 * delivery cannot create a duplicate email, and money emails carry amount,
 * seller/MoR, descriptor, and status. Those rules bind the senders built in
 * later phases; the dedup path starts here.
 */

export type NotificationAudience = 'founder' | 'affiliate' | 'backer' | 'internal';

export interface NotificationEventDefinition {
  audience: NotificationAudience;
  /** The §27 bullet this key implements. */
  specRef: string;
  description: string;
}

export const NOTIFICATION_EVENTS = {
  /* ── §27.3 Founder transactional events ─────────────────────────────── */
  founder_invitation: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Personalized invitation',
  },
  founder_email_verification: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Public-route email verification if later enabled',
  },
  founder_password_reset: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Password reset',
  },
  founder_interview_confirmed: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Interview confirmation',
  },
  founder_interview_reminder: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Interview reminder',
  },
  founder_interview_rescheduled: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Interview reschedule',
  },
  founder_interview_canceled: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Interview cancellation',
  },
  founder_connected_account_status: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Connected-account requirement/status',
  },
  founder_listing_fee_receipt: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Listing-fee receipt',
  },
  founder_listing_fee_refund: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Listing-fee refund',
  },
  founder_response_window_started: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Formal response window start',
  },
  founder_roster_update: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Roster update',
  },
  founder_creator_proposal_received: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Creator proposal received',
  },
  founder_creator_proposal_revision: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Creator proposal revision activity',
  },
  founder_creator_proposal_decision: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Creator decision on a proposal version',
  },
  founder_mid_campaign_creator_proposed: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Mid-campaign Creator proposed',
  },
  founder_mid_campaign_creator_accepted: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Mid-campaign Creator accepted',
  },
  founder_mid_campaign_creator_activated: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Mid-campaign Creator activated',
  },
  founder_submission_receipt: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Submission receipt with owner/next date',
  },
  founder_changes_required: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Changes required',
  },
  founder_campaign_approved: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Campaign approval',
  },
  founder_fixed_payment_funding_request: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Fixed-payment funding request',
  },
  founder_fixed_payment_funding_confirmation: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Fixed-payment funding confirmation',
  },
  founder_fixed_payment_funding_failure: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Fixed-payment funding failure',
  },
  founder_campaign_live: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Campaign live',
  },
  founder_campaign_discovery_opened: {
    audience: 'founder',
    specRef: '§27.3',
    description:
      '§18 Day 8 discovery opened — the one factual notice on browse/index eligibility and how organic, house, and Creator attribution differ',
  },
  founder_idea_threshold_reached: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Idea threshold reached',
  },
  founder_idea_threshold_lost: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Idea threshold lost',
  },
  founder_campaign_ended: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Campaign ended (separate from Results ready, §21)',
  },
  founder_results_ready: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Results ready (separate from Campaign ended, §21)',
  },
  founder_w9_prompt: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'W-9 prompt',
  },
  founder_w9_block: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'W-9 block on payment',
  },
  founder_single_payment_released: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Idea single payment released',
  },
  founder_first_payment_released: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Product first payment released',
  },
  founder_remaining_payment_released: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Product remaining payment released',
  },
  founder_payment_blocked: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Founder payment blocked',
  },
  founder_day_14_review_result: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Day 14 review result',
  },
  founder_early_remaining_request: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Product early-fulfillment (early remaining payment) request received',
  },
  founder_early_remaining_result: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Product early-fulfillment request pass/fail',
  },
  founder_campaign_suspended: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Campaign suspension',
  },
  founder_campaign_killed: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Campaign kill',
  },
  founder_ready_next_campaign: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Ready-next-campaign',
  },
  founder_work_again_response: {
    audience: 'founder',
    specRef: '§27.3',
    description: 'Work-again response',
  },

  /* ── §27.4 Affiliate transactional events ───────────────────────────── */
  affiliate_campaign_invitation: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Campaign-specific invitation',
  },
  affiliate_signup_confirmed: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Signup confirmed / waiting state',
  },
  affiliate_founder_signup_completed: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Founder signup completed / preparing campaign available',
  },
  affiliate_formal_opportunity_available: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Formal opportunity available',
  },
  affiliate_proposal_submitted: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Proposal version submitted',
  },
  affiliate_founder_revision: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Founder revision received',
  },
  affiliate_founder_decision: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Founder decision on a proposal version',
  },
  affiliate_proposal_expired: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Proposal deadline expiry',
  },
  affiliate_accept_confirmation: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Acceptance confirmation',
  },
  affiliate_decline_confirmation: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Decline confirmation',
  },
  affiliate_disclosure_tracking_available: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Disclosure/tracking available',
  },
  affiliate_fixed_funding_complete: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Fixed funding complete; readiness remains explicit',
  },
  affiliate_first_post_pass: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'First-post verification pass',
  },
  affiliate_first_post_correction: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'First-post correction required',
  },
  affiliate_first_post_reject: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'First-post rejected',
  },
  affiliate_completion_decision: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Completion / fixed-payment decision',
  },
  affiliate_campaign_live: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Campaign live',
  },
  affiliate_campaign_closed: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Campaign closed',
  },
  affiliate_mid_campaign_invitation: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Mid-campaign invitation',
  },
  affiliate_mid_campaign_readiness: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Mid-campaign readiness',
  },
  affiliate_mid_campaign_activation: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Mid-campaign activation',
  },
  affiliate_commission_finalized: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Commission finalized',
  },
  affiliate_transfer_created: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Transfer created',
  },
  affiliate_transfer_failure: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Transfer failure',
  },
  affiliate_transfer_reversal: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Transfer reversal',
  },
  affiliate_transfer_update: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Transfer update',
  },
  affiliate_payout_paid: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Payout paid when available',
  },
  affiliate_payout_failed: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Payout failed when available',
  },
  affiliate_connected_account_info_required: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Connected-account info required',
  },
  affiliate_warning: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Warning',
  },
  affiliate_suspension: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Suspension',
  },
  affiliate_policy_reacceptance: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Policy reacceptance required',
  },
  affiliate_work_again_request: {
    audience: 'affiliate',
    specRef: '§27.4',
    description: 'Work-again request',
  },

  /* ── §27.5 Backer transactional events ──────────────────────────────── */
  backer_preorder_confirmation: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Pre-order confirmation',
  },
  backer_precharge_reminder: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Pre-charge reminder (~24 hours before trigger, §6)',
  },
  backer_cancellation_confirmation: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Cancellation confirmation',
  },
  backer_threshold_miss_no_charge: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Threshold miss / no charge',
  },
  backer_charge_receipt: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Charge receipt',
  },
  backer_charge_failed_update_card: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Failed charge / update card',
  },
  backer_retry_success: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Retry success',
  },
  backer_retry_dropped: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Retry window ended, payment dropped',
  },
  backer_refund_started: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Refund started',
  },
  backer_refund_completed: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Refund completed',
  },
  backer_refund_failed: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Refund failed',
  },
  backer_support_received: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Support request received',
  },
  backer_support_founder_response: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Founder response to support request',
  },
  backer_support_followup: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Support follow-up',
  },
  backer_campaign_update_digest: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Campaign update digest if selected',
  },
  backer_delivery: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Delivery notification',
  },
  backer_satisfaction_survey: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Satisfaction survey',
  },
  backer_campaign_suspended: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Campaign suspension',
  },
  backer_campaign_killed: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Campaign kill',
  },
  backer_magic_link_reissue: {
    audience: 'backer',
    specRef: '§27.5',
    description: 'Magic-link reissue',
  },

  /* ── §27.6 Internal events ──────────────────────────────────────────── */
  internal_invitation_claimed: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Invitation claimed / new account',
  },
  internal_interview_changed: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Interview changes',
  },
  internal_listing_paid_deadline_started: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Listing paid / deadline started',
  },
  internal_campaign_submitted: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Campaign submitted',
  },
  internal_proposal_awaiting_response: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Proposal awaiting response',
  },
  internal_fixed_funding_received: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Fixed funding received',
  },
  internal_fixed_funding_failed: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Fixed funding failed',
  },
  internal_post_verification_due: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Post verification due',
  },
  internal_deliverable_verification_due: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Deliverable verification due',
  },
  internal_threshold_reached: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Threshold reached',
  },
  internal_threshold_lost: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Threshold lost',
  },
  internal_charge_batch_result: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Charge batch result',
  },
  internal_failed_payment_spike: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Failed-payment spike',
  },
  internal_retry_reconciliation_complete: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Retry/reconciliation complete',
  },
  internal_money_decisions_due: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Money decisions due',
  },
  internal_missing_w9: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Missing W-9',
  },
  internal_day_14_due: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Day 14 due',
  },
  internal_dispute_opened: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Dispute opened (Admin task due within 24 hours, §24.11)',
  },
  internal_risk_flag: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Risk flag',
  },
  internal_support_sla_breach: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Support SLA breach',
  },
  internal_work_again_request: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Work-again request',
  },
  internal_mid_campaign_invite: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Mid-campaign Affiliate invite',
  },
  internal_mid_campaign_accept: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Mid-campaign Affiliate accept',
  },
  internal_mid_campaign_readiness: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Mid-campaign Affiliate readiness',
  },
  internal_mid_campaign_activation: {
    audience: 'internal',
    specRef: '§27.6',
    description: 'Mid-campaign Affiliate activation',
  },
} as const satisfies Record<string, NotificationEventDefinition>;

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;

export const NOTIFICATION_EVENT_KEYS = Object.keys(
  NOTIFICATION_EVENTS,
) as NotificationEventKey[];

/**
 * The delivery-dedup identity — mirrors the `notification_deliveries` unique
 * constraint (event, target, entity). One tuple, one delivery, ever; a
 * duplicate webhook or job retry may update audit but can never send a
 * second message (§27.2, §28.3).
 */
export interface DeliveryDedupTuple {
  eventKey: NotificationEventKey;
  /** The recipient identity — email or internal channel identifier. */
  target: string;
  entityType: string;
  entityId: string;
}

export function deliveryDedupTuple(
  eventKey: NotificationEventKey,
  target: string,
  entityType: string,
  entityId: string,
): DeliveryDedupTuple {
  return { eventKey, target, entityType, entityId };
}
