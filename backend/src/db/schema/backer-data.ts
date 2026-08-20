/**
 * The Founder's Backer data request — Founder Dashboard Session F (F4).
 * Migration 0058.
 *
 * ── Not a deviation, and it is worth saying which line it sits on ───────────
 * §25.7's Founder line is exact: aggregates, plus "Immediate Backer
 * email/purchase details only for fulfillment/support", plus "Identifiable
 * survey/marketing fields only with the specific optional consent." The first
 * two arrive on their own — §19 makes the operational share MANDATORY and
 * discloses it before consent, and Session F is what finally reads it. This
 * record is the ask for anything beyond that, and it is answered by a person.
 *
 * ── The supplied reference offers three purposes and two are refused ────────
 * "Marketing follow-up", "Add to community", "Customer support". §25.7 permits
 * the third only. Both refusals are in the CHECK rather than in a service, so a
 * marketing request has no representable row whatever a route is later
 * persuaded to accept — and both are named on the form with their own reason
 * rather than quietly dropped, so a later session that wants one back has to
 * delete the sentence refusing it.
 *
 * ── An approved request grants nothing, and that is a mechanism ─────────────
 * There is no `granted_columns`, `scope`, `access_level` or `expires_at` here,
 * and `exportBackerRows` takes no request id and no purpose — so there is no
 * argument an approval could arrive as, and approving one cannot widen a file.
 * What an Admin does about an approved request is §26.7's support case: a
 * person, with the record in front of them, which is §1.3's manual-but-recorded
 * path rather than a column that quietly changes what a CSV carries.
 *
 * ── Its shape is §22.9's, through 0056 ─────────────────────────────────────
 * The ask written once and immutable; one decision, write-once by trigger;
 * history kept rather than edited. Copying `work_again_requests` rather than
 * inventing a shape is what has kept every mediated ask in this product the
 * same kind of thing.
 *
 * ── §31.8's newsletter promise is unaffected ───────────────────────────────
 * "Does not coerce newsletter consent" has been enforced since Phase 21b by
 * there being nowhere to record one. This table does not become the place: it
 * holds no consent column of any spelling, asserted in `information_schema`.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns } from './domain.js';

export const founderBackerDataRequests = pgTable(
  'founder_backer_data_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    founderUserId: text('founder_user_id').notNull(),

    /** §25.7's two permitted purposes. CHECK-pinned in 0058. */
    purpose: text('purpose').notNull(),
    /** What they need and why, written once. */
    detail: text('detail').notNull(),

    status: text('status').notNull().default('open'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    /** What the Founder is told. There is no internal column beside it (§25.6). */
    decisionNote: text('decision_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One open ask per campaign — 0056's own index, rescoped. */
    oneOpenIdx: uniqueIndex('founder_backer_data_one_open_idx')
      .on(t.campaignId)
      .where(sql`"status" = 'open'`),
    campaignIdx: index('founder_backer_data_campaign_idx').on(t.campaignId, t.requestedAt),
  }),
);
