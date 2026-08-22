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
    /**
     * The Admin panel's `Draft campaign version` (migration 0059).
     *
     * Deliberately not `max(material_changes.new_version)`, which counts
     * MATERIAL changes only — a typo fix would leave the draft version standing
     * still, which is not what the number means on the reference.
     */
    draftVersion: integer('draft_version').notNull().default(1),
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

    /* ── The page's own copy (migration 0049, campaign page v2) ────────────
     * §18 hands presentation to the DNA document by name, so the designed page
     * needs copy §14.4 does not enumerate. Every one of these is OPTIONAL and
     * none is in a `REQUIRED_*` register: a build must not stop completing
     * because a campaign has no marketing headline. They carry no commercial
     * rule — no price, no date, no threshold, no eligibility. */
    heroHeadline: text('hero_headline'),
    heroHeadlineAccent: text('hero_headline_accent'),
    heroSubheadline: text('hero_subheadline'),
    founderPullQuote: text('founder_pull_quote'),
    platformLine: text('platform_line'),
    demoContextLabel: text('demo_context_label'),
    benefitsHeading: text('benefits_heading'),
    rewardsHeading: text('rewards_heading'),
    updatesHeading: text('updates_heading'),
    faqHeading: text('faq_heading'),

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
    /**
     * The reference's tier badge — `Lowest price`, `Best value`, `For five`
     * (0049). Free text: §14.4 names no badge vocabulary and inventing one
     * would be §1 rule 6. `requires_review` in the §20 register, because a
     * badge sits beside a price and is where "Best value" becomes a claim.
     */
    badge: text('badge'),
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

/* ── campaign_demo_moments (campaign page v2, migration 0049) ──────────────── */

/**
 * The interactive demo stage: three moments of the Founder's own product.
 *
 * §14.4 does not name this and the brief that added it does not pretend it
 * does. It is presentation of the Founder's product, the same class as "Hero
 * preference" and "Product visuals and brand assets" which §14.4 *does* name,
 * and it carries no commercial rule.
 *
 * A moment is a passive **signal** or one **action**, never both and never
 * neither — a 0049 CHECK, because the two render differently and mean different
 * things, and a row claiming both would render a card with a dead control on it.
 *
 * `timeLabel` is a clock face the Founder types (`8:15`), never an instant the
 * product interprets. §27.1's timezone rule governs deadlines the product
 * promises to people; this is copy inside a mockup of somebody else's app.
 */
export const campaignDemoMoments = pgTable(
  'campaign_demo_moments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    sortOrder: integer('sort_order').notNull().default(0),
    timeLabel: text('time_label').notNull(),
    momentLabel: text('moment_label').notNull(),
    stateWord: text('state_word').notNull(),
    headline: text('headline').notNull(),
    signalText: text('signal_text'),
    isAction: boolean('is_action').notNull().default(false),
    actionLabel: text('action_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: uniqueIndex('campaign_demo_moments_order_idx').on(t.campaignId, t.sortOrder),
  }),
);

/* ── campaign_benefit_cards (campaign page v2, migration 0049) ─────────────── */

/**
 * The three benefit cards under the hero.
 *
 * The reference names its variants after one campaign's copy — `.timing-card`,
 * `.tap-card`, `.streak-card` — and §30 lists streaks among the forbidden
 * mechanics. More practically, a variant named for one Founder's product is
 * unusable by the next. So the three treatments are named by SHAPE, and the
 * list is closed by CHECK: a fourth value would render nothing at all, and a
 * card with an empty visual is worse than one that was refused (§1.4).
 */
export const VISUAL_VARIANTS = ['bars', 'check', 'dots'] as const;
export type VisualVariant = (typeof VISUAL_VARIANTS)[number];

export const campaignBenefitCards = pgTable(
  'campaign_benefit_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    footerWord: text('footer_word').notNull(),
    /** One of `VISUAL_VARIANTS`. CHECKed in 0049. */
    visualVariant: text('visual_variant').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: uniqueIndex('campaign_benefit_cards_order_idx').on(t.campaignId, t.sortOrder),
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
    /**
     * `Public campaign version` on the Admin panel — stamped from
     * `campaign_build.draft_version` at approval (migration 0059). The snapshot
     * table is already the immutable approved record, so the published number
     * belongs on it rather than on `campaigns`.
     */
    publishedVersion: integer('published_version'),
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
export type CampaignDemoMoment = typeof campaignDemoMoments.$inferSelect;
export type CampaignBenefitCard = typeof campaignBenefitCards.$inferSelect;
export type CampaignReadiness = typeof campaignReadiness.$inferSelect;
export type AssociationReadiness = typeof associationReadiness.$inferSelect;
export type CampaignReview = typeof campaignReviews.$inferSelect;
export type ReviewFeedbackItem = typeof reviewFeedbackItems.$inferSelect;
export type MaterialChange = typeof materialChanges.$inferSelect;
export type MaterialChangeReacceptance = typeof materialChangeReacceptances.$inferSelect;
export type ApprovedCampaignSnapshot = typeof approvedCampaignSnapshots.$inferSelect;
