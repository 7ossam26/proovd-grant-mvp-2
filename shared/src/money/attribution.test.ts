/**
 * §33.2.13 — a Creator-specific bonus ignores organic, house, and
 * other-Creator results. Plus the §24.4 provisional/earned reconciliation:
 * provisional is a liability, never Proovd revenue, and the unearned
 * remainder returns to the Founder exactly once.
 */

import { describe, it, expect } from 'vitest';
import {
  creatorAttributedResults,
  earnedBonusPercent,
  provisionalPercent,
  computeProvisionalAmount,
  reconcileProvisional,
  type CapturedCharge,
  type BonusTerms,
} from './attribution.js';
import { MoneyRuleError } from './errors.js';

const CREATOR_A = 'assoc-a';
const CREATOR_B = 'assoc-b';

function charge(
  attribution: CapturedCharge['attribution'],
  rewardSubtotalCents: bigint,
  backerId: string,
  overrides: Partial<Pick<CapturedCharge, 'captured' | 'validlyAttributed'>> = {},
): CapturedCharge {
  return {
    rewardSubtotalCents,
    captured: true,
    validlyAttributed: true,
    attribution,
    backerId,
    ...overrides,
  };
}

/** A mixed ledger: A's valid work is exactly $200 across 2 unique Backers. */
const LEDGER: CapturedCharge[] = [
  charge({ kind: 'creator', associationId: CREATOR_A }, 10_000n, 'backer-1'),
  charge({ kind: 'creator', associationId: CREATOR_A }, 10_000n, 'backer-2'),
  // Same Backer twice — unique count must not double-count.
  charge({ kind: 'creator', associationId: CREATOR_A }, 5_000n, 'backer-2', {
    captured: false, // not captured — excluded from both units
  }),
  charge({ kind: 'creator', associationId: CREATOR_A }, 7_500n, 'backer-3', {
    validlyAttributed: false, // attribution failed verification — excluded
  }),
  // Another Creator's results.
  charge({ kind: 'creator', associationId: CREATOR_B }, 50_000n, 'backer-4'),
  // Organic and house results.
  charge({ kind: 'organic' }, 100_000n, 'backer-5'),
  charge({ kind: 'house' }, 100_000n, 'backer-6'),
];

describe('Creator-attributed results (§14.3, §33.2.13)', () => {
  it("sums only this Creator's captured, validly attributed subtotal", () => {
    const results = creatorAttributedResults(CREATOR_A, LEDGER);
    expect(results.subtotalCents).toBe(20_000n);
    expect(results.uniqueBackers).toBe(2);
  });

  it('ignores organic, house, and other-Creator results entirely', () => {
    // Creator A's results are identical whether or not the huge organic,
    // house, and Creator-B charges exist.
    const onlyMine = LEDGER.filter(
      (c) => c.attribution.kind === 'creator' && c.attribution.associationId === CREATOR_A,
    );
    expect(creatorAttributedResults(CREATOR_A, LEDGER)).toEqual(
      creatorAttributedResults(CREATOR_A, onlyMine),
    );
  });
});

describe('Creator-specific bonus trigger (§14.3, §33.2.13)', () => {
  const subtotalBonus: BonusTerms = {
    triggerUnit: 'attributed_subtotal_cents',
    threshold: 20_000n, // $200 — exactly what A's valid work reaches
    additionalPercent: 5,
    maxCombinedPercent: 50,
  };

  it('triggers on own attributed subtotal', () => {
    expect(earnedBonusPercent(subtotalBonus, CREATOR_A, LEDGER)).toBe(5);
  });

  it('does not trigger from whole-campaign volume (organic/house/other Creator)', () => {
    // The campaign as a whole is far past the threshold, but a Creator with
    // nothing attributed earns 0 — organic, house, and other-Creator charges
    // cannot trigger their bonus. Creator B triggers on their own work only.
    expect(earnedBonusPercent(subtotalBonus, 'assoc-nobody', LEDGER)).toBe(0);
    expect(earnedBonusPercent(subtotalBonus, CREATOR_B, LEDGER)).toBe(5);
  });

  it('uncaptured and invalidly attributed charges never count', () => {
    const stricter: BonusTerms = { ...subtotalBonus, threshold: 20_001n };
    // A's captured+valid work is exactly 20_000; the uncaptured 5_000 and
    // invalid 7_500 must not push it over.
    expect(earnedBonusPercent(stricter, CREATOR_A, LEDGER)).toBe(0);
  });

  it('unique-Backer trigger counts unique captured attributed Backers', () => {
    const backerBonus: BonusTerms = {
      triggerUnit: 'unique_attributed_backers',
      threshold: 2n,
      additionalPercent: 3,
      maxCombinedPercent: 50,
    };
    expect(earnedBonusPercent(backerBonus, CREATOR_A, LEDGER)).toBe(3);
    expect(earnedBonusPercent({ ...backerBonus, threshold: 3n }, CREATOR_A, LEDGER)).toBe(0);
  });
});

describe('provisional Affiliate amount (§24.4)', () => {
  it('provisions the maximum that could be owed, including conditional bonus', () => {
    expect(
      provisionalPercent({
        basePercent: 30,
        bidIncreasePercent: 10,
        bonus: {
          triggerUnit: 'attributed_subtotal_cents',
          threshold: 100_000n,
          additionalPercent: 5,
          maxCombinedPercent: 50,
        },
      }),
    ).toBe(45);
    // Bounded by the stored maximum combined percentage and the ceiling.
    expect(
      provisionalPercent({
        basePercent: 30,
        bidIncreasePercent: 15,
        bonus: {
          triggerUnit: 'attributed_subtotal_cents',
          threshold: 100_000n,
          additionalPercent: 10,
          maxCombinedPercent: 50,
        },
      }),
    ).toBe(50);
  });

  it('computes the provisional liability on the attributed subtotal', () => {
    expect(computeProvisionalAmount(45, 20_000n)).toBe(9_000n);
  });

  it('reconciles once: earned transfers, unearned returns to Founder, sums exactly', () => {
    const r = reconcileProvisional({ provisionalCents: 9_000n, earnedCents: 7_000n });
    expect(r).toEqual({ transferCents: 7_000n, returnedToFounderCents: 2_000n });
    // Nothing can remain with the platform: the two outputs consume the
    // provisional liability exactly (never Proovd revenue).
    expect(r.transferCents + r.returnedToFounderCents).toBe(9_000n);
  });

  it('refuses an earned amount above the provisioned maximum', () => {
    expect(() => reconcileProvisional({ provisionalCents: 9_000n, earnedCents: 9_001n })).toThrow(
      MoneyRuleError,
    );
  });
});
