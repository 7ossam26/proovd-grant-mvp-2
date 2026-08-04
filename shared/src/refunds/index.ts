/**
 * Refunds, reversals, and cause-based allocation — Spec §24.8, §24.9, §24.10,
 * Appendix B.6. (Phase 20a)
 *
 * §24.8's table decides who bears a refund across four parties with different
 * rights, so it is a register the services READ, never prose they remember.
 * The structural traps are encoded as the *absence* of a permitted combination:
 *
 *   * a Founder-caused refund can never claw back finalized valid Affiliate
 *     earnings — no treatment stronger than `cancel_unfinalized` is permitted
 *     for that cause (§33.9.3);
 *   * a Proovd/system error can never debit an unrelated Affiliate — only
 *     `earnings_remain`/`not_attributed` are permitted (§33.9.5);
 *   * an unrelated Backer dispute never claws back automatically — the same
 *     ceiling as the Founder row, and a case with real Affiliate causation is
 *     *classified* `affiliate_fraud_or_breach`, because the cause IS the
 *     decision (§33.9.6);
 *   * only `affiliate_fraud_or_breach` reaches `cancel_unpaid_invalid` or
 *     `contractual_recovery`, and both carry the INVALID amount — never the
 *     whole balance (§33.9.4).
 *
 * §24.9 closes the other door: after a valid Idea capture there is no
 * voluntary/change-of-mind refund, so the register of routable exceptions is
 * exhaustive and a change-of-mind case has no representable row.
 *
 * The backend restates these in `backend/src/refunds/logic.ts` (it cannot
 * import this package at runtime) and its suite drift-tests the two.
 */

/* ── §24.8 cause classification ─────────────────────────────────────────────── */

export type RefundCauseKey =
  | 'founder_or_product'
  | 'affiliate_fraud_or_breach'
  | 'proovd_or_system_error'
  | 'backer_dispute_unrelated'
  | 'law_stripe_or_issuer';

/** How the refunded transaction's Affiliate earnings are treated (§24.8). */
export type AffiliateRefundTreatment =
  | 'not_attributed'
  | 'earnings_remain'
  | 'cancel_unfinalized'
  | 'cancel_unpaid_invalid'
  | 'contractual_recovery';

/** What happens to Proovd's 5% on the refunded transaction (§24.8). */
export type ProovdFeeTreatment =
  | 'retained'
  | 'returned_elective'
  | 'returned_required_stripe'
  | 'returned_required_law';

export interface RefundCause {
  key: RefundCauseKey;
  label: string;
  specRef: string;
  /** §24.8's allocation sentence, verbatim enough to render on the Admin surface. */
  allocation: string;
  /**
   * The affiliate treatments this cause may record. What is ABSENT here is the
   * phase's guarantee: a treatment outside this list is refused by CHECK and by
   * the service, whatever the caller believes.
   */
  permittedAffiliateTreatments: readonly AffiliateRefundTreatment[];
  /** Whether the case must name the mandate it follows (law/Stripe/issuer). */
  requiresMandate: boolean;
}

export const REFUND_CAUSES: readonly RefundCause[] = [
  {
    key: 'founder_or_product',
    label: 'Founder or product caused',
    specRef: '§24.8',
    allocation:
      'The Founder bears the refund. Finalized and transferred valid Affiliate earnings remain; ' +
      'unfinalized earnings on the refunded transaction may cancel. Proovd keeps its 5% unless it ' +
      'elects otherwise, or Stripe or law requires a return.',
    permittedAffiliateTreatments: ['not_attributed', 'earnings_remain', 'cancel_unfinalized'],
    requiresMandate: false,
  },
  {
    key: 'affiliate_fraud_or_breach',
    label: 'Affiliate-caused fraud or breach',
    specRef: '§24.8',
    allocation:
      'Cancel unpaid invalid earnings. An already-transferred amount creates a negative balance ' +
      'and contractual recovery record.',
    permittedAffiliateTreatments: [
      'cancel_unfinalized',
      'cancel_unpaid_invalid',
      'contractual_recovery',
    ],
    requiresMandate: false,
  },
  {
    key: 'proovd_or_system_error',
    label: 'Proovd or system error',
    specRef: '§24.8',
    allocation:
      'Proovd corrects it and returns its fee where appropriate. An unrelated Affiliate is not debited.',
    permittedAffiliateTreatments: ['not_attributed', 'earnings_remain'],
    requiresMandate: false,
  },
  {
    key: 'backer_dispute_unrelated',
    label: 'Backer dispute unrelated to the Affiliate',
    specRef: '§24.8',
    allocation:
      'Follows the Founder/MoR charge context. Finalized Affiliate earnings remain unless evidence ' +
      'shows Affiliate causation — and a case with that evidence is classified as Affiliate-caused.',
    permittedAffiliateTreatments: ['not_attributed', 'earnings_remain', 'cancel_unfinalized'],
    requiresMandate: false,
  },
  {
    key: 'law_stripe_or_issuer',
    label: 'Required by law, Stripe, or the card issuer',
    specRef: '§24.8',
    allocation:
      'Follow the mandatory outcome and record the allocation. Consent and evidence do not waive ' +
      'law, network, Stripe, or issuer rights.',
    permittedAffiliateTreatments: [
      'not_attributed',
      'earnings_remain',
      'cancel_unfinalized',
      'cancel_unpaid_invalid',
      'contractual_recovery',
    ],
    requiresMandate: true,
  },
];

export const REFUND_CAUSE_KEYS = REFUND_CAUSES.map((c) => c.key);

export function findRefundCause(key: string): RefundCause | undefined {
  return REFUND_CAUSES.find((c) => c.key === key);
}

export const PROOVD_FEE_TREATMENTS: readonly ProovdFeeTreatment[] = [
  'retained',
  'returned_elective',
  'returned_required_stripe',
  'returned_required_law',
];

export const AFFILIATE_REFUND_TREATMENTS: readonly AffiliateRefundTreatment[] = [
  'not_attributed',
  'earnings_remain',
  'cancel_unfinalized',
  'cancel_unpaid_invalid',
  'contractual_recovery',
];

/**
 * Where the attributed Creator's money stands when the case is decided. The
 * treatment must match this phase — canceling "unfinalized" earnings that were
 * finalized last week would be the clawback §33.9.3 forbids wearing a
 * different word.
 */
export type AffiliateEarningsPhase =
  | 'not_attributed'
  | 'unfinalized'
  | 'finalized_untransferred'
  | 'transferred_or_later';

/** The treatments consistent with each earnings phase (§24.8, §22.1). */
export function treatmentsForEarningsPhase(
  phase: AffiliateEarningsPhase,
): readonly AffiliateRefundTreatment[] {
  switch (phase) {
    case 'not_attributed':
      return ['not_attributed'];
    case 'unfinalized':
      return ['earnings_remain', 'cancel_unfinalized'];
    case 'finalized_untransferred':
      return ['earnings_remain', 'cancel_unpaid_invalid'];
    case 'transferred_or_later':
      return ['earnings_remain', 'contractual_recovery'];
  }
}

export interface RefundAllocationFacts {
  cause: RefundCauseKey;
  affiliateTreatment: AffiliateRefundTreatment;
  proovdFeeTreatment: ProovdFeeTreatment;
  /** Required for the two invalid-earnings treatments; forbidden otherwise. */
  affiliateInvalidCents: bigint | null;
  /** The Admin-recorded share of this case the Founder bears (§24.8). */
  founderLiabilityCents: bigint;
  /** The named mandate, when law/Stripe/issuer required the outcome. */
  mandate: string | null;
}

/**
 * Names the first inconsistency in a proposed allocation, or null when it is
 * recordable. The database CHECKs restate the cause/treatment matrix; this
 * adds the earnings-phase consistency only a live read can know.
 */
export function allocationInconsistency(
  facts: RefundAllocationFacts,
  phase: AffiliateEarningsPhase,
): string | null {
  const cause = findRefundCause(facts.cause);
  if (!cause) return 'unknown_cause';
  if (!cause.permittedAffiliateTreatments.includes(facts.affiliateTreatment)) {
    return 'treatment_not_permitted_for_cause';
  }
  if (!treatmentsForEarningsPhase(phase).includes(facts.affiliateTreatment)) {
    return 'treatment_inconsistent_with_earnings_phase';
  }
  const needsInvalid =
    facts.affiliateTreatment === 'cancel_unpaid_invalid' ||
    facts.affiliateTreatment === 'contractual_recovery';
  if (needsInvalid && (facts.affiliateInvalidCents === null || facts.affiliateInvalidCents <= 0n)) {
    return 'invalid_amount_required';
  }
  if (!needsInvalid && facts.affiliateInvalidCents !== null) {
    return 'invalid_amount_forbidden';
  }
  if (facts.founderLiabilityCents < 0n) return 'founder_liability_negative';
  if (cause.requiresMandate && !(facts.mandate ?? '').trim()) {
    return 'mandate_required';
  }
  return null;
}

/* ── §24.9 Idea refund exceptions ───────────────────────────────────────────── */

export type IdeaRefundException =
  | 'duplicate_charge'
  | 'wrong_amount'
  | 'charge_after_valid_cancellation'
  | 'unauthorized_transaction'
  | 'material_misrepresentation'
  | 'applicable_non_delivery'
  | 'campaign_killed_serious_violation'
  | 'required_by_law_or_network';

/**
 * §24.9's exhaustive list. After a valid Idea capture there is no voluntary or
 * change-of-mind refund, so there is deliberately NO member of this register
 * for one — a change-of-mind case has no representable row, which is the
 * enforcement.
 */
export const IDEA_REFUND_EXCEPTIONS: readonly { key: IdeaRefundException; label: string }[] = [
  { key: 'duplicate_charge', label: 'Duplicate charge' },
  { key: 'wrong_amount', label: 'Wrong amount' },
  { key: 'charge_after_valid_cancellation', label: 'Charge after valid cancellation' },
  { key: 'unauthorized_transaction', label: 'Unauthorized transaction' },
  { key: 'material_misrepresentation', label: 'Material campaign misrepresentation' },
  { key: 'applicable_non_delivery', label: 'Applicable non-delivery' },
  { key: 'campaign_killed_serious_violation', label: 'Campaign killed for serious violation' },
  { key: 'required_by_law_or_network', label: 'Refund required by law, Stripe, network, or issuer' },
];

export const IDEA_REFUND_EXCEPTION_KEYS = IDEA_REFUND_EXCEPTIONS.map((e) => e.key);

/**
 * §24.9's recovery honesty, pinned. The single Founder payment may have
 * released on Day 3, so recovery beyond the available balance is best-effort —
 * and no surface, message, or Admin note may promise more.
 */
export const BEST_EFFORT_RECOVERY_SENTENCE =
  'The Founder payment may already have released, so recovery beyond the available balance is ' +
  'best-effort — reversal, dispute, or contract recovery. Full recovery of released funds is ' +
  'never promised.';

/* ── The refund lifecycle (§33.9.2) ─────────────────────────────────────────── */

export type ReservationRefundStatus = 'requested' | 'submitted' | 'succeeded' | 'failed';

export const RESERVATION_REFUND_STATUSES: readonly ReservationRefundStatus[] = [
  'requested',
  'submitted',
  'succeeded',
  'failed',
];

/**
 * `requested` is the recorded case before any provider call; `submitted` is a
 * refund object created at the provider; a synchronous refusal is `failed`
 * from `requested`, and a retry re-drives the SAME provider key back through
 * `submitted` — the same refund at Stripe, never a second (§28.3).
 */
export const RESERVATION_REFUND_TRANSITIONS: Readonly<
  Record<ReservationRefundStatus, readonly ReservationRefundStatus[]>
> = {
  requested: ['submitted', 'failed'],
  submitted: ['succeeded', 'failed'],
  failed: ['submitted'],
  succeeded: [],
};

export function canMoveRefundStatus(
  from: ReservationRefundStatus,
  to: ReservationRefundStatus,
): boolean {
  return RESERVATION_REFUND_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ── Appendix B.6 — refund copy (exact text) ────────────────────────────────── */

/**
 * Appendix B.6, verbatim. The bracketed slots are the resolver's contract; the
 * `[View pre-order or get help]` line renders as the message's one action, the
 * B.5 shape. The timing slot takes `TYPICAL_BANK_TIMING` — §13's only
 * permitted shape, a typical range and never a promised settlement date.
 */
export const REFUND_NOTICE_TEMPLATE = `Refund started — US$[AMOUNT]

Sent to: [PAYMENT METHOD / LAST FOUR, if safely available]
Started: [DATE]
Typical bank timing: [VERIFIED RANGE]
Status: [SUBMITTED / SUCCEEDED / FAILED]
Reference: [CASE/REFUND]

[View pre-order or get help]`;

/** The verified range (§13's shape): typical, and never an exact date. */
export const TYPICAL_BANK_TIMING = '5–10 business days, typically';

/** B.6's one action. */
export const REFUND_NOTICE_ACTION = 'View pre-order or get help';

/** The truthful destination when the card's brand and last four are not safely readable. */
export const REFUND_DESTINATION_FALLBACK = 'your original payment method';

export const REFUND_STATUS_LABELS: Readonly<Record<Exclude<ReservationRefundStatus, 'requested'>, string>> = {
  submitted: 'SUBMITTED',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
};

/** A formatted USD amount like `1,234.00` — the shape `formatCents` produces. */
const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

export interface RefundNoticeVars {
  /** Formatted amount, e.g. "25.00" — from `formatCents`, never raw cents. */
  amount: string;
  /** "Visa ending 4242" where safely available, else the pinned fallback. */
  destination: string;
  /** The start date, local with UTC secondary, e.g. "August 4, 2026 (UTC)". */
  startedDate: string;
  /** `TYPICAL_BANK_TIMING` — stated as typical, never as a promise. */
  bankTiming: string;
  /** The lifecycle state, as B.6's own vocabulary. `requested` sends nothing. */
  status: Exclude<ReservationRefundStatus, 'requested'>;
  /** The quotable case/refund reference. */
  reference: string;
}

export interface ResolvedRefundNotice {
  /** The exact B.6 body with the action line removed — it renders as the action. */
  body: string;
  action: string;
}

/**
 * Resolves Appendix B.6 with values from the refund record. Throws on a
 * non-formatted amount or any surviving bracket — a refund message with a
 * marker in it tells a Backer nothing about their own money.
 */
export function resolveRefundNotice(vars: RefundNoticeVars): ResolvedRefundNotice {
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`refund copy ${name} must be a non-empty string`);
    }
  }
  if (!FORMATTED_AMOUNT.test(vars.amount)) {
    throw new Error(`refund copy amount must be a formatted amount, got "${vars.amount}"`);
  }
  const statusLabel = REFUND_STATUS_LABELS[vars.status];
  if (!statusLabel) {
    throw new Error(`refund copy status must be submitted/succeeded/failed, got "${vars.status}"`);
  }

  const body = REFUND_NOTICE_TEMPLATE.replaceAll('[AMOUNT]', vars.amount)
    .replaceAll('[PAYMENT METHOD / LAST FOUR, if safely available]', vars.destination)
    .replaceAll('[DATE]', vars.startedDate)
    .replaceAll('[VERIFIED RANGE]', vars.bankTiming)
    .replaceAll('[SUBMITTED / SUCCEEDED / FAILED]', statusLabel)
    .replaceAll('[CASE/REFUND]', vars.reference)
    // The action renders as the message's one control, not as body text.
    .replace('\n[View pre-order or get help]', '');

  const leftover = body.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`refund copy has an unresolved marker: ${leftover[0]}`);
  }

  return { body, action: REFUND_NOTICE_ACTION };
}
