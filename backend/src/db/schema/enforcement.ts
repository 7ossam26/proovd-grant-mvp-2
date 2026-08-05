/**
 * §29 enforcement records — Phase 20b.
 *
 * `affiliate_enforcement_actions`      §29.4: the seven actions, the seven
 *                                      grounds, the five REQUIRED customer-
 *                                      statement fields (CHECK-non-blank in
 *                                      0033 — "policy violation" alone has no
 *                                      row shape), the computed five-business-
 *                                      day appeal deadline with its calendar
 *                                      version, and §29.5's termination
 *                                      validity — required exactly when the
 *                                      action ends an active partnership.
 *                                      Insert-only.
 *
 * `affiliate_enforcement_appeals`      one per action; the decision is
 *                                      write-once ("Admin appeal decision is
 *                                      final").
 *
 * `affiliate_conflict_disclosures`     §29.2's eleven relationships,
 *                                      insert-only.
 *
 * `affiliate_self_preorder_disclosures` §29.1: intent + two CHECKed-true
 *                                      certifications; the "earns no
 *                                      commission" consequence executes in the
 *                                      service by excluding the linked
 *                                      reservation's stored attribution.
 *
 * `policy_reacceptance_requirements`   §29.8: a material Terms/AUP update the
 *                                      named audience must reaccept. May cite
 *                                      only a PUBLISHED version (trigger).
 *                                      Satisfaction is an ordinary
 *                                      `policy_consents` row — no second
 *                                      consent store.
 *
 * `support_case_escalations`           §29.10: the Backer's recorded
 *                                      escalation to Proovd, one per case.
 */

import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations, reservations } from './domain.js';
import { policyVersions } from './policies.js';
import { supportCases } from './support.js';

export const affiliateEnforcementActions = pgTable(
  'affiliate_enforcement_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    actionKind: text('action_kind').notNull(),
    reasonCategory: text('reason_category').notNull(),
    /** §29.4: "Internal reason remains separate." Never rendered to the Creator. */
    internalReason: text('internal_reason').notNull(),
    evidenceAndBehavior: text('evidence_and_behavior').notNull(),
    ruleViolated: text('rule_violated').notNull(),
    immediateEffect: text('immediate_effect').notNull(),
    correctionPath: text('correction_path').notNull(),
    humanRoute: text('human_route').notNull(),
    appealDueAt: timestamp('appeal_due_at', { withTimezone: true }).notNull(),
    calendarVersion: text('calendar_version').notNull(),
    terminationValidity: text('termination_validity'),
    priorAssociationStatus: text('prior_association_status').notNull(),
    newAssociationStatus: text('new_association_status').notNull(),
    actor: text('actor').notNull(),
    mfaContext: text('mfa_context').notNull(),
    reauthContext: text('reauth_context').notNull(),
    evidenceLinks: jsonb('evidence_links'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('affiliate_enforcement_association_idx').on(table.associationId, table.occurredAt),
    index('affiliate_enforcement_campaign_idx').on(table.campaignId, table.occurredAt),
  ],
);

export type AffiliateEnforcementAction = typeof affiliateEnforcementActions.$inferSelect;

export const affiliateEnforcementAppeals = pgTable(
  'affiliate_enforcement_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => affiliateEnforcementActions.id),
    grounds: text('grounds').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decision: text('decision'),
    decisionNote: text('decision_note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('affiliate_appeals_action_idx').on(table.actionId)],
);

export type AffiliateEnforcementAppeal = typeof affiliateEnforcementAppeals.$inferSelect;

export const affiliateConflictDisclosures = pgTable(
  'affiliate_conflict_disclosures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    relationshipKind: text('relationship_kind').notNull(),
    detail: text('detail').notNull(),
    disclosedBy: text('disclosed_by').notNull(),
    recordedBy: text('recorded_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('affiliate_conflicts_association_idx').on(table.associationId)],
);

export type AffiliateConflictDisclosure = typeof affiliateConflictDisclosures.$inferSelect;

export const affiliateSelfPreorderDisclosures = pgTable(
  'affiliate_self_preorder_disclosures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    reservationId: uuid('reservation_id').references(() => reservations.id),
    intentNote: text('intent_note').notNull(),
    selfFundedCertified: boolean('self_funded_certified').notNull(),
    identityDisclosed: boolean('identity_disclosed').notNull(),
    recordedBy: text('recorded_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('self_preorder_association_idx').on(table.associationId)],
);

export type AffiliateSelfPreorderDisclosure = typeof affiliateSelfPreorderDisclosures.$inferSelect;

export const policyReacceptanceRequirements = pgTable(
  'policy_reacceptance_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyVersionId: uuid('policy_version_id')
      .notNull()
      .references(() => policyVersions.id),
    policySlug: text('policy_slug').notNull(),
    requiredVersion: text('required_version').notNull(),
    audience: text('audience').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('policy_reacceptance_dedup_idx').on(
      table.policySlug,
      table.audience,
      table.requiredVersion,
    ),
  ],
);

export type PolicyReacceptanceRequirement = typeof policyReacceptanceRequirements.$inferSelect;

export const supportCaseEscalations = pgTable(
  'support_case_escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('support_escalations_case_idx').on(table.caseId)],
);

export type SupportCaseEscalation = typeof supportCaseEscalations.$inferSelect;
