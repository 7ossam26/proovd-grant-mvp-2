/**
 * The optional digest preference and its history — Spec §27.7, §30 (Phase 22c).
 *
 * Migration `0035_digest_and_history.sql` carries the reasoning and the
 * guarantees. Two things are worth repeating where the tables are declared:
 *
 *  - there is **no table for digest content**. A digest is composed at send
 *    time from `campaign_updates`, `campaign_comments`, and
 *    `association_status_history`; `notification_deliveries` records that it
 *    went. A content table would be a second store that drifts from the
 *    records it copied (16b's timeline lesson), and the drift a reader would
 *    see is a summary of a comment that has since been removed;
 *
 *  - there is **no unread counter and no `last_opened_at`**. §27.7 forbids the
 *    history becoming a dashboard and DNA §5.5 replaces notification pressure
 *    with anticipation. The column is where the badge would come from.
 */

import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { backerIdentities } from './reservations.js';

/* ── notification_digest_preferences (§27.7) ─────────────────────────────── */

export const notificationDigestPreferences = pgTable(
  'notification_digest_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** `founder` | `affiliate` | `backer` — CHECK-pinned in 0035. */
    audience: text('audience').notNull(),

    /** Set for founder/affiliate. Exactly one subject, CHECK-tied to audience. */
    userId: text('user_id').references(() => user.id),
    /**
     * Set for a Backer. `backer_identities` is campaign-scoped (§4.1), so a
     * Backer's choice is per campaign — which is also the granularity §27.7's
     * "at first magic-link visit" is asked at, since the magic link is
     * campaign-scoped too.
     */
    backerIdentityId: uuid('backer_identity_id').references(() => backerIdentities.id),

    /**
     * `off` | `daily` | `weekly`. There is no default and no code path that
     * sets one without a person choosing it (§30). The absence of the whole
     * row is "has not chosen"; `off` is a recorded answer.
     */
    frequency: text('frequency').notNull(),

    chosenAt: timestamp('chosen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('digest_preferences_user_idx').on(t.userId),
    backerIdx: uniqueIndex('digest_preferences_backer_idx').on(t.backerIdentityId),
    dueIdx: index('digest_preferences_frequency_idx').on(t.frequency, t.audience),
  }),
);

/* ── notification_digest_preference_events (§1.1, §25.6) ─────────────────── */

/**
 * Insert-only, written by trigger. Row one of a preference is the original
 * choice with `priorFrequency` NULL. The digest is the one email a person can
 * turn off, so whether they asked for it is a fact worth being able to prove.
 */
export const notificationDigestPreferenceEvents = pgTable(
  'notification_digest_preference_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    preferenceId: uuid('preference_id')
      .notNull()
      .references(() => notificationDigestPreferences.id),
    priorFrequency: text('prior_frequency'),
    newFrequency: text('new_frequency').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    preferenceIdx: index('digest_preference_events_idx').on(t.preferenceId, t.occurredAt),
  }),
);

export type NotificationDigestPreference = typeof notificationDigestPreferences.$inferSelect;
export type NotificationDigestPreferenceEvent =
  typeof notificationDigestPreferenceEvents.$inferSelect;
