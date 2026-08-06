/**
 * The live-mode readiness gate — Spec §34, §6, §2.2, Appendix C
 * (Phase 24, migration 0038).
 *
 * Four tables, and every one of them is a record of a human judgement. That is
 * the shape of §34: eleven conditions, only three of which a program can
 * observe, and the other eight are facts about Stripe's underwriting, a
 * lawyer's review, a tax registration, a deployed origin, a reconciliation
 * somebody performed, and two people who know they are on the hook.
 *
 * ── Why every one of these is insert-only ───────────────────────────────────
 * §34's own language is "recorded as complete", and §1.3's is that manual work
 * is valid only when the app records it. A verification is an event a named
 * person made at a time, with evidence — so it is a row, the most recent row
 * per key is the current answer, and withdrawing one is a new row saying so
 * rather than a quiet erasure. This is `production_prerequisites` (0004)
 * rerun, and for the same reason: the record of why live mode was opened is
 * the record somebody will have to explain.
 *
 * ── Why the enablement is not a settings row ────────────────────────────────
 * The obvious implementation is a boolean in `app_settings`, and it is wrong
 * twice. §6 limits the first enablement to "one named pilot campaign with
 * monitoring and rollback owners", so the thing being enabled is a campaign
 * and two people rather than a mode — a boolean has nowhere to put either.
 * And a settings row is editable by design: §6's whole point is that an
 * operator changes those values. The one switch in the product that must not
 * be flipped without a rollback plan and two named humans is exactly the one
 * that should not live where flipping things is routine.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns } from './domain.js';

/* ── §34's eleven conditions ───────────────────────────────────────────────── */

/**
 * One recorded verification of one §34 condition.
 *
 * Only `recorded` conditions ever get a row — the three `automatic` ones are
 * re-decided from the environment and the records on every read, and storing
 * an answer for one would let an attestation outlive the fact it describes.
 * The service refuses an automatic key by name; the same rule the
 * prerequisites panel has applied since Phase 06a.
 */
export const liveModeConditionVerifications = pgTable(
  'live_mode_condition_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** A key from `shared/src/live-mode/index.ts`. CHECK-pinned in 0038. */
    conditionKey: text('condition_key').notNull(),

    /** `satisfied` | `not_satisfied`. CHECK-pinned. */
    status: text('status').notNull(),

    /** The named person. §34: "recorded as complete", by somebody. */
    verifiedBy: text('verified_by').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * What was checked, in enough detail that a different person can re-run
     * the same check. CHECK-required non-blank: "checked" is not a note, and
     * the first trap — a condition marked satisfied by inference — reads
     * exactly like a blank note in a filled row.
     */
    findings: text('findings').notNull(),

    /**
     * Where the evidence lives — an underwriting email, a signed policy set, a
     * tax registration certificate, a reconciliation spreadsheet. Required on
     * a `satisfied` row (CHECK): a satisfied condition with no evidence is the
     * checklist §34 says a gate is not.
     */
    evidenceReference: text('evidence_reference'),
  },
  (t) => ({
    keyIdx: index('live_mode_condition_verifications_key_idx').on(
      t.conditionKey,
      t.verifiedAt,
    ),
  }),
);

/* ── The pilot enablement (§34 condition 11, §6, §2.2) ─────────────────────── */

/**
 * The live enablement itself. At most one is live at any moment — a partial
 * unique index over a constant, so the database is what enforces §6's "one
 * named pilot campaign" rather than a service that checks first.
 *
 * The five rollback-plan columns are NOT NULL. A plan written after a problem
 * is not a plan, and the strongest available form of "written before cutover"
 * is that the enablement row cannot exist without it.
 */
export const pilotCampaignEnablements = pgTable(
  'pilot_campaign_enablements',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /** The named person who enabled it (§25.6). */
    enabledBy: text('enabled_by').notNull(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The gate as it stood at enablement, as a sentence per condition.
     *
     * Not a live read: a decision that pointed at a live gate would silently
     * change its own justification the next time a policy version moved. This
     * is 21b's completion-findings reasoning applied to the one decision in
     * the product with the largest blast radius.
     */
    gateSnapshot: text('gate_snapshot').notNull(),

    /* §34's five rollback-plan facts, one column each. */
    rollbackTriggers: text('rollback_triggers').notNull(),
    rollbackDecisionMaker: text('rollback_decision_maker').notNull(),
    rollbackMechanism: text('rollback_mechanism').notNull(),
    rollbackInFlightReservations: text('rollback_in_flight_reservations').notNull(),
    rollbackPartyCommunication: text('rollback_party_communication').notNull(),

    /* The rollback itself. Null until it happens; write-once by trigger. */
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    rolledBackBy: text('rolled_back_by'),
    rollbackReason: text('rollback_reason'),
  },
  (t) => ({
    campaignIdx: index('pilot_campaign_enablements_campaign_idx').on(t.campaignId),
  }),
);

/**
 * The two named people, as rows rather than as JSON.
 *
 * A `jsonb` blob would take any shape, and the two facts §34 asks for — that
 * they are reachable and that they know they hold it — would be conventions
 * rather than columns. One row per role per enablement, by unique index.
 */
export const pilotCampaignOwners = pgTable(
  'pilot_campaign_owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enablementId: uuid('enablement_id')
      .notNull()
      .references(() => pilotCampaignEnablements.id),

    /** `monitoring` | `rollback`. CHECK-pinned. */
    role: text('role').notNull(),

    /** §34: "Named owners means named people." */
    name: text('name').notNull(),
    /** §34: "reachable". */
    contact: text('contact').notNull(),
    /** §34: "who know they hold it" — who recorded that they do. */
    acknowledgedBy: text('acknowledged_by').notNull(),

    /**
     * A handover. The row is retired rather than edited and a new one takes
     * its place — the 0005 `campaign_invitation_sends` arrangement, with
     * UPDATE granted on this column alone. Who was on the hook when something
     * happened is not a fact to overwrite.
     */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    roleIdx: uniqueIndex('pilot_campaign_owners_role_idx')
      .on(t.enablementId, t.role)
      .where(sql`${t.supersededAt} is null`),
  }),
);

/**
 * The three things confirmed against the real world before the first live
 * reservation — the descriptor as an issuer prints it, a live webhook
 * delivery, and the monitoring owner actually seeing the risk inventory.
 *
 * Separate from the enablement because they happen after it and before the
 * first reservation, which is a real window: the pilot is enabled, and the
 * campaign is not yet allowed to take a card.
 */
export const pilotPreflightConfirmations = pgTable(
  'pilot_preflight_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enablementId: uuid('enablement_id')
      .notNull()
      .references(() => pilotCampaignEnablements.id),

    /** A key from `PILOT_PREFLIGHT_CHECKS`. CHECK-pinned. */
    checkKey: text('check_key').notNull(),

    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    /** What was observed. CHECK-required non-blank. */
    findings: text('findings').notNull(),
  },
  (t) => ({
    checkIdx: uniqueIndex('pilot_preflight_confirmations_check_idx').on(
      t.enablementId,
      t.checkKey,
    ),
  }),
);

/* ── Appendix C — the completion definition ────────────────────────────────── */

/**
 * One recorded walk of one Appendix C step.
 *
 * The phase brief is specific: verify each statement "by walking the flow, not
 * by reading the code". So the record is of a person going to a surface and
 * getting through it — and the thing being asserted is Appendix C's own
 * condition, which is that they got through without undocumented operator
 * knowledge. `undocumentedKnowledgeRequired` is the whole point of the table:
 * a walk that succeeded because the walker already knew a trick is a failed
 * walk with a passing result.
 */
export const appendixCWalkthroughs = pgTable(
  'appendix_c_walkthroughs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** `admin` | `founder` | `creator` | `backer`. CHECK-pinned. */
    actor: text('actor').notNull(),
    /** A step key from `APPENDIX_C_STATEMENTS`. */
    stepKey: text('step_key').notNull(),

    /** `passed` | `failed`. CHECK-pinned. */
    result: text('result').notNull(),

    walkedBy: text('walked_by').notNull(),
    walkedAt: timestamp('walked_at', { withTimezone: true }).notNull().defaultNow(),

    /** What the walker did and saw. CHECK-required non-blank. */
    findings: text('findings').notNull(),

    /**
     * Anything the walker had to know that is written down nowhere a user
     * would find it. Present means Appendix C's condition is unmet for this
     * step even if the walk itself succeeded, and a CHECK requires a `failed`
     * result when it is filled.
     */
    undocumentedKnowledgeRequired: text('undocumented_knowledge_required'),
  },
  (t) => ({
    stepIdx: index('appendix_c_walkthroughs_step_idx').on(t.actor, t.stepKey, t.walkedAt),
  }),
);

export type LiveModeConditionVerification =
  typeof liveModeConditionVerifications.$inferSelect;
export type PilotCampaignEnablement = typeof pilotCampaignEnablements.$inferSelect;
export type PilotCampaignOwner = typeof pilotCampaignOwners.$inferSelect;
export type PilotPreflightConfirmation = typeof pilotPreflightConfirmations.$inferSelect;
export type AppendixCWalkthrough = typeof appendixCWalkthroughs.$inferSelect;
