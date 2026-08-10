/**
 * Phase 18a — the §21 close batch: threshold resolution, tax validation,
 * off-session capture, and the one 48-hour recovery window.
 *
 * Acceptance: §33.7.3 (screen/email show US$0 and duplicate cancel is
 * harmless), §33.7.4 (threshold miss / pre-charge kill creates no
 * PaymentIntent and no refund object), §33.7.5 (the Idea threshold is fixed at
 * close and payment failures do not reverse success), §33.7.6 (Product
 * charges every active transaction regardless of internal target), §33.7.7
 * (batch run twice, duplicate webhooks, and crash/restart cause no double
 * charge, earnings, or email), §33.7.8 (decline, insufficient funds, and
 * requires-action all enter the correct 48-hour recovery) — plus the §21
 * tax-unusable drop, the §4.1 dedup fold at close, and the drift tests pinning
 * the backend restatements against `@proovd/shared`.
 *
 * The gateway is the in-memory one: real webhook signature verification (the
 * suite signs with Stripe's own helper, so `constructEvent` is what runs),
 * fake payment API with per-card capture outcomes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_CONNECT_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, reservations, campaignPaymentFlags, reservationStatusHistory } from '../db/schema/domain.js';
import { campaignCloseBatches, reservationCaptureAttempts } from '../db/schema/close.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts, providerObjects } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { backerIdentities, deduplicationCases, founderOperationalShares } from '../db/schema/reservations.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { runCloseBatch, sweepCampaignCloses, findCloseBatch, captureAttemptKey } from '../close/close-batch.js';
import { cancelReservation } from '../reservations/cancellation.js';
import { decideDeduplicationCase } from '../reservations/dedup-admin.js';
import { enforceCampaign } from '../support/enforcement.js';
import {
  CLOSE_BATCH_STEP_KEYS,
  CAPTURE_FAILURE_KINDS as BACKEND_FAILURE_KINDS,
  classifyCaptureFailure as backendClassify,
  foldMergedIdentities as backendFold,
  ideaCloseThresholdMet as backendMet,
  captureLedger,
  provisionalPercent,
  validateCaptureUsability,
} from '../close/logic.js';
import {
  FAILED_PAYMENT_TEMPLATE as BACKEND_B5,
  NO_MONEY_MOVED_STATE as BACKEND_NO_MONEY,
  THRESHOLD_MISS_REASON as BACKEND_MISS_REASON,
  TAX_UNUSABLE_DROP_REASON as BACKEND_DROP_REASON,
  resolveFailedPaymentCopy as backendResolveB5,
} from '../close/restated.js';
import {
  CLOSE_BATCH_STEPS,
  CAPTURE_FAILURE_KINDS as SHARED_FAILURE_KINDS,
  classifyCaptureFailure as sharedClassify,
  foldMergedIdentities as sharedFold,
  ideaCloseThresholdMet as sharedMet,
  FAILED_PAYMENT_TEMPLATE as SHARED_B5,
  NO_MONEY_MOVED_STATE as SHARED_NO_MONEY,
  THRESHOLD_MISS_REASON as SHARED_MISS_REASON,
  TAX_UNUSABLE_DROP_REASON as SHARED_DROP_REASON,
  resolveFailedPaymentCopy as sharedResolveB5,
  computeWaterfall,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_close_suite';
const CONNECT_SECRET = 'whsec_connect_for_close_suite';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

const CONTEXT = {
  appBaseUrl: 'http://localhost:3000',
  supportEmail: 'support@proovd.co',
  fromAddress: 'hello@proovd.co',
};

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'close-batch',
  );
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function closeDeps() {
  return {
    db: h.db,
    gateway,
    audit,
    notifier: h.notifier,
    context: CONTEXT,
    tokens: h.tokens,
  };
}

/* ── Seeding (the backer-cancellation shape) ────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; closeInHours?: number; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `close-founder-${label}`);
  const closeAt = new Date(Date.now() + (opts.closeInHours ?? 14 * 24) * 3_600_000);

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
      type: opts.type,
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
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const stripeAccountId = `acct_${label}${randomUUID().slice(0, 8)}`;
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
    founderEntityDisplay: `${label} Labs LLC`,
    closesAt: closeAt,
    ...(opts.orderThreshold !== undefined ? { orderThreshold: opts.orderThreshold } : {}),
    ...(opts.type === 'pre_launch'
      ? { refundPolicyTitle: `${label} Refund`, refundPolicyVersion: 'v1', refundPolicySourceUrl: 'https://app.proovd.co/r' }
      : {}),
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values([
    { campaignId, sku: 'TIER-1', title: 'Reward 1', priceCents: 2_500n, contents: 'x', fulfillmentCommitment: 'y', delivery: 'December 2026', sortOrder: 0 },
    { campaignId, sku: 'TIER-2', title: 'Reward 2', priceCents: 4_000n, contents: 'x', fulfillmentCommitment: 'y', delivery: 'December 2026', sortOrder: 1 },
  ]);

  return { campaignId, founderUserId: founder.id, connectedAccountId: stripeAccountId };
}

let n = 0;
function contact() {
  n += 1;
  return { email: `close${n}-${randomUUID().slice(0, 6)}@example.com`, phone: `41777720${String(n).padStart(2, '0')}` };
}

function preorderBody(over: Record<string, unknown> = {}) {
  return {
    rewardSku: 'TIER-1',
    contact: contact(),
    billing: { country: 'US', postalCode: '10001', state: 'NY' },
    ageConfirmed: true,
    survey: { why: 'want it', recommend: 7 },
    operationalSharingAck: true,
    founderMarketingConsent: false,
    newsletterConsent: false,
    paymentMethodId: `pm_${randomUUID().slice(0, 12)}`,
    ...over,
  };
}

async function placePreorder(campaignId: string, body: Record<string, unknown>) {
  const res = await request(h.app).post(`/api/campaign/${campaignId}/preorder`).send(body);
  expect(res.status).toBe(201);
  return res.body.reservationId as string;
}

/** Moves the close anchor into the past so the batch is due. */
async function makeDue(campaignId: string): Promise<void> {
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
}

function piCountFor(connectedAccountId: string): number {
  return gateway.paymentIntents.filter((p) => p.connectedAccountId === connectedAccountId).length;
}

function emailsMatching(predicate: (text: string) => boolean): number {
  return h.sentEmails.messages.filter((m) => predicate(`${m.subject}\n${m.text}`)).length;
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

/** Asserts a database refusal whose trigger message Drizzle wraps in a cause. */
async function expectDbRefusal(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeTruthy();
  const messages: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
}

function eventBody(input: { id?: string; type: string; object: Record<string, unknown> }): string {
  return JSON.stringify({
    id: input.id ?? `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
}

/* ── Drift: the backend restatements match @proovd/shared ───────────────────── */

describe('drift — the close registers and kernels match the shared originals', () => {
  it('restates the eight §21 steps', () => {
    expect([...CLOSE_BATCH_STEP_KEYS]).toEqual(CLOSE_BATCH_STEPS.map((s) => s.key));
  });

  it('restates the §33.7.8 failure kinds and the classifier', () => {
    expect([...BACKEND_FAILURE_KINDS]).toEqual([...SHARED_FAILURE_KINDS]);
    for (const probe of [
      { declineCode: 'insufficient_funds' },
      { declineCode: 'do_not_honor' },
      { status: 'requires_action' },
      {},
    ]) {
      expect(backendClassify(probe)).toBe(sharedClassify(probe));
    }
  });

  it('restates the §4.1 fold and the threshold kernel', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const pairs: Array<readonly [string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
    ];
    expect(backendFold(ids, pairs)).toBe(sharedFold(ids, pairs));
    for (const [unique, threshold] of [
      [9, 10],
      [10, 10],
      [11, 10],
    ] as const) {
      expect(backendMet(unique, threshold)).toBe(sharedMet(unique, threshold));
    }
  });

  it('restates Appendix B.5 character-for-character, with the same resolver', () => {
    expect(BACKEND_B5).toBe(SHARED_B5);
    expect(BACKEND_NO_MONEY).toBe(SHARED_NO_MONEY);
    expect(BACKEND_MISS_REASON).toBe(SHARED_MISS_REASON);
    expect(BACKEND_DROP_REASON).toBe(SHARED_DROP_REASON);
    const vars = {
      moneyMovedState: SHARED_NO_MONEY,
      campaignTitle: 'Drift Kettle',
      rewardTitle: 'Tier',
      rewardSubtotal: '25.00',
      salesTax: '2.00',
      totalAttempted: '27.00',
      updateByLocal: 'August 6, 2026 7:40 PM UTC',
      updateByUtc: 'August 6, 2026 7:40 PM UTC',
    };
    expect(backendResolveB5(vars)).toEqual(sharedResolveB5(vars));
  });

  it('the §24.3 capture ledger agrees with the one shared waterfall', () => {
    for (const subtotal of [1n, 99n, 2_500n, 4_001n, 1_000_000n]) {
      for (const percent of [0, 20, 25, 50]) {
        const shared = computeWaterfall({ rewardSubtotalCents: subtotal, affiliatePercent: percent });
        const backend = captureLedger({
          rewardSubtotalCents: subtotal,
          platformFeePercent: 5,
          provisionalAffiliatePercent: percent,
        });
        expect(backend.proovdFeeCents).toBe(shared.proovdFeeCents);
        expect(backend.affiliateProvisionalCents).toBe(shared.affiliateCompensationCents);
        expect(backend.founderGrossShareCents).toBe(shared.founderGrossShareCents);
        expect(
          backend.proovdFeeCents + backend.affiliateProvisionalCents + backend.founderGrossShareCents,
        ).toBe(subtotal);
      }
    }
  });

  it('§24.4: the provisional percentage is the maximum that could be owed, bounded', () => {
    expect(provisionalPercent({ lockedTotalPercent: 20, bonuses: [], ceilingPercent: 50 })).toBe(20);
    expect(
      provisionalPercent({
        lockedTotalPercent: 20,
        bonuses: [{ additionalPercent: 10, maxCombinedPercent: 25 }],
        ceilingPercent: 50,
      }),
    ).toBe(25);
    expect(
      provisionalPercent({
        lockedTotalPercent: 45,
        bonuses: [{ additionalPercent: 10, maxCombinedPercent: 60 }],
        ceilingPercent: 50,
      }),
    ).toBe(50);
  });
});

/* ── §33.7.3 — screen/email show US$0 and duplicate cancel is harmless ─────── */

describe('§33.7.3 — cancellation shows US$0 on screen and in email, duplicated harmlessly', () => {
  it('the cancel response and the B.4 email both state US$0, and a duplicate changes nothing', async () => {
    const c = await seedLiveCampaign('t3', { type: 'pre_launch' });
    const reservationId = await placePreorder(c.campaignId, preorderBody());

    // The magic link from the confirmation email is the Backer's only way in.
    const confirmation = [...h.sentEmails.messages]
      .reverse()
      .find((m) => m.text.includes(reservationId));
    const raw = confirmation?.text.match(/\/backer\/([A-Za-z0-9_.-]+)/)?.[1];
    expect(raw).toBeTruthy();

    const first = await request(h.app).post(`/api/link/${raw}/reservations/${reservationId}/cancel`).send({});
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('canceled');
    // The screen's answer (§33.7.3): US$0, stated, not implied.
    expect(first.body.amountCharged).toBe('US$0');

    const b4 = [...h.sentEmails.messages].reverse().find((m) => m.subject.includes('Canceled'));
    expect(b4).toBeTruthy();
    expect(b4!.text).toContain('Amount charged: US$0');

    const emailCount = h.sentEmails.messages.length;
    const second = await request(h.app).post(`/api/link/${raw}/reservations/${reservationId}/cancel`).send({});
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already_canceled');
    expect(second.body.amountCharged).toBe('US$0');
    expect(h.sentEmails.messages.length).toBe(emailCount); // no second email

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));
    expect(row!.status).toBe('reserved_canceled');
    const history = await h.db
      .select()
      .from(reservationStatusHistory)
      .where(eq(reservationStatusHistory.reservationId, reservationId));
    // creation → reserved_active, then one cancellation. Never two cancel rows.
    expect(history.filter((r) => r.toStatus === 'reserved_canceled')).toHaveLength(1);
  });
});

/* ── §33.7.4 — threshold miss / pre-charge kill: no PaymentIntent, no refund ── */

describe('§33.7.4 — threshold miss and pre-charge kill create no PaymentIntent and no refund object', () => {
  it('an Idea campaign below threshold closes every reservation at US$0 with no provider objects', async () => {
    const c = await seedLiveCampaign('t4', { type: 'pre_build', orderThreshold: 5 });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    const r2 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);

    const pisBefore = piCountFor(c.connectedAccountId);
    const refundsBefore = gateway.refunds.length;

    const outcome = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(outcome.status).toBe('complete');
    expect(outcome.noCharge).toBe(2);

    // §21 step 5: no PaymentIntent, and nothing to refund — so no refund object.
    expect(piCountFor(c.connectedAccountId)).toBe(pisBefore);
    expect(gateway.refunds.length).toBe(refundsBefore);
    const objects = await h.db
      .select()
      .from(providerObjects)
      .where(eq(providerObjects.campaignId, c.campaignId));
    expect(objects.filter((o) => o.objectType === 'payment_intent')).toHaveLength(0);
    expect(objects.filter((o) => o.objectType === 'refund')).toHaveLength(0);

    for (const id of [r1, r2]) {
      const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id));
      expect(row!.status).toBe('threshold_not_met_no_charge');
      // The successful SetupIntent stays historical (§23.5).
      expect(row!.setupIntentId).not.toBeNull();
      const [share] = await h.db
        .select()
        .from(founderOperationalShares)
        .where(eq(founderOperationalShares.reservationId, id));
      expect(share!.fulfillmentState).toBe('do_not_fulfill');
    }

    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('ended_no_charge');

    const batch = await findCloseBatch(h.db, c.campaignId);
    expect(batch!.thresholdMet).toBe(false);
    expect(batch!.uniqueActiveBackers).toBe(2);
    expect(batch!.completedAt).not.toBeNull();

    // The US$0 closure reached each Backer, and the Founder got Campaign ended.
    expect(emailsMatching((t) => t.includes(r1) && t.includes('Amount charged: US$0'))).toBe(1);
    expect(emailsMatching((t) => t.includes(r2) && t.includes('Amount charged: US$0'))).toBe(1);
    expect(emailsMatching((t) => t.includes('Campaign ended') && t.includes(c.campaignId))).toBe(1);

    // Run twice: nothing new (§33.7.7's rule on the miss path).
    const emailCount = h.sentEmails.messages.length;
    const again = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(again.status).toBe('already_complete');
    expect(h.sentEmails.messages.length).toBe(emailCount);
    expect(piCountFor(c.connectedAccountId)).toBe(pisBefore);
  });

  it('a pre-charge kill closes reservations without any PaymentIntent or refund object', async () => {
    const c = await seedLiveCampaign('t4k', { type: 'pre_launch' });
    const r1 = await placePreorder(c.campaignId, preorderBody());

    const pisBefore = piCountFor(c.connectedAccountId);
    const refundsBefore = gateway.refunds.length;

    const outcome = await enforceCampaign(
      { db: h.db },
      {
        campaignId: c.campaignId,
        action: 'kill',
        reasonCategory: 'fraud',
        reasonDetail: 'test kill before capture',
        customerExplanation: 'This campaign was ended by Proovd before any charge occurred.',
        actor: 'admin:test',
        mfaContext: 'password_session_admin_role_verified',
        reauthContext: 'fresh',
      },
    );
    expect(outcome.ok).toBe(true);

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, r1));
    expect(row!.status).toBe('killed_no_charge');
    expect(piCountFor(c.connectedAccountId)).toBe(pisBefore);
    expect(gateway.refunds.length).toBe(refundsBefore);

    // A killed campaign is out of the close sweep's reach — the lifecycle IS
    // the "block future PaymentIntents" enforcement (§26.7).
    const closed = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(closed.status).toBe('not_closable');
  });
});

/* ── §33.7.5 — the Idea threshold is fixed at close ─────────────────────────── */

describe('§33.7.5 — the threshold decision is fixed at close and failures never reverse it', () => {
  it('a met threshold stays met when cards later fail, and the decision is immutable', async () => {
    const c = await seedLiveCampaign('t5', { type: 'pre_build', orderThreshold: 2 });
    const okBody = preorderBody();
    const failBody = preorderBody();
    const r1 = await placePreorder(c.campaignId, okBody);
    const r2 = await placePreorder(c.campaignId, failBody);
    const r3 = await placePreorder(c.campaignId, preorderBody());
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);

    const outcome = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(outcome.status).toBe('complete');
    expect(outcome.captured).toBe(2);
    expect(outcome.failed).toBe(1);

    const batch = await findCloseBatch(h.db, c.campaignId);
    expect(batch!.thresholdMet).toBe(true);
    expect(batch!.uniqueActiveBackers).toBe(3);

    // §33.7.5: the failed card did not reverse success — the campaign is in
    // the retry window, not ended_no_charge, and captures stand.
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('capture_retry_window');
    for (const [id, status] of [
      [r1, 'captured'],
      [r2, 'capture_failed_retrying'],
      [r3, 'captured'],
    ] as const) {
      const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id));
      expect(row!.status).toBe(status);
    }

    // The database refuses to move the decision (§33.7.5's own sentence).
    await expectDbRefusal(
      h.db
        .update(campaignCloseBatches)
        .set({ thresholdMet: false })
        .where(eq(campaignCloseBatches.campaignId, c.campaignId)),
      /fixed at close/,
    );
  });

  it('cancellation ends at the close anchor itself', async () => {
    const c = await seedLiveCampaign('t5c', { type: 'pre_build', orderThreshold: 1 });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);

    // The batch has not run yet — the anchor alone closes cancellation (§21).
    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, r1));
    const refused = await cancelReservation(
      { db: h.db, gateway, audit },
      { reservationId: r1, backerIdentityId: row!.backerIdentityId, actor: 'backer:test' },
    );
    expect(refused.status).toBe('not_cancelable');
  });
});

/* ── §33.7.6 — Product charges every active transaction ─────────────────────── */

describe('§33.7.6 — Product charges every active transaction regardless of internal target', () => {
  it('captures each active transaction for its exact authorized total', async () => {
    const c = await seedLiveCampaign('t6', { type: 'pre_launch' });
    // One Backer with two transactions plus a second Backer — three charges.
    const backer = contact();
    const sharedPm = `pm_shared_${randomUUID().slice(0, 8)}`;
    const r1 = await placePreorder(c.campaignId, preorderBody({ contact: backer, rewardSku: 'TIER-1', paymentMethodId: sharedPm }));
    const r2 = await placePreorder(c.campaignId, preorderBody({ contact: backer, rewardSku: 'TIER-2', paymentMethodId: sharedPm }));
    const r3 = await placePreorder(c.campaignId, preorderBody());
    // A canceled transaction is excluded (§21 step 2).
    const rCancel = await placePreorder(c.campaignId, preorderBody());
    const [cRow] = await h.db.select().from(reservations).where(eq(reservations.id, rCancel));
    await cancelReservation(
      { db: h.db, gateway, audit, connectedAccountId: c.connectedAccountId },
      { reservationId: rCancel, backerIdentityId: cRow!.backerIdentityId, actor: 'backer:test' },
    );
    await makeDue(c.campaignId);

    const outcome = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(outcome.status).toBe('complete');
    expect(outcome.captured).toBe(3);

    let expectedSubtotal = 0n;
    let expectedTax = 0n;
    let expectedTotal = 0n;
    for (const id of [r1, r2, r3]) {
      const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id));
      expect(row!.status).toBe('captured');
      expect(row!.paymentIntentId).not.toBeNull();
      expect(row!.totalCapturedCents).toBe(row!.totalAuthorizedCents);
      // §24.3: fee floors at 5%, gross is the exact remainder, tax excluded.
      const expected = computeWaterfall({ rewardSubtotalCents: row!.rewardSubtotalCents, affiliatePercent: 0 });
      expect(row!.proovdFeeCents).toBe(expected.proovdFeeCents);
      expect(row!.founderGrossShareCents).toBe(expected.founderGrossShareCents);
      expect(row!.affiliateProvisionalCents).toBe(0n);
      expectedSubtotal += row!.rewardSubtotalCents;
      expectedTax += row!.salesTaxCents;
      expectedTotal += row!.totalCapturedCents;

      // The exact authorized amount reached the provider — never substituted.
      const pi = gateway.paymentIntents.find((p) => p.id === row!.paymentIntentId);
      expect(pi!.amountCents).toBe(row!.totalAuthorizedCents);
    }

    // The canceled one was excluded and never charged (§33.7.1's rule at close).
    const [canceled] = await h.db.select().from(reservations).where(eq(reservations.id, rCancel));
    expect(canceled!.status).toBe('reserved_canceled');
    expect(canceled!.paymentIntentId).toBeNull();

    // Campaign aggregates carry the same numbers (§21, 16a's money controls).
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('closed_reconciling');
    expect(campaign!.rewardSubtotalCapturedCents).toBe(expectedSubtotal);
    expect(campaign!.salesTaxCapturedCents).toBe(expectedTax);
    expect(campaign!.totalCapturedCents).toBe(expectedTotal);

    // A receipt per captured transaction, each stating the total.
    for (const id of [r1, r2, r3]) {
      expect(emailsMatching((t) => t.includes(id) && t.includes('Total charged: US$'))).toBe(1);
    }
  });
});

/* ── §33.7.7 — batch twice, duplicate webhooks, crash/restart ───────────────── */

describe('§33.7.7 — no double charge, earnings, or email under retry, redelivery, or crash', () => {
  it('running the batch twice changes nothing', async () => {
    const c = await seedLiveCampaign('t7a', { type: 'pre_launch' });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    const r2 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);

    const first = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(first.status).toBe('complete');
    const pisAfterFirst = piCountFor(c.connectedAccountId);
    const emailsAfterFirst = h.sentEmails.messages.length;
    const [campaignAfterFirst] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));

    const second = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(second.status).toBe('already_complete');
    expect(piCountFor(c.connectedAccountId)).toBe(pisAfterFirst);
    expect(h.sentEmails.messages.length).toBe(emailsAfterFirst);

    const [campaignAfterSecond] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaignAfterSecond!.totalCapturedCents).toBe(campaignAfterFirst!.totalCapturedCents);
    expect(campaignAfterSecond!.proovdFeeCents).toBe(campaignAfterFirst!.proovdFeeCents);

    // One attempt row per reservation, attempt 1, under the stable key.
    for (const id of [r1, r2]) {
      const attempts = await h.db
        .select()
        .from(reservationCaptureAttempts)
        .where(eq(reservationCaptureAttempts.reservationId, id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.idempotencyKey).toBe(captureAttemptKey(id, 1));
      expect(attempts[0]!.outcome).toBe('succeeded');
    }
  });

  it('duplicate and re-sent webhooks apply nothing twice', async () => {
    const c = await seedLiveCampaign('t7b', { type: 'pre_launch' });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, r1));
    expect(row!.status).toBe('captured');
    const ledgerBefore = {
      total: row!.totalCapturedCents,
      fee: row!.proovdFeeCents,
    };
    const [campaignBefore] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    const emailsBefore = h.sentEmails.messages.length;

    const payload = eventBody({
      type: 'payment_intent.succeeded',
      object: {
        id: row!.paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        latest_charge: row!.chargeId,
        metadata: { proovd_reservation_id: r1, proovd_campaign_id: c.campaignId },
      },
    });

    // The same event id delivered twice: the second is a provider_events dedup.
    const firstDelivery = await signedDelivery(payload);
    expect(firstDelivery.status).toBe(200);
    const secondDelivery = await signedDelivery(payload);
    expect(secondDelivery.status).toBe(200);
    expect(secondDelivery.body.outcome).toBe('duplicate');

    // A FRESH event id for the same PaymentIntent: the handler runs and the
    // applier no-ops — no ledger change, no second receipt.
    const fresh = await signedDelivery(
      eventBody({
        type: 'payment_intent.succeeded',
        object: {
          id: row!.paymentIntentId,
          object: 'payment_intent',
          status: 'succeeded',
          latest_charge: row!.chargeId,
          metadata: { proovd_reservation_id: r1, proovd_campaign_id: c.campaignId },
        },
      }),
    );
    expect(fresh.status).toBe(200);

    const [after] = await h.db.select().from(reservations).where(eq(reservations.id, r1));
    expect(after!.totalCapturedCents).toBe(ledgerBefore.total);
    expect(after!.proovdFeeCents).toBe(ledgerBefore.fee);
    const [campaignAfter] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaignAfter!.totalCapturedCents).toBe(campaignBefore!.totalCapturedCents);
    expect(h.sentEmails.messages.length).toBe(emailsBefore);
  });

  it('a crash mid-batch resumes cleanly under the same attempt keys', async () => {
    const c = await seedLiveCampaign('t7c', { type: 'pre_launch' });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    const r2 = await placePreorder(c.campaignId, preorderBody());
    const r3 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);

    // The first provider call dies at the transport — the worker "crashes"
    // partway: one attempt unresolved, the rest of the run continues.
    gateway.failNextPaymentIntent('simulated transport failure');
    const first = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(first.status).toBe('incomplete');
    expect(first.errored).toBe(1);
    expect(first.captured).toBe(2);

    // The batch is visibly incomplete; the campaign has not moved on; the
    // errored reservation is still locked (§33.7.12's substrate).
    const midBatch = await findCloseBatch(h.db, c.campaignId);
    expect(midBatch!.completedAt).toBeNull();
    const [campaignMid] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaignMid!.status).toBe('closed_pending_capture');
    const [pendingCount] = await h.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(and(eq(reservations.campaignId, c.campaignId), eq(reservations.status, 'pending_capture')));
    expect(Number(pendingCount!.count)).toBe(1);

    // Restart: the sweep resumes the batch. Same keys, no second charge.
    const { batches } = await sweepCampaignCloses(closeDeps());
    const resumed = batches.find((b) => b.campaignId === c.campaignId);
    expect(resumed!.status).toBe('complete');

    expect(piCountFor(c.connectedAccountId)).toBe(3); // one intent per reservation, ever
    for (const id of [r1, r2, r3]) {
      const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id));
      expect(row!.status).toBe('captured');
      const attempts = await h.db
        .select()
        .from(reservationCaptureAttempts)
        .where(eq(reservationCaptureAttempts.reservationId, id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.outcome).toBe('succeeded');
      // One receipt each, even for the reservation whose first attempt errored.
      expect(emailsMatching((t) => t.includes(id) && t.includes('Total charged: US$'))).toBe(1);
    }

    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('closed_reconciling');
    // Ledger written exactly once per reservation.
    const rows = await h.db
      .select()
      .from(reservations)
      .where(eq(reservations.campaignId, c.campaignId));
    const expectedTotal = rows.reduce((sum, r) => sum + r.totalCapturedCents, 0n);
    expect(campaign!.totalCapturedCents).toBe(expectedTotal);
  });
});

/* ── §33.7.8 — decline, insufficient funds, requires-action → 48-hour recovery ─ */

describe('§33.7.8 — every retryable failure enters the one correct 48-hour recovery', () => {
  it('declines, insufficient funds, and requires-action all enter capture_failed_retrying with one fixed window', async () => {
    const c = await seedLiveCampaign('t8', { type: 'pre_launch' });
    const declineBody = preorderBody();
    const insufficientBody = preorderBody();
    const actionBody = preorderBody();
    const r1 = await placePreorder(c.campaignId, declineBody);
    const r2 = await placePreorder(c.campaignId, insufficientBody);
    const r3 = await placePreorder(c.campaignId, actionBody);
    gateway.setCaptureOutcome(declineBody.paymentMethodId as string, 'card_declined');
    gateway.setCaptureOutcome(insufficientBody.paymentMethodId as string, 'insufficient_funds');
    gateway.setCaptureOutcome(actionBody.paymentMethodId as string, 'requires_action');
    await makeDue(c.campaignId);

    const outcome = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(outcome.status).toBe('complete');
    expect(outcome.failed).toBe(3);

    for (const [id, kind] of [
      [r1, 'card_declined'],
      [r2, 'insufficient_funds'],
      [r3, 'requires_action'],
    ] as const) {
      const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id));
      expect(row!.status).toBe('capture_failed_retrying');
      expect(row!.captureReason).toBe(kind);
      // The B.5 recovery reached the Backer with the deadline and one action,
      // and never the raw provider code (§25.6, §33.9.11).
      const b5 = h.sentEmails.messages.filter(
        (m) => m.text.includes(id) && m.text.includes('We could not complete this pre-order charge.'),
      );
      expect(b5).toHaveLength(1);
      expect(b5[0]!.text).toContain('Update by:');
      expect(b5[0]!.text).toContain('UPDATE CARD');
      expect(b5[0]!.text).toContain('No money has moved');
      expect(b5[0]!.text).not.toContain('generic_decline');
      expect(b5[0]!.text).not.toContain('insufficient_funds');
    }

    // ONE window, anchored at the FIRST failure, exactly 48 hours (§21 step 8).
    const batch = await findCloseBatch(h.db, c.campaignId);
    expect(batch!.firstFailureAt).not.toBeNull();
    expect(batch!.retryDeadlineAt).not.toBeNull();
    expect(batch!.retryWindowHours).toBe(48);
    expect(batch!.retryDeadlineAt!.getTime() - batch!.firstFailureAt!.getTime()).toBe(48 * 3_600_000);

    // The window is fixed: the database refuses to move it.
    await expectDbRefusal(
      h.db
        .update(campaignCloseBatches)
        .set({ firstFailureAt: new Date() })
        .where(eq(campaignCloseBatches.campaignId, c.campaignId)),
      /fixed at the first close-batch failure/,
    );

    // §23.1 + §23.3: the campaign entered capture_retry_window and the
    // `retrying` payment flag is its own row, not a lifecycle value.
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('capture_retry_window');
    const flags = await h.db
      .select()
      .from(campaignPaymentFlags)
      .where(and(eq(campaignPaymentFlags.campaignId, c.campaignId), eq(campaignPaymentFlags.flag, 'retrying')));
    expect(flags).toHaveLength(1);

    // The raw provider code lives on the attempt row, internally (§25.6).
    const [attempt] = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, r2));
    expect(attempt!.failureCode).toBe('insufficient_funds');
  });
});

/* ── §21 step 6 — the tax-unusable drop ─────────────────────────────────────── */

describe('§21 — an unusable tax calculation drops the reservation, never substitutes a total', () => {
  it('an expired stored calculation creates no PaymentIntent and closes at US$0', async () => {
    const c = await seedLiveCampaign('t9', { type: 'pre_launch' });
    const rOk = await placePreorder(c.campaignId, preorderBody());
    const rExpired = await placePreorder(c.campaignId, preorderBody());
    await h.db
      .update(reservations)
      .set({ taxCalculationExpiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(reservations.id, rExpired));
    await makeDue(c.campaignId);

    const outcome = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(outcome.status).toBe('complete');
    expect(outcome.captured).toBe(1);
    expect(outcome.dropped).toBe(1);

    const [dropped] = await h.db.select().from(reservations).where(eq(reservations.id, rExpired));
    expect(dropped!.status).toBe('capture_failed_dropped');
    expect(dropped!.captureReason).toBe('tax_calculation_unusable');
    expect(dropped!.taxCloseUsable).toBe(false);
    expect(dropped!.paymentIntentId).toBeNull();
    // No intent for the dropped one — and certainly not one at a recalculated
    // amount. The captured one charged exactly its own authorized total.
    const droppedPis = gateway.paymentIntents.filter((p) =>
      p.idempotencyKey.includes(rExpired),
    );
    expect(droppedPis).toHaveLength(0);

    const [okRow] = await h.db.select().from(reservations).where(eq(reservations.id, rOk));
    expect(okRow!.status).toBe('captured');
    expect(okRow!.taxCloseUsable).toBe(true);

    // The dropped Backer heard US$0, the fulfillment record says do-not-fulfill.
    expect(emailsMatching((t) => t.includes(rExpired) && t.includes('Amount charged: US$0'))).toBe(1);
    const [share] = await h.db
      .select()
      .from(founderOperationalShares)
      .where(eq(founderOperationalShares.reservationId, rExpired));
    expect(share!.fulfillmentState).toBe('do_not_fulfill');
  });
});

/* ── §4.1 — the dedup fold and the waiting batch ────────────────────────────── */

describe('§4.1 — merged duplicates fold into one unique Backer at close, and open cases block', () => {
  it('an open case parks the batch; the Admin decision resumes it and the fold decides the threshold', async () => {
    const c = await seedLiveCampaign('t10', { type: 'pre_build', orderThreshold: 3 });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    const r2 = await placePreorder(c.campaignId, preorderBody());
    const r3 = await placePreorder(c.campaignId, preorderBody());

    // Open a suspected-duplicate case between two of the three identities.
    const [rowA] = await h.db.select().from(reservations).where(eq(reservations.id, r2));
    const [rowB] = await h.db.select().from(reservations).where(eq(reservations.id, r3));
    const [openCase] = await h.db
      .insert(deduplicationCases)
      .values({
        campaignId: c.campaignId,
        primaryBackerIdentityId: rowA!.backerIdentityId,
        suspectedBackerIdentityId: rowB!.backerIdentityId,
        signals: ['payment_fingerprint'],
      })
      .returning({ id: deduplicationCases.id });
    await makeDue(c.campaignId);

    const blocked = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(blocked.status).toBe('waiting_dedup_resolution');

    // Nothing was decided, nothing was charged, and the reservations wait.
    const parked = await findCloseBatch(h.db, c.campaignId);
    expect(parked!.thresholdDecidedAt).toBeNull();
    expect(piCountFor(c.connectedAccountId)).toBe(0);
    const [r1Row] = await h.db.select().from(reservations).where(eq(reservations.id, r1));
    expect(r1Row!.status).toBe('reserved_active');

    // Admin merges: three identities are two practical unique Backers.
    const decided = await decideDeduplicationCase(h.db, audit, {
      caseId: openCase!.id,
      decision: 'merged',
      reason: 'same card fingerprint and matching contact pattern',
      actor: 'admin:test',
    });
    expect(decided.status).toBe('decided');

    const resumed = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(resumed.status).toBe('complete');

    const batch = await findCloseBatch(h.db, c.campaignId);
    expect(batch!.uniqueActiveBackers).toBe(2); // folded (§4.1)
    expect(batch!.thresholdMet).toBe(false); // 2 < 3
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('ended_no_charge');
  });
});

/* ── §33.7.11's seam — Campaign ended is its own event, sent at close ──────── */

describe('`Campaign ended` fires at close as its own event (§33.7.11, 18a half)', () => {
  it('sends founder_campaign_ended once and never a results_ready in this phase', async () => {
    const c = await seedLiveCampaign('t11', { type: 'pre_launch' });
    await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const ended = await h.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventKey, 'founder_campaign_ended'),
          eq(notificationDeliveries.entityId, c.campaignId),
        ),
      );
    expect(ended).toHaveLength(1);

    const results = await h.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventKey, 'founder_results_ready'),
          eq(notificationDeliveries.entityId, c.campaignId),
        ),
      );
    // Results ready is Phase 18b's, prepared after retry and reconciliation —
    // sending it at close would collapse §21's two events into one.
    expect(results).toHaveLength(0);

    const endedEmail = h.sentEmails.messages.find((m) => m.subject.startsWith('Campaign ended'));
    expect(endedEmail).toBeTruthy();
    expect(endedEmail!.text).toContain('Results ready');
  });
});

/* ── The pure §21 step 6 validator ─────────────────────────────────────────── */

describe('§21 step 6 — the usability validation is exact', () => {
  const base = {
    now: new Date('2026-08-04T12:00:00Z'),
    taxCalculationId: 'taxcalc_1',
    taxCalculatedAt: new Date('2026-08-01T00:00:00Z'),
    taxCalculationExpiresAt: new Date('2026-08-05T00:00:00Z'),
    billingCountry: 'US',
    rewardSku: 'TIER-1',
    totalAuthorizedCents: 2_700n,
    rewardSubtotalCents: 2_500n,
    salesTaxCents: 200n,
    stripeCustomerId: 'cus_1',
    paymentMethodId: 'pm_1',
  };

  it('accepts the exact stored facts and refuses each broken one', () => {
    expect(validateCaptureUsability(base).usable).toBe(true);
    expect(validateCaptureUsability({ ...base, taxCalculationId: null }).usable).toBe(false);
    expect(
      validateCaptureUsability({ ...base, taxCalculationExpiresAt: new Date('2026-08-04T11:00:00Z') })
        .usable,
    ).toBe(false);
    expect(validateCaptureUsability({ ...base, billingCountry: 'CA' }).usable).toBe(false);
    expect(validateCaptureUsability({ ...base, totalAuthorizedCents: 2_600n }).usable).toBe(false);
    expect(validateCaptureUsability({ ...base, paymentMethodId: null }).usable).toBe(false);
  });
});
