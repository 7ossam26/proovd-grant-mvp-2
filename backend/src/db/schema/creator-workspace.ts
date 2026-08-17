/**
 * The two person-level Affiliate records the Creator Admin workspace needed —
 * Spec §25.6, §25.8, §26.1, §26.7, §29.
 *
 * ── This is a recorded deviation, and it is worth stating where it lives ─────
 * §29 records Creator enforcement per ASSOCIATION — `affiliate_enforcement_actions`
 * is campaign-scoped, and `enforcement/standing.ts` has said since Phase 20b
 * that inventing an account-level Creator sanction would be §1 rule 6. On
 * 2026-08-11 the supplied Creator-workspace reference asked for account-level
 * suspend/restore, by product direction, exactly as the Founders reference
 * asked for `founder_access_actions`. The same answer was given.
 *
 * What that decision did NOT include, and must not acquire later without the
 * same instruction: a ban. §22.7's one-strike permanent sanction is a FOUNDER
 * record with four defined triggers; the Spec states no Creator equivalent, so
 * there is no `affiliate_ghost_bans`, no permanent value in `action`, and no
 * column here that could hold one. Suspension is a reversible standing review.
 *
 * ── Why these are not columns on the prospect ───────────────────────────────
 * Both are decisions with a reason, an actor, and a time, which is the shape
 * §25.6 already requires of every manual act. An `affiliate_prospects.suspended`
 * boolean would carry none of that, and the reason would end up in whichever
 * support case happened to be open. So the current state is derived from the
 * latest row and there is no status column anywhere — the same posture
 * `founder-workspace.ts` takes, and the same one `completion.ts` takes with the
 * cooldown.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No `deleted_at`, no purge schedule, no `approved` state on a deletion
 * request: §25.8 keeps campaign, payment, tax, support, and audit records
 * regardless of whether an account closes, so a column that implied otherwise
 * would be the first step toward a "delete everything" action the Spec does not
 * permit.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  integer,
  bigint,
} from 'drizzle-orm/pg-core';
import { affiliateProspects } from './affiliates.js';
import { campaignAffiliateAssociations } from './domain.js';
import { user } from './auth.js';

/* ── affiliate_access_actions (§26.7, §25.6) ────────────────────────────────*/

/**
 * Suspending and restoring a PERSON's Affiliate access.
 *
 * Distinct from `affiliate_enforcement_actions`, which is association-scoped
 * and does association-scoped things — pauses a tracking link, ends one
 * partnership, opens a §29 appeal window. This one concerns standing: whether
 * this person may act as a Creator at all, independent of any campaign
 * relationship they happen to hold.
 *
 * Append-only. `deriveCreatorAccountState` reads the latest row, the claim, and
 * any open §29.8 reacceptance requirement; nothing writes a status.
 */
export const affiliateAccessActions = pgTable(
  'affiliate_access_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The person. Present from recruitment, so a pre-claim suspension is legal. */
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),

    /**
     * The account, once one exists. Nullable rather than the key: an invitation
     * can be live and worth stopping before anybody has claimed it.
     */
    userId: text('user_id').references(() => user.id),

    /** `suspend` | `restore` — CHECK-pinned in 0044. There is no `ban`. */
    action: text('action').notNull(),

    /**
     * §26.7's own rule: the reason is required. A suspension whose reason lives
     * in somebody's memory is not reviewable, and §29 gives the Creator a right
     * to be told what happened.
     */
    reason: text('reason').notNull(),
    evidence: text('evidence'),

    /**
     * The two promises §27.1 makes a waiting person: who owns this, and when
     * they hear next. Recorded on a suspension, refused on a restore by CHECK —
     * a closed review that still names a next date is a promise nothing will
     * honour (§1.4). Nothing sweeps `next_review_at`; it is a commitment shown
     * on the surface, never a schedule (§30).
     */
    reviewOwner: text('review_owner'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('affiliate_access_actions_prospect_idx').on(
      t.prospectId,
      t.occurredAt.desc(),
    ),
    userIdx: index('affiliate_access_actions_user_idx').on(t.userId, t.occurredAt.desc()),
  }),
);

/* ── affiliate_deletion_requests (§25.8) ────────────────────────────────────*/

/**
 * An Affiliate asked Proovd to close their account.
 *
 * The record is of the ASK. Proovd deletes nothing here — §25.8 retains account,
 * tax, and status records for account life + 7 years, and campaign, payment,
 * support, and audit records outlive the account regardless of what anyone
 * requests. Presenting a control that implied otherwise would be §1.4's failure
 * on the one subject where being wrong is unrecoverable.
 */
export const affiliateDeletionRequests = pgTable(
  'affiliate_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    userId: text('user_id').references(() => user.id),

    /** What they asked for, in their words where we have them. */
    requestDetail: text('request_detail').notNull(),

    /**
     * How it reached us — a support case reference, an email, a call. A
     * deletion request with no provenance is one nobody can verify was made,
     * and this is a record somebody may later be asked to stand behind.
     */
    receivedVia: text('received_via').notNull(),

    /** When the Affiliate asked, which is not when an Admin got round to it. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),

    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('affiliate_deletion_requests_prospect_idx').on(
      t.prospectId,
      t.requestedAt.desc(),
    ),
  }),
);

/**
 * An Admin looked at the request and recorded what they concluded.
 *
 * Append-only rows rather than a decision column on the request, so a review
 * that changes its mind leaves both answers behind. There is exactly one
 * outcome the product offers — acknowledged, still under review — because that
 * is what §25.8 permits: retention obligations do not end because somebody
 * clicked a button.
 */
export const affiliateDeletionReviews = pgTable(
  'affiliate_deletion_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    requestId: uuid('request_id')
      .notNull()
      .references(() => affiliateDeletionRequests.id),

    note: text('note').notNull(),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('affiliate_deletion_reviews_request_idx').on(
      t.requestId,
      t.occurredAt.desc(),
    ),
  }),
);

/* ═══════════════════════════════════════════════════════════════════════════
 * The Admin Affiliate rebuild, Session A (migration 0048, 2026-08-17).
 *
 * Six record families the walked reference needs and no table held
 * (docs/phases/admin-affiliate-reconciliation.md is the walk; the migration
 * header records what is deliberately absent). Everything else the reference
 * shows composes from records that already exist and is READ, never copied.
 *
 * What 0048 refuses, restated where the schema lives:
 *   - No proposal-access column anywhere. The Standard/Restricted badge is
 *     DERIVED from §29's `restrict_bidding`/`demote` enforcement records; a
 *     stored eligibility flag is §1 rule 6, and it would be the one field a
 *     later phase could read to refuse a proposal automatically.
 *   - No schedule-shaped column, no job, no notification key (§30).
 *   - No `affiliate_history` table (§26.8's trap).
 * ═══════════════════════════════════════════════════════════════════════════*/

/* ── affiliate_evidence_files (§5.3, §8, §12) ───────────────────────────────*/

/**
 * Verification evidence files on the §5.3 research record, per reference
 * category (the four in the shared evidence-category register). The Phase 09a
 * lifecycle whole: created `pending` at presign, moved `stored`/`rejected`
 * once the server has read the object back — the BYTES decide the format, so
 * checksum, size, type, and dimensions are what inspection found and are NULL
 * until it ran (CHECK-tied to `stored`).
 *
 * Storage key and category immutable by trigger; removal one-way; duplicates
 * refused per live (prospect, checksum) by partial unique index.
 */
export const affiliateEvidenceFiles = pgTable(
  'affiliate_evidence_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    /** One of the four research categories. CHECK-pinned in 0048. */
    category: text('category').notNull(),
    /** Derived from ids and a fresh UUID at presign — never from a filename. */
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename'),
    /** `pending` | `stored` | `rejected` — the campaign_assets lifecycle. */
    state: text('state').notNull().default('pending'),
    checksumSha256: text('checksum_sha256'),
    byteSize: bigint('byte_size', { mode: 'bigint' }),
    contentType: text('content_type'),
    width: integer('width'),
    height: integer('height'),
    rejection: text('rejection'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by'),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    storageKeyIdx: uniqueIndex('affiliate_evidence_files_storage_key_idx').on(t.storageKey),
    duplicateIdx: uniqueIndex('affiliate_evidence_files_duplicate_idx')
      .on(t.prospectId, t.checksumSha256)
      .where(sql`"checksum_sha256" IS NOT NULL AND "removed_at" IS NULL`),
    prospectIdx: index('affiliate_evidence_files_prospect_idx').on(t.prospectId, t.category),
  }),
);

/* ── affiliate_evidence_verifications (§5.3, §8) ────────────────────────────*/

/**
 * Per-metric evidence decisions — audience size, engagement rate, audience
 * demographics, channel ownership, newsletter permission basis. Insert-only,
 * latest per metric wins, every answer carries its detail (the §22.3
 * early-release idiom). The evidence trail BENEATH the whole-record
 * `verification_status`, never a second answer to it.
 */
export const affiliateEvidenceVerifications = pgTable(
  'affiliate_evidence_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => affiliateProspects.id),
    /** CHECK-pinned to the five metrics in 0048. */
    metric: text('metric').notNull(),
    /** `verified` | `more_evidence_needed`. */
    decision: text('decision').notNull(),
    detail: text('detail').notNull(),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('affiliate_evidence_verifications_prospect_idx').on(
      t.prospectId,
      t.metric,
      t.decidedAt.desc(),
    ),
  }),
);

/* ── association_deliverables + evidence + decisions (§22.4 idiom) ──────────*/

/**
 * The agreed work items per campaign relationship. A deliverable RESTATES the
 * accepted agreement — `source` names the record the title came from, because
 * a work item nobody agreed to is not a deliverable.
 */
export const associationDeliverables = pgTable(
  'association_deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    title: text('title').notNull(),
    /** The agreement record this restates. */
    source: text('source').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('association_deliverables_association_idx').on(
      t.associationId,
      t.createdAt,
    ),
  }),
);

/**
 * Evidence receipts per deliverable. Insert-only; a resubmission is a NEW row
 * and the earlier one survives (§22.4's durable-receipt idiom). A reference or
 * a description — never a file; files are `affiliate_evidence_files`.
 */
export const associationDeliverableEvidence = pgTable(
  'association_deliverable_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => associationDeliverables.id),
    reference: text('reference').notNull(),
    note: text('note'),
    submittedBy: text('submitted_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deliverableIdx: index('association_deliverable_evidence_deliverable_idx').on(
      t.deliverableId,
      t.submittedAt.desc(),
    ),
  }),
);

/**
 * The decision on a deliverable. `waived` is the Founder/Admin waiver, and it
 * must carry its named recorder and reason (CHECK-tied in both directions).
 * Insert-only, latest wins; findings required on every outcome so outcome and
 * findings can never disagree.
 */
export const associationDeliverableDecisions = pgTable(
  'association_deliverable_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => associationDeliverables.id),
    /** The evidence receipt this decision read, when it read one. */
    evidenceId: uuid('evidence_id').references(() => associationDeliverableEvidence.id),
    /** `verified` | `more_evidence_needed` | `waived`. */
    outcome: text('outcome').notNull(),
    findings: text('findings').notNull(),
    waiverRecordedBy: text('waiver_recorded_by'),
    waiverReason: text('waiver_reason'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deliverableIdx: index('association_deliverable_decisions_deliverable_idx').on(
      t.deliverableId,
      t.decidedAt.desc(),
    ),
  }),
);

/* ── association_availability_verifications (§22.1, §14.2) ──────────────────*/

/**
 * Content-availability checks against the AGREED term ("Agreed campaign
 * availability period" — a term both parties accepted, not a period this
 * product made up). Stores the term it verified against, verbatim, so a later
 * agreement edit cannot rewrite what was checked. Insert-only, latest wins.
 */
export const associationAvailabilityVerifications = pgTable(
  'association_availability_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    termChecked: text('term_checked').notNull(),
    available: boolean('available').notNull(),
    detail: text('detail').notNull(),
    verifiedBy: text('verified_by').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('association_availability_verifications_association_idx').on(
      t.associationId,
      t.verifiedAt.desc(),
    ),
  }),
);

/* ── proposal_mediation_notes (§14.2) ───────────────────────────────────────*/

/**
 * What Admin told the parties during a negotiation. Admin mediates and NEVER
 * agrees — there is no acceptance column, no outcome, and nothing a later
 * phase could read as either side's answer. Insert-only.
 */
export const proposalMediationNotes = pgTable(
  'proposal_mediation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    note: text('note').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    associationIdx: index('proposal_mediation_notes_association_idx').on(
      t.associationId,
      t.createdAt.desc(),
    ),
  }),
);

/* ── association_termination_requests (§29, §24.8) ──────────────────────────*/

/**
 * A recorded ask to end an active partnership. Preserves reason, effective
 * time, §24.8 cause, and the CHECK-matrixed money treatment; DECIDES no money
 * and ends nothing itself — execution is 20a's preview-then-execute path and
 * the §23.4 machine through the enforcement routes that already own it.
 *
 * §31.6's shape: one undecided request per relationship (partial unique), the
 * ask immutable from the moment it is recorded, the decision write-once — all
 * three by trigger and index in 0048.
 */
export const associationTerminationRequests = pgTable(
  'association_termination_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    associationId: uuid('association_id')
      .notNull()
      .references(() => campaignAffiliateAssociations.id),
    reason: text('reason').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    /** One of §24.8's five causes. CHECK-pinned in 0048. */
    cause: text('cause').notNull(),
    /** CHECK-matrixed to the cause's permitted affiliate treatments. */
    moneyTreatment: text('money_treatment').notNull(),
    /** How the ask reached us — the deletion-request idiom. */
    receivedVia: text('received_via').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /** `applied` | `declined`, arriving whole with note, actor, and time. */
    decision: text('decision'),
    decisionNote: text('decision_note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    oneOpenIdx: uniqueIndex('association_termination_requests_one_open_idx')
      .on(t.associationId)
      .where(sql`"decision" IS NULL`),
    associationIdx: index('association_termination_requests_association_idx').on(
      t.associationId,
      t.requestedAt.desc(),
    ),
  }),
);
