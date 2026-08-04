/**
 * Live editing, the §18 comment thread, and mid-campaign Creators — Spec §20,
 * §15, §18 (Phase 17b).
 *
 * Migration 0027 holds the guarantees: the insert-only edit history, the
 * decide-once change request and its applied-has-a-change CHECK, the immutable
 * comment, the one-open-flag index, and the frozen mid-campaign terms.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No materiality column on `campaign_live_edits` — §20 decides by field and the
 * shared tier register is what decides, so a classification stored here would be
 * a second, unreviewed judgement beside §15's. No moderation queue and no
 * auto-hide on a comment flag: §18 gives no automatic moderation, §1 rule 6
 * forbids inventing one, and hiding on flag would let one reader remove
 * another's comment.
 */

import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { campaignUpdates } from './updates.js';
import { backerIdentities } from './reservations.js';
import { materialChanges } from './build.js';

/* ── campaign_live_edits (§20 column 1) ────────────────────────────────────── */

export const campaignLiveEdits = pgTable(
  'campaign_live_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Which register entry authorised this. CHECKed in 0027. */
    surface: text('surface').notNull(),
    field: text('field').notNull(),
    /** §20: "with version history" — both halves, always. */
    priorValue: jsonb('prior_value'),
    newValue: jsonb('new_value'),
    /** The FAQ row or reward package the edit targeted, when it had one. */
    targetId: uuid('target_id'),
    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_live_edits_campaign_idx').on(t.campaignId, t.occurredAt),
  }),
);

/* ── campaign_change_requests (§20 column 2) ───────────────────────────────── */

/**
 * A column-two ask. §15: "A Founder cannot publish a material change directly."
 *
 * This table is the request, never the change. Applying it runs through Phase
 * 12b's `recordMaterialChange`, which creates the version and the reacceptance
 * tasks; the CHECK in 0027 refuses an `applied` row with no `material_change_id`,
 * so an applied request always has a §15 record behind it.
 */
export const campaignChangeRequests = pgTable(
  'campaign_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    surface: text('surface').notNull(),
    field: text('field').notNull(),
    targetId: uuid('target_id'),
    /** Read from the row when the request was made, never supplied by the caller. */
    currentValue: jsonb('current_value'),
    requestedValue: jsonb('requested_value'),
    reason: text('reason').notNull(),
    /** `open` | `applied` | `declined`. CHECKed in 0027. */
    status: text('status').notNull().default('open'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    materialChangeId: uuid('material_change_id').references(() => materialChanges.id),
    requestedBy: text('requested_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_change_requests_campaign_idx').on(
      t.campaignId,
      t.status,
      t.createdAt,
    ),
  }),
);

/* ── campaign_backer_numbers (§18) ─────────────────────────────────────────── */

/**
 * The per-campaign `Backer ###` sequence.
 *
 * Assigned on first comment and derived from nothing about the person — a number
 * derived from an id or an address is a handle that leaks whichever value
 * produced it.
 */
export const campaignBackerNumbers = pgTable(
  'campaign_backer_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    backerIdentityId: uuid('backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),
    backerNumber: integer('backer_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityIdx: uniqueIndex('campaign_backer_numbers_identity_idx').on(
      t.campaignId,
      t.backerIdentityId,
    ),
    numberIdx: uniqueIndex('campaign_backer_numbers_number_idx').on(t.campaignId, t.backerNumber),
  }),
);

/* ── campaign_comments (§18) ───────────────────────────────────────────────── */

/**
 * §18's one general thread plus one per update. `updateId` NULL is the general
 * thread — a per-update thread is a filter, not a different kind of record.
 *
 * `authorDisplay` is resolved at post time and stored, so a later display-name
 * change does not silently rewrite what other people already read.
 */
export const campaignComments = pgTable(
  'campaign_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    updateId: uuid('update_id').references(() => campaignUpdates.id),
    /** §18: only a magic-link-authenticated Backer may post. Never null. */
    backerIdentityId: uuid('backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),
    authorDisplay: text('author_display').notNull(),
    body: text('body').notNull(),
    /** `visible` | `removed`. A removal is an Admin act with a reason. */
    visibility: text('visibility').notNull().default('visible'),
    removedBy: text('removed_by'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedReason: text('removed_reason'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadIdx: index('campaign_comments_thread_idx').on(t.campaignId, t.updateId, t.postedAt),
    identityIdx: index('campaign_comments_identity_idx').on(t.backerIdentityId),
  }),
);

/* ── campaign_comment_flags (§18) ──────────────────────────────────────────── */

export const campaignCommentFlags = pgTable(
  'campaign_comment_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => campaignComments.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reportedBy: text('reported_by').notNull(),
    reason: text('reason').notNull(),
    /** `open` | `upheld` | `dismissed`. The comment stays visible until decided. */
    state: text('state').notNull().default('open'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    queueIdx: index('campaign_comment_flags_queue_idx').on(t.campaignId, t.state, t.createdAt),
    oneOpenIdx: uniqueIndex('campaign_comment_flags_one_open_idx')
      .on(t.commentId, t.reportedBy)
      .where(sql`"state" = 'open'`),
  }),
);

/* ── mid_campaign_additions (§20, §33.6.13) ────────────────────────────────── */

/**
 * The terms a mid-campaign Creator was actually shown.
 *
 * `roster_membership = 'mid_campaign'` already lives on the association (§23.4)
 * and the tracking link already carries its own `activated_at` (12a), which is
 * what makes "no retroactive attribution" true with no new column — a click
 * before that Creator's activation is already recorded `ignored/before_activation`
 * by the 14b ingest. What was missing is the remaining-time terms: a Creator who
 * joined with nine days left accepted a nine-day deliverable, and recomputing it
 * later would rewrite what they agreed. Frozen by trigger in 0027.
 */
export const midCampaignAdditions = pgTable(
  'mid_campaign_additions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    campaignCloseAt: timestamp('campaign_close_at', { withTimezone: true }).notNull(),
    remainingHours: integer('remaining_hours').notNull(),
    /** §20: "the campaign's locked high-effort result" — copied, not read later. */
    highEffortAtJoin: boolean('high_effort_at_join'),
    adjustedDeliverables: text('adjusted_deliverables').notNull(),
    openedBy: text('opened_by').notNull(),
  },
  (t) => ({
    associationIdx: uniqueIndex('mid_campaign_additions_association_idx').on(t.associationId),
    campaignIdx: index('mid_campaign_additions_campaign_idx').on(t.campaignId, t.openedAt),
  }),
);

export type CampaignLiveEdit = typeof campaignLiveEdits.$inferSelect;
export type CampaignChangeRequest = typeof campaignChangeRequests.$inferSelect;
export type CampaignBackerNumber = typeof campaignBackerNumbers.$inferSelect;
export type CampaignComment = typeof campaignComments.$inferSelect;
export type CampaignCommentFlag = typeof campaignCommentFlags.$inferSelect;
export type MidCampaignAddition = typeof midCampaignAdditions.$inferSelect;
