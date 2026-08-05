/**
 * Payment disputes — Spec §24.11 (Phase 20b).
 *
 * `payment_disputes`         one row per provider dispute (unique per mode +
 *                            provider id). The 24-hour Admin task is
 *                            CHECK-pinned in migration 0033 to the dispute's
 *                            own opening instant and immutable by trigger.
 *                            `allocation_id` is the §24.8 classification —
 *                            write-once, `case_kind = 'dispute'`, same
 *                            reservation (trigger) — because a dispute is
 *                            classified through 20a's ONE cause register,
 *                            never a second one. The ingest writes no
 *                            allocation: §33.9.6's "an unrelated dispute does
 *                            not automatically claw back the Affiliate" is the
 *                            absence of any earnings write on this path.
 *
 * `payment_dispute_events`   append-only provider-lifecycle history.
 *
 * `payment_dispute_evidence` the recorded §24.11 packet assembly (composed
 *                            from existing records — §24.11: "assemble, do
 *                            not re-derive"), insert-only, latest wins.
 */

import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, reservations } from './domain.js';
import { refundCauseAllocations } from './refunds.js';

export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    mode: text('mode').notNull(),
    providerDisputeId: text('provider_dispute_id').notNull(),
    chargeId: text('charge_id'),
    paymentIntentId: text('payment_intent_id'),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('usd'),
    /** The provider's reason code. Internal only (§25.6, §33.9.11). */
    reasonCode: text('reason_code'),
    /** The provider lifecycle vocabulary (CHECK-pinned in 0033). */
    status: text('status').notNull(),
    providerEvidenceDueBy: timestamp('provider_evidence_due_by', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    /** §24.11: opened_at + 24 hours, CHECK-pinned and trigger-immutable. */
    taskDueAt: timestamp('task_due_at', { withTimezone: true }).notNull(),
    /** The §24.8 classification. Write-once; dispute-kind; same reservation. */
    allocationId: uuid('allocation_id').references(() => refundCauseAllocations.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_disputes_provider_idx').on(table.mode, table.providerDisputeId),
    index('payment_disputes_campaign_idx').on(table.campaignId, table.status),
    index('payment_disputes_reservation_idx').on(table.reservationId),
    index('payment_disputes_task_idx').on(table.taskDueAt),
  ],
);

export type PaymentDispute = typeof paymentDisputes.$inferSelect;

export const paymentDisputeEvents = pgTable(
  'payment_dispute_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => paymentDisputes.id),
    providerEventId: text('provider_event_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payment_dispute_events_dispute_idx').on(table.disputeId, table.occurredAt)],
);

export type PaymentDisputeEvent = typeof paymentDisputeEvents.$inferSelect;

export const paymentDisputeEvidence = pgTable(
  'payment_dispute_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => paymentDisputes.id),
    packet: jsonb('packet').notNull(),
    complete: boolean('complete').notNull(),
    missing: jsonb('missing').notNull().default([]),
    assembledBy: text('assembled_by').notNull(),
    assembledAt: timestamp('assembled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_dispute_evidence_dispute_idx').on(table.disputeId, table.assembledAt),
  ],
);

export type PaymentDisputeEvidence = typeof paymentDisputeEvidence.$inferSelect;
