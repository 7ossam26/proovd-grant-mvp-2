/**
 * Enforcement and exceptional operations — Spec §29 (Phase 20b).
 *
 * §29.4's sentence is the shape of everything here: "Customer-facing
 * enforcement states exact evidence/behavior, rule, immediate effect,
 * correction, appeal deadline, and human route. Internal reason remains
 * separate." So the customer statement is five REQUIRED fields plus a computed
 * appeal deadline — a vague "policy violation" has no representable row — and
 * the internal reason is its own column that never renders to the person
 * (§25.6). Raw provider/fraud codes are refused in every customer field
 * (§33.9.11, 16a's one pattern list).
 *
 * Campaign-level suspend/kill stays 16b's machine (`shared/src/support`);
 * this module is the AFFILIATE side of §29 plus the §29.8/§29.10 registers.
 */

/* ── §29.4 Affiliate suspension/appeal ────────────────────────────────────── */

/** §29.4: "Admin may warn, pause, terminate, demote, restrict bidding, remove, or refer a case." */
export const AFFILIATE_ENFORCEMENT_ACTIONS = [
  'warn',
  'pause',
  'terminate',
  'demote',
  'restrict_bidding',
  'remove',
  'refer_case',
] as const;
export type AffiliateEnforcementAction = (typeof AFFILIATE_ENFORCEMENT_ACTIONS)[number];

export const AFFILIATE_ENFORCEMENT_ACTION_LABELS: Readonly<
  Record<AffiliateEnforcementAction, string>
> = {
  warn: 'Warning',
  pause: 'Pause',
  terminate: 'Terminate',
  demote: 'Demote',
  restrict_bidding: 'Restrict bidding',
  remove: 'Remove',
  refer_case: 'Refer case',
};

/** §29.4's seven grounds, verbatim from the Spec's list. */
export const AFFILIATE_ENFORCEMENT_REASONS = [
  'aup_breach',
  'fraud',
  'metric_manipulation',
  'deceptive_promotion',
  'host_rule_violation',
  'regulatory_provider_risk',
  'repeated_invalid_termination',
] as const;
export type AffiliateEnforcementReason = (typeof AFFILIATE_ENFORCEMENT_REASONS)[number];

export const AFFILIATE_ENFORCEMENT_REASON_LABELS: Readonly<
  Record<AffiliateEnforcementReason, string>
> = {
  aup_breach: 'Acceptable-use policy breach',
  fraud: 'Fraud',
  metric_manipulation: 'Metric manipulation',
  deceptive_promotion: 'Deceptive promotion',
  host_rule_violation: 'Host-platform rule violation',
  regulatory_provider_risk: 'Regulatory or provider risk',
  repeated_invalid_termination: 'Repeated invalid termination',
};

/**
 * The five typed fields of the §29.4 customer-facing statement. The sixth
 * element — the appeal deadline — is computed from the committed business
 * calendar, never typed, so it cannot be promised inconsistently.
 */
export const ENFORCEMENT_STATEMENT_FIELDS = [
  'evidenceAndBehavior',
  'ruleViolated',
  'immediateEffect',
  'correctionPath',
  'humanRoute',
] as const;
export type EnforcementStatementField = (typeof ENFORCEMENT_STATEMENT_FIELDS)[number];

/** §29.4: "Appeal window is five business days where policy allows." */
export const APPEAL_WINDOW_BUSINESS_DAYS = 5;

/* ── §29.5 ghosting and termination ───────────────────────────────────────── */

/**
 * §29.5's valid active-termination reasons, plus `invalid` as its own recorded
 * answer. An invalid termination "may affect discretionary thank-you, internal
 * tier, future access, or removal, but cannot claw back valid finalized
 * commission absent Affiliate-caused invalidity" — that last guarantee is
 * structural: finalized amounts are trigger-immutable and the only paths that
 * move them are §24.8 causes with Affiliate causation evidence.
 */
export const TERMINATION_VALIDITY = [
  'valid_founder_material_breach',
  'valid_proovd_suspension',
  'valid_documented_emergency',
  'valid_admin_accepted',
  'invalid',
] as const;
export type TerminationValidity = (typeof TERMINATION_VALIDITY)[number];

/**
 * §29.5's two ghosting definitions, as facts an Admin verifies against the
 * post-submission record — not a timer the product runs. Neither §6 nor §29.5
 * gives a detection schedule, and inventing one is §1 rule 6.
 */
export const GHOSTING_DEFINITIONS = {
  launch_creator: 'Zero posts during the first seven campaign days.',
  mid_campaign_creator:
    'Zero posts in the agreed period from activation, not later than close.',
} as const;

/* ── §29.2 conflicts ──────────────────────────────────────────────────────── */

/** §29.2's disclosure list, one key per named relationship. */
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
export type ConflictRelationshipKind = (typeof CONFLICT_RELATIONSHIP_KINDS)[number];

/* ── §29.1 self-pre-order and fraud ───────────────────────────────────────── */

/**
 * §29.1's permission has three conditions, each a recorded fact: disclosed
 * intent, certified genuine self-funded purchase, identity-disclosed
 * information. And one consequence: "It earns no commission, bonus, or
 * thank-you" — enforced by excluding the linked reservation's attribution
 * from everything finalization counts.
 */
export const SELF_PREORDER_CONDITIONS = [
  'intent_disclosed',
  'self_funded_certified',
  'identity_disclosed',
] as const;

/** §29.1's prohibited list, for the record's vocabulary and the AUP surface. */
export const SELF_PREORDER_PROHIBITED = [
  'funding_or_coordinating_others_to_inflate_metrics',
  'multiple_identities_on_one_idea_campaign',
  'reciprocal_preorder_schemes',
  'engagement_or_click_boosting',
  'artificial_inflation',
] as const;

/* ── §29.3 competitor restriction ─────────────────────────────────────────── */

/** §29.3: one month after the active campaign ends. Adjacent products remain allowed. */
export const COMPETITOR_RESTRICTION_MONTHS = 1;

/* ── §29.8 policy updates ─────────────────────────────────────────────────── */

/** §29.8's audiences: material Terms/AUP updates require Founder/Affiliate reacceptance. */
export const REACCEPTANCE_AUDIENCES = ['founder', 'affiliate'] as const;
export type ReacceptanceAudience = (typeof REACCEPTANCE_AUDIENCES)[number];

/* ── §29.10 not-as-described escalation ───────────────────────────────────── */

/** §29.10: "If no response within 14 days or no resolution, Backer may escalate to Proovd." */
export const ESCALATION_WAIT_DAYS = 14;

/** The two §29.10 grounds a Backer escalation records. */
export const ESCALATION_KINDS = ['no_response_14_days', 'not_resolved'] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

/**
 * §24.8/§29.10: "Consent and evidence do not waive law, network, Stripe, or
 * issuer rights" — "Backer retains issuer dispute rights." Pinned so no
 * support surface can soften it into copy implying otherwise.
 */
export const ISSUER_RIGHTS_SENTENCE =
  'Contacting the Founder or Proovd first does not waive your card issuer’s dispute rights.';
