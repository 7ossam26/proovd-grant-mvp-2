/**
 * The campaign follow record — a RECORDED DEVIATION from §1 rule 6.
 *
 * Capturing an email from somebody who has not pre-ordered, and sending them
 * recurring mail, is a new commercial capability the Spec does not define.
 * §1 rule 6 would forbid it. It is built by explicit product direction, at the
 * narrowest shape that honours the promise the `Follow build` button makes,
 * and recorded in CLAUDE.md the way the 2026-08-10 Admin-MFA removal and the
 * account-level Creator suspend/restore are. See migration 0050's header for
 * the full statement of what "narrowest" means here.
 *
 * ── The three absences that keep it narrow ─────────────────────────────────
 * No schedule column of any kind, no public count, and no fourth digest
 * audience. A test asserts the schedule-shaped names are absent from
 * `information_schema` and that no file under `backend/src/jobs/` chases a
 * follower — the strongest form of a promise not to chase somebody is having
 * nowhere to record when to chase them (§30).
 *
 * ── Why the personal columns are nullable ──────────────────────────────────
 * §25.8's fourth window — "Marketing consent: until unsubscribe + 2 years" —
 * nulls them. A NOT NULL column would make the retention write impossible to
 * express. The 0050 two-shape CHECK is what requires them on a LIVE row, which
 * is stronger than NOT NULL because it also refuses a half-swept row.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/** `pending` until the confirm link is opened. Double opt-in, always. */
export const FOLLOW_STATES = ['pending', 'confirmed', 'unfollowed'] as const;
export type FollowState = (typeof FOLLOW_STATES)[number];

/** Where the ask was made. Both are the Founder's own campaign page. */
export const FOLLOW_SOURCES = ['campaign_page', 'checkout_success'] as const;
export type FollowSource = (typeof FOLLOW_SOURCES)[number];

export const campaignFollowers = pgTable(
  'campaign_followers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),

    /** As typed, and §4.1's own normalisation of it. Both nulled by the sweep. */
    email: text('email'),
    emailNormalized: text('email_normalized'),

    state: text('state').notNull().default('pending'),

    /**
     * §27.7: the preference exists only because a person chose it.
     *
     * There is NO DEFAULT in the column and no code path may supply one — the
     * follow form asks, and `notifications/preferences.ts` records the same
     * rule for the account-level digest.
     */
    frequency: text('frequency').notNull(),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unfollowedAt: timestamp('unfollowed_at', { withTimezone: true }),
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

    /** The consent as it was shown, not a template lookup (§24.10's posture). */
    consentText: text('consent_text'),
    consentVersion: text('consent_version').notNull(),

    source: text('source').notNull(),
  },
  (t) => ({
    // Over LIVE rows only — an anonymised row has no address to collide with.
    // A partial index means any `onConflictDoUpdate` needs `targetWhere`.
    oneIdx: uniqueIndex('campaign_followers_one_per_address_idx')
      .on(t.campaignId, t.emailNormalized)
      .where(sql`"email_normalized" IS NOT NULL`),
    campaignIdx: index('campaign_followers_campaign_state_idx').on(t.campaignId, t.state),
  }),
);

/**
 * The consent history, written BY TRIGGER (0050) and never by a service.
 *
 * "Did they ask for this, and when did they stop asking" is a fact we may have
 * to prove, and a service that wrote it is a service one careless
 * `db.update()` bypasses — the reasoning `app_setting_versions` (06a),
 * `draft_field_edits` (07) and `optional_item_events` (09a) already record.
 */
export const campaignFollowEvents = pgTable(
  'campaign_follow_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id')
      .notNull()
      .references(() => campaignFollowers.id, { onDelete: 'restrict' }),
    event: text('event').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    followerIdx: index('campaign_follow_events_follower_idx').on(t.followerId, t.occurredAt),
  }),
);

export type CampaignFollower = typeof campaignFollowers.$inferSelect;
export type CampaignFollowEvent = typeof campaignFollowEvents.$inferSelect;
