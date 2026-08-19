/**
 * The Creator's compact signup profile — Spec §11, §5.3, §25.4, §28.4.
 *
 * §11 lists what the one compact account-and-profile flow contains, and this
 * table is that list plus the provenance §11 requires Admin to see: "corrections
 * to prefilled fields."
 *
 * ── Prefilled, corrected, and both kept ─────────────────────────────────────
 * Every field Proovd filled in from the §8 recruitment record carries three
 * columns: the value now, who supplied it, and what Proovd originally put
 * there. That is what lets the surface say "Proovd wrote this" and keep saying
 * something truthful after the Creator has replaced it — and it is what answers
 * §11's Admin requirement without a second history table the Spec does not ask
 * for. `founder_claim_profiles` is the same shape for the same reason.
 *
 * ── Why the channel subtype is not correctable here ─────────────────────────
 * §11's "ability to correct it" attaches to "prefilled public information" —
 * the handle, the niche, the audience metric, the bio. The subtype is not
 * public information about the Creator; it is Admin's §5.3 classification, and
 * it decides which verification evidence was required and recorded. A Creator
 * flipping it from `social_creator` to `podcast_host` would silently invalidate
 * a recorded verification, so the surface shows it read-only and routes a
 * correction to support. Nothing here can change it.
 *
 * ── The five confirmations are five columns ─────────────────────────────────
 * §11 names them as one sentence and §28.4 forbids bundling: "No dark pattern,
 * preselection, or bundling of optional consent." Five booleans, each defaulting
 * false, each set by its own field. Nothing here can set more than one at a
 * time from a single flag.
 *
 * ── The payout columns, and what they honestly say today ────────────────────
 * §11 has Admin see "connected-account ID, requirements/transfer-capability/
 * payout status", and the Creator see a `Finish payout setup` action with its
 * status states. Stripe is Phase 10 (§32.1 orders signup first, deliberately),
 * so the only value these ever hold in Phase 08 is `not_started` — which is
 * true, and is exactly what the surface says. Phase 10 populates the rest. No
 * bank or identity field appears here or anywhere else in Proovd's own storage:
 * §11 forbids reproducing provider-controlled fields, and §5.3 says Proovd
 * stores "never full bank details."
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { campaignAffiliateAssociations } from './domain.js';
import { affiliateProspects } from './affiliates.js';

/**
 * Who supplied the value now in a signup field.
 *
 * Its own enum rather than §9's `field_supplier`, which is `('proovd',
 * 'founder')`. The two say different things: that one records whether a Founder
 * or Proovd wrote a vetting answer, this one whether a Creator or Proovd wrote
 * a profile field. Sharing one enum would mean `founder` was storable on a
 * Creator's row and `affiliate` on a Founder's — a vocabulary that admits values
 * it can never legally hold is a weaker constraint than two that do not.
 */
export const signupFieldSupplier = pgEnum('signup_field_supplier', ['proovd', 'affiliate']);
const fieldSupplier = signupFieldSupplier;

/**
 * The Stripe connected-account onboarding state, as Proovd is allowed to hold
 * it (§5.3: statuses and IDs, never the underlying data).
 *
 * `not_started` is the only value Phase 08 can produce. Phase 10 owns the rest,
 * and §11's "Stripe onboarding incomplete" surface reads this to say which
 * requirement is outstanding and whether the Creator has to act.
 */
export const payoutOnboardingStatus = pgEnum('payout_onboarding_status', [
  'not_started',
  'in_progress',
  'requirements_due',
  'complete',
  'restricted',
]);

export const affiliateSignupProfiles = pgTable(
  'affiliate_signup_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * One signup per prospect. §8 records one prospect per recruitment, so this
     * is one per (person, campaign) — which matches §11's rule that the Creator
     * "remains tied to the one campaign that caused the invitation."
     */
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    /** The invitation that started this signup. */
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),

    /* ── Prefilled identity (§11), each correctable ────────────────────────*/
    legalName: text('legal_name'),
    legalNamePrefilled: text('legal_name_prefilled'),
    legalNameSupplier: fieldSupplier('legal_name_supplier'),
    legalNameEditedAt: timestamp('legal_name_edited_at', { withTimezone: true }),

    publicHandle: text('public_handle'),
    publicHandlePrefilled: text('public_handle_prefilled'),
    publicHandleSupplier: fieldSupplier('public_handle_supplier'),
    publicHandleEditedAt: timestamp('public_handle_edited_at', { withTimezone: true }),

    email: text('email'),
    emailPrefilled: text('email_prefilled'),
    emailSupplier: fieldSupplier('email_supplier'),
    emailEditedAt: timestamp('email_edited_at', { withTimezone: true }),

    /** §5.3: collected, never verified. No SMS OTP path exists (§33.1.8). */
    phone: text('phone'),
    phonePrefilled: text('phone_prefilled'),
    phoneSupplier: fieldSupplier('phone_supplier'),
    phoneEditedAt: timestamp('phone_edited_at', { withTimezone: true }),

    /* ── Prefilled public channel information (§11), each correctable ──────*/
    channelReference: text('channel_reference'),
    channelReferencePrefilled: text('channel_reference_prefilled'),
    channelReferenceSupplier: fieldSupplier('channel_reference_supplier'),
    channelReferenceEditedAt: timestamp('channel_reference_edited_at', { withTimezone: true }),

    audienceNiche: text('audience_niche'),
    audienceNichePrefilled: text('audience_niche_prefilled'),
    audienceNicheSupplier: fieldSupplier('audience_niche_supplier'),
    audienceNicheEditedAt: timestamp('audience_niche_edited_at', { withTimezone: true }),

    audienceSize: text('audience_size'),
    audienceSizePrefilled: text('audience_size_prefilled'),
    audienceSizeSupplier: fieldSupplier('audience_size_supplier'),
    audienceSizeEditedAt: timestamp('audience_size_edited_at', { withTimezone: true }),

    /*
     * The Creator's OWN channel answer — Creator Flow v2, migration 0055.
     *
     * One of the nine tiles in `CREATOR_CHANNEL_TILES`, and **not**
     * `affiliate_prospects.subtype`, which is the Admin's §5.3 classification
     * and is what the recorded verification evidence was gathered against. The
     * two may disagree, and a disagreement is a fact for Admin rather than
     * something the product resolves — overwriting the classification would
     * silently invalidate a verification, which is why the subtype has rendered
     * read-only since Phase 08b (see the header above).
     *
     * It carries the full triple because the screen arrives pre-selected from
     * the Admin's subtype, and §11 requires a source label on prefilled public
     * information plus the ability to correct it.
     */
    channelType: text('channel_type'),
    channelTypePrefilled: text('channel_type_prefilled'),
    channelTypeSupplier: fieldSupplier('channel_type_supplier'),
    channelTypeEditedAt: timestamp('channel_type_edited_at', { withTimezone: true }),

    /** §8's Admin-written bio. §11 lets the Creator correct how they are described. */
    bio: text('bio'),
    bioPrefilled: text('bio_prefilled'),
    bioSupplier: fieldSupplier('bio_supplier'),
    bioEditedAt: timestamp('bio_edited_at', { withTimezone: true }),

    /* ── Never prefilled — Proovd does not learn these at recruitment ──────*/
    dateOfBirth: text('date_of_birth'),
    country: text('country'),
    stateRegion: text('state_region'),
    /** Creator Flow v2 screen 3: free-text "what you cover". */
    nicheDescription: text('niche_description'),
    /**
     * Creator Flow v2 screen 3, student-only: "how you reach your network".
     * §5.3's `student_affiliate` evidence input is literally `promotion_plan`;
     * this is the Creator's own statement of it, and the evidence record stays
     * Admin's.
     */
    outreachPlan: text('outreach_plan'),
    /**
     * Creator Flow v2 screen 5. An R2 object key, never bytes and never a URL —
     * the `campaign_assets` arrangement. R2 is unconfigured (Track A4), so this
     * is NULL for every row today and the surface renders a named absence
     * rather than a dead control.
     */
    profilePhotoKey: text('profile_photo_key'),

    /* ── §11's five confirmations, §28.4's five separate unchecked controls ─*/
    /** "at least 18" */
    confirmAge18Plus: boolean('confirm_age_18_plus').notNull().default(false),
    /** "US-based" */
    confirmUsBased: boolean('confirm_us_based').notNull().default(false),
    /** "the actual operator behind the public presence" — §5.3 forbids an agent. */
    confirmActualOperator: boolean('confirm_actual_operator').notNull().default(false),
    /** "not operating duplicate accounts" */
    confirmNoDuplicateAccounts: boolean('confirm_no_duplicate_accounts').notNull().default(false),
    /** "sanctions/OFAC eligible" */
    confirmSanctionsEligible: boolean('confirm_sanctions_eligible').notNull().default(false),

    /* ── Payout onboarding (§11). Phase 10 owns everything but the default. ─*/
    payoutStatus: payoutOnboardingStatus('payout_status').notNull().default('not_started'),
    /** Stripe's id for the connected account. An id, never the data behind it. */
    connectedAccountId: text('connected_account_id'),
    /** What Stripe says is outstanding. Rendered verbatim, never paraphrased. */
    payoutRequirements: jsonb('payout_requirements'),
    payoutStatusUpdatedAt: timestamp('payout_status_updated_at', { withTimezone: true }),

    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedUserId: text('claimed_user_id'),

    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: uniqueIndex('affiliate_signup_prospect_idx').on(t.prospectId),
    associationIdx: uniqueIndex('affiliate_signup_association_idx').on(t.associationId),
    claimedIdx: index('affiliate_signup_claimed_idx').on(t.claimedUserId),
  }),
);

export type AffiliateSignupProfile = typeof affiliateSignupProfiles.$inferSelect;
