/**
 * Backend restatement of the shared §24.8/§24.9/B.6 refund registers.
 *
 * The backend cannot import `@proovd/shared` at runtime (it exports TypeScript
 * source and the production image ships only `backend/dist`), so the registers
 * are restated here verbatim and `backend/src/tests/refunds.test.ts`
 * drift-tests every one against the shared module — the same arrangement the
 * state enums, settings, and close registers use.
 */

/* ── §24.8 cause classification ─────────────────────────────────────────────── */

export type RefundCauseKey =
  | 'founder_or_product'
  | 'affiliate_fraud_or_breach'
  | 'proovd_or_system_error'
  | 'backer_dispute_unrelated'
  | 'law_stripe_or_issuer';

export type AffiliateRefundTreatment =
  | 'not_attributed'
  | 'earnings_remain'
  | 'cancel_unfinalized'
  | 'cancel_unpaid_invalid'
  | 'contractual_recovery';

export type ProovdFeeTreatment =
  | 'retained'
  | 'returned_elective'
  | 'returned_required_stripe'
  | 'returned_required_law';

export interface RefundCause {
  key: RefundCauseKey;
  label: string;
  specRef: string;
  allocation: string;
  permittedAffiliateTreatments: readonly AffiliateRefundTreatment[];
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

export function findRefundCause(key: string): RefundCause | undefined {
  return REFUND_CAUSES.find((c) => c.key === key);
}

export const PROOVD_FEE_TREATMENTS: readonly ProovdFeeTreatment[] = [
  'retained',
  'returned_elective',
  'returned_required_stripe',
  'returned_required_law',
];

export type AffiliateEarningsPhase =
  | 'not_attributed'
  | 'unfinalized'
  | 'finalized_untransferred'
  | 'transferred_or_later';

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
  affiliateInvalidCents: bigint | null;
  founderLiabilityCents: bigint;
  mandate: string | null;
}

/** Names the first inconsistency in a proposed allocation, or null. */
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

export const BEST_EFFORT_RECOVERY_SENTENCE =
  'The Founder payment may already have released, so recovery beyond the available balance is ' +
  'best-effort — reversal, dispute, or contract recovery. Full recovery of released funds is ' +
  'never promised.';

/* ── The refund lifecycle (§33.9.2) ─────────────────────────────────────────── */

export type ReservationRefundStatus = 'requested' | 'submitted' | 'succeeded' | 'failed';

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

/* ── Appendix B.6 (exact text) ──────────────────────────────────────────────── */

export const REFUND_NOTICE_TEMPLATE = `Refund started — US$[AMOUNT]

Sent to: [PAYMENT METHOD / LAST FOUR, if safely available]
Started: [DATE]
Typical bank timing: [VERIFIED RANGE]
Status: [SUBMITTED / SUCCEEDED / FAILED]
Reference: [CASE/REFUND]

[View pre-order or get help]`;

export const TYPICAL_BANK_TIMING = '5–10 business days, typically';

export const REFUND_NOTICE_ACTION = 'View pre-order or get help';

export const REFUND_DESTINATION_FALLBACK = 'your original payment method';

export const REFUND_STATUS_LABELS: Readonly<
  Record<Exclude<ReservationRefundStatus, 'requested'>, string>
> = {
  submitted: 'SUBMITTED',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
};

const FORMATTED_AMOUNT = /^\d{1,3}(,\d{3})*\.\d{2}$/;

export interface RefundNoticeVars {
  amount: string;
  destination: string;
  startedDate: string;
  bankTiming: string;
  status: Exclude<ReservationRefundStatus, 'requested'>;
  reference: string;
}

export interface ResolvedRefundNotice {
  body: string;
  action: string;
}

/** Resolves Appendix B.6; throws on a non-formatted amount or surviving bracket. */
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
    .replace('\n[View pre-order or get help]', '');

  const leftover = body.match(/\[[A-Z][^\]]*\]/);
  if (leftover) {
    throw new Error(`refund copy has an unresolved marker: ${leftover[0]}`);
  }

  return { body, action: REFUND_NOTICE_ACTION };
}
