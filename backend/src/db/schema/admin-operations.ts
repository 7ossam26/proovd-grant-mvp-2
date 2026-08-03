/**
 * Admin operations — Spec §26.5, §26.6, §31.7, §33.12.4 (Phase 16a).
 *
 * Three tables, and the reason each one exists rather than being a column
 * somewhere already:
 *
 *   `campaignSellerTaxReadiness`   §31.7's four gating facts. Recorded and
 *                                  superseded, never edited — it is the basis on
 *                                  which live tax was collected, so it is history
 *                                  the moment anything relies on it.
 *   `highImpactActionPreviews`     §26.6's "preview of customer-visible
 *                                  consequences", made enforceable by being a
 *                                  record the execution must cite rather than a
 *                                  screen the execution merely followed.
 *   `adminOverrides`               §33.12.4's five facts as five NOT NULL
 *                                  columns, insert-only.
 *
 * Migration 0024 installs the guarantees. Everything else the §26.5 ledger and
 * the §26.6 money controls read already exists — the brief's instruction was to
 * build the surfaces against the Phase 03 ledger columns so Phases 18–19 fill
 * rows rather than inventing views, and a phase that added parallel money
 * columns now would be doing exactly the inventing it was told to avoid.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns } from './domain.js';

/* ── campaign_seller_tax_readiness (§31.7) ─────────────────────────────────── */

export const campaignSellerTaxReadiness = pgTable(
  'campaign_seller_tax_readiness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),

    /* §31.7's four facts. Four booleans rather than one, because §31.7 names
       four separate things and a single flag would let three-quarters of the
       work read as done. Each carries its own detail — a CHECK refuses a
       recorded fact with a blank detail, since §31.7 asks for the location, the
       code, and the registration themselves rather than a tick. */
    headOfficeLocationRecorded: boolean('head_office_location_recorded').notNull().default(false),
    headOfficeLocationDetail: text('head_office_location_detail'),
    productTaxCodeRecorded: boolean('product_tax_code_recorded').notNull().default(false),
    productTaxCodeDetail: text('product_tax_code_detail'),
    registrationRecorded: boolean('registration_recorded').notNull().default(false),
    registrationDetail: text('registration_detail'),
    providerTaxSettingsRecorded: boolean('provider_tax_settings_recorded')
      .notNull()
      .default(false),
    providerTaxSettingsDetail: text('provider_tax_settings_detail'),

    /** §34's "recorded as complete": a named person and where the evidence lives. */
    recordedBy: text('recorded_by').notNull(),
    evidenceReference: text('evidence_reference').notNull(),

    /** `test` | `live`. A test-mode readiness never makes a live campaign ready. */
    mode: text('mode').notNull(),

    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    /** FK is DEFERRABLE in the migration — retire and point in one statement. */
    supersededById: uuid('superseded_by_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    liveIdx: uniqueIndex('campaign_seller_tax_readiness_live_idx').on(t.campaignId, t.mode),
  }),
);

/* ── high_impact_action_previews (§26.6) ───────────────────────────────────── */

export const highImpactActionPreviews = pgTable(
  'high_impact_action_previews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    actionKey: text('action_key').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),

    /** The customer-visible consequence lines the Admin actually read. */
    consequences: jsonb('consequences').notNull(),
    /**
     * Hash over the exact action payload these consequences describe. The
     * execution recomputes it; a payload that changed after the preview was
     * shown does not match, and the action refuses — because the consequences
     * the Admin read were the consequences of the *old* payload.
     */
    payloadHash: text('payload_hash').notNull(),

    issuedBy: text('issued_by').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Consumption is the one granted UPDATE, and a trigger makes it one-way. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: text('consumed_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('high_impact_previews_target_idx').on(t.targetType, t.targetId, t.issuedAt),
  }),
);

/* ── admin_overrides (§33.12.4, §25.6, §26.2) ──────────────────────────────── */

export const adminOverrides = pgTable(
  'admin_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** A registered key from the shared OVERRIDABLE_FIELDS register. */
    fieldKey: text('field_key').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),

    /* §33.12.4's five. `priorValue` is NOT NULL because an override with no
       before is unauditable, and the service reads the current value itself
       rather than trusting a caller-supplied one — a caller that supplies both
       halves can supply a flattering pair. */
    priorValue: jsonb('prior_value').notNull(),
    newValue: jsonb('new_value').notNull(),
    internalReason: text('internal_reason').notNull(),
    actor: text('actor').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /** §25.6, §3.1: internal wording never doubles as customer wording. */
    customerExplanation: text('customer_explanation').notNull(),

    mfaContext: text('mfa_context').notNull(),
    reauthContext: text('reauth_context').notNull(),

    /** §26.6: the preview read before executing. NOT NULL, and unique. */
    previewId: uuid('preview_id')
      .notNull()
      .references(() => highImpactActionPreviews.id),

    /** §28.3: makes a retry the same override rather than a second one. */
    idempotencyKey: text('idempotency_key').notNull(),

    evidenceLinks: jsonb('evidence_links'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyIdx: uniqueIndex('admin_overrides_idempotency_idx').on(t.idempotencyKey),
    targetIdx: index('admin_overrides_target_idx').on(t.targetType, t.targetId, t.occurredAt),
    previewIdx: uniqueIndex('admin_overrides_preview_idx').on(t.previewId),
  }),
);

export type CampaignSellerTaxReadiness = typeof campaignSellerTaxReadiness.$inferSelect;
export type HighImpactActionPreview = typeof highImpactActionPreviews.$inferSelect;
export type AdminOverride = typeof adminOverrides.$inferSelect;
