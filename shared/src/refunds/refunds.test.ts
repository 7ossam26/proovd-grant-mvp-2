import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_REFUND_TREATMENTS,
  allocationInconsistency,
  BEST_EFFORT_RECOVERY_SENTENCE,
  canMoveRefundStatus,
  findRefundCause,
  IDEA_REFUND_EXCEPTION_KEYS,
  IDEA_REFUND_EXCEPTIONS,
  PROOVD_FEE_TREATMENTS,
  REFUND_CAUSE_KEYS,
  REFUND_CAUSES,
  REFUND_NOTICE_ACTION,
  REFUND_NOTICE_TEMPLATE,
  RESERVATION_REFUND_STATUSES,
  RESERVATION_REFUND_TRANSITIONS,
  resolveRefundNotice,
  treatmentsForEarningsPhase,
  TYPICAL_BANK_TIMING,
} from './index.js';

describe('§24.8 cause register', () => {
  it('names exactly the five §24.8 causes, in the table order', () => {
    expect(REFUND_CAUSE_KEYS).toEqual([
      'founder_or_product',
      'affiliate_fraud_or_breach',
      'proovd_or_system_error',
      'backer_dispute_unrelated',
      'law_stripe_or_issuer',
    ]);
  });

  it('§33.9.3: a Founder-caused case can never reach a finalized-earnings clawback', () => {
    const cause = findRefundCause('founder_or_product')!;
    expect(cause.permittedAffiliateTreatments).not.toContain('cancel_unpaid_invalid');
    expect(cause.permittedAffiliateTreatments).not.toContain('contractual_recovery');
    expect(cause.permittedAffiliateTreatments).toContain('earnings_remain');
    // "Unfinalized earnings on the refunded transaction may cancel" — may, an
    // Admin decision, so both answers are recordable.
    expect(cause.permittedAffiliateTreatments).toContain('cancel_unfinalized');
  });

  it('§33.9.5: a Proovd/system error can never debit the Affiliate at all', () => {
    const cause = findRefundCause('proovd_or_system_error')!;
    expect([...cause.permittedAffiliateTreatments].sort()).toEqual([
      'earnings_remain',
      'not_attributed',
    ]);
  });

  it('§33.9.6: an unrelated dispute has the same ceiling as the Founder row', () => {
    const cause = findRefundCause('backer_dispute_unrelated')!;
    expect(cause.permittedAffiliateTreatments).not.toContain('cancel_unpaid_invalid');
    expect(cause.permittedAffiliateTreatments).not.toContain('contractual_recovery');
  });

  it('§33.9.4: only the Affiliate-caused row cancels or recovers, and never leaves earnings standing silently', () => {
    const cause = findRefundCause('affiliate_fraud_or_breach')!;
    expect(cause.permittedAffiliateTreatments).toContain('cancel_unpaid_invalid');
    expect(cause.permittedAffiliateTreatments).toContain('contractual_recovery');
    expect(cause.permittedAffiliateTreatments).not.toContain('earnings_remain');
  });

  it('only the legal/Stripe/issuer cause requires a named mandate', () => {
    for (const cause of REFUND_CAUSES) {
      expect(cause.requiresMandate).toBe(cause.key === 'law_stripe_or_issuer');
    }
  });

  it('every vocabulary member is reachable from some cause', () => {
    const reachable = new Set(REFUND_CAUSES.flatMap((c) => c.permittedAffiliateTreatments));
    for (const treatment of AFFILIATE_REFUND_TREATMENTS) {
      expect(reachable.has(treatment)).toBe(true);
    }
    expect(PROOVD_FEE_TREATMENTS).toHaveLength(4);
  });
});

describe('allocation consistency kernel', () => {
  const base = {
    cause: 'affiliate_fraud_or_breach' as const,
    affiliateTreatment: 'contractual_recovery' as const,
    proovdFeeTreatment: 'retained' as const,
    affiliateInvalidCents: 500n,
    founderLiabilityCents: 0n,
    mandate: null,
  };

  it('accepts a consistent recovery on transferred earnings', () => {
    expect(allocationInconsistency(base, 'transferred_or_later')).toBeNull();
  });

  it('refuses a treatment the cause does not permit, by name', () => {
    expect(
      allocationInconsistency(
        { ...base, cause: 'founder_or_product' },
        'transferred_or_later',
      ),
    ).toBe('treatment_not_permitted_for_cause');
  });

  it('refuses a treatment inconsistent with where the money stands', () => {
    expect(allocationInconsistency(base, 'unfinalized')).toBe(
      'treatment_inconsistent_with_earnings_phase',
    );
  });

  it('requires the invalid amount for the two invalid-earnings treatments, and forbids it elsewhere', () => {
    expect(
      allocationInconsistency({ ...base, affiliateInvalidCents: null }, 'transferred_or_later'),
    ).toBe('invalid_amount_required');
    expect(
      allocationInconsistency(
        {
          ...base,
          cause: 'founder_or_product',
          affiliateTreatment: 'earnings_remain',
          affiliateInvalidCents: 500n,
        },
        'transferred_or_later',
      ),
    ).toBe('invalid_amount_forbidden');
  });

  it('requires the named mandate for the legal cause', () => {
    expect(
      allocationInconsistency(
        {
          ...base,
          cause: 'law_stripe_or_issuer',
          affiliateTreatment: 'earnings_remain',
          affiliateInvalidCents: null,
        },
        'transferred_or_later',
      ),
    ).toBe('mandate_required');
  });

  it('an unattributed charge takes exactly one treatment', () => {
    expect(treatmentsForEarningsPhase('not_attributed')).toEqual(['not_attributed']);
  });
});

describe('§24.9 Idea refund exceptions', () => {
  it('is exactly the eight routable reasons, with no voluntary member', () => {
    expect(IDEA_REFUND_EXCEPTION_KEYS).toEqual([
      'duplicate_charge',
      'wrong_amount',
      'charge_after_valid_cancellation',
      'unauthorized_transaction',
      'material_misrepresentation',
      'applicable_non_delivery',
      'campaign_killed_serious_violation',
      'required_by_law_or_network',
    ]);
    const labels = IDEA_REFUND_EXCEPTIONS.map((e) => e.label.toLowerCase()).join(' ');
    expect(labels).not.toContain('voluntary');
    expect(labels).not.toContain('change of mind');
  });

  it('the best-effort sentence never promises full recovery', () => {
    expect(BEST_EFFORT_RECOVERY_SENTENCE).toContain('best-effort');
    expect(BEST_EFFORT_RECOVERY_SENTENCE).toContain('never promised');
  });
});

describe('refund lifecycle (§33.9.2)', () => {
  it('has the four §24.8 states and the stated transitions', () => {
    expect(RESERVATION_REFUND_STATUSES).toEqual([
      'requested',
      'submitted',
      'succeeded',
      'failed',
    ]);
    expect(RESERVATION_REFUND_TRANSITIONS.succeeded).toEqual([]);
    expect(canMoveRefundStatus('requested', 'submitted')).toBe(true);
    expect(canMoveRefundStatus('submitted', 'succeeded')).toBe(true);
    expect(canMoveRefundStatus('submitted', 'failed')).toBe(true);
    // A synchronous provider refusal, and its retry under the same key.
    expect(canMoveRefundStatus('requested', 'failed')).toBe(true);
    expect(canMoveRefundStatus('failed', 'submitted')).toBe(true);
    // No reversal of a terminal success, and no skipping submission.
    expect(canMoveRefundStatus('succeeded', 'failed')).toBe(false);
    expect(canMoveRefundStatus('requested', 'succeeded')).toBe(false);
  });
});

describe('Appendix B.6', () => {
  const vars = {
    amount: '54.00',
    destination: 'Visa ending 4242',
    startedDate: 'August 4, 2026 (UTC)',
    bankTiming: TYPICAL_BANK_TIMING,
    status: 'submitted' as const,
    reference: 'RF-7K2M9-Q4WPX',
  };

  it('keeps the appendix verbatim, brackets and all', () => {
    expect(REFUND_NOTICE_TEMPLATE).toContain('Refund started — US$[AMOUNT]');
    expect(REFUND_NOTICE_TEMPLATE).toContain(
      'Sent to: [PAYMENT METHOD / LAST FOUR, if safely available]',
    );
    expect(REFUND_NOTICE_TEMPLATE).toContain('Typical bank timing: [VERIFIED RANGE]');
    expect(REFUND_NOTICE_TEMPLATE).toContain('Status: [SUBMITTED / SUCCEEDED / FAILED]');
    expect(REFUND_NOTICE_TEMPLATE).toContain('Reference: [CASE/REFUND]');
    expect(REFUND_NOTICE_TEMPLATE).toContain('[View pre-order or get help]');
  });

  it('resolves every slot and returns the one action', () => {
    const resolved = resolveRefundNotice(vars);
    expect(resolved.body).toContain('Refund started — US$54.00');
    expect(resolved.body).toContain('Sent to: Visa ending 4242');
    expect(resolved.body).toContain('Typical bank timing: 5–10 business days, typically');
    expect(resolved.body).toContain('Status: SUBMITTED');
    expect(resolved.body).toContain('Reference: RF-7K2M9-Q4WPX');
    expect(resolved.body).not.toContain('[');
    expect(resolved.body).not.toContain('View pre-order or get help');
    expect(resolved.action).toBe(REFUND_NOTICE_ACTION);
  });

  it('the timing is a typical range, never an exact settlement date', () => {
    expect(TYPICAL_BANK_TIMING).toContain('typically');
    expect(TYPICAL_BANK_TIMING).toContain('5–10 business days');
  });

  it('refuses an unformatted amount and an unresolved bracket', () => {
    expect(() => resolveRefundNotice({ ...vars, amount: '5400' })).toThrow(/formatted amount/);
    expect(() => resolveRefundNotice({ ...vars, destination: '' })).toThrow(/non-empty/);
    expect(() =>
      resolveRefundNotice({ ...vars, status: 'requested' as never }),
    ).toThrow(/status/);
  });
});
