/**
 * Global configuration and production prerequisites — Spec §6.
 *
 * Three tables, one per question §6 asks.
 *
 *  `app_settings`            what every operating constant is set to right now.
 *  `app_setting_versions`    what it was set to before, by whom, and why.
 *  `production_prerequisites` which §6 readiness items have been verified.
 *
 * ── Why the value column is text ────────────────────────────────────────────
 * One column, one type, so a history row can compare a prior value against a
 * new one without knowing which setting it belongs to. `kind` says how to read
 * it back and `shared/src/settings/registry.ts` owns the parser. Money values
 * are integer cents written as digits — never a decimal dollar amount, here or
 * anywhere (§24, tech-stack §4.1).
 *
 * ── Why history is a trigger and not a service call ─────────────────────────
 * §25.6 requires prior and new value, actor, reason, and time on every
 * high-impact change, and a settings change *is* a commercial-rule change —
 * this is the table the listing fee, the platform fee, and every deadline in
 * the system are read from. A service that writes the history row is a service
 * one careless `db.update()` can bypass. The trigger cannot be bypassed, and
 * because `updated_by` and `update_reason` are NOT NULL it has everything it
 * needs. An update that does not say who and why does not commit at all.
 *
 * The corresponding audit_events row is still written by the service: §25.6
 * wants the actor's MFA and reauthentication context, and the database does not
 * have it. The two records agree because both are written in one transaction.
 *
 * ── Why the row carries its own bounds and §6 citation ──────────────────────
 * `shared/src/settings/registry.ts` is the register, but the backend cannot
 * import it at runtime: `@proovd/shared` exports TypeScript source, the backend
 * compiles under `rootDir: src`, and the production image ships only
 * `backend/dist`. This is the same constraint `db/schema/domain.ts` documents
 * for the state enums and `policies/policy-gate.ts` for the required slugs, and
 * the repository's answer is the same one — restate the data where it is
 * needed, and fail the suite on drift.
 *
 * So `kind`, `provenance`, `minimum`, `maximum`, and `spec_ref` live on the
 * row. Validation reads them from the row it is validating, which means the
 * server needs no copy of the register at all. `src/tests/admin-settings.test.ts`
 * compares every column against the shared register; the test file can import
 * it, because Vitest resolves the workspace source directly.
 *
 * The labels, help text, and grouping are NOT mirrored. Those are presentation,
 * the frontend imports the register directly through Vite, and copying prose
 * into a database is how two versions of one sentence start disagreeing.
 *
 * ── Why prerequisites are insert-only rows and not a status column ──────────
 * §34's language is "recorded as complete", and §1.3's is "manual work is valid
 * only when the app records it". An attestation is an event a named person made
 * at a time with evidence, so each one is a row. The most recent row per key is
 * the current answer; nothing is ever edited or deleted, so withdrawing an
 * attestation is a new row rather than a quiet erasure.
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

/** Mirrors shared `SettingKind`. Drift-tested. */
export const settingKind = pgEnum('setting_kind', [
  'money_cents',
  'percent',
  'count',
  'calendar_days',
  'business_days',
  'hours',
  'seconds',
  'months',
  'boolean',
  'text_list',
  'text',
]);

/** Mirrors shared `SettingProvenance`. Drift-tested. */
export const settingProvenance = pgEnum('setting_provenance', [
  'specified',
  'operator',
  'derived',
]);

/* ── app_settings ───────────────────────────────────────────────────────────*/

export const appSettings = pgTable(
  'app_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Stable identity from the shared register. Immutable, by trigger. */
    key: text('key').notNull(),

    /**
     * The current value, serialised. NULL exactly while an `operator` setting
     * has never been stated — §6 names those and fixes no number, so they seed
     * empty and block. NULL is therefore a meaningful state, not missing data.
     */
    value: text('value'),

    kind: settingKind('kind').notNull(),
    provenance: settingProvenance('provenance').notNull(),

    /**
     * Inclusive bounds for numeric kinds, mirrored from the register so
     * validation needs no copy of it. `minimum` is where §6 states a floor in
     * words rather than as the value — "at least three months" — and the
     * operator may go above it but never below.
     */
    minimum: integer('minimum'),
    maximum: integer('maximum'),

    /** The §6 line this implements, quoted back in a refusal message. */
    specRef: text('spec_ref').notNull(),

    /** Monotonic. The trigger increments it; nothing else may set it. */
    version: integer('version').notNull().default(1),

    /**
     * §25.6 actor and reason, NOT NULL so the history trigger always has them.
     * An update that omits either fails — which is the point.
     */
    updatedBy: text('updated_by').notNull(),
    updateReason: text('update_reason').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: uniqueIndex('app_settings_key_idx').on(t.key),
  }),
);

/* ── app_setting_versions ───────────────────────────────────────────────────*/

/**
 * Append-only. UPDATE and DELETE are revoked from the application role in the
 * migration, the same way `audit_events` is — a settings history that can be
 * rewritten answers no question worth asking.
 */
export const appSettingVersions = pgTable(
  'app_setting_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    priorValue: text('prior_value'),
    newValue: text('new_value'),
    changedBy: text('changed_by').notNull(),
    reason: text('reason').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('app_setting_versions_key_idx').on(t.key, t.version),
    /** One row per (key, version) — a second one would mean a lost change. */
    identityIdx: uniqueIndex('app_setting_versions_identity_idx').on(t.key, t.version),
  }),
);

/* ── production_prerequisites ───────────────────────────────────────────────*/

/**
 * `satisfied` and `not_satisfied` only. There is no `partially`, no `waived`,
 * and no `pending` — §6 says incomplete prerequisites fail closed, and a third
 * state is how "fail closed" becomes "warn and proceed".
 */
export const prerequisiteStatus = pgEnum('prerequisite_status', [
  'satisfied',
  'not_satisfied',
]);

export const productionPrerequisites = pgTable(
  'production_prerequisites',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * A §6 prerequisite key. The register that defined them
     * (`backend/src/admin/prerequisites.ts`) and the `/admin/prerequisites`
     * surface were both removed; the recorded attestations are kept because
     * §25.6 makes this table insert-only, and nothing reads them today.
     */
    prerequisiteKey: text('prerequisite_key').notNull(),
    status: prerequisiteStatus('status').notNull(),

    /** The named person who verified it (§34: "recorded as complete"). */
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    /** What was checked, in enough detail for someone else to re-check it. */
    note: text('note').notNull(),
    /** Links to the evidence — a test run, a provider dashboard, a document. */
    evidenceLinks: jsonb('evidence_links'),
  },
  (t) => ({
    keyIdx: index('production_prerequisites_key_idx').on(t.prerequisiteKey, t.recordedAt),
  }),
);

export type AppSetting = typeof appSettings.$inferSelect;
export type AppSettingVersion = typeof appSettingVersions.$inferSelect;
export type ProductionPrerequisite = typeof productionPrerequisites.$inferSelect;
