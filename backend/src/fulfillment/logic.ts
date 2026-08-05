/**
 * The Phase 21a registers and kernels, restated for the backend — Spec §22.4,
 * §22.5, §22.6, §22.7.
 *
 * The backend cannot import `@proovd/shared` at runtime (it exports TypeScript
 * source; the production image ships only `backend/dist`), so the registers are
 * restated here and drift-tested against the shared module in
 * `tests/fulfillment.test.ts` — the same arrangement the state enums, the §6
 * settings, the notification keys, the §21 close registers, and 20a/20b's
 * refund and enforcement registers already use.
 *
 * Nothing in this file reads the database. Every function is pure over the
 * facts a caller gathered, which is what makes §33.10.4's "only under the
 * defined conditions" assertable as a property of a function rather than as a
 * claim about a service.
 */

export type CampaignType = 'pre_build' | 'pre_launch';

/* ── §22.5 — the promised delivery mechanism ────────────────────────────────── */

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

export const CLOSE_CONFIRMATION_WINDOW_HOURS = 48;
export const UPDATE_CADENCE_DAYS = 30;

export interface FounderObligation {
  key: string;
  label: string;
  evidence: string;
}

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

export type ObligationState = 'met' | 'due' | 'overdue' | 'not_applicable';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function closeConfirmationState(facts: {
  closeAt: Date | null;
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
  lastCommunicationAt: Date | null;
  nextDueAt: Date | null;
  daysSinceLastCommunication: number | null;
  silentDays: number;
}

export function evaluateUpdateCadence(facts: {
  chargedAt: Date | null;
  lastUpdateAt: Date | null;
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
  label: string;
}

export const DELIVERY_NOTICE_ITEMS: readonly DeliveryNoticeItem[] = [
  { key: 'reward', label: 'The reward' },
  { key: 'access_instructions', label: 'Access instructions' },
  { key: 'original_commitment', label: 'The original delivery commitment' },
  { key: 'founder_support', label: 'Founder support route' },
  { key: 'proovd_escalation', label: 'Proovd escalation route' },
] as const;

export interface DeliveryNoticeVars {
  reward: string;
  mechanism: DeliveryMechanism;
  accessInstructions: string;
  originalCommitment: string;
  founderSupport: string;
  proovdEscalation: string;
}

export interface ResolvedDeliveryNotice {
  body: string;
  items: readonly { key: string; label: string; value: string }[];
}

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

export const DELIVERY_CHANGE_PATHS = ['admin_preapproval', 'notice_before_original_month'] as const;
export type DeliveryChangePath = (typeof DELIVERY_CHANGE_PATHS)[number];

export const DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS = 5;

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
  label: string;
}

export const MATERIAL_UPDATE_FIELDS: readonly MaterialUpdateField[] = [
  { key: 'previous_date', label: 'Previous date' },
  { key: 'revised_date', label: 'Revised date' },
  { key: 'reason', label: 'Reason' },
  { key: 'unchanged_obligations', label: 'What is unchanged' },
  { key: 'next_update_date', label: 'Next update date' },
  { key: 'support_refund_route', label: 'Support and refund route' },
] as const;

export const MATERIAL_UPDATE_FIELD_KEYS = MATERIAL_UPDATE_FIELDS.map((f) => f.key);

export function missingMaterialUpdateFields(
  supplied: Readonly<Record<string, string | null | undefined>>,
): readonly string[] {
  return MATERIAL_UPDATE_FIELDS.filter(
    (f) => !supplied[f.key] || String(supplied[f.key]).trim().length === 0,
  ).map((f) => f.key);
}

/* ── §22.4 — the Day 14 Progress Check ─────────────────────────────────────── */

export const DAY_14_REVIEW_DAY = 14;
export const DAY_14_CLARIFICATION_BUSINESS_DAYS = 5;
export const DAY_14_RECENT_UPDATE_DAYS = 7;

export interface Day14ChecklistItem {
  key: string;
  label: string;
  example: string;
  required: boolean;
}

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

export function day14Checklist(campaignType: CampaignType): readonly Day14ChecklistItem[] {
  return campaignType === 'pre_launch'
    ? [...DAY_14_SHARED_ITEMS, ...DAY_14_PRODUCT_ITEMS]
    : DAY_14_SHARED_ITEMS;
}

export function missingDay14Items(
  campaignType: CampaignType,
  suppliedKeys: readonly string[],
): readonly string[] {
  const supplied = new Set(suppliedKeys);
  return day14Checklist(campaignType)
    .filter((item) => item.required && !supplied.has(item.key))
    .map((item) => item.key);
}

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

export const DAY_14_OUTCOMES = ['pass', 'fail'] as const;
export type Day14Outcome = (typeof DAY_14_OUTCOMES)[number];

export interface Day14Consequence {
  key: string;
  label: string;
  automatic: boolean;
}

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

export function day14FailureConsequences(campaignType: CampaignType): readonly Day14Consequence[] {
  return campaignType === 'pre_launch' ? DAY_14_PRODUCT_CONSEQUENCES : DAY_14_IDEA_CONSEQUENCES;
}

export function day14BlocksAPayment(campaignType: CampaignType): boolean {
  return campaignType === 'pre_launch';
}

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

export const GHOST_BAN_TRIGGER_CAMPAIGN_TYPES: Readonly<
  Record<GhostBanTrigger, readonly CampaignType[]>
> = {
  failed_day_14: ['pre_build', 'pre_launch'],
  silent_30_days_post_payment: ['pre_build', 'pre_launch'],
  product_30_days_past_delivery_month: ['pre_launch'],
  idea_window_missed_and_no_timeline: ['pre_build'],
};

export const GHOST_BAN_SILENCE_DAYS = 30;
export const GHOST_BAN_DELIVERY_GRACE_DAYS = 30;

export interface GhostBanFacts {
  campaignType: CampaignType;
  day14Failed: boolean;
  paymentReleasedAt: Date | null;
  lastCommunicationAt: Date | null;
  disclosedDeliveryMonthEnd: Date | null;
  ideaDeliveryWindowEnd: Date | null;
  deliveredAt: Date | null;
  updatedTimelineAt: Date | null;
  requiredNoticeOrApprovalComplete: boolean;
  now: Date;
}

export function ghostBanTriggersMet(facts: GhostBanFacts): readonly GhostBanTrigger[] {
  const met: GhostBanTrigger[] = [];
  const allows = (trigger: GhostBanTrigger) =>
    GHOST_BAN_TRIGGER_CAMPAIGN_TYPES[trigger].includes(facts.campaignType);

  if (facts.day14Failed && allows('failed_day_14')) met.push('failed_day_14');

  if (facts.paymentReleasedAt && !facts.deliveredAt && allows('silent_30_days_post_payment')) {
    const since =
      facts.lastCommunicationAt &&
      facts.lastCommunicationAt.getTime() > facts.paymentReleasedAt.getTime()
        ? facts.lastCommunicationAt
        : facts.paymentReleasedAt;
    const silentDays = Math.floor((facts.now.getTime() - since.getTime()) / DAY_MS);
    if (silentDays >= GHOST_BAN_SILENCE_DAYS) met.push('silent_30_days_post_payment');
  }

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
    const graceElapsed = facts.now.getTime() > timelineDeadline.getTime();
    if (windowMissed && graceElapsed && !communicatedInTime) {
      met.push('idea_window_missed_and_no_timeline');
    }
  }

  return met;
}

export interface GhostBanRecordFields {
  key: string;
  label: string;
}

export const GHOST_BAN_RECORD_FIELDS: readonly GhostBanRecordFields[] = [
  { key: 'trigger', label: 'Trigger' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'notice', label: 'Notice given to the Founder' },
  { key: 'payment_recovery_status', label: 'Payment and recovery status' },
  { key: 'enforcement_decision', label: 'Enforcement decision' },
] as const;

export const GHOST_BAN_RECORD_FIELD_KEYS = GHOST_BAN_RECORD_FIELDS.map((f) => f.key);

export const GHOST_BAN_PERMANENT_SENTENCE =
  'This ban is permanent. Proovd operates a one-strike policy for Founders who stop delivering and stop communicating after Backers have been charged.';
