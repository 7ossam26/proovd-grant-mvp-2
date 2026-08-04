/**
 * Refunds of campaign charges and §24.8 cause-based allocation — Spec §24.8,
 * §24.9, Appendix B.6, §33.9.2–§33.9.6 (Phase 20a).
 *
 * `refund_cause_allocations`  insert-only: §24.8's "every case stores cause
 *                             classification, Proovd fee treatment, Affiliate
 *                             treatment, Founder liability, recovery,
 *                             evidence, Admin, and timestamps." The
 *                             cause/treatment matrix is a CHECK in migration
 *                             0032 — a Founder-caused case cannot record a
 *                             finalized-earnings clawback (§33.9.3), a Proovd
 *                             error cannot debit the Affiliate (§33.9.5), an
 *                             unrelated dispute cannot either (§33.9.6), and
 *                             the invalid-earnings treatments carry the
 *                             INVALID amount, never the whole balance
 *                             (§33.9.4). 19b's `causeBasedAdjustmentsCents`
 *                             sums `founder_liability_cents` by campaign.
 *
 * `reservation_refunds`       the §33.9.2 lifecycle: requested → submitted →
 *                             succeeded/failed with the failed → submitted
 *                             retry edge, trigger-enforced. `allocation_id` is
 *                             NOT NULL and unique — a refund cannot exist
 *                             without its cause. The provider leg is a Refund
 *                             on the Founder's connected account (§24.1:
 *                             refunded where it was charged), claimed as this
 *                             row BEFORE the call under the stable
 *                             `reservation-refund:<id>` key.
 *
 * `reservation_refund_events` append-only history, one row per transition.
 *
 * The listing-fee refund (schema/listing.ts) is a different money stream with
 * different rules — full-total-only, platform-side — and stays untouched.
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, reservations } from './domain.js';

/* ── refund_cause_allocations (§24.8) ──────────────────────────────────────── */

export const refundCauseAllocations = pgTable(
  'refund_cause_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),

    /** `refund` in 20a; 20b classifies disputes and reversals through the same register. */
    caseKind: text('case_kind').notNull(),
    /** One of the five §24.8 causes (CHECK-pinned in 0032). */
    cause: text('cause').notNull(),
    /** What happens to Proovd's 5% on this case (§24.8). */
    proovdFeeTreatment: text('proovd_fee_treatment').notNull(),
    /** How the attributed Creator's money is treated (§24.8, §22.1). */
    affiliateTreatment: text('affiliate_treatment').notNull(),
    /** The INVALID portion — required for the two cancel/recover treatments. */
    affiliateInvalidCents: bigint('affiliate_invalid_cents', { mode: 'bigint' }),
    /** The Admin-recorded share the Founder bears; 19b's adjustments term sums it. */
    founderLiabilityCents: bigint('founder_liability_cents', { mode: 'bigint' }).notNull(),
    /** How recovery proceeds — best-effort framing, never a promise (§24.9). */
    recoveryNote: text('recovery_note'),
    evidence: text('evidence').notNull(),
    /** The named mandate when law/Stripe/issuer required the outcome. */
    mandate: text('mandate'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refund_allocations_campaign_idx').on(table.campaignId),
    index('refund_allocations_reservation_idx').on(table.reservationId),
  ],
);

export type RefundCauseAllocation = typeof refundCauseAllocations.$inferSelect;

/* ── reservation_refunds (§33.9.2) ─────────────────────────────────────────── */

export const reservationRefunds = pgTable(
  'reservation_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The quotable B.6 `Reference:` — random, leaks no refund volume. */
    reference: text('reference').notNull(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => refundCauseAllocations.id),

    /** requested → submitted → succeeded/failed; failed → submitted retries. */
    status: text('status').notNull().default('requested'),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    /** §24.9: required on an Idea campaign, forbidden on a Product one (trigger). */
    ideaExceptionReason: text('idea_exception_reason'),

    /** The reservation's own PaymentIntent (trigger-compared) and its account. */
    paymentIntentId: text('payment_intent_id').notNull(),
    stripeAccountId: text('stripe_account_id'),
    providerRefundId: text('provider_refund_id'),
    /** B.6's `Sent to:` — brand + last four where safely available. */
    destination: text('destination'),
    /** The stable provider key: a retry is the same refund at Stripe (§28.3). */
    idempotencyKey: text('idempotency_key').notNull(),

    requestedBy: text('requested_by').notNull(),
    executedBy: text('executed_by'),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reservation_refunds_reference_idx').on(table.reference),
    uniqueIndex('reservation_refunds_allocation_idx').on(table.allocationId),
    uniqueIndex('reservation_refunds_key_idx').on(table.idempotencyKey),
    index('reservation_refunds_reservation_idx').on(table.reservationId, table.createdAt),
    index('reservation_refunds_campaign_idx').on(table.campaignId, table.status),
  ],
);

export type ReservationRefund = typeof reservationRefunds.$inferSelect;

/* ── reservation_refund_events (§23) ───────────────────────────────────────── */

export const reservationRefundEvents = pgTable(
  'reservation_refund_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => reservationRefunds.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor').notNull(),
    note: text('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reservation_refund_events_refund_idx').on(table.refundId, table.occurredAt)],
);

export type ReservationRefundEvent = typeof reservationRefundEvents.$inferSelect;
