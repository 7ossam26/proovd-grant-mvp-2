/**
 * Support, enforcement, and the chronological timeline — §26.7, §26.8, §27.8.
 *
 * Three registers and one piece of exact customer copy.
 *
 * ── The SLA is a business-day deadline, so it obeys §29.6 ───────────────────
 * §27.8's published promise is "We respond within one (1) business day,
 * Monday–Friday, excluding U.S. federal holidays." That is a business-day
 * deadline in exactly the sense §29.6 means, so a case's human-response due time
 * is computed from the committed versioned holiday calendar and stored with the
 * version that produced it — and a later calendar change moves future cases,
 * never a promise already made to someone. It is the §29.6 replacement window's
 * rule applied to a support case, which is why both read the same calendar.
 */

/* ── §26.7 case topics ─────────────────────────────────────────────────────── */

/**
 * What a case is about.
 *
 * Drawn from the situations the Spec actually names — §29.9's unknown charge,
 * §29.10's not-as-described reward, §20's cancellation, §13's refund, §22.5's
 * fulfillment, §31.8's dissatisfaction follow-up — plus `other`, because §1 rule
 * 6 forbids inventing an eligibility scheme and a closed list with no escape
 * would push an Admin to file a real case under a wrong label. `other` carries
 * the same SLA as everything else.
 */
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

/** Human labels. Customer-facing — no internal vocabulary (§3.1). */
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

/**
 * Who owns the next response.
 *
 * §26.7 lets Admin "own/reroute support cases", and B.8 names the two owners a
 * customer may be told about: `PROOVD SUPPORT` or `FOUNDER, coordinated by
 * Proovd`. The second is not "the Founder owns it" — §30 defers direct
 * Founder–Backer contact and §19 routes the Founder support form through Proovd,
 * so Proovd stays in the middle even when the Founder is the one who has to
 * answer. That is what the 48-hour follow-up rule exists for.
 */
export const SUPPORT_OWNERS = ['proovd_support', 'founder_coordinated'] as const;
export type SupportOwner = (typeof SUPPORT_OWNERS)[number];

/** The exact wording B.8 puts on the `Owner:` line. */
export const SUPPORT_OWNER_LABELS: Readonly<Record<SupportOwner, string>> = {
  proovd_support: 'PROOVD SUPPORT',
  founder_coordinated: 'FOUNDER, coordinated by Proovd',
};

/**
 * §26.7's lifecycle.
 *
 * `awaiting_founder` is its own state rather than a flag on `open`, because it
 * is the state the 48-hour rule is about — and a case that has been waiting on a
 * Founder for three days is a different operational fact from one Proovd has not
 * looked at. `resolved` is not `closed`: §27.8 requires an update at the
 * promised checkpoint "even without resolution", so a case can be updated many
 * times before it ends.
 */
export const SUPPORT_CASE_STATUSES = [
  'open',
  'awaiting_founder',
  'awaiting_customer',
  'resolved',
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

/**
 * §27.8's two published commitments, as numbers the code reads rather than
 * retypes.
 *
 * Neither is a §6 setting: §6 names roughly thirty operating constants and
 * neither of these is among them — they are published in the footer contact
 * block and in Appendix B.8, which makes them promises already made rather than
 * operator-configurable values. Changing one means changing published copy, and
 * that is a Spec change, not a settings change.
 */
export const SUPPORT_RESPONSE_BUSINESS_DAYS = 1;
export const FOUNDER_FOLLOWUP_HOURS = 48;

/* ── Appendix B.8 — exact text ─────────────────────────────────────────────── */

/**
 * The support acknowledgement, verbatim from Appendix B.8.
 *
 * Pinned against the Spec by test, beside Appendix A.5's listing consent, A.1's
 * trust strip, A.3/A.4's pre-order consents, and §27.8's contact block. Only the
 * three named variables are substituted, and the resolver refuses a value that
 * would leave a bracket in the rendered text — an acknowledgement that says
 * "case [CASE ID]" has acknowledged nothing.
 */
export const SUPPORT_ACKNOWLEDGEMENT_TEMPLATE = `We received your message — case [CASE ID].

Topic: [CATEGORY]
Owner: [PROOVD SUPPORT / FOUNDER, coordinated by Proovd]
Human response due: [LOCAL DATE/TIME]
If the founder needs to respond, we will follow up after 48 hours if you have not heard back.

Reply to this message to keep everything in one case.`;

export interface SupportAcknowledgementInput {
  caseReference: string;
  topic: SupportTopic;
  owner: SupportOwner;
  /** Already formatted for the reader, local primary with UTC secondary (§27.1). */
  humanResponseDue: string;
}

/**
 * Fill B.8's three variables.
 *
 * The `Owner:` line in the appendix reads `[PROOVD SUPPORT / FOUNDER,
 * coordinated by Proovd]` — a bracketed either/or, not two lines. Substituting
 * the whole bracket with the resolved owner is what the appendix asks for;
 * leaving both and hoping the reader picks would be shipping the placeholder.
 */
export function resolveSupportAcknowledgement(input: SupportAcknowledgementInput): string {
  const rendered = SUPPORT_ACKNOWLEDGEMENT_TEMPLATE.replaceAll('[CASE ID]', input.caseReference)
    .replaceAll('[CATEGORY]', SUPPORT_TOPIC_LABELS[input.topic])
    .replaceAll(
      '[PROOVD SUPPORT / FOUNDER, coordinated by Proovd]',
      SUPPORT_OWNER_LABELS[input.owner],
    )
    .replaceAll('[LOCAL DATE/TIME]', input.humanResponseDue);

  if (/\[[A-Z][A-Z /,]*\]/.test(rendered)) {
    throw new Error('support acknowledgement still contains an unresolved variable');
  }
  return rendered;
}

/* ── §26.8 handoff note ────────────────────────────────────────────────────── */

/**
 * The four things §26.8 requires when a case changes Admin owner.
 *
 * "require a handoff note containing verified facts, current owner, the next
 * customer promise, and the statements that must remain consistent."
 *
 * All four are required text, not optional fields — a handoff note with three of
 * them is the thing §26.8 was written to prevent, because the fourth is usually
 * the one that stops the new owner contradicting what the customer was already
 * told.
 */
export const HANDOFF_NOTE_FIELDS = [
  'verified_facts',
  'current_owner',
  'next_customer_promise',
  'statements_to_keep_consistent',
] as const;
export type HandoffNoteField = (typeof HANDOFF_NOTE_FIELDS)[number];

export const HANDOFF_NOTE_PROMPTS: Readonly<Record<HandoffNoteField, string>> = {
  verified_facts:
    'What has actually been confirmed — amounts, dates, provider outcomes — as distinct from what was assumed.',
  current_owner: 'Who is taking this over, and from whom.',
  next_customer_promise:
    'What this person has been told will happen next, and by when. The new owner inherits this promise.',
  statements_to_keep_consistent:
    'What has already been said that must not now be contradicted. This is the one that stops a second answer.',
};

/* ── §26.7 suspend and kill ────────────────────────────────────────────────── */

/**
 * §26.7's reason categories, verbatim from its own list.
 *
 * "Suspend/kill for AUP, fraud, Founder request, provider risk, deceptive
 * marketing, manipulation, sanctions/regulatory concern, or other reviewed
 * reason."
 *
 * Eight, because §26.7 names eight. `other_reviewed` is the Spec's own escape
 * and it carries the same free-text requirement as the rest — §26.7: "Kill/
 * suspend requires reason category + free text." A category alone is a
 * classification nobody can review; free text alone is a decision nobody can
 * count.
 */
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

export const ENFORCEMENT_REASON_LABELS: Readonly<Record<EnforcementReasonCategory, string>> = {
  aup_violation: 'Acceptable-use policy violation',
  fraud: 'Fraud',
  founder_request: 'Founder request',
  provider_risk: 'Provider risk',
  deceptive_marketing: 'Deceptive marketing',
  manipulation: 'Manipulation',
  sanctions_regulatory: 'Sanctions or regulatory concern',
  other_reviewed: 'Other reviewed reason',
};

/** §23.1 gives both as lifecycle states; §26.7 gives them different consequences. */
export const ENFORCEMENT_ACTIONS = ['suspend', 'kill'] as const;
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number];

/**
 * Which §26.7 consequence set applies, decided by whether money has moved.
 *
 * "Pre-capture: close active reservations without charge… Post-capture: invoke
 * refund/reversal/recovery policy…" These are not two severities of the same
 * action — they are different operations, and reading a post-capture campaign as
 * pre-capture would close reservations that have already been charged.
 */
export const ENFORCEMENT_PHASES = ['pre_capture', 'post_capture'] as const;
export type EnforcementPhase = (typeof ENFORCEMENT_PHASES)[number];

/**
 * §26.7's pre-capture effects, as a register so the suite asserts the set rather
 * than the implementation's memory of it.
 */
export const PRE_CAPTURE_EFFECTS = [
  'close_active_reservations_without_charge',
  'block_future_payment_intents',
  'reference_safe_detach',
  'notify_affected_roles',
  'preserve_page_with_banner',
] as const;
export type PreCaptureEffect = (typeof PRE_CAPTURE_EFFECTS)[number];

/* ── §26.8 chronological timeline ──────────────────────────────────────────── */

/**
 * The event kinds §26.8 asks a timeline to compose.
 *
 * §26.8's own words: "One read-only timeline per campaign/reservation/
 * association **composes existing events**." So this register names where each
 * kind is read *from*; nothing here is a table of its own. A second event store
 * that drifts from the first is worse than no timeline — the phase trap says so
 * — which is why the timeline has no writer and no `timeline_events` table.
 */
export interface TimelineSource {
  readonly kind: string;
  readonly label: string;
  readonly specRef: string;
  /** The existing table this is read from. Never a new store. */
  readonly composedFrom: string;
}

export const TIMELINE_SOURCES: readonly TimelineSource[] = [
  {
    kind: 'campaign_status',
    label: 'Campaign lifecycle',
    specRef: '§23.1',
    composedFrom: 'campaign_status_history',
  },
  {
    kind: 'association_status',
    label: 'Creator relationship',
    specRef: '§23.4',
    composedFrom: 'association_status_history',
  },
  {
    kind: 'reservation_status',
    label: 'Pre-order lifecycle',
    specRef: '§23.5',
    composedFrom: 'reservation_status_history',
  },
  {
    kind: 'invitation_send',
    label: 'Invitations and drafts',
    specRef: '§7, §8',
    composedFrom: 'campaign_invitation_sends, affiliate_invitation_sends',
  },
  {
    kind: 'kit_access',
    label: 'Campaign kit access',
    specRef: '§31.5',
    composedFrom: 'campaign_kit_access',
  },
  {
    kind: 'interview',
    label: 'Interview',
    specRef: '§12',
    composedFrom: 'founder_interview_booking_events',
  },
  {
    kind: 'review',
    label: 'Review rounds',
    specRef: '§15',
    composedFrom: 'campaign_reviews',
  },
  {
    kind: 'proposal',
    label: 'Proposals and decisions',
    specRef: '§14.2',
    composedFrom: 'proposal_versions',
  },
  {
    kind: 'first_post',
    label: 'First-post verification',
    specRef: '§17',
    composedFrom: 'creator_post_submissions',
  },
  {
    kind: 'payment_flag',
    label: 'Payment and reconciliation flags',
    specRef: '§23.3',
    composedFrom: 'campaign_payment_flags',
  },
  {
    kind: 'listing_payment',
    label: 'Listing fee',
    specRef: '§24.6',
    composedFrom: 'listing_fee_payments, listing_fee_refunds',
  },
  {
    kind: 'fixed_payment',
    label: 'Fixed Creator payment',
    specRef: '§24.7',
    composedFrom: 'creator_payment_funding_attempts',
  },
  {
    kind: 'notification',
    label: 'Emails, delivery state, and suppression',
    specRef: '§27.2',
    composedFrom: 'notification_deliveries',
  },
  {
    kind: 'support_case',
    label: 'Support cases',
    specRef: '§26.7, §27.8',
    composedFrom: 'support_cases, support_case_messages',
  },
  {
    kind: 'campaign_update',
    label: 'Campaign updates',
    specRef: '§18',
    composedFrom: 'campaign_updates',
  },
  {
    kind: 'admin_action',
    label: 'Admin actions and overrides',
    specRef: '§25.6, §33.12.4',
    composedFrom: 'audit_events, admin_overrides',
  },
  {
    kind: 'enforcement',
    label: 'Suspension and kill',
    specRef: '§26.7, §29.7',
    composedFrom: 'campaign_enforcement_actions',
  },
  {
    kind: 'relationship_touch',
    label: 'Human relationship touches',
    specRef: '§26.8',
    composedFrom: 'relationship_touches',
  },
  {
    kind: 'refund',
    label: 'Refunds and cause allocation',
    specRef: '§24.8',
    composedFrom: 'reservation_refunds, refund_cause_allocations',
  },
] as const;

export type TimelineKind = (typeof TIMELINE_SOURCES)[number]['kind'];

/**
 * §26.8's first-cohort human touches.
 *
 * "Admin may log one-time human relationship touches such as campaign
 * introduction, launch-eve check, mid-campaign welcome, close thank-you, and
 * post-campaign debrief; these are personal service events, not automated
 * engagement spam."
 *
 * Five, exactly as named. They are **loggable one-offs**: each may be recorded
 * once per campaign, there is no schedule, no template, no recurrence field, and
 * no job that sends one. §30 forbids automated engagement, and the moment a
 * touch could be scheduled it would have stopped being a personal service event.
 * The absence of a scheduling affordance is the enforcement.
 */
export const RELATIONSHIP_TOUCH_KINDS = [
  'campaign_introduction',
  'launch_eve_check',
  'mid_campaign_welcome',
  'close_thank_you',
  'post_campaign_debrief',
] as const;
export type RelationshipTouchKind = (typeof RELATIONSHIP_TOUCH_KINDS)[number];

export const RELATIONSHIP_TOUCH_LABELS: Readonly<Record<RelationshipTouchKind, string>> = {
  campaign_introduction: 'Campaign introduction',
  launch_eve_check: 'Launch-eve check',
  mid_campaign_welcome: 'Mid-campaign welcome',
  close_thank_you: 'Close thank-you',
  post_campaign_debrief: 'Post-campaign debrief',
};
