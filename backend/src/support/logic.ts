/**
 * The §26.7, §26.8, and §27.8 registers, restated for the backend.
 *
 * The backend never imports `@proovd/shared` at runtime, so the data is restated
 * here and `support-operations.test.ts` drift-tests every list — the same
 * arrangement `admin/logic.ts`, `launch/logic.ts`, `creator-payment/logic.ts`,
 * and `db/schema/domain.ts` all use.
 *
 * Appendix B.8's template is restated too, and that matters more than the lists:
 * it is customer copy, so an emailed acknowledgement that has drifted from the
 * Spec is a promise the product did not agree to make. The drift test compares
 * it character for character, exactly as `reservations/restated.ts` does for
 * A.3/A.4 and `checkout/consent.ts` for A.5.
 */

/* ── §26.7 topics and owners ──────────────────────────────────────────────── */

export const SUPPORT_TOPICS = [
  'unknown_charge',
  'reward_not_as_described',
  'delivery',
  'cancellation',
  'refund',
  'payment_failed',
  'account_access',
  'campaign_question',
  'dissatisfaction_followup',
  'other',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_TOPIC_LABELS: Readonly<Record<SupportTopic, string>> = {
  unknown_charge: 'A charge I do not recognise',
  reward_not_as_described: 'The reward is not as described',
  delivery: 'Delivery',
  cancellation: 'Cancelling a pre-order',
  refund: 'A refund',
  payment_failed: 'A payment that did not go through',
  account_access: 'Getting back into my account',
  campaign_question: 'A question about a campaign',
  dissatisfaction_followup: 'Following up on a problem',
  other: 'Something else',
};

export const SUPPORT_OWNERS = ['proovd_support', 'founder_coordinated'] as const;
export type SupportOwner = (typeof SUPPORT_OWNERS)[number];

/** B.8's exact `Owner:` wording. Customer-facing, so restated and drift-tested. */
export const SUPPORT_OWNER_LABELS: Readonly<Record<SupportOwner, string>> = {
  proovd_support: 'PROOVD SUPPORT',
  founder_coordinated: 'FOUNDER, coordinated by Proovd',
};

export const SUPPORT_CASE_STATUSES = [
  'open',
  'awaiting_founder',
  'awaiting_customer',
  'resolved',
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

/** §27.8's two published commitments. Not §6 settings — see the shared register. */
export const SUPPORT_RESPONSE_BUSINESS_DAYS = 1;
export const FOUNDER_FOLLOWUP_HOURS = 48;

/* ── Appendix B.8 — exact text ────────────────────────────────────────────── */

export const SUPPORT_ACKNOWLEDGEMENT_TEMPLATE = `We received your message — case [CASE ID].

Topic: [CATEGORY]
Owner: [PROOVD SUPPORT / FOUNDER, coordinated by Proovd]
Human response due: [LOCAL DATE/TIME]
If the founder needs to respond, we will follow up after 48 hours if you have not heard back.

Reply to this message to keep everything in one case.`;

export function resolveSupportAcknowledgement(input: {
  caseReference: string;
  topic: SupportTopic;
  owner: SupportOwner;
  humanResponseDue: string;
}): string {
  const rendered = SUPPORT_ACKNOWLEDGEMENT_TEMPLATE.replaceAll('[CASE ID]', input.caseReference)
    .replaceAll('[CATEGORY]', SUPPORT_TOPIC_LABELS[input.topic])
    .replaceAll(
      '[PROOVD SUPPORT / FOUNDER, coordinated by Proovd]',
      SUPPORT_OWNER_LABELS[input.owner],
    )
    .replaceAll('[LOCAL DATE/TIME]', input.humanResponseDue);

  // The §7/§8 preview gate, applied to a template: a message that still carries
  // a bracketed marker has acknowledged nothing, so it never leaves.
  if (/\[[A-Z][A-Z /,]*\]/.test(rendered)) {
    throw new Error('support acknowledgement still contains an unresolved variable');
  }
  return rendered;
}

/* ── §26.8 handoff note ───────────────────────────────────────────────────── */

export const HANDOFF_NOTE_FIELDS = [
  'verified_facts',
  'current_owner',
  'next_customer_promise',
  'statements_to_keep_consistent',
] as const;
export type HandoffNoteField = (typeof HANDOFF_NOTE_FIELDS)[number];

/* ── §26.7 enforcement ────────────────────────────────────────────────────── */

export const ENFORCEMENT_REASON_CATEGORIES = [
  'aup_violation',
  'fraud',
  'founder_request',
  'provider_risk',
  'deceptive_marketing',
  'manipulation',
  'sanctions_regulatory',
  'other_reviewed',
] as const;
export type EnforcementReasonCategory = (typeof ENFORCEMENT_REASON_CATEGORIES)[number];

export const ENFORCEMENT_ACTIONS = ['suspend', 'kill'] as const;
export type EnforcementActionKind = (typeof ENFORCEMENT_ACTIONS)[number];

export const ENFORCEMENT_PHASES = ['pre_capture', 'post_capture'] as const;
export type EnforcementPhaseKind = (typeof ENFORCEMENT_PHASES)[number];

export const PRE_CAPTURE_EFFECTS = [
  'close_active_reservations_without_charge',
  'block_future_payment_intents',
  'reference_safe_detach',
  'notify_affected_roles',
  'preserve_page_with_banner',
] as const;
export type PreCaptureEffect = (typeof PRE_CAPTURE_EFFECTS)[number];

/**
 * Which §26.7 consequence set applies.
 *
 * Decided from whether the campaign has reached a state where money has moved —
 * §23.1's post-capture lifecycle. Reading a post-capture campaign as pre-capture
 * would close reservations that have already been charged, which is why this is
 * derived from the lifecycle rather than passed in by the caller.
 */
const POST_CAPTURE_STATUSES: readonly string[] = [
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
];

export function enforcementPhaseFor(campaignStatus: string): EnforcementPhaseKind {
  return POST_CAPTURE_STATUSES.includes(campaignStatus) ? 'post_capture' : 'pre_capture';
}

/* ── §26.8 timeline ───────────────────────────────────────────────────────── */

export const TIMELINE_KINDS = [
  'campaign_status',
  'association_status',
  'reservation_status',
  'invitation_send',
  'kit_access',
  'interview',
  'review',
  'proposal',
  'first_post',
  'payment_flag',
  'listing_payment',
  'fixed_payment',
  'notification',
  'support_case',
  'campaign_update',
  'admin_action',
  'enforcement',
  'relationship_touch',
  'refund',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const RELATIONSHIP_TOUCH_KINDS = [
  'campaign_introduction',
  'launch_eve_check',
  'mid_campaign_welcome',
  'close_thank_you',
  'post_campaign_debrief',
] as const;
export type RelationshipTouchKind = (typeof RELATIONSHIP_TOUCH_KINDS)[number];
