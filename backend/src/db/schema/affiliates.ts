/**
 * Affiliate prospects, their campaign association, and the private invitation —
 * Spec §8, §5.3, §23.4, §25.4, §2.2.
 *
 * ── Three tables, mirroring the Founder side for the same reasons ───────────
 * `affiliate_prospects`          the person Admin recruited off-platform, and
 *                                the nineteen facts §8 requires recorded about
 *                                them. Survives to become the Affiliate account.
 * `affiliate_invitation_sends`   append-only, one row per send or resend,
 *                                carrying the same facts §7 requires of a
 *                                Founder send.
 * The association itself already exists — `campaign_affiliate_associations`
 * from Phase 03 — and this migration adds §25.4's per-campaign columns to it
 * rather than creating a second association table beside it. §23.4 is explicit
 * that the association carries the state; adding a parallel table would give
 * the same relationship two rows and eventually two different statuses.
 *
 * ── Why a prospect is not per-campaign, and the association is ──────────────
 * §11: "The Affiliate remains tied to the one campaign that caused the
 * invitation." §2.2 then allows up to three *active* partnerships, and §25.4
 * splits its own record the same way — an "Affiliate account" section and a
 * "Per campaign" section. So the person is one row and each campaign they are
 * recruited to is one association row. One prospect, many associations, and the
 * invitation is sent against the association, not against the person: a second
 * campaign means a second invitation, not a reuse of the first.
 *
 * ── The quality tier is text, and that is the enforcement ───────────────────
 * §8: "Internal quality tier, used only as assessment data—not as a commission
 * floor." Stored as free text with no enum and no numeric type, so there is
 * nothing here to sort by or multiply. A ranked column would make §8's rule a
 * convention that survives only as long as everyone remembers it; a text column
 * makes it a property of the schema. See `shared/src/affiliates/recruitment.ts`.
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 * Any compensation column. §12 and §14.3 own the compensation matrix and it
 * lands in Phase 12; §8's phase does not set a rate, and a `base_percentage`
 * sitting empty on a recruitment record would be read by the next phase as a
 * decision someone forgot to make. Also absent: anything a Backer supplies.
 * §8's trap — "Affiliates never receive Backer PII" — is enforced at the query
 * layer, and starting with no column to join to is the cheapest version of it.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations, invitationStatus } from './domain.js';

/**
 * §5.3's seven subtypes. Mirrors shared `AFFILIATE_SUBTYPES`; drift-tested in
 * `src/tests/affiliate-recruitment.test.ts` the same way the state enums are.
 * The backend cannot import the shared source at runtime (rootDir), so the list
 * is restated and the test is what keeps the two honest.
 */
export const affiliateSubtype = pgEnum('affiliate_subtype', [
  'social_creator',
  'newsletter_blog_operator',
  'podcast_host',
  'community_owner',
  'course_instructor',
  'student_affiliate',
  'niche_marketer',
]);

/** §8's verification status. Mirrors shared `VERIFICATION_STATUSES`. */
export const verificationStatus = pgEnum('affiliate_verification_status', [
  'unverified',
  'in_review',
  'verified',
  'rejected',
]);

/* ── affiliate_prospects (§8, §5.3, §25.4) ──────────────────────────────────*/

export const affiliateProspects = pgTable(
  'affiliate_prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /* ── Identity (§8, §5.3) ───────────────────────────────────────────────
       §5.3: the operator "personally creates or claims the invited account…
       an agency or manager cannot accept for the actual operator." The legal
       name is who must claim it; the handle is who the audience knows, and is
       the only one of the two the Founder ever sees (§11). */
    legalName: text('legal_name'),
    publicHandle: text('public_handle'),
    email: text('email'),
    /** §5.3: collected, never verified. No SMS OTP path exists (§33.1.8). */
    phone: text('phone'),

    /* ── Channel (§8, §5.3) ────────────────────────────────────────────────*/
    subtype: affiliateSubtype('subtype'),
    /** §8: "Primary URL, handle, newsletter, podcast, community, course,
        network, or owned-distribution reference." One field: which of those it
        is, is what `subtype` already says. */
    channelReference: text('channel_reference'),
    audienceNiche: text('audience_niche'),
    /** §8: why THIS campaign fits THIS channel. */
    campaignFit: text('campaign_fit'),
    /** §8: "Audience size/access metric." Text, because the unit differs per
        subtype (followers, subscribers, members, enrolled students) and a
        bare integer would lose which one it is. */
    audienceSize: text('audience_size'),
    /**
     * §8's evidence, keyed by the §5.3 evidence input ids for this subtype.
     * JSONB rather than columns because the required set is subtype-specific:
     * seven subtypes with different inputs would otherwise be ~25 mostly-null
     * columns, and adding one would be a migration rather than a register edit.
     */
    engagementEvidence: jsonb('engagement_evidence'),
    audienceDemographics: text('audience_demographics'),
    /** §8: whether they are entitled to promote on this channel at all. */
    permissionBasis: text('permission_basis'),
    priorSponsoredContent: text('prior_sponsored_content'),

    /* ── Assessment (§8) ───────────────────────────────────────────────────*/
    /** §8: "Admin-written bio." Prefills signup; §11 lets them correct it. */
    adminBio: text('admin_bio'),
    /**
     * §8: "Internal quality tier, used only as assessment data—not as a
     * commission floor."
     *
     * TEXT, deliberately. Not an enum, not an integer, not a rank. There is
     * nothing in this column to compare, so it cannot become a floor — see the
     * file header. If a later phase wants to order by it, that is the §1 rule 6
     * violation the type is here to make visible.
     */
    qualityTier: text('quality_tier'),
    verificationStatus: verificationStatus('verification_status').notNull().default('unverified'),
    verificationEvidence: jsonb('verification_evidence'),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    /* ── Risk (§8) ─────────────────────────────────────────────────────────*/
    conflictNotes: text('conflict_notes'),
    sanctionsNotes: text('sanctions_notes'),
    internalComments: text('internal_comments'),

    /* ── Provenance (§8, §25.4) ────────────────────────────────────────────*/
    recruitmentSource: text('recruitment_source'),
    /** §8: the named recruiting Admin. §1.3: manual work counts when recorded. */
    recruitingAdmin: text('recruiting_admin'),

    /**
     * The account this prospect became, once an invitation is claimed. NULL is
     * what "not yet signed up" means, and Phase 08b's claim sets it.
     */
    claimedUserId: text('claimed_user_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('affiliate_prospects_email_idx').on(t.email),
    claimedIdx: index('affiliate_prospects_claimed_idx').on(t.claimedUserId),
    subtypeIdx: index('affiliate_prospects_subtype_idx').on(t.subtype),
  }),
);

/* ── affiliate_invitation_sends (§8, §7's shape) ────────────────────────────*/

/**
 * One row per send or resend of the private campaign-specific invitation.
 *
 * §8: "Admin can send, resend, or revoke one private campaign-specific signup
 * invitation." Append-only, like `campaign_invitation_sends` — and for the same
 * reason: a resend rotates the token and invalidates the previous one, and a
 * table that overwrote the previous send could not show the full invitation
 * history §11 requires Admin to see.
 *
 * Keyed on the ASSOCIATION, not the prospect. One Creator recruited to two
 * campaigns has two invitations, each scoped to its own campaign — §11: "The
 * Affiliate remains tied to the one campaign that caused the invitation."
 */
export const affiliateInvitationSends = pgTable(
  'affiliate_invitation_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    recipientEmail: text('recipient_email'),
    recipientName: text('recipient_name'),

    senderName: text('sender_name').notNull(),
    senderEmail: text('sender_email').notNull(),

    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The provider message id, via `notification_deliveries` (§27.2).
     * NULL is a state — "recorded, not confirmed delivered" — for exactly the
     * reason the Founder send row documents: the row lands before the provider
     * call so nothing can be delivered without a record of it. The only column
     * the application may write after insert.
     */
    notificationId: text('notification_id'),

    /** The token this send delivered. Its raw value is nowhere (§28.1). */
    tokenId: uuid('token_id').notNull(),
    tokenVersion: integer('token_version').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

    status: invitationStatus('status').notNull(),

    sentBy: text('sent_by').notNull(),
  },
  (t) => ({
    associationSentIdx: index('affiliate_sends_association_sent_idx').on(t.associationId, t.sentAt),
    prospectIdx: index('affiliate_sends_prospect_idx').on(t.prospectId),
  }),
);

/* ── campaign_kit_access (§10, §31.5) ───────────────────────────────────────*/

/**
 * Every read of the preparing Campaign kit.
 *
 * §10: "Every access is logged." §31.5 makes that one of four conditions the
 * pilot pre-view exception depends on — private, authenticated, logged,
 * revocable — so this table is not telemetry, it is the evidence that the
 * exception was operated as described. Insert-only, like `audit_events`: a log
 * a later statement could edit is not evidence of anything.
 *
 * It records who opened what and when, and deliberately nothing about the
 * content. The kit is the Founder's confidential material; copying any of it
 * into an insert-only row would put a second copy somewhere no revocation
 * could ever reach.
 */
export const campaignKitAccess = pgTable(
  'campaign_kit_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    /** The signed-in Creator. §10's handoff is to an *authenticated* Affiliate. */
    affiliateUserId: text('affiliate_user_id').notNull(),
    /** Which part was opened — the campaign information, or the kit itself. */
    section: text('section').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('campaign_kit_access_association_idx').on(t.associationId, t.occurredAt),
    campaignIdx: index('campaign_kit_access_campaign_idx').on(t.campaignId, t.occurredAt),
  }),
);

export type AffiliateProspect = typeof affiliateProspects.$inferSelect;
export type AffiliateInvitationSend = typeof affiliateInvitationSends.$inferSelect;
export type CampaignKitAccess = typeof campaignKitAccess.$inferSelect;

/**
 * ── A note on the columns this migration adds to an existing table ──────────
 * `campaign_affiliate_associations` gains §25.4's per-campaign recruitment
 * facts — prospect id, recruitment source/Admin/timing, invitation status — and
 * they are declared in `domain.ts` beside the columns Phase 03 created, not
 * re-declared here. Drizzle needs one definition per table, and splitting a
 * table across two schema files is how two halves of it drift.
 */
