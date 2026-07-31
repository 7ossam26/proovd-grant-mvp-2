/**
 * Founder payment split (§6): Idea 100% single payment; Product 40%/60%,
 * summing exactly with no lost cent.
 */

import { describe, it, expect } from 'vitest';
import { ideaSinglePayment, productPaymentSplit } from './schedule.js';

describe('founder payment schedule split (§6)', () => {
  it('Idea: one payment of 100%', () => {
    expect(ideaSinglePayment(123_456n)).toEqual({ singlePaymentCents: 123_456n });
  });

  it('Product: 40% first, exact remainder as remaining payment', () => {
    expect(productPaymentSplit(100_000n)).toEqual({
      firstPaymentCents: 40_000n,
      remainingPaymentCents: 60_000n,
    });
  });

  it('odd amounts still sum exactly', () => {
    for (const amount of [1n, 3n, 99n, 101n, 12_345n]) {
      const { firstPaymentCents, remainingPaymentCents } = productPaymentSplit(amount);
      expect(firstPaymentCents + remainingPaymentCents).toBe(amount);
    }
  });
});
