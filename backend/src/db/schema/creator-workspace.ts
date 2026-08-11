/**
 * The two person-level Affiliate records the Creator Admin workspace needed —
 * Spec §25.6, §25.8, §26.1, §26.7, §29.
 *
 * ── This is a recorded deviation, and it is worth stating where it lives ─────
 * §29 records Creator enforcement per ASSOCIATION — `affiliate_enforcement_actions`
 * is campaign-scoped, and `enforcement/standing.ts` has said since Phase 20b
 * that inventing an account-level Creator sanction would be §1 rule 6. On
 * 2026-08-11 the supplied Creator-workspace reference asked for account-level
 * suspend/restore, by product direction, exactly as the Founders reference
 * asked for `founder_access_actions`. The same answer was given.
 *
 * What that decision did NOT include, and must not acquire later without the
 * same instruction: a ban. §22.7's one-strike permanent sanction is a FOUNDER
 * record with four defined triggers; the Spec states no Creator equivalent, so
 * there is no `affiliate_ghost_bans`, no permanent value in `action`, and no
 * column here that could hold one. Suspension is a reversible standing review.
 *
 * ── Why these are not columns on the prospect ───────────────────────────────
 * Both are decisions with a reason, an actor, and a time, which is the shape
 * §25.6 already requires of every manual act. An `affiliate_prospects.suspended`
 * boolean would carry none of that, and the reason would end up in whichever
 * support case happened to be open. So the current state is derived from the
 * latest row and there is no status column anywhere — the same posture
 * `founder-workspace.ts` takes, and the same one `completion.ts` takes with the
 * cooldown.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No `deleted_at`, no purge schedule, no `approved` state on a deletion
 * request: §25.8 keeps campaign, payment, tax, support, and audit records
 * regardless of whether an account closes, so a column that implied otherwise
 * would be the first step toward a "delete everything" action the Spec does not
 * permit.
 */

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { affiliateProspects } from './affiliates.js';
import { user } from './auth.js';

/* ── affiliate_access_actions (§26.7, §25.6) ────────────────────────────────*/

/**
 * Suspending and restoring a PERSON's Affiliate access.
 *
 * Distinct from `affiliate_enforcement_actions`, which is association-scoped
 * and does association-scoped things — pauses a tracking link, ends one
 * partnership, opens a §29 appeal window. This one concerns standing: whether
 * this person may act as a Creator at all, independent of any campaign
 * relationship they happen to hold.
 *
 * Append-only. `deriveCreatorAccountState` reads the latest row, the claim, and
 * any open §29.8 reacceptance requirement; nothing writes a status.
 */
export const affiliateAccessActions = pgTable(
  'affiliate_access_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The person. Present from recruitment, so a pre-claim suspension is legal. */
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),

    /**
     * The account, once one exists. Nullable rather than the key: an invitation
     * can be live and worth stopping before anybody has claimed it.
     */
    userId: text('user_id').references(() => user.id),

    /** `suspend` | `restore` — CHECK-pinned in 0044. There is no `ban`. */
    action: text('action').notNull(),

    /**
     * §26.7's own rule: the reason is required. A suspension whose reason lives
     * in somebody's memory is not reviewable, and §29 gives the Creator a right
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
    prospectIdx: index('affiliate_access_actions_prospect_idx').on(
      t.prospectId,
      t.occurredAt.desc(),
    ),
    userIdx: index('affiliate_access_actions_user_idx').on(t.userId, t.occurredAt.desc()),
  }),
);

/* ── affiliate_deletion_requests (§25.8) ────────────────────────────────────*/

/**
 * An Affiliate asked Proovd to close their account.
 *
 * The record is of the ASK. Proovd deletes nothing here — §25.8 retains account,
 * tax, and status records for account life + 7 years, and campaign, payment,
 * support, and audit records outlive the account regardless of what anyone
 * requests. Presenting a control that implied otherwise would be §1.4's failure
 * on the one subject where being wrong is unrecoverable.
 */
export const affiliateDeletionRequests = pgTable(
  'affiliate_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    userId: text('user_id').references(() => user.id),

    /** What they asked for, in their words where we have them. */
    requestDetail: text('request_detail').notNull(),

    /**
     * How it reached us — a support case reference, an email, a call. A
     * deletion request with no provenance is one nobody can verify was made,
     * and this is a record somebody may later be asked to stand behind.
     */
    receivedVia: text('received_via').notNull(),

    /** When the Affiliate asked, which is not when an Admin got round to it. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),

    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('affiliate_deletion_requests_prospect_idx').on(
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
export const affiliateDeletionReviews = pgTable(
  'affiliate_deletion_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    requestId: uuid('request_id')
      .notNull()
      .references(() => affiliateDeletionRequests.id),

    note: text('note').notNull(),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('affiliate_deletion_reviews_request_idx').on(
      t.requestId,
      t.occurredAt.desc(),
    ),
  }),
);
