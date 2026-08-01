/**
 * Integrity tables — phase 03.
 *
 * `audit_events` (§25.6): insert-only; UPDATE and DELETE are revoked from the
 * application role in the migration SQL, not by convention.
 *
 * Idempotency is three separate mechanisms, all required (§28.3, tech-stack
 * §4.3): `provider_events` (unique provider event ID, insert-or-skip before
 * any domain work), `idempotency_keys` (stable domain keys), and
 * `notification_deliveries` (unique on event/target/entity). A duplicate
 * event may update audit; it may never duplicate domain state, money, or a
 * message.
 */

import {
  pgTable,
  uuid,
  bigint,
  char,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ── audit_events (§25.6) ───────────────────────────────────────────────── */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Actor, with MFA/reauth context where applicable (§25.6, §28.2). */
    actor: text('actor').notNull(),
    mfaContext: text('mfa_context'),
    reauthContext: text('reauth_context'),

    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /** §25.6: internal reason and customer-facing explanation are SEPARATE
        columns — internal vocabulary must never leak into customer copy (§3.1). */
    internalReason: text('internal_reason').notNull(),
    customerExplanation: text('customer_explanation'),

    priorValue: jsonb('prior_value'),
    newValue: jsonb('new_value'),

    amountCents: bigint('amount_cents', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }),

    providerObjectIds: jsonb('provider_object_ids'),
    evidenceLinks: jsonb('evidence_links'),
    relatedNotificationIds: jsonb('related_notification_ids'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('audit_events_target_idx').on(t.targetType, t.targetId, t.occurredAt),
  }),
);

/* ── provider_events (§28.3) ────────────────────────────────────────────── */

export const providerEvents = pgTable(
  'provider_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('stripe'),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type'),
    /**
     * The provider's identifier for the *thing* the event is about — a Cal.com
     * booking uid, later a Stripe object id. Added Phase 09b so an Admin
     * chasing a missed delivery can find it in the provider without a second
     * lookup table. Never authoritative: the domain record is.
     */
    subjectId: text('subject_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Duplicate deliveries update audit only (§28.3): count + last-seen. */
    seenCount: integer('seen_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Insert-or-skip pivot: unique on the provider's event ID. */
    providerEventIdx: uniqueIndex('provider_events_event_idx').on(t.provider, t.providerEventId),
  }),
);

/* ── idempotency_keys (§28.3, §33.7.7) ──────────────────────────────────── */

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable domain key, e.g. close-batch attempt, capture retry,
        fixed-payment funding, Transfer, refund. */
    key: text('key').notNull(),
    purpose: text('purpose').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    result: jsonb('result'),
  },
  (t) => ({
    keyIdx: uniqueIndex('idempotency_keys_key_idx').on(t.key),
  }),
);

/* ── notification_deliveries (§27.2, §28.3) ─────────────────────────────── */

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** A key from shared/notifications NOTIFICATION_EVENTS. */
    eventKey: text('event_key').notNull(),
    /** Recipient identity — email address or internal channel. */
    target: text('target').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Provider message ID once sent. */
    notificationId: text('notification_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One delivery per (event, target, entity), ever. */
    dedupIdx: uniqueIndex('notification_deliveries_dedup_idx').on(
      t.eventKey,
      t.target,
      t.entityType,
      t.entityId,
    ),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type ProviderEvent = typeof providerEvents.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
