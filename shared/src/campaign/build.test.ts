/**
 * §14.4 build completeness and §15 six-rule roster readiness — the pure logic.
 * The backend restates these in `backend/src/build/logic.ts` and drift-tests
 * against this module; here we prove the rules themselves.
 */

import { describe, it, expect } from 'vitest';
import {
  missingBuildFields,
  deriveBuildStatus,
  deriveRosterReadiness,
  INTERNAL_TARGET_CAP_CENTS,
  type BuildSnapshot,
  type RosterCandidate,
} from './index.js';

const FULL_PRODUCT_FIELDS = {
  title: 'x',
  founderDisplayName: 'x',
  founderCountry: 'US',
  founderProfileUrl: 'https://x',
  opensAt: new Date(),
  closesAt: new Date(),
  brandPerception: 'x',
  brandVoice: 'x',
  heroPreference: 'x',
  publicStory: 'x',
  internalTargetCents: 100n,
};

function productSnapshot(overrides: Partial<BuildSnapshot> = {}): BuildSnapshot {
  return {
    campaignType: 'pre_launch',
    fields: { ...FULL_PRODUCT_FIELDS },
    rewardPackageCount: 1,
    refundPolicyPresent: true,
    ...overrides,
  };
}

describe('§14.4 build completeness', () => {
  it('a full Product build is complete', () => {
    expect(missingBuildFields(productSnapshot())).toEqual([]);
    expect(deriveBuildStatus(productSnapshot())).toBe('complete');
  });

  it('an empty build is not_started; a partial one is in_progress', () => {
    const empty: BuildSnapshot = {
      campaignType: 'pre_launch',
      fields: {},
      rewardPackageCount: 0,
      refundPolicyPresent: false,
    };
    expect(deriveBuildStatus(empty)).toBe('not_started');
    expect(deriveBuildStatus({ ...empty, fields: { title: 'x' } })).toBe('in_progress');
  });

  it('a Product build without a refund policy or a reward is incomplete', () => {
    expect(missingBuildFields(productSnapshot({ refundPolicyPresent: false }))).toContain('refundPolicy');
    expect(missingBuildFields(productSnapshot({ rewardPackageCount: 0 }))).toContain('rewardPackages');
  });

  it('an Idea build needs the threshold, window, disclaimer, and risks — not a refund policy', () => {
    const idea: BuildSnapshot = {
      campaignType: 'pre_build',
      fields: {
        title: 'x',
        founderDisplayName: 'x',
        founderCountry: 'US',
        founderProfileUrl: 'https://x',
        opensAt: new Date(),
        closesAt: new Date(),
        brandPerception: 'x',
        brandVoice: 'x',
        heroPreference: 'x',
        publicStory: 'x',
        orderThreshold: 500,
        deliveryWindow: 'Q1',
        earlyProductDisclaimer: 'x',
        risksAndChallenges: 'x',
      },
      rewardPackageCount: 1,
      refundPolicyPresent: false,
    };
    expect(missingBuildFields(idea)).toEqual([]);
    const missingThreshold = { ...idea, fields: { ...idea.fields, orderThreshold: null } };
    expect(missingBuildFields(missingThreshold)).toContain('orderThreshold');
  });

  it('the internal target cap is US$50,000', () => {
    expect(INTERNAL_TARGET_CAP_CENTS).toBe(5_000_000n);
  });
});

describe('§15 six-rule roster readiness', () => {
  const accepted: RosterCandidate = {
    associationId: 'a',
    rosterDecision: 'included',
    launchRequired: true,
    hasLockedAgreement: true,
    hasOpenProposal: false,
    recordsComplete: true,
    reacceptancePending: false,
  };

  it('all six met → ready', () => {
    const r = deriveRosterReadiness({ initialRosterFinalized: true, candidates: [accepted] });
    expect(r.ready).toBe(true);
    expect(r.unmetRules).toEqual([]);
    expect(r.finalRosterAssociationIds).toEqual(['a']);
  });

  it('rule 1: no accepted Creator blocks', () => {
    const r = deriveRosterReadiness({
      initialRosterFinalized: true,
      candidates: [{ ...accepted, hasLockedAgreement: false, rosterDecision: 'pending', launchRequired: false }],
    });
    expect(r.unmetRules).toContain(1);
  });

  it('rule 2: not finalized blocks', () => {
    const r = deriveRosterReadiness({ initialRosterFinalized: false, candidates: [accepted] });
    expect(r.unmetRules).toContain(2);
  });

  it('rule 4: an open proposal on a rostered Creator blocks', () => {
    const r = deriveRosterReadiness({
      initialRosterFinalized: true,
      candidates: [{ ...accepted, hasOpenProposal: true }],
    });
    expect(r.unmetRules).toEqual(expect.arrayContaining([4]));
  });

  it('rule 5: a non-required pending Creator does not block; a required one does', () => {
    const nonRequiredPending: RosterCandidate = {
      associationId: 'b',
      rosterDecision: 'pending',
      launchRequired: false,
      hasLockedAgreement: false,
      hasOpenProposal: false,
      recordsComplete: false,
      reacceptancePending: false,
    };
    const ok = deriveRosterReadiness({
      initialRosterFinalized: true,
      candidates: [accepted, nonRequiredPending],
    });
    expect(ok.ready).toBe(true);

    const blocked = deriveRosterReadiness({
      initialRosterFinalized: true,
      candidates: [accepted, { ...nonRequiredPending, launchRequired: true }],
    });
    expect(blocked.unmetRules).toContain(5);
  });

  it('rule 6: a pending reacceptance invalidates a rostered Creator', () => {
    const r = deriveRosterReadiness({
      initialRosterFinalized: true,
      candidates: [{ ...accepted, reacceptancePending: true }],
    });
    expect(r.unmetRules).toEqual(expect.arrayContaining([5, 6]));
    expect(r.ready).toBe(false);
  });
});
