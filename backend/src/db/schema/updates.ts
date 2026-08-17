/**
 * Campaign updates — Spec §18, §25.1 (Phase 14c).
 *
 * The Founder's updates on a live (or ended) campaign. Append-only: a published
 * update is what a Backer saw, so a correction is a new update, never a rewrite.
 * The public campaign page renders the `general_public` and `milestone_progress`
 * ones; a `backer_only` update is stored but shown only on the Backer's
 * magic-link page (Phase 15).
 */

import { pgTable, pgEnum, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/** §18's audiences. `milestone_progress` is Idea-only (trigger in 0022). */
export const updateAudience = pgEnum('update_audience', [
  'general_public',
  'backer_only',
  'milestone_progress',
]);

export const campaignUpdates = pgTable(
  'campaign_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    author: text('author').notNull(),
    audience: updateAudience('audience').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    /** Founder-supplied http(s) URLs, validated at post time; never server-fetched. */
    imageUrl: text('image_url'),
    videoUrl: text('video_url'),
    /** §18: local publication time renders from this dedicated column. */
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** §18: a material delivery change shows prior and revised commitments together. */
    isMaterialDeliveryChange: boolean('is_material_delivery_change').notNull().default(false),
    priorCommitment: text('prior_commitment'),
    revisedCommitment: text('revised_commitment'),
    /**
     * The headline metric the rebuilt page renders above an update's body
     * (0049). Both halves or neither, CHECKed: a bare `86%` reads as nothing to
     * a screen reader — the label IS its accessible name (§28.5) — and a label
     * with no value is an empty promise (§1.4).
     */
    metricLabel: text('metric_label'),
    metricValue: text('metric_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_updates_campaign_idx').on(t.campaignId, t.publishedAt),
    campaignAudienceIdx: index('campaign_updates_campaign_audience_idx').on(t.campaignId, t.audience),
    // The body-present CHECK, the material-change pairing CHECK, and the
    // milestone/Idea-only trigger are in migration 0022.
  }),
);

export type CampaignUpdate = typeof campaignUpdates.$inferSelect;
