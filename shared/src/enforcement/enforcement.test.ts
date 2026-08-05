import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_ENFORCEMENT_ACTIONS,
  AFFILIATE_ENFORCEMENT_REASONS,
  APPEAL_WINDOW_BUSINESS_DAYS,
  COMPETITOR_RESTRICTION_MONTHS,
  CONFLICT_RELATIONSHIP_KINDS,
  ENFORCEMENT_STATEMENT_FIELDS,
  ESCALATION_KINDS,
  ESCALATION_WAIT_DAYS,
  ISSUER_RIGHTS_SENTENCE,
  SELF_PREORDER_CONDITIONS,
  TERMINATION_VALIDITY,
} from './index.js';
import { POST_CAPTURE_EFFECTS, PRE_CAPTURE_EFFECTS } from '../support/index.js';

describe('§29 enforcement registers', () => {
  it('names the seven §29.4 actions and seven grounds', () => {
    expect(AFFILIATE_ENFORCEMENT_ACTIONS).toEqual([
      'warn',
      'pause',
      'terminate',
      'demote',
      'restrict_bidding',
      'remove',
      'refer_case',
    ]);
    expect(AFFILIATE_ENFORCEMENT_REASONS).toHaveLength(7);
  });

  it('requires all five typed statement fields — a vague "policy violation" has no row shape', () => {
    expect(ENFORCEMENT_STATEMENT_FIELDS).toEqual([
      'evidenceAndBehavior',
      'ruleViolated',
      'immediateEffect',
      'correctionPath',
      'humanRoute',
    ]);
    expect(APPEAL_WINDOW_BUSINESS_DAYS).toBe(5);
  });

  it('records §29.5 termination validity, with invalid as its own recorded answer', () => {
    expect(TERMINATION_VALIDITY).toContain('invalid');
    expect(TERMINATION_VALIDITY).toHaveLength(5);
  });

  it('covers the eleven §29.2 relationships and the three §29.1 conditions', () => {
    expect(CONFLICT_RELATIONSHIP_KINDS).toHaveLength(11);
    expect(SELF_PREORDER_CONDITIONS).toEqual([
      'intent_disclosed',
      'self_funded_certified',
      'identity_disclosed',
    ]);
    expect(COMPETITOR_RESTRICTION_MONTHS).toBe(1);
  });

  it('pins the §29.10 escalation facts and issuer-rights sentence', () => {
    expect(ESCALATION_WAIT_DAYS).toBe(14);
    expect(ESCALATION_KINDS).toEqual(['no_response_14_days', 'not_resolved']);
    expect(ISSUER_RIGHTS_SENTENCE).toContain('does not waive');
  });

  it('registers §26.7 post-capture effects beside the pre-capture five', () => {
    expect(PRE_CAPTURE_EFFECTS).toHaveLength(5);
    expect(POST_CAPTURE_EFFECTS).toEqual([
      'invoke_refund_reversal_recovery_policy',
      'restrict_unreleased_funds',
      'notify_affected_roles',
      'preserve_page_and_evidence',
    ]);
  });
});
