/**
 * Domain skeleton tables — phase 03. Identity, status, timestamps, and
 * ledger columns ONLY; later phases add domain columns by migration.
 *
 * The state machines in `shared/states` are the single source of truth for
 * every enum value list below. The lists are restated here as literals
 * because the backend build cannot compile shared TS sources into its own
 * program (rootDir) — and the migration SQL freezes the same literals anyway.
 * `src/tests/domain-kernel.test.ts` asserts exact equality with the shared
 * arrays, so any drift fails the suite.
 *
 * §23.1 vs §23.3 is a schema instruction: `campaigns.status` is lifecycle
 * only. Payment/reconciliation flags are independent rows in
 * `campaign_payment_flags` with timestamp, amount, actor, evidence, and
 * provider IDs — never values in the lifecycle enum.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  bigint,
  char,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

/* ── Enums (values owned by shared/states; drift-tested) ────────────────── */

/** §3: internal names — `pre_build` = Idea, `pre_launch` = Product. Never rendered to customers. */
export const campaignType = pgEnum('campaign_type', ['pre_build', 'pre_launch']);

/** §23.1 — lifecycle only. Mirrors shared CAMPAIGN_STATUSES. */
export const campaignStatus = pgEnum('campaign_status', [
  'invited_draft',
  'vetting_submitted',
  'account_claimed',
  'stripe_onboarding_pending',
  'listing_fee_pending',
  'affiliate_response_and_build',
  'pending_review',
  'changes_required',
  'approved',
  'creator_prep',
  'creator_replacement',
  'refunded_no_creator',
  'live',
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
  'suspended',
  'killed',
  'banned_founder',
]);

/** §23.2. Mirrors shared AFFILIATE_ROSTER_STATUSES. */
export const affiliateRosterStatus = pgEnum('affiliate_roster_status', [
  'forming',
  'launch_ready',
  'failed',
]);

/** §23.2. Mirrors shared CAMPAIGN_BUILD_STATUSES. */
export const campaignBuildStatus = pgEnum('campaign_build_status', [
  'not_started',
  'in_progress',
  'complete',
]);

/** §23.4. Mirrors shared ASSOCIATION_STATUSES. */
export const associationStatus = pgEnum('association_status', [
  'prospect',
  'invited',
  'signup_started',
  'signed_up_waiting_for_founder',
  'preparing',
  'formal_decision_open',
  'reviewing',
  'proposal_pending',
  'accepted',
  'declined',
  'expired_no_acceptance',
  'readiness_blocked',
  'ready',
  'active',
  'paused',
  'ended',
  'removed',
  'successfully_completed',
  'completion_disqualified',
]);

/** §23.5. Mirrors shared RESERVATION_STATUSES. */
export const reservationStatus = pgEnum('reservation_status', [
  'reserved_active',
  'reserved_canceled',
  'threshold_not_met_no_charge',
  'pending_capture',
  'capture_failed_retrying',
  'capture_failed_dropped',
  'captured',
  'refunded',
  'reversed',
  'disputed',
  'killed_no_charge',
]);

/** §23.3. Mirrors shared PAYMENT_FLAGS. */
export const paymentFlag = pgEnum('payment_flag', [
  'retrying',
  'founder_payment_eligible',
  'founder_payment_paid',
  'affiliate_earnings_adjusted',
  'affiliate_transfer_eligible',
  'affiliate_transfer_paid',
  'results_ready',
  'fulfillment_active',
]);

/** §23.4. Mirrors shared ROSTER_MEMBERSHIPS. */
export const rosterMembership = pgEnum('roster_membership', ['initial_roster', 'mid_campaign']);

/* ── campaigns ──────────────────────────────────────────────────────────── */

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Nullable until vetting locks it (§33.1.7); `typeLockedAt` records when. */
    type: campaignType('type'),
    typeLockedAt: timestamp('type_locked_at', { withTimezone: true }),

    /* ── The wrong-type path (§9, §33.1.7), added Phase 07 ─────────────────
       §9: "A wrong locked type is archived and a new vetting record begins…
       No campaign-type migration exists." The type locks on this row, so the
       replacement has to be a different row — there is no unlock.

       Archive is deliberately NOT a `campaigns.status` value. §23.1 gives
       `vetting_submitted` the exit rule "Account claimed or archived/replaced"
       and names no destination state, and inventing one is what §1 rule 6
       forbids. So archival is its own dimension beside the lifecycle, the way
       §23.3's payment flags are: the lifecycle did not transition, the record
       was retired. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedReason: text('archived_reason'),
    archivedBy: text('archived_by'),
    /** Set on the archived row; points forward to the fresh vetting record. */
    replacedByCampaignId: uuid('replaced_by_campaign_id'),
    /** Set on the replacement; points back. Nothing else is carried across. */
    replacesCampaignId: uuid('replaces_campaign_id'),

    /** Lifecycle ONLY (§23.1). Payment flags live in campaign_payment_flags. */
    status: campaignStatus('status').notNull().default('invited_draft'),

    /** §23.2 — parallel tracks, separate columns. `review_ready` is derived
        in shared/states, never stored (§23.2). */
    affiliateRosterStatus: affiliateRosterStatus('affiliate_roster_status')
      .notNull()
      .default('forming'),
    campaignBuildStatus: campaignBuildStatus('campaign_build_status')
      .notNull()
      .default('not_started'),

    /* §21: the three anchors are DEDICATED columns, set by the event that
       defines them and never inferred from created_at/updated_at. */
    listingPaidAt: timestamp('listing_paid_at', { withTimezone: true }),
    campaignLiveAt: timestamp('campaign_live_at', { withTimezone: true }),
    campaignCloseAt: timestamp('campaign_close_at', { withTimezone: true }),

    /* Ledger — campaign-level aggregates of the §24.3 waterfall, integer
       cents in bigint (tech-stack §4.1). Populated by capture/reconciliation
       phases; skeleton starts at 0. */
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    rewardSubtotalCapturedCents: bigint('reward_subtotal_captured_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    salesTaxCapturedCents: bigint('sales_tax_captured_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalCapturedCents: bigint('total_captured_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    proovdFeeCents: bigint('proovd_fee_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    /** §24.4: liability account — never Proovd revenue. */
    affiliateProvisionalCents: bigint('affiliate_provisional_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    affiliateEarnedCents: bigint('affiliate_earned_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    affiliateUnearnedReturnedCents: bigint('affiliate_unearned_returned_cents', {
      mode: 'bigint',
    })
      .notNull()
      .default(sql`0`),
    founderGrossShareCents: bigint('founder_gross_share_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    stripeFeeCents: bigint('stripe_fee_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    founderNetCents: bigint('founder_net_cents', { mode: 'bigint' }).notNull().default(sql`0`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('campaigns_status_idx').on(t.status),
  }),
);

/* ── campaign_affiliate_associations ────────────────────────────────────── */

export const campaignAffiliateAssociations = pgTable(
  'campaign_affiliate_associations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Affiliate identity. The affiliates account table arrives with the auth
        phase; until then this is an unreferenced UUID. */
    affiliateId: uuid('affiliate_id').notNull(),

    status: associationStatus('status').notNull().default('prospect'),

    /** §23.4: initial-roster vs mid-campaign, stored separately from status. */
    rosterMembership: rosterMembership('roster_membership').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('associations_campaign_idx').on(t.campaignId, t.status),
    affiliateIdx: index('associations_affiliate_idx').on(t.affiliateId),
  }),
);

/* ── reservations ───────────────────────────────────────────────────────── */

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Pseudonymous Backer identity (no account, §28.1); table arrives Phase 9. */
    backerIdentityId: uuid('backer_identity_id').notNull(),

    status: reservationStatus('status').notNull().default('reserved_active'),

    /* Ledger — per-transaction §24.3 waterfall columns, persisted separately
       (tech-stack §4.1), not derived on read. */
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    rewardSubtotalCents: bigint('reward_subtotal_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    salesTaxCents: bigint('sales_tax_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    totalCapturedCents: bigint('total_captured_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    proovdFeeCents: bigint('proovd_fee_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    affiliateProvisionalCents: bigint('affiliate_provisional_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    affiliateEarnedCents: bigint('affiliate_earned_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    affiliateUnearnedReturnedCents: bigint('affiliate_unearned_returned_cents', {
      mode: 'bigint',
    })
      .notNull()
      .default(sql`0`),
    founderGrossShareCents: bigint('founder_gross_share_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    stripeFeeCents: bigint('stripe_fee_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    founderNetCents: bigint('founder_net_cents', { mode: 'bigint' }).notNull().default(sql`0`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('reservations_campaign_idx').on(t.campaignId, t.status),
    backerIdx: index('reservations_backer_idx').on(t.backerIdentityId),
  }),
);

/* ── campaign_payment_flags (§23.3) ─────────────────────────────────────── */

export const campaignPaymentFlags = pgTable(
  'campaign_payment_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    flag: paymentFlag('flag').notNull(),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
    amountCents: bigint('amount_cents', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    actor: text('actor').notNull(),
    evidence: jsonb('evidence'),
    providerObjectIds: jsonb('provider_object_ids'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('payment_flags_campaign_idx').on(t.campaignId, t.flag),
  }),
);

/* ── Append-only history, one table per machine (§23, tech-stack §4.2) ───
   from_status is null on the creation row. UPDATE/DELETE are revoked from
   the application role in the migration SQL. */

export const campaignStatusHistory = pgTable(
  'campaign_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    fromStatus: campaignStatus('from_status'),
    toStatus: campaignStatus('to_status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
  },
  (t) => ({
    campaignIdx: index('campaign_history_idx').on(t.campaignId, t.occurredAt),
  }),
);

export const associationStatusHistory = pgTable(
  'association_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    fromStatus: associationStatus('from_status'),
    toStatus: associationStatus('to_status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
  },
  (t) => ({
    associationIdx: index('association_history_idx').on(t.associationId, t.occurredAt),
  }),
);

export const reservationStatusHistory = pgTable(
  'reservation_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    fromStatus: reservationStatus('from_status'),
    toStatus: reservationStatus('to_status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
  },
  (t) => ({
    reservationIdx: index('reservation_history_idx').on(t.reservationId, t.occurredAt),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type CampaignAffiliateAssociation = typeof campaignAffiliateAssociations.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type CampaignPaymentFlag = typeof campaignPaymentFlags.$inferSelect;
