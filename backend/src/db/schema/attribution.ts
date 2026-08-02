/**
 * The click ledger — Spec §18, §25.2, §33.6.1–5 (Phase 14b).
 *
 * `tracking_link_clicks` records every arrival through a Creator's tracking
 * link, valid or not. The first-party cookie is the per-browser winner §18
 * describes; this table is the durable audit record beside it, and the source
 * of the Creator surface's click/conversion metrics (Phase 14c).
 *
 * ── Nothing here touches a reservation ──────────────────────────────────────
 * §25.2 stores attribution on the reservation ("Attribution source,
 * Creator/link, activation time, clicked-at, replacement history, same-device
 * limitation"), but the write path onto the reservation is Phase 15's pre-order
 * flow. This ledger and the cookie are what it will read; there is no
 * `reservation_id` here, because a click precedes any pre-order and most clicks
 * never become one.
 *
 * ── Why each ignored click is recorded, not dropped (§33.6.3) ────────────────
 * §18: "Links used before activated_at, while paused, or after close cannot
 * create payable attribution." The ledger records the reason a click earned
 * nothing, so "earns nothing" is an auditable fact rather than the absence of a
 * row. The append-only grant (migration 0021) makes the record trustworthy: a
 * reservation's attribution and a dispute's evidence reconcile against it.
 */

import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { trackingLinks } from './decisions.js';

export const trackingLinkClicks = pgTable(
  'tracking_link_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    trackingLinkId: uuid('tracking_link_id')
      .notNull()
      .references(() => trackingLinks.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    /** The first-party visitor id (pv_vid cookie). §18's same-browser limit is this. */
    visitorId: uuid('visitor_id').notNull(),
    /** §25.2 "clicked-at" — the domain click instant, not the row insert time. */
    clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull(),
    /** 'attributed' | 'ignored'; mirrors shared `CLICK_OUTCOMES`, CHECK in 0021. */
    outcome: text('outcome').notNull(),
    /** Null when attributed; a shared `CLICK_IGNORED_REASONS` value when ignored. */
    ignoredReason: text('ignored_reason'),
    /** §14.1: the safe link-test marker was present; excluded from attribution. */
    linkTest: boolean('link_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    visitorIdx: index('tracking_link_clicks_visitor_idx').on(
      t.campaignId,
      t.visitorId,
      t.clickedAt,
    ),
    linkIdx: index('tracking_link_clicks_link_idx').on(t.trackingLinkId),
    campaignOutcomeIdx: index('tracking_link_clicks_campaign_outcome_idx').on(
      t.campaignId,
      t.outcome,
    ),
    // The four CHECK constraints (outcome vocab, reason pairing, reason vocab,
    // link_test consistency) are in migration 0021; Drizzle's builder does not
    // express them and the suite exercises them directly.
  }),
);

export type TrackingLinkClick = typeof trackingLinkClicks.$inferSelect;
