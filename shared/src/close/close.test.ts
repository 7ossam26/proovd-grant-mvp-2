/**
 * The shared close vocabulary — §21, §4.1, Appendix B.5 (Phase 18a).
 */

import { describe, it, expect } from 'vitest';
import {
  CLOSE_BATCH_STEPS,
  CAPTURE_FAILURE_KINDS,
  classifyCaptureFailure,
  TAX_UNUSABLE_REASON,
  foldMergedIdentities,
  ideaCloseThresholdMet,
  FAILED_PAYMENT_TEMPLATE,
  NO_MONEY_MOVED_STATE,
  UPDATE_CARD_ACTION,
  resolveFailedPaymentCopy,
  THRESHOLD_MISS_REASON,
  TAX_UNUSABLE_DROP_REASON,
} from './index.js';

describe('§21 close-batch step register', () => {
  it('names all eight steps in §21 order', () => {
    expect(CLOSE_BATCH_STEPS.map((s) => s.key)).toEqual([
      'lock_active_reservations',
      'exclude_canceled_ineligible',
      'stop_joining_and_cancellation',
      'resolve_duplicates_and_count',
      'threshold_missed_no_charge',
      'validate_and_capture',
      'receipts_and_recovery',
      'open_retry_window',
    ]);
    for (const step of CLOSE_BATCH_STEPS) {
      expect(step.spec).toContain('§21');
    }
  });
});

describe('§33.7.8 capture-failure classification', () => {
  it('names exactly the three retryable kinds', () => {
    expect([...CAPTURE_FAILURE_KINDS]).toEqual([
      'card_declined',
      'insufficient_funds',
      'requires_action',
    ]);
  });

  it('classifies decline, insufficient funds, and requires-action', () => {
    expect(classifyCaptureFailure({ declineCode: 'generic_decline' })).toBe('card_declined');
    expect(classifyCaptureFailure({ declineCode: 'insufficient_funds' })).toBe(
      'insufficient_funds',
    );
    expect(classifyCaptureFailure({ status: 'requires_action' })).toBe('requires_action');
    // An unknown provider code is still a card decline — the recovery is the
    // same, and the raw code stays internal (§25.6).
    expect(classifyCaptureFailure({ declineCode: 'do_not_honor' })).toBe('card_declined');
    expect(classifyCaptureFailure({})).toBe('card_declined');
  });

  it('the tax drop is its own reason, not a failure kind — it never retries', () => {
    expect(TAX_UNUSABLE_REASON).toBe('tax_calculation_unusable');
    expect((CAPTURE_FAILURE_KINDS as readonly string[]).includes(TAX_UNUSABLE_REASON)).toBe(false);
  });
});

describe('§4.1 merged-identity fold', () => {
  it('counts distinct people when nothing merged', () => {
    expect(foldMergedIdentities(['a', 'b', 'c'], [])).toBe(3);
  });

  it('an Admin merge makes two identities one person', () => {
    expect(foldMergedIdentities(['a', 'b', 'c'], [['a', 'b']])).toBe(2);
  });

  it('merges are transitive: A~B and B~C is one person', () => {
    expect(
      foldMergedIdentities(
        ['a', 'b', 'c', 'd'],
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
      ),
    ).toBe(2);
  });

  it('a merge involving an identity with no active reservation reduces nothing', () => {
    expect(foldMergedIdentities(['a', 'b'], [['a', 'x']])).toBe(2);
  });

  it('the close decision uses the same kernel as the live crossings', () => {
    expect(ideaCloseThresholdMet(10, 10)).toBe(true);
    expect(ideaCloseThresholdMet(9, 10)).toBe(false);
  });
});

describe('Appendix B.5 — failed payment', () => {
  const vars = {
    moneyMovedState: NO_MONEY_MOVED_STATE,
    campaignTitle: 'Solar Kettle',
    rewardTitle: 'Founding Kettle',
    rewardSubtotal: '25.00',
    salesTax: '2.00',
    totalAttempted: '27.00',
    updateByLocal: 'August 6, 2026 3:40 PM EDT',
    updateByUtc: '2026-08-06 19:40 UTC',
  };

  it('pins the exact template', () => {
    expect(FAILED_PAYMENT_TEMPLATE).toContain('We could not complete this pre-order charge.');
    expect(FAILED_PAYMENT_TEMPLATE).toContain('[ACTUAL MONEY-MOVED STATE]');
    expect(FAILED_PAYMENT_TEMPLATE).toContain('Total attempted: US$[TOTAL]');
    expect(FAILED_PAYMENT_TEMPLATE).toContain('Update by: [LOCAL DATE/TIME] ([UTC])');
    expect(FAILED_PAYMENT_TEMPLATE).toContain('[Update card]');
    expect(FAILED_PAYMENT_TEMPLATE).toContain(
      'If you do nothing, this pre-order will be canceled after the retry window.',
    );
  });

  it('resolves with ledger variables and one Update card action', () => {
    const resolved = resolveFailedPaymentCopy(vars);
    expect(resolved.body).toContain(NO_MONEY_MOVED_STATE);
    expect(resolved.body).toContain('Campaign: Solar Kettle');
    expect(resolved.body).toContain('Total attempted: US$27.00');
    expect(resolved.body).toContain('Update by: August 6, 2026 3:40 PM EDT (2026-08-06 19:40 UTC)');
    expect(resolved.action).toBe(UPDATE_CARD_ACTION);
    // The action renders as the control, not as body text.
    expect(resolved.body).not.toContain('[Update card]');
  });

  it('refuses an unfilled bracket and a non-formatted amount', () => {
    expect(() => resolveFailedPaymentCopy({ ...vars, campaignTitle: '' })).toThrow();
    expect(() => resolveFailedPaymentCopy({ ...vars, totalAttempted: '2700' })).toThrow(
      /formatted amount/,
    );
  });

  it('the copy never shames the Backer and names no provider code', () => {
    const resolved = resolveFailedPaymentCopy(vars);
    for (const banned of ['declined', 'insufficient', 'your fault', 'failed to pay']) {
      expect(resolved.body.toLowerCase()).not.toContain(banned);
    }
  });
});

describe('the US$0 closures state US$0', () => {
  it('both no-charge reasons say US$0 and never a provider word', () => {
    for (const reason of [THRESHOLD_MISS_REASON, TAX_UNUSABLE_DROP_REASON]) {
      expect(reason).toContain('US$0');
      expect(reason.toLowerCase()).not.toContain('decline');
    }
  });
});
