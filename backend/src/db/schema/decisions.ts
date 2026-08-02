/**
 * Formal Affiliate decisions — Spec §14.2, §14.3, §14.6, §25.4 (Phase 12a).
 *
 * The tables behind the three decisions: immutable proposal versions, the
 * locked compensation agreement, the §14.2 acceptance confirmations, the
 * inactive tracking link, the Creator-specific bonus, and the §14.6 deadline
 * evaluation record.
 *
 * The correctness rules — one open version per association, one locked version
 * ever, legal transitions only, bilateral acceptance on a locked row, no fixed
 * payment on an Idea Campaign — live in migration 0017 as indexes, CHECKs, and
 * triggers. The services in `affiliates/decisions.ts` re-state them as
 * conditional UPDATEs so a stale response *matches nothing* rather than
 * erroring, but the database is what makes two locked versions impossible.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  bigint,
  boolean,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { policyConsents } from './vetting.js';
import { listingFeeRefunds } from './listing.js';

/* ── Enums (migration 0017) ────────────────────────────────────────────────── */

export const proposalParty = pgEnum('proposal_party', ['affiliate', 'founder']);

/** §14.2. `rejected_by_admin` is mediation's reject — never a path to locked. */
export const proposalVersionState = pgEnum('proposal_version_state', [
  'awaiting_founder',
  'awaiting_creator',
  'locked',
  'declined',
  'superseded',
  'expired_no_acceptance',
  'rejected_by_admin',
]);

/** The proposing party's decision is `proposed`, stamped at creation. */
export const partyDecision = pgEnum('party_decision', ['proposed', 'accepted', 'declined']);

export const compensationSource = pgEnum('compensation_source', [
  'standard_terms',
  'proposal_version',
]);

/** §14.3. Mirrors shared `BonusTriggerUnit`; drift-tested. */
export const bonusTriggerUnit = pgEnum('bonus_trigger_unit', [
  'attributed_subtotal_cents',
  'unique_attributed_backers',
]);

export const deadlineOutcome = pgEnum('deadline_outcome', [
  'continues',
  'failed_zero_eligible_recruits',
  'failed_no_mutual_acceptance',
]);

/* ── proposal_versions (§14.2, §33.2.9, §33.2.10) ──────────────────────────── */

export const proposalVersions = pgTable(
  'proposal_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    versionNumber: integer('version_number').notNull(),
    proposedBy: proposalParty('proposed_by').notNull(),

    /** The proposed TOTAL percentage (base + increase), as shared `validateProposal` takes it. */
    bidTotalPercent: integer('bid_total_percent'),
    fixedPaymentRequestCents: bigint('fixed_payment_request_cents', { mode: 'bigint' }),

    state: proposalVersionState('state').notNull(),

    affiliateDecision: partyDecision('affiliate_decision'),
    affiliateDecidedAt: timestamp('affiliate_decided_at', { withTimezone: true }),
    founderDecision: partyDecision('founder_decision'),
    founderDecidedAt: timestamp('founder_decided_at', { withTimezone: true }),

    supersededByVersionId: uuid('superseded_by_version_id'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberIdx: uniqueIndex('proposal_versions_number_idx').on(t.associationId, t.versionNumber),
    campaignIdx: index('proposal_versions_campaign_idx').on(t.campaignId, t.state),
    // The two §33.2.9/10 partial-unique backstops (`proposal_versions_one_open`,
    // `proposal_versions_one_locked`) are WHERE-clause indexes in migration
    // 0017; Drizzle's builder cannot express an IN() predicate, so they are not
    // restated here. The suite exercises them directly.
  }),
);

/* ── association_compensation_agreements (§14.2) ───────────────────────────── */

export const associationCompensationAgreements = pgTable(
  'association_compensation_agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    source: compensationSource('source').notNull(),
    proposalVersionId: uuid('proposal_version_id').references(() => proposalVersions.id),

    basePercent: integer('base_percent').notNull(),
    bidIncreasePercent: integer('bid_increase_percent').notNull().default(0),
    totalPercent: integer('total_percent').notNull(),
    fixedPaymentCents: bigint('fixed_payment_cents', { mode: 'bigint' }),

    affiliateAcceptedAt: timestamp('affiliate_accepted_at', { withTimezone: true }).notNull(),
    founderAcceptedAt: timestamp('founder_accepted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('compensation_agreements_association_idx').on(t.associationId),
    campaignIdx: index('compensation_agreements_campaign_idx').on(t.campaignId),
  }),
);

/* ── association_acceptance_confirmations (§14.2, §31.5, §28.4) ────────────── */

export const associationAcceptanceConfirmations = pgTable(
  'association_acceptance_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    compensationTermsConfirmedAt: timestamp('compensation_terms_confirmed_at', {
      withTimezone: true,
    }).notNull(),
    /** §31.5's per-association instance: a consent citing a published version. */
    ipAgreementConsentId: uuid('ip_agreement_consent_id')
      .notNull()
      .references(() => policyConsents.id),
    ftcDisclosureAcknowledgedAt: timestamp('ftc_disclosure_acknowledged_at', {
      withTimezone: true,
    }).notNull(),
    /** The campaign terms + Affiliate AUP versions in force at acceptance. */
    termsAupState: jsonb('terms_aup_state').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('acceptance_confirmations_association_idx').on(t.associationId),
  }),
);

/* ── tracking_links (§14.2) ────────────────────────────────────────────────── */

export const trackingLinks = pgTable(
  'tracking_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    code: text('code').notNull(),
    /** §14.2: inactive until approval and Creator readiness. Phase 14 flips it. */
    active: boolean('active').notNull().default(false),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('tracking_links_association_idx').on(t.associationId),
    codeIdx: uniqueIndex('tracking_links_code_idx').on(t.code),
  }),
);

/* ── creator_bonuses (§14.3) ───────────────────────────────────────────────── */

export const creatorBonuses = pgTable(
  'creator_bonuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    triggerUnit: bonusTriggerUnit('trigger_unit').notNull(),
    /** Cents for the subtotal unit; a count for the unique-Backer unit. */
    threshold: bigint('threshold', { mode: 'bigint' }).notNull(),
    additionalPercent: integer('additional_percent').notNull(),
    maxCombinedPercent: integer('max_combined_percent').notNull(),
    proposalVersionId: uuid('proposal_version_id').references(() => proposalVersions.id),
    earnedMeasuredValue: bigint('earned_measured_value', { mode: 'bigint' }),
    earnedPercent: integer('earned_percent'),
    earnedRecordedAt: timestamp('earned_recorded_at', { withTimezone: true }),
    offeredBy: text('offered_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('creator_bonuses_association_idx').on(t.associationId),
    campaignIdx: index('creator_bonuses_campaign_idx').on(t.campaignId),
  }),
);

/* ── response_deadline_evaluations (§14.6) ─────────────────────────────────── */

export const responseDeadlineEvaluations = pgTable(
  'response_deadline_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: deadlineOutcome('outcome').notNull(),
    lockedAcceptanceCount: integer('locked_acceptance_count').notNull(),
    expiredAssociationCount: integer('expired_association_count').notNull(),
    refundId: uuid('refund_id').references(() => listingFeeRefunds.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('deadline_evaluations_campaign_idx').on(t.campaignId),
  }),
);

export type ProposalVersion = typeof proposalVersions.$inferSelect;
export type AssociationCompensationAgreement =
  typeof associationCompensationAgreements.$inferSelect;
export type AssociationAcceptanceConfirmation =
  typeof associationAcceptanceConfirmations.$inferSelect;
export type TrackingLink = typeof trackingLinks.$inferSelect;
export type CreatorBonus = typeof creatorBonuses.$inferSelect;
export type ResponseDeadlineEvaluation = typeof responseDeadlineEvaluations.$inferSelect;
