/**
 * The §22.3 registers and kernels, restated for the backend runtime —
 * `shared/src/close/founder-payments.ts` owns them; the backend cannot import
 * `@proovd/shared` at runtime (the constraint `restated.ts` documents), so
 * they are restated verbatim here and the founder-payments suite compares
 * them value-for-value with the shared originals.
 */

import { percentOfCents } from './logic.js';

/* ── §22.3: the W-9 record ─────────────────────────────────────────────────── */

export const W9_STATUSES = ['requested', 'submitted', 'verified'] as const;
export type W9Status = (typeof W9_STATUSES)[number];

export const W9_STATE_TRANSITIONS: Readonly<Record<W9Status, readonly W9Status[]>> = {
  requested: ['submitted'],
  submitted: ['verified', 'requested'],
  verified: [],
};

export function canMoveW9State(from: W9Status, to: W9Status): boolean {
  return W9_STATE_TRANSITIONS[from].includes(to);
}

export const W9_SECURE_ACTION =
  'Follow the secure W-9 submission instructions in your W-9 request message — Proovd records receipt and verification, and never stores your tax identification number.';

export const W9_NO_ACTION_NEEDED = 'No action needed';

export const W9_STATE_LINES: Readonly<Record<W9Status, { line: string; action: string }>> = {
  requested: {
    line: 'Proovd has requested your W-9. No Founder payment can be made until it is received and verified.',
    action: W9_SECURE_ACTION,
  },
  submitted: {
    line: 'Your W-9 was received and is under review.',
    action: W9_NO_ACTION_NEEDED,
  },
  verified: {
    line: 'Your W-9 is verified.',
    action: W9_NO_ACTION_NEEDED,
  },
};

/* ── §22.3: the payment schedule ───────────────────────────────────────────── */

export const FOUNDER_PAYMENT_KINDS = [
  'single_payment',
  'first_payment',
  'remaining_payment',
] as const;
export type FounderPaymentKind = (typeof FOUNDER_PAYMENT_KINDS)[number];

export const FOUNDER_PAYMENT_KIND_LABELS: Readonly<Record<FounderPaymentKind, string>> = {
  single_payment: 'Single Founder payment',
  first_payment: 'First payment',
  remaining_payment: 'Remaining payment',
};

export interface FounderPaymentScheduleEntry {
  kind: FounderPaymentKind;
  daySettingKey: string;
  percentSettingKey: string;
  defaultDay: number;
  defaultPercent: number;
  amountRule: 'percent' | 'remainder';
}

export const FOUNDER_PAYMENT_SCHEDULES: Readonly<
  Record<'idea' | 'product', readonly FounderPaymentScheduleEntry[]>
> = {
  idea: [
    {
      kind: 'single_payment',
      daySettingKey: 'idea_single_payment_day',
      percentSettingKey: 'idea_single_payment_percent',
      defaultDay: 3,
      defaultPercent: 100,
      amountRule: 'percent',
    },
  ],
  product: [
    {
      kind: 'first_payment',
      daySettingKey: 'product_first_payment_day',
      percentSettingKey: 'product_first_payment_percent',
      defaultDay: 3,
      defaultPercent: 40,
      amountRule: 'percent',
    },
    {
      kind: 'remaining_payment',
      daySettingKey: 'product_remaining_payment_day',
      percentSettingKey: 'product_remaining_payment_percent',
      defaultDay: 14,
      defaultPercent: 60,
      amountRule: 'remainder',
    },
  ],
};

export const EARLY_REMAINING_SETTING_KEY = 'product_early_remaining_payment_enabled';

/* ── §22.3: the eligible Founder share ─────────────────────────────────────── */

export interface EligibleFounderShareInput {
  rewardSubtotalCapturedCents: bigint;
  proovdFeeCents: bigint;
  finalizedCreatorCompensationCents: bigint;
  causeBasedAdjustmentsCents: bigint;
  stripeFeesAllocatedToFounderCents: bigint;
}

export const FOUNDER_SHARE_TAX_NOTE =
  'Sales tax is separate: it is excluded from every percentage and never part of the Founder share (§24.3).';

export function eligibleFounderShareCents(input: EligibleFounderShareInput): bigint {
  for (const [label, value] of Object.entries(input)) {
    if (value < 0n) throw new Error(`${label} must be >= 0 cents, got ${value}`);
  }
  const share =
    input.rewardSubtotalCapturedCents -
    input.proovdFeeCents -
    input.finalizedCreatorCompensationCents -
    input.causeBasedAdjustmentsCents -
    input.stripeFeesAllocatedToFounderCents;
  if (share < 0n) {
    throw new Error(
      `eligible Founder share is negative (${share}) — the ledger does not balance (§22.3, §26.6)`,
    );
  }
  return share;
}

export function founderPaymentAmountCents(input: {
  kind: FounderPaymentKind;
  eligibleShareCents: bigint;
  percent: number;
  firstPaymentCents?: bigint | undefined;
}): bigint {
  if (input.eligibleShareCents < 0n) {
    throw new Error(`eligibleShareCents must be >= 0 cents, got ${input.eligibleShareCents}`);
  }
  if (input.kind === 'remaining_payment') {
    if (input.firstPaymentCents === undefined) {
      throw new Error(
        'remaining_payment needs the first payment amount — "remaining" is the exact rest (§22.3)',
      );
    }
    if (input.firstPaymentCents > input.eligibleShareCents) {
      throw new Error(
        `first payment ${input.firstPaymentCents} exceeds the eligible share ${input.eligibleShareCents} (§22.3)`,
      );
    }
    return input.eligibleShareCents - input.firstPaymentCents;
  }
  return percentOfCents(input.eligibleShareCents, input.percent);
}

/* ── §22.3: what the Founder payment status must show ──────────────────────── */

export const FOUNDER_PAYMENT_STATUS_FACTS = [
  { key: 'exact_amount_affected', spec: '§22.3: the exact amount affected' },
  { key: 'requirement_or_blocker', spec: '§22.3: the requirement or blocker, named' },
  { key: 'secure_action', spec: '§22.3: a secure action' },
  { key: 'submitted_verified_state', spec: '§22.3: submitted and verified state' },
  { key: 'next_review_date', spec: '§22.3: the next review date' },
  {
    key: 'no_action_needed_under_review',
    spec: '§22.3: `No action needed` while under review',
  },
] as const;

/* ── §22.3: early remaining release ────────────────────────────────────────── */

export const EARLY_RELEASE_EVIDENCE_FACTS = [
  {
    key: 'delivery_available',
    label: 'The promised reward or access is actually available to affected Backers',
    note: 'Internal readiness alone is insufficient (§22.3) — this is proof of what affected Backers can actually reach, not of what is ready internally.',
  },
  {
    key: 'communication_sent',
    label: 'The required communication was sent',
    note: null,
  },
  {
    key: 'tax_payment_complete',
    label: 'Tax and payment requirements are complete',
    note: null,
  },
  {
    key: 'no_immediate_risk',
    label: 'No immediate risk flag exists',
    note: null,
  },
] as const;

export type EarlyReleaseEvidenceFactKey = (typeof EARLY_RELEASE_EVIDENCE_FACTS)[number]['key'];

export const EARLY_RELEASE_NEVER_SKIPS_DAY_14 =
  'Early release does not skip the Day 14 status review or your ongoing delivery, refund, and support duties.';
