/**
 * Phase 03 "Done when": every illegal transition in all three machines
 * throws; forbidden reversals are impossible; parallel fields stay separate
 * from lifecycle (§23.2); `review_ready` is derived, never stored.
 *
 * The exhaustive check iterates every (from, to) pair in each machine —
 * anything not in the legal map must throw IllegalTransitionError.
 */

import { describe, it, expect } from 'vitest';
import { IllegalTransitionError, type StateMachine } from './machine.js';
import { campaignMachine, CAMPAIGN_STATUSES } from './campaign.js';
import { associationMachine, ASSOCIATION_STATUSES } from './association.js';
import { reservationMachine, RESERVATION_STATUSES } from './reservation.js';
import {
  deriveReviewReady,
  AFFILIATE_ROSTER_STATUSES,
  CAMPAIGN_BUILD_STATUSES,
  PAYMENT_FLAGS,
} from './parallel.js';

function exhaustively<S extends string>(machine: StateMachine<S>) {
  let legal = 0;
  let illegal = 0;
  for (const from of machine.states) {
    for (const to of machine.states) {
      if (from === to) continue;
      if (machine.canTransition(from, to)) {
        expect(() => machine.assertTransition(from, to)).not.toThrow();
        legal++;
      } else {
        expect(() => machine.assertTransition(from, to)).toThrow(IllegalTransitionError);
        illegal++;
      }
    }
  }
  return { legal, illegal };
}

describe('campaign lifecycle machine (§23.1)', () => {
  it('declares all 27 §23.1 states', () => {
    expect(CAMPAIGN_STATUSES).toHaveLength(27);
    expect(campaignMachine.states).toEqual(CAMPAIGN_STATUSES);
  });

  it('throws on every transition not in the legal map', () => {
    const { legal, illegal } = exhaustively(campaignMachine);
    expect(legal).toBeGreaterThan(0);
    expect(legal + illegal).toBe(27 * 26);
  });

  it('walks the §23.1 happy path end to end', () => {
    const path = [
      'invited_draft',
      'vetting_submitted',
      'account_claimed',
      'stripe_onboarding_pending',
      'listing_fee_pending',
      'affiliate_response_and_build',
      'pending_review',
      'approved',
      'creator_prep',
      'live',
      'closed_pending_capture',
      'capture_retry_window',
      'closed_reconciling',
      'captured_pending_w9',
      'first_payment_released',
      'day_14_review',
      'remaining_payment_released',
      'fulfilled',
      'closed_resolved',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => campaignMachine.assertTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('forbids the classic shortcuts and reversals', () => {
    // No payment before reconciliation.
    expect(() =>
      campaignMachine.assertTransition('live', 'single_payment_released'),
    ).toThrow(IllegalTransitionError);
    // No going live without approval.
    expect(() => campaignMachine.assertTransition('listing_fee_pending', 'live')).toThrow(
      IllegalTransitionError,
    );
    // A refunded/terminated campaign cannot silently reactivate (§14.6).
    expect(() =>
      campaignMachine.assertTransition('ended_no_charge', 'affiliate_response_and_build'),
    ).toThrow(IllegalTransitionError);
    expect(() =>
      campaignMachine.assertTransition('refunded_no_creator', 'creator_prep'),
    ).toThrow(IllegalTransitionError);
    // closed_resolved is terminal.
    expect(() => campaignMachine.assertTransition('closed_resolved', 'live')).toThrow(
      IllegalTransitionError,
    );
  });

  it('terminal states match the DB trigger list in migration 0001', () => {
    expect([...campaignMachine.terminalStates()].sort()).toEqual(
      ['banned_founder', 'closed_resolved', 'ended_no_charge', 'refunded_no_creator'].sort(),
    );
  });
});

describe('campaign–affiliate association machine (§23.4)', () => {
  it('declares all 19 §23.4 states', () => {
    expect(ASSOCIATION_STATUSES).toHaveLength(19);
  });

  it('throws on every transition not in the legal map', () => {
    const { legal, illegal } = exhaustively(associationMachine);
    expect(legal).toBeGreaterThan(0);
    expect(legal + illegal).toBe(19 * 18);
  });

  it('acceptance is not activation (§14.2): accepted cannot jump to active', () => {
    expect(() => associationMachine.assertTransition('accepted', 'active')).toThrow(
      IllegalTransitionError,
    );
  });

  it('a declined or expired association cannot reactivate (§14.6)', () => {
    for (const dead of ['declined', 'expired_no_acceptance'] as const) {
      for (const target of ASSOCIATION_STATUSES) {
        if (target === dead) continue;
        expect(() => associationMachine.assertTransition(dead, target)).toThrow(
          IllegalTransitionError,
        );
      }
    }
  });

  it('terminal states match the DB trigger list in migration 0001', () => {
    expect([...associationMachine.terminalStates()].sort()).toEqual(
      [
        'completion_disqualified',
        'declined',
        'expired_no_acceptance',
        'removed',
        'successfully_completed',
      ].sort(),
    );
  });
});

describe('reservation machine (§23.5)', () => {
  it('declares all 11 §23.5 states', () => {
    expect(RESERVATION_STATUSES).toHaveLength(11);
  });

  it('throws on every transition not in the legal map', () => {
    const { legal, illegal } = exhaustively(reservationMachine);
    expect(legal).toBeGreaterThan(0);
    expect(legal + illegal).toBe(11 * 10);
  });

  it('forbidden reversals are impossible (§23.5, §24.9)', () => {
    // Charge after valid cancellation cannot be expressed as a transition.
    expect(() =>
      reservationMachine.assertTransition('reserved_canceled', 'pending_capture'),
    ).toThrow(IllegalTransitionError);
    expect(() => reservationMachine.assertTransition('reserved_canceled', 'captured')).toThrow(
      IllegalTransitionError,
    );
    // A threshold miss can never become a charge.
    expect(() =>
      reservationMachine.assertTransition('threshold_not_met_no_charge', 'pending_capture'),
    ).toThrow(IllegalTransitionError);
    // A dropped payment cannot quietly capture after the window.
    expect(() =>
      reservationMachine.assertTransition('capture_failed_dropped', 'captured'),
    ).toThrow(IllegalTransitionError);
    // Money returned is money returned.
    expect(() => reservationMachine.assertTransition('refunded', 'captured')).toThrow(
      IllegalTransitionError,
    );
    expect(() => reservationMachine.assertTransition('reversed', 'captured')).toThrow(
      IllegalTransitionError,
    );
  });

  it('terminal states match the DB trigger list in migration 0001', () => {
    expect([...reservationMachine.terminalStates()].sort()).toEqual(
      [
        'capture_failed_dropped',
        'killed_no_charge',
        'refunded',
        'reserved_canceled',
        'reversed',
        'threshold_not_met_no_charge',
      ].sort(),
    );
  });
});

describe('parallel fields stay separate (§23.2, §23.3)', () => {
  it('roster and build statuses are their own small enums, not campaign states', () => {
    expect(AFFILIATE_ROSTER_STATUSES).toEqual(['forming', 'launch_ready', 'failed']);
    expect(CAMPAIGN_BUILD_STATUSES).toEqual(['not_started', 'in_progress', 'complete']);
    for (const s of [...AFFILIATE_ROSTER_STATUSES, ...CAMPAIGN_BUILD_STATUSES]) {
      expect(CAMPAIGN_STATUSES).not.toContain(s);
    }
  });

  it('review_ready follows the build and is not blocked by matching', () => {
    for (const roster of AFFILIATE_ROSTER_STATUSES) {
      for (const build of CAMPAIGN_BUILD_STATUSES) {
        expect(deriveReviewReady(roster, build)).toBe(
          build === 'complete',
        );
      }
    }
  });

  it('the eight §23.3 payment flags never appear in the lifecycle enum', () => {
    expect(PAYMENT_FLAGS).toHaveLength(8);
    for (const flag of PAYMENT_FLAGS) {
      expect(CAMPAIGN_STATUSES).not.toContain(flag);
    }
  });
});
