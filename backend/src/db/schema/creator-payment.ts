/**
 * The optional fixed Creator payment as a separate stream — Spec §16, §24.7,
 * §14.3, §22.1, §31.6 (Phase 13).
 *
 * Two tables, and a fourth money stream:
 *
 * `creator_payment_allocations`       one row per association whose mutually
 *                                     accepted proposal version carried a fixed
 *                                     payment — the exact accepted amount, the
 *                                     §16 funding state machine, the
 *                                     Admin-configured funding deadline, and the
 *                                     §24.7 fields the return, completion, and
 *                                     Transfer of Phase 19 will fill.
 * `creator_payment_funding_attempts`  append-only, one row per completed funding
 *                                     charge attempt (§24.7: "funding attempts
 *                                     with status and idempotency").
 *
 * ── It is its own stream, and no percentage touches it (§24.7) ──────────────
 * These tables carry no reservation id, no Backer ledger column, no percentage,
 * and no Connect-account column. §24.7: the allocation "never changes Backer
 * totals, 5%, Creator percentage base, sales tax, threshold, or cap." The
 * funding charge is collected on Proovd's platform account (the listing-fee
 * shape), and the Transfer to the Creator's recipient account is Phase 19.
 *
 * ── Funded is not paid, and the state machine says so ───────────────────────
 * §16: `not_requested → payment_pending → funded → paid`, with `payment_failed`
 * and `returned` as branches. `funded` means the Founder secured the amount;
 * whether the Creator earned it is §22.1's outcome, recorded in Phase 19 as
 * `paid` or `returned`. This phase reaches `funded` and no further.
 *
 * ── Never a holding-account word (§16, §2.1, §3.2) ──────────────────────────
 * §3.2's replacement table forbids the holding-account vocabulary, and §16
 * forbids describing this as money already paid to the Creator — everywhere:
 * schema, code, logs, copy. The permitted vocabulary is *optional fixed Creator
 * payment*, *secured Creator payment*, *Creator payment funded*, *fixed Creator
 * payment pending completion*, *fixed Creator payment paid*. The correctness
 * rules — exact full amount, one allocation, no fixed payment on an Idea
 * Campaign, immutable identity — live in migration 0019 as CHECKs, unique
 * indexes, and triggers.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  char,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations } from './domain.js';
import { proposalVersions, associationCompensationAgreements } from './decisions.js';
import { stripeMode } from './payments.js';

/* ── Enums (migration 0019) ────────────────────────────────────────────────── */

/** §16's funding statuses, exactly. `not_requested` is the state when no fixed
    payment was accepted; a real allocation is created at `payment_pending`. */
export const creatorPaymentStatus = pgEnum('creator_payment_status', [
  'not_requested',
  'payment_pending',
  'funded',
  'payment_failed',
  'returned',
  'paid',
]);

/** A single funding charge attempt's terminal outcome. */
export const fundingAttemptStatus = pgEnum('funding_attempt_status', [
  'succeeded',
  'failed',
]);

/* ── creator_payment_allocations (§16, §24.7) ──────────────────────────────── */

export const creatorPaymentAllocations = pgTable(
  'creator_payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** One allocation per association, by the unique index below. */
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** §24.7: "the mutually accepted proposal version." A fixed payment only
        ever arrives through a version, so this is never null for a real one. */
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersions.id),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => associationCompensationAgreements.id),

    status: creatorPaymentStatus('status').notNull().default('payment_pending'),

    /** §34 condition 5: test and live money are provably never mixed. */
    mode: stripeMode('mode').notNull(),

    /** §16/§24.7: the EXACT accepted amount. Integer cents, immutable by trigger. */
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),

    /** §24.7: "tax/accounting treatment." A recorded classification of the
        stream, never a computed tax line — §24.7 excludes sales tax from it. */
    taxTreatment: text('tax_treatment').notNull(),

    /* §16: "Missing the Admin-configured funding deadline may cancel the
       association." The deadline is set by an Admin per allocation — §6 fixes no
       value, so nothing here invents one; it is null until a person records it. */
    fundingDeadlineAt: timestamp('funding_deadline_at', { withTimezone: true }),
    fundingDeadlineSetBy: text('funding_deadline_set_by'),
    fundingDeadlineSetAt: timestamp('funding_deadline_set_at', { withTimezone: true }),

    /** Set once, at successful funding. Cannot be cleared (trigger). */
    fundedAt: timestamp('funded_at', { withTimezone: true }),

    /* §16: a lapsed funding deadline cancels the association; the 20% base then
       stops applying because the association is removed. Recorded here so the
       cancellation is attributable and the allocation is closed out. */
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    canceledBy: text('canceled_by'),
    canceledReason: text('canceled_reason'),

    /* §24.7's return eligibility. Filled by Phase 19's §22.1 return-or-pay
       decision; stored here so the stream is complete and its stable
       idempotency key (`creatorPaymentReturnKey`) has a home. */
    returnEligible: boolean('return_eligible'),
    returnAmountCents: bigint('return_amount_cents', { mode: 'bigint' }),
    returnReason: text('return_reason'),
    returnObjectId: text('return_object_id'),

    /* §24.7's completion eligibility/evidence and the Transfer/payout record.
       Phase 19 fills these; the columns exist now so later phases add rows, not
       columns, to a stream the reconciliation already reads (the 10a posture). */
    completionEligible: boolean('completion_eligible'),
    completionEvidence: jsonb('completion_evidence'),
    transferObjectId: text('transfer_object_id'),
    payoutObjectId: text('payout_object_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: uniqueIndex('creator_payment_allocations_association_idx').on(t.associationId),
    campaignIdx: index('creator_payment_allocations_campaign_idx').on(t.campaignId, t.status),
  }),
);

/* ── creator_payment_funding_attempts (§24.7, §33.4.3) ─────────────────────── */

/**
 * Append-only. One row per completed attempt — a succeeded funding charge or a
 * failed/expired one. The Checkout session id is unique, so a replayed webhook
 * under a fresh event id cannot record a second attempt or a second charge, and
 * the allocation's `funded` state cannot be reached twice.
 */
export const creatorPaymentFundingAttempts = pgTable(
  'creator_payment_funding_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => creatorPaymentAllocations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),

    mode: stripeMode('mode').notNull(),

    /** The Founder-funding charge object (§24.7). */
    checkoutSessionId: text('checkout_session_id').notNull(),
    paymentIntentId: text('payment_intent_id'),
    chargeId: text('charge_id'),

    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),

    /** §24.7: "descriptor." A CHECK pins it in the migration. */
    descriptor: text('descriptor').notNull().default('PROOVD CREATOR PAY'),
    /** §24.7: "fees." The Stripe processing fee on the charge, when known. */
    feeCents: bigint('fee_cents', { mode: 'bigint' }),

    status: fundingAttemptStatus('status').notNull(),

    /** §16/§24.7: "funding attempts with status and idempotency." */
    idempotencyKey: text('idempotency_key').notNull(),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    providerEventId: text('provider_event_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => ({
    sessionIdx: uniqueIndex('creator_payment_funding_attempts_session_idx').on(t.checkoutSessionId),
    allocationIdx: index('creator_payment_funding_attempts_allocation_idx').on(t.allocationId, t.createdAt),
  }),
);

export type CreatorPaymentAllocation = typeof creatorPaymentAllocations.$inferSelect;
export type CreatorPaymentFundingAttempt = typeof creatorPaymentFundingAttempts.$inferSelect;

/* ── The Founder's fixed-payment openness (Founder Flow v2, migration 0052) ── */

/**
 * Whether the Founder is open to funding an optional fixed Creator payment.
 *
 * **A recorded deviation from §1 rule 6, by explicit product direction
 * (2026-08-18).** §16 makes the fixed payment the CREATOR's request, accepted
 * bilaterally through one proposal version (§14.2), and not the default model.
 * A Founder answering a pay-model question during onboarding — before the
 * listing fee is paid and before any Creator exists — has no place in that
 * negotiation.
 *
 * So the record binds nothing, and the enforcement is what it cannot hold:
 * there is **no amount column**, no percentage, and no proposal-version
 * reference. A number here would be the proposal only a Creator may make; a
 * rate would be a fourth answer to §14.3's three §6 settings. What the Founder
 * states is an openness, and the terms are still §14.2's to negotiate — the
 * §1.3 manual-but-recorded path the reference's own copy describes.
 *
 * A 0052 CHECK refuses an Idea campaign outright (§14.3 prohibits the fixed
 * payment there), and a shape trigger requires the stored type to be the
 * campaign's own — without it the CHECK would be satisfiable by writing
 * `pre_launch` onto an Idea campaign and would enforce nothing.
 *
 * Insert-only, superseded rather than edited: an answer somebody changed their
 * mind about is two facts, and which one was live when a Creator was approached
 * is a question that may have to be answered later.
 *
 * **It is read by Admin when recruiting, and by nothing else.** A later phase
 * asked to read it as a default, a filter, or an eligibility condition is
 * asking for the §1 rule 6 violation the missing columns exist to prevent.
 */
export const founderFixedPaymentOpenness = pgTable(
  'founder_fixed_payment_openness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /**
     * `open` | `not_open` | `undecided`, CHECK-pinned in 0052.
     *
     * `undecided` is a recorded "I do not know yet", which is a different fact
     * from never having been asked (§1.4) — and is what lets the flow offer a
     * way past the screen without inventing a default.
     */
    stance: text('stance').notNull(),
    /** The type it was answered against. Trigger-pinned to the campaign's own. */
    campaignType: text('campaign_type').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /** The one column UPDATE is granted on. Write-once by trigger. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    campaignIdx: index('founder_openness_campaign_idx').on(t.campaignId, t.recordedAt),
  }),
);

export type FounderFixedPaymentOpenness = typeof founderFixedPaymentOpenness.$inferSelect;
