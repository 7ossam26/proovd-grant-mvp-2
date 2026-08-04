/**
 * The Founder W-9, the payment schedule, and early remaining release —
 * Spec §22.3, §24.5, §23.3 (Phase 19b).
 *
 * `founder_w9_records`      one per campaign (unique index — the request is
 *                           idempotent by it). requested → submitted →
 *                           verified, with the recorded resubmission edge
 *                           submitted → requested; `verified` is terminal and
 *                           a verified row is immutable by trigger. No column
 *                           can take a taxpayer identification number — the
 *                           0015 CHECK shape (§11).
 *
 * `founder_w9_events`       append-only, one row per W-9 transition (§23).
 *
 * `early_release_evidence`  §22.3's four recorded proofs, each with its
 *                           evidence detail (the §31.7 seller-tax-readiness
 *                           shape). Insert-only; the latest complete row wins.
 *
 * `early_release_requests`  the Founder's ask, decided by an Admin — the §6
 *                           setting's "each request is still evidence-gated
 *                           and decided by an Admin". One pending per campaign
 *                           by partial unique index; a decided request is
 *                           immutable.
 *
 * `founder_payments`        the §22.3 payment objects: one per (campaign,
 *                           kind) by unique index (§33.8.10), CHECK-pinned to
 *                           the eligible share and the anchor-pinned due
 *                           instant, refusing to exist without a VERIFIED W-9
 *                           for the same campaign (§33.8.9). No provider
 *                           object column: under the approved direct-charge
 *                           configuration the funds already settled to the
 *                           Founder's own account, so the release is Proovd's
 *                           recorded decision — 19a's unearned-return posture.
 */

import {
  pgTable,
  uuid,
  text,
  char,
  bigint,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/* ── founder_w9_records (§22.3) ─────────────────────────────────────────────── */

export const founderW9Records = pgTable(
  'founder_w9_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** `requested` | `submitted` | `verified` (CHECK-pinned, trigger-enforced). */
    status: text('status').notNull().default('requested'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestedBy: text('requested_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** WHERE the received form is kept — never its contents, never a TIN. */
    submittedReference: text('submitted_reference'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    verificationNote: text('verification_note'),
    /** The recorded reason a submission went back to `requested`. */
    returnReason: text('return_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('founder_w9_campaign_idx').on(t.campaignId),
  }),
);

/* ── founder_w9_events (§23) ────────────────────────────────────────────────── */

export const founderW9Events = pgTable(
  'founder_w9_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    w9RecordId: uuid('w9_record_id')
      .notNull()
      .references(() => founderW9Records.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recordIdx: index('founder_w9_events_record_idx').on(t.w9RecordId, t.occurredAt),
  }),
);

/* ── early_release_evidence (§22.3, §33.8.11) ───────────────────────────────── */

export const earlyReleaseEvidence = pgTable(
  'early_release_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Proof of what affected Backers can actually reach — internal readiness
        alone is insufficient (§22.3). */
    deliveryAvailable: boolean('delivery_available').notNull(),
    deliveryAvailableDetail: text('delivery_available_detail').notNull(),
    communicationSent: boolean('communication_sent').notNull(),
    communicationSentDetail: text('communication_sent_detail').notNull(),
    taxPaymentComplete: boolean('tax_payment_complete').notNull(),
    taxPaymentCompleteDetail: text('tax_payment_complete_detail').notNull(),
    noImmediateRisk: boolean('no_immediate_risk').notNull(),
    noImmediateRiskDetail: text('no_immediate_risk_detail').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('early_release_evidence_campaign_idx').on(t.campaignId, t.recordedAt),
  }),
);

/* ── early_release_requests (§22.3) ─────────────────────────────────────────── */

export const earlyReleaseRequests = pgTable(
  'early_release_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    requestedBy: text('requested_by').notNull(),
    message: text('message').notNull(),
    /** `pending` | `approved` | `declined` (partial unique on pending). */
    status: text('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    /** §22.3: an approval exists only on recorded evidence (CHECK). */
    evidenceId: uuid('evidence_id').references(() => earlyReleaseEvidence.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('early_release_requests_campaign_idx').on(t.campaignId, t.createdAt),
  }),
);

/* ── founder_payments (§22.3, §23.3) ────────────────────────────────────────── */

export const founderPayments = pgTable(
  'founder_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** `single_payment` | `first_payment` | `remaining_payment` — §3.1
        internal names; a Founder reads the shared labels. */
    kind: text('kind').notNull(),
    /** `eligible` | `released` — §22.3's vocabulary; `blocked` is the honest
        absence of a row, reported with its named blocker by the status read. */
    status: text('status').notNull().default('eligible'),
    /** §33.8.9: a payment cannot exist without the verified record behind it. */
    w9RecordId: uuid('w9_record_id')
      .notNull()
      .references(() => founderW9Records.id),
    eligibleShareCents: bigint('eligible_share_cents', { mode: 'bigint' }).notNull(),
    percent: integer('percent').notNull(),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /** §21's anchor, copied so the CHECK pins due_at to it (0028's shape). */
    campaignCloseAt: timestamp('campaign_close_at', { withTimezone: true }).notNull(),
    scheduledDay: integer('scheduled_day').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    releasedEarly: boolean('released_early').notNull().default(false),
    earlyEvidenceId: uuid('early_evidence_id').references(() => earlyReleaseEvidence.id),
    /** §22.3 Idea: the recorded payment/risk checks and the named approver. */
    paymentChecksNote: text('payment_checks_note'),
    approvedBy: text('approved_by'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: text('released_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** §33.8.10: one payment object per (campaign, kind), ever. */
    campaignKindIdx: uniqueIndex('founder_payments_campaign_kind_idx').on(t.campaignId, t.kind),
    campaignIdx: index('founder_payments_campaign_idx').on(t.campaignId, t.status),
  }),
);

export type FounderW9Record = typeof founderW9Records.$inferSelect;
export type FounderW9Event = typeof founderW9Events.$inferSelect;
export type EarlyReleaseEvidence = typeof earlyReleaseEvidence.$inferSelect;
export type EarlyReleaseRequest = typeof earlyReleaseRequests.$inferSelect;
export type FounderPayment = typeof founderPayments.$inferSelect;
