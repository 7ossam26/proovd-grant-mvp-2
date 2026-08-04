/**
 * Phase 10a — Stripe foundations. Spec §32.2, §32.3, §32.4, §13, §24.1, §28.3.
 *
 * §33 names no test for this phase: it is infrastructure, and its contract is
 * the brief's done-when list. What it delivers to §34 is condition 5 —
 * "test/live key separation and webhook signatures pass" — and what it owes
 * every later phase is that a duplicate delivery can never move money twice.
 *
 * So this file proves the four things a payments substrate has to be right
 * about before anything is built on it:
 *
 *   · the environment refuses every mode and context mismatch, at boot;
 *   · both endpoints verify signatures, and an unverified body reaches nothing;
 *   · a replayed event produces one domain change and one audit trail (§28.3);
 *   · a connected account's four §13 states are derived correctly, including
 *     the refusals a Founder must not be able to pay through.
 *
 * Signatures are generated with Stripe's own helper against the real
 * `constructEvent`, so what is under test is Stripe's verification and not a
 * reimplementation of it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { validateEnv, prerequisiteFacts } from '../env.js';
import { createStripeGateway } from '../payments/stripe-client.js';
import {
  deriveAccountState,
  readAccountFacts,
  upsertConnectedAccount,
  findAccountForOwner,
  findAccountByStripeId,
  readAccountHistory,
  type AccountFacts,
} from '../payments/connected-accounts.js';
import { recordProviderObject, readProviderObject } from '../payments/provider-objects.js';
import { PLATFORM_HANDLERS, CONNECT_HANDLERS } from '../payments/webhook-handlers.js';
import {
  STRIPE_PLATFORM_WEBHOOK_PATH,
  STRIPE_CONNECT_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { providerEvents, auditEvents } from '../db/schema/integrity.js';
import { stripeConnectedAccounts, providerObjects } from '../db/schema/payments.js';

const PLATFORM_SECRET = 'whsec_platform_secret_for_the_suite';
const CONNECT_SECRET = 'whsec_connect_secret_for_the_suite';
const API_VERSION = '2026-07-29.dahlia';

const gateway = createStripeGateway({
  mode: 'test',
  apiVersion: API_VERSION,
  secretKey: 'sk_test_placeholder_never_used_for_a_call',
  platformAccountId: 'acct_platformtestaccount',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
});

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ stripeGateway: gateway, globalRateLimit: 1_000_000 }, 'stripe');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

async function asAppRole<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await h.pool.connect();
  try {
    await client.query('SET ROLE proovd_app');
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

function eventBody(input: {
  id?: string;
  type: string;
  account?: string | null;
  object: Record<string, unknown>;
}) {
  return JSON.stringify({
    id: input.id ?? `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    ...(input.account ? { account: input.account } : {}),
    data: { object: input.object },
  });
}

/** Stripe's own signing helper, so the real `constructEvent` is what runs. */
function signFor(secret: string, payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

function deliver(path: string, payload: string, signature: string) {
  return request(h.app)
    .post(path)
    .set('content-type', 'application/json')
    .set(STRIPE_SIGNATURE_HEADER, signature)
    .send(payload);
}

/** A Stripe account object with everything healthy, for tests to spoil. */
function accountObject(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'account',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: 'active', transfers: 'active' },
    requirements: {
      currently_due: [],
      past_due: [],
      eventually_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    tos_acceptance: { date: 1780000000, service_agreement: 'full' },
    ...overrides,
  };
}

async function onboard(label: string, role: 'founder_seller' | 'affiliate_recipient') {
  const user = await seedUser(h, role === 'founder_seller' ? 'founder' : 'affiliate', label);
  const stripeAccountId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await upsertConnectedAccount(h.db, {
    stripeAccountId,
    mode: 'test',
    role,
    ownerUserId: user.id,
    source: 'founder',
    actor: `user:${user.id}`,
    event: 'link_created',
  });

  return { userId: user.id, stripeAccountId };
}

/* ── §32.2 — the environment fails closed ─────────────────────────────────── */

describe('§32.2 — mode-safe environment inputs', () => {
  const base = {
    NODE_ENV: 'test' as const,
    DATABASE_URL: 'postgres://localhost/test',
    APP_BASE_URL: 'https://app.example.com',
    STRIPE_MODE: 'test' as const,
    STRIPE_PLATFORM_SECRET_KEY: 'sk_test_placeholder_value_for_the_suite',
    STRIPE_PLATFORM_PUBLISHABLE_KEY: 'pk_test_placeholder_value_for_the_suite',
    STRIPE_API_VERSION: API_VERSION,
    STRIPE_PLATFORM_ACCOUNT_ID: 'acct_platformtestaccount',
    CRON_SECRET: 'a-32-character-or-longer-cron-secret-for-tests',
    BETTER_AUTH_SECRET: 'a-32-character-or-longer-better-auth-secret-for-tests',
    ADMIN_REAUTH_WINDOW_SECONDS: '300',
  };

  it('accepts a complete test-mode configuration', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('refuses to boot without a locked API version', () => {
    const { STRIPE_API_VERSION: _omitted, ...without } = base;
    expect(() => validateEnv(without)).toThrow(/STRIPE_API_VERSION/);
    // An SDK upgrade must not be able to change the shape of every object the
    // ledger reads, so a floating value is refused too.
    expect(() => validateEnv({ ...base, STRIPE_API_VERSION: 'latest' })).toThrow(/locked/i);
  });

  it('refuses anything that is not an account id in an account field', () => {
    expect(() =>
      validateEnv({ ...base, STRIPE_PLATFORM_ACCOUNT_ID: 'pk_test_wrong_field' }),
    ).toThrow(/acct_/);
    expect(() =>
      validateEnv({ ...base, STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID: 'sk_test_wrong_field' }),
    ).toThrow(/acct_/);
  });

  it('refuses an API key pasted into a webhook-secret field', () => {
    // Otherwise this surfaces as "signature verification failed" and is
    // debugged as a Stripe problem for an afternoon.
    expect(() =>
      validateEnv({ ...base, STRIPE_WEBHOOK_SECRET_PLATFORM: 'sk_test_oops' }),
    ).toThrow(/whsec_/);
  });

  it('refuses one signing secret shared by both endpoints', () => {
    // §32.3 gives them separate secrets so each verifies only its own traffic.
    // Shared, either endpoint accepts the other's events and §24.1's boundary
    // between Proovd-as-MoR and Founder-as-MoR money stops being enforced.
    expect(() =>
      validateEnv({
        ...base,
        STRIPE_WEBHOOK_SECRET_PLATFORM: PLATFORM_SECRET,
        STRIPE_WEBHOOK_SECRET_CONNECT: PLATFORM_SECRET,
      }),
    ).toThrow(/separate secrets/);
  });

  it('reports separation to the §34 prerequisites panel only when it holds', () => {
    const separated = prerequisiteFacts(
      validateEnv({
        ...base,
        STRIPE_WEBHOOK_SECRET_PLATFORM: PLATFORM_SECRET,
        STRIPE_WEBHOOK_SECRET_CONNECT: CONNECT_SECRET,
      }),
    );
    expect(separated.stripeKeysMatchMode).toBe(true);
    expect(separated.platformWebhookSecretPresent).toBe(true);
    expect(separated.connectWebhookSecretPresent).toBe(true);

    // §34 condition 5 is about separation, and unset secrets are not separated.
    const bare = prerequisiteFacts(validateEnv(base));
    expect(bare.stripeKeysMatchMode).toBe(false);
  });
});

/* ── §32.3 / §28.3 — signature verification ───────────────────────────────── */

describe('§28.3 — an unverified delivery reaches nothing', () => {
  it('refuses an unsigned body on both endpoints', async () => {
    const payload = eventBody({ type: 'account.updated', object: accountObject('acct_x') });

    await request(h.app)
      .post(STRIPE_PLATFORM_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .send(payload)
      .expect(401);

    await request(h.app)
      .post(STRIPE_CONNECT_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .send(payload)
      .expect(401);

    // Nothing was claimed, so nothing was processed.
    const events = await h.db.select().from(providerEvents).where(eq(providerEvents.provider, 'stripe'));
    expect(events).toHaveLength(0);
  });

  it('refuses a body whose bytes changed after signing', async () => {
    // The signature covers the exact bytes. This is why the route mounts a raw
    // parser and why `app.ts` mounts no global JSON parser.
    const payload = eventBody({ type: 'account.updated', object: accountObject('acct_y') });
    const signature = signFor(CONNECT_SECRET, payload);
    const tampered = payload.replace('"charges_enabled":true', '"charges_enabled":false');

    await deliver(STRIPE_CONNECT_WEBHOOK_PATH, tampered, signature).expect(401);
  });

  it('refuses the other endpoint’s secret', async () => {
    // The whole point of two secrets. A Connect delivery signed for the
    // platform endpoint must not verify at the Connect one, and vice versa.
    const payload = eventBody({ type: 'account.updated', object: accountObject('acct_z') });

    await deliver(
      STRIPE_CONNECT_WEBHOOK_PATH,
      payload,
      signFor(PLATFORM_SECRET, payload),
    ).expect(401);

    await deliver(
      STRIPE_PLATFORM_WEBHOOK_PATH,
      payload,
      signFor(CONNECT_SECRET, payload),
    ).expect(401);
  });

  it('refuses a replay outside Stripe’s timestamp tolerance', async () => {
    const payload = eventBody({ type: 'account.updated', object: accountObject('acct_old') });
    const stale = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: CONNECT_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });

    await deliver(STRIPE_CONNECT_WEBHOOK_PATH, payload, stale).expect(401);
  });

  it('records every refusal without saying why to the caller', async () => {
    const payload = eventBody({ type: 'account.updated', object: accountObject('acct_q') });
    const response = await deliver(STRIPE_PLATFORM_WEBHOOK_PATH, payload, 't=1,v1=deadbeef');

    expect(response.status).toBe(401);
    // §5.5's split, applied here: the caller learns nothing, the audit log has
    // the reason.
    expect(response.body).toEqual({ error: 'signature_invalid' });

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'stripe.webhook_rejected'));
    expect(audits.length).toBeGreaterThan(0);
  });
});

/* ── §32.3 — the two endpoints stay separate ──────────────────────────────── */

describe('§32.3 — two endpoints, two handler maps', () => {
  it('registers `account.updated` on Connect and not on platform', () => {
    expect(Object.keys(CONNECT_HANDLERS)).toContain('account.updated');
    expect(Object.keys(PLATFORM_HANDLERS)).not.toContain('account.updated');
  });

  it('registers no handler for an object no phase creates yet', () => {
    // §1 rule 6 applied to a vendor's vocabulary: a registered no-op handler
    // reads as "handled", and this build does not handle these.
    //
    // `checkout.session.*` left this list in Phase 11, `payment_intent.*` in
    // Phase 18a, and `charge.refunded` in Phase 20a — each the phase whose
    // objects those are. The rest still belong to objects later phases create
    // (disputes and Transfer reversals are Phase 20b's).
    for (const type of ['setup_intent.succeeded', 'transfer.created', 'charge.dispute.created']) {
      expect(PLATFORM_HANDLERS[type]).toBeUndefined();
      expect(CONNECT_HANDLERS[type]).toBeUndefined();
    }
  });

  it('registers Phase 20a’s charge.refunded on both endpoints', () => {
    // §32.3 lists it on both: the platform delivery reconciles the listing
    // stream (Phase 11 confirms its refund synchronously) and the Connect
    // delivery confirms or routes a campaign-charge refund (§24.1: direct
    // charges live on the Founder's account).
    expect(PLATFORM_HANDLERS['charge.refunded']).toBeDefined();
    expect(CONNECT_HANDLERS['charge.refunded']).toBeDefined();
  });

  it('registers Phase 18a’s payment_intent events on Connect and not on platform', () => {
    // §24.1: campaign charges are direct charges on the Founder's connected
    // account, so their deliveries arrive at the Connect endpoint. A platform
    // delivery must not be able to reach a capture effect.
    for (const type of [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.requires_action',
      'payment_intent.canceled',
    ]) {
      expect(CONNECT_HANDLERS[type]).toBeDefined();
      expect(PLATFORM_HANDLERS[type]).toBeUndefined();
    }
  });

  it('registers Phase 11’s Checkout events on platform and not on Connect', () => {
    // §24.6 and §33.3.6: the listing fee is Proovd's own money. A Connect
    // delivery must not be able to reach a platform-side effect.
    for (const type of ['checkout.session.completed', 'checkout.session.expired']) {
      expect(PLATFORM_HANDLERS[type]).toBeDefined();
      expect(CONNECT_HANDLERS[type]).toBeUndefined();
    }
  });

  it('records an unhandled event and answers 200', async () => {
    // Stripe retries a non-2xx for days. An event whose phase has not been
    // built is not a delivery problem.
    const payload = eventBody({
      type: 'payment_intent.succeeded',
      object: { id: 'pi_test_unhandled' },
    });
    const response = await deliver(
      STRIPE_PLATFORM_WEBHOOK_PATH,
      payload,
      signFor(PLATFORM_SECRET, payload),
    ).expect(200);

    expect(response.body.outcome).toBe('unhandled');

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'stripe.webhook_unhandled'));
    expect(audits.length).toBeGreaterThan(0);
  });
});

/* ── §28.3 — replay ───────────────────────────────────────────────────────── */

describe('§28.3 — a replayed event produces one domain change', () => {
  it('claims the event id first and swallows every redelivery', async () => {
    const { userId, stripeAccountId } = await onboard('replay', 'founder_seller');
    const eventId = `evt_${randomUUID().replace(/-/g, '')}`;

    const payload = eventBody({
      id: eventId,
      type: 'account.updated',
      account: stripeAccountId,
      object: accountObject(stripeAccountId, {
        requirements: {
          currently_due: ['individual.verification.document'],
          past_due: [],
          eventually_due: [],
          pending_verification: [],
          disabled_reason: null,
        },
      }),
    });
    const signature = signFor(CONNECT_SECRET, payload);

    const first = await deliver(STRIPE_CONNECT_WEBHOOK_PATH, payload, signature).expect(200);
    expect(first.body.outcome).toBe('handled');

    const second = await deliver(STRIPE_CONNECT_WEBHOOK_PATH, payload, signature).expect(200);
    const third = await deliver(STRIPE_CONNECT_WEBHOOK_PATH, payload, signature).expect(200);
    expect(second.body.outcome).toBe('duplicate');
    expect(third.body.outcome).toBe('duplicate');

    const [claimed] = await h.db
      .select()
      .from(providerEvents)
      .where(
        and(eq(providerEvents.provider, 'stripe'), eq(providerEvents.providerEventId, eventId)),
      );
    // A duplicate may update audit — the counter — and nothing else.
    expect(claimed!.seenCount).toBe(3);
    expect(claimed!.processedAt).not.toBeNull();

    // One state change, not three.
    const account = await findAccountByStripeId(h.db, stripeAccountId);
    expect(account!.state).toBe('more_information_required');
    expect(account!.ownerUserId).toBe(userId);

    const history = await readAccountHistory(h.db, account!.id);
    expect(history.filter((e) => e.event === 'account_updated')).toHaveLength(1);

    const duplicates = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'stripe.webhook_duplicate'));
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
  });

  it('does not create an account it has never onboarded', async () => {
    // A Connect platform receives `account.updated` for every account connected
    // to it. Inventing an owner for one Proovd never onboarded would put a row
    // in the ledger attributed to nobody.
    const stranger = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payload = eventBody({
      type: 'account.updated',
      account: stranger,
      object: accountObject(stranger),
    });

    await deliver(
      STRIPE_CONNECT_WEBHOOK_PATH,
      payload,
      signFor(CONNECT_SECRET, payload),
    ).expect(200);

    expect(await findAccountByStripeId(h.db, stranger)).toBeNull();

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'stripe.account_updated_unknown'));
    expect(audits.length).toBeGreaterThan(0);
  });
});

/* ── §13 — the four states ────────────────────────────────────────────────── */

describe('§13 — the four human-readable onboarding states', () => {
  const healthy: AccountFacts = {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    currentlyDue: [],
    pastDue: [],
    eventuallyDue: [],
    pendingVerification: [],
    disabledReason: null,
    capabilities: { card_payments: 'active' },
    agreementType: 'full',
    agreementAcceptedAt: new Date(),
  };

  it('is `complete` only when the account can do its role’s job', () => {
    expect(deriveAccountState(healthy, 'founder_seller')).toBe('complete');
    expect(deriveAccountState(healthy, 'affiliate_recipient')).toBe('complete');

    // §24.1: the Founder account is the seller, the Affiliate account is a
    // recipient only. One shared definition would either block Affiliates on a
    // capability they never use or pass Founders who cannot sell.
    const noCharges = { ...healthy, chargesEnabled: false };
    expect(deriveAccountState(noCharges, 'founder_seller')).toBe('under_review');
    expect(deriveAccountState(noCharges, 'affiliate_recipient')).toBe('complete');

    const noPayouts = { ...healthy, payoutsEnabled: false };
    expect(deriveAccountState(noPayouts, 'founder_seller')).toBe('complete');
    expect(deriveAccountState(noPayouts, 'affiliate_recipient')).toBe('under_review');
  });

  it('is `not_started` before anything is submitted or asked for', () => {
    expect(
      deriveAccountState(
        { ...healthy, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false },
        'founder_seller',
      ),
    ).toBe('not_started');
  });

  it('is `more_information_required` when something is actually missing', () => {
    expect(
      deriveAccountState({ ...healthy, currentlyDue: ['individual.id_number'] }, 'founder_seller'),
    ).toBe('more_information_required');
    expect(
      deriveAccountState({ ...healthy, pastDue: ['external_account'] }, 'founder_seller'),
    ).toBe('more_information_required');
  });

  it('is `under_review` while Stripe is verifying', () => {
    expect(
      deriveAccountState(
        { ...healthy, pendingVerification: ['individual.verification.document'] },
        'founder_seller',
      ),
    ).toBe('under_review');
  });

  it('is `restricted` for every refusal, including one it has never seen', () => {
    for (const reason of ['rejected.fraud', 'rejected.terms_of_service', 'listed', 'platform_paused']) {
      expect(deriveAccountState({ ...healthy, disabledReason: reason }, 'founder_seller')).toBe(
        'restricted',
      );
    }

    // The safe direction. §13's restricted state offers "no misleading ability
    // to pay the listing fee", and treating an unknown refusal as workable is
    // the failure that sentence exists to prevent.
    expect(
      deriveAccountState({ ...healthy, disabledReason: 'some_future_reason' }, 'founder_seller'),
    ).toBe('restricted');
  });

  it('lets a refusal outrank a capability that still reads true', () => {
    expect(
      deriveAccountState({ ...healthy, disabledReason: 'rejected.fraud' }, 'founder_seller'),
    ).toBe('restricted');
  });

  it('maps Stripe’s own past-due and pending reasons to the right words', () => {
    expect(
      deriveAccountState({ ...healthy, disabledReason: 'requirements.past_due' }, 'founder_seller'),
    ).toBe('more_information_required');
    expect(
      deriveAccountState(
        { ...healthy, disabledReason: 'requirements.pending_verification' },
        'founder_seller',
      ),
    ).toBe('under_review');
  });
});

describe('§13 — what is read from a Stripe account, and what is not', () => {
  it('keeps the requirement names and the agreement reference', () => {
    const facts = readAccountFacts(
      accountObject('acct_read', {
        requirements: {
          currently_due: ['individual.id_number'],
          past_due: [],
          eventually_due: ['company.tax_id'],
          pending_verification: [],
          disabled_reason: null,
        },
      }),
    );

    expect(facts.currentlyDue).toEqual(['individual.id_number']);
    expect(facts.eventuallyDue).toEqual(['company.tax_id']);
    expect(facts.agreementType).toBe('full');
    expect(facts.agreementAcceptedAt).toBeInstanceOf(Date);
  });

  it('drops anything in a requirements list that is not a requirement name', () => {
    // §13 forbids storing identity documents. The lists are the one place a
    // widened copy could start pulling in more than names.
    const facts = readAccountFacts(
      accountObject('acct_filter', {
        requirements: {
          currently_due: ['individual.id_number', { file: 'file_123' }, 42],
          past_due: null,
          eventually_due: [],
          pending_verification: [],
          disabled_reason: null,
        },
      }),
    );

    expect(facts.currentlyDue).toEqual(['individual.id_number']);
    expect(facts.pastDue).toEqual([]);
  });

  it('stores no identity document, anywhere on the account row', async () => {
    const { stripeAccountId } = await onboard('nodocs', 'founder_seller');
    const payload = eventBody({
      type: 'account.updated',
      account: stripeAccountId,
      object: accountObject(stripeAccountId, {
        individual: {
          id_number_provided: true,
          verification: { document: { front: 'file_abc123', back: 'file_def456' } },
        },
      }),
    });

    await deliver(
      STRIPE_CONNECT_WEBHOOK_PATH,
      payload,
      signFor(CONNECT_SECRET, payload),
    ).expect(200);

    const [row] = await h.db
      .select()
      .from(stripeConnectedAccounts)
      .where(eq(stripeConnectedAccounts.stripeAccountId, stripeAccountId));

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('file_abc123');
    expect(serialised).not.toContain('file_def456');
    expect(serialised).not.toContain('id_number_provided');
  });

  it('refuses a requirements payload that is not a list, at the database', async () => {
    const { stripeAccountId } = await onboard('badreq', 'founder_seller');
    await expect(
      h.db.execute(`
        UPDATE stripe_connected_accounts
           SET requirements_currently_due = '{"document":"file_x"}'::jsonb
         WHERE stripe_account_id = '${stripeAccountId}'
      `),
    ).rejects.toThrow();
  });
});

/* ── §11 — reuse ──────────────────────────────────────────────────────────── */

describe('§11 — onboarding is reusable and identity is fixed', () => {
  it('finds an existing account for the same owner, role, and mode', async () => {
    const { userId, stripeAccountId } = await onboard('reuse', 'affiliate_recipient');

    const found = await findAccountForOwner(h.db, {
      ownerUserId: userId,
      role: 'affiliate_recipient',
      mode: 'test',
    });
    expect(found!.stripeAccountId).toBe(stripeAccountId);

    // A test account must never be offered as a live one.
    expect(
      await findAccountForOwner(h.db, {
        ownerUserId: userId,
        role: 'affiliate_recipient',
        mode: 'live',
      }),
    ).toBeNull();

    // Nor may a recipient account be reused as a seller (§24.1).
    expect(
      await findAccountForOwner(h.db, {
        ownerUserId: userId,
        role: 'founder_seller',
        mode: 'test',
      }),
    ).toBeNull();
  });

  it('refuses to move an account to another owner or another mode', async () => {
    const { stripeAccountId } = await onboard('immutable', 'founder_seller');

    await expect(
      h.db.execute(
        `UPDATE stripe_connected_accounts SET owner_user_id = 'someone-else' WHERE stripe_account_id = '${stripeAccountId}'`,
      ),
    ).rejects.toThrow();

    await expect(
      h.db.execute(
        `UPDATE stripe_connected_accounts SET mode = 'live' WHERE stripe_account_id = '${stripeAccountId}'`,
      ),
    ).rejects.toThrow();
  });

  it('keeps §13’s return and refresh history append-only', async () => {
    const { stripeAccountId } = await onboard('history', 'founder_seller');
    const account = await findAccountByStripeId(h.db, stripeAccountId);

    await upsertConnectedAccount(h.db, {
      stripeAccountId,
      mode: 'test',
      role: 'founder_seller',
      ownerUserId: account!.ownerUserId,
      source: 'founder',
      actor: 'user:test',
      event: 'returned',
    });

    const history = await readAccountHistory(h.db, account!.id);
    expect(history.map((e) => e.event)).toContain('link_created');
    expect(history.map((e) => e.event)).toContain('returned');

    await expect(
      asAppRole((client) =>
        client.query(`UPDATE stripe_account_events SET event = 'edited' WHERE stripe_account_id = $1`, [
          stripeAccountId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

/* ── §32.4 — the provider-object store ────────────────────────────────────── */

describe('§32.4 — every object affecting state', () => {
  it('stores mode, context, domain ids, amounts, status, key, and failure', async () => {
    const id = `pi_${randomUUID().replace(/-/g, '')}`;

    await recordProviderObject(h.db, {
      mode: 'test',
      objectType: 'payment_intent',
      providerObjectId: id,
      accountContext: 'connected',
      stripeAccountId: 'acct_seller123456',
      amountCents: 12_500n,
      amountTaxCents: 1_000n,
      amountApplicationFeeCents: 625n,
      status: 'requires_capture',
      idempotencyKey: 'close-batch:campaign-1:attempt-1',
      failureCode: null,
      providerCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const stored = await readProviderObject(h.db, { mode: 'test', providerObjectId: id });
    expect(stored!.objectType).toBe('payment_intent');
    expect(stored!.amountCents).toBe(12_500n);
    expect(stored!.amountApplicationFeeCents).toBe(625n);
    expect(stored!.idempotencyKey).toBe('close-batch:campaign-1:attempt-1');
    expect(stored!.providerCreatedAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('upserts on the provider id, and a partial update blanks nothing', async () => {
    const id = `ch_${randomUUID().replace(/-/g, '')}`;

    await recordProviderObject(h.db, {
      mode: 'test',
      objectType: 'charge',
      providerObjectId: id,
      accountContext: 'connected',
      stripeAccountId: 'acct_seller123456',
      amountCents: 5_000n,
      status: 'pending',
    });

    // A webhook that reports only a status change must not blank the amounts an
    // earlier API call recorded — §9's autosave rule, applied to a ledger.
    await recordProviderObject(h.db, {
      mode: 'test',
      objectType: 'charge',
      providerObjectId: id,
      accountContext: 'connected',
      stripeAccountId: 'acct_seller123456',
      status: 'succeeded',
    });

    const stored = await readProviderObject(h.db, { mode: 'test', providerObjectId: id });
    expect(stored!.status).toBe('succeeded');
    expect(stored!.amountCents).toBe(5_000n);

    const all = await h.db
      .select()
      .from(providerObjects)
      .where(eq(providerObjects.providerObjectId, id));
    expect(all).toHaveLength(1);
  });

  it('refuses to change the mode or the identity of a stored object', async () => {
    const id = `po_${randomUUID().replace(/-/g, '')}`;
    await recordProviderObject(h.db, {
      mode: 'test',
      objectType: 'payout',
      providerObjectId: id,
      accountContext: 'connected',
      stripeAccountId: 'acct_seller123456',
    });

    // §34 condition 5 asks Proovd to prove test and live never mixed. A row
    // whose mode could be edited would make that unprovable.
    await expect(
      h.db.execute(`UPDATE provider_objects SET mode = 'live' WHERE provider_object_id = '${id}'`),
    ).rejects.toThrow();
  });

  it('makes an object say which side of §24.1 it is on', async () => {
    // A connected object names its account; a platform object does not. A row
    // that could not say would blur the line between Proovd-as-MoR and
    // Founder-as-MoR money.
    await expect(
      h.db.execute(`
        INSERT INTO provider_objects (mode, object_type, provider_object_id, account_context)
        VALUES ('test', 'charge', 'ch_missing_account', 'connected')
      `),
    ).rejects.toThrow();

    await expect(
      h.db.execute(`
        INSERT INTO provider_objects (mode, object_type, provider_object_id, account_context, stripe_account_id)
        VALUES ('test', 'checkout_session', 'cs_platform_with_account', 'platform', 'acct_x')
      `),
    ).rejects.toThrow();
  });

  it('refuses a negative amount', async () => {
    // A refund is its own object with its own positive amount (§24.8), not a
    // negative charge. A sign convention nobody wrote down is how a total comes
    // out wrong two phases later.
    await expect(
      h.db.execute(`
        INSERT INTO provider_objects (mode, object_type, provider_object_id, account_context, amount_cents)
        VALUES ('test', 'refund', 're_negative', 'platform', -100)
      `),
    ).rejects.toThrow();
  });

  it('records the connected account as a §32.4 object too', async () => {
    const { stripeAccountId } = await onboard('objectrow', 'founder_seller');
    const payload = eventBody({
      type: 'account.updated',
      account: stripeAccountId,
      object: accountObject(stripeAccountId),
    });

    await deliver(
      STRIPE_CONNECT_WEBHOOK_PATH,
      payload,
      signFor(CONNECT_SECRET, payload),
    ).expect(200);

    const stored = await readProviderObject(h.db, {
      mode: 'test',
      providerObjectId: stripeAccountId,
    });
    expect(stored!.objectType).toBe('connected_account');
    expect(stored!.accountContext).toBe('connected');
    expect(stored!.status).toBe('complete');
  });
});

/* ── §34 — this phase does not open the gate ──────────────────────────────── */

describe('§34 — nothing here opens live mode', () => {
  it('has no route that creates a charge, a session, or an intent', async () => {
    for (const path of [
      '/api/payments/charge',
      '/api/payments/checkout',
      '/api/payments/setup-intent',
      '/api/founder/campaigns/x/listing-fee',
    ]) {
      const response = await request(h.app).post(path).send({});
      // The SPA fallback answers 200 with index.html for unknown GETs; a POST
      // to a route that does not exist must not be handled by anything.
      expect([404, 401, 403]).toContain(response.status);
    }
  });

  it('runs in test mode and says so', () => {
    expect(gateway.mode).toBe('test');
    expect(gateway.apiVersion).toBe(API_VERSION);
  });
});
