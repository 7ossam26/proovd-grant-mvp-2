/**
 * Backer identity, deduplication, operational sharing, and the atomic cap —
 * Spec §4.1, §19, §25.2, §25.3, §2.2 (Phase 15).
 *
 * The reservation row itself lives in `domain.ts` (Phase 03 skeleton, extended
 * with §25.2's fields in migration 0023). These are the surrounding records a
 * pre-order needs and the guarantees migration 0023 installs:
 *
 *   `backer_identities`            the pseudonymous per-campaign Backer (§28.1,
 *                                  §5.4 — no account). Groups a Product Backer's
 *                                  multiple transactions and anchors the magic
 *                                  link.
 *   `reservation_deduplication`    §25.3's least-privilege signal record —
 *                                  hashes and a fingerprint reference, never a
 *                                  public identity profile. Append-only.
 *   `deduplication_cases`          §4.1's Admin queue for suspected duplicates.
 *                                  Shared IP alone never opens a merge — the
 *                                  service enforces it and the tests prove it.
 *   `founder_operational_shares`   §19's immediate, mandatory fulfillment/support
 *                                  share. Content is immutable once shared
 *                                  ("cannot be retracted"); only the fulfillment
 *                                  state flips to `do_not_fulfill` on cancel.
 *   `campaign_reservation_capacity` the §2.2 US$50,000 pre-tax cap, enforced by a
 *                                  CHECK and moved only by a conditional UPDATE —
 *                                  the database-level atomic operation §33.5.10
 *                                  tests under concurrency.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/* ── Enums (migration 0023) ────────────────────────────────────────────────── */

export const deduplicationCaseStatus = pgEnum('deduplication_case_status', [
  'open',
  'merged',
  'separated',
]);

/** §19: cancellation changes the Founder record to `do not fulfill`. */
export const operationalFulfillmentState = pgEnum('operational_fulfillment_state', [
  'active',
  'do_not_fulfill',
]);

/* ── backer_identities (§28.1, §5.4) ───────────────────────────────────────── */

export const backerIdentities = pgTable(
  'backer_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** Canonical contact for the magic link and operational sharing (§25.2). */
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    /** Normalized forms behind the dedup key (§4.1). */
    emailNormalized: text('email_normalized').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    /**
     * The private practical-unique-Backer key: an HMAC over the normalized
     * email+phone. Same person, same key — this is what makes "one active Idea
     * pre-order per unique Backer" a database fact rather than a heuristic.
     */
    dedupKey: text('dedup_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One identity per practical-unique Backer per campaign (§4.1). */
    campaignDedupIdx: uniqueIndex('backer_identities_campaign_dedup_idx').on(
      t.campaignId,
      t.dedupKey,
    ),
  }),
);

/* ── reservation_deduplication (§25.3) ─────────────────────────────────────── */

export const reservationDeduplication = pgTable(
  'reservation_deduplication',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** The reservation this signal set was captured for. FK in migration SQL. */
    reservationId: uuid('reservation_id').notNull(),
    backerIdentityId: uuid('backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),
    /** §25.3: hashes only, never raw email/phone in the dedup record. */
    emailHash: text('email_hash').notNull(),
    phoneHash: text('phone_hash').notNull(),
    dedupKey: text('dedup_key').notNull(),
    /** Stripe payment-method fingerprint reference, when available (§4.1). */
    paymentFingerprint: text('payment_fingerprint'),
    /** Device/IP risk *references* — hashed. Never a merge signal on their own. */
    deviceHash: text('device_hash'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('reservation_dedup_campaign_idx').on(t.campaignId, t.dedupKey),
    fingerprintIdx: index('reservation_dedup_fingerprint_idx').on(
      t.campaignId,
      t.paymentFingerprint,
    ),
    reservationIdx: index('reservation_dedup_reservation_idx').on(t.reservationId),
  }),
);

/* ── deduplication_cases (§4.1 Admin queue) ────────────────────────────────── */

export const deduplicationCases = pgTable(
  'deduplication_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    primaryBackerIdentityId: uuid('primary_backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),
    suspectedBackerIdentityId: uuid('suspected_backer_identity_id')
      .notNull()
      .references(() => backerIdentities.id),
    /** Which signals matched (email/phone/payment_fingerprint). Never `ip` alone. */
    signals: jsonb('signals').notNull(),
    status: deduplicationCaseStatus('status').notNull().default('open'),
    /** §4.1: an Admin decision records reason, evidence, prior/new value, actor. */
    decidedReason: text('decided_reason'),
    decidedEvidence: jsonb('decided_evidence'),
    priorValue: jsonb('prior_value'),
    newValue: jsonb('new_value'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('deduplication_cases_campaign_idx').on(t.campaignId, t.status),
    /** One open case per suspected pair — a re-detection is not a new case. */
    pairIdx: uniqueIndex('deduplication_cases_pair_idx').on(
      t.campaignId,
      t.primaryBackerIdentityId,
      t.suspectedBackerIdentityId,
    ),
  }),
);

/* ── founder_operational_shares (§19) ──────────────────────────────────────── */

export const founderOperationalShares = pgTable(
  'founder_operational_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One share per reservation. FK in migration SQL. */
    reservationId: uuid('reservation_id').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** The Founder who owns fulfillment. `founder:<userId>`. */
    founderUserId: text('founder_user_id').notNull(),
    /** §19: email + purchase details needed for fulfillment. No survey PII here. */
    backerEmail: text('backer_email').notNull(),
    rewardSku: text('reward_sku').notNull(),
    rewardTitle: text('reward_title').notNull(),
    purchaseDetail: jsonb('purchase_detail').notNull(),
    fulfillmentState: operationalFulfillmentState('fulfillment_state').notNull().default('active'),
    sharedAt: timestamp('shared_at', { withTimezone: true }).notNull().defaultNow(),
    doNotFulfillAt: timestamp('do_not_fulfill_at', { withTimezone: true }),
    /** §19: "Store delivery/audit status" of the share. */
    deliveryStatus: text('delivery_status').notNull().default('shared'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reservationIdx: uniqueIndex('founder_operational_shares_reservation_idx').on(t.reservationId),
    campaignIdx: index('founder_operational_shares_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_reservation_capacity (§2.2, §33.5.10) ────────────────────────── */

export const campaignReservationCapacity = pgTable(
  'campaign_reservation_capacity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /**
     * The cap in force for this campaign, captured from the §6 `campaign_cap_cents`
     * setting when the row is created and frozen thereafter (§29.6's posture: a
     * later settings edit never moves a promise already made). Pre-tax (§24.3).
     */
    capCents: bigint('cap_cents', { mode: 'bigint' }).notNull(),
    /** Running sum of active reservations' pre-tax subtotal. The CHECK below is
        the ceiling; a conditional UPDATE is the atomic gate (§33.5.10). */
    reservedSubtotalCents: bigint('reserved_subtotal_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_reservation_capacity_campaign_idx').on(t.campaignId),
  }),
);

export type BackerIdentity = typeof backerIdentities.$inferSelect;
export type ReservationDeduplication = typeof reservationDeduplication.$inferSelect;
export type DeduplicationCase = typeof deduplicationCases.$inferSelect;
export type FounderOperationalShare = typeof founderOperationalShares.$inferSelect;
export type CampaignReservationCapacity = typeof campaignReservationCapacity.$inferSelect;
