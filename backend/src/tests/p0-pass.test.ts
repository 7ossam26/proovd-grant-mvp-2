/**
 * The P0 pass over one campaign — Phase 23 scope 4, 5, and 6.
 *
 * §32.1's step 17 asks for three things that are really one thing: replay every
 * state-changing path adversarially (scope 4), exercise every required provider
 * outcome and retain the evidence (§32.5, §32.6), and prove the direct charge
 * architecture end to end (§32.7). All three are properties of the SAME
 * campaign moving through the SAME pipeline, so they are proved here together
 * rather than in three files that each seed their own world and could each be
 * right about a different one.
 *
 * ── What is deliberately not re-tested here ─────────────────────────────────
 * Every phase suite already proves its own idempotency: §33.1.2 the claim,
 * §33.3.6 the listing stream, §33.4.3 the fixed payment, §33.4.6 the launch,
 * §33.7.7 the close batch, §33.8.3 the Transfer, §33.9.2 the refund. Re-driving
 * all of them would be duplication, and duplication is how a sweep gets slow
 * and then gets skipped. What this file adds is the part no single phase could
 * see: that the register of state-changing paths is COMPLETE, that every one of
 * them has its mechanism present in the database rather than in its author's
 * intention, and that the three adversarial cases hold on the money path where
 * getting it wrong charges somebody twice.
 *
 * ── The card numbers ────────────────────────────────────────────────────────
 * §32.5 says to use current official provider test values and not to hard-code
 * obsolete documentation into the customer product. They live in this file and
 * nowhere else, a test asserts they appear in no shipped source, and the
 * gateway is driven by the OUTCOME rather than by the number — which is what
 * keeps the suite honest when the provider's list changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  ADVERSARIAL_CASES,
  BACKUP_MODE_ABSENCE,
  DIRECT_ARCHITECTURE_CLAIMS,
  IDEMPOTENCY_INVARIANT,
  IDEMPOTENT_PATHS,
  REQUIRED_TEST_OUTCOMES,
  evidenceLogViolations,
  type EvidenceEntry,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createAuditWriter, type AuditWriter } from '../auth/audit.js';
import {
  createMemoryStripeGateway,
  type MemoryCaptureOutcome,
  type MemoryStripeGateway,
} from '../payments/stripe-client.js';
import {
  STRIPE_CONNECT_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { reservationCaptureAttempts } from '../db/schema/close.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import { recordRefundCase, previewRefundExecution, executeRefund } from '../refunds/service.js';
import { paymentDisputes } from '../db/schema/disputes.js';

/* ── §32.5's card numbers, and the only place they exist ───────────────────── */

/**
 * The provider's published test values for each required outcome.
 *
 * Kept here because §32.2 forbids test cards in production UI and `shared/`
 * ships in the browser bundle. Verified against Stripe's published testing
 * documentation; the suite drives the gateway by OUTCOME, so if the provider
 * retires a number the matrix still exercises the behaviour and only this table
 * needs re-checking — which is exactly what §32.5's "do not hard-code obsolete
 * documentation" is asking for.
 */
const STRIPE_TEST_CARDS: Record<string, string> = {
  successful_setup_and_later_charge: '4242424242424242',
  generic_decline: '4000000000000002',
  insufficient_funds: '4000000000009995',
  off_session_authentication_required: '4000002500003155',
  expired_card: '4000000000000069',
  incorrect_cvc: '4000000000000127',
  setup_failure: '4000000000000341',
  processing_error: '4000000000000119',
  full_refund: '4242424242424242',
  partial_refund: '4242424242424242',
  dispute: '4000000000000259',
};

const PLATFORM_SECRET = 'whsec_platform_for_p0_pass_suite';
const CONNECT_SECRET = 'whsec_connect_for_p0_pass_suite';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

const CONTEXT = {
  appBaseUrl: 'http://localhost:3000',
  supportEmail: 'support@proovd.co',
  fromAddress: 'hello@proovd.co',
};

let h: Harness;
let audit: AuditWriter;

/** Every scenario's §32.6 entry, accumulated as the matrix runs. */
const evidence: EvidenceEntry[] = [];

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'p0-pass',
  );
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function closeDeps() {
  return { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT, tokens: h.tokens };
}

function refundDeps() {
  return { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT };
}

/* ── One campaign, seeded the way the close suite seeds one ────────────────── */

interface Seeded {
  campaignId: string;
  founderUserId: string;
  connectedAccountId: string;
  entity: string;
}

async function seedLiveCampaign(label: string): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `p0-founder-${label}`);
  const closeAt = new Date(Date.now() + 14 * 24 * 3_600_000);
  const entity = `${label} Instruments LLC`;

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'live',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 86_400_000),
      campaignCloseAt: closeAt,
    })
    .returning({ id: campaigns.id });
  const campaignId = campaign!.id;

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({ campaignId, prospectId: prospect!.id, status: 'claimed', createdBy: 'admin:test' })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId,
    email: founder.email,
    preferredName: `F-${label}`,
    legalName: `Founder ${label}`,
    businessName: entity,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const stripeAccountId = `acct_p0${randomUUID().slice(0, 10)}`;
  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.id,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: entity,
    closesAt: closeAt,
    refundPolicyTitle: `${label} Refund`,
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/r',
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values({
    campaignId,
    sku: 'TIER-1',
    title: 'Reward 1',
    priceCents: 10_000n,
    contents: 'x',
    fulfillmentCommitment: 'y',
    delivery: 'December 2026',
    sortOrder: 0,
  });

  return { campaignId, founderUserId: founder.id, connectedAccountId: stripeAccountId, entity };
}

let contactCounter = 0;
function preorderBody(paymentMethodId?: string) {
  contactCounter += 1;
  return {
    rewardSku: 'TIER-1',
    contact: {
      email: `p0-${contactCounter}-${randomUUID().slice(0, 6)}@example.com`,
      phone: `41777730${String(contactCounter).padStart(2, '0')}`,
    },
    billing: { country: 'US', postalCode: '10001', state: 'NY' },
    ageConfirmed: true,
    survey: { why: 'want it', recommend: 7 },
    operationalSharingAck: true,
    founderMarketingConsent: false,
    newsletterConsent: false,
    paymentMethodId: paymentMethodId ?? `pm_${randomUUID().slice(0, 12)}`,
  };
}

async function placePreorder(
  campaignId: string,
  paymentMethodId?: string,
): Promise<{ status: number; reservationId: string | null }> {
  const res = await request(h.app)
    .post(`/api/campaign/${campaignId}/preorder`)
    .send(preorderBody(paymentMethodId));
  return { status: res.status, reservationId: res.body?.reservationId ?? null };
}

async function makeDue(campaignId: string): Promise<void> {
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
}

function signedDelivery(payload: string): request.Test {
  return request(h.app)
    .post(STRIPE_CONNECT_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(
      STRIPE_SIGNATURE_HEADER,
      Stripe.webhooks.generateTestHeaderString({ payload, secret: CONNECT_SECRET }),
    )
    .send(payload);
}

async function reservationRow(reservationId: string) {
  const [row] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));
  return row!;
}

/** One §32.6 entry per exercised scenario. */
function record(
  key: string,
  seeded: Seeded,
  reservationId: string | null,
  paymentIntentId: string | null,
  extra: Partial<EvidenceEntry> = {},
): void {
  const outcome = REQUIRED_TEST_OUTCOMES.find((entry) => entry.key === key)!;
  evidence.push({
    environment: process.env['TEST_DATABASE_URL'] ? 'ci-postgres' : 'testcontainers',
    stripeMode: gateway.mode,
    connectedAccountIds: [seeded.connectedAccountId, gateway.platformAccountId],
    campaignId: seeded.campaignId,
    reservationId,
    paymentIntentId,
    webhookEndpoint: outcome.webhookEndpoint,
    scenario: outcome.scenario,
    result: 'pass',
    // The suite drives an in-memory gateway, so no object exists at the
    // provider to be purged. §32.6's question is answered rather than left
    // blank — see the note the log itself carries.
    providerDataDisposition: 'marked_invalid_artifact',
    ...extra,
  });
}

/* ══ Scope 6 — §32.7 the direct architecture ═══════════════════════════════ */

describe('§32.7 — the direct charge model, proved over one campaign', () => {
  let seeded: Seeded;
  let reservationId: string;

  beforeAll(async () => {
    seeded = await seedLiveCampaign('arch');
    const placed = await placePreorder(seeded.campaignId);
    expect(placed.status).toBe(201);
    reservationId = placed.reservationId!;
  }, 120_000);

  it('creates the SetupIntent and the Customer in the Founder account context', () => {
    const setup = gateway.setupIntents.at(-1)!;
    const customer = gateway.customers.at(-1)!;
    expect(setup.connectedAccountId).toBe(seeded.connectedAccountId);
    expect(customer.connectedAccountId).toBe(seeded.connectedAccountId);
    // Not the platform: §24.1 makes the Founder account the seller, and a
    // Customer on the platform account is the separate-charge model arriving.
    expect(setup.connectedAccountId).not.toBe(gateway.platformAccountId);
  });

  it('creates the PaymentIntent in the same Founder account, for exactly subtotal + tax', async () => {
    await makeDue(seeded.campaignId);
    const before = gateway.paymentIntents.length;
    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });
    expect(gateway.paymentIntents.length).toBe(before + 1);

    const intent = gateway.paymentIntents.at(-1)!;
    const row = await reservationRow(reservationId);
    expect(intent.connectedAccountId).toBe(seeded.connectedAccountId);
    expect(intent.amountCents).toBe(row.rewardSubtotalCents + row.salesTaxCents);
    expect(intent.amountCents).toBe(row.totalAuthorizedCents);
    expect(row.status).toBe('captured');
  });

  it('keeps the Founder as merchant of record in the domain record', async () => {
    const row = await reservationRow(reservationId);
    // The reservation carries no seller-account column of its own, and that is
    // the design: the seller is the campaign's Founder, resolved through the
    // claim profile, so there is nothing to set inconsistently. What the record
    // proves is that the charge went to that account and carried the campaign's
    // own descriptor — not Proovd's `PROOVD LISTING`, which is the one stream
    // where Proovd IS the merchant of record.
    expect(gateway.paymentIntents.at(-1)!.connectedAccountId).toBe(seeded.connectedAccountId);
    expect(row.statementDescriptor).toBeTruthy();
    expect(row.statementDescriptor).not.toContain('LISTING');

    const [build] = await h.db
      .select({ entity: campaignBuild.founderEntityDisplay })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, seeded.campaignId));
    expect(build!.entity).toBe(seeded.entity);
  });

  it('reconciles the 5% and the provisional Creator amount against the pre-tax subtotal', async () => {
    const row = await reservationRow(reservationId);
    // §24.3: sales tax is excluded from the platform fee and every Creator
    // percentage. The identity is over the SUBTOTAL, and the tax rides beside
    // it — a fee computed on the total is the classic version of this bug.
    expect(row.proovdFeeCents).toBe((row.rewardSubtotalCents * 5n) / 100n);
    // Unattributed, so nothing was provisioned for a Creator.
    expect(row.affiliateProvisionalCents).toBe(0n);
    expect(
      row.proovdFeeCents + row.affiliateProvisionalCents + row.founderGrossShareCents,
    ).toBe(row.rewardSubtotalCents);
    // And the tax is not inside any of the three.
    expect(row.salesTaxCents).toBeGreaterThan(0n);
    expect(row.rewardSubtotalCents + row.salesTaxCents).toBe(row.totalAuthorizedCents);
  });

  it('enters the retry window on a failure rather than dropping the reservation', async () => {
    const failing = await seedLiveCampaign('arch-fail');
    const pm = `pm_declined_${randomUUID().slice(0, 8)}`;
    gateway.setCaptureOutcome(pm, 'card_declined');
    const placed = await placePreorder(failing.campaignId, pm);
    expect(placed.status).toBe(201);

    await makeDue(failing.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: failing.campaignId, actor: 'system:test' });

    const row = await reservationRow(placed.reservationId!);
    expect(row.status).toBe('capture_failed_retrying');
    const [campaign] = await h.db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, failing.campaignId));
    expect(campaign!.status).toBe('capture_retry_window');
  });

  it('covers all five of §32.7’s claims', () => {
    // The register is what makes "the architecture test passes" a count rather
    // than a feeling. Each claim above is one entry.
    expect(DIRECT_ARCHITECTURE_CLAIMS).toHaveLength(5);
  });
});

describe('§24.1, §32.7 — no code path can run both charge models', () => {
  function shippedSources(): Array<{ path: string; source: string }> {
    const roots = [
      resolve(__dirname, '..'),
      resolve(__dirname, '../../../shared/src'),
      resolve(__dirname, '../../../frontend/src'),
    ];
    const files: Array<{ path: string; source: string }> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'tests' || name === 'node_modules' || name === 'qa') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.includes('.test.')) continue;
        files.push({
          path: full,
          source: readFileSync(full, 'utf8')
            // The reasoning explains at length what the product does not do;
            // a scan that could not tell an explanation from a usage would
            // force the explanations out, and they are the more valuable half.
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        });
      }
    };
    for (const root of roots) walk(root);
    return files;
  }

  it('sends no separate-charge parameter anywhere in the shipped source', () => {
    const offenders: string[] = [];
    for (const file of shippedSources()) {
      for (const symbol of BACKUP_MODE_ABSENCE.forbiddenSymbols) {
        if (file.source.includes(symbol)) offenders.push(`${file.path}: ${symbol}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships the backup-mode flag disabled, with no branch that reads it into a charge', () => {
    // §32.2 requires the flag to exist so the environment is explicit about
    // which model is enabled. What must not exist is a code path that consults
    // it while creating a charge — the flag is a declaration, not a switch.
    const readers = shippedSources().filter((file) =>
      /STRIPE_TEST_BACKUP_MODE_ENABLED|backupModeEnabled/.test(file.source),
    );
    expect(readers.map((file) => file.path.replace(/.*[\\/]src[\\/]/, ''))).toEqual(['env.ts']);
  });

  it('records the platform fee as permitted-but-not-built rather than forbidden', () => {
    // §24.1 allows the application fee "where supported" and the approved
    // configuration does not collect it, which is why 19a's unearned return has
    // no provider leg. Collapsing that into the prohibition above would make a
    // later phase enabling it look like a violation.
    expect(BACKUP_MODE_ABSENCE.notBuiltButPermitted).toContain('application_fee_amount');
  });
});

/* ══ Scope 4 — the adversarial idempotency sweep ═══════════════════════════ */

describe('scope 4 — every state-changing path has its mechanism, in the database', () => {
  async function indexExists(name: string): Promise<boolean> {
    const { rows } = await h.pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [name]);
    return rows.length > 0;
  }

  it('backs each of the three shared mechanisms with a real unique index', async () => {
    // The invariant has named three mechanisms since Phase 01. This is where
    // "all required" stops being a sentence in a document: each one is a unique
    // index a duplicate cannot get past, and a missing one would mean a whole
    // class of replays was being prevented by nothing.
    for (const index of [
      'provider_events_event_idx',
      'idempotency_keys_key_idx',
      'notification_deliveries_dedup_idx',
    ]) {
      expect(await indexExists(index), index).toBe(true);
    }
  });

  it('gives each registered money path a unique row that a second attempt collides with', async () => {
    // One per registered path that claims a row before the provider call. The
    // register says which paths those are; this says the collision is real.
    const uniqueRows: Record<string, string> = {
      close_batch: 'reservation_capture_attempts',
      capture_retry: 'reservation_capture_attempts',
      listing_checkout_completion: 'listing_fee_payments',
      listing_refund: 'listing_fee_refunds',
      fixed_payment_funding: 'creator_payment_allocations',
      affiliate_transfer: 'affiliate_transfers',
      reservation_refund: 'reservation_refunds',
      campaign_launch: 'campaign_launches',
    };
    for (const [key, table] of Object.entries(uniqueRows)) {
      const { rows } = await h.pool.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexdef LIKE 'CREATE UNIQUE%'`,
        [table],
      );
      expect(rows.length, `${key} → ${table}`).toBeGreaterThan(0);
    }
  });

  it('names every path the phase brief lists, with a mechanism each', () => {
    for (const path of IDEMPOTENT_PATHS) {
      expect(path.mechanisms.length, path.key).toBeGreaterThan(0);
      expect(path.entryPoint.length, path.key).toBeGreaterThan(0);
    }
    expect(ADVERSARIAL_CASES).toHaveLength(3);
    expect(IDEMPOTENCY_INVARIANT).toHaveLength(3);
  });
});

describe('scope 4 — the money path under all three adversarial cases', () => {
  let seeded: Seeded;
  let reservationId: string;

  beforeAll(async () => {
    seeded = await seedLiveCampaign('idem');
    const placed = await placePreorder(seeded.campaignId);
    reservationId = placed.reservationId!;
    await makeDue(seeded.campaignId);
  }, 120_000);

  it('run_twice: a second batch charges nothing more and sends nothing more', async () => {
    const intentsBefore = gateway.paymentIntents.length;
    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });
    const afterFirst = gateway.paymentIntents.length;
    const emailsAfterFirst = h.sentEmails.messages.length;

    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });

    expect(afterFirst).toBe(intentsBefore + 1);
    expect(gateway.paymentIntents.length).toBe(afterFirst);
    expect(h.sentEmails.messages.length).toBe(emailsAfterFirst);

    const attempts = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, reservationId));
    expect(attempts).toHaveLength(1);
  });

  it('deliver_twice: the same delivery and a fresh event id both change nothing', async () => {
    const row = await reservationRow(reservationId);
    const emailsBefore = h.sentEmails.messages.length;
    const captured = row.totalCapturedCents;

    const build = (eventId: string) =>
      JSON.stringify({
        id: eventId,
        object: 'event',
        type: 'payment_intent.succeeded',
        account: seeded.connectedAccountId,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: row.paymentIntentId,
            object: 'payment_intent',
            status: 'succeeded',
            amount: Number(row.totalAuthorizedCents),
            metadata: { reservationId },
          },
        },
      });

    const eventId = `evt_${randomUUID().slice(0, 12)}`;
    await signedDelivery(build(eventId)).expect(200);
    // The same event id again — the `provider_events` claim answers.
    await signedDelivery(build(eventId)).expect(200);
    // A FRESH event id carrying the same fact — the domain guard answers, which
    // is the case a `provider_events` table alone would miss.
    await signedDelivery(build(`evt_${randomUUID().slice(0, 12)}`)).expect(200);

    const after = await reservationRow(reservationId);
    expect(after.totalCapturedCents).toBe(captured);
    expect(after.status).toBe('captured');
    expect(h.sentEmails.messages.length).toBe(emailsBefore);
  });

  it('crash_midway: a provider error leaves the claim, and the resume uses the same key', async () => {
    const crashing = await seedLiveCampaign('idem-crash');
    const placed = await placePreorder(crashing.campaignId);
    await makeDue(crashing.campaignId);

    // The transport dies after the row is claimed and before the result is
    // known. This is the case a replay test cannot see: a path that called the
    // provider first and recorded second would charge twice here.
    gateway.failNextPaymentIntent('socket hang up');
    await runCloseBatch(closeDeps(), { campaignId: crashing.campaignId, actor: 'system:test' });

    const midAttempts = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, placed.reservationId!));
    expect(midAttempts).toHaveLength(1);
    const claimedKey = midAttempts[0]!.idempotencyKey;

    const intentsBefore = gateway.paymentIntents.length;
    await runCloseBatch(closeDeps(), { campaignId: crashing.campaignId, actor: 'system:test' });

    const finalAttempts = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, placed.reservationId!));
    // One attempt, one key, one intent — the resume is the SAME charge at the
    // provider rather than a second one that happened to succeed.
    expect(finalAttempts).toHaveLength(1);
    expect(finalAttempts[0]!.idempotencyKey).toBe(claimedKey);
    expect(gateway.paymentIntents.length).toBe(intentsBefore + 1);
    expect((await reservationRow(placed.reservationId!)).status).toBe('captured');
  });
});

/* ══ Scope 5 — §32.5's outcomes and §32.6's evidence log ═══════════════════ */

describe('§32.5 — every required provider outcome is exercised', () => {
  let charged: Seeded;
  let chargedReservationId: string;

  beforeAll(async () => {
    charged = await seedLiveCampaign('matrix');
  }, 120_000);

  it('successful setup and later charge', async () => {
    const placed = await placePreorder(charged.campaignId);
    expect(placed.status).toBe(201);
    chargedReservationId = placed.reservationId!;

    await makeDue(charged.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: charged.campaignId, actor: 'system:test' });

    const row = await reservationRow(chargedReservationId);
    expect(row.status).toBe('captured');
    expect(row.totalCapturedCents).toBe(row.totalAuthorizedCents);
    record('successful_setup_and_later_charge', charged, chargedReservationId, row.paymentIntentId);
  });

  /** Each decline scenario is one campaign, one reservation, one outcome. */
  async function declineScenario(
    key: string,
    outcome: MemoryCaptureOutcome,
    expectedStatus: string,
    expectedDeclineCode: string | null,
  ): Promise<void> {
    const seeded = await seedLiveCampaign(`m-${key.slice(0, 8)}`);
    const pm = `pm_${key}_${randomUUID().slice(0, 8)}`;
    gateway.setCaptureOutcome(pm, outcome);
    const placed = await placePreorder(seeded.campaignId, pm);
    expect(placed.status).toBe(201);

    await makeDue(seeded.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });

    const row = await reservationRow(placed.reservationId!);
    expect(row.status, key).toBe(expectedStatus);

    const [attempt] = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, placed.reservationId!));
    // The raw provider code lands on the attempt's internal column. `failure_code`
    // holds the decline code where the provider gave one, which is what §33.7.8's
    // classifier reads and §25.6 keeps off every customer surface.
    expect(attempt!.failureCode, key).toBe(expectedDeclineCode);

    // §33.9.11 and §25.6: the provider code is on the internal column and on no
    // customer message. This is the assertion that makes the matrix worth
    // running rather than a list of statuses.
    if (expectedDeclineCode) {
      const bodies = h.sentEmails.messages.map((m) => `${m.subject}\n${m.text}\n${m.html ?? ''}`);
      expect(bodies.some((body) => body.includes(expectedDeclineCode)), key).toBe(false);
    }

    record(key, seeded, placed.reservationId, attempt!.paymentIntentId ?? null);
  }

  it('generic decline', async () => {
    await declineScenario('generic_decline', 'card_declined', 'capture_failed_retrying', 'generic_decline');
  });

  it('insufficient funds', async () => {
    await declineScenario(
      'insufficient_funds',
      'insufficient_funds',
      'capture_failed_retrying',
      'insufficient_funds',
    );
  });

  it('off-session authentication / 3DS required', async () => {
    await declineScenario(
      'off_session_authentication_required',
      'requires_action',
      'capture_failed_retrying',
      'authentication_required',
    );
  });

  it('expired card', async () => {
    await declineScenario('expired_card', 'expired_card', 'capture_failed_retrying', 'expired_card');
  });

  it('processing / API error', async () => {
    await declineScenario(
      'processing_error',
      'processing_error',
      'capture_failed_retrying',
      'processing_error',
    );
  });

  /** The two card-save failures: §33.5.4's rule is that nothing exists after one. */
  async function setupFailureScenario(key: string, declineCode: string | null): Promise<void> {
    const seeded = await seedLiveCampaign(`s-${key.slice(0, 8)}`);
    gateway.setNextSetupOutcome('requires_payment_method', declineCode ?? undefined);
    const placed = await placePreorder(seeded.campaignId);

    expect(placed.status, key).toBeGreaterThanOrEqual(400);
    expect(placed.reservationId).toBeNull();

    // §33.5.4: "no reservation until SetupIntent succeeds". The absence is the
    // assertion — a failed card save that left a row would be a Backer holding
    // a pre-order they never completed.
    const rows = await h.db
      .select()
      .from(reservations)
      .where(eq(reservations.campaignId, seeded.campaignId));
    expect(rows, key).toHaveLength(0);

    record(key, seeded, null, null);
  }

  it('incorrect CVC', async () => {
    await setupFailureScenario('incorrect_cvc', 'incorrect_cvc');
  });

  it('setup failure', async () => {
    await setupFailureScenario('setup_failure', null);
  });

  it('full refund', async () => {
    const row = await reservationRow(chargedReservationId);
    const recorded = await recordRefundCase(refundDeps(), {
      reservationId: chargedReservationId,
      cause: 'proovd_or_system_error',
      affiliateTreatment: 'not_attributed',
      proovdFeeTreatment: 'returned_elective',
      founderLiabilityCents: 0n,
      evidence: 'the §32.5 matrix full-refund scenario',
      amountCents: row.totalCapturedCents,
      actor: 'admin:test',
    });
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;

    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const executed = await executeRefund(refundDeps(), {
      refundId: recorded.refund.id,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');
    expect((await reservationRow(chargedReservationId)).status).toBe('refunded');

    record('full_refund', charged, chargedReservationId, row.paymentIntentId);
  });

  it('partial refund', async () => {
    const seeded = await seedLiveCampaign('m-partial');
    const placed = await placePreorder(seeded.campaignId);
    await makeDue(seeded.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });

    const row = await reservationRow(placed.reservationId!);
    expect(row.status).toBe('captured');

    const recorded = await recordRefundCase(refundDeps(), {
      reservationId: placed.reservationId!,
      cause: 'proovd_or_system_error',
      affiliateTreatment: 'not_attributed',
      proovdFeeTreatment: 'returned_elective',
      founderLiabilityCents: 0n,
      evidence: 'the §32.5 matrix partial-refund scenario',
      amountCents: 1_000n,
      actor: 'admin:test',
    });
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;

    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const executed = await executeRefund(refundDeps(), {
      refundId: recorded.refund.id,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');

    // §24.8: only the WHOLE amount moves the reservation. A partial refund is a
    // record against its allocation, and the pre-order still stands.
    expect((await reservationRow(placed.reservationId!)).status).toBe('captured');

    record('partial_refund', seeded, placed.reservationId, row.paymentIntentId);
  });

  it('dispute', async () => {
    const seeded = await seedLiveCampaign('m-dispute');
    const placed = await placePreorder(seeded.campaignId);
    await makeDue(seeded.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: seeded.campaignId, actor: 'system:test' });

    const row = await reservationRow(placed.reservationId!);
    expect(row.status).toBe('captured');

    const payload = JSON.stringify({
      id: `evt_${randomUUID().slice(0, 12)}`,
      object: 'event',
      type: 'charge.dispute.created',
      account: seeded.connectedAccountId,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_${randomUUID().slice(0, 12)}`,
          object: 'dispute',
          charge: row.chargeId,
          payment_intent: row.paymentIntentId,
          amount: Number(row.totalCapturedCents),
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    });
    await signedDelivery(payload).expect(200);

    const after = await reservationRow(placed.reservationId!);
    expect(after.status).toBe('disputed');

    const [dispute] = await h.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.reservationId, placed.reservationId!));
    expect(dispute).toBeTruthy();
    // §24.11: the 24-hour Admin task is a fact of arrival, CHECK-pinned.
    expect(dispute!.taskDueAt.getTime() - dispute!.openedAt.getTime()).toBe(24 * 3_600_000);

    record('dispute', seeded, placed.reservationId, row.paymentIntentId);
  });
});

/* ══ §32.6 — the retained evidence log ═════════════════════════════════════ */

describe('§32.6 — the evidence log is complete and retained', () => {
  it('covers every §32.5 outcome, with no field missing', () => {
    const violations = evidenceLogViolations(evidence);
    expect(violations).toEqual([]);
    expect(evidence).toHaveLength(REQUIRED_TEST_OUTCOMES.length);
  });

  it('writes the log to disk, so it survives the run that produced it', () => {
    // §32.6 says "retain". A log that existed only in a terminal is not
    // retained, and §34 condition 10 puts a human in front of this to reconcile
    // provider results against internal ledgers — they need a file.
    //
    // Regenerated by the suite rather than hand-maintained, so it can never
    // describe a run that did not happen.
    const dir = resolve(__dirname, '../../../docs/evidence');
    mkdirSync(dir, { recursive: true });

    const lines = [
      '# Stripe test evidence log — Spec §32.5, §32.6',
      '',
      '> Generated by `backend/src/tests/p0-pass.test.ts`. Do not edit by hand —',
      '> re-run the suite. Every row is one §32.5 required outcome, exercised',
      '> against the in-memory gateway described below.',
      '',
      '## Environment',
      '',
      `- Stripe mode: \`${gateway.mode}\``,
      `- Locked API version: \`${gateway.apiVersion}\``,
      `- Platform account: \`${gateway.platformAccountId}\``,
      '- Gateway: the in-memory port. Signature verification is Stripe’s own',
      '  `constructEvent` over the real bytes; the payment API is replaced.',
      '',
      '## Provider data disposition',
      '',
      'Every row is recorded `marked_invalid_artifact`: no object exists at the',
      'provider for these runs, so nothing can be reconciled against a Stripe',
      'dashboard. §34 condition 10 asks a human to reconcile provider test',
      'results to internal ledgers — that reconciliation needs a run against a',
      'real test-mode account with `STRIPE_PLATFORM_SECRET_KEY` configured and',
      'the CLI forwarding webhooks, and it is an open item until it happens.',
      '',
      '## Scenarios',
      '',
      '| Scenario | Result | Campaign | Reservation | PaymentIntent | Endpoint | Disposition |',
      '|---|---|---|---|---|---|---|',
      ...evidence.map(
        (entry) =>
          `| ${entry.scenario} | ${entry.result} | \`${entry.campaignId}\` | ` +
          `${entry.reservationId ? `\`${entry.reservationId}\`` : '—'} | ` +
          `${entry.paymentIntentId ? `\`${entry.paymentIntentId}\`` : '—'} | ` +
          `${entry.webhookEndpoint ?? '—'} | ${entry.providerDataDisposition} |`,
      ),
      '',
      '## Connected accounts',
      '',
      ...evidence.map((entry) => `- ${entry.scenario}: ${entry.connectedAccountIds.join(', ')}`),
      '',
    ];

    const file = join(dir, 'stripe-test-matrix.md');
    writeFileSync(file, lines.join('\n'), 'utf8');
    expect(readFileSync(file, 'utf8')).toContain('Stripe test evidence log');
  });

  it('names an official test card for every outcome, and ships none of them', () => {
    for (const outcome of REQUIRED_TEST_OUTCOMES) {
      expect(STRIPE_TEST_CARDS[outcome.key], outcome.key).toMatch(/^\d{16}$/);
    }

    // §32.2: "No test cards or test controls appear in production UI." The
    // numbers exist in this file and must exist nowhere that ships — including
    // `shared/`, which the browser bundle carries.
    const numbers = [...new Set(Object.values(STRIPE_TEST_CARDS))];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        // Test files are not shipped; §32.2 is about production UI.
        if (name.includes('.test.')) continue;
        const source = readFileSync(full, 'utf8');
        for (const number of numbers) {
          if (source.includes(number)) offenders.push(`${full}: ${number}`);
        }
      }
    };
    walk(resolve(__dirname, '..'));
    walk(resolve(__dirname, '../../../shared/src'));
    walk(resolve(__dirname, '../../../frontend/src'));
    expect(offenders).toEqual([]);
  });
});
