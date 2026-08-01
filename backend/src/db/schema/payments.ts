/**
 * Stripe foundations — Spec §32.2, §32.3, §32.4, §13, §11, §24.1.
 *
 * Three tables and no money:
 *
 * `stripe_connected_accounts`  the accounts §13 and §11 onboard, and the four
 *                              human-readable states §13 requires.
 * `stripe_account_events`      append-only. §13's "return and refresh events",
 *                              plus every provider-driven status change.
 * `provider_objects`           §32.4's store, built in full now so the phases
 *                              that populate it add rows rather than columns.
 *
 * ── Nothing here holds a provider identity document ────────────────────────
 * §13 and §25.7 both forbid it: "Proovd does not store Stripe-collected
 * government ID documents. Not a copy, not a thumbnail, not a reference to a
 * local file." There is no column that could, the requirements columns are
 * CHECK-constrained to arrays of requirement *names*, and no raw provider
 * payload is stored anywhere — a curated set of named fields is what §32.4
 * asks for, and copying the whole object would file more than that.
 *
 * ── Mode is a column on every row ──────────────────────────────────────────
 * §34 condition 5 asks Proovd to prove test and live money never mixed, and a
 * store that did not record which mode an object came from could not answer it.
 * Mode is part of the provider-object identity index and is immutable by
 * trigger.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  char,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { campaigns, reservations, campaignAffiliateAssociations } from './domain.js';

/* ── Enums ────────────────────────────────────────────────────────────────── */

export const stripeMode = pgEnum('stripe_mode', ['test', 'live']);

/**
 * §24.1: the Founder account is the seller for campaign charges; the Affiliate
 * account is "a recipient only for Admin-approved Transfers/payouts; it never
 * processes the Backer charge and is never MoR". The two roles are a commercial
 * boundary, not a label, so they are distinct values rather than a flag.
 */
export const connectedAccountRole = pgEnum('connected_account_role', [
  'founder_seller',
  'affiliate_recipient',
]);

/**
 * §13's four return states, plus the state before onboarding begins.
 *
 * §13: returning from Stripe "always lands on a human-readable status: Complete.
 * More information required, with exact missing requirement and resume action.
 * Under review, with owner and next expected update. Restricted/failed, with
 * safe support path and no misleading ability to pay the listing fee." These are
 * those states — which is why they are an enum and not a requirements array.
 */
export const connectedAccountState = pgEnum('connected_account_state', [
  'not_started',
  'more_information_required',
  'under_review',
  'restricted',
  'complete',
]);

/** §24.1's two money streams, kept distinguishable per stored object. */
export const providerAccountContext = pgEnum('provider_account_context', [
  'platform',
  'connected',
]);

/** §32.4's list, in full. Later phases add rows, not values. */
export const providerObjectType = pgEnum('provider_object_type', [
  'checkout_session',
  'connected_account',
  'customer',
  'setup_intent',
  'payment_method',
  'tax_calculation',
  'payment_intent',
  'charge',
  'application_fee',
  'application_fee_refund',
  'refund',
  'dispute',
  'transfer',
  'transfer_reversal',
  'payout',
]);

/* ── stripe_connected_accounts ────────────────────────────────────────────── */

export const stripeConnectedAccounts = pgTable(
  'stripe_connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** CHECK-constrained to `acct_…` in the migration. */
    stripeAccountId: text('stripe_account_id').notNull(),
    mode: stripeMode('mode').notNull(),
    role: connectedAccountRole('role').notNull(),

    /**
     * §11: "Reuse valid onboarding from a prior campaign. Never ask an Affiliate
     * to re-enter valid provider data." The account belongs to a person, and
     * campaigns reference it — not the other way round.
     */
    ownerUserId: text('owner_user_id').notNull(),

    state: connectedAccountState('state').notNull().default('not_started'),

    /* §13: "Onboarding/requirements status." Stripe's booleans as they arrive,
       not collapsed into one — charges enabled with payouts disabled is a real
       state and means something different from either alone. */
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),

    /* §13: "the exact missing requirement". Kept as the provider's own lists so
       the surface can name what is missing instead of saying "more
       information" — which is precisely what §13 forbids. */
    requirementsCurrentlyDue: jsonb('requirements_currently_due')
      .notNull()
      .default(sql`'[]'::jsonb`),
    requirementsPastDue: jsonb('requirements_past_due').notNull().default(sql`'[]'::jsonb`),
    requirementsEventuallyDue: jsonb('requirements_eventually_due')
      .notNull()
      .default(sql`'[]'::jsonb`),
    requirementsPendingVerification: jsonb('requirements_pending_verification')
      .notNull()
      .default(sql`'[]'::jsonb`),
    requirementsDisabledReason: text('requirements_disabled_reason'),

    /** §13: "Required capabilities/statuses." */
    capabilities: jsonb('capabilities').notNull().default(sql`'{}'::jsonb`),

    /**
     * §13: "Policy/agreement acceptance references." A reference — which
     * agreement, accepted when — and deliberately not the acceptance IP or user
     * agent Stripe also exposes: §28.4 limits collection to what is needed, and
     * nothing here needs them.
     */
    agreementType: text('agreement_type'),
    agreementAcceptedAt: timestamp('agreement_accepted_at', { withTimezone: true }),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: uniqueIndex('stripe_connected_accounts_account_idx').on(t.stripeAccountId),
    ownerIdx: index('stripe_connected_accounts_owner_idx').on(t.ownerUserId, t.role),
  }),
);

/* ── stripe_account_events ────────────────────────────────────────────────── */

/**
 * §13: "Return and refresh events." Append-only.
 *
 * A Founder who bounced off Stripe three times and an Admin trying to work out
 * why need the same history, and one a later statement could edit is not it.
 * `source` distinguishes a person's landing from a provider's webhook, which is
 * the question anyone debugging a stuck onboarding actually asks.
 */
export const stripeAccountEvents = pgTable(
  'stripe_account_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => stripeConnectedAccounts.id),
    stripeAccountId: text('stripe_account_id').notNull(),

    /** `link_created` | `returned` | `refreshed` | `account_updated` | `deauthorized`. */
    event: text('event').notNull(),

    priorState: connectedAccountState('prior_state'),
    newState: connectedAccountState('new_state'),

    /** `founder` | `admin` | `provider:stripe` | `system:<job>`. */
    source: text('source').notNull(),
    actor: text('actor').notNull(),

    /** The provider event this came from, when it came from one. */
    providerEventId: text('provider_event_id'),
    detail: jsonb('detail'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index('stripe_account_events_account_idx').on(t.connectedAccountId, t.occurredAt),
  }),
);

/* ── provider_objects (§32.4) ─────────────────────────────────────────────── */

/**
 * "Store every object affecting state with mode, account context, related
 * domain IDs, amount components, status, idempotency key, failure details, and
 * timestamps."
 *
 * One table rather than fifteen. Every one of those objects is stored for the
 * same reason — reconciling a domain record against what the provider actually
 * did — and reconciliation reads across them. Fifteen tables would mean fifteen
 * joins to answer "what happened to this reservation", and a new object type
 * would be a migration rather than an enum value.
 */
export const providerObjects = pgTable(
  'provider_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('stripe'),
    mode: stripeMode('mode').notNull(),
    objectType: providerObjectType('object_type').notNull(),
    providerObjectId: text('provider_object_id').notNull(),

    /** §32.4: "account context". */
    accountContext: providerAccountContext('account_context').notNull(),
    stripeAccountId: text('stripe_account_id'),

    /* §32.4: "related domain IDs". Nullable because which one applies depends on
       the object — a Checkout session belongs to a campaign, a Transfer to an
       association. Foreign keys where the table exists. */
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    reservationId: uuid('reservation_id').references(() => reservations.id),
    associationId: uuid('association_id').references(() => campaignAffiliateAssociations.id),
    ownerUserId: text('owner_user_id'),

    /* §32.4: "amount components". Integer cents in bigint — never a float,
       never NUMERIC arithmetic in app code. Named columns for the ones the
       §24.3 waterfall reconciles against; `amount_detail` for whatever an
       object carries that these do not name. */
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    amountCents: bigint('amount_cents', { mode: 'bigint' }),
    amountTaxCents: bigint('amount_tax_cents', { mode: 'bigint' }),
    amountFeeCents: bigint('amount_fee_cents', { mode: 'bigint' }),
    amountApplicationFeeCents: bigint('amount_application_fee_cents', { mode: 'bigint' }),
    amountNetCents: bigint('amount_net_cents', { mode: 'bigint' }),
    amountDetail: jsonb('amount_detail'),

    /** §32.4: "status". The provider's own word, not a translation of it. */
    status: text('status'),

    /**
     * §32.4: "idempotency key". The key Proovd sent, so a retry can be matched
     * to the object it produced without asking the provider — which is what
     * makes a crashed close batch recoverable (§33.7.7).
     */
    idempotencyKey: text('idempotency_key'),

    /* §32.4: "failure details". */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    failureDetail: jsonb('failure_detail'),

    /* §32.4: "timestamps". The provider's beside ours — they differ, and
       reconciliation cares which is which (§27.1: stored UTC). */
    providerCreatedAt: timestamp('provider_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Mode is in the key: a test object and a live object must never collide. */
    identityIdx: uniqueIndex('provider_objects_identity_idx').on(
      t.provider,
      t.mode,
      t.providerObjectId,
    ),
    campaignIdx: index('provider_objects_campaign_idx').on(t.campaignId, t.objectType),
    reservationIdx: index('provider_objects_reservation_idx').on(t.reservationId, t.objectType),
    accountIdx: index('provider_objects_account_idx').on(t.stripeAccountId, t.objectType),
    idempotencyIdx: index('provider_objects_idempotency_idx').on(t.idempotencyKey),
  }),
);

export type StripeConnectedAccount = typeof stripeConnectedAccounts.$inferSelect;
export type StripeAccountEvent = typeof stripeAccountEvents.$inferSelect;
export type ProviderObject = typeof providerObjects.$inferSelect;
