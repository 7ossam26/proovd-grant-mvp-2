/**
 * The campaign close batch and its capture attempts — Spec §21, §24.2, §32.4,
 * §33.7 (Phase 18a).
 *
 *   `campaign_close_batches`       one row per campaign close. The §21 batch's
 *                                  own record: when close started, the Idea
 *                                  threshold decision made from the state at
 *                                  exactly close (§33.7.5 — a trigger refuses
 *                                  to move it afterwards), the retry-window
 *                                  hours in force, and the one fixed window
 *                                  anchored at the FIRST close-batch failure.
 *                                  An incomplete batch is a visible row with
 *                                  `completed_at` NULL — §33.7.12's "visibly
 *                                  recoverable" starts as a fact in this table.
 *
 *   `reservation_capture_attempts` one row per off-session PaymentIntent
 *                                  attempt, claimed BEFORE the provider call
 *                                  with the stable §21/§24.2 idempotency key
 *                                  `reservation-capture:<reservationId>:<n>`.
 *                                  A crash between the claim and the call — or
 *                                  between the call and the record — retries
 *                                  under the SAME key, so Stripe answers with
 *                                  the same PaymentIntent and no card is
 *                                  charged twice (§33.7.7). The raw provider
 *                                  failure code lives here as internal detail
 *                                  and never becomes the message (§25.6,
 *                                  §33.9.11).
 *
 * The retry-window arithmetic is pinned by CHECK: `retry_deadline_at` equals
 * `first_failure_at + retry_window_hours`, with the hours read from the §6
 * `capture_retry_window_hours` setting at batch start and stored — §29.6's
 * posture, a later settings edit never moves a promise already made.
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignType, reservations } from './domain.js';

/* ── campaign_close_batches (§21, §33.7.5, §33.7.12) ───────────────────────── */

export const campaignCloseBatches = pgTable(
  'campaign_close_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** Snapshot of the type the batch ran under. Idea decides a threshold;
        Product charges every active transaction (§33.7.6). */
    campaignType: campaignType('campaign_type').notNull(),

    /** The §21 anchor the batch ran against. Never inferred from created_at. */
    closeAt: timestamp('close_at', { withTimezone: true }).notNull(),

    /** `in_progress` | `waiting_dedup_resolution` | `complete`. An Idea close
        with open §4.1 cases cannot decide its threshold — an Admin decision is
        missing, and the batch waits visibly rather than guessing (§1 rule 6). */
    status: text('status').notNull().default('in_progress'),

    /* ── The Idea threshold decision, made once from the state at close ──────
       §33.7.5: fixed at close; payment failures never reverse it. The trigger
       in migration 0028 refuses any change once decided_at is set. NULL on a
       Product batch — §14.4 gives Product no public funding gate. */
    thresholdRequired: integer('threshold_required'),
    uniqueActiveBackers: integer('unique_active_backers'),
    thresholdMet: boolean('threshold_met'),
    thresholdDecidedAt: timestamp('threshold_decided_at', { withTimezone: true }),

    /** How many reservations the batch locked to `pending_capture` (step 6). */
    lockedReservationCount: integer('locked_reservation_count'),
    /** How many closed `threshold_not_met_no_charge` (step 5). */
    noChargeReservationCount: integer('no_charge_reservation_count'),

    /** The §6 `capture_retry_window_hours` in force at batch start, stored so
        the deadline CHECK below is self-contained (§29.6). */
    retryWindowHours: integer('retry_window_hours').notNull(),

    /** §21 step 8: ONE fixed window, anchored at the FIRST close-batch failure.
        Set once by conditional UPDATE; immutable by trigger thereafter. */
    firstFailureAt: timestamp('first_failure_at', { withTimezone: true }),
    retryDeadlineAt: timestamp('retry_deadline_at', { withTimezone: true }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    actor: text('actor').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One close per campaign, ever — the batch's own exactly-once pivot. */
    campaignIdx: uniqueIndex('campaign_close_batches_campaign_idx').on(t.campaignId),
    statusIdx: index('campaign_close_batches_status_idx').on(t.status),
  }),
);

/* ── reservation_capture_attempts (§24.2, §32.4, §33.7.7) ──────────────────── */

export const reservationCaptureAttempts = pgTable(
  'reservation_capture_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** 1 at close; the 18b retry window mints attempt 2 with its own key. */
    attemptNumber: integer('attempt_number').notNull(),

    /** The stable key the provider call is made under. Claimed BEFORE the call;
        a retry reuses it, so Stripe returns the same PaymentIntent (§33.7.7). */
    idempotencyKey: text('idempotency_key').notNull(),

    /** The exact authorized total — never a substituted one (§19, §21). */
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),

    paymentIntentId: text('payment_intent_id'),
    chargeId: text('charge_id'),

    /** `succeeded` | `card_declined` | `insufficient_funds` | `requires_action`
        | `provider_error`. NULL while the attempt is in flight — the honest
        state a crash leaves behind, and what the resumed batch looks for. */
    outcome: text('outcome'),

    /** Raw provider detail — internal only, never the message (§25.6, §33.9.11). */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    /** One attempt N per reservation — the claim two concurrent workers race on. */
    reservationAttemptIdx: uniqueIndex('capture_attempts_reservation_attempt_idx').on(
      t.reservationId,
      t.attemptNumber,
    ),
    keyIdx: uniqueIndex('capture_attempts_key_idx').on(t.idempotencyKey),
    campaignIdx: index('capture_attempts_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_results (§21 results narrative, Phase 18b) ───────────────────── */

/**
 * §21's Founder-results narrative — the Admin-authored plain-language section
 * ("strongest signal, weakest signal, leading survey reason, and what the
 * result does/does not prove, reviewed by Admin to avoid false causality").
 * One row per campaign; insert-only at the database level. The *numbers* in
 * the results are deliberately not stored here — they are computed from the
 * ledger at read time, because a snapshot table is a second event store
 * waiting to drift (§26.8's trap).
 */
export const campaignResults = pgTable(
  'campaign_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    strongestSignal: text('strongest_signal').notNull(),
    weakestSignal: text('weakest_signal').notNull(),
    leadingSurveyReason: text('leading_survey_reason').notNull(),
    whatThisProves: text('what_this_proves').notNull(),
    whatThisDoesNotProve: text('what_this_does_not_prove').notNull(),
    /** §1.3: the named Admin whose review makes the narrative valid. */
    reviewedBy: text('reviewed_by').notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The first time the Founder opened their results (§31.9, Phase 23b).
     *
     * `prepared_at` is when `Results ready` became true; §31.9's "return after
     * closure" measures the Founder opening it within seven days, which the
     * prepared stamp cannot tell you. The only column on this insert-only table
     * the app may write, granted by name in 0037, and write-once by trigger.
     */
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One results record per campaign, ever — `Results ready` happens once. */
    campaignIdx: uniqueIndex('campaign_results_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_reconciliations (§21 Admin reconciliation, Phase 18b) ────────── */

/**
 * One row per verification of one §21 reconciliation item, append-only. A
 * discrepancy later resolved gets a NEW row — the earlier answer survives
 * (§25.6). The item key is CHECK-pinned in migration 0029 to the nine
 * registered items, so a route cannot record a verification of something that
 * does not exist.
 */
export const campaignReconciliations = pgTable(
  'campaign_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    itemKey: text('item_key').notNull(),
    /** `verified` | `discrepancy` (CHECK-pinned). */
    result: text('result').notNull(),
    note: text('note').notNull(),
    actor: text('actor').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_reconciliations_campaign_idx').on(
      t.campaignId,
      t.itemKey,
      t.recordedAt,
    ),
  }),
);

export type CampaignCloseBatch = typeof campaignCloseBatches.$inferSelect;
export type ReservationCaptureAttempt = typeof reservationCaptureAttempts.$inferSelect;
export type CampaignResults = typeof campaignResults.$inferSelect;
export type CampaignReconciliation = typeof campaignReconciliations.$inferSelect;
