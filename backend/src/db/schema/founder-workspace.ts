/**
 * The two person-level Founder records the Admin workspace needed — Spec §25.6,
 * §25.8, §26.1, §26.7, §29.
 *
 * ── Why these are not columns on the Founder ───────────────────────────────
 * Both are decisions with a reason, an actor, and a time, which is the shape
 * §25.6 already requires of every manual act. A `founder_prospects.suspended`
 * boolean would carry none of that, and the reason would end up in whichever
 * support case happened to be open. So the current state is derived from the
 * latest row and there is no status column anywhere — the same posture
 * `completion.ts` takes with the cooldown and `close/founder-payments.ts` takes
 * with payment blockers.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No lift for a ban (that is `founder_ghost_bans`, §22.7, permanent by Spec and
 * not duplicated here). No `deleted_at`, no purge schedule, no `approved` state
 * on a deletion request: §25.8 keeps campaign, payment, tax, support, and audit
 * records regardless of whether an account closes, so a column that implied
 * otherwise would be the first step toward a "delete everything" action the
 * Spec does not permit.
 */

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { founderProspects } from './invitations.js';
import { user } from './auth.js';

/* ── founder_access_actions (§26.7, §25.6) ──────────────────────────────────*/

/**
 * Suspending and restoring a PERSON's Founder access.
 *
 * Distinct from `campaign_enforcement_actions`, which is campaign-scoped and
 * does campaign-scoped things — closes reservations, detaches cards, moves
 * `campaigns.status`. This one concerns standing: whether this person may act
 * as a Founder at all, independent of any campaign they happen to be running.
 *
 * Append-only. `deriveAccountState` reads the latest row, the ban table, and
 * the claim; nothing writes a status.
 */
export const founderAccessActions = pgTable(
  'founder_access_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The person. Present from discovery, so a pre-claim suspension is legal. */
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => founderProspects.id),

    /**
     * The account, once one exists. Nullable rather than the key: an
     * invitation can be live and worth stopping before anybody has claimed it.
     */
    userId: text('user_id').references(() => user.id),

    /** `suspend` | `restore` — CHECK-pinned in 0040. */
    action: text('action').notNull(),

    /**
     * §26.7's own rule: the reason is required. A suspension whose reason lives
     * in somebody's memory is not reviewable, and §29 gives the Founder a right
     * to be told what happened.
     */
    reason: text('reason').notNull(),
    evidence: text('evidence'),

    /**
     * The two promises §27.1 makes a waiting person: who owns this, and when
     * they hear next. Recorded on a suspension, refused on a restore by CHECK —
     * a closed review that still names a next date is a promise nothing will
     * honour (§1.4). Nothing sweeps `next_review_at`; it is a commitment shown
     * on the surface, never a schedule (§30).
     */
    reviewOwner: text('review_owner'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('founder_access_actions_prospect_idx').on(
      t.prospectId,
      t.occurredAt.desc(),
    ),
  }),
);

/* ── founder_deletion_requests (§25.8) ──────────────────────────────────────*/

/**
 * A Founder asked Proovd to close their account.
 *
 * The record is of the ASK. Proovd deletes nothing here — §25.8 retains Founder
 * account data for account life + 7 years, and campaign, payment, tax, support,
 * and audit records outlive the account regardless of what anyone requests.
 * Presenting a control that implied otherwise would be §1.4's failure on the
 * one subject where being wrong is unrecoverable.
 */
export const founderDeletionRequests = pgTable(
  'founder_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => founderProspects.id),
    userId: text('user_id').references(() => user.id),

    /** What they asked for, in their words where we have them. */
    requestDetail: text('request_detail').notNull(),

    /**
     * How it reached us — a support case reference, an email, a call. A
     * deletion request with no provenance is one nobody can verify was made,
     * and this is a record somebody may later be asked to stand behind.
     */
    receivedVia: text('received_via').notNull(),

    /** When the Founder asked, which is not when an Admin got round to it. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),

    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('founder_deletion_requests_prospect_idx').on(
      t.prospectId,
      t.requestedAt.desc(),
    ),
  }),
);

/**
 * An Admin looked at the request and recorded what they concluded.
 *
 * Append-only rows rather than a decision column on the request, so a review
 * that changes its mind leaves both answers behind. There is exactly one
 * outcome the product offers — acknowledged, still under review — because that
 * is what §25.8 permits: retention obligations do not end because somebody
 * clicked a button.
 */
export const founderDeletionReviews = pgTable(
  'founder_deletion_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    requestId: uuid('request_id')
      .notNull()
      .references(() => founderDeletionRequests.id),

    note: text('note').notNull(),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('founder_deletion_reviews_request_idx').on(
      t.requestId,
      t.occurredAt.desc(),
    ),
  }),
);
