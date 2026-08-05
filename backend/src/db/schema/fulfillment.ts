/**
 * Fulfillment, delivery-date changes, the Day 14 Progress Check, and the
 * one-strike Founder ghost ban — Spec §22.4, §22.5, §22.6, §22.7 (Phase 21a).
 *
 * The guarantees live in migration 0034 as CHECKs, partial unique indexes, and
 * triggers: the insert-only commitment sequence whose first row is the original
 * promise, the approval-path authorisation a revision cannot fake, the
 * write-once Day 14 decision whose outcome and findings cannot disagree, the
 * durable insert-only receipt, and the one-per-Founder permanent ban with no
 * lift path anywhere in the schema.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';
import { campaignUpdates } from './updates.js';

/* ── campaign_fulfillment (§22.5) ──────────────────────────────────────────── */

export const campaignFulfillment = pgTable(
  'campaign_fulfillment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** One of §22.5's seven mechanisms; CHECK-pinned in 0034. */
    mechanism: text('mechanism'),
    accessInstructions: text('access_instructions'),
    /** §22.5's first obligation: the close confirmation and the update that carried it. */
    closeConfirmationUpdateId: uuid('close_confirmation_update_id').references(
      () => campaignUpdates.id,
    ),
    closeConfirmationSentAt: timestamp('close_confirmation_sent_at', { withTimezone: true }),
    /** §22.5's third obligation: access granted, then the Backers notified. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveredBy: text('delivered_by'),
    deliveryNotifiedAt: timestamp('delivery_notified_at', { withTimezone: true }),
    /** §23.1 `fulfilled`. Separate from §22.11's `closed_resolved` by construction. */
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_fulfillment_campaign_idx').on(t.campaignId),
  }),
);

export type CampaignFulfillment = typeof campaignFulfillment.$inferSelect;

/* ── delivery_change_requests (§22.6) ──────────────────────────────────────── */

export const deliveryChangeRequests = pgTable(
  'delivery_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Always `admin_preapproval` — the notice path opens no request (0034 CHECK). */
    path: text('path').notNull(),
    proposedDeliveryMonth: date('proposed_delivery_month').notNull(),
    proposedDeliveryDate: date('proposed_delivery_date'),
    reason: text('reason').notNull(),
    unchangedObligations: text('unchanged_obligations').notNull(),
    nextUpdateDate: date('next_update_date').notNull(),
    supportRefundRoute: text('support_refund_route').notNull(),
    status: text('status').notNull().default('pending'),
    /** §22.6's five business days, on the committed calendar, immutable by trigger. */
    reviewDueAt: timestamp('review_due_at', { withTimezone: true }).notNull(),
    calendarVersion: text('calendar_version').notNull(),
    /** §22.6: Admin reviews "for bait-and-switch risk and payment impact" — two findings. */
    baitAndSwitchFinding: text('bait_and_switch_finding'),
    paymentImpactFinding: text('payment_impact_finding'),
    decisionInternalReason: text('decision_internal_reason'),
    decisionCustomerExplanation: text('decision_customer_explanation'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    resultingCommitmentId: uuid('resulting_commitment_id'),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dueIdx: index('delivery_change_requests_due_idx').on(t.status, t.reviewDueAt),
    // The one-pending partial unique index is in 0034.
  }),
);

export type DeliveryChangeRequest = typeof deliveryChangeRequests.$inferSelect;

/* ── delivery_commitments (§22.5, §22.6) ───────────────────────────────────── */

export const deliveryCommitments = pgTable(
  'delivery_commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** 1 is the original promise; a revision is the next sequence, never an edit. */
    sequence: integer('sequence').notNull(),
    deliveryMonth: date('delivery_month').notNull(),
    deliveryDate: date('delivery_date'),
    commitmentText: text('commitment_text').notNull(),
    reason: text('reason'),
    path: text('path'),
    changeRequestId: uuid('change_request_id').references(() => deliveryChangeRequests.id),
    updateId: uuid('update_id').references(() => campaignUpdates.id),
    notifiedBackersAt: timestamp('notified_backers_at', { withTimezone: true }),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sequenceIdx: uniqueIndex('delivery_commitments_sequence_idx').on(t.campaignId, t.sequence),
  }),
);

export type DeliveryCommitment = typeof deliveryCommitments.$inferSelect;

/* ── day_14_reviews (§22.4) ────────────────────────────────────────────────── */

export const day14Reviews = pgTable(
  'day_14_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** `campaign_close_at` + 14 days. The decision due time the receipt quotes. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: text('outcome').notNull().default('pending'),
    adequateProgressEvidence: boolean('adequate_progress_evidence'),
    requiredCommunication: boolean('required_communication'),
    failureReasons: jsonb('failure_reasons').notNull().default([]),
    internalReason: text('internal_reason'),
    customerExplanation: text('customer_explanation'),
    consequences: jsonb('consequences').notNull().default([]),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('day_14_reviews_campaign_idx').on(t.campaignId),
    dueIdx: index('day_14_reviews_due_idx').on(t.outcome, t.dueAt),
  }),
);

export type Day14Review = typeof day14Reviews.$inferSelect;

/* ── day_14_evidence_submissions / items (§22.4) ───────────────────────────── */

export const day14EvidenceSubmissions = pgTable(
  'day_14_evidence_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => day14Reviews.id),
    /** Quotable, on 16b's alphabet, random rather than sequential. */
    reference: text('reference').notNull(),
    decisionDueAt: timestamp('decision_due_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('day_14_submissions_reference_idx').on(t.reference),
    reviewIdx: index('day_14_submissions_review_idx').on(t.reviewId, t.submittedAt),
  }),
);

export type Day14EvidenceSubmission = typeof day14EvidenceSubmissions.$inferSelect;

export const day14EvidenceItems = pgTable(
  'day_14_evidence_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => day14EvidenceSubmissions.id),
    itemKey: text('item_key').notNull(),
    detail: text('detail').notNull(),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    submissionKeyIdx: uniqueIndex('day_14_items_submission_key_idx').on(t.submissionId, t.itemKey),
  }),
);

export type Day14EvidenceItem = typeof day14EvidenceItems.$inferSelect;

/* ── day_14_clarification_requests (§22.4) ─────────────────────────────────── */

export const day14ClarificationRequests = pgTable(
  'day_14_clarification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => day14Reviews.id),
    question: text('question').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Five business days on the committed calendar, stored with its version (§29.6). */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    calendarVersion: text('calendar_version').notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseNote: text('response_note'),
  },
  (t) => ({
    reviewIdx: index('day_14_clarifications_review_idx').on(t.reviewId, t.dueAt),
  }),
);

export type Day14ClarificationRequest = typeof day14ClarificationRequests.$inferSelect;

/* ── founder_ghost_bans (§22.7) ────────────────────────────────────────────── */

export const founderGhostBans = pgTable(
  'founder_ghost_bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One row per Founder — one strike, enforced by unique index. */
    founderUserId: text('founder_user_id').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** One of §22.7's four triggers; there is no `other` value. */
    trigger: text('trigger').notNull(),
    evidence: text('evidence').notNull(),
    notice: text('notice').notNull(),
    paymentRecoveryStatus: text('payment_recovery_status').notNull(),
    enforcementDecision: text('enforcement_decision').notNull(),
    internalReason: text('internal_reason').notNull(),
    /** The evaluated facts, so the decision is reproducible from the record. */
    triggerFacts: jsonb('trigger_facts').notNull(),
    day14ReviewId: uuid('day_14_review_id').references(() => day14Reviews.id),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    founderIdx: uniqueIndex('founder_ghost_bans_founder_idx').on(t.founderUserId),
    campaignIdx: index('founder_ghost_bans_campaign_idx').on(t.campaignId),
  }),
);

export type FounderGhostBan = typeof founderGhostBans.$inferSelect;
