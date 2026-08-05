/**
 * Completion, future work, satisfaction, and resolution — Spec §22.8, §22.9,
 * §22.10, §22.11, §31.8 (Phase 21b, migration 0036).
 *
 * Every guarantee that matters here is a CHECK or a trigger in 0036 rather
 * than a field type: the status vocabulary, the reason/status pairing, the
 * work-again eligibility read against the completion row, the one-answer
 * satisfaction rule, and the immutability of every decision. What is in this
 * file is the shape the services read and write.
 *
 * Note what is ABSENT and asserted absent by the suite: no consent column on
 * the satisfaction table (§31.8), no campaign, terms, percentage, or amount on
 * the work-again request (§33.10.8), and no stored cooldown date anywhere
 * (§29.6 — a stored deadline is one that can drift from its anchor).
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns, campaignAffiliateAssociations, reservations } from './domain.js';
import { backerIdentities } from './reservations.js';
import { supportCases } from './support.js';

/* ── §22.8 Creator completion ─────────────────────────────────────────────── */

export const creatorCompletionStatuses = pgTable(
  'creator_completion_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** `successfully_completed` | `completion_disqualified` (CHECK-pinned). */
    status: text('status').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),

    /** §22.8: "Only Admin can assign it." */
    decidedBy: text('decided_by').notNull(),

    /** The five §22.8 criteria as evaluated at decision time. */
    criteriaFindings: jsonb('criteria_findings').notNull(),
    evidenceNote: text('evidence_note').notNull(),

    /** §22.8. Required on a disqualification, refused on a completion. */
    disqualifyingReason: text('disqualifying_reason'),

    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededById: uuid('superseded_by_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    liveIdx: uniqueIndex('completion_status_one_live_idx')
      .on(t.associationId)
      .where(sql`superseded_at is null`),
    campaignIdx: index('completion_status_campaign_idx').on(t.campaignId),
  }),
);

/* ── §22.9 the work-again request ─────────────────────────────────────────── */

export const workAgainRequests = pgTable(
  'work_again_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    originalCampaignId: uuid('original_campaign_id')
      .notNull()
      .references(() => campaigns.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    founderUserId: text('founder_user_id').notNull(),

    status: text('status').notNull().default('requested'),
    message: text('message').notNull(),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseNote: text('response_note'),

    /**
     * What made this request eligible. §22.9's "a later correction to
     * completion status changes eligibility without deleting history" is why
     * the request keeps pointing at the row it was made against.
     */
    completionStatusId: uuid('completion_status_id')
      .notNull()
      .references(() => creatorCompletionStatuses.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdx: uniqueIndex('work_again_one_open_idx')
      .on(t.originalCampaignId, t.associationId)
      .where(sql`status = 'requested'`),
    associationIdx: index('work_again_association_idx').on(t.associationId, t.requestedAt),
  }),
);

/* ── §22.10 Founder next-campaign readiness ───────────────────────────────── */

export const founderNextCampaignReadiness = pgTable(
  'founder_next_campaign_readiness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    founderUserId: text('founder_user_id').notNull(),

    /** `ready` | `not_ready` (CHECK-pinned). */
    decision: text('decision').notNull(),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),

    criteriaNote: text('criteria_note').notNull(),
    customerExplanation: text('customer_explanation').notNull(),

    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    liveIdx: uniqueIndex('next_readiness_one_live_idx')
      .on(t.campaignId)
      .where(sql`superseded_at is null`),
  }),
);

/* ── §31.8 Backer satisfaction ────────────────────────────────────────────── */

export const backerSatisfactionResponses = pgTable(
  'backer_satisfaction_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    backerIdentityId: uuid('backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),

    /** `binary` | `rating_1_5` (CHECK-pinned, and the answer must match). */
    scale: text('scale').notNull(),
    satisfied: boolean('satisfied'),
    rating: integer('rating'),

    /** §31.8: "then optional reason". Nothing requires it. */
    reason: text('reason'),

    isNegative: boolean('is_negative').notNull(),
    followupCaseId: uuid('followup_case_id').references(() => supportCases.id),

    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneIdx: uniqueIndex('satisfaction_one_per_reservation_idx').on(t.reservationId),
    campaignIdx: index('satisfaction_campaign_idx').on(t.campaignId, t.answeredAt),
  }),
);

/* ── §22.11 campaign resolution ───────────────────────────────────────────── */

export const campaignResolutions = pgTable(
  'campaign_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedBy: text('resolved_by').notNull(),

    verifiedItems: jsonb('verified_items').notNull(),

    /** §22.11: recorded so the two states are visibly independent. */
    fulfillmentActive: boolean('fulfillment_active').notNull(),

    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_resolutions_campaign_idx').on(t.campaignId),
  }),
);

export type CreatorCompletionStatus = typeof creatorCompletionStatuses.$inferSelect;
export type WorkAgainRequest = typeof workAgainRequests.$inferSelect;
export type FounderNextCampaignReadiness = typeof founderNextCampaignReadiness.$inferSelect;
export type BackerSatisfactionResponse = typeof backerSatisfactionResponses.$inferSelect;
export type CampaignResolution = typeof campaignResolutions.$inferSelect;
