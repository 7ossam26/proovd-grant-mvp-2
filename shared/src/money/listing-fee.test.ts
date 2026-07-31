/**
 * §33.3.2 — every item combination produces US$35 minus US$2/item to US$25
 * minimum. Five optional items → all 32 combinations.
 */

import { describe, it, expect } from 'vitest';
import { computeListingFee, type OptionalItemCompletion } from './listing-fee.js';

const KEYS = ['visuals', 'branding', 'interviewConfirmed', 'story', 'socials'] as const;

function combination(bits: number): OptionalItemCompletion {
  return {
    visuals: Boolean(bits & 1),
    branding: Boolean(bits & 2),
    interviewConfirmed: Boolean(bits & 4),
    story: Boolean(bits & 8),
    socials: Boolean(bits & 16),
  };
}

describe('listing fee (§12, §33.3.2)', () => {
  it('produces the correct total for all 32 combinations', () => {
    for (let bits = 0; bits < 32; bits++) {
      const items = combination(bits);
      const completed = KEYS.filter((k) => items[k]).length;
      const result = computeListingFee(items);

      const expectedDiscount = BigInt(Math.min(200 * completed, 1000));
      const expectedSubtotal = BigInt(Math.max(2500, 3500 - 200 * completed));

      expect(result.baseCents).toBe(3500n);
      expect(result.completedItems).toBe(completed);
      expect(result.discountCents).toBe(expectedDiscount);
      expect(result.subtotalCents).toBe(expectedSubtotal);
    }
  });

  it('floors at exactly US$25 with all five items completed', () => {
    const result = computeListingFee({
      visuals: true,
      branding: true,
      interviewConfirmed: true,
      story: true,
      socials: true,
    });
    expect(result.discountCents).toBe(1000n);
    expect(result.subtotalCents).toBe(2500n);
  });

  it('caps the discount at US$10 (§12)', () => {
    const result = computeListingFee({
      visuals: true,
      branding: true,
      interviewConfirmed: true,
      story: true,
      socials: true,
    });
    // 5 × US$2 = US$10 — at, never above, the cap.
    expect(result.discountCents).toBe(1000n);
  });

  it('itemizes each earned US$2 saving as its own line (§13)', () => {
    const result = computeListingFee({
      visuals: true,
      branding: false,
      interviewConfirmed: true,
      story: false,
      socials: false,
    });
    expect(result.discountLines).toEqual([
      { item: 'visuals', discountCents: 200n },
      { item: 'interviewConfirmed', discountCents: 200n },
    ]);
    expect(result.subtotalCents).toBe(3100n);
  });
});
