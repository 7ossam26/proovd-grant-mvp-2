/**
 * Founder prospects, invited drafts, and invitation sends — Spec §7, §25.5,
 * §25.8, §26.1.
 *
 * ── Three tables, because they have three different lifetimes ───────────────
 * `founder_prospects`         the person Admin found off-platform. Survives to
 *                             become the Founder account on claim.
 * `campaign_drafts`           the personalised content of one invitation, and
 *                             the thing §7 deletes or anonymises after 30
 *                             calendar days without a claim.
 * `campaign_invitation_sends` append-only, one row per send or resend, holding
 *                             the nine facts §7 requires a send to store.
 *
 * A resend is a new send row, never an edit of the old one. §7: "Resend rotates
 * the token, invalidates all older versions immediately, and restarts the
 * 30-day unclaimed-draft retention period" — so the retention clock is
 * `max(sent_at)` over these rows, and a table that overwrote the previous send
 * could not answer §33.1.3 at all.
 *
 * ── Why anonymisation is columns going NULL, not rows being deleted ─────────
 * §25.8: "Unclaimed draft content: delete/anonymize 30 calendar days after most
 * recent invitation send; retain minimum audit event." The *content* goes; the
 * skeleton stays, because `audit_events` is insert-only and references these
 * ids, and an audit trail pointing at rows that no longer exist is not evidence
 * of anything. So every column carrying a person or their product is nullable
 * and gets nulled, `anonymised_at` records when, and what remains is the
 * minimum §25.8 asks for: that an invitation existed, when it was sent, by
 * whom, and that it was never claimed.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * The process summary and the no-guarantee language. §7 lists them among the
 * invitation-creation surface's contents, and Phase 06's trap is explicit:
 * Admin "must not promise acceptance, results, reward pricing, or participation
 * by a specific Creator." Storing that copy per-draft would make it editable,
 * and an editable no-guarantee clause is one an Admin can soften under pressure
 * from a Founder who wants reassurance. It is fixed template text
 * (`notifications/templates/founder-invitation.tsx`), shown in the compose
 * surface as read-only so Admin knows exactly what goes out.
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
import { campaigns } from './domain.js';

/**
 * §7's invitation lifecycle.
 *
 * `expired` covers both the passing of the token's own expiry and the retention
 * sweep; `anonymised_at` on the draft is what distinguishes them. There is no
 * `resent` state — a resend leaves the invitation `sent` and adds a send row,
 * because "resent" is a fact about a send, not about the invitation.
 *
 * Declared in `domain.ts` and re-exported here. Phase 08's Affiliate invitation
 * needs the same lifecycle on `campaign_affiliate_associations`, that table
 * lives in `domain.ts`, and `invitations.ts` already imports from it — so the
 * enum moved to the module both sides can reach. It is still §7's enum.
 */
import { invitationStatus } from './domain.js';
export { invitationStatus };

/* ── founder_prospects (§7, §25.5, §26.1) ───────────────────────────────────*/

export const founderProspects = pgTable(
  'founder_prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /* ── Recipient identity (§7). All nullable: all anonymisable. ──────────*/
    legalName: text('legal_name'),
    preferredName: text('preferred_name'),
    email: text('email'),
    /**
     * §5.2/§7: "phone if known". Collected, stored, and NEVER verified — there
     * is no SMS OTP path anywhere in this system (§33.1.8), and this column
     * exists so support can call someone, not so a code can be sent to them.
     */
    phone: text('phone'),

    /* ── The product (§7) ──────────────────────────────────────────────────*/
    productName: text('product_name'),
    productUrl: text('product_url'),

    /* ── Discovery record (§7). What Admin may record — and no more: §7
       forbids promising acceptance, results, reward pricing, or a specific
       Creator's participation, so there is no field here for any of those. */
    launchFrame: text('launch_frame'),
    usAgeFit: text('us_age_fit'),
    deliveryFeasibility: text('delivery_feasibility'),
    compensationExpectations: text('compensation_expectations'),
    affiliateSourcingHypothesis: text('affiliate_sourcing_hypothesis'),
    adminNotes: text('admin_notes'),
    discoveryEvidence: jsonb('discovery_evidence'),
    /**
     * When Proovd last spoke to this person off-platform. Discovery provenance
     * in the same sense as the notes and evidence above, and §26.8's one-time
     * relationship touches in the same posture: a recorded human contact.
     *
     * Deliberately a bare instant. There is no recurrence, no next-contact, and
     * no job that reads it — §30 forbids automated engagement sequences, and
     * having nowhere to record a cadence is what keeps this from becoming one.
     */
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),

    /* ── Provenance (§7, §26.1) ────────────────────────────────────────────*/
    invitationSource: text('invitation_source'),
    /** The named Admin who owns this campaign internally (§7). */
    internalOwner: text('internal_owner'),

    /**
     * The account this prospect became, once the draft is claimed. NULL means
     * unclaimed, which is precisely what the retention sweep looks for.
     */
    claimedUserId: text('claimed_user_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    /** Set by the retention sweep. Irreversible; the content is already gone. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('founder_prospects_email_idx').on(t.email),
    claimedIdx: index('founder_prospects_claimed_idx').on(t.claimedUserId),
  }),
);

/* ── campaign_drafts (§7) ───────────────────────────────────────────────────*/

export const campaignDrafts = pgTable(
  'campaign_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The campaign container §7 has Admin create alongside the prospect. Its
     * lifecycle status is `invited_draft` (§23.1) and lives on `campaigns` —
     * never here, because `campaigns.status` is the one lifecycle authority.
     */
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => founderProspects.id),

    /* ── The personalised content (§7). Nullable: all anonymisable. ────────*/
    /** "What Proovd understood about the product." */
    whatWeUnderstood: text('what_we_understood'),
    /** "Why the Founder was invited." */
    whyInvited: text('why_invited'),
    /** "Named Proovd sender and reply route." */
    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
    /** "Expected setup time stated honestly." */
    expectedSetupTime: text('expected_setup_time'),

    status: invitationStatus('status').notNull().default('draft'),

    /** Set by the retention sweep, in the same transaction as the revocation. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One invited draft per campaign container. */
    campaignIdx: uniqueIndex('campaign_drafts_campaign_idx').on(t.campaignId),
    prospectIdx: index('campaign_drafts_prospect_idx').on(t.prospectId),
    statusIdx: index('campaign_drafts_status_idx').on(t.status),
  }),
);

/* ── campaign_invitation_sends (§7) ─────────────────────────────────────────*/

/**
 * The nine facts §7 requires a send to store: "recipient, sender, invitation
 * source, sent time, notification ID, draft ID, token version, expiration, and
 * status."
 *
 * Append-only. UPDATE and DELETE are revoked from the application role, like
 * `audit_events` — this is the record that answers "when was the most recent
 * send", and §33.1.3 measures the retention window from it.
 */
export const campaignInvitationSends = pgTable(
  'campaign_invitation_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    draftId: uuid('draft_id')
      .notNull()
      .references(() => campaignDrafts.id),

    /** Recipient address at the moment of sending. Anonymisable. */
    recipientEmail: text('recipient_email'),
    recipientName: text('recipient_name'),

    /** The named Proovd sender (§7). Not anonymised — a Proovd staff name. */
    senderName: text('sender_name').notNull(),
    senderEmail: text('sender_email').notNull(),

    invitationSource: text('invitation_source'),

    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The provider message id, via `notification_deliveries` (§27.2).
     *
     * NULL is a state, not missing data: the row is written before the provider
     * call so that a retention clock exists for anything that might have been
     * delivered, and this is filled in once delivery is confirmed. NULL
     * therefore means "recorded, not confirmed delivered", and Admin renders it
     * as exactly that rather than implying a message arrived (§1.4).
     *
     * The only column of this row the application may write after insert
     * (migration 0006) — `sent_at` and `token_version` stay fixed, so the
     * retention clock cannot be edited.
     */
    notificationId: text('notification_id'),

    /** The token this send delivered. Its raw value is nowhere (§28.1). */
    tokenId: uuid('token_id').notNull(),
    tokenVersion: integer('token_version').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

    /** The invitation's status as a result of this send. */
    status: invitationStatus('status').notNull(),

    sentBy: text('sent_by').notNull(),
  },
  (t) => ({
    /** "The most recent send", which the retention window is measured from. */
    draftSentIdx: index('invitation_sends_draft_sent_idx').on(t.draftId, t.sentAt),
  }),
);

export type FounderProspect = typeof founderProspects.$inferSelect;
export type CampaignDraft = typeof campaignDrafts.$inferSelect;
export type CampaignInvitationSend = typeof campaignInvitationSends.$inferSelect;

/**
 * ── A note on `secure_tokens.campaign_draft_id` ─────────────────────────────
 * It is not a foreign key to `campaign_drafts.id`, and that is deliberate
 * rather than an oversight. `secure_tokens` is generic over two scopes whose
 * subjects arrive in different phases — the Backer identity behind
 * `backer_identity_id` does not exist until Phase 09 — and its scope binding is
 * already enforced by CHECK constraint (migration 0002). Adding a constraint to
 * one of the three id columns and not the others would look like an integrity
 * guarantee the table does not actually make.
 *
 * The consequence is bounded: a draft id with no draft row is a token the
 * retention sweep finds nothing to anonymise for, which is the correct outcome.
 */
