/**
 * Creator Flow v2's record families — migration 0055, 2026-08-19.
 *
 * `docs/phases/creator-flow-v2.md` is the brief. Session A builds the record
 * and no surface, so nothing in this file is read by a route yet; the migration
 * header carries the full reasoning for each table and is the thing to read
 * before changing one.
 *
 * Three of these exist because product direction authorised a §1 rule 6
 * deviation, and each is narrowed by **what its table cannot hold**:
 *
 *   * `affiliate_standing_snapshots` — no rate, floor, percentage, multiplier,
 *     or eligibility column, so the tier cannot become the stored
 *     `proposal_access` that §29.4's enforcement action already derives.
 *   * `affiliate_referrals` — no amount, percentage, or commission column, so
 *     the reference's "earn a percentage of their campaigns" has nowhere to go.
 *     §24 has four money streams and that would be a fifth.
 *   * `creator_resource_interest` — no asset, URL, file, or campaign column, so
 *     it cannot become the §31.5 Campaign kit and §14.1's "all material lives
 *     in one Campaign kit" stays true.
 *
 * One closes a §5.3 right the product has never implemented: after the claim,
 * `saveSignupProfile` refuses and no session-authenticated Creator route writes
 * the profile at all — so `requestAffiliateCorrection` has been asking Creators
 * to correct something they had no route to correct.
 *
 * The delete-account request §5.3 names in the same sentence needs no table
 * here: 0044's `affiliate_deletion_requests` is already the right shape, and
 * what it lacks is a Creator-facing route. Session F adds one that writes that
 * record with `received_via = CREATOR_DELETION_RECEIVED_VIA`. A second table
 * would have been the duplicate this codebase refuses everywhere else.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { affiliateProspects } from './affiliates.js';
import { affiliateSignupProfiles } from './affiliate-signup.js';

/**
 * The Creator's recorded tone (§11, §12, §30).
 *
 * The reference asks it as "a tone we should write your scripts in", which is
 * refused — §30 defers AI rewriting and §12 makes the helpers static. The field
 * survives because the answer is what a Founder reads on the §11 public card.
 * It is SHOWN and is never an input to generation.
 *
 * One live set per profile; a change supersedes rather than edits, because
 * which answer was live when a Founder looked is a question somebody may have
 * to answer.
 */
export const affiliateVoiceTones = pgTable(
  'affiliate_voice_tones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => affiliateSignupProfiles.id),
    /** Ids from `CREATOR_VOICE_TONES`. The SET chosen at one moment. */
    tones: text('tones')
      .array()
      .notNull()
      .default(sql`'{}'`),
    customTones: text('custom_tones')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Its own column, not a seventh tone: it modifies the other answers. */
    flexible: boolean('flexible').notNull().default(false),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    liveIdx: uniqueIndex('affiliate_voice_one_live_idx')
      .on(t.profileId)
      .where(sql`"superseded_at" IS NULL`),
  }),
);

export type AffiliateVoiceToneSet = typeof affiliateVoiceTones.$inferSelect;

/**
 * The per-channel metrics (§5.3, §8).
 *
 * `metric_id` is CHECK-pinned to the nine evidence ids
 * `AFFILIATE_SUBTYPE_DEFINITIONS` already names — one register, not two, so a
 * Creator answers the same question an Admin verifies against.
 *
 * The value is TEXT deliberately: "about 40k" is a real answer, and a numeric
 * column would push somebody to type a figure they do not have. §8's
 * verification is Admin's judgement over evidence, not arithmetic.
 */
export const affiliateChannelMetrics = pgTable(
  'affiliate_channel_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => affiliateSignupProfiles.id),
    metricId: text('metric_id').notNull(),
    value: text('value').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    liveIdx: uniqueIndex('affiliate_channel_metric_one_live_idx')
      .on(t.profileId, t.metricId)
      .where(sql`"superseded_at" IS NULL`),
  }),
);

export type AffiliateChannelMetric = typeof affiliateChannelMetrics.$inferSelect;

/**
 * The standing snapshot — **deviation 2**.
 *
 * Keyed on the PERSON, across every campaign, which is also why it can never be
 * read as a per-campaign eligibility input. Insert-only with no UPDATE grant at
 * all: a recomputation is a new row, and an editable score is one somebody can
 * move without the inputs moving.
 *
 * `percentile` is nullable because §16a's rule holds here — a brand-new Creator
 * is not in the bottom percentile, there is simply nothing to compare them
 * against, and those are different facts.
 */
export const affiliateStandingSnapshots = pgTable(
  'affiliate_standing_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    score: integer('score').notNull(),
    tier: text('tier').notNull(),
    percentile: integer('percentile'),
    /** The counts that produced the score, keyed by `CREATOR_STANDING_INPUTS`. */
    inputs: jsonb('inputs').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('affiliate_standing_prospect_idx').on(t.prospectId, t.computedAt),
  }),
);

export type AffiliateStandingSnapshot = typeof affiliateStandingSnapshots.$inferSelect;

/**
 * The referral — **deviation 3**.
 *
 * An introduction, not a signup route: no account, no prospect row, no
 * association, no token scope, and no public join address. **No amount,
 * percentage, or commission column** — that absence is the whole of the
 * refusal, and a test asserts the exact column set.
 *
 * There is deliberately no `accepted`/`joined` state: whether the person was
 * eventually recruited is §8's record, and reporting it back would tell a
 * Creator about somebody else's admission decision.
 */
export const affiliateReferrals = pgTable(
  'affiliate_referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referrerProspectId: uuid('referrer_prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    referredName: text('referred_name').notNull(),
    referredContact: text('referred_contact').notNull(),
    relationship: text('relationship').notNull(),
    why: text('why').notNull(),
    note: text('note'),
    state: text('state').notNull().default('recorded'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => ({
    referrerIdx: index('affiliate_referral_referrer_idx').on(t.referrerProspectId, t.recordedAt),
  }),
);

export type AffiliateReferral = typeof affiliateReferrals.$inferSelect;

/**
 * Resource interest — **deviation 4**.
 *
 * A resource key, a subject, a timestamp. **No asset column, no URL column, no
 * file column, no campaign id** — that is what keeps §14.1's "all material
 * lives in one Campaign kit" true, and it is asserted in `information_schema`
 * rather than left to review.
 *
 * Asking twice is the same fact, so the unique index makes a repeat a no-op
 * rather than rows that would later read as demand.
 */
export const creatorResourceInterest = pgTable(
  'creator_resource_interest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    resourceId: text('resource_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    onceIdx: uniqueIndex('creator_resource_interest_once_idx').on(t.prospectId, t.resourceId),
  }),
);

export type CreatorResourceInterest = typeof creatorResourceInterest.$inferSelect;

/**
 * The post-claim profile correction (§5.3, §11, §25.6, §33.12.4).
 *
 * **Not a deviation — §5.3 as written.** This is the record behind the settings
 * write, and it is not a relaxation of `saveSignupProfile`'s post-claim
 * refusal: that refusal is load-bearing for the onboarding screens and stays.
 *
 * `priorValue` is NOT NULL and a genuinely absent prior is JSON `null`, never
 * SQL NULL — 16a's distinction, because SQL NULL here would mean "no before was
 * recorded", which is the state the column exists to forbid. It is read from
 * the row `FOR UPDATE` inside the transaction that changes it (§33.12.4).
 *
 * No UPDATE grant: a prior value that can be rewritten afterwards is worthless.
 */
export const affiliateProfileCorrections = pgTable(
  'affiliate_profile_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => affiliateSignupProfiles.id),
    /** A field id from the settings register — never a free-text column name. */
    fieldId: text('field_id').notNull(),
    priorValue: jsonb('prior_value').notNull(),
    newValue: jsonb('new_value').notNull(),
    reason: text('reason').notNull(),
    correctedByUserId: text('corrected_by_user_id').notNull(),
    correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    profileIdx: index('affiliate_correction_profile_idx').on(t.profileId, t.correctedAt),
  }),
);

export type AffiliateProfileCorrection = typeof affiliateProfileCorrections.$inferSelect;
