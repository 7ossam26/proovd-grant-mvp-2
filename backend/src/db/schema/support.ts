/**
 * Support, enforcement, and the relationship touch — §26.7, §26.8, §27.8, §29.7
 * (Phase 16b).
 *
 * Note what is *not* here: there is no `timeline_events` table. §26.8 says the
 * chronological timeline "composes existing events", and the phase trap is
 * explicit that a second event store which drifts from the first is worse than
 * no timeline. So the timeline is a read across these tables plus everything
 * Phases 03–16a already write, and it has no writer at all.
 *
 * Migration 0025 installs the guarantees.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, campaignAffiliateAssociations, reservations } from './domain.js';
import { backerIdentities } from './reservations.js';

/* ── Enums (migration 0025) ────────────────────────────────────────────────── */

export const supportCaseStatus = pgEnum('support_case_status', [
  'open',
  'awaiting_founder',
  'awaiting_customer',
  'resolved',
]);

export const supportMessageDirection = pgEnum('support_message_direction', [
  'inbound',
  'outbound',
]);

export const enforcementAction = pgEnum('enforcement_action', ['suspend', 'kill']);
export const enforcementPhase = pgEnum('enforcement_phase', ['pre_capture', 'post_capture']);

/* ── support_cases (§26.7, §27.8) ──────────────────────────────────────────── */

export const supportCases = pgTable(
  'support_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** §27.8's quotable case ID — not the UUID, which nobody reads back aloud. */
    reference: text('reference').notNull(),

    topic: text('topic').notNull(),
    owner: text('owner').notNull(),
    status: supportCaseStatus('status').notNull().default('open'),

    /** A Backer has no account (§5.4), so a Backer case anchors to the identity. */
    requesterKind: text('requester_kind').notNull(),
    backerIdentityId: uuid('backer_identity_id').references(() => backerIdentities.id),
    requesterUserId: text('requester_user_id'),
    requesterEmail: text('requester_email').notNull(),

    /** §26.8: the case carries its context so nobody is asked to repeat it. */
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    reservationId: uuid('reservation_id').references(() => reservations.id),
    associationId: uuid('association_id').references(() => campaignAffiliateAssociations.id),

    /**
     * §27.8's one-business-day promise, computed once from the committed
     * calendar and stored with the version that produced it — §29.6 applied to a
     * support promise. A trigger refuses to move either.
     */
    humanResponseDueAt: timestamp('human_response_due_at', { withTimezone: true }).notNull(),
    calendarVersion: text('calendar_version').notNull(),

    /** §27.8: an update goes out at this checkpoint even without resolution. */
    nextPromisedUpdateAt: timestamp('next_promised_update_at', { withTimezone: true }),

    /** §27.8's 48 hours. Set only while a Founder owes the response. */
    founderFollowupDueAt: timestamp('founder_followup_due_at', { withTimezone: true }),

    lastResponseAt: timestamp('last_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    /* ── The Support workspace (migration 0045) ────────────────────────────
       Everything below was added for the Admin Support surface. None of it
       changes what §27.8 promises: `human_response_due_at` and its calendar
       version are still the deadline, and the 0025 trigger still refuses to
       move them. */

    /** The one sentence a person recognises the case by. Null → render the topic. */
    subject: text('subject'),
    /** Free-text detail under the §26.7 topic. The topics themselves are fixed. */
    subcategory: text('subcategory'),
    /** Admin-only. Never rendered to a customer and never sent (§26.8). */
    internalReason: text('internal_reason'),

    /**
     * Queue order, and nothing else.
     *
     * §27.8 publishes ONE response promise — one business day, every case. A
     * triage level that shortened or lengthened it would be a commercial rule
     * the Spec does not state (§1 rule 6), so nothing reads this column when
     * computing a deadline and `TRIAGE_NEVER_CHANGES_THE_PROMISE` rides the
     * control that sets it.
     */
    triagePriority: text('triage_priority').notNull().default('normal'),

    /**
     * Who the case is blocked on right now.
     *
     * Distinct from `owner`, which is the §26.7 ORGANISATION accountable for
     * the response and what Appendix B.8 tells the customer. A case owned by
     * Proovd can truthfully be waiting on Stripe. A CHECK pins this to
     * `status` so the two can never drift.
     */
    waitingOn: text('waiting_on'),
    /** What that party owes, in words. §27.1's "what next", stated not implied. */
    nextAction: text('next_action'),

    /** The named Admin. Read from the session server-side, never from a body. */
    assigneeUserId: text('assignee_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    /** What actually fixed it, and who reached that. Both or neither (CHECK). */
    resolution: text('resolution'),
    resolvedBy: text('resolved_by'),
    /** A stamp on a resolved case — deliberately not a fifth status. */
    closedAt: timestamp('closed_at', { withTimezone: true }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('support_cases_reference_idx').on(t.reference),
    queueIdx: index('support_cases_queue_idx').on(t.status, t.humanResponseDueAt),
    campaignIdx: index('support_cases_campaign_idx').on(t.campaignId, t.createdAt),
    reservationIdx: index('support_cases_reservation_idx').on(t.reservationId),
    associationIdx: index('support_cases_association_idx').on(t.associationId),
    assigneeIdx: index('support_cases_assignee_idx').on(t.assigneeUserId, t.status),
    directoryIdx: index('support_cases_directory_idx').on(t.createdAt),
  }),
);

/* ── support_case_messages (§26.8, §33.9.11) ───────────────────────────────── */

export const supportCaseMessages = pgTable(
  'support_case_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    direction: supportMessageDirection('direction').notNull(),

    /**
     * The column §33.9.11 is really about. A raw provider or fraud code may
     * appear on an internal note — that is where it is useful — and may never
     * appear on a message a customer reads. The service refuses the second; the
     * pattern list lives in one place and is deliberately not duplicated into a
     * CHECK, because two copies of a regex list drift invisibly.
     */
    customerFacing: boolean('customer_facing').notNull(),
    body: text('body').notNull(),

    /** Which editable template it started from, when it started from one (§26.8). */
    templateKey: text('template_key'),

    author: text('author').notNull(),
    /** Confirmed after the provider call; NULL is "recorded, not confirmed". */
    notificationId: text('notification_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_messages_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── support_case_handoffs (§26.8) ─────────────────────────────────────────── */

export const supportCaseHandoffs = pgTable(
  'support_case_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),

    fromOwnerActor: text('from_owner_actor').notNull(),
    toOwnerActor: text('to_owner_actor').notNull(),

    /* §26.8's four, all NOT NULL and CHECKed non-blank. Three of four is the
       failure the rule was written to prevent — the missing one is usually what
       stops the new owner contradicting what the customer was already told. */
    verifiedFacts: text('verified_facts').notNull(),
    currentOwner: text('current_owner').notNull(),
    nextCustomerPromise: text('next_customer_promise').notNull(),
    statementsToKeepConsistent: text('statements_to_keep_consistent').notNull(),

    recordedBy: text('recorded_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_handoffs_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── support_case_assignments (§25.6, migration 0045) ──────────────────────── */

/**
 * How a case came to have the Admin it has.
 *
 * Insert-only. The reference renders "previous owner" and "reason for
 * reassignment" as two fields on the ticket; keeping them there would preserve
 * exactly one handover and overwrite it on the next. §25.6 wants the actor, the
 * reason, and the before/after preserved — which is a history table.
 *
 * Deliberately NOT `support_case_handoffs`. That one changes the accountable
 * ORGANISATION and §26.8 gates it on four facts about what the customer was
 * already told. Passing a case between two Proovd Admins promises the customer
 * nothing new, and demanding the same four sentences for routine work is how a
 * gate becomes something people type past without reading.
 */
export const supportCaseAssignments = pgTable(
  'support_case_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    fromUserId: text('from_user_id'),
    toUserId: text('to_user_id').notNull(),
    reason: text('reason'),
    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_assignments_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── support_case_evidence (§24.11's posture, migration 0045) ──────────────── */

/**
 * What the case is evidenced by.
 *
 * A REFERENCE, never a file: §12's object storage is Track A4 and
 * `unconfiguredStorage` throws, so a `storage_key` column would be a promise
 * the deployment cannot keep (§1.4). `linkedKind` is CHECKed against a register
 * rather than being free text, because evidence pointing at a typed string is
 * evidence that can point at nothing — which reads as complete inside a §24.11
 * dispute packet while proving none of it.
 */
export const supportCaseEvidence = pgTable(
  'support_case_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    linkedKind: text('linked_kind').notNull().default('none'),
    linkedReference: text('linked_reference'),
    addedBy: text('added_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_evidence_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── support_case_contacts (§26.8, §30, migration 0045) ────────────────────── */

/**
 * Coordination Proovd did outside the customer thread.
 *
 * It RECORDS; it does not send. §27 defines four support notification keys and
 * none of them is "an Admin contacted a party about a case" — inventing a fifth
 * would be §1 rule 6 applied to a message, so the control says plainly that the
 * Admin sends it themselves and records it here.
 *
 * There is no `remind_at`, no `recurrence`, and no job that reads this table.
 * §30 forbids automated engagement sequences, and `relationshipTouches` records
 * the same absence for the same reason: having nowhere to put a schedule is
 * what keeps one from appearing.
 */
export const supportCaseContacts = pgTable(
  'support_case_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    partyKind: text('party_kind').notNull(),
    partyLabel: text('party_label').notNull(),
    message: text('message').notNull(),
    /** A date somebody watches, never one anything sweeps (§30). */
    expectedResponseAt: timestamp('expected_response_at', { withTimezone: true }),
    /** The only mutable column on this table, and write-once by trigger. */
    outcome: text('outcome'),
    outcomeRecordedAt: timestamp('outcome_recorded_at', { withTimezone: true }),
    recordedBy: text('recorded_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_contacts_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── support_case_reopens (§26.8, migration 0045) ──────────────────────────── */

/**
 * The record that a resolution did not hold.
 *
 * Insert-only, and the reason is required: "reopened" with no cause is a state
 * nobody can review. The prior resolution is copied onto the row before it is
 * cleared, so reopening never destroys the answer that was given — §26.8's
 * "nothing is deleted", applied to the one operation whose whole job is to
 * undo something.
 */
export const supportCaseReopens = pgTable(
  'support_case_reopens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => supportCases.id),
    reason: text('reason').notNull(),
    priorResolution: text('prior_resolution'),
    priorResolvedAt: timestamp('prior_resolved_at', { withTimezone: true }),
    priorClosedAt: timestamp('prior_closed_at', { withTimezone: true }),
    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('support_case_reopens_case_idx').on(t.caseId, t.occurredAt),
  }),
);

/* ── campaign_enforcement_actions (§26.7, §29.7) ───────────────────────────── */

export const campaignEnforcementActions = pgTable(
  'campaign_enforcement_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    action: enforcementAction('action').notNull(),
    phase: enforcementPhase('phase').notNull(),

    /** §26.7: reason category AND free text. Both, always. */
    reasonCategory: text('reason_category').notNull(),
    reasonDetail: text('reason_detail').notNull(),

    /** §18 forbids one generic `Campaign ended`; this is what the page says. */
    customerExplanation: text('customer_explanation').notNull(),

    priorCampaignStatus: text('prior_campaign_status').notNull(),
    newCampaignStatus: text('new_campaign_status').notNull(),

    /** Which §26.7 pre-capture effects ran, and what each touched. */
    effectsApplied: jsonb('effects_applied').notNull().default(sql`'[]'::jsonb`),
    reservationsClosed: integer('reservations_closed').notNull().default(0),
    paymentMethodsDetached: integer('payment_methods_detached').notNull().default(0),

    actor: text('actor').notNull(),
    mfaContext: text('mfa_context').notNull(),
    reauthContext: text('reauth_context').notNull(),
    evidenceLinks: jsonb('evidence_links'),

    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyIdx: uniqueIndex('campaign_enforcement_idempotency_idx').on(t.idempotencyKey),
    campaignIdx: index('campaign_enforcement_campaign_idx').on(t.campaignId, t.occurredAt),
  }),
);

/* ── relationship_touches (§26.8) ──────────────────────────────────────────── */

/**
 * §26.8's first-cohort human touches.
 *
 * There is no `scheduled_for`, no `recurrence`, no `template_id`, and no job
 * anywhere that creates one. §30 forbids automated engagement and §26.8 says
 * these "must never become a scheduled sequence" — the absence of those columns
 * is the enforcement, and a test asserts they do not exist in
 * `information_schema`. One row per campaign per kind, insert-only.
 */
export const relationshipTouches = pgTable(
  'relationship_touches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    kind: text('kind').notNull(),
    /** What was actually said or done. §1.3: manual work counts when recorded. */
    note: text('note').notNull(),
    recordedBy: text('recorded_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    onceIdx: uniqueIndex('relationship_touches_once_idx').on(t.campaignId, t.kind),
  }),
);

export type SupportCase = typeof supportCases.$inferSelect;
export type SupportCaseMessage = typeof supportCaseMessages.$inferSelect;
export type SupportCaseHandoff = typeof supportCaseHandoffs.$inferSelect;
export type SupportCaseAssignment = typeof supportCaseAssignments.$inferSelect;
export type SupportCaseEvidence = typeof supportCaseEvidence.$inferSelect;
export type SupportCaseContact = typeof supportCaseContacts.$inferSelect;
export type SupportCaseReopen = typeof supportCaseReopens.$inferSelect;
export type CampaignEnforcementAction = typeof campaignEnforcementActions.$inferSelect;
export type RelationshipTouch = typeof relationshipTouches.$inferSelect;
