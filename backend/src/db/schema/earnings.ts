/**
 * Creator completion, earnings finalization, the one Transfer, and the
 * discretionary thank-you — Spec §22.1, §22.2, §24.4, §33.8 (Phase 19a).
 *
 * `creator_completion_decisions`   append-only: one row per §22.1 deliverable
 *                                  verification an Admin records, with the
 *                                  outcome (the four-case register), the
 *                                  waiver — valid only when Founder AND Admin
 *                                  agreed — and the evidence. Latest row wins;
 *                                  a disqualification discovered after a
 *                                  Transfer is a NEW row, and the earlier
 *                                  answer survives (§25.6).
 *
 * `creator_earnings`               one row per association, created BY
 *                                  finalization. `estimated` is deliberately
 *                                  the absence of a row (Phase 17b's honest
 *                                  state: nothing captured means nothing
 *                                  computed); the row starts `finalized` and
 *                                  moves through B.7's states. The amounts are
 *                                  immutable by trigger — a finalized number
 *                                  that can drift is not finalized — and the
 *                                  §24.4 identity `earned + returned =
 *                                  provisional` is a CHECK, not a hope.
 *
 * `creator_earnings_state_history` append-only, one row per B.7 transition
 *                                  (§23's rule: every transition is history).
 *
 * `affiliate_transfers`            the ONE campaign-specific Transfer per
 *                                  association (§33.8.3), claimed BEFORE the
 *                                  provider call under the stable key
 *                                  `affiliate-transfer:<associationId>` — the
 *                                  capture-attempt pattern rerun, because a
 *                                  synchronous creation failure retried under
 *                                  the same key is the SAME Transfer at Stripe
 *                                  (§32.3, §33.8.4). The total is CHECK-pinned
 *                                  to commission + bonus + fixed.
 *
 * `contractual_recovery_records`   §22.1's fraud case after money moved: the
 *                                  negative balance and contractual recovery
 *                                  record, insert-only.
 *
 * `thank_you_records`              §22.2: recognition or payment, one table,
 *                                  with the mixture refused by CHECK. No
 *                                  reservation column, no campaign-ledger
 *                                  column, no source-transaction column —
 *                                  "never deducted from Backer charges" is the
 *                                  absence of any path to them (§33.8.14).
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  char,
  bigint,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { stripeMode } from './payments.js';

/* ── creator_completion_decisions (§22.1) ──────────────────────────────────── */

export const creatorCompletionDecisions = pgTable(
  'creator_completion_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** One of the four §22.1 outcomes (CHECK-pinned in migration 0030). */
    outcome: text('outcome').notNull(),

    /** §22.1: "Admin verifies every agreed deliverable" — what was verified. */
    deliverablesNote: text('deliverables_note').notNull(),

    /** §22.1: "records any waiver agreed by Founder and Admin". A waiver is
        valid only with BOTH agreements — the CHECK refuses anything else. */
    waiver: text('waiver'),
    waiverAgreedByFounder: boolean('waiver_agreed_by_founder').notNull().default(false),
    waiverAgreedByAdmin: boolean('waiver_agreed_by_admin').notNull().default(false),

    evidence: jsonb('evidence'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('completion_decisions_association_idx').on(t.associationId, t.decidedAt),
    campaignIdx: index('completion_decisions_campaign_idx').on(t.campaignId),
  }),
);

/* ── creator_earnings (§22.1, §24.4, Appendix B.7) ─────────────────────────── */

export const creatorEarnings = pgTable(
  'creator_earnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    completionDecisionId: uuid('completion_decision_id')
      .notNull()
      .references(() => creatorCompletionDecisions.id),

    /** B.7: `finalized` → `approved_for_transfer` → `transferred` → `paid_out`,
        with `payout_failed` and `adjusted` as branches. Never `estimated` — the
        row's existence IS finalization. */
    state: text('state').notNull().default('finalized'),

    /* ── The §24.3/§24.4 numbers, immutable once written ─────────────────── */
    /** Σ captured, VALIDLY attributed, pre-tax subtotal (§22.1). */
    validSubtotalCents: bigint('valid_subtotal_cents', { mode: 'bigint' }).notNull(),
    attributedUniqueBackers: integer('attributed_unique_backers').notNull(),
    lockedTotalPercent: integer('locked_total_percent').notNull(),
    earnedBonusPercent: integer('earned_bonus_percent').notNull().default(0),
    earnedPercent: integer('earned_percent').notNull(),
    commissionCents: bigint('commission_cents', { mode: 'bigint' }).notNull(),
    bonusCents: bigint('bonus_cents', { mode: 'bigint' }).notNull(),
    /** The §22.1 fixed amount eligible for the Transfer (0 unless the recorded
        outcome is `complete_verified` and the allocation was funded). */
    eligibleFixedCents: bigint('eligible_fixed_cents', { mode: 'bigint' }).notNull().default(0n),
    provisionalTotalCents: bigint('provisional_total_cents', { mode: 'bigint' }).notNull(),
    earnedTotalCents: bigint('earned_total_cents', { mode: 'bigint' }).notNull(),
    unearnedReturnedCents: bigint('unearned_returned_cents', { mode: 'bigint' }).notNull(),

    finalizedBy: text('finalized_by').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull().defaultNow(),

    /** The `approved for transfer` act — a named Admin (§1.3, §22.1). */
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),

    /** §22.1's post-hoc adjustment (the fraud case), when one happened. */
    adjustedReason: text('adjusted_reason'),
    adjustedBy: text('adjusted_by'),
    adjustedAt: timestamp('adjusted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One finalization per association, ever — §33.8.2's "once" as an index. */
    associationIdx: uniqueIndex('creator_earnings_association_idx').on(t.associationId),
    campaignIdx: index('creator_earnings_campaign_idx').on(t.campaignId, t.state),
  }),
);

/* ── creator_earnings_state_history (§23) ──────────────────────────────────── */

export const creatorEarningsStateHistory = pgTable(
  'creator_earnings_state_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    earningsId: uuid('earnings_id')
      .notNull()
      .references(() => creatorEarnings.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    earningsIdx: index('earnings_state_history_earnings_idx').on(t.earningsId, t.occurredAt),
  }),
);

/* ── affiliate_transfers (§22.1, §33.8.3, §33.8.4) ─────────────────────────── */

export const affiliateTransfers = pgTable(
  'affiliate_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    earningsId: uuid('earnings_id')
      .notNull()
      .references(() => creatorEarnings.id),
    mode: stripeMode('mode').notNull(),

    /** The Creator's recipient account (§24.1) — `acct_…` by CHECK. */
    destinationAccountId: text('destination_account_id').notNull(),

    /** §33.8.3: the three components, with the total CHECK-pinned to their sum. */
    commissionCents: bigint('commission_cents', { mode: 'bigint' }).notNull(),
    bonusCents: bigint('bonus_cents', { mode: 'bigint' }).notNull(),
    fixedCents: bigint('fixed_cents', { mode: 'bigint' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),

    /** The stable provider key, claimed BEFORE the call (§33.8.4). */
    idempotencyKey: text('idempotency_key').notNull(),

    /** `initiated` | `created` | `failed`. NULL provider id while in flight or
        failed — the honest state a crash or a synchronous error leaves. */
    status: text('status').notNull().default('initiated'),
    providerTransferId: text('provider_transfer_id'),

    /** Raw provider detail — internal only, never the message (§25.6, §33.9.11). */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    attemptCount: integer('attempt_count').notNull().default(1),

    createdBy: text('created_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** ONE Transfer per association (§22.1) — the claim two workers race on. */
    associationIdx: uniqueIndex('affiliate_transfers_association_idx').on(t.associationId),
    keyIdx: uniqueIndex('affiliate_transfers_key_idx').on(t.idempotencyKey),
    campaignIdx: index('affiliate_transfers_campaign_idx').on(t.campaignId, t.status),
  }),
);

/* ── contractual_recovery_records (§22.1) ──────────────────────────────────── */

export const contractualRecoveryRecords = pgTable(
  'contractual_recovery_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    earningsId: uuid('earnings_id')
      .notNull()
      .references(() => creatorEarnings.id),
    transferId: uuid('transfer_id').references(() => affiliateTransfers.id),

    /** What must come back — the negative balance §22.1 names. */
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('recovery_records_association_idx').on(t.associationId),
  }),
);

/* ── thank_you_records (§22.2, §33.8.14) ───────────────────────────────────── */

export const thankYouRecords = pgTable(
  'thank_you_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** `recognition` | `payment` — §22.2's "may record recognition but cannot
        promise or send money" as a row shape, not a promise. */
    kind: text('kind').notNull(),

    /** Payment only; a recognition carrying an amount is refused by CHECK. */
    amountCents: bigint('amount_cents', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    reason: text('reason').notNull(),

    /** CHECK-pinned to the one §22.2 source. Not a caller's choice. */
    fundingSource: text('funding_source').notNull(),

    /** §22.2's three eligibility facts — Admin-confirmed, never computed. */
    minimumWorkCompleted: boolean('minimum_work_completed').notNull(),
    clickThresholdMet: boolean('click_threshold_met').notNull(),
    brandAupCompliant: boolean('brand_aup_compliant').notNull(),

    /** Payment only: the approved recipient path and the recorded approval. */
    recipientAccountId: text('recipient_account_id'),
    approvalReference: text('approval_reference'),
    approvedBy: text('approved_by'),
    taxTreatment: text('tax_treatment'),
    mode: stripeMode('mode'),
    providerTransferId: text('provider_transfer_id'),
    providerStatus: text('provider_status'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('thank_you_records_association_idx').on(t.associationId),
    campaignIdx: index('thank_you_records_campaign_idx').on(t.campaignId),
    /** One PAYMENT per association, ever — §33.8.14's "cannot duplicate". */
    onePaymentIdx: uniqueIndex('thank_you_one_payment_idx')
      .on(t.associationId)
      .where(sql`"kind" = 'payment'`),
  }),
);

export type CreatorCompletionDecision = typeof creatorCompletionDecisions.$inferSelect;
export type CreatorEarnings = typeof creatorEarnings.$inferSelect;
export type AffiliateTransfer = typeof affiliateTransfers.$inferSelect;
export type ContractualRecoveryRecord = typeof contractualRecoveryRecords.$inferSelect;
export type ThankYouRecord = typeof thankYouRecords.$inferSelect;
