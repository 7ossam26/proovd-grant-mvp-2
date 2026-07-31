/**
 * §33.2.7 — six compensation-matrix cells produce correct base/bid/fixed rules.
 * §33.2.8 — Idea rejects a fixed request; a standard campaign rejects a bid
 *           above base.
 * §33.2.12 — percentage ceiling includes base/bid/bonus and never exceeds 50%;
 *            a fixed amount sits outside it.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCompensation,
  validateProposal,
  combinedPercent,
} from './compensation.js';
import { MoneyRuleError } from './errors.js';

describe('compensation matrix (§14.3, §33.2.7)', () => {
  it('Idea, standard: fixed prohibited, base 30%, no bid', () => {
    const cell = resolveCompensation('pre_build', false, false);
    expect(cell).toEqual({ basePercent: 30, bidAllowed: false, fixedPaymentAllowed: false });
  });

  it('Idea, high effort: fixed prohibited, base 30%, bid allowed capped at 50%', () => {
    const cell = resolveCompensation('pre_build', true, false);
    expect(cell).toEqual({ basePercent: 30, bidAllowed: true, fixedPaymentAllowed: false });
  });

  it('Product, standard, no fixed: base 30%, no bid', () => {
    const cell = resolveCompensation('pre_launch', false, false);
    expect(cell).toEqual({ basePercent: 30, bidAllowed: false, fixedPaymentAllowed: true });
  });

  it('Product, standard, fixed accepted: base 20%, no bid', () => {
    const cell = resolveCompensation('pre_launch', false, true);
    expect(cell).toEqual({ basePercent: 20, bidAllowed: false, fixedPaymentAllowed: true });
  });

  it('Product, high effort, no fixed: base 30%, bid allowed capped at 50%', () => {
    const cell = resolveCompensation('pre_launch', true, false);
    expect(cell).toEqual({ basePercent: 30, bidAllowed: true, fixedPaymentAllowed: true });
  });

  it('Product, high effort, fixed accepted: base 20%, bid allowed capped at 50%', () => {
    const cell = resolveCompensation('pre_launch', true, true);
    expect(cell).toEqual({ basePercent: 20, bidAllowed: true, fixedPaymentAllowed: true });
  });
});

describe('proposal rejection (§14.3, §33.2.8)', () => {
  it('Idea rejects a fixed-payment request — accepted or merely requested', () => {
    // An accepted fixed payment on Idea is not a matrix cell at all.
    expect(() => resolveCompensation('pre_build', false, true)).toThrow(MoneyRuleError);
    expect(() => resolveCompensation('pre_build', true, true)).toThrow(MoneyRuleError);
    // A fixed-payment request in a proposal is rejected against an Idea cell.
    const idea = resolveCompensation('pre_build', true, false);
    expect(() => validateProposal(idea, { fixedPaymentRequested: true })).toThrow(MoneyRuleError);
  });

  it('a standard campaign rejects a bid above base', () => {
    for (const type of ['pre_build', 'pre_launch'] as const) {
      const standard = resolveCompensation(type, false, false);
      expect(() => validateProposal(standard, { bidPercent: 31 })).toThrow(MoneyRuleError);
      // At base is not "above base" — nothing to reject.
      expect(() => validateProposal(standard, { bidPercent: 30 })).not.toThrow();
    }
  });

  it('a high-effort campaign accepts a bid above base up to 50%', () => {
    const highEffort = resolveCompensation('pre_build', true, false);
    expect(() => validateProposal(highEffort, { bidPercent: 45 })).not.toThrow();
    expect(() => validateProposal(highEffort, { bidPercent: 50 })).not.toThrow();
    expect(() => validateProposal(highEffort, { bidPercent: 51 })).toThrow(MoneyRuleError);
  });
});

describe('percentage ceiling (§6, §14.3, §33.2.12)', () => {
  it('base + bid + bonus at 50% passes; one point over throws', () => {
    expect(combinedPercent({ basePercent: 30, bidIncreasePercent: 10, bonusPercent: 10 })).toBe(50);
    expect(() =>
      combinedPercent({ basePercent: 30, bidIncreasePercent: 10, bonusPercent: 11 }),
    ).toThrow(MoneyRuleError);
  });

  it('every component participates in the ceiling', () => {
    expect(() => combinedPercent({ basePercent: 30, bidIncreasePercent: 21 })).toThrow(
      MoneyRuleError,
    );
    expect(() => combinedPercent({ basePercent: 30, bonusPercent: 21 })).toThrow(MoneyRuleError);
    expect(combinedPercent({ basePercent: 20, bidIncreasePercent: 15, bonusPercent: 15 })).toBe(50);
  });

  it('a fixed amount sits outside the ceiling — it is not even a parameter', () => {
    // The API takes percentages only; a fixed amount cannot be passed in, so
    // it can never count toward the 50%. A 20%-base cell (fixed accepted)
    // still bids/bonuses to 50 independent of the fixed amount.
    expect(combinedPercent({ basePercent: 20, bidIncreasePercent: 20, bonusPercent: 10 })).toBe(50);
  });
});
