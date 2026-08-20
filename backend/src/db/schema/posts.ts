/**
 * The Founder's acknowledgement of a Creator's campaign post — Founder Dashboard
 * Session D, deviation 2. Migration 0057.
 *
 * ── This is a RECORDED DEVIATION from §1 rule 6, by explicit product direction
 * The reference draws a `Like it` control whose toast reads "Liked — creator
 * will see it". That last clause is what makes it a deviation rather than a
 * bookmark: it is a MESSAGE from a Founder to a Creator, and §30 defers "Direct
 * Founder–Affiliate messaging" while §11 says "The Founder cannot contact the
 * Affiliate directly."
 *
 * It is built anyway, on product direction, and narrowed by what the table
 * CANNOT hold rather than by anyone's intention:
 *
 *  1. It carries no message. There is no `note`, `body`, `comment`, `text`,
 *     `message` or `reason` column, and no route accepts one — asserted in
 *     `information_schema`. A free-text box here is exactly the direct
 *     messaging §30 defers, wearing a smaller control.
 *  2. It is one-way. No DELETE grant, no UPDATE grant, no `withdrawn_at`. The
 *     reference toggles (`Liked ✓` → "Like removed."), and a toggle is wrong
 *     here because a message went out: un-acknowledging would leave the record
 *     saying one thing and an inbox saying another, and §27.2's dedup means the
 *     re-acknowledgement sends nothing — so the second half of the toggle is a
 *     control that quietly does less than it says.
 *  3. It decides nothing. No amount, no percentage, no eligibility, no
 *     verification field. §17's post verification is Admin's and stays Admin's:
 *     a Founder acknowledging a post changes no §17 outcome, no attribution
 *     status, and no money.
 *  4. It routes through Proovd. The Creator's address never reaches the
 *     Founder, and the acknowledgement carries no contact column.
 *
 * ── One per (post, Founder), by unique index ────────────────────────────────
 * Not one per post: a campaign has one Founder today, and keying on the person
 * rather than assuming it keeps the record honest if that ever changes. The
 * §27 message dedups on the SUBMISSION, so a second row could never produce a
 * second message anyway.
 *
 * ── Not a licence for its neighbours ────────────────────────────────────────
 * A later phase asked to add a note, a reply, a reaction vocabulary, or a
 * Founder→Creator message of any kind is asking for the direct messaging §30
 * defers. This deviation is not the licence for it.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { creatorPostSubmissions } from './launch.js';

export const founderPostAcknowledgements = pgTable(
  'founder_post_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => creatorPostSubmissions.id),
    founderUserId: text('founder_user_id').notNull(),

    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* One per (post, Founder). A second click is the same acknowledgement. */
    oneIdx: uniqueIndex('founder_post_ack_one_idx').on(t.submissionId, t.founderUserId),
    campaignIdx: index('founder_post_ack_campaign_idx').on(t.campaignId, t.acknowledgedAt),
  }),
);

export type FounderPostAcknowledgement = typeof founderPostAcknowledgements.$inferSelect;
