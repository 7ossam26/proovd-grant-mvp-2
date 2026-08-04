/**
 * The §22.1/§24.4 earnings kernels — the pure halves of §33.8.1, §33.8.2,
 * §33.8.5, §33.8.6, and §33.8.7. The backend suite proves the same rules
 * through the database; these prove the arithmetic decisions themselves.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPLETION_OUTCOMES,
  completionConsequence,
  bonusTriggered,
  earnedPercentFor,
  finalizeEarningsRows,
  transferTotalCents,
  canMoveEarningsState,
  EARNINGS_STATE_TRANSITIONS,
  THANK_YOU_ELIGIBILITY_FACTS,
  THANK_YOU_FUNDING_SOURCE,
  type AttributedCaptureRow,
} from './earnings.js';
import { EARNINGS_STATES } from '../live/earnings.js';

const row = (
  id: string,
  subtotal: bigint,
  provisional: bigint,
  valid = true,
): AttributedCaptureRow => ({
  reservationId: id,
  rewardSubtotalCents: subtotal,
  provisionalCents: provisional,
  validlyAttributed: valid,
});

describe('§22.1 completion outcomes', () => {
  it('is the Spec table, row for row', () => {
    expect(COMPLETION_OUTCOMES.map((o) => o.key)).toEqual([
      'no_valid_post',
      'valid_post_later_incomplete',
      'complete_verified',
      'disqualified',
    ]);
  });

  it('no valid post returns the fixed amount and yields zero commission (§33.8.5)', () => {
    expect(completionConsequence('no_valid_post', true)).toEqual({
      fixed: 'return_full',
      commission: 'none',
    });
  });

  it('valid post + incomplete later work returns the fixed amount but preserves commission (§33.8.6)', () => {
    expect(completionConsequence('valid_post_later_incomplete', true)).toEqual({
      fixed: 'return_full',
      commission: 'genuine',
    });
  });

  it('full completion earns the fixed amount regardless of sales (§33.8.7)', () => {
    expect(completionConsequence('complete_verified', true)).toEqual({
      fixed: 'eligible_full',
      commission: 'genuine',
    });
  });

  it('no fixed arrangement is commission only — the fifth case is a parameter', () => {
    expect(completionConsequence('complete_verified', false)).toEqual({
      fixed: 'not_applicable',
      commission: 'genuine',
    });
    expect(completionConsequence('no_valid_post', false)).toEqual({
      fixed: 'not_applicable',
      commission: 'none',
    });
  });

  it('disqualification cancels commission and routes the fixed amount to recovery', () => {
    expect(completionConsequence('disqualified', true)).toEqual({
      fixed: 'cancel_or_recover',
      commission: 'none',
    });
  });
});

describe('§22.1 earned percentage', () => {
  it('bonus triggers on the measured unit against the stored threshold', () => {
    const terms = {
      triggerUnit: 'attributed_subtotal_cents' as const,
      threshold: 100_000n,
      additionalPercent: 10,
      maxCombinedPercent: 45,
    };
    expect(bonusTriggered(terms, { validSubtotalCents: 100_000n, uniqueBackers: 0 })).toBe(true);
    expect(bonusTriggered(terms, { validSubtotalCents: 99_999n, uniqueBackers: 50 })).toBe(false);

    const byBackers = { ...terms, triggerUnit: 'unique_attributed_backers' as const, threshold: 5n };
    expect(bonusTriggered(byBackers, { validSubtotalCents: 0n, uniqueBackers: 5 })).toBe(true);
    expect(bonusTriggered(byBackers, { validSubtotalCents: 1_000_000n, uniqueBackers: 4 })).toBe(false);
  });

  it('combines locked + bonus, bounded by the stored maximum and the ceiling', () => {
    const bonus = {
      triggerUnit: 'attributed_subtotal_cents' as const,
      threshold: 0n,
      additionalPercent: 15,
      maxCombinedPercent: 40,
    };
    expect(
      earnedPercentFor({ lockedTotalPercent: 30, bonus, bonusTriggered: true, ceilingPercent: 50 }),
    ).toEqual({ earnedBonusPercent: 15, earnedPercent: 40 });
    expect(
      earnedPercentFor({ lockedTotalPercent: 30, bonus, bonusTriggered: false, ceilingPercent: 50 }),
    ).toEqual({ earnedBonusPercent: 0, earnedPercent: 30 });
    expect(
      earnedPercentFor({
        lockedTotalPercent: 45,
        bonus: { ...bonus, maxCombinedPercent: 50, additionalPercent: 20 },
        bonusTriggered: true,
        ceilingPercent: 50,
      }),
    ).toEqual({ earnedBonusPercent: 20, earnedPercent: 50 });
  });
});

describe('§24.4 finalization rows', () => {
  it('applies the earned percentage to validly attributed rows and returns the rest (§33.8.2)', () => {
    const result = finalizeEarningsRows({
      commission: 'genuine',
      earnedPercent: 30,
      lockedTotalPercent: 30,
      ceilingPercent: 50,
      rows: [
        row('r1', 10_000n, 4_000n), // provisioned at 40% max
        row('r2', 5_000n, 2_000n, false), // attribution never verified
      ],
    });
    expect(result.perRow).toEqual([
      { reservationId: 'r1', earnedCents: 3_000n, unearnedReturnedCents: 1_000n },
      { reservationId: 'r2', earnedCents: 0n, unearnedReturnedCents: 2_000n },
    ]);
    expect(result.validSubtotalCents).toBe(10_000n);
    expect(result.earnedTotalCents).toBe(3_000n);
    expect(result.unearnedReturnedTotalCents).toBe(3_000n);
    // §24.4 identity: earned + returned = provisional, per row and in total.
    expect(result.earnedTotalCents + result.unearnedReturnedTotalCents).toBe(
      result.provisionalTotalCents,
    );
  });

  it('commission is the locked portion and the bonus is the exact remainder', () => {
    const result = finalizeEarningsRows({
      commission: 'genuine',
      earnedPercent: 40,
      lockedTotalPercent: 30,
      ceilingPercent: 50,
      rows: [row('r1', 9_999n, 4_999n)],
    });
    expect(result.commissionCents).toBe(2_999n); // floor(9999 × 30%)
    expect(result.earnedTotalCents).toBe(3_999n); // floor(9999 × 40%)
    expect(result.bonusCents).toBe(1_000n);
    expect(result.commissionCents + result.bonusCents).toBe(result.earnedTotalCents);
  });

  it("commission 'none' earns zero everywhere and returns every provisional cent (§33.8.5)", () => {
    const result = finalizeEarningsRows({
      commission: 'none',
      earnedPercent: 30,
      lockedTotalPercent: 30,
      ceilingPercent: 50,
      rows: [row('r1', 10_000n, 4_000n), row('r2', 20_000n, 8_000n)],
    });
    expect(result.earnedTotalCents).toBe(0n);
    expect(result.commissionCents).toBe(0n);
    expect(result.unearnedReturnedTotalCents).toBe(12_000n);
  });

  it('refuses an earned amount above the provisioned maximum (§24.4)', () => {
    expect(() =>
      finalizeEarningsRows({
        commission: 'genuine',
        earnedPercent: 50,
        lockedTotalPercent: 50,
        ceilingPercent: 50,
        rows: [row('r1', 10_000n, 3_000n)], // provisioned below the earned percent
      }),
    ).toThrowError(/§24\.4/);
  });

  it('there is no tax input anywhere in the kernel (§33.8.1)', () => {
    // §24.3's structural exclusion: the row type carries subtotal and
    // provisional only. A tax field cannot be passed because none exists.
    const keys = Object.keys(row('r', 1n, 0n));
    expect(keys.sort()).toEqual([
      'provisionalCents',
      'reservationId',
      'rewardSubtotalCents',
      'validlyAttributed',
    ]);
  });
});

describe('§22.1 the one Transfer and the state machine', () => {
  it('the Transfer total is the sum of exactly three components (§33.8.3)', () => {
    expect(
      transferTotalCents({ commissionCents: 3_000n, bonusCents: 1_000n, eligibleFixedCents: 50_000n }),
    ).toBe(54_000n);
  });

  it('every state has transitions and adjusted is terminal', () => {
    for (const state of EARNINGS_STATES) {
      expect(EARNINGS_STATE_TRANSITIONS[state]).toBeDefined();
    }
    expect(EARNINGS_STATE_TRANSITIONS.adjusted).toEqual([]);
    expect(canMoveEarningsState('finalized', 'approved_for_transfer')).toBe(true);
    expect(canMoveEarningsState('approved_for_transfer', 'transferred')).toBe(true);
    expect(canMoveEarningsState('transferred', 'paid_out')).toBe(true);
    expect(canMoveEarningsState('transferred', 'payout_failed')).toBe(true);
    // A finalized number does not un-finalize, and paid money does not
    // silently return to approved.
    expect(canMoveEarningsState('finalized', 'estimated')).toBe(false);
    expect(canMoveEarningsState('paid_out', 'transferred')).toBe(false);
  });
});

describe('§22.2 thank-you constants', () => {
  it('three Admin-confirmed facts, one pinned funding source, no calculator', () => {
    expect(THANK_YOU_ELIGIBILITY_FACTS.map((f) => f.key)).toEqual([
      'minimum_work_completed',
      'click_threshold_met',
      'brand_aup_compliant',
    ]);
    expect(THANK_YOU_FUNDING_SOURCE).toBe('proovd_retained_listing_fee_revenue');
  });
});
