/**
 * The Admin Founder panel's own records — migration 0059, 2026-08-22.
 *
 * Five tables, each because a control in `ProovdAdminFounder.html` needs
 * somewhere to write and no existing table would take it without lying about
 * what it holds.
 *
 * ── The offer is NOT a proposal version, and that is the whole design ───────
 * The reference lets an Admin set a Creator percentage and publish it to the
 * Founder dashboard. §14.2 keeps compensation bilateral, and
 * `routes/admin-decisions.ts` records that the ABSENT accept-route is the
 * enforcement — "Admin cannot substitute for either party's acceptance."
 *
 * So `association_admin_offers` records what an Admin proposed and nothing
 * more. It writes no `proposal_versions` row, so `proposal_party` never needs
 * an `admin` value, the two partial unique indexes from migration 0017 are
 * untouched, and no acceptance is ever attributed to an Admin. The Founder
 * still accepts through the route they already use.
 *
 * ── Basis points, not percent ──────────────────────────────────────────────
 * The reference's control is `step="0.1"`. Every percent column in the money
 * tree is an `integer`, and `shared/money` has a one-implementation rule that a
 * decimal column would quietly fork. Basis points keep integer arithmetic: 3250
 * is 32.5%.
 *
 * ── Insert-only, with two named exceptions ─────────────────────────────────
 * Migration 0059 revokes UPDATE and DELETE from the app role on the notes and
 * the edit trail, and grants UPDATE on exactly the columns that must move —
 * `superseded_at`/`withdrawn_at`/`withdrawn_reason` on an offer, `opened_at`
 * and `notification_id` on a send. A correction is a new row.
 */

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';
import { campaignAffiliateAssociations } from './domain.js';
import { founderProspects } from './invitations.js';

/* ── Internal notes (record tools → Notes) ─────────────────────────────────── */

/**
 * A Founder-scoped note stream.
 *
 * Deliberately not `founder_prospects.admin_notes`, which is ONE mutable text
 * column with no author and no timestamp. The reference renders a list of
 * `{author} · {at}` entries and an Add control, which is a different record.
 */
export const founderInternalNotes = pgTable(
  'founder_internal_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => founderProspects.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** `user:<id>` of the Admin. Resolved from the session, never the body. */
    author: text('author').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('founder_internal_notes_prospect_idx').on(t.prospectId, t.createdAt),
  }),
);

export type FounderInternalNote = typeof founderInternalNotes.$inferSelect;

/* ── Admin offer (Matching) ────────────────────────────────────────────────── */

export const associationAdminOffers = pgTable(
  'association_admin_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 10–5000. 3250 is 32.5%. CHECK-pinned in the migration. */
    offerBasisPoints: integer('offer_basis_points').notNull(),
    offeredBy: text('offered_by').notNull(),
    /** §25.6 — a recorded decision states why. */
    internalReason: text('internal_reason').notNull(),
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a revision replaces this row. A revision never edits. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnReason: text('withdrawn_reason'),
  },
  (t) => ({
    /** One live offer per association. */
    oneLive: uniqueIndex('association_admin_offers_one_live')
      .on(t.associationId)
      .where(sql`${t.supersededAt} is null and ${t.withdrawnAt} is null`),
  }),
);

export type AssociationAdminOffer = typeof associationAdminOffers.$inferSelect;

/* ── Final campaign send (Matching) ────────────────────────────────────────── */

export const associationFinalCampaignSends = pgTable(
  'association_final_campaign_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    sentBy: text('sent_by').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    notificationId: text('notification_id'),
  },
  (t) => ({
    assocIdx: index('association_final_campaign_sends_assoc_idx').on(t.associationId, t.sentAt),
  }),
);

export type AssociationFinalCampaignSend = typeof associationFinalCampaignSends.$inferSelect;

/* ── Application review (stage 3) ──────────────────────────────────────────── */

/**
 * §9 defines no application-review lifecycle state, and `campaigns.status`
 * cannot carry one: `pending_review` / `changes_required` / `approved` already
 * belong to the §15 BUILD review, a different decision later in the flow.
 *
 * So the decision gets its own round-numbered record and `campaigns.status` is
 * untouched. `Application version` on the reference reads `max(round)`.
 */
export const campaignApplicationReviews = pgTable(
  'campaign_application_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    /** One of `APPLICATION_REVIEW_OUTCOMES`. CHECK-pinned in the migration. */
    outcome: text('outcome').notNull().default('waiting'),
    reviewer: text('reviewer'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** §25.6 keeps these two apart — the second is the one a Founder may read. */
    internalReason: text('internal_reason'),
    customerExplanation: text('customer_explanation'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    round: uniqueIndex('campaign_application_reviews_round').on(t.campaignId, t.round),
  }),
);

export type CampaignApplicationReview = typeof campaignApplicationReviews.$inferSelect;

export const campaignApplicationChangeRequests = pgTable(
  'campaign_application_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => campaignApplicationReviews.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /**
     * A register key, never a free-text column name. A request against a field
     * that does not exist would look complete while pointing at nothing.
     */
    fieldKey: text('field_key').notNull(),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    oneOpen: uniqueIndex('campaign_application_change_requests_one_open')
      .on(t.reviewId, t.fieldKey)
      .where(sql`${t.resolvedAt} is null`),
  }),
);

export type CampaignApplicationChangeRequest =
  typeof campaignApplicationChangeRequests.$inferSelect;

/* ── Admin content edits (Campaign setup, Ready to launch) ─────────────────── */

/**
 * The append-only trail behind the 23 `Edit` rows and the 138 `Admin can edit`
 * fields.
 *
 * `prior_value` is written by the service that reads it UNDER LOCK inside the
 * transaction that changes it (§33.12.4) — no route accepts a prior value, so a
 * caller cannot supply a flattering pair.
 */
export const campaignAdminFieldEdits = pgTable(
  'campaign_admin_field_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** A `SETUP_FIELDS` register key. */
    fieldKey: text('field_key').notNull(),
    priorValue: text('prior_value'),
    newValue: text('new_value'),
    internalReason: text('internal_reason').notNull(),
    /** Null until §15's materiality machine classifies it. */
    materiality: text('materiality'),
    actor: text('actor').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_admin_field_edits_campaign_idx').on(t.campaignId, t.editedAt),
  }),
);

export type CampaignAdminFieldEdit = typeof campaignAdminFieldEdits.$inferSelect;
