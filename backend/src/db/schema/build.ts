/**
 * Campaign building, roster readiness, review, and materiality — Spec §14.4,
 * §15, §23.2 (Phase 12b).
 *
 * The Founder-built campaign page content, the six-rule launch-readiness
 * records, the Admin review rounds and their grouped feedback, and the general
 * materiality/reacceptance machine §15 describes and Phase 17 reuses. The
 * guarantees — one open review round, one live roster finalization, an
 * immutable approved snapshot, and the classification/reacceptance consistency
 * that §33.4.2 tests — live in migration 0018 as indexes, CHECKs, and triggers.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';

/* ── Enums (migration 0018) ────────────────────────────────────────────────── */

export const rosterDecision = pgEnum('roster_decision', ['pending', 'included', 'excluded']);
export const reviewOutcome = pgEnum('review_outcome', ['pending', 'approved', 'changes_required']);
export const feedbackGroup = pgEnum('feedback_group', ['required', 'optional']);
export const materialityClass = pgEnum('materiality_class', ['non_material', 'material']);
export const reacceptanceState = pgEnum('reacceptance_state', ['not_required', 'pending', 'complete']);
export const reacceptanceDecision = pgEnum('reacceptance_decision', ['pending', 'accepted', 'declined']);

/* ── campaign_build (§14.4) ────────────────────────────────────────────────── */

export const campaignBuild = pgTable(
  'campaign_build',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    title: text('title'),
    founderDisplayName: text('founder_display_name'),
    founderEntityDisplay: text('founder_entity_display'),
    founderCountry: text('founder_country'),
    founderProfileUrl: text('founder_profile_url'),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    orderThreshold: integer('order_threshold'),
    internalTargetCents: bigint('internal_target_cents', { mode: 'bigint' }),
    brandPerception: text('brand_perception'),
    brandVoice: text('brand_voice'),
    requiredWording: text('required_wording'),
    prohibitedClaims: text('prohibited_claims'),
    communityUrl: text('community_url'),
    heroPreference: text('hero_preference'),
    publicStory: text('public_story'),

    deliveryWindow: text('delivery_window'),
    earlyProductDisclaimer: text('early_product_disclaimer'),
    risksAndChallenges: text('risks_and_challenges'),

    refundPolicyText: text('refund_policy_text'),
    refundPolicyTitle: text('refund_policy_title'),
    refundPolicySourceUrl: text('refund_policy_source_url'),
    refundPolicyVersion: text('refund_policy_version'),
    refundPolicyEffectiveDate: date('refund_policy_effective_date'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_build_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_reward_packages (§14.4) ──────────────────────────────────────── */

export const campaignRewardPackages = pgTable(
  'campaign_reward_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    sku: text('sku').notNull(),
    title: text('title').notNull(),
    priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
    contents: text('contents').notNull(),
    fulfillmentCommitment: text('fulfillment_commitment').notNull(),
    delivery: text('delivery').notNull(),
    limitedQuantity: integer('limited_quantity'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuIdx: uniqueIndex('campaign_reward_packages_sku_idx').on(t.campaignId, t.sku),
    campaignIdx: index('campaign_reward_packages_campaign_idx').on(t.campaignId, t.sortOrder),
  }),
);

/* ── campaign_faqs (§14.4) ─────────────────────────────────────────────────── */

export const campaignFaqs = pgTable(
  'campaign_faqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_faqs_campaign_idx').on(t.campaignId, t.sortOrder),
  }),
);

/* ── campaign_readiness (§15 rule 2) ───────────────────────────────────────── */

export const campaignReadiness = pgTable(
  'campaign_readiness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    initialRosterFinalizedAt: timestamp('initial_roster_finalized_at', { withTimezone: true }),
    initialRosterFinalizedBy: text('initial_roster_finalized_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_readiness_campaign_idx').on(t.campaignId),
  }),
);

/* ── association_readiness (§15 rules 5 & 6) ───────────────────────────────── */

export const associationReadiness = pgTable(
  'association_readiness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    rosterDecision: rosterDecision('roster_decision').notNull().default('pending'),
    launchRequired: boolean('launch_required').notNull().default(false),
    readinessConfirmedAt: timestamp('readiness_confirmed_at', { withTimezone: true }),
    reacceptanceRequired: boolean('reacceptance_required').notNull().default(false),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('association_readiness_association_idx').on(t.associationId),
    campaignIdx: index('association_readiness_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_reviews (§15) ────────────────────────────────────────────────── */

export const campaignReviews = pgTable(
  'campaign_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    round: integer('round').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    submittedBy: text('submitted_by').notNull(),
    outcome: reviewOutcome('outcome').notNull().default('pending'),
    reviewer: text('reviewer'),
    nextUpdateExpectation: text('next_update_expectation'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roundIdx: uniqueIndex('campaign_reviews_round_idx').on(t.campaignId, t.round),
  }),
);

/* ── review_feedback_items (§15) ───────────────────────────────────────────── */

export const reviewFeedbackItems = pgTable(
  'review_feedback_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => campaignReviews.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    feedbackGroup: feedbackGroup('feedback_group').notNull(),
    area: text('area').notNull(),
    body: text('body').notNull(),
    deepLink: text('deep_link').notNull(),
    owner: text('owner').notNull(),
    dueExpectation: text('due_expectation'),
    enforcementInvolved: boolean('enforcement_involved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reviewIdx: index('review_feedback_items_review_idx').on(t.reviewId),
  }),
);

/* ── material_changes (§15 — reused verbatim in Phase 17) ──────────────────── */

export const materialChanges = pgTable(
  'material_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reviewId: uuid('review_id').references(() => campaignReviews.id),
    classification: materialityClass('classification').notNull(),
    reason: text('reason').notNull(),
    affectedFields: jsonb('affected_fields').notNull(),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    priorVersion: integer('prior_version'),
    newVersion: integer('new_version'),
    affectedCreators: jsonb('affected_creators').notNull().default(sql`'[]'::jsonb`),
    reacceptanceState: reacceptanceState('reacceptance_state').notNull(),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('material_changes_campaign_idx').on(t.campaignId, t.createdAt),
  }),
);

/* ── material_change_reacceptances (§15) ───────────────────────────────────── */

export const materialChangeReacceptances = pgTable(
  'material_change_reacceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    materialChangeId: uuid('material_change_id')
      .notNull()
      .references(() => materialChanges.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    newVersion: integer('new_version').notNull(),
    changedFields: jsonb('changed_fields').notNull(),
    decision: reacceptanceDecision('decision').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex('material_change_reacceptances_unique').on(t.materialChangeId, t.associationId),
    associationIdx: index('material_change_reacceptances_association_idx').on(t.associationId, t.decision),
  }),
);

/* ── approved_campaign_snapshots (§15) ─────────────────────────────────────── */

export const approvedCampaignSnapshots = pgTable(
  'approved_campaign_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => campaignReviews.id),
    snapshot: jsonb('snapshot').notNull(),
    creatorTerms: jsonb('creator_terms').notNull(),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reviewIdx: uniqueIndex('approved_campaign_snapshots_review_idx').on(t.reviewId),
    campaignIdx: index('approved_campaign_snapshots_campaign_idx').on(t.campaignId, t.createdAt),
  }),
);

export type CampaignBuild = typeof campaignBuild.$inferSelect;
export type CampaignRewardPackage = typeof campaignRewardPackages.$inferSelect;
export type CampaignFaq = typeof campaignFaqs.$inferSelect;
export type CampaignReadiness = typeof campaignReadiness.$inferSelect;
export type AssociationReadiness = typeof associationReadiness.$inferSelect;
export type CampaignReview = typeof campaignReviews.$inferSelect;
export type ReviewFeedbackItem = typeof reviewFeedbackItems.$inferSelect;
export type MaterialChange = typeof materialChanges.$inferSelect;
export type MaterialChangeReacceptance = typeof materialChangeReacceptances.$inferSelect;
export type ApprovedCampaignSnapshot = typeof approvedCampaignSnapshots.$inferSelect;
