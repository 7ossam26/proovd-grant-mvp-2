/**
 * Pre-account vetting, the possible-creator result, and the account claim —
 * Spec §9, §10, §25.5, §33.1.4–§33.1.9.
 *
 * ── Four tables, and why they are four ──────────────────────────────────────
 * `campaign_vetting`         the §9 answers, one row per campaign, autosaved.
 * `founder_claim_profiles`   the §10 account fields, autosaved before the claim
 *                            commits, so a half-filled claim survives a closed
 *                            laptop (DNA §5.12).
 * `draft_field_edits`        append-only provenance history for both of the
 *                            above, written by trigger.
 * `possible_creator_results` append-only Admin recordings of §10's relevance
 *                            signal.
 * `policy_consents`          what the Founder accepted, citing a published
 *                            policy version (§25.5, §29.8).
 *
 * ── Competition has nowhere to be prefilled ─────────────────────────────────
 * §9 says it twice — "Always blank", "Must never be prefilled or represented as
 * AI-generated" — and §33.1.5 tests it. Problem and Solution each carry three
 * prefill columns (`*_prefilled_text`, `*_prefilled_by`, `*_prefilled_at`).
 * Competition carries none. Not "unused", not "nullable": absent. A route that
 * wanted to prefill it would have to migrate a column into existence first,
 * which is a code review, not an accident.
 *
 * It still carries the supplier and the edit timestamps §9 asks every vetting
 * field to store — and a CHECK constraint pins its supplier to `founder`, so
 * even a direct SQL statement cannot record it as having come from Proovd.
 *
 * ── Provenance is `supplier of the CURRENT value` ───────────────────────────
 * §9: "Store original text, current text, supplier (`Proovd` or `Founder`), and
 * edit timestamps." So `problem_supplier` answers "who wrote what is in the box
 * right now", `problem_prefilled_text` preserves what Proovd originally
 * supplied, and `problem_first_edited_at` / `problem_last_edited_at` bound when
 * the Founder took it over. The full keystroke-level history is
 * `draft_field_edits`, written by a trigger rather than by a service — a
 * service that wrote it is a service one careless `db.update()` can bypass
 * (the same reasoning as `app_setting_versions`, Phase 06a).
 *
 * ── Everything here is anonymisable ─────────────────────────────────────────
 * A vetting record and a claim profile hold a real person's words, date of
 * birth, and phone number, and they belong to a draft that §25.8 anonymises 30
 * calendar days after the most recent send if nobody claims it. So every
 * content column is nullable and the retention sweep nulls it, exactly as it
 * already does for `campaign_drafts` — including the before/after values inside
 * `draft_field_edits`, which would otherwise be a verbatim copy of the deleted
 * text filed in an append-only table.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignType } from './domain.js';
import { campaignDrafts, founderProspects } from './invitations.js';
import { policyVersions } from './policies.js';

/**
 * §9's two suppliers. Internal values; §3's naming rule does not reach these
 * because both words are already the customer-facing ones — the surface
 * capitalises them and shows nothing else.
 */
export const fieldSupplier = pgEnum('field_supplier', ['proovd', 'founder']);

/**
 * How the Founder's email address came to be theirs (§5.2).
 *
 * §5.2: "A private invitation or Google sign-in may establish invited-email
 * ownership. A future public onboarding route requires email verification." So
 * an address that arrived on the invitation, or from Google, is owned; an
 * address the Founder typed in its place is not, and is recorded as exactly
 * that rather than being quietly treated as verified. There is no path here
 * that sets a verified state, because no verification exists yet.
 */
export const emailOwnership = pgEnum('email_ownership', [
  'invited_link',
  'google_oauth',
  'self_supplied_unverified',
  /**
   * The address was confirmed by a code we sent to it (Founder Flow v2
   * Session C, 0053 — a recorded §1 rule 6 deviation).
   *
   * The other three record how an address ARRIVED; this is the only one that
   * is evidence it is reachable NOW. Written by exactly one path, and an
   * address the Founder edits afterwards is re-derived from how the new value
   * arrived — so a verified state can never outlive the address it was
   * granted for.
   */
  'code_verified',
]);

/* ── campaign_vetting (§9) ──────────────────────────────────────────────────*/

export const campaignVetting = pgTable(
  'campaign_vetting',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * One live vetting record per campaign. A wrong locked type does not get a
     * second row here — §9 archives the campaign and begins a new one, because
     * the type is locked on `campaigns` and locking it permanently means
     * exactly that (§33.1.7).
     */
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => campaignDrafts.id),

    /* ── Step 1 — campaign path (§9) ──────────────────────────────────────*/
    /**
     * The Founder's answer, held here until submission moves it to
     * `campaigns.type` and locks it. Nullable and freely changeable until then:
     * §9 locks the type "when vetting is submitted", not when it is chosen, and
     * a flow whose first step is irreversible would be a flow the Back button
     * lies about.
     */
    selectedType: campaignType('selected_type'),
    typeChosenAt: timestamp('type_chosen_at', { withTimezone: true }),

    /* ── Step 2 — Problem (§9) ────────────────────────────────────────────*/
    problemPrefilledText: text('problem_prefilled_text'),
    problemPrefilledBy: text('problem_prefilled_by'),
    problemPrefilledAt: timestamp('problem_prefilled_at', { withTimezone: true }),
    problemText: text('problem_text'),
    problemSupplier: fieldSupplier('problem_supplier'),
    problemFirstEditedAt: timestamp('problem_first_edited_at', { withTimezone: true }),
    problemLastEditedAt: timestamp('problem_last_edited_at', { withTimezone: true }),

    /* ── Step 3 — Solution (§9) ───────────────────────────────────────────*/
    solutionPrefilledText: text('solution_prefilled_text'),
    solutionPrefilledBy: text('solution_prefilled_by'),
    solutionPrefilledAt: timestamp('solution_prefilled_at', { withTimezone: true }),
    solutionText: text('solution_text'),
    solutionSupplier: fieldSupplier('solution_supplier'),
    solutionFirstEditedAt: timestamp('solution_first_edited_at', { withTimezone: true }),
    solutionLastEditedAt: timestamp('solution_last_edited_at', { withTimezone: true }),

    /* ── Step 4 — Competition/positioning (§9) ────────────────────────────*/
    /**
     * No `competition_prefilled_*` columns exist, and none may be added. §9
     * states the rule twice and §33.1.5 tests it: this is the one field that
     * proves the Founder did their own thinking, and prefilling it destroys the
     * signal the whole vetting exists to capture.
     */
    competitionText: text('competition_text'),
    /** CHECK-pinned to `founder` in the migration. */
    competitionSupplier: fieldSupplier('competition_supplier'),
    competitionFirstEditedAt: timestamp('competition_first_edited_at', { withTimezone: true }),
    competitionLastEditedAt: timestamp('competition_last_edited_at', { withTimezone: true }),

    /* ── Step 3 (simplified flow, 2026-08-10) — Amount of views ───────────*/
    /**
     * One of the four range ids in `shared/src/vetting/steps.ts`, CHECK-pinned
     * in migration 0042. The Founder's own answer; there is no prefill path.
     */
    viewsRange: text('views_range'),

    /* ── Autosave and position (§9, DNA §5.12) ────────────────────────────*/
    /** "Returning restores the latest saved draft and says when it was saved." */
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),
    /** Where the Founder was. Position survives interruption (DNA §5.12). */
    resumeStep: text('resume_step'),

    /* ── Submission (§9 State) ────────────────────────────────────────────*/
    /** Set once. The trigger refuses to clear it or to edit answers after it. */
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    /* ── Retention (§25.8) ────────────────────────────────────────────────*/
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

    /**
     * NOT NULL with no default, like `app_settings.updated_by`: a write that
     * does not say who made it never commits, and the history trigger always
     * has an actor to record.
     */
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_vetting_campaign_idx').on(t.campaignId),
    draftIdx: uniqueIndex('campaign_vetting_draft_idx').on(t.draftId),
  }),
);

/* ── founder_claim_profiles (§10, §25.5) ───────────────────────────────────*/

/**
 * §10's account-claim fields, held before the account exists.
 *
 * "The account is prefilled from invitation/discovery and every prefilled field
 * is editable." Every value column below therefore has a matching supplier
 * column, and the prefill snapshot is frozen at creation so "what Proovd
 * supplied" survives the Founder overwriting it.
 *
 * ── There is no `phone_verified` column, anywhere ───────────────────────────
 * §5.2: "Phone is collected and explicitly unverified; no SMS OTP exists."
 * §33.1.8 scans the tree for one. `user.phone_verified` is already CHECK-pinned
 * false in migration 0002; adding a second place for the idea to live would be
 * the beginning of undoing that.
 */
export const founderClaimProfiles = pgTable(
  'founder_claim_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    draftId: uuid('draft_id')
      .notNull()
      .references(() => campaignDrafts.id),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => founderProspects.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /* ── Legal identity (§10, §25.5) ──────────────────────────────────────*/
    legalName: text('legal_name'),
    legalNameSupplier: fieldSupplier('legal_name_supplier'),
    legalNamePrefilled: text('legal_name_prefilled'),
    legalNameEditedAt: timestamp('legal_name_edited_at', { withTimezone: true }),

    preferredName: text('preferred_name'),
    preferredNameSupplier: fieldSupplier('preferred_name_supplier'),
    preferredNamePrefilled: text('preferred_name_prefilled'),
    preferredNameEditedAt: timestamp('preferred_name_edited_at', { withTimezone: true }),

    email: text('email'),
    emailSupplier: fieldSupplier('email_supplier'),
    emailPrefilled: text('email_prefilled'),
    emailEditedAt: timestamp('email_edited_at', { withTimezone: true }),
    /** Derived from how the address arrived, never asserted (§5.2). */
    emailOwnership: emailOwnership('email_ownership'),

    /** §5.2: collected, never verified. No OTP path exists (§33.1.8). */
    phone: text('phone'),
    phoneSupplier: fieldSupplier('phone_supplier'),
    phonePrefilled: text('phone_prefilled'),
    phoneEditedAt: timestamp('phone_edited_at', { withTimezone: true }),

    dateOfBirth: date('date_of_birth'),
    dateOfBirthSupplier: fieldSupplier('date_of_birth_supplier'),
    dateOfBirthEditedAt: timestamp('date_of_birth_edited_at', { withTimezone: true }),

    country: text('country'),
    countrySupplier: fieldSupplier('country_supplier'),
    countryEditedAt: timestamp('country_edited_at', { withTimezone: true }),

    stateRegion: text('state_region'),
    stateRegionSupplier: fieldSupplier('state_region_supplier'),
    stateRegionEditedAt: timestamp('state_region_edited_at', { withTimezone: true }),

    /* ── Business/entity (§10, §25.5) ─────────────────────────────────────*/
    /**
     * §10: "Business name/entity or sole-proprietor status." A sole proprietor
     * has no separate entity, so the pair is one answer with two shapes rather
     * than two independent fields to keep consistent.
     */
    soleProprietor: boolean('sole_proprietor'),
    businessName: text('business_name'),
    businessEntityType: text('business_entity_type'),
    businessSupplier: fieldSupplier('business_supplier'),
    businessEditedAt: timestamp('business_edited_at', { withTimezone: true }),

    /* ── Representations (§10, §5.2, §28.4) ───────────────────────────────*/
    /**
     * §28.4 forbids preselection and bundling: each of these is its own
     * unchecked control on the surface and its own column here, so "I confirmed
     * I am 18+" and "I confirmed I am a US person" can never be one click.
     */
    representationUsPerson: boolean('representation_us_person').notNull().default(false),
    representationAge18Plus: boolean('representation_age_18_plus').notNull().default(false),
    representationSanctions: boolean('representation_sanctions').notNull().default(false),

    /* ── Autosave and position (DNA §5.12) ────────────────────────────────*/
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),

    /** Set once, by the claim transaction. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedUserId: text('claimed_user_id'),

    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),

    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftIdx: uniqueIndex('founder_claim_profiles_draft_idx').on(t.draftId),
    campaignIdx: uniqueIndex('founder_claim_profiles_campaign_idx').on(t.campaignId),
  }),
);

/* ── draft_field_edits (§9, §1.1 version history) ──────────────────────────*/

/**
 * Every change to a provenanced field, append-only, written by trigger.
 *
 * Scoped by `draft_id` rather than by the row it came from, because that is
 * what the §25.8 sweep needs: one draft's worth of a person's words, findable
 * and nullable in one statement. `prior_value` and `new_value` are the only
 * columns the application may UPDATE, and only so the sweep can empty them —
 * `field`, `supplier`, `edited_by`, and `occurred_at` are outside every grant,
 * so the fact that an edit happened survives the text of it going.
 */
export const draftFieldEdits = pgTable(
  'draft_field_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => campaignDrafts.id),

    /** `vetting` or `claim_profile`. Which surface the field belongs to. */
    record: text('record').notNull(),
    field: text('field').notNull(),

    priorValue: text('prior_value'),
    newValue: text('new_value'),

    supplier: fieldSupplier('supplier').notNull(),
    editedBy: text('edited_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftIdx: index('draft_field_edits_draft_idx').on(t.draftId, t.occurredAt),
    fieldIdx: index('draft_field_edits_field_idx').on(t.draftId, t.record, t.field),
  }),
);

/* ── possible_creator_results (§10) ────────────────────────────────────────*/

/**
 * §10's "number of `creators who may be relevant`".
 *
 * ── Why this is a recorded assessment and not a query ───────────────────────
 * §10 is explicit that the count "is a relevance signal based on the submitted
 * information", "names no Creator", and "is not the recruited/accepted roster".
 * Campaign-specific Affiliate recruitment is §8, which is a later phase — so at
 * this point in the build there is no roster to count and inventing a formula
 * over an empty table would produce a number that means nothing. §1.4 allows a
 * manual step behind a polished surface as long as the app records it, and
 * §1.3 says manual work is valid only when it does. So a named Admin records
 * the count and the basis for it, and this table is that record.
 *
 * Append-only, latest by `recorded_at`. A revision is a new row, so the Founder
 * being shown a different number later is always explainable.
 *
 * Zero is a legal value and is not a failure of this table. §10: "For the
 * pre-screened invited cohort, the result must not be zero; a zero result
 * routes to Admin before the Founder proceeds." Zero is recordable precisely
 * so that routing can happen — what must never happen is zero rendering to the
 * Founder as a result.
 */
export const possibleCreatorResults = pgTable(
  'possible_creator_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** CHECK >= 0 in the migration. */
    count: integer('count').notNull(),
    /** What the count rests on. Required: a number with no basis is a guess. */
    basis: text('basis').notNull(),

    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The first time the Founder was actually shown this result (§31.9).
     *
     * `recorded_at` is when an Admin recorded the §10 assessment; §31.9 asks
     * for "possible-creator rendering", and the gap between the two is the wait
     * the metric exists to measure. The only column on this insert-only table
     * the app may write, granted by name in 0037, and write-once by trigger.
     */
    firstRenderedAt: timestamp('first_rendered_at', { withTimezone: true }),
  },
  (t) => ({
    campaignIdx: index('possible_creator_results_campaign_idx').on(t.campaignId, t.recordedAt),
  }),
);

/* ── policy_consents (§10, §25.5, §29.8, §31.4) ────────────────────────────*/

/**
 * What a person accepted, and exactly which version of it.
 *
 * §29.8's reacceptance flow compares a stored consent against the current
 * version, so a consent that did not cite a version would be unusable for the
 * only thing consents are for. The foreign key is to `policy_versions`, whose
 * identity is immutable by trigger (migration 0003) — so the row this cites
 * cannot be edited into meaning something else.
 *
 * A consent may cite only a PUBLISHED version. That is a CHECK-backed trigger
 * in the migration rather than a service rule, because the failure mode is
 * silent: a draft document is text that has not been agreed by Proovd's own
 * lawyers, and a signature on it records agreement to nothing.
 */
export const policyConsents = pgTable(
  'policy_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** `user` today. Backers have no account and consent per reservation. */
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),

    policyVersionId: uuid('policy_version_id')
      .notNull()
      .references(() => policyVersions.id),
    /** Denormalised for readability in support transcripts; never authoritative. */
    slug: text('slug').notNull(),
    version: text('version').notNull(),

    /** Where the acceptance happened, e.g. `founder_account_claim` (§10). */
    acceptedVia: text('accepted_via').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('policy_consents_subject_idx').on(t.subjectType, t.subjectId),
    /** One acceptance of one version by one subject. A retry is not a second. */
    dedupIdx: uniqueIndex('policy_consents_dedup_idx').on(
      t.subjectType,
      t.subjectId,
      t.policyVersionId,
    ),
  }),
);

export type CampaignVetting = typeof campaignVetting.$inferSelect;
export type FounderClaimProfile = typeof founderClaimProfiles.$inferSelect;
export type DraftFieldEdit = typeof draftFieldEdits.$inferSelect;
export type PossibleCreatorResult = typeof possibleCreatorResults.$inferSelect;
export type PolicyConsent = typeof policyConsents.$inferSelect;
