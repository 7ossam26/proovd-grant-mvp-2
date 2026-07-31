/**
 * Policy version records — Spec §18, §31.4, §29.8, §34.
 *
 * One row per (document, version). This is the record a consent row cites from
 * Phase 15 on and the record §29.8's reacceptance flow compares, so the row's
 * identity — slug, route, version — is immutable once written, and a new
 * version of a document is a new row rather than an edit of an old one.
 *
 * The canonical text itself is NOT in this table. It lives in the register at
 * `shared/src/policies/documents.ts`, which the public routes render directly
 * (tech-stack §10: "static routes rendering versioned content from the repo").
 * This table is the durable, referencable, auditable side of the same fact, and
 * the input to §34's fourth condition. `src/tests/policy-versions.test.ts`
 * fails if the two ever disagree — the same drift guard the state enums use.
 *
 * `status` moves `draft` → `published`, once, forwards. §23's rule that an
 * illegal reversal must be impossible applies here too: a document that has
 * been published, and therefore may have been consented to, cannot become a
 * draft again. That is enforced by trigger in the migration, not by convention.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/** Mirrors shared `PolicyStatus`. Drift-tested. */
export const policyStatus = pgEnum('policy_status', ['draft', 'published']);

export const policyVersions = pgTable(
  'policy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Stable document identifier — `terms`, `privacy`, … (§31.4's eight). */
    slug: text('slug').notNull(),
    /** The §18 public route this document publishes at. */
    route: text('route').notNull(),
    title: text('title').notNull(),

    /** Cited by consent records; compared by §29.8. Immutable once written. */
    version: text('version').notNull(),

    status: policyStatus('status').notNull(),

    /**
     * The calendar date the version takes effect. A calendar date, not an
     * instant: a policy is in effect for a day, not from a wall-clock second.
     * NULL exactly while the document is a draft — a CHECK constraint in the
     * migration ties the two together so neither can drift from the other.
     */
    effectiveDate: date('effective_date'),

    /** Set when status moves to `published`. Append-only, like `claimed_at`. */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugVersionIdx: uniqueIndex('policy_versions_slug_version_idx').on(t.slug, t.version),
    statusIdx: index('policy_versions_status_idx').on(t.status),
  }),
);

export type PolicyVersion = typeof policyVersions.$inferSelect;
