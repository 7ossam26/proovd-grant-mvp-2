/**
 * Coordinated launch, first-post verification, and required Creator failure —
 * Spec §17, §29.6, §33.4.5–§33.4.9 (Phase 14a).
 *
 * Three tables:
 *
 * `campaign_launches`        one row per campaign, written when the idempotent
 *                            five-step activation runs. Its uniqueness on the
 *                            campaign is the backstop behind the idempotency key:
 *                            running the launch twice produces one row, one live
 *                            state, and one set of messages (§33.4.6).
 * `creator_post_submissions` §17's first-post record: a Creator's submitted post
 *                            URL and the Admin verification that follows —
 *                            passed, correction_needed, or rejected — with the
 *                            seven-check checklist, the correction and its due
 *                            time, and the preserved enforcement evidence.
 * `required_creator_failures` §29.6's record: the failure recorded once, the
 *                            replacement designation, and the three-business-day
 *                            deadline computed once and carrying its calendar
 *                            version. A trigger refuses to reset any of it.
 *
 * ── Verification moves no money, and the schema has nowhere to put any ───────
 * `creator_post_submissions` carries no amount, no percentage, no reservation
 * id, and no ledger column. §17: "Post verification … never releases
 * fixed-payment money" (§33.4.7). The outcome decides only whether traffic may
 * later finalize; it is a compliance record, not a payment one.
 *
 * ── The deadline is computed once and cannot be reset (§29.6, §33.4.9) ───────
 * `due_at` and `due_calendar_version` are written at the single recording of
 * the failure and made immutable by trigger — the same posture the listing
 * clocks take, because §29.6 forbids a retry or edit silently moving a deadline
 * already promised.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { listingFeeRefunds } from './listing.js';

/* ── Enums (migration 0020) ────────────────────────────────────────────────── */

/**
 * §17's first-post lifecycle. `submitted` is the Creator's act; the three
 * verification outcomes are the Admin's. Mirrors shared `POST_VERIFICATION_OUTCOMES`
 * plus the pre-verification `submitted`; drift-tested in `launch/logic.ts`.
 */
export const postVerificationStatus = pgEnum('post_verification_status', [
  'submitted',
  'passed',
  'correction_needed',
  'rejected',
]);

/** §29.6's replacement window outcome. */
export const creatorFailureStatus = pgEnum('creator_failure_status', [
  'replacement_pending',
  'replacement_ready',
  'replacement_failed',
]);

/* ── campaign_launches (§17, §33.4.5, §33.4.6) ─────────────────────────────── */

export const campaignLaunches = pgTable(
  'campaign_launches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One launch per campaign — the "one state" backstop behind the idempotency key. */
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** When the activation actually ran. */
    launchedAt: timestamp('launched_at', { withTimezone: true }).notNull(),
    /** §21: the `campaign_live_at` anchor it fired at. Links activate at exactly this. */
    campaignLiveAt: timestamp('campaign_live_at', { withTimezone: true }).notNull(),
    /** How many scheduled Creator tracking links step 2 activated. */
    activatedLinkCount: integer('activated_link_count').notNull().default(0),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_launches_campaign_idx').on(t.campaignId),
  }),
);

/* ── creator_post_submissions (§17, §33.4.7, §33.4.8) ──────────────────────── */

export const creatorPostSubmissions = pgTable(
  'creator_post_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** §17 step 4: "the public post URL." */
    postUrl: text('post_url').notNull(),
    /** The channel the Creator posted on, when stated. */
    channel: text('channel'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    /** `user:<id>` — the Creator's own session. Immutable by trigger. */
    submittedBy: text('submitted_by').notNull(),

    status: postVerificationStatus('status').notNull().default('submitted'),

    /* ── The §17 verification, recorded by Admin ─────────────────────────────── */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    /** The seven §17 checks, each with its recorded boolean result. */
    checklist: jsonb('checklist'),

    /** correction_needed: the exact correction and when it is due (§17). */
    correctionDetail: text('correction_detail'),
    correctionDueAt: timestamp('correction_due_at', { withTimezone: true }),

    /** rejected: the enforcement review and the preserved evidence (§17). */
    enforcementReason: text('enforcement_reason'),
    /** §17: "preserve evidence." A reference/snapshot of what was reviewed. */
    evidence: jsonb('evidence'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** A repeat submission of the exact same URL is idempotent, not a second post. */
    associationUrlIdx: uniqueIndex('creator_post_submissions_association_url_idx').on(
      t.associationId,
      t.postUrl,
    ),
    associationIdx: index('creator_post_submissions_association_idx').on(
      t.associationId,
      t.submittedAt,
    ),
    campaignIdx: index('creator_post_submissions_campaign_idx').on(t.campaignId, t.status),
  }),
);

/* ── required_creator_failures (§29.6, §33.4.9, §33.12.2) ──────────────────── */

export const requiredCreatorFailures = pgTable(
  'required_creator_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One per campaign: §29.6 records the failure once. */
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Which required launch Creator failed. */
    failedAssociationId: uuid('failed_association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),

    /** §29.6: "records `creator_failure_recorded_at` once." Immutable by trigger. */
    creatorFailureRecordedAt: timestamp('creator_failure_recorded_at', {
      withTimezone: true,
    }).notNull(),
    /** §29.6: "Set `creator_replacement`." The replacement designation/plan. */
    replacementDesignation: text('replacement_designation').notNull(),

    /* §29.6: "Calculate exact due timestamp using configured US business
       calendar/version; retries/edits cannot reset it." Both stored at the
       single recording and made immutable by trigger. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    dueCalendarVersion: text('due_calendar_version').notNull(),

    recordedBy: text('recorded_by').notNull(),

    status: creatorFailureStatus('status').notNull().default('replacement_pending'),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    resolutionNote: text('resolution_note'),

    /** The full-listing refund the missed deadline produced (§29.6, Phase 11's path). */
    refundId: uuid('refund_id').references(() => listingFeeRefunds.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('required_creator_failures_campaign_idx').on(t.campaignId),
  }),
);

export type CampaignLaunch = typeof campaignLaunches.$inferSelect;
export type CreatorPostSubmission = typeof creatorPostSubmissions.$inferSelect;
export type RequiredCreatorFailure = typeof requiredCreatorFailures.$inferSelect;
