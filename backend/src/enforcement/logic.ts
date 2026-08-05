/**
 * §29 registers, restated from `@proovd/shared`
 * (`shared/src/enforcement/index.ts`) because the backend cannot import shared
 * at runtime. `enforcement-20b.test.ts` drift-tests every value.
 */

export const AFFILIATE_ENFORCEMENT_ACTIONS = [
  'warn',
  'pause',
  'terminate',
  'demote',
  'restrict_bidding',
  'remove',
  'refer_case',
] as const;
export type AffiliateEnforcementActionKind = (typeof AFFILIATE_ENFORCEMENT_ACTIONS)[number];

export const AFFILIATE_ENFORCEMENT_REASONS = [
  'aup_breach',
  'fraud',
  'metric_manipulation',
  'deceptive_promotion',
  'host_rule_violation',
  'regulatory_provider_risk',
  'repeated_invalid_termination',
] as const;
export type AffiliateEnforcementReasonKind = (typeof AFFILIATE_ENFORCEMENT_REASONS)[number];

export const APPEAL_WINDOW_BUSINESS_DAYS = 5;

export const TERMINATION_VALIDITY = [
  'valid_founder_material_breach',
  'valid_proovd_suspension',
  'valid_documented_emergency',
  'valid_admin_accepted',
  'invalid',
] as const;
export type TerminationValidityKind = (typeof TERMINATION_VALIDITY)[number];

export const CONFLICT_RELATIONSHIP_KINDS = [
  'business',
  'family',
  'financial',
  'investor',
  'advisor',
  'contractor',
  'employee',
  'backer',
  'founder',
  'other_affiliate',
  'competitor',
] as const;
export type ConflictRelationshipKindValue = (typeof CONFLICT_RELATIONSHIP_KINDS)[number];

export const REACCEPTANCE_AUDIENCES = ['founder', 'affiliate'] as const;
export type ReacceptanceAudienceValue = (typeof REACCEPTANCE_AUDIENCES)[number];

export const ESCALATION_WAIT_DAYS = 14;

export const ESCALATION_KINDS = ['no_response_14_days', 'not_resolved'] as const;
export type EscalationKindValue = (typeof ESCALATION_KINDS)[number];

export const ISSUER_RIGHTS_SENTENCE =
  'Contacting the Founder or Proovd first does not waive your card issuer’s dispute rights.';
