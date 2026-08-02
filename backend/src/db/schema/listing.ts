/**
 * The listing fee as its own stream — Spec §24.6, §13, §14.6, §29.6, §31.6.
 *
 * Three tables, and the first money the product ever takes:
 *
 * `listing_fee_payments`      one row per successful Checkout — §24.6's record
 *                             of the Founder↔Proovd direct transaction, plus
 *                             the two §6 clocks computed at payment.
 * `listing_fee_refunds`       at most one per payment, by unique index. §13's
 *                             refund promise is "the entire Checkout charge,
 *                             once" — the database is what makes "once" true.
 * `campaign_cancellations`    §31.6's decision record. The free-window path
 *                             decides itself; everything else is a request an
 *                             Admin decides.
 *
 * ── Why this is not `provider_objects` ──────────────────────────────────────
 * §32.4's store keeps what Stripe said. This keeps what Proovd promised: the
 * itemised lines the Founder was shown, the exact consented total, and the two
 * deadlines that started when payment succeeded. §33.3.6 requires the listing
 * stream reconcilable "entirely separately from Connect campaign money" — these
 * tables reference no reservation, no association ledger, and no Connect
 * account, and there is no column that could hold campaign-charge money.
 *
 * ── The deadlines are stored, not recomputed ────────────────────────────────
 * §29.6's principle: a retry or edit can never silently move a deadline that
 * was already computed and promised. The two windows are read from `app_settings`
 * at payment time and written here with the hour values that were in force; a
 * later settings change applies to later payments, never to a promise already
 * made. A CHECK pins each stored deadline to `paid_at` + the stored window, and
 * the immutability trigger refuses to move any of it afterwards.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
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
import { campaigns } from './domain.js';
import { listingFeeCalculations } from './workspace.js';
import { stripeMode } from './payments.js';

/* ── Enums ────────────────────────────────────────────────────────────────── */

/**
 * §13's three refund conditions, §31.6's free window, and the Admin-discretion
 * case §31.6 leaves to a person. Every refund names which promise it honoured —
 * a refund with no trigger is money that moved for no recorded reason.
 */
export const listingRefundTrigger = pgEnum('listing_refund_trigger', [
  'zero_eligible_recruits',
  'no_mutual_acceptance',
  'creator_replacement_failed',
  'founder_free_cancellation',
  'admin_discretion',
]);

/**
 * `initiated` is the honest middle state: the row was claimed before the
 * provider call (§7's send-row-first pattern, applied to money), so a crash
 * between the two leaves a visible, retryable record rather than a refund with
 * no evidence or evidence with no refund.
 */
export const listingRefundStatus = pgEnum('listing_refund_status', [
  'initiated',
  'succeeded',
  'failed',
]);

/** §31.6's two paths: inside the free window, or by Admin decision. */
export const cancellationKind = pgEnum('cancellation_kind', ['free_window', 'admin_review']);

export const cancellationStatus = pgEnum('cancellation_status', [
  'pending',
  'canceled',
  'denied',
]);

/* ── listing_fee_payments (§24.6, §13) ────────────────────────────────────── */

export const listingFeePayments = pgTable(
  'listing_fee_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** One successful payment per campaign, by unique index below. */
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** The §12 calculation that was locked and charged. */
    calculationId: uuid('calculation_id')
      .notNull()
      .references(() => listingFeeCalculations.id),

    /** §34 condition 5: test and live money are provably never mixed. */
    mode: stripeMode('mode').notNull(),

    checkoutSessionId: text('checkout_session_id').notNull(),
    paymentIntentId: text('payment_intent_id'),

    currency: char('currency', { length: 3 }).notNull().default('USD'),

    /* §24.6: "Base, each optional discount, promotion, tax, total." Integer
       cents in bigint, and the arithmetic is a CHECK in the migration. */
    baseCents: bigint('base_cents', { mode: 'bigint' }).notNull(),
    discountCents: bigint('discount_cents', { mode: 'bigint' }).notNull(),
    /** Each earned saving as its own labeled line (§13, §33.3.5). */
    discountLines: jsonb('discount_lines').notNull().default(sql`'[]'::jsonb`),
    /**
     * §24.6 names promotion as part of the stream. No promotion mechanism
     * exists in the MVP and §1 rule 6 forbids inventing one, so this records 0
     * — "no promotion applied" is a fact, unlike a zero tax, which would be a
     * claim (§1.4).
     */
    promotionCents: bigint('promotion_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    subtotalCents: bigint('subtotal_cents', { mode: 'bigint' }).notNull(),
    taxCents: bigint('tax_cents', { mode: 'bigint' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'bigint' }).notNull(),

    /** The stored Stripe Tax calculation the total came from (§32.4). */
    taxCalculationId: text('tax_calculation_id'),

    /** §24.6 fixes it; a CHECK pins it. */
    descriptor: text('descriptor').notNull().default('PROOVD LISTING'),
    receiptUrl: text('receipt_url'),

    /** A.5's optional consent — §28.4: its own record, never bundled. */
    newsletterOptIn: boolean('newsletter_opt_in').notNull().default(false),
    newsletterOptInAt: timestamp('newsletter_opt_in_at', { withTimezone: true }),

    /** Mirrors `campaigns.listing_paid_at`. §21: never inferred. */
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),

    /* The two §6 clocks, computed at payment from the settings in force and
       never recomputed (§29.6). The hour values are stored beside the
       deadlines so a later settings change is visibly not retroactive. */
    responseWindowHours: integer('response_window_hours').notNull(),
    responseDeadlineAt: timestamp('response_deadline_at', { withTimezone: true }).notNull(),
    freeCancellationWindowHours: integer('free_cancellation_window_hours').notNull(),
    freeCancellationDeadlineAt: timestamp('free_cancellation_deadline_at', {
      withTimezone: true,
    }).notNull(),

    /** The webhook delivery that recorded it, when one did. */
    providerEventId: text('provider_event_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Retry-safe: a duplicate `checkout.session.completed` cannot land twice. */
    campaignIdx: uniqueIndex('listing_fee_payments_campaign_idx').on(t.campaignId),
    sessionIdx: uniqueIndex('listing_fee_payments_session_idx').on(t.checkoutSessionId),
    deadlineIdx: index('listing_fee_payments_deadline_idx').on(t.responseDeadlineAt),
  }),
);

/* ── listing_fee_refunds (§13, §14.6, §29.6, §31.6, §33.3.8) ──────────────── */

export const listingFeeRefunds = pgTable(
  'listing_fee_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** "Once" is this unique index, not a service's memory. */
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => listingFeePayments.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    trigger: listingRefundTrigger('trigger').notNull(),
    status: listingRefundStatus('status').notNull().default('initiated'),

    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /* §13: "the entire Checkout charge actually paid — listing-fee subtotal
       plus the associated sales-tax reversal or correction." A trigger in the
       migration compares these to the payment row: never partial, and the
       unique index above makes it never twice. */
    subtotalRefundedCents: bigint('subtotal_refunded_cents', { mode: 'bigint' }).notNull(),
    taxRefundedCents: bigint('tax_refunded_cents', { mode: 'bigint' }).notNull(),
    totalRefundedCents: bigint('total_refunded_cents', { mode: 'bigint' }).notNull(),

    /** §24.6: "Refund object and tax reversal/correction." */
    refundObjectId: text('refund_object_id'),

    /* §25.6: who, why internally, and what the Founder reads — separately. */
    actor: text('actor').notNull(),
    internalReason: text('internal_reason').notNull(),
    customerExplanation: text('customer_explanation').notNull(),

    failureMessage: text('failure_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => ({
    paymentIdx: uniqueIndex('listing_fee_refunds_payment_idx').on(t.paymentId),
    campaignIdx: index('listing_fee_refunds_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_cancellations (§31.6, §33.3.11) ─────────────────────────────── */

export const campaignCancellations = pgTable(
  'campaign_cancellations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    kind: cancellationKind('kind').notNull(),
    status: cancellationStatus('status').notNull(),

    /** `user:<id>` for the Founder, `admin:<id>` for an Admin acting for them. */
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),

    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    /* §25.6's split, again: what support reads and what the Founder reads. */
    internalReason: text('internal_reason').notNull(),
    customerExplanation: text('customer_explanation').notNull(),

    /** The refund the decision produced, when it produced one. */
    refundId: uuid('refund_id').references(() => listingFeeRefunds.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One open request per campaign; a second while one waits is a duplicate. */
    pendingIdx: uniqueIndex('campaign_cancellations_pending_idx')
      .on(t.campaignId)
      .where(sql`${t.status} = 'pending'`),
    campaignIdx: index('campaign_cancellations_campaign_idx').on(t.campaignId, t.requestedAt),
  }),
);

export type ListingFeePayment = typeof listingFeePayments.$inferSelect;
export type ListingFeeRefund = typeof listingFeeRefunds.$inferSelect;
export type CampaignCancellation = typeof campaignCancellations.$inferSelect;
