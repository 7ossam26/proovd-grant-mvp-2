/**
 * The Founder→Creator meeting request — Founder Dashboard Session C,
 * deviation 1. Migration 0056.
 *
 * ── This is a RECORDED DEVIATION from §1 rule 6, by explicit product direction
 * §30 defers three things this record sits next to, verbatim:
 *
 *   - Founder browsing/outreach to unmatched Affiliates.
 *   - Founder–Creator meeting scheduler; the human Founder interview scheduler
 *     is required.
 *   - Direct Founder–Affiliate messaging.
 *
 * and §11 says "The Founder cannot contact the Affiliate directly." The Admin
 * Founders rebuild refused a meeting record on 2026-08-17 for exactly this
 * reason. This one is built anyway, on product direction, and is narrowed by
 * what the table CANNOT hold rather than by anyone's intention:
 *
 *  1. It is not a scheduler. There is no `scheduled_for`, `starts_at`,
 *     `ends_at`, `duration`, `timezone`, `platform`, `meeting_url`,
 *     `calendar_id` or `slot` column, and no route accepts one — asserted in
 *     `information_schema`. §12's Cal.com booking is the one thing in this
 *     product that books time, and tech-stack §12 makes its record the source
 *     of truth. If they say yes, a person at Proovd arranges it.
 *  2. It is not a thread. ONE `message`, written at request time, immutable by
 *     trigger. ONE `response_note`. No second message, no reply route, no
 *     messages table — which is the whole of what keeps it from being the
 *     direct messaging §30 defers.
 *  3. It routes through Proovd. The Creator's address is never sent to the
 *     Founder and the request carries no contact field of any kind.
 *  4. It decides nothing. No percentage, no amount, no terms, no eligibility —
 *     accepting is agreeing to talk. §14.2's three responses are the only
 *     things that move terms, and this is not one of them.
 *
 * ── Its shape is §22.9's, deliberately ──────────────────────────────────────
 * `work_again_requests` is the one mediated Founder→Creator ask the product
 * already has, and it was built to §22.9's own words: "Routes through Proovd;
 * no direct messaging… Creator can accept/decline without penalty… Store
 * original campaign, Founder, Creator, request time, status, response." Every
 * column, constraint, index and trigger below is that table's, rescoped.
 * Copying it rather than inventing a shape is what keeps the two the same kind
 * of thing — and what makes "is this a message or a scheduler" answerable by
 * comparison rather than by argument.
 *
 * ── Not a licence for its neighbours ────────────────────────────────────────
 * A later phase asked to add a reply, a thread, a second message, a slot
 * picker, or a Creator search is asking for the direct messaging and the pool
 * browsing §30 defers. This deviation is not the licence for either.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';

export const founderMeetingRequests = pgTable(
  'founder_meeting_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    founderUserId: text('founder_user_id').notNull(),

    status: text('status').notNull().default('requested'),

    /** The one message. Immutable by trigger; there is no second. */
    message: text('message').notNull(),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** The one answer. Optional — a Creator may simply say yes or no. */
    responseNote: text('response_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* One open ask per (campaign, Creator). A Founder who asks twice while the
       first is unanswered is asking twice, not asking again — `work_again`'s
       own index, and §31.6's shape before it. */
    openIdx: uniqueIndex('founder_meeting_one_open_idx')
      .on(t.campaignId, t.associationId)
      .where(sql`status = 'requested'`),
    associationIdx: index('founder_meeting_association_idx').on(t.associationId, t.requestedAt),
  }),
);

export type FounderMeetingRequest = typeof founderMeetingRequests.$inferSelect;
