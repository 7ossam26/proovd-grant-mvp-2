/**
 * The Founder campaign workspace — Spec §12, §24.6, §25.1, §33.3.1–4.
 *
 * ── Nine tables, and the line between them ──────────────────────────────────
 * `campaign_workspace`          the autosaved written work — brand direction,
 *                               story, approvals, resume position.
 * `campaign_assets`             uploaded objects. Metadata only; the bytes live
 *                               in R2 and never touch this disk (tech-stack §9).
 * `campaign_social_profiles`    the §12 Socials item's links and their checks.
 * `founder_interview_bookings`  §12's booking record. OURS, not the vendor's.
 * `interview_booking_events`    append-only reschedule/cancel history (§12).
 * `campaign_optional_items`     one row per item per campaign: the decision.
 * `optional_item_events`        append-only. Every completion, invalidation,
 *                               correction, and override (§12 Admin).
 * `high_effort_classifications` append-only. Three inputs, result, time, actor.
 * `listing_fee_calculations`    append-only. §24.6's "base, each optional
 *                               discount, promotion, tax, total".
 *
 * The split that matters is *content* versus *decision*. A Founder edits
 * content freely; whether an item is complete is a server decision recomputed
 * from that content by `workspace/evidence.ts`. Storing "complete" as something
 * the Founder can set would defeat the whole mechanism — §12's rules exist
 * precisely because self-assertion must not earn a discount, and Phase 09's own
 * trap says so: "An item that completes because the Founder clicked 'done'
 * defeats the entire discount mechanism."
 *
 * ── Why three tables are append-only ────────────────────────────────────────
 * §12 requires Admin to see "invalidation history, and override", and §25.6
 * requires a manual override to carry prior value, new value, reason, actor,
 * time, and evidence. History that a later statement can rewrite is not
 * history. UPDATE and DELETE are revoked from the application role on all four
 * event/classification tables, exactly as they are on `audit_events` and
 * `app_setting_versions`, and `optional_item_events` is written by a TRIGGER
 * rather than by a service — a service that writes its own history is a service
 * one careless `db.update()` can bypass (the `app_setting_versions` reasoning,
 * Phase 06a; the `draft_field_edits` reasoning, Phase 07).
 *
 * ── Lockable, not locked ────────────────────────────────────────────────────
 * §12: "After payment, the calculation and evidence snapshot lock." Phase 11
 * performs the lock; this phase makes the snapshot lockable. So `locked_at`
 * exists on the decision and calculation tables and a trigger already refuses
 * to edit a locked row — nothing in this phase sets it. Building the enforcement
 * now means Phase 11 sets one timestamp rather than inventing a guard under
 * deadline.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/* ── Enums (values owned by shared/workspace; drift-tested) ───────────────── */

/**
 * The five §12 items. Mirrors `shared/src/workspace/optional-items.ts`.
 *
 * Restated rather than imported for the reason `domain.ts` documents at length:
 * `@proovd/shared` exports TypeScript source, the backend compiles under
 * `rootDir: src`, and the production image ships only `backend/dist`.
 * `src/tests/campaign-workspace.test.ts` asserts exact equality with the shared
 * array, so drift fails the suite.
 */
export const optionalItem = pgEnum('optional_item', [
  'visuals',
  'branding',
  'interview',
  'story',
  'socials',
]);

/** §12: "Each item stores evidence, completion timestamp, and decision source." */
export const decisionSource = pgEnum('decision_source', [
  'founder_approval',
  'provider_event',
  'admin_override',
]);

/** §12's four booking conditions. Only `confirmed` completes the item. */
export const interviewStatus = pgEnum('interview_status', [
  'selected',
  'confirmed',
  'canceled',
  'abandoned',
]);

/** §12: "Google Meet, Zoom, or Microsoft Teams." A closed set. */
export const meetingProvider = pgEnum('meeting_provider', [
  'google_meet',
  'zoom',
  'microsoft_teams',
]);

/** What an uploaded object is for. Decides which §12 rule evaluates it. */
export const assetPurpose = pgEnum('asset_purpose', ['visual', 'logo']);

/**
 * Where an upload is in its life.
 *
 * `pending` is created when a presigned URL is issued, before the browser has
 * PUT anything. It exists so that an abandoned upload is a visible row rather
 * than an object in a bucket with nothing pointing at it — and so that
 * `verifyUpload` has a row to move. A `pending` asset is evidence of nothing.
 */
export const uploadState = pgEnum('upload_state', ['pending', 'stored', 'rejected']);

/* ── campaign_workspace ──────────────────────────────────────────────────── */

export const campaignWorkspace = pgTable(
  'campaign_workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /* ── Branding (§12) ──────────────────────────────────────────────────────
       §12: "a usable logo/wordmark AND saved direction containing at least
       colors and typography/style guidance". Colours and typography are
       separate columns because the rule names them separately and a single
       free-text "direction" box would make "contains at least colours" a
       substring search — which a Founder passes by typing the word "colours".
       The logo is an asset row; these three are the direction. */
    brandColors: text('brand_colors'),
    brandTypography: text('brand_typography'),
    brandNotes: text('brand_notes'),
    /** §12: "and Founder-approved". The completing act for the direction. */
    brandApprovedAt: timestamp('brand_approved_at', { withTimezone: true }),
    brandApprovedBy: text('brand_approved_by'),

    /* ── Story (§12) ─────────────────────────────────────────────────────────
       One column and one approval. §12 rejects "a prompt response, transcript,
       generated summary, or unapproved draft" — none of which is a different
       *field*, they are all the same field before approval. Modelling them as
       separate columns would invite a surface that stores a transcript as
       something with standing; the honest model is that there is one story and
       it is either approved or it is not. */
    storyText: text('story_text'),
    storyApprovedAt: timestamp('story_approved_at', { withTimezone: true }),
    storyApprovedBy: text('story_approved_by'),

    /* ── Autosave and position (§12, DNA §5.9, §5.12) ────────────────────────
       §12: the workspace has "autosave, save recovery". Same vocabulary as §9's
       vetting flow, same columns. */
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),
    resumeStep: text('resume_step'),

    /** NOT NULL with no default, like `campaign_vetting.updated_by`: a write
        that does not say who made it never commits. */
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: uniqueIndex('campaign_workspace_campaign_idx').on(t.campaignId),
  }),
);

/* ── campaign_assets ─────────────────────────────────────────────────────── */

/**
 * One uploaded object, by reference.
 *
 * tech-stack §9: "Presigned PUT from the browser; no file touches the VPS
 * disk." So this table holds a key, a size, a type, and the results of the
 * checks §12 requires — never bytes, never a data URL, never a local path.
 *
 * `checksum_sha256` is what makes §12's "duplicate uploads" rule real. The
 * browser computes it before requesting a URL and the server recomputes it from
 * the stored object during verification, so a duplicate is caught on content
 * rather than on filename — two copies of the same photo named differently are
 * the case the rule is actually about.
 */
export const campaignAssets = pgTable(
  'campaign_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    purpose: assetPurpose('purpose').notNull(),

    /**
     * The R2 object key. Immutable once set, by trigger — repointing an
     * approved visual at a different object would move a Founder's approval
     * onto material they never saw.
     */
    storageKey: text('storage_key').notNull(),
    /** Which bucket the key lives in. Recorded so a later lifecycle policy is
        attributable (tech-stack §9 keeps sensitive material separate). */
    storageBucket: text('storage_bucket').notNull(),

    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'bigint' }),
    checksumSha256: text('checksum_sha256'),

    /** Read from the object's own header during verification, never trusted
        from the browser. §12's "placeholder" rule needs real dimensions. */
    width: integer('width'),
    height: integer('height'),

    state: uploadState('state').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** An `EVIDENCE_REJECTIONS` code, or null. Never free text: the surface
        owns the wording and the server owns the decision. */
    rejection: text('rejection'),

    /** §12: "Founder-approved for campaign use." The completing act. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),

    /** Removal is a Founder correction, not a delete — the row and its history
        survive so an Admin can see what was there (§12 Admin). */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_assets_campaign_idx').on(t.campaignId, t.purpose),
    storageKeyIdx: uniqueIndex('campaign_assets_storage_key_idx').on(t.storageKey),
    /** §12's duplicate rule, enforced by the database rather than by a query a
        concurrent request could race. Scoped to live rows so that removing a
        file and uploading it again is allowed — that is a correction. */
    duplicateIdx: uniqueIndex('campaign_assets_duplicate_idx')
      .on(t.campaignId, t.checksumSha256)
      .where(sql`${t.checksumSha256} IS NOT NULL AND ${t.removedAt} IS NULL`),
  }),
);

/* ── campaign_visual_links ──────────────────────────────────────────────── */

/**
 * A Founder-supplied link that helps an Admin see the product.
 *
 * It is deliberately separate from `campaign_assets`: a mutable third-party
 * URL is not a stored, byte-verified object and must never inherit an upload's
 * approval or optional-item evidence state. The Founder surface can still save
 * and remove it, and Admin projections can name it honestly as a link.
 */
export const campaignVisualLinks = pgTable(
  'campaign_visual_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    url: text('url').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_visual_links_campaign_idx').on(t.campaignId),
    liveUrlIdx: uniqueIndex('campaign_visual_links_live_url_idx')
      .on(t.campaignId, t.url)
      .where(sql`${t.removedAt} IS NULL`),
  }),
);

/* ── campaign_social_profiles ────────────────────────────────────────────── */

/**
 * §12 Socials: "at least one valid, accessible, public Founder/product social
 * profile controlled by the Founder is supplied."
 *
 * Three separable claims, so three columns: the URL is *valid* (parses), it is
 * *accessible* (something answered when we fetched it), and the Founder
 * *controls* it. The third cannot be proved from here — there is no OAuth
 * handshake in the MVP and inventing one is §1 rule 6 — so it is recorded as
 * the Founder's own confirmation, stored as exactly that, and shown to Admin as
 * a Founder statement rather than a verified fact (§1.4).
 */
export const campaignSocialProfiles = pgTable(
  'campaign_social_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    url: text('url').notNull(),
    /** Derived from the host, for display. Never authoritative. */
    platform: text('platform'),
    handle: text('handle'),

    /** The Founder's own statement. Not a verification (§1.4). */
    controlsConfirmed: boolean('controls_confirmed').notNull().default(false),

    /* The accessibility check (§12 "accessible", "inaccessible URLs"). */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    httpStatus: integer('http_status'),
    accessible: boolean('accessible'),
    /** An `EVIDENCE_REJECTIONS` code, or null. */
    rejection: text('rejection'),

    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_social_profiles_campaign_idx').on(t.campaignId),
    urlIdx: uniqueIndex('campaign_social_profiles_url_idx')
      .on(t.campaignId, t.url)
      .where(sql`${t.removedAt} IS NULL`),
  }),
);

/* ── founder_interview_bookings ──────────────────────────────────────────── */

/**
 * §12's booking record. Every field §12 names is a column here.
 *
 * tech-stack §12: "The booking record in our database is the source of truth,
 * populated from Cal.com webhooks." The vendor identifiers are nullable and
 * carry no authority — a booking confirmed by reconciliation is as real as one
 * confirmed by a webhook, which is Phase 09's own trap: "Cal.com is a source of
 * events, not truth. If the webhook is missed, the booking state must be
 * reconcilable — don't leave `confirmed` reachable only by webhook."
 *
 * ── Local time and canonical UTC are both stored ────────────────────────────
 * §12 asks for "Scheduled time and canonical UTC value" and "Timezone"
 * separately. `scheduled_at` is the canonical instant (§27.1: timestamptz,
 * stored UTC). `founder_timezone` is the zone the Founder booked in, kept
 * because a zone's offset changes across a DST boundary and re-deriving "what
 * time did they think they booked" from the instant alone would be a guess.
 */
export const founderInterviewBookings = pgTable(
  'founder_interview_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    status: interviewStatus('status').notNull().default('selected'),

    /** §12: "Scheduled time and canonical UTC value." */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** §12: "Timezone" — the Founder's, as an IANA name. */
    founderTimezone: text('founder_timezone'),

    /** §12: "Google Meet, Zoom, or Microsoft Teams" and the link. */
    meetingProvider: meetingProvider('meeting_provider'),
    meetingLink: text('meeting_link'),

    /** §12: "Interviewer." A name from the §6 `interviewers` setting. */
    interviewer: text('interviewer'),

    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    /** §12: "Cancellation." */
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    canceledBy: text('canceled_by'),
    cancellationReason: text('cancellation_reason'),

    /* The vendor's identifiers. Nullable, and never the authority. */
    externalSource: text('external_source'),
    externalBookingId: text('external_booking_id'),

    /**
     * Proovd's reference for the campaign whose embed produced this booking,
     * added Phase 09b.
     *
     * An HMAC over the campaign id, computed server-side and handed only to the
     * authenticated Founder of that campaign. It exists because the provider
     * lets the *booker* prefill metadata: a campaign id in the payload is a
     * value the Founder chose, and trusting it would let one attach a booking —
     * and the US$2 discount and high-effort input that follow — to someone
     * else's campaign. The signature proves where the payload came from, not
     * who typed what into it.
     *
     * Immutable by trigger. The binding is the security property.
     */
    proovdReference: text('proovd_reference'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('founder_interview_bookings_campaign_idx').on(t.campaignId, t.status),
    /**
     * One live booking per campaign. §12 describes one Founder interview, and
     * two simultaneously live bookings would make "the booking has `confirmed`
     * status" ambiguous — and the high-effort input with it. A canceled or
     * abandoned booking is outside the index, so rebooking after a cancellation
     * works and the old row survives as history.
     */
    liveIdx: uniqueIndex('founder_interview_bookings_live_idx')
      .on(t.campaignId)
      .where(sql`${t.status} IN ('selected','confirmed')`),
    externalIdx: uniqueIndex('founder_interview_bookings_external_idx')
      .on(t.externalSource, t.externalBookingId)
      .where(sql`${t.externalBookingId} IS NOT NULL`),
  }),
);

/* ── interview_booking_events (§12 "Reschedule history", "Cancellation") ─── */

/**
 * Append-only. §12 asks the booking record to include reschedule history, and a
 * history stored as a mutable column would be a history with one entry.
 *
 * Every row records what changed, who changed it, and where the change came
 * from — a Founder, an Admin, or a provider event. `source` is what makes a
 * reconciliation distinguishable from a webhook after the fact, which is the
 * question anyone debugging a missed Cal.com delivery will actually ask.
 */
export const interviewBookingEvents = pgTable(
  'interview_booking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => founderInterviewBookings.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** `created` | `confirmed` | `rescheduled` | `canceled` | `abandoned`. */
    event: text('event').notNull(),

    priorStatus: interviewStatus('prior_status'),
    newStatus: interviewStatus('new_status'),
    priorScheduledAt: timestamp('prior_scheduled_at', { withTimezone: true }),
    newScheduledAt: timestamp('new_scheduled_at', { withTimezone: true }),

    reason: text('reason'),
    /** `founder` | `admin` | `provider:<name>` | `system:<job>`. */
    source: text('source').notNull(),
    actor: text('actor').notNull(),

    /** §1.1: transactional notification and durable history. Set by 09b. */
    notificationId: uuid('notification_id'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index('interview_booking_events_booking_idx').on(t.bookingId, t.occurredAt),
    campaignIdx: index('interview_booking_events_campaign_idx').on(t.campaignId, t.occurredAt),
  }),
);

/* ── campaign_optional_items ─────────────────────────────────────────────── */

/**
 * The decision, one row per item per campaign.
 *
 * Nothing the Founder sends writes `complete` directly. `evaluateItems`
 * recomputes every row from the content tables and writes the result, so the
 * only way to complete an item is to satisfy §12's rule — or for an Admin to
 * record an override, which lands as `decision_source = 'admin_override'` and
 * is visible as exactly that for the rest of the campaign's life.
 *
 * `evidence` is the §12 snapshot: what the decision rested on at the moment it
 * was made. It is written on every evaluation, so a Founder who later removes a
 * visual leaves behind a record of what the discount was granted for.
 */
export const campaignOptionalItems = pgTable(
  'campaign_optional_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    item: optionalItem('item').notNull(),

    complete: boolean('complete').notNull().default(false),
    /** §12: "completion timestamp". Cleared when an item stops qualifying. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** §12: "decision source". */
    decisionSource: decisionSource('decision_source'),

    /** §12: "evidence". The snapshot the decision rested on. */
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    /** `EVIDENCE_REJECTIONS` codes. Why it is not complete, in the Founder's
        order of work. Empty when complete. */
    rejections: jsonb('rejections').notNull().default(sql`'[]'::jsonb`),

    /* ── §12: "Admin may invalidate an item before payment with a reason;
       the Founder can correct it." Invalidation is a standing flag, not an
       event: it holds the item incomplete until the Founder changes the
       content, at which point re-evaluation clears it. */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidatedReason: text('invalidated_reason'),
    /** §25.6 keeps the customer-facing wording in its own column. */
    invalidatedExplanation: text('invalidated_explanation'),
    invalidatedBy: text('invalidated_by'),

    /**
     * §12: "After payment, the calculation and evidence snapshot lock."
     *
     * Phase 11 sets this. Nothing in Phase 09 does. The trigger that refuses to
     * edit a locked row is already installed, so the lock is one timestamp
     * rather than a guard written under deadline.
     */
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignItemIdx: uniqueIndex('campaign_optional_items_campaign_item_idx').on(
      t.campaignId,
      t.item,
    ),
  }),
);

/* ── optional_item_events ────────────────────────────────────────────────── */

/**
 * Append-only history of every decision on every item. Written by TRIGGER.
 *
 * §12 Admin: "Admin sees every item, evidence, status, discount line,
 * high-effort inputs, fee preview, interview state, invalidation history, and
 * override. A manual override requires prior value, new value, reason, actor,
 * time, and evidence." Every one of those is a column.
 *
 * The trigger fires on the row changing rather than on a service call, for the
 * `app_setting_versions` reason: a history written by application code is a
 * history one careless `db.update()` skips, and the row it would skip is
 * precisely the override someone will later need to explain.
 */
export const optionalItemEvents = pgTable(
  'optional_item_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    item: optionalItem('item').notNull(),

    /** `completed` | `uncompleted` | `invalidated` | `reinstated` | `evaluated`. */
    event: text('event').notNull(),

    priorComplete: boolean('prior_complete'),
    newComplete: boolean('new_complete'),
    priorDecisionSource: decisionSource('prior_decision_source'),
    newDecisionSource: decisionSource('new_decision_source'),

    /** §25.6: internal reason and customer explanation are separate columns. */
    reason: text('reason'),
    customerExplanation: text('customer_explanation'),

    evidence: jsonb('evidence'),
    rejections: jsonb('rejections'),

    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('optional_item_events_campaign_idx').on(t.campaignId, t.occurredAt),
    itemIdx: index('optional_item_events_item_idx').on(t.campaignId, t.item, t.occurredAt),
  }),
);

/* ── high_effort_classifications ─────────────────────────────────────────── */

/**
 * §12: "Store the three inputs, result, calculation time, and actor/system."
 *
 * Append-only, one row per calculation. The current answer is the latest row,
 * mirrored onto `campaigns.high_effort` so Phase 12's compensation matrix reads
 * one column rather than a subquery — but the history is what explains why a
 * campaign is classified the way it is, and §12's list is a list of things to
 * *store*, not to overwrite.
 */
export const highEffortClassifications = pgTable(
  'high_effort_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /* The three §12 inputs, each its own column. */
    visualsCompleted: boolean('visuals_completed').notNull(),
    brandingCompleted: boolean('branding_completed').notNull(),
    interviewScheduledOrConfirmed: boolean('interview_scheduled_or_confirmed').notNull(),

    highEffort: boolean('high_effort').notNull(),

    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
    /** §12: "actor/system". e.g. `founder:<id>`, `admin:<id>`, `system:<job>`. */
    actor: text('actor').notNull(),
    /** Why this recalculation happened, e.g. `interview_canceled`. */
    trigger: text('trigger').notNull(),
  },
  (t) => ({
    campaignIdx: index('high_effort_classifications_campaign_idx').on(t.campaignId, t.calculatedAt),
  }),
);

/* ── listing_fee_calculations ────────────────────────────────────────────── */

/**
 * §24.6: "Store separately: … Base, each optional discount, promotion, tax,
 * total."
 *
 * Append-only. Each row is one calculation and carries the §6 values that were
 * in force when it ran — base, per-item discount, cap, and floor. Storing the
 * inputs beside the result is the same rule §29.6 applies to deadlines: a
 * setting an Admin changes tomorrow must not silently rewrite what a Founder
 * was quoted today.
 *
 * Tax and total are Phase 11's. §12 puts sales tax at Checkout through Stripe
 * Tax, and there is no tax column here holding a zero that would read as "no
 * tax due" — an absent number and a zero are different claims (§1.4).
 */
export const listingFeeCalculations = pgTable(
  'listing_fee_calculations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /* The §6 values in force, stored with the result. */
    baseCents: bigint('base_cents', { mode: 'bigint' }).notNull(),
    itemDiscountCents: bigint('item_discount_cents', { mode: 'bigint' }).notNull(),
    maxDiscountCents: bigint('max_discount_cents', { mode: 'bigint' }).notNull(),
    minSubtotalCents: bigint('min_subtotal_cents', { mode: 'bigint' }).notNull(),

    completedItems: integer('completed_items').notNull(),
    discountCents: bigint('discount_cents', { mode: 'bigint' }).notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'bigint' }).notNull(),

    /** §12/§24.6: each earned saving as its own labeled line. */
    discountLines: jsonb('discount_lines').notNull(),
    /** Which items were complete when this ran. The §12 evidence snapshot. */
    itemsSnapshot: jsonb('items_snapshot').notNull(),

    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    trigger: text('trigger').notNull(),

    /** Phase 11 stamps the calculation that was actually charged (§12). */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => ({
    campaignIdx: index('listing_fee_calculations_campaign_idx').on(t.campaignId, t.calculatedAt),
  }),
);

export type CampaignWorkspace = typeof campaignWorkspace.$inferSelect;
export type CampaignAsset = typeof campaignAssets.$inferSelect;
export type CampaignVisualLink = typeof campaignVisualLinks.$inferSelect;
export type CampaignSocialProfile = typeof campaignSocialProfiles.$inferSelect;
export type FounderInterviewBooking = typeof founderInterviewBookings.$inferSelect;
export type CampaignOptionalItem = typeof campaignOptionalItems.$inferSelect;
export type HighEffortClassification = typeof highEffortClassifications.$inferSelect;
export type ListingFeeCalculation = typeof listingFeeCalculations.$inferSelect;
