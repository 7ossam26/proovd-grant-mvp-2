/**
 * §22.3's registers and kernels (Phase 19b): the W-9 machine, the payment
 * schedules, the eligible-share formula, and the early-release vocabulary.
 */

import { describe, it, expect } from 'vitest';
import {
  W9_STATUSES,
  W9_STATE_TRANSITIONS,
  canMoveW9State,
  W9_STATE_LINES,
  W9_NO_ACTION_NEEDED,
  FOUNDER_PAYMENT_KINDS,
  FOUNDER_PAYMENT_KIND_LABELS,
  FOUNDER_PAYMENT_SCHEDULES,
  eligibleFounderShareCents,
  founderPaymentAmountCents,
  EARLY_RELEASE_EVIDENCE_FACTS,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14,
  FOUNDER_PAYMENT_STATUS_FACTS,
} from './founder-payments.js';
import { MONEY_STATUSES, BANNED_MONEY_STATUS_WORDS } from '../admin/money-controls.js';

describe('the W-9 machine (§22.3)', () => {
  it('has three states and the resubmission edge, and verified is terminal', () => {
    expect([...W9_STATUSES]).toEqual(['requested', 'submitted', 'verified']);
    expect(canMoveW9State('requested', 'submitted')).toBe(true);
    expect(canMoveW9State('submitted', 'verified')).toBe(true);
    expect(canMoveW9State('submitted', 'requested')).toBe(true);
    expect(canMoveW9State('requested', 'verified')).toBe(false);
    expect(W9_STATE_TRANSITIONS.verified).toEqual([]);
  });

  it('says `No action needed` while under review, verbatim (§22.3, §11)', () => {
    expect(W9_STATE_LINES.submitted.action).toBe(W9_NO_ACTION_NEEDED);
    expect(W9_NO_ACTION_NEEDED).toBe('No action needed');
  });
});

describe('the payment schedules (§22.3)', () => {
  it('Idea has exactly one entry — the 100% Day 3 single payment (§33.8.10)', () => {
    const idea = FOUNDER_PAYMENT_SCHEDULES.idea;
    expect(idea).toHaveLength(1);
    expect(idea[0]!.kind).toBe('single_payment');
    expect(idea[0]!.defaultDay).toBe(3);
    expect(idea[0]!.defaultPercent).toBe(100);
  });

  it('Product is 40% Day 3 then the remainder at Day 14 (§33.8.11)', () => {
    const product = FOUNDER_PAYMENT_SCHEDULES.product;
    expect(product.map((p) => p.kind)).toEqual(['first_payment', 'remaining_payment']);
    expect(product[0]!.defaultDay).toBe(3);
    expect(product[0]!.defaultPercent).toBe(40);
    expect(product[1]!.defaultDay).toBe(14);
    expect(product[1]!.defaultPercent).toBe(60);
    expect(product[1]!.amountRule).toBe('remainder');
  });

  it('kind labels are §3.1 customer-facing names, never internal keys', () => {
    for (const kind of FOUNDER_PAYMENT_KINDS) {
      expect(FOUNDER_PAYMENT_KIND_LABELS[kind]).not.toMatch(/_/);
    }
    expect(FOUNDER_PAYMENT_KIND_LABELS.single_payment).toBe('Single Founder payment');
  });
});

describe('the eligible Founder share (§22.3)', () => {
  it('subtracts all four terms from the captured pre-tax subtotal', () => {
    expect(
      eligibleFounderShareCents({
        rewardSubtotalCapturedCents: 100_000n,
        proovdFeeCents: 5_000n,
        finalizedCreatorCompensationCents: 20_000n,
        causeBasedAdjustmentsCents: 1_000n,
        stripeFeesAllocatedToFounderCents: 3_000n,
      }),
    ).toBe(71_000n);
  });

  it('throws on a negative result rather than clamping it', () => {
    expect(() =>
      eligibleFounderShareCents({
        rewardSubtotalCapturedCents: 1_000n,
        proovdFeeCents: 5_000n,
        finalizedCreatorCompensationCents: 0n,
        causeBasedAdjustmentsCents: 0n,
        stripeFeesAllocatedToFounderCents: 0n,
      }),
    ).toThrow(/does not balance/);
  });

  it('has no tax input at all — tax is separate (§24.3)', () => {
    // The structural exclusion: the formula cannot be handed tax to subtract
    // or include, because no field exists for it.
    const input = {
      rewardSubtotalCapturedCents: 100n,
      proovdFeeCents: 0n,
      finalizedCreatorCompensationCents: 0n,
      causeBasedAdjustmentsCents: 0n,
      stripeFeesAllocatedToFounderCents: 0n,
    };
    expect(Object.keys(input).some((k) => /tax/i.test(k))).toBe(false);
    expect(eligibleFounderShareCents(input)).toBe(100n);
  });
});

describe('the payment amounts (§22.3, §33.8.11)', () => {
  it('single and first take their percentage, floored', () => {
    expect(
      founderPaymentAmountCents({ kind: 'single_payment', eligibleShareCents: 71_001n, percent: 100 }),
    ).toBe(71_001n);
    expect(
      founderPaymentAmountCents({ kind: 'first_payment', eligibleShareCents: 71_001n, percent: 40 }),
    ).toBe(28_400n);
  });

  it('remaining is the exact remainder, so first + remaining = share to the cent', () => {
    const share = 71_001n;
    const first = founderPaymentAmountCents({
      kind: 'first_payment',
      eligibleShareCents: share,
      percent: 40,
    });
    const remaining = founderPaymentAmountCents({
      kind: 'remaining_payment',
      eligibleShareCents: share,
      percent: 60,
      firstPaymentCents: first,
    });
    expect(first + remaining).toBe(share);
  });

  it('remaining without the first amount, or exceeding the share, is refused', () => {
    expect(() =>
      founderPaymentAmountCents({ kind: 'remaining_payment', eligibleShareCents: 100n, percent: 60 }),
    ).toThrow(/remaining/);
    expect(() =>
      founderPaymentAmountCents({
        kind: 'remaining_payment',
        eligibleShareCents: 100n,
        percent: 60,
        firstPaymentCents: 200n,
      }),
    ).toThrow(/exceeds/);
  });
});

describe('early release and the status contract (§22.3)', () => {
  it('names four separate proofs, and the first refuses internal readiness', () => {
    expect(EARLY_RELEASE_EVIDENCE_FACTS.map((f) => f.key)).toEqual([
      'delivery_available',
      'communication_sent',
      'tax_payment_complete',
      'no_immediate_risk',
    ]);
    expect(EARLY_RELEASE_EVIDENCE_FACTS[0]!.note).toMatch(/Internal readiness alone is insufficient/);
  });

  it('pins the never-skips-Day-14 sentence (§33.8.12)', () => {
    expect(EARLY_RELEASE_NEVER_SKIPS_DAY_14).toMatch(/does not skip the Day 14 status review/);
  });

  it('the §22.3 display contract lists all six facts', () => {
    expect(FOUNDER_PAYMENT_STATUS_FACTS.map((f) => f.key)).toEqual([
      'exact_amount_affected',
      'requirement_or_blocker',
      'secure_action',
      'submitted_verified_state',
      'next_review_date',
      'no_action_needed_under_review',
    ]);
  });

  it('uses only §22.3 vocabulary — never a banned money-status word', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('./founder-payments.ts', import.meta.url),
      'utf8',
    );
    for (const banned of BANNED_MONEY_STATUS_WORDS) {
      expect(source.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    expect([...MONEY_STATUSES]).toEqual(['eligible', 'blocked', 'released']);
  });
});
