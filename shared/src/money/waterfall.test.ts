/**
 * §33.8.1 — the Proovd 5% and every Creator percentage exclude tax; the Idea
 * threshold and the campaign cap use pre-tax figures (§24.3).
 *
 * The exclusion is structural: `computeWaterfall` has no tax parameter, so
 * these tests feed the same subtotal with wildly different tax amounts and
 * assert every downstream figure is identical.
 */

import { describe, it, expect } from 'vitest';
import {
  computeWaterfall,
  computeTotalCaptured,
  computeFounderNet,
} from './waterfall.js';
import { ideaThresholdMet, activePreorderValueCents, wouldExceedCap } from './thresholds.js';
import { MoneyRuleError } from './errors.js';

describe('money waterfall (§24.3, §33.8.1)', () => {
  it('computes the §24.3 waterfall on the pre-tax subtotal', () => {
    // $100.00 reward, 30% attributed Creator.
    const w = computeWaterfall({ rewardSubtotalCents: 10_000n, affiliatePercent: 30 });
    expect(w.proovdFeeCents).toBe(500n); // 5% × $100
    expect(w.affiliateCompensationCents).toBe(3_000n); // 30% × $100
    expect(w.founderGrossShareCents).toBe(6_500n);
  });

  it('excludes sales tax from the 5% and the Creator percentage — structurally', () => {
    const subtotal = 10_000n;
    // Identical subtotal under three different tax regimes: the waterfall
    // cannot see tax, so every figure must be identical.
    for (const taxCents of [0n, 825n, 999_999n]) {
      const w = computeWaterfall({ rewardSubtotalCents: subtotal, affiliatePercent: 30 });
      expect(w.proovdFeeCents).toBe(500n);
      expect(w.affiliateCompensationCents).toBe(3_000n);
      expect(w.founderGrossShareCents).toBe(6_500n);
      // Tax appears only in the charge amount.
      expect(computeTotalCaptured(subtotal, taxCents)).toBe(subtotal + taxCents);
    }
  });

  it('sums exactly: fee + compensation + founder gross = subtotal, no lost cent', () => {
    // Odd subtotals where floor rounding matters.
    for (const subtotal of [1n, 33n, 99n, 101n, 12_345n, 9_999_999n]) {
      for (const pct of [0, 20, 30, 50]) {
        const w = computeWaterfall({ rewardSubtotalCents: subtotal, affiliatePercent: pct });
        expect(w.proovdFeeCents + w.affiliateCompensationCents + w.founderGrossShareCents).toBe(
          subtotal,
        );
      }
    }
  });

  it('pays 0 Creator compensation on an unattributed charge', () => {
    const w = computeWaterfall({ rewardSubtotalCents: 10_000n, affiliatePercent: 0 });
    expect(w.affiliateCompensationCents).toBe(0n);
    expect(w.founderGrossShareCents).toBe(9_500n);
  });

  it('rejects a percentage above the 50% ceiling and non-bigint amounts', () => {
    expect(() =>
      computeWaterfall({ rewardSubtotalCents: 10_000n, affiliatePercent: 51 }),
    ).toThrow(MoneyRuleError);
    expect(() =>
      computeWaterfall({ rewardSubtotalCents: -1n, affiliatePercent: 30 }),
    ).toThrow(MoneyRuleError);
  });

  it('founder_net subtracts allocated Stripe fees and cause-based adjustments (§24.3)', () => {
    expect(computeFounderNet(6_500n, 320n, 100n)).toBe(6_080n);
  });
});

describe('Idea threshold and campaign cap are pre-tax (§24.3, §33.8.1)', () => {
  it('threshold counts unique active Backers — no money, no tax, can enter (§14.4, §21)', () => {
    expect(ideaThresholdMet(10, 10)).toBe(true);
    expect(ideaThresholdMet(9, 10)).toBe(false);
    expect(() => ideaThresholdMet(5, 0)).toThrow(MoneyRuleError);
  });

  it('cap aggregates pre-tax subtotals only', () => {
    // Three active pre-orders at $20,000 pre-tax each; tax exists on the
    // charges but is not an input anywhere here.
    const subtotals = [2_000_000n, 2_000_000n, 1_000_000n];
    expect(activePreorderValueCents(subtotals)).toBe(5_000_000n);
    // Exactly at the $50,000 cap: not exceeded.
    expect(wouldExceedCap(activePreorderValueCents(subtotals), 0n)).toBe(false);
    // One more pre-tax cent exceeds it.
    expect(wouldExceedCap(activePreorderValueCents(subtotals), 1n)).toBe(true);
  });
});
