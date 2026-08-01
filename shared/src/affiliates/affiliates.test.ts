import { describe, expect, it } from 'vitest';
import { ASSOCIATION_STATUSES, type AssociationStatus } from '../states/association.js';
import {
  AFFILIATE_SUBTYPES,
  AFFILIATE_SUBTYPE_DEFINITIONS,
  affiliateSubtype,
  missingEvidence,
  requiredEvidenceIds,
} from './subtypes.js';
import * as recruitmentModule from './recruitment.js';
import {
  RECRUITMENT_FIELDS,
  RECRUITMENT_FIELD_IDS,
  REQUIRED_BEFORE_INVITE,
  SPEC_8_FACTS,
} from './recruitment.js';
import {
  ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  SLOT_OCCUPYING_STATUSES,
  occupiesActiveSlot,
  slotUsage,
} from './slots.js';

describe('§5.3 Affiliate subtypes', () => {
  it('defines exactly the seven subtypes §5.3 names, once each', () => {
    expect(AFFILIATE_SUBTYPE_DEFINITIONS.map((d) => d.id)).toEqual([...AFFILIATE_SUBTYPES]);
    expect(new Set(AFFILIATE_SUBTYPES).size).toBe(AFFILIATE_SUBTYPES.length);
    expect(AFFILIATE_SUBTYPES).toHaveLength(7);
  });

  it('gives every subtype at least one unconditional evidence input', () => {
    // §8 requires "verification status and evidence" on every prospect. A
    // subtype with only conditional inputs could be recorded as verified having
    // evidenced nothing.
    for (const subtype of AFFILIATE_SUBTYPES) {
      expect(requiredEvidenceIds(subtype).length).toBeGreaterThan(0);
    }
  });

  it('keeps evidence ids unique within a subtype', () => {
    for (const definition of AFFILIATE_SUBTYPE_DEFINITIONS) {
      const ids = definition.evidence.map((input) => input.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('states a basis for every evidence input', () => {
    // An Admin who does not know what an input is for records something that
    // looks like it. §1.4 in miniature.
    for (const definition of AFFILIATE_SUBTYPE_DEFINITIONS) {
      for (const input of definition.evidence) {
        expect(input.basis.trim()).not.toBe('');
      }
    }
  });

  it('carries §5.3 subtype-specific evidence, not one shared list', () => {
    expect(requiredEvidenceIds('community_owner')).toContain('rules_permission');
    expect(requiredEvidenceIds('course_instructor')).toContain('platform_constraints');
    expect(requiredEvidenceIds('student_affiliate')).toContain('kyc');
    expect(requiredEvidenceIds('niche_marketer')).toContain('identity_disclosed_presence');
    // A social creator has no KYC requirement; a student distributor does.
    expect(requiredEvidenceIds('social_creator')).not.toContain('kyc');
  });

  it('excludes §5.3’s qualified inputs from the required set', () => {
    // §5.3 says "audit where appropriate" for social creators and names an
    // institution disclaimer as a "need". Treating either as mandatory would
    // make a complete record impossible for channels the Spec expects.
    expect(affiliateSubtype('social_creator').evidence.find((e) => e.id === 'audit')?.conditional).toBe(true);
    expect(requiredEvidenceIds('social_creator')).not.toContain('audit');
    expect(requiredEvidenceIds('student_affiliate')).not.toContain('institution_disclaimer');
  });

  it('reports the gap rather than refusing an incomplete record', () => {
    expect(missingEvidence('podcast_host', null)).toEqual(requiredEvidenceIds('podcast_host'));
    expect(missingEvidence('podcast_host', { subscribers: '12k', downloads: '4k/ep' })).toEqual([]);
  });

  it('treats blank and whitespace as missing, not as recorded', () => {
    expect(missingEvidence('podcast_host', { subscribers: '', downloads: '   ' })).toEqual([
      'subscribers',
      'downloads',
    ]);
  });

  it('throws on an unknown subtype rather than returning an empty requirement', () => {
    expect(() => affiliateSubtype('influencer' as never)).toThrow(/Unknown affiliate subtype/);
  });
});

describe('§8 recruitment record', () => {
  it('covers all nineteen facts §8 requires, each by at least one field', () => {
    expect(SPEC_8_FACTS).toHaveLength(19);
    expect(new Set(SPEC_8_FACTS).size).toBe(19);

    const covered = new Set(RECRUITMENT_FIELDS.map((f) => f.fact));
    for (const fact of SPEC_8_FACTS) {
      expect(covered.has(fact), `§8 fact not recorded anywhere: ${fact}`).toBe(true);
    }
    // And nothing is recorded that §8 does not ask for. A field with no §8
    // bullet behind it is a field someone added because a form looked empty.
    for (const field of RECRUITMENT_FIELDS) {
      expect(SPEC_8_FACTS, field.id).toContain(field.fact);
    }
  });

  it('keeps the storable fields consistent with their id list', () => {
    // Twenty-one fields for nineteen facts: §8 names two things in each of two
    // bullets, and those are separate columns.
    expect(RECRUITMENT_FIELDS.map((f) => f.id)).toEqual([...RECRUITMENT_FIELD_IDS]);
    expect(new Set(RECRUITMENT_FIELD_IDS).size).toBe(RECRUITMENT_FIELD_IDS.length);
    expect(RECRUITMENT_FIELD_IDS).toHaveLength(21);
  });

  it('states a basis for every field', () => {
    for (const field of RECRUITMENT_FIELDS) {
      expect(field.basis.trim()).not.toBe('');
    }
  });

  it('requires the unqualified fields before an invitation may be sent', () => {
    expect(REQUIRED_BEFORE_INVITE).toContain('legalName');
    expect(REQUIRED_BEFORE_INVITE).toContain('channelSubtype');
    expect(REQUIRED_BEFORE_INVITE).toContain('recruitingAdmin');
    expect(REQUIRED_BEFORE_INVITE).toContain('campaignAssociation');
    // §8 qualifies these with "where available"/"where relevant".
    expect(REQUIRED_BEFORE_INVITE).not.toContain('audienceDemographics');
    expect(REQUIRED_BEFORE_INVITE).not.toContain('priorSponsoredContent');
    expect(REQUIRED_BEFORE_INVITE).not.toContain('conflictNotes');
  });

  it('keeps the quality tier free of anything rankable (§8)', () => {
    // §8: "used only as assessment data—not as a commission floor." The
    // register must not offer ordered levels; a ranked tier is a default
    // percentage waiting for a caller. Its basis must say so.
    const tier = RECRUITMENT_FIELDS.find((f) => f.id === 'qualityTier')!;
    expect(tier.group).toBe('assessment');
    expect(tier.basis.toLowerCase()).toContain('commission floor');
    // No enum of ranked tier values exists to import — so there is nothing for
    // a later phase to reach for when it wants a default percentage.
    const exported = Object.keys(recruitmentModule);
    expect(exported).not.toContain('QUALITY_TIERS');
    expect(exported.filter((name) => /TIER/i.test(name))).toEqual([]);
  });
});

describe('§2.2 active-partnership slots', () => {
  it('caps at three', () => {
    expect(ACTIVE_PARTNERSHIP_SLOT_LIMIT).toBe(3);
  });

  it('occupies a slot only from tracking-link activation', () => {
    expect(SLOT_OCCUPYING_STATUSES).toEqual(['active', 'paused']);
    expect(occupiesActiveSlot('active')).toBe(true);
  });

  it('keeps the slot while a Creator is paused (§33.4.8)', () => {
    // A paused partnership is not a closed campaign and not a recorded
    // removal, so §2.2's slot is still running. Releasing it would let one
    // Creator hold four campaigns by having one go wrong.
    expect(occupiesActiveSlot('paused')).toBe(true);
  });

  it('consumes no slot in any pre-activation state (§8)', () => {
    // §8 names three explicitly; the rule is really "before activation".
    const preActivation: AssociationStatus[] = [
      'prospect',
      'invited',
      'signup_started',
      'signed_up_waiting_for_founder',
      'preparing',
      'formal_decision_open',
      'reviewing',
      'proposal_pending',
      'accepted',
      'readiness_blocked',
      'ready',
    ];
    for (const status of preActivation) {
      expect(occupiesActiveSlot(status), status).toBe(false);
    }
    expect(occupiesActiveSlot('declined')).toBe(false);
  });

  it('releases the slot at campaign close or recorded removal (§2.2)', () => {
    const released: AssociationStatus[] = [
      'ended',
      'removed',
      'successfully_completed',
      'completion_disqualified',
      'expired_no_acceptance',
    ];
    for (const status of released) {
      expect(occupiesActiveSlot(status), status).toBe(false);
    }
  });

  it('classifies every §23.4 state exactly once', () => {
    // A state added later must be classified deliberately, not default to
    // "consumes no slot" by falling off the end of a list.
    for (const status of ASSOCIATION_STATUSES) {
      expect(typeof occupiesActiveSlot(status)).toBe('boolean');
    }
    expect(ASSOCIATION_STATUSES.filter(occupiesActiveSlot)).toEqual([...SLOT_OCCUPYING_STATUSES]);
  });

  it('counts usage and reports the remaining slots', () => {
    expect(slotUsage([])).toEqual({ used: 0, limit: 3, remaining: 3, atLimit: false });
    expect(slotUsage(['active', 'preparing', 'invited'])).toEqual({
      used: 1,
      limit: 3,
      remaining: 2,
      atLimit: false,
    });
    expect(slotUsage(['active', 'paused', 'active'])).toEqual({
      used: 3,
      limit: 3,
      remaining: 0,
      atLimit: true,
    });
  });

  it('never reports negative remaining slots', () => {
    // A pre-existing over-allocation must read as "at limit", not as "-1".
    expect(slotUsage(['active', 'active', 'active', 'active']).remaining).toBe(0);
    expect(slotUsage(['active', 'active', 'active', 'active']).atLimit).toBe(true);
  });
});
