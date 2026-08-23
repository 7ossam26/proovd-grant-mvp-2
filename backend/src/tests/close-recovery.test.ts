/**
 * Phase 18b — the retry window's end, the B.5 recovery, results preparation,
 * and Admin reconciliation.
 *
 * Acceptance: §33.7.9 (update-card preserves data and success removes the
 * stale failure), §33.7.10 (dropped failures count in no revenue/commission),
 * §33.7.11 (`Campaign ended` and `Results ready` are separate), §33.7.12 (an
 * incomplete batch is visibly recoverable in Admin, reservations remain
 * locked, and retry does not double-charge or duplicate receipts) — plus the
 * results done-when (the honest Admin-reviewed narrative), the Creator close
 * view, and the drift tests pinning the 18b registers against @proovd/shared.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_CONNECT_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  campaignStatusHistory,
  reservations,
  reservationStatusHistory,
} from '../db/schema/domain.js';
import {
  campaignCloseBatches,
  campaignReconciliations,
  campaignResults,
  reservationCaptureAttempts,
} from '../db/schema/close.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { associationCompensationAgreements, trackingLinks } from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { runCloseBatch, findCloseBatch, captureAttemptKey } from '../close/close-batch.js';
import { updateCardAndRetry, endRetryWindow, sweepRetryWindowEnds } from '../close/retry.js';
import { prepareResults, readFounderResults } from '../close/results.js';
import {
  readCloseOperations,
  recordReconciliationItem,
} from '../close/reconciliation.js';
import { readCreatorClose } from '../close/creator-close.js';
import { readBackerPage } from '../reservations/magic-link-read.js';
import {
  RECONCILIATION_ITEMS as BACKEND_RECONCILIATION_ITEMS,
  RESULTS_NARRATIVE_FIELDS as BACKEND_NARRATIVE_FIELDS,
} from '../close/logic.js';
import { RETRY_WINDOW_DROP_REASON as BACKEND_DROP_REASON } from '../close/restated.js';
import { resolveAffiliateMoneyStatus as backendResolveB7 } from '../campaign/editing-logic.js';
import {
  RECONCILIATION_ITEMS as SHARED_RECONCILIATION_ITEMS,
  RESULTS_NARRATIVE_FIELDS as SHARED_NARRATIVE_FIELDS,
  RETRY_WINDOW_DROP_REASON as SHARED_DROP_REASON,
  resolveAffiliateMoneyStatus as sharedResolveB7,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_recovery_suite';
const CONNECT_SECRET = 'whsec_connect_for_recovery_suite';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;
let admin: AdminSession;

const CONTEXT = {
  appBaseUrl: 'http://localhost:3000',
  supportEmail: 'support@proovd.co',
  fromAddress: 'hello@proovd.co',
};

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'close-recovery',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'close-recovery-admin');
  // §6 ships `admin_reauth_window_seconds` unset and the freshness gate fails
  // closed on NULL; the resume/reconciliation/results routes need it set.
  await seedAdminReauthWindow(h.db, 900);
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

/* ── Seeding (the close-batch suite's shape) ────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; closeInHours?: number; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `recovery-founder-${label}`);
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

/** An active Creator with a locked 20% agreement and a live tracking link. */
async function seedActiveCreator(
  campaignId: string,
  label: string,
): Promise<{ associationId: string; trackingLinkId: string; email: string }> {
  const creator = await seedUser(h, 'affiliate', `recovery-creator-${label}`);
  const [cp] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      channelReference: `https://example.com/@creator-${label}`,
      audienceSize: '10k',
      adminBio: 'x',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });
  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: cp!.id,
      status: 'active',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });
  const associationId = assoc!.id;
  await h.db.insert(affiliateSignupProfiles).values({
    prospectId: cp!.id,
    associationId,
    email: creator.email,
    publicHandle: `@creator-${label}`,
    claimedUserId: creator.id,
    updatedBy: 'admin:test',
  });
  await h.db.insert(associationCompensationAgreements).values({
    associationId,
    campaignId,
    source: 'standard_terms',
    basePercent: 20,
    bidIncreasePercent: 0,
    totalPercent: 20,
    affiliateAcceptedAt: new Date(),
    founderAcceptedAt: new Date(),
  });
  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      code: `rc-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });
  return { associationId, trackingLinkId: link!.id, email: creator.email };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `recovery${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777730${String(n).padStart(2, '0')}`,
  };
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

/** Attributes a reservation to a Creator, as the §18 winner would have. */
async function attributeTo(
  reservationId: string,
  creator: { associationId: string; trackingLinkId: string },
): Promise<void> {
  await h.db
    .update(reservations)
    .set({
      attributionSource: 'creator',
      attributionAssociationId: creator.associationId,
      attributionTrackingLinkId: creator.trackingLinkId,
      attributionStatus: 'verified',
      attributionClickedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));
}

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

/** The newest magic-link token for a reservation, from the newest email naming it. */
function latestMagicToken(reservationId: string): string {
  const message = [...h.sentEmails.messages]
    .reverse()
    .find((m) => m.text.includes(reservationId) && /\/backer\//.test(m.text));
  const raw = message?.text.match(/\/backer\/([A-Za-z0-9_.-]+)/)?.[1];
  expect(raw).toBeTruthy();
  return raw!;
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

function eventBody(input: { id?: string; type: string; object: Record<string, unknown> }): string {
  return JSON.stringify({
    id: input.id ?? `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
}

const NARRATIVE = {
  strongestSignal: 'Backers who arrived through the Creator link converted at the highest rate.',
  weakestSignal: 'Direct visitors rarely completed the checkout.',
  leadingSurveyReason: 'Most consented Backers said they wanted the product itself.',
  whatThisProves: 'There is paid demand from this Creator audience at this price.',
  whatThisDoesNotProve:
    'It does not prove demand outside this audience, at other prices, or that delivery will satisfy Backers.',
};

async function verifyRequiredItems(campaignId: string): Promise<void> {
  for (const item of BACKEND_RECONCILIATION_ITEMS.filter((i) => i.requiredForResults)) {
    const outcome = await recordReconciliationItem(
      { db: h.db, audit },
      {
        campaignId,
        itemKey: item.key,
        result: 'verified',
        note: `verified in the recovery suite: ${item.key}`,
        actor: 'admin:test',
      },
    );
    expect(outcome.status).toBe('recorded');
  }
}

/* ── Drift: the 18b registers match @proovd/shared ──────────────────────────── */

describe('drift — the 18b registers and sentences match the shared originals', () => {
  it('restates the nine §21 reconciliation items with the same gating', () => {
    expect(BACKEND_RECONCILIATION_ITEMS.map((i) => ({ ...i }))).toEqual(
      SHARED_RECONCILIATION_ITEMS.map((i) => ({ ...i })),
    );
  });

  it('restates the five narrative fields and the retry-window drop sentence', () => {
    expect(BACKEND_NARRATIVE_FIELDS.map((f) => ({ ...f }))).toEqual(
      SHARED_NARRATIVE_FIELDS.map((f) => ({ ...f })),
    );
    expect(BACKEND_DROP_REASON).toBe(SHARED_DROP_REASON);
  });

  it('restates the Appendix B.7 resolver', () => {
    const vars = {
      amount: '1,234.50',
      state: 'estimated' as const,
      reason: 'Earnings finalize after verification.',
      nextUpdate: 'On or after 2026-08-10',
    };
    expect(backendResolveB7(vars)).toBe(sharedResolveB7(vars));
    expect(() => backendResolveB7({ ...vars, amount: '12' })).toThrow();
  });
});

/* ── §33.7.9 — update-card preserves data; success removes the stale failure ── */

describe('§33.7.9 — the B.5 update-card retry', () => {
  it('captures under the stable attempt-2 key, preserves every context field, and duplicates nothing', async () => {
    const c = await seedLiveCampaign('t9', { type: 'pre_launch' });
    const okBody = preorderBody();
    const failBody = preorderBody({ survey: { why: 'because I want this exact thing', recommend: 9 } });
    await placePreorder(c.campaignId, okBody);
    const rFail = await placePreorder(c.campaignId, failBody);
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);

    const closed = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(closed.status).toBe('complete');
    expect(closed.failed).toBe(1);

    // The magic-link page carries the exact B.5 state with ONE action.
    const [before] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    const page = await readBackerPage(h.db, {
      campaignId: c.campaignId,
      backerIdentityId: before!.backerIdentityId,
    });
    const failedTx = page.transactions.find((t) => t.reservationId === rFail)!;
    expect(failedTx.recovery).not.toBeNull();
    expect(failedTx.recovery!.body).toContain('We could not complete this pre-order charge.');
    expect(failedTx.recovery!.body).toContain('No money has moved');
    expect(failedTx.recovery!.body).toContain('Update by:');
    expect(failedTx.recovery!.action).toBe('Update card');
    expect(failedTx.recovery!.available).toBe(true);
    // Never the raw provider code (§33.9.11).
    expect(failedTx.recovery!.body).not.toContain('generic_decline');

    // Context snapshot before the update — §33.7.9's "preserves data".
    const snapshot = {
      rewardSku: before!.rewardSku,
      rewardTitle: before!.rewardTitle,
      surveyWhy: before!.surveyWhy,
      surveyRecommend: before!.surveyRecommend,
      consentHash: before!.consentHash,
      consentText: before!.consentText,
      totalAuthorizedCents: before!.totalAuthorizedCents,
      setupIntentId: before!.setupIntentId,
      operationalSharingAck: before!.operationalSharingAck,
    };

    const pisBefore = piCountFor(c.connectedAccountId);
    const newPm = `pm_new_${randomUUID().slice(0, 8)}`;
    const token = latestMagicToken(rFail);
    const res = await request(h.app)
      .post(`/api/link/${token}/reservations/${rFail}/update-card`)
      .send({ paymentMethodId: newPm });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('captured');

    // One new PaymentIntent, under the stable attempt-2 key (§33.7.7).
    expect(piCountFor(c.connectedAccountId)).toBe(pisBefore + 1);
    const attempts = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, rFail))
      .orderBy(reservationCaptureAttempts.attemptNumber);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.idempotencyKey).toBe(captureAttemptKey(rFail, 2));
    expect(attempts[1]!.outcome).toBe('succeeded');
    expect(attempts[1]!.amountCents).toBe(snapshot.totalAuthorizedCents);

    // The stale failure is removed by the state itself, and every context
    // field survived — only the card reference moved.
    const [after] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    expect(after!.status).toBe('captured');
    expect(after!.totalCapturedCents).toBe(snapshot.totalAuthorizedCents);
    expect(after!.paymentMethodId).toBe(newPm);
    expect(after!.rewardSku).toBe(snapshot.rewardSku);
    expect(after!.rewardTitle).toBe(snapshot.rewardTitle);
    expect(after!.surveyWhy).toBe(snapshot.surveyWhy);
    expect(after!.surveyRecommend).toBe(snapshot.surveyRecommend);
    expect(after!.consentHash).toBe(snapshot.consentHash);
    expect(after!.consentText).toBe(snapshot.consentText);
    expect(after!.totalAuthorizedCents).toBe(snapshot.totalAuthorizedCents);
    expect(after!.operationalSharingAck).toBe(snapshot.operationalSharingAck);
    // The original SetupIntent stays historical (§23.5, §29.7).
    expect(after!.setupIntentId).toBe(snapshot.setupIntentId);

    // The §27.5 retry-success message, once — and never a second receipt.
    expect(emailsMatching((t) => t.includes(rFail) && t.includes('Your updated card completed'))).toBe(1);
    expect(
      emailsMatching((t) => t.includes(rFail) && t.includes('Your Proovd pre-order charge is complete.')),
    ).toBe(0);

    // The page shows Captured with no recovery block (§33.7.9).
    const pageAfter = await readBackerPage(h.db, {
      campaignId: c.campaignId,
      backerIdentityId: before!.backerIdentityId,
    });
    const txAfter = pageAfter.transactions.find((t) => t.reservationId === rFail)!;
    expect(txAfter.statusLabel).toBe('Captured');
    expect(txAfter.chargeOccurred).toBe(true);
    expect(txAfter.recovery).toBeNull();

    // A duplicate submission is harmless: no new intent, no new email.
    const emailCount = h.sentEmails.messages.length;
    const dupToken = latestMagicToken(rFail);
    const dup = await request(h.app)
      .post(`/api/link/${dupToken}/reservations/${rFail}/update-card`)
      .send({ paymentMethodId: `pm_again_${randomUUID().slice(0, 6)}` });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('already_captured');
    expect(piCountFor(c.connectedAccountId)).toBe(pisBefore + 1);
    expect(h.sentEmails.messages.length).toBe(emailCount);

    // §21: reconciliation begins only after the window closes — a full
    // recovery does not end the fixed window early.
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('capture_retry_window');
  });

  it('requires_action routes to a customer action, and the webhook completes it as a retry success', async () => {
    const c = await seedLiveCampaign('t9a', { type: 'pre_launch' });
    const failBody = preorderBody();
    const rFail = await placePreorder(c.campaignId, failBody);
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const actionPm = `pm_action_${randomUUID().slice(0, 8)}`;
    gateway.setCaptureOutcome(actionPm, 'requires_action');
    const token = latestMagicToken(rFail);
    const res = await request(h.app)
      .post(`/api/link/${token}/reservations/${rFail}/update-card`)
      .send({ paymentMethodId: actionPm });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('requires_action');
    expect(res.body.clientSecret).toBeTruthy();
    // Neither silently succeeded nor silently failed (§21).
    const [pending] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    expect(pending!.status).toBe('capture_failed_retrying');

    const [attempt] = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(
        and(
          eq(reservationCaptureAttempts.reservationId, rFail),
          eq(reservationCaptureAttempts.attemptNumber, 2),
        ),
      );
    expect(attempt!.outcome).toBe('requires_action');
    expect(attempt!.paymentIntentId).toBeTruthy();

    // The Backer completes the bank confirmation; Stripe delivers succeeded.
    const payload = eventBody({
      type: 'payment_intent.succeeded',
      object: {
        id: attempt!.paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        latest_charge: `ch_action_${randomUUID().slice(0, 8)}`,
        metadata: { proovd_reservation_id: rFail, proovd_campaign_id: c.campaignId },
      },
    });
    expect((await signedDelivery(payload)).status).toBe(200);

    const [after] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    expect(after!.status).toBe('captured');
    // The recovery completion is the §27.5 retry-success message, once.
    expect(emailsMatching((t) => t.includes(rFail) && t.includes('Your updated card completed'))).toBe(1);

    // A duplicate delivery under a fresh event id changes nothing (§33.7.7).
    const emailCount = h.sentEmails.messages.length;
    const fresh = eventBody({
      type: 'payment_intent.succeeded',
      object: {
        id: attempt!.paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        latest_charge: after!.chargeId,
        metadata: { proovd_reservation_id: rFail, proovd_campaign_id: c.campaignId },
      },
    });
    expect((await signedDelivery(fresh)).status).toBe(200);
    expect(h.sentEmails.messages.length).toBe(emailCount);
    const [still] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    expect(still!.totalCapturedCents).toBe(after!.totalCapturedCents);
  });

  it('refuses after the stored deadline — the anchor gates, not the sweep tick', async () => {
    const c = await seedLiveCampaign('t9b', { type: 'pre_launch' });
    const failBody = preorderBody();
    const rFail = await placePreorder(c.campaignId, failBody);
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const batch = await findCloseBatch(h.db, c.campaignId);
    const afterDeadline = new Date(batch!.retryDeadlineAt!.getTime() + 1_000);

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    const refused = await updateCardAndRetry(closeDeps(), {
      reservationId: rFail,
      backerIdentityId: row!.backerIdentityId,
      paymentMethodId: `pm_late_${randomUUID().slice(0, 6)}`,
      actor: 'backer:test',
      now: afterDeadline,
    });
    expect(refused.status).toBe('retry_window_closed');

    // The page's recovery block reads unavailable at the same instant.
    const page = await readBackerPage(h.db, {
      campaignId: c.campaignId,
      backerIdentityId: row!.backerIdentityId,
      now: afterDeadline,
    });
    const tx = page.transactions.find((t) => t.reservationId === rFail)!;
    expect(tx.recovery!.available).toBe(false);
  });
});

/* ── §33.7.10 — dropped failures count in no revenue/commission ─────────────── */

describe('§33.7.10 — the retry window ends: recoveries captured, the rest zero everywhere', () => {
  it('drops remaining failures at US$0 with no revenue, no commission, no Founder share', async () => {
    const c = await seedLiveCampaign('t10', { type: 'pre_launch' });
    const creator = await seedActiveCreator(c.campaignId, 't10');

    const okBody = preorderBody();
    const recoverBody = preorderBody();
    const dropBody = preorderBody();
    const rOk = await placePreorder(c.campaignId, okBody);
    const rRecover = await placePreorder(c.campaignId, recoverBody);
    const rDrop = await placePreorder(c.campaignId, dropBody);
    // The attributed ones: the captured charge carries the 20% provisional; the
    // dropped one must carry nothing at all.
    await attributeTo(rOk, creator);
    await attributeTo(rDrop, creator);
    gateway.setCaptureOutcome(recoverBody.paymentMethodId as string, 'card_declined');
    gateway.setCaptureOutcome(dropBody.paymentMethodId as string, 'insufficient_funds');
    await makeDue(c.campaignId);

    const closed = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(closed.status).toBe('complete');
    expect(closed.captured).toBe(1);
    expect(closed.failed).toBe(2);

    // The attributed capture provisioned 20% (§24.4).
    const [okRow] = await h.db.select().from(reservations).where(eq(reservations.id, rOk));
    expect(okRow!.affiliateProvisionalCents).toBe((okRow!.rewardSubtotalCents * 20n) / 100n);

    // One failure recovers inside the window.
    const token = latestMagicToken(rRecover);
    const recovered = await request(h.app)
      .post(`/api/link/${token}/reservations/${rRecover}/update-card`)
      .send({ paymentMethodId: `pm_recover_${randomUUID().slice(0, 6)}` });
    expect(recovered.status).toBe(200);
    expect(recovered.body.status).toBe('captured');

    const [campaignMid] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    const capturedMid = {
      subtotal: campaignMid!.rewardSubtotalCapturedCents,
      tax: campaignMid!.salesTaxCapturedCents,
      total: campaignMid!.totalCapturedCents,
      fee: campaignMid!.proovdFeeCents,
      provisional: campaignMid!.affiliateProvisionalCents,
      gross: campaignMid!.founderGrossShareCents,
    };

    // The window ends. The sweep is time-parameterized: the batch's stored
    // deadline is immutable by trigger, so the test moves TIME, not the anchor.
    const batch = await findCloseBatch(h.db, c.campaignId);
    const afterDeadline = new Date(batch!.retryDeadlineAt!.getTime() + 1_000);
    const results = await sweepRetryWindowEnds(closeDeps(), afterDeadline);
    const ended = results.find((r) => r.campaignId === c.campaignId);
    expect(ended!.status).toBe('ended');
    expect(ended!.recovered).toBe(1);
    expect(ended!.dropped).toBe(1);

    // The recovery counts as captured; the rest dropped (§21).
    const [recoveredRow] = await h.db.select().from(reservations).where(eq(reservations.id, rRecover));
    expect(recoveredRow!.status).toBe('captured');
    const [droppedRow] = await h.db.select().from(reservations).where(eq(reservations.id, rDrop));
    expect(droppedRow!.status).toBe('capture_failed_dropped');

    // §33.7.10: dropped is zero EVERYWHERE — on the row and in the aggregates.
    expect(droppedRow!.totalCapturedCents).toBe(0n);
    expect(droppedRow!.proovdFeeCents).toBe(0n);
    expect(droppedRow!.affiliateProvisionalCents).toBe(0n);
    expect(droppedRow!.founderGrossShareCents).toBe(0n);
    const [campaignAfter] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaignAfter!.rewardSubtotalCapturedCents).toBe(capturedMid.subtotal);
    expect(campaignAfter!.salesTaxCapturedCents).toBe(capturedMid.tax);
    expect(campaignAfter!.totalCapturedCents).toBe(capturedMid.total);
    expect(campaignAfter!.proovdFeeCents).toBe(capturedMid.fee);
    expect(campaignAfter!.affiliateProvisionalCents).toBe(capturedMid.provisional);
    expect(campaignAfter!.founderGrossShareCents).toBe(capturedMid.gross);

    // Fulfillment: do-not-fulfill; the saved card detached reference-safely.
    const [share] = await h.db
      .select()
      .from(founderOperationalShares)
      .where(eq(founderOperationalShares.reservationId, rDrop));
    expect(share!.fulfillmentState).toBe('do_not_fulfill');
    expect(
      gateway.detachedPaymentMethods.some((d) => d.paymentMethodId === dropBody.paymentMethodId),
    ).toBe(true);

    // The campaign entered reconciliation, once (§23.1).
    expect(campaignAfter!.status).toBe('closed_reconciling');
    const history = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(eq(campaignStatusHistory.campaignId, c.campaignId));
    expect(history.filter((r) => r.toStatus === 'closed_reconciling')).toHaveLength(1);

    // The dropped Backer heard US$0, once, without shame or provider words.
    const dropEmails = h.sentEmails.messages.filter(
      (m) => m.text.includes(rDrop) && m.text.includes('Amount charged: US$0'),
    );
    expect(dropEmails).toHaveLength(1);
    expect(dropEmails[0]!.text).toContain('The update window for this pre-order has ended');
    expect(dropEmails[0]!.text.toLowerCase()).not.toContain('declined');
    expect(dropEmails[0]!.text).not.toContain('insufficient_funds');

    // The Creator close notice went out once, with the estimated B.7 block
    // computed from CAPTURED attributed money only — the dropped attributed
    // charge earns nothing (§33.7.10's commission half).
    const creatorEmails = h.sentEmails.messages.filter((m) =>
      m.subject.startsWith('Campaign closed'),
    );
    expect(creatorEmails).toHaveLength(1);
    const estimated = (okRow!.rewardSubtotalCents * 20n) / 100n;
    expect(creatorEmails[0]!.text).toContain('recorded');
    expect(creatorEmails[0]!.text).toContain('Status: ESTIMATED');
    expect(creatorEmails[0]!.text).toContain('Attributed captured charges: 1');
    // The Creator close view agrees, and carries no ranking of any kind (§30).
    const close = await readCreatorClose(h.db, { associationId: creator.associationId });
    expect(close.ok).toBe(true);
    if (close.ok) {
      expect(close.view.attributed.preorders).toBe(2);
      expect(close.view.attributed.captured).toBe(1);
      expect(close.view.earnings.estimatedCents).toBe(estimated.toString());
      // §30: no ranking, structurally — no field of the view is a rank,
      // percentile, or position among other Creators.
      const keys = JSON.stringify(close.view).match(/"([^"]+)":/g) ?? [];
      expect(keys.some((k) => /rank|percentile|position|top/i.test(k))).toBe(false);
    }

    // Running the sweep again changes nothing (§33.7.7's rule at the window).
    const emailCount = h.sentEmails.messages.length;
    const again = await sweepRetryWindowEnds(closeDeps(), afterDeadline);
    expect(again.find((r) => r.campaignId === c.campaignId)).toBeUndefined();
    expect(h.sentEmails.messages.length).toBe(emailCount);
    const [rowsAfter] = await h.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservationStatusHistory)
      .where(
        and(
          eq(reservationStatusHistory.reservationId, rDrop),
          eq(reservationStatusHistory.toStatus, 'capture_failed_dropped'),
        ),
      );
    expect(Number(rowsAfter!.count)).toBe(1);
  });

  it('a met Idea threshold stays successful when the last failure drops (§33.7.5 through the window)', async () => {
    const c = await seedLiveCampaign('t10b', { type: 'pre_build', orderThreshold: 2 });
    const okBody = preorderBody();
    const dropBody = preorderBody();
    await placePreorder(c.campaignId, okBody);
    await placePreorder(c.campaignId, dropBody);
    gateway.setCaptureOutcome(dropBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const batch = await findCloseBatch(h.db, c.campaignId);
    expect(batch!.thresholdMet).toBe(true);
    const afterDeadline = new Date(batch!.retryDeadlineAt!.getTime() + 1_000);
    await sweepRetryWindowEnds(closeDeps(), afterDeadline);

    // The drop never reverses the decision: the campaign reconciles with the
    // money it actually collected, and the batch row is immutable (§33.7.5).
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('closed_reconciling');
    const after = await findCloseBatch(h.db, c.campaignId);
    expect(after!.thresholdMet).toBe(true);
  });
});

/* ── §33.7.11 — Campaign ended and Results ready are separate ───────────────── */

describe('§33.7.11 — Results ready is its own gated event, and the narrative is Admin-reviewed', () => {
  it('prepares results only after reconciliation, sends once, and carries the honest narrative', async () => {
    const c = await seedLiveCampaign('t11', { type: 'pre_launch' });
    // One consented survey answer and one withheld — the results must show
    // exactly the consented one (§25.2).
    await placePreorder(
      c.campaignId,
      preorderBody({ founderMarketingConsent: true, survey: { why: 'consented reason', recommend: 8 } }),
    );
    await placePreorder(c.campaignId, preorderBody({ survey: { why: 'withheld reason', recommend: 2 } }));
    await makeDue(c.campaignId);
    const closed = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(closed.status).toBe('complete');
    expect(closed.captured).toBe(2);

    // Campaign ended fired at close; results are still preparing.
    const before = await readFounderResults(h.db, { campaignId: c.campaignId });
    expect(before!.state).toBe('preparing');
    expect(before!.narrative).toBeNull();
    expect(before!.preparing!.owner).toBe('Proovd');

    // Refused before the reconciliation items are verified.
    const premature = await prepareResults(
      { db: h.db, audit, notifications: { db: h.db, notifier: h.notifier, context: CONTEXT, tokens: h.tokens } },
      { campaignId: c.campaignId, narrative: NARRATIVE, actor: 'admin:test' },
    );
    expect(premature.status).toBe('reconciliation_incomplete');
    if (premature.status === 'reconciliation_incomplete') {
      expect(premature.missing).toEqual([
        'batch_completeness',
        'tax_charge_reconciliation',
        'attribution_post_verification',
        'refund_risk_dispute',
      ]);
    }

    await verifyRequiredItems(c.campaignId);

    // A blank narrative half is refused by name — the honesty requirement
    // cannot be quietly dropped.
    const blank = await prepareResults(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        narrative: { ...NARRATIVE, whatThisDoesNotProve: '  ' },
        actor: 'admin:test',
      },
    );
    expect(blank.status).toBe('narrative_incomplete');

    const prepared = await prepareResults(
      { db: h.db, audit, notifications: { db: h.db, notifier: h.notifier, context: CONTEXT, tokens: h.tokens } },
      { campaignId: c.campaignId, narrative: NARRATIVE, actor: 'admin:reviewer' },
    );
    expect(prepared.status).toBe('prepared');

    // Two separate events, two separate keys (§33.7.11).
    const deliveriesFor = async (key: string) =>
      h.db
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.eventKey, key),
            eq(notificationDeliveries.entityId, c.campaignId),
          ),
        );
    expect(await deliveriesFor('founder_campaign_ended')).toHaveLength(1);
    expect(await deliveriesFor('founder_results_ready')).toHaveLength(1);
    expect(emailsMatching((t) => t.startsWith('Results ready') && t.includes(c.campaignId))).toBe(1);

    // §23.3: results_ready is a payment flag, its own row — the lifecycle
    // stays closed_reconciling.
    const flags = await h.db
      .select()
      .from(campaignPaymentFlags)
      .where(
        and(eq(campaignPaymentFlags.campaignId, c.campaignId), eq(campaignPaymentFlags.flag, 'results_ready')),
      );
    expect(flags).toHaveLength(1);
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(campaign!.status).toBe('closed_reconciling');

    // Preparing again changes nothing: one results row, one delivery.
    const again = await prepareResults(
      { db: h.db, audit, notifications: { db: h.db, notifier: h.notifier, context: CONTEXT, tokens: h.tokens } },
      { campaignId: c.campaignId, narrative: NARRATIVE, actor: 'admin:test' },
    );
    expect(again.status).toBe('already_prepared');
    expect(await deliveriesFor('founder_results_ready')).toHaveLength(1);
    const rows = await h.db
      .select()
      .from(campaignResults)
      .where(eq(campaignResults.campaignId, c.campaignId));
    expect(rows).toHaveLength(1);

    // The results carry the §21 numbers and the Admin-reviewed narrative —
    // including what the result does NOT prove (the done-when).
    const results = await readFounderResults(h.db, { campaignId: c.campaignId });
    expect(results!.state).toBe('ready');
    expect(results!.preorders.captured).toBe(2);
    expect(results!.payments).toEqual({ failed: 0, recovered: 0, dropped: 0 });
    expect(results!.narrative!.whatThisDoesNotProve).toBe(NARRATIVE.whatThisDoesNotProve);
    expect(results!.narrative!.reviewedBy).toBe('admin:reviewer');
    // Survey answers according to consent: the withheld one is absent.
    expect(results!.survey.consentedCount).toBe(1);
    expect(results!.survey.reasons).toEqual(['consented reason']);
    expect(JSON.stringify(results!.survey)).not.toContain('withheld reason');
    // A conversion rate over zero clicks is null, never 0% (§1.4).
    expect(results!.conversion.conversionRate).toBeNull();
  });

  it('refuses to prepare or reconcile while the retry window is open (§21)', async () => {
    const c = await seedLiveCampaign('t11b', { type: 'pre_launch' });
    const failBody = preorderBody();
    await placePreorder(c.campaignId, failBody);
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    const record = await recordReconciliationItem(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        itemKey: 'batch_completeness',
        result: 'verified',
        note: 'premature',
        actor: 'admin:test',
      },
    );
    expect(record.status).toBe('retry_window_open');

    const prepare = await prepareResults(
      { db: h.db, audit },
      { campaignId: c.campaignId, narrative: NARRATIVE, actor: 'admin:test' },
    );
    expect(prepare.status).toBe('retry_window_open');

    // An item outside the register is refused by name (16a's rule).
    const unknown = await recordReconciliationItem(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        itemKey: 'invented_item',
        result: 'verified',
        note: 'x',
        actor: 'admin:test',
      },
    );
    expect(unknown.status).toBe('unknown_item');
  });
});

/* ── §33.7.12 — the incomplete batch is visibly recoverable in Admin ────────── */

describe('§33.7.12 — visible recovery: locked reservations, resume, no duplicates', () => {
  it('shows the interrupted batch in the Admin queue and resumes it without double charges or receipts', async () => {
    const c = await seedLiveCampaign('t12', { type: 'pre_launch' });
    const r1 = await placePreorder(c.campaignId, preorderBody());
    const r2 = await placePreorder(c.campaignId, preorderBody());
    await makeDue(c.campaignId);

    gateway.failNextPaymentIntent('simulated transport failure');
    const first = await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });
    expect(first.status).toBe('incomplete');
    expect(first.errored).toBe(1);

    // Reservations remain locked while the batch is incomplete.
    const [locked] = await h.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(and(eq(reservations.campaignId, c.campaignId), eq(reservations.status, 'pending_capture')));
    expect(Number(locked!.count)).toBe(1);

    // The queue names it, with its locked count and its recovery (§33.7.12).
    const operations = await readCloseOperations(h.db);
    const entry = operations.incomplete.find((b) => b.campaignId === c.campaignId);
    expect(entry).toBeTruthy();
    expect(entry!.lockedReservations).toBe(1);
    expect(entry!.recovery).toContain('Resume');

    // The `/admin/close` surface and its router were removed, so the queue is
    // driven through the service the sweep and the surface both called. What
    // §33.7.12 is about — the batch is visibly incomplete, and resuming it
    // double-charges nobody — is a property of this machine, not of the route.

    const pisBefore = piCountFor(c.connectedAccountId);
    const emailsBefore = h.sentEmails.messages.length;

    const resume = await runCloseBatch(closeDeps(), {
      campaignId: c.campaignId,
      actor: 'admin:test',
    });
    expect(resume.status).toBe('complete');

    // One intent per reservation EVER, one receipt each — the retried attempt
    // reused its stable key (§33.7.7, §33.7.12).
    expect(piCountFor(c.connectedAccountId)).toBe(2);
    for (const id of [r1, r2]) {
      const attempts = await h.db
        .select()
        .from(reservationCaptureAttempts)
        .where(eq(reservationCaptureAttempts.reservationId, id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.outcome).toBe('succeeded');
      expect(
        emailsMatching((t) => t.includes(id) && t.includes('Your Proovd pre-order charge is complete.')),
      ).toBe(1);
    }

    // A second resume changes nothing.
    const again = await runCloseBatch(closeDeps(), {
      campaignId: c.campaignId,
      actor: 'admin:test',
    });
    expect(again.status).toBe('already_complete');
    expect(piCountFor(c.connectedAccountId)).toBe(2);
    expect(h.sentEmails.messages.length).toBeGreaterThanOrEqual(emailsBefore);

    // The batch record shows it completed, and the attempt ledger agrees.
    const completed = await findCloseBatch(h.db, c.campaignId);
    expect(completed!.completedAt).toBeTruthy();

    // Verify the four required items, then prepare the results.
    for (const item of BACKEND_RECONCILIATION_ITEMS.filter((i) => i.requiredForResults)) {
      const rec = await recordReconciliationItem(
        { db: h.db, audit },
        {
          campaignId: c.campaignId,
          itemKey: item.key,
          result: 'verified',
          note: `checked ${item.key}`,
          actor: 'admin:test',
        },
      );
      expect(rec.status).toBe('recorded');
    }
    const results = await prepareResults(
      { db: h.db, audit, notifications: { db: h.db, notifier: h.notifier, context: CONTEXT, tokens: h.tokens } },
      { campaignId: c.campaignId, narrative: NARRATIVE, actor: 'admin:test' },
    );
    expect(results.status).toBe('prepared');

    const rows = await h.db
      .select()
      .from(campaignReconciliations)
      .where(eq(campaignReconciliations.campaignId, c.campaignId));
    expect(rows.length).toBe(4);
  });

  it('endRetryWindow leaves an unresolved in-flight attempt untouched and visible', async () => {
    const c = await seedLiveCampaign('t12b', { type: 'pre_launch' });
    const failBody = preorderBody();
    const rFail = await placePreorder(c.campaignId, failBody);
    gateway.setCaptureOutcome(failBody.paymentMethodId as string, 'card_declined');
    await makeDue(c.campaignId);
    await runCloseBatch(closeDeps(), { campaignId: c.campaignId, actor: 'system:test' });

    // A retry that crashes at the transport leaves attempt 2 claimed and
    // unresolved — the honest state (§33.7.12).
    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    gateway.failNextPaymentIntent('retry transport failure');
    const errored = await updateCardAndRetry(closeDeps(), {
      reservationId: rFail,
      backerIdentityId: row!.backerIdentityId,
      paymentMethodId: `pm_crash_${randomUUID().slice(0, 6)}`,
      actor: 'backer:test',
    });
    expect(errored.status).toBe('provider_error');

    // At the window's end the sweep resolves it under the SAME key — here it
    // succeeds at the provider, so the Backer is captured, never dropped.
    const batch = await findCloseBatch(h.db, c.campaignId);
    const afterDeadline = new Date(batch!.retryDeadlineAt!.getTime() + 1_000);
    const results = await sweepRetryWindowEnds(closeDeps(), afterDeadline);
    const ended = results.find((r) => r.campaignId === c.campaignId);
    expect(ended!.status).toBe('ended');

    const [after] = await h.db.select().from(reservations).where(eq(reservations.id, rFail));
    expect(after!.status).toBe('captured');
    const attempts = await h.db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, rFail))
      .orderBy(reservationCaptureAttempts.attemptNumber);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.outcome).toBe('succeeded');
  });
});
