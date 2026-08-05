/**
 * Fulfillment, delivery-date changes, the Day 14 Progress Check, and the
 * one-strike Founder ghost ban — Spec §22.4, §22.5, §22.6, §22.7 (Phase 21a).
 *
 * This is the last stretch of the product lifecycle and the only place in the
 * codebase that can end a Founder's participation permanently. Three ideas
 * shape the whole module:
 *
 * ── 1. Every obligation is a deadline over a stored anchor ──────────────────
 * §22.5 gives the Founder four obligations and two of them carry a number: a
 * close confirmation within 48 hours, and an update at least every 30 days
 * from charge to delivery. §6 names NO setting for either, so — on 19a's
 * `TRANSFER_EARLIEST_DAY` precedent — the Spec's own number is the value and
 * it lives here as a pinned constant rather than as a settings row nobody
 * agreed to. The anchors are the dedicated columns §21 already requires
 * (`campaign_close_at`, the capture instant), never `created_at`.
 *
 * ── 2. The original delivery date is preserved by having nowhere to go ──────
 * §22.5's fourth obligation and §22.6's material-update contract both come
 * down to one guarantee: a revision never overwrites what was promised. So a
 * delivery commitment is an insert-only SEQUENCE — sequence 1 is the original
 * and is the row every later surface reads for "originally promised" — and the
 * approval path a revision must take is DERIVED (`deliveryChangePathFor`) from
 * the campaign type and whether the remaining payment has released, never
 * chosen by the party requesting the change (§33.10.2).
 *
 * ── 3. A permanent ban must be unreachable without a defined trigger ────────
 * §22.7 is one-strike and permanent, and the phase brief states the stake
 * plainly: a ban that fires on an undefined condition is not recoverable for
 * the Founder it hits. So `ghostBanTriggersMet` is a pure function over stored
 * facts that returns the triggers that are met — possibly none — and there is
 * no "discretionary" member of `GHOST_BAN_TRIGGERS` for an Admin to select.
 * Two of the four triggers are campaign-type-exclusive and the kernel enforces
 * that, so a Product campaign cannot fire the Idea trigger by any input
 * (§33.10.4). Where §22.7's wording joins conditions ("without an updated
 * timeline AND the required notice or approval", "failure to deliver PLUS
 * failure to communicate"), the kernel requires BOTH — for a permanent
 * sanction the conjunctive reading is the recoverable-side error.
 */

import type { CampaignType } from '../money/compensation.js';

/* ── §22.5 — the promised delivery mechanism ────────────────────────────────── */

/**
 * §22.5's seven digital fulfillment mechanisms, verbatim and exhaustive.
 *
 * A register rather than free text because §22.5 says fulfillment occurs
 * "through the promised mechanism" — which only means something if the promise
 * and the delivery name the same thing. The delivery record stores one of
 * these and the Backer's delivery notice renders its label, so "we delivered
 * what we said we would deliver" is checkable rather than asserted.
 */
export const DELIVERY_MECHANISMS = [
  'login_credentials',
  'download_link',
  'redemption_code',
  'beta_enrollment',
  'api_key',
  'invite_or_access_code',
  'course_book_or_file',
] as const;
export type DeliveryMechanism = (typeof DELIVERY_MECHANISMS)[number];

/** Customer-facing labels. §3.1: no internal token reaches a Backer. */
export const DELIVERY_MECHANISM_LABELS: Readonly<Record<DeliveryMechanism, string>> = {
  login_credentials: 'Login credentials',
  download_link: 'Download link',
  redemption_code: 'Redemption code',
  beta_enrollment: 'Beta enrollment',
  api_key: 'API key',
  invite_or_access_code: 'Invite or access code',
  course_book_or_file: 'Course, book, or file delivery',
};

/* ── §22.5 — the four Founder obligations ──────────────────────────────────── */

/** §22.5: "Send campaign-close confirmation within 48 hours." */
export const CLOSE_CONFIRMATION_WINDOW_HOURS = 48;

/** §22.5: "Post at least one update every 30 days from charge to delivery." */
export const UPDATE_CADENCE_DAYS = 30;

export interface FounderObligation {
  key: string;
  /** §22.5's own words. */
  label: string;
  /** What the record must contain for the obligation to be satisfied. */
  evidence: string;
}

/**
 * §22.5's four obligations as a register, so "all enforced or surfaced" is
 * assertable against the list rather than against a service's memory of it.
 * Every one resolves to a stored fact: three timestamps and a commitment
 * sequence. None of them is a judgement.
 */
export const FOUNDER_FULFILLMENT_OBLIGATIONS: readonly FounderObligation[] = [
  {
    key: 'close_confirmation',
    label: 'Send campaign-close confirmation within 48 hours',
    evidence: 'A published update recorded as the close confirmation, within 48 hours of close.',
  },
  {
    key: 'update_cadence',
    label: 'Post at least one update every 30 days from charge to delivery',
    evidence: 'A published update in every 30-day window between the charge and delivery.',
  },
  {
    key: 'delivery_notification',
    label: 'Send a delivery notification when access is granted',
    evidence: 'A recorded delivery with its mechanism and access instructions.',
  },
  {
    key: 'preserved_delivery_dates',
    label: 'Preserve original and revised delivery dates when a change occurs',
    evidence: 'An insert-only commitment sequence whose first row is the original promise.',
  },
] as const;

export const FOUNDER_OBLIGATION_KEYS = FOUNDER_FULFILLMENT_OBLIGATIONS.map((o) => o.key);

/** Whether an obligation is met, still open, or missed — never a bare boolean. */
export type ObligationState = 'met' | 'due' | 'overdue' | 'not_applicable';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * §22.5's 48-hour close confirmation, evaluated against the close anchor.
 * `not_applicable` where nothing was charged: a campaign that ended at US$0
 * has no Backer to confirm a close to, and reporting an overdue obligation
 * against one would be a promise the product does not owe (§1.4).
 */
export function closeConfirmationState(facts: {
  closeAt: Date | null;
  /** Whether any charge was captured — the obligation follows the money. */
  anyCaptured: boolean;
  sentAt: Date | null;
  now: Date;
}): { state: ObligationState; dueAt: Date | null } {
  if (!facts.closeAt || !facts.anyCaptured) return { state: 'not_applicable', dueAt: null };
  const dueAt = new Date(facts.closeAt.getTime() + CLOSE_CONFIRMATION_WINDOW_HOURS * HOUR_MS);
  if (facts.sentAt) return { state: 'met', dueAt };
  return { state: facts.now.getTime() > dueAt.getTime() ? 'overdue' : 'due', dueAt };
}

export interface UpdateCadenceResult {
  state: ObligationState;
  /** The instant the cadence window opened — the charge, or the last update. */
  lastCommunicationAt: Date | null;
  /** When the next update is due, or null where the obligation does not run. */
  nextDueAt: Date | null;
  /** Whole days since the last communication; null where not applicable. */
  daysSinceLastCommunication: number | null;
  /** Consecutive-silence days, the number §22.7's second trigger reads. */
  silentDays: number;
}

/**
 * §22.5's 30-day cadence, "from charge to delivery".
 *
 * The window runs from the capture instant and STOPS at delivery — after
 * access is granted the obligation is discharged, which is why a delivered
 * campaign reports `met` rather than accruing silence forever. The clock
 * restarts from the most recent published update, so the number this returns
 * is consecutive silence, which is exactly what §22.7's second trigger needs;
 * the two never disagree because there is one implementation.
 */
export function evaluateUpdateCadence(facts: {
  /** The capture instant — the charge §22.5 anchors on. Null before any charge. */
  chargedAt: Date | null;
  /** The most recent published update at or after the charge. */
  lastUpdateAt: Date | null;
  /** When access was granted; the cadence obligation ends here. */
  deliveredAt: Date | null;
  now: Date;
}): UpdateCadenceResult {
  if (!facts.chargedAt) {
    return {
      state: 'not_applicable',
      lastCommunicationAt: null,
      nextDueAt: null,
      daysSinceLastCommunication: null,
      silentDays: 0,
    };
  }

  const last =
    facts.lastUpdateAt && facts.lastUpdateAt.getTime() > facts.chargedAt.getTime()
      ? facts.lastUpdateAt
      : facts.chargedAt;
  const nextDueAt = new Date(last.getTime() + UPDATE_CADENCE_DAYS * DAY_MS);

  // "from charge to delivery" — delivery discharges the obligation. Silence is
  // measured up to the delivery instant, not up to now.
  const end = facts.deliveredAt ?? facts.now;
  const silentDays = Math.max(0, Math.floor((end.getTime() - last.getTime()) / DAY_MS));

  if (facts.deliveredAt) {
    return {
      state: 'met',
      lastCommunicationAt: last,
      nextDueAt: null,
      daysSinceLastCommunication: silentDays,
      silentDays,
    };
  }

  return {
    state: facts.now.getTime() > nextDueAt.getTime() ? 'overdue' : 'due',
    lastCommunicationAt: last,
    nextDueAt,
    daysSinceLastCommunication: silentDays,
    silentDays,
  };
}

/* ── §22.5 — the Backer delivery notification ──────────────────────────────── */

export interface DeliveryNoticeItem {
  key: string;
  /** §22.5's own words for what the delivery email repeats. */
  label: string;
}

/**
 * §22.5: the Backer delivery email "repeats reward, access instructions,
 * original commitment, Founder support, Proovd escalation, and a short
 * satisfaction response."
 *
 * The first five are this phase's and are required by the resolver below —
 * they are §33.10.1's contract. The satisfaction response is §31.8's and §27.5
 * makes it its OWN message ("Delivery and satisfaction survey" — two events,
 * two keys), so it is not smuggled into this body as a link to a control that
 * does not exist yet (§1.4). Phase 21b sends `backer_satisfaction_survey`.
 */
export const DELIVERY_NOTICE_ITEMS: readonly DeliveryNoticeItem[] = [
  { key: 'reward', label: 'The reward' },
  { key: 'access_instructions', label: 'Access instructions' },
  { key: 'original_commitment', label: 'The original delivery commitment' },
  { key: 'founder_support', label: 'Founder support route' },
  { key: 'proovd_escalation', label: 'Proovd escalation route' },
] as const;

export interface DeliveryNoticeVars {
  /** The reward title as the Backer bought it. */
  reward: string;
  /** The mechanism's label plus the Founder's own access instructions. */
  mechanism: DeliveryMechanism;
  accessInstructions: string;
  /** What was promised at reservation — sequence 1, never the revised value. */
  originalCommitment: string;
  /** How to reach the Founder, from the campaign's own support record. */
  founderSupport: string;
  /** How to reach Proovd — §29.10's route, never a substitute for the Founder's. */
  proovdEscalation: string;
}

export interface ResolvedDeliveryNotice {
  body: string;
  /** Named items and their resolved values, so a renderer cannot drop one. */
  items: readonly { key: string; label: string; value: string }[];
}

/**
 * Resolves §22.5's delivery notice. Throws on a blank item or an unresolved
 * marker — a delivery email missing the access instructions is the one message
 * in the product whose absence a Backer cannot work around, and §33.10.1 tests
 * that all five items are present.
 *
 * The original commitment is a required parameter rather than an optional one
 * for the same reason §22.5 names it: the revised date is what the Backer will
 * see everywhere else, and the delivery notice is where the original promise
 * has to survive.
 */
export function resolveDeliveryNotice(vars: DeliveryNoticeVars): ResolvedDeliveryNotice {
  const mechanismLabel = DELIVERY_MECHANISM_LABELS[vars.mechanism];
  if (!mechanismLabel) {
    throw new Error(`delivery notice mechanism is not a §22.5 mechanism: "${vars.mechanism}"`);
  }
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`delivery notice ${name} must be a non-empty string`);
    }
  }

  const values: Record<string, string> = {
    reward: vars.reward,
    access_instructions: `${mechanismLabel}: ${vars.accessInstructions}`,
    original_commitment: vars.originalCommitment,
    founder_support: vars.founderSupport,
    proovd_escalation: vars.proovdEscalation,
  };

  const items = DELIVERY_NOTICE_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    value: values[item.key] as string,
  }));

  const body = items.map((item) => `${item.label}: ${item.value}`).join('\n');
  const leftover = body.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`delivery notice has an unresolved marker: ${leftover[0]}`);
  }

  return { body, items };
}

/* ── §22.6 — delivery-date changes ─────────────────────────────────────────── */

/**
 * §22.6's two paths. Which one applies is a property of the campaign and the
 * payment state — never of the Founder's preference — so it is derived, and
 * the request service reads the derivation rather than accepting a path.
 */
export const DELIVERY_CHANGE_PATHS = ['admin_preapproval', 'notice_before_original_month'] as const;
export type DeliveryChangePath = (typeof DELIVERY_CHANGE_PATHS)[number];

/** §22.6: "Admin reviews within five business days." */
export const DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS = 5;

/**
 * §22.6, both halves:
 *
 * - "For Product Campaigns before remaining payment: Founder requests Admin
 *   approval before notifying Backers." → `admin_preapproval`.
 * - "After remaining payment: Founder must notify Backers before the original
 *   month passes. Admin preapproval is not required." →
 *   `notice_before_original_month`.
 *
 * An Idea Campaign has no remaining payment (§22.3's single payment), so it can
 * never be in the "before remaining payment" state the first branch describes;
 * it takes the notice path. That is why the type is a parameter — the branch
 * would otherwise be a Product rule silently applied to Idea campaigns.
 */
export function deliveryChangePathFor(facts: {
  campaignType: CampaignType;
  remainingPaymentReleased: boolean;
}): DeliveryChangePath {
  if (facts.campaignType === 'pre_launch' && !facts.remainingPaymentReleased) {
    return 'admin_preapproval';
  }
  return 'notice_before_original_month';
}

export interface MaterialUpdateField {
  key: string;
  /** §22.6's own words. */
  label: string;
}

/**
 * §22.6: "Material updates show previous date, revised date, reason, unchanged
 * obligations, next update date, and support/refund route."
 *
 * Six fields, all required. `unchanged_obligations` is the one a rushed
 * implementation drops, and it is the one that keeps a date change from
 * reading as a renegotiation of everything else.
 */
export const MATERIAL_UPDATE_FIELDS: readonly MaterialUpdateField[] = [
  { key: 'previous_date', label: 'Previous date' },
  { key: 'revised_date', label: 'Revised date' },
  { key: 'reason', label: 'Reason' },
  { key: 'unchanged_obligations', label: 'What is unchanged' },
  { key: 'next_update_date', label: 'Next update date' },
  { key: 'support_refund_route', label: 'Support and refund route' },
] as const;

export const MATERIAL_UPDATE_FIELD_KEYS = MATERIAL_UPDATE_FIELDS.map((f) => f.key);

/**
 * Names the §22.6 fields a material delivery update is missing. Returns an
 * empty array when complete — the caller refuses by name on anything else, so
 * the Founder reads which field is absent rather than a constraint name.
 */
export function missingMaterialUpdateFields(
  supplied: Readonly<Record<string, string | null | undefined>>,
): readonly string[] {
  return MATERIAL_UPDATE_FIELDS.filter(
    (f) => !supplied[f.key] || String(supplied[f.key]).trim().length === 0,
  ).map((f) => f.key);
}

/* ── §22.4 — the Day 14 Progress Check ─────────────────────────────────────── */

/**
 * §22.4 names the check "Day 14". §6 fixes `product_remaining_payment_day` for
 * the Product remaining payment and names NO separate setting for the review,
 * and §22.4 applies the review to EVERY campaign — including Idea campaigns,
 * whose §6 payment day is 3. So the review day is the Spec's own number, held
 * here as a constant (19a's `TRANSFER_EARLIEST_DAY` precedent) rather than
 * borrowed from a payment setting that governs something else.
 */
export const DAY_14_REVIEW_DAY = 14;

/** §22.4: "Unreachable for Admin clarification within five business days." */
export const DAY_14_CLARIFICATION_BUSINESS_DAYS = 5;

export interface Day14ChecklistItem {
  key: string;
  label: string;
  /** §22.4: the checklist is "with examples". An item without one is a demand. */
  example: string;
  required: boolean;
}

/**
 * §22.4's checklist, campaign-specific.
 *
 * Shared items first — §22.4's pass condition is "adequate progress/delivery
 * evidence AND required communication", so both are required for both types.
 * The Product-only item is §22.4's own sentence: "Product evidence may show
 * actual feature/reward access" — `may`, so it is offered and not required.
 *
 * §22.4 also says "Idea review is enforcement-only", which is a statement about
 * the CONSEQUENCE (there is no second payment to release), not about the
 * evidence. An Idea Founder is still asked for progress and communication; what
 * differs is what a pass unlocks and what a failure invokes.
 */
const DAY_14_SHARED_ITEMS: readonly Day14ChecklistItem[] = [
  {
    key: 'progress_evidence',
    label: 'Evidence of adequate progress or delivery',
    example:
      'Build screenshots with dates, a changelog, a staging link, manufacturing or production photos, or a delivery record.',
    required: true,
  },
  {
    key: 'required_communication',
    label: 'The updates you have posted since the charge',
    example:
      'Links to your published campaign updates, including the campaign-close confirmation.',
    required: true,
  },
  {
    key: 'delivery_timeline',
    label: 'Your current delivery timeline, and whether it has changed',
    example:
      'The month you disclosed, the month you are working to now, and — if they differ — the change you filed.',
    required: true,
  },
];

const DAY_14_PRODUCT_ITEMS: readonly Day14ChecklistItem[] = [
  {
    key: 'feature_or_reward_access',
    label: 'Actual feature or reward access, if it exists yet',
    example:
      'A working login, a redemption code, a beta invite, or a download a reviewer can open.',
    required: false,
  },
];

/**
 * The checklist for a campaign type. Admin and Founder read the SAME function
 * — §22.4: "Admin and Founder see the same checklist and evidence list" — so
 * there is no second list to drift.
 */
export function day14Checklist(campaignType: CampaignType): readonly Day14ChecklistItem[] {
  return campaignType === 'pre_launch'
    ? [...DAY_14_SHARED_ITEMS, ...DAY_14_PRODUCT_ITEMS]
    : DAY_14_SHARED_ITEMS;
}

/** Names the required checklist items a submission did not supply. */
export function missingDay14Items(
  campaignType: CampaignType,
  suppliedKeys: readonly string[],
): readonly string[] {
  const supplied = new Set(suppliedKeys);
  return day14Checklist(campaignType)
    .filter((item) => item.required && !supplied.has(item.key))
    .map((item) => item.key);
}

/** §22.4's five failure reasons, verbatim and exhaustive. */
export const DAY_14_FAILURE_REASONS = [
  'no_progress_evidence',
  'no_substantive_update_7_days',
  'unreachable_5_business_days',
  'bait_and_switch',
  'ghosting',
] as const;
export type Day14FailureReason = (typeof DAY_14_FAILURE_REASONS)[number];

export const DAY_14_FAILURE_LABELS: Readonly<Record<Day14FailureReason, string>> = {
  no_progress_evidence: 'No adequate progress evidence',
  no_substantive_update_7_days: 'No substantive update in the prior seven days',
  unreachable_5_business_days: 'Unreachable for Admin clarification within five business days',
  bait_and_switch: 'Material delivery bait-and-switch',
  ghosting: 'Ghosting',
};

/** §22.4: "No substantive update in the prior seven days." */
export const DAY_14_RECENT_UPDATE_DAYS = 7;

export const DAY_14_OUTCOMES = ['pass', 'fail'] as const;
export type Day14Outcome = (typeof DAY_14_OUTCOMES)[number];

export interface Day14Consequence {
  key: string;
  label: string;
  /** Whether this consequence is executed by the product or recorded by Admin. */
  automatic: boolean;
}

/**
 * §22.4's failure consequences, per campaign type.
 *
 * The Product list is §22.4's own: "block unreleased remaining payment and
 * start refund/reversal/recovery as applicable; attempt best-effort reversal
 * against released first payment when warranted." The Idea list is the other
 * branch: "no unreleased payment exists; use refunds, reversals, dispute
 * handling, or contractual recovery best-effort."
 *
 * `automatic: false` on every recovery line is the honest state and the whole
 * §31.7 posture: 20a made every refund an Admin-recorded case with a cause and
 * a preview, and a Day-14 failure OPENS that path rather than executing money
 * movements on a review outcome. Only the payment block is automatic, because
 * blocking is a refusal and refusals can be structural.
 *
 * The two lists differ by exactly the item that cannot exist on an Idea
 * campaign, which is what §33.10.3 compares.
 */
const DAY_14_PRODUCT_CONSEQUENCES: readonly Day14Consequence[] = [
  {
    key: 'block_remaining_payment',
    label: 'Block the unreleased remaining payment',
    automatic: true,
  },
  {
    key: 'start_refund_reversal_recovery',
    label: 'Start refund, reversal, or recovery as applicable',
    automatic: false,
  },
  {
    key: 'best_effort_first_payment_reversal',
    label: 'Attempt best-effort reversal against the released first payment when warranted',
    automatic: false,
  },
];

const DAY_14_IDEA_CONSEQUENCES: readonly Day14Consequence[] = [
  {
    key: 'start_refund_reversal_recovery',
    label:
      'Use refunds, reversals, dispute handling, or contractual recovery, best-effort — no unreleased payment exists',
    automatic: false,
  },
];

export function day14FailureConsequences(
  campaignType: CampaignType,
): readonly Day14Consequence[] {
  return campaignType === 'pre_launch' ? DAY_14_PRODUCT_CONSEQUENCES : DAY_14_IDEA_CONSEQUENCES;
}

/**
 * §22.4: "Idea review is enforcement-only." True by the absence of an
 * unreleased payment on the Idea branch, and exported so a surface can state
 * it rather than a reader inferring it from an empty list.
 */
export function day14BlocksAPayment(campaignType: CampaignType): boolean {
  return campaignType === 'pre_launch';
}

/**
 * §22.4's pass condition, stated as a rule rather than left to a checkbox:
 * "Pass requires adequate progress/delivery evidence AND required
 * communication." Both are Admin judgements over the submitted evidence — the
 * product does not score them (§1 rule 6) — but a pass recorded with either
 * one false is refused, so the outcome and the findings can never disagree.
 */
export function day14OutcomeIsConsistent(facts: {
  outcome: Day14Outcome;
  adequateProgressEvidence: boolean;
  requiredCommunication: boolean;
  failureReasons: readonly Day14FailureReason[];
}): { ok: true } | { ok: false; problem: string } {
  if (facts.outcome === 'pass') {
    if (!facts.adequateProgressEvidence) {
      return { ok: false, problem: 'pass_requires_adequate_progress_evidence' };
    }
    if (!facts.requiredCommunication) {
      return { ok: false, problem: 'pass_requires_required_communication' };
    }
    if (facts.failureReasons.length > 0) {
      return { ok: false, problem: 'pass_cannot_carry_failure_reasons' };
    }
    return { ok: true };
  }
  if (facts.failureReasons.length === 0) {
    return { ok: false, problem: 'fail_requires_at_least_one_failure_reason' };
  }
  for (const reason of facts.failureReasons) {
    if (!DAY_14_FAILURE_REASONS.includes(reason)) {
      return { ok: false, problem: `unknown_failure_reason:${reason}` };
    }
  }
  return { ok: true };
}

/* ── §22.7 — the one-strike Founder ghost ban ──────────────────────────────── */

/**
 * §22.7's four triggers, verbatim and exhaustive. There is deliberately no
 * fifth member and no `other`/`discretionary` value: the enum IS the guarantee
 * that a ban cannot be recorded against a condition nobody defined, and
 * §33.10.4 tests exactly that.
 */
export const GHOST_BAN_TRIGGERS = [
  'failed_day_14',
  'silent_30_days_post_payment',
  'product_30_days_past_delivery_month',
  'idea_window_missed_and_no_timeline',
] as const;
export type GhostBanTrigger = (typeof GHOST_BAN_TRIGGERS)[number];

export const GHOST_BAN_TRIGGER_LABELS: Readonly<Record<GhostBanTrigger, string>> = {
  failed_day_14: 'A failed Day 14 Progress Check',
  silent_30_days_post_payment: 'Silence for 30 or more consecutive days after payment',
  product_30_days_past_delivery_month:
    'More than 30 days past the disclosed delivery month with no updated timeline and no required notice or approval',
  idea_window_missed_and_no_timeline:
    'Delivery not made by the end of the window, and no updated timeline communicated within 30 days',
};

/**
 * Which campaign type each trigger can fire on. Two of §22.7's four name their
 * type explicitly, and the kernel gates on this map rather than on an `if` a
 * later edit could drop — a Product campaign firing the Idea trigger would be
 * a permanent ban on an undefined condition, which is the exact failure
 * §33.10.4 exists to prevent.
 */
export const GHOST_BAN_TRIGGER_CAMPAIGN_TYPES: Readonly<
  Record<GhostBanTrigger, readonly CampaignType[]>
> = {
  failed_day_14: ['pre_build', 'pre_launch'],
  silent_30_days_post_payment: ['pre_build', 'pre_launch'],
  product_30_days_past_delivery_month: ['pre_launch'],
  idea_window_missed_and_no_timeline: ['pre_build'],
};

/** §22.7: "Silent for 30+ consecutive days post-payment." */
export const GHOST_BAN_SILENCE_DAYS = 30;

/** §22.7: "more than 30 days past disclosed delivery month"; Idea: "within 30 days". */
export const GHOST_BAN_DELIVERY_GRACE_DAYS = 30;

export interface GhostBanFacts {
  campaignType: CampaignType;
  /** A recorded Day 14 review whose outcome was `fail`. */
  day14Failed: boolean;
  /**
   * The instant a Founder payment was released. §22.7's second trigger is
   * "post-payment": with nothing released there is no anchor and the trigger
   * cannot fire.
   */
  paymentReleasedAt: Date | null;
  /** The most recent Founder communication — the cadence kernel's last update. */
  lastCommunicationAt: Date | null;
  /**
   * The last day of the disclosed delivery month — sequence 1 of the commitment
   * record. Null when no month was disclosed, which makes the third trigger
   * unfireable rather than fireable against an assumed date.
   */
  disclosedDeliveryMonthEnd: Date | null;
  /** The end of the Idea delivery window, where one was committed. */
  ideaDeliveryWindowEnd: Date | null;
  /** Whether access has been granted. */
  deliveredAt: Date | null;
  /** Whether a revision (commitment sequence > 1) was recorded. */
  updatedTimelineAt: Date | null;
  /**
   * Whether the revision took its required path to completion — Admin approval
   * where §22.6 requires it, Backer notice where it does not.
   */
  requiredNoticeOrApprovalComplete: boolean;
  now: Date;
}

/**
 * Returns the §22.7 triggers that are met — possibly none.
 *
 * Every branch is a comparison between stored timestamps. There is no branch
 * that reads a note, a score, or an Admin's impression, so "seems inactive"
 * has nowhere to enter. A caller with no met trigger must refuse to ban; the
 * service does, by name.
 */
export function ghostBanTriggersMet(facts: GhostBanFacts): readonly GhostBanTrigger[] {
  const met: GhostBanTrigger[] = [];
  const allows = (trigger: GhostBanTrigger) =>
    GHOST_BAN_TRIGGER_CAMPAIGN_TYPES[trigger].includes(facts.campaignType);

  // 1. "Failed Day 14 Progress Check."
  if (facts.day14Failed && allows('failed_day_14')) met.push('failed_day_14');

  // 2. "Silent for 30+ consecutive days post-payment." The window opens at the
  //    payment and restarts at each communication; delivery discharges it,
  //    because a delivered campaign owes no further progress update (§22.5's
  //    "from charge to delivery").
  if (facts.paymentReleasedAt && !facts.deliveredAt && allows('silent_30_days_post_payment')) {
    const since =
      facts.lastCommunicationAt &&
      facts.lastCommunicationAt.getTime() > facts.paymentReleasedAt.getTime()
        ? facts.lastCommunicationAt
        : facts.paymentReleasedAt;
    const silentDays = Math.floor((facts.now.getTime() - since.getTime()) / DAY_MS);
    if (silentDays >= GHOST_BAN_SILENCE_DAYS) met.push('silent_30_days_post_payment');
  }

  // 3. Product: "more than 30 days past disclosed delivery month without an
  //    updated timeline and the required notice or approval." Conjunctive: a
  //    Founder who filed a revision AND completed its required path has not
  //    met this trigger, however late the delivery is — the lateness is a
  //    §22.4/§22.6 matter, not a permanent ban.
  if (
    allows('product_30_days_past_delivery_month') &&
    facts.disclosedDeliveryMonthEnd &&
    !facts.deliveredAt
  ) {
    const graceEnd = new Date(
      facts.disclosedDeliveryMonthEnd.getTime() + GHOST_BAN_DELIVERY_GRACE_DAYS * DAY_MS,
    );
    const past = facts.now.getTime() > graceEnd.getTime();
    const excused = Boolean(facts.updatedTimelineAt) && facts.requiredNoticeOrApprovalComplete;
    if (past && !excused) met.push('product_30_days_past_delivery_month');
  }

  // 4. Idea: "failure to deliver by end of window PLUS failure to communicate
  //    an updated timeline within 30 days." Both halves required — the Spec's
  //    own "plus".
  if (
    allows('idea_window_missed_and_no_timeline') &&
    facts.ideaDeliveryWindowEnd &&
    !facts.deliveredAt
  ) {
    const windowMissed = facts.now.getTime() > facts.ideaDeliveryWindowEnd.getTime();
    const timelineDeadline = new Date(
      facts.ideaDeliveryWindowEnd.getTime() + GHOST_BAN_DELIVERY_GRACE_DAYS * DAY_MS,
    );
    const communicatedInTime =
      facts.updatedTimelineAt !== null &&
      facts.updatedTimelineAt.getTime() <= timelineDeadline.getTime();
    // The second half is only decidable once the 30 days have run out.
    const graceElapsed = facts.now.getTime() > timelineDeadline.getTime();
    if (windowMissed && graceElapsed && !communicatedInTime) {
      met.push('idea_window_missed_and_no_timeline');
    }
  }

  return met;
}

export interface GhostBanRecordFields {
  key: string;
  /** §22.7's own words. */
  label: string;
}

/**
 * §22.7: "Admin records trigger, evidence, notice, payment/recovery status,
 * and enforcement decision." Five fields, all required — the register makes
 * "fully audited" (§33.10.4) assertable against a list rather than against a
 * migration nobody re-reads.
 */
export const GHOST_BAN_RECORD_FIELDS: readonly GhostBanRecordFields[] = [
  { key: 'trigger', label: 'Trigger' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'notice', label: 'Notice given to the Founder' },
  { key: 'payment_recovery_status', label: 'Payment and recovery status' },
  { key: 'enforcement_decision', label: 'Enforcement decision' },
] as const;

export const GHOST_BAN_RECORD_FIELD_KEYS = GHOST_BAN_RECORD_FIELDS.map((f) => f.key);

/**
 * §22.7 is permanent and one-strike. Stated as a constant so a surface renders
 * the consequence in the Spec's own terms rather than softening it, and so no
 * phase adds a lift path by accident — there is no `liftGhostBan`, and §1
 * rule 6 forbids inventing one.
 */
export const GHOST_BAN_PERMANENT_SENTENCE =
  'This ban is permanent. Proovd operates a one-strike policy for Founders who stop delivering and stop communicating after Backers have been charged.';
