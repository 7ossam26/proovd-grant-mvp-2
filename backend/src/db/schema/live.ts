/**
 * Live campaign operations — Spec §20, §31.9 (Phase 17a).
 *
 * The Founder's campaign home and the event substrate beneath it. Five tables;
 * migration 0026 holds the guarantees — the monotonic last-seen, the
 * acknowledge-once receipt, the alternating threshold crossing, the one-time
 * milestone, and the insert-only correction record.
 *
 * ── There is no counters table, and that is the design ──────────────────────
 * §20 asks that new pre-orders, cancellations, and net change be stored
 * separately. `reservation_status_history` already stores one row per transition,
 * which is separately in the strongest sense available, and it is append-only. A
 * second set of counters would be Phase 16b's timeline mistake in a different
 * phase: a summary that drifts from the record it summarises is worse than no
 * summary, and here the Founder would act on the drift. `live/counts.ts` composes
 * them on read and §33.6.9 asserts the identity holds.
 */

import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns } from './domain.js';

/* ── campaign_home_deliveries (§20, §33.6.6) ───────────────────────────────── */

/**
 * The receipt that makes "successfully delivered" a fact.
 *
 * §20 requires last-seen to advance "only after the rendered state is
 * successfully delivered", and a server cannot assert that about its own
 * response — the connection can drop after the last byte. So the read issues a
 * receipt carrying exactly what it rendered and the surface acknowledges it once
 * the render succeeded. A failed render never acknowledges and the delta survives.
 */
export const campaignHomeDeliveries = pgTable(
  'campaign_home_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    viewerUserId: text('viewer_user_id').notNull(),
    /**
     * What this render showed. The acknowledgement advances last-seen to THIS,
     * never to the counts at acknowledgement time — otherwise acknowledging a
     * delta you read would consume one you never saw.
     */
    renderedActiveCount: integer('rendered_active_count').notNull(),
    renderedAt: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    viewerIdx: index('campaign_home_deliveries_viewer_idx').on(
      t.campaignId,
      t.viewerUserId,
      t.renderedAt,
    ),
  }),
);

/* ── founder_campaign_last_seen (§20 Glance) ───────────────────────────────── */

export const founderCampaignLastSeen = pgTable(
  'founder_campaign_last_seen',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Per viewer: two people on one campaign hold two independent positions. */
    viewerUserId: text('viewer_user_id').notNull(),
    lastSeenCount: integer('last_seen_count').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    /** Which receipt advanced it — the advance is auditable back to one render. */
    lastDeliveryId: uuid('last_delivery_id').references(() => campaignHomeDeliveries.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    viewerIdx: uniqueIndex('founder_campaign_last_seen_viewer_idx').on(t.campaignId, t.viewerUserId),
  }),
);

/* ── campaign_threshold_crossings (§20, §33.6.10) ──────────────────────────── */

/**
 * One row per crossing. `direction` alternates — enforced by trigger, which is
 * what "deduplicated by state transition" means as a database guarantee and what
 * makes it safe to evaluate on every pre-order and every cancellation.
 */
export const campaignThresholdCrossings = pgTable(
  'campaign_threshold_crossings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** `reached` | `lost`. CHECKed in 0026 — a crossing has only two directions. */
    direction: text('direction').notNull(),
    /** The facts it was decided on, copied because the threshold fixes at close. */
    uniqueActiveBackers: integer('unique_active_backers').notNull(),
    threshold: integer('threshold').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL until confirmed — §7's "recorded, not confirmed delivered" state. */
    founderNotificationId: text('founder_notification_id'),
    internalNotificationId: text('internal_notification_id'),
  },
  (t) => ({
    campaignIdx: index('campaign_threshold_crossings_campaign_idx').on(t.campaignId, t.occurredAt),
  }),
);

/* ── campaign_milestones (§20) ─────────────────────────────────────────────── */

export const campaignMilestones = pgTable(
  'campaign_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** One of §20's four. CHECKed in 0026. */
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** §20: "may appear once as a milestone then move to history." One-way. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
  },
  (t) => ({
    kindIdx: uniqueIndex('campaign_milestones_kind_idx').on(t.campaignId, t.kind),
  }),
);

/* ── act_rank_corrections (§20, §31.9) ─────────────────────────────────────── */

/**
 * §20: "Store every later correction/dismissal/reclassification of the ranked
 * action with prior rank, reason, actor, and time."
 *
 * The documented safety override lives here too, as `correction_kind =
 * 'safety_override'` — same four facts, and a second table would leave two places
 * to look for why the Founder saw what they saw. §31.9 counts these rows as the
 * next-action correction rate, which is why they are insert-only: a rate computed
 * over an editable table can be improved without improving anything.
 */
export const actRankCorrections = pgTable(
  'act_rank_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    actionKind: text('action_kind').notNull(),
    correctionKind: text('correction_kind').notNull(),
    priorRank: integer('prior_rank').notNull(),
    /** NULL on a dismissal: it was withdrawn, not re-ranked. */
    newRank: integer('new_rank'),
    reason: text('reason').notNull(),
    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    sourceTable: text('source_table'),
    sourceId: text('source_id'),
    /** A safety override applies until withdrawn. Withdrawal is its own act. */
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => ({
    campaignIdx: index('act_rank_corrections_campaign_idx').on(t.campaignId, t.occurredAt),
    /** One live safety override per campaign (partial unique index in 0026). */
    liveOverrideIdx: uniqueIndex('act_rank_corrections_one_live_override_idx')
      .on(t.campaignId)
      .where(sql`"correction_kind" = 'safety_override' AND "withdrawn_at" IS NULL`),
  }),
);

export type CampaignHomeDelivery = typeof campaignHomeDeliveries.$inferSelect;
export type FounderCampaignLastSeen = typeof founderCampaignLastSeen.$inferSelect;
export type CampaignThresholdCrossing = typeof campaignThresholdCrossings.$inferSelect;
export type CampaignMilestone = typeof campaignMilestones.$inferSelect;
export type ActRankCorrection = typeof actRankCorrections.$inferSelect;
