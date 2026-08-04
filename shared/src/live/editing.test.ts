import { describe, it, expect } from 'vitest';
import {
  AFFILIATE_MONEY_STATUS_TEMPLATE,
  COMMENT_FLAG_STATES,
  COMMENT_THREADS,
  CREATOR_OBLIGATIONS,
  EARNINGS_STATES,
  EDITABLE_FIELDS,
  EDIT_TIERS,
  LiveRuleError,
  NO_ACTION_NEEDED,
  commentsOpenFor,
  commitmentsIn,
  defaultCommentAuthorName,
  displayNameRefusal,
  fieldsInTier,
  requiresCreatorAction,
  requiresExplanation,
  resolveAffiliateMoneyStatus,
  tierFor,
} from './index.js';

describe('§20 live editing — the three tiers are a register', () => {
  it('puts every registered field in exactly one of §20’s three tiers', () => {
    for (const definition of EDITABLE_FIELDS) {
      expect(EDIT_TIERS).toContain(definition.tier);
      expect(definition.specRef).toMatch(/^§20 live editing, column [123]$/);
      expect(definition.reason.trim().length).toBeGreaterThan(20);
    }
    // Each tier is populated — an empty column would mean a §20 rule with
    // nothing behind it.
    for (const tier of EDIT_TIERS) {
      expect(fieldsInTier(tier).length).toBeGreaterThan(0);
    }
  });

  it('registers every field §20’s second and third columns name', () => {
    const review = fieldsInTier('requires_review').map((d) => d.field);
    // Claims, rewards/prices, dates/duration, delivery promises, refund terms,
    // and Creator channel rules.
    expect(review).toEqual(
      expect.arrayContaining([
        'publicStory',
        'priceCents',
        'closesAt',
        'deliveryWindow',
        'refundPolicyText',
        'prohibitedClaims',
      ]),
    );

    const never = fieldsInTier('never_direct').map((d) => d.field);
    // Campaign type, Idea threshold, Product internal target, locked reward
    // transaction terms, accepted compensation.
    expect(never).toEqual(
      expect.arrayContaining([
        'type',
        'orderThreshold',
        'internalTargetCents',
        'rewardSku',
        'basePercent',
      ]),
    );
  });

  it('throws on an unregistered field rather than defaulting either way', () => {
    // A default of `direct_versioned` would open the next column-two field
    // somebody adds; a default of `never_direct` would break a legitimate edit
    // silently. Neither failure should be quiet.
    expect(() => tierFor('build', 'somethingNobodyRegistered')).toThrow(LiveRuleError);
  });

  it('resolves a field by its surface, so two surfaces may share a name', () => {
    expect(tierFor('build', 'closesAt').tier).toBe('requires_review');
    expect(tierFor('faq', 'answer').tier).toBe('direct_versioned');
    expect(tierFor('reservation', 'rewardSku').tier).toBe('never_direct');
  });
});

describe('§20 — an FAQ cannot silently change a promise locked elsewhere', () => {
  it('lets a genuine clarification through', () => {
    expect(commitmentsIn('Yes — it works on both macOS and Windows.')).toEqual([]);
    expect(commitmentsIn('You will get an email with your download link.')).toEqual([]);
  });

  it('catches the delivery date the §20 trap names', () => {
    // §20's own example: "a Founder editing 'when will I get it?' in the FAQ
    // must not effectively move a delivery date."
    expect(commitmentsIn('You will get it in March 2027.')).toContain('date');
    expect(commitmentsIn('We ship by 2027-03-01.')).toContain('date');
    expect(commitmentsIn('It arrives within 30 days of close.')).toContain('delivery');
  });

  it('catches a price and a refund term', () => {
    expect(commitmentsIn('It costs US$49 for early backers.')).toContain('price');
    expect(commitmentsIn('We offer a full refund if you change your mind.')).toContain('refund');
    expect(commitmentsIn('Money-back guarantee.')).toContain('refund');
  });

  it('is deliberately broad — a false positive costs a review, a miss moves a date', () => {
    const found = commitmentsIn('Delivery is in December 2026 and it is $30, fully refundable.');
    expect(found).toEqual(expect.arrayContaining(['date', 'price', 'refund']));
  });
});

describe('§18 comments', () => {
  it('has one general thread and one per update', () => {
    expect([...COMMENT_THREADS]).toEqual(['general', 'update']);
  });

  it('names a Backer by number, never by anything derived from their identity', () => {
    expect(defaultCommentAuthorName(7)).toBe('Backer 7');
    expect(() => defaultCommentAuthorName(0)).toThrow(LiveRuleError);
  });

  it('refuses a display name that is the Backer’s own email local part', () => {
    expect(displayNameRefusal('jordan', 'jordan@example.com')).toBe('email_local_part');
    expect(displayNameRefusal('Jordan', 'jordan@example.com')).toBe('email_local_part');
    expect(displayNameRefusal('jordan@example.com', 'jordan@example.com')).toBe('looks_like_email');
    expect(displayNameRefusal('J', 'jordan@example.com')).toBe('too_short');
    expect(displayNameRefusal('x'.repeat(41), 'jordan@example.com')).toBe('too_long');
  });

  it('accepts an ordinary chosen name', () => {
    expect(displayNameRefusal('Jordan R.', 'jordan@example.com')).toBeNull();
  });

  it('disables new comments after close, suspension, or kill', () => {
    expect(commentsOpenFor('live')).toBe(true);
    for (const status of [
      'closed_pending_capture',
      'suspended',
      'killed',
      'ended_no_charge',
      'approved',
    ]) {
      expect(commentsOpenFor(status)).toBe(false);
    }
  });

  it('routes a flag to a person and removes nothing automatically', () => {
    expect([...COMMENT_FLAG_STATES]).toEqual(['open', 'upheld', 'dismissed']);
  });
});

describe('§20 / §22.1 earnings states and Appendix B.7', () => {
  it('registers all seven §20 states', () => {
    expect([...EARNINGS_STATES]).toEqual([
      'estimated',
      'finalized',
      'approved_for_transfer',
      'transferred',
      'paid_out',
      'payout_failed',
      'adjusted',
    ]);
  });

  it('asks every state but paid_out for a reason, owner, and next step', () => {
    for (const state of EARNINGS_STATES) {
      expect(requiresExplanation(state)).toBe(state !== 'paid_out');
    }
    expect(requiresCreatorAction('payout_failed')).toBe(true);
    expect(requiresCreatorAction('estimated')).toBe(false);
  });

  it('renders Appendix B.7 verbatim with its five variables filled', () => {
    const rendered = resolveAffiliateMoneyStatus({
      amount: '1,234.50',
      state: 'estimated',
      reason: 'The campaign has not closed, so no charge has been captured yet.',
      nextUpdate: 'March 20, 2027',
    });
    expect(rendered).toContain('US$1,234.50 recorded');
    expect(rendered).toContain('Status: ESTIMATED');
    expect(rendered).toContain('Why it is not paid yet: The campaign has not closed');
    expect(rendered).toContain('Expected next update: March 20, 2027');
    expect(rendered).toContain(`Your action: ${NO_ACTION_NEEDED}`);
    expect(rendered).not.toMatch(/\[[^\]]+\]/);
  });

  it('refuses an unformatted amount, a missing reason, and a missing next update', () => {
    const base = {
      amount: '10.00',
      state: 'estimated' as const,
      reason: 'Not captured yet.',
      nextUpdate: 'At close',
    };
    expect(() => resolveAffiliateMoneyStatus({ ...base, amount: '1000' })).toThrow(LiveRuleError);
    expect(() => resolveAffiliateMoneyStatus({ ...base, reason: '  ' })).toThrow(LiveRuleError);
    expect(() => resolveAffiliateMoneyStatus({ ...base, nextUpdate: '' })).toThrow(LiveRuleError);
  });

  it('lets paid_out stand without a reason, because the money arrived', () => {
    const rendered = resolveAffiliateMoneyStatus({
      amount: '80.00',
      state: 'paid_out',
      reason: '',
      nextUpdate: 'None — this is complete.',
    });
    expect(rendered).toContain('Status: PAID OUT');
    expect(rendered).not.toMatch(/\[[^\]]+\]/);
  });

  it('keeps the B.7 template exactly as the Spec appendix writes it', () => {
    expect(AFFILIATE_MONEY_STATUS_TEMPLATE).toContain('US$[AMOUNT] recorded');
    expect(AFFILIATE_MONEY_STATUS_TEMPLATE).toContain('Why it is not paid yet: [REASON]');
    expect(AFFILIATE_MONEY_STATUS_TEMPLATE).toContain('Expected next update: [DATE]');
    expect(AFFILIATE_MONEY_STATUS_TEMPLATE).toContain('Your action: [ACTION or "No action needed"]');
  });
});

describe('§20 Creator obligations', () => {
  it('surfaces every obligation §20 lists, and says which are verified by a person', () => {
    const keys = CREATOR_OBLIGATIONS.map((o) => o.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'content_availability',
        'no_spam',
        'no_prohibited_claims',
        'permitted_channels',
        'email_rules',
        'student_affiliates',
        'disclosure',
      ]),
    );
    for (const obligation of CREATOR_OBLIGATIONS) {
      // §1.4: never imply an automation that does not exist.
      expect(['surfaced', 'verified_on_evidence']).toContain(obligation.enforcement);
      expect(obligation.statement.trim().length).toBeGreaterThan(30);
    }
  });

  it('states the disclosure requirement in §20’s own terms', () => {
    const disclosure = CREATOR_OBLIGATIONS.find((o) => o.key === 'disclosure')!;
    expect(disclosure.statement).toMatch(/#ad/);
    expect(disclosure.statement).toMatch(/hard to miss/);
    expect(disclosure.enforcement).toBe('verified_on_evidence');
  });
});
