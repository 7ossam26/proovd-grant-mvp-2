/**
 * Phase 15b — cancellation, the pre-charge reminder, the magic-link page, and
 * the dedup Admin decision.
 *
 * Acceptance: §33.7.1 (cancellation prevents a PaymentIntent, preserves the
 * successful SetupIntent as history, and reference-safely detaches), §33.7.2
 * (canceling one Product transaction does not invalidate another sharing the
 * method), the done-when list's "one action, no retention obstacle, idempotent"
 * and "reminder sends once and skips every ineligible reservation", and §33.5.13
 * (magic-link non-enumeration).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts, providerObjects } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { backerIdentities, deduplicationCases } from '../db/schema/reservations.js';
import { cancelReservation } from '../reservations/cancellation.js';
import { sweepPrechargeReminders } from '../reservations/reminder.js';
import { decideDeduplicationCase } from '../reservations/dedup-admin.js';
import { TOKEN_REJECTION_STATUS } from '../auth/token-rejection.js';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_cancel_suite',
  connectWebhookSecret: 'whsec_connect_for_cancel_suite',
  taxEnabled: true,
});

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'backer-cancellation',
  );
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; closeInHours?: number; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `cancel-founder-${label}`);
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
  return { email: `cancel${n}-${randomUUID().slice(0, 6)}@example.com`, phone: `41555520${String(n).padStart(2, '0')}` };
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

function placePreorder(campaignId: string, body: Record<string, unknown>) {
  return request(h.app).post(`/api/campaign/${campaignId}/preorder`).send(body);
}

/* ── §33.7.1 — cancellation prevents a PaymentIntent, preserves the SetupIntent ─ */

describe('§33.7.1 — cancellation is safe and reference-aware', () => {
  it('cancels, preserves the successful SetupIntent as history, and detaches a lone card', async () => {
    const c = await seedLiveCampaign('t1', { type: 'pre_launch' });
    const res = await placePreorder(c.campaignId, preorderBody());
    expect(res.status).toBe(201);
    const reservationId = res.body.reservationId;

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));
    const setupIntentId = row!.setupIntentId!;
    const paymentMethodId = row!.paymentMethodId!;
    const backerIdentityId = row!.backerIdentityId;

    const before = gateway.detachedPaymentMethods.length;
    const outcome = await cancelReservation(
      { db: h.db, gateway, audit, connectedAccountId: c.connectedAccountId },
      { reservationId, backerIdentityId, actor: 'backer:test' },
    );
    expect(outcome.status).toBe('canceled');

    const [after] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));
    expect(after!.status).toBe('reserved_canceled');
    expect(after!.canceledAt).not.toBeNull();

    // The successful SetupIntent stays historical — never relabeled canceled (§23.5).
    const [si] = await h.db
      .select()
      .from(providerObjects)
      .where(eq(providerObjects.providerObjectId, setupIntentId));
    expect(si!.status).toBe('succeeded');

    // No PaymentIntent/charge object exists for this reservation (§33.7.1/§33.7.4).
    const pis = await h.db
      .select()
      .from(providerObjects)
      .where(and(eq(providerObjects.reservationId, reservationId), eq(providerObjects.objectType, 'payment_intent')));
    expect(pis).toHaveLength(0);

    // The lone card was detached (reference-safe: nothing else uses it).
    expect(gateway.detachedPaymentMethods.length).toBe(before + 1);
    expect(gateway.detachedPaymentMethods.at(-1)!.paymentMethodId).toBe(paymentMethodId);
  });

  it('is idempotent: a duplicate cancel is harmless and sends no second email', async () => {
    const c = await seedLiveCampaign('t1b', { type: 'pre_launch' });
    const res = await placePreorder(c.campaignId, preorderBody());
    const reservationId = res.body.reservationId;
    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));

    const emailsBefore = h.sentEmails.messages.length;
    const first = await cancelReservation(
      { db: h.db, gateway, audit, notifier: h.notifier, fromAddress: 'hi@proovd.co', connectedAccountId: c.connectedAccountId, campaignTitle: 'X' },
      { reservationId, backerIdentityId: row!.backerIdentityId, actor: 'backer:test' },
    );
    expect(first.status).toBe('canceled');
    const afterFirst = h.sentEmails.messages.length;

    const second = await cancelReservation(
      { db: h.db, gateway, audit, notifier: h.notifier, fromAddress: 'hi@proovd.co', connectedAccountId: c.connectedAccountId, campaignTitle: 'X' },
      { reservationId, backerIdentityId: row!.backerIdentityId, actor: 'backer:test' },
    );
    expect(second.status).toBe('already_canceled');
    expect(h.sentEmails.messages.length).toBe(afterFirst); // no second email
    expect(afterFirst).toBeGreaterThan(emailsBefore);
  });
});

/* ── §33.7.2 — a shared PaymentMethod is not detached while another uses it ──── */

describe('§33.7.2 — canceling one Product transaction does not invalidate another', () => {
  it('leaves a shared card attached until the last transaction is canceled', async () => {
    const c = await seedLiveCampaign('t2', { type: 'pre_launch' });
    const sharedPm = `pm_shared_${randomUUID().slice(0, 8)}`;
    const backer = contact();
    const first = await placePreorder(c.campaignId, preorderBody({ contact: backer, rewardSku: 'TIER-1', paymentMethodId: sharedPm }));
    const second = await placePreorder(c.campaignId, preorderBody({ contact: backer, rewardSku: 'TIER-2', paymentMethodId: sharedPm }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const [r1] = await h.db.select().from(reservations).where(eq(reservations.id, first.body.reservationId));
    const backerIdentityId = r1!.backerIdentityId;

    // Cancel the first: the card still supports the second, so it is NOT detached.
    const beforeA = gateway.detachedPaymentMethods.length;
    await cancelReservation(
      { db: h.db, gateway, audit, connectedAccountId: c.connectedAccountId },
      { reservationId: first.body.reservationId, backerIdentityId, actor: 'backer:test' },
    );
    expect(gateway.detachedPaymentMethods.length).toBe(beforeA); // not detached

    // The second transaction is untouched and still active.
    const [r2] = await h.db.select().from(reservations).where(eq(reservations.id, second.body.reservationId));
    expect(r2!.status).toBe('reserved_active');

    // Cancel the second: now nothing else uses the card, so it detaches.
    await cancelReservation(
      { db: h.db, gateway, audit, connectedAccountId: c.connectedAccountId },
      { reservationId: second.body.reservationId, backerIdentityId, actor: 'backer:test' },
    );
    expect(gateway.detachedPaymentMethods.length).toBe(beforeA + 1);
    expect(gateway.detachedPaymentMethods.at(-1)!.paymentMethodId).toBe(sharedPm);
  });
});

/* ── The magic-link page and cancel route ───────────────────────────────────── */

describe('the magic-link page and its cancel action', () => {
  it('returns the Backer transactions and cancels via the token route', async () => {
    const c = await seedLiveCampaign('mlp', { type: 'pre_launch' });
    const res = await placePreorder(c.campaignId, preorderBody());
    const token = String(res.body.magicLinkUrl).split('/backer/')[1];
    const reservationId = res.body.reservationId;

    const page = await request(h.app).get(`/api/link/${token}/page`);
    expect(page.status).toBe(200);
    expect(page.body.notChargedLead).toBe('Pre-order saved — you were not charged');
    expect(page.body.transactions).toHaveLength(1);
    expect(page.body.transactions[0].statusLabel).toBe('Reserved');
    expect(page.body.transactions[0].notChargedYet).toBe(true);
    expect(page.body.transactions[0].canCancel).toBe(true);

    const cancel = await request(h.app).post(`/api/link/${token}/reservations/${reservationId}/cancel`).send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.amountCharged).toBe('US$0');

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, reservationId));
    expect(row!.status).toBe('reserved_canceled');
  });

  it('§33.5.13 — an invalid token is rejected with the frozen non-enumerating response', async () => {
    const res = await request(h.app).get(`/api/link/not-a-real-token-value-abcdefghijklmnop/page`);
    expect(res.status).toBe(TOKEN_REJECTION_STATUS);
    // The body carries no reason, no PII, no account existence.
    expect(JSON.stringify(res.body)).not.toMatch(/campaign|reservation|backer/i);
  });
});

/* ── The pre-charge reminder ─────────────────────────────────────────────────── */

describe('the pre-charge reminder sends once and skips ineligible reservations', () => {
  it('reminds an active reservation within the window, exactly once', async () => {
    const c = await seedLiveCampaign('rem', { type: 'pre_launch', closeInHours: 20 });
    const res = await placePreorder(c.campaignId, preorderBody());
    const email = (await h.db.select().from(reservations).where(eq(reservations.id, res.body.reservationId)))[0]!.backerEmail!;

    const before = h.sentEmails.messages.length;
    const first = await sweepPrechargeReminders({ db: h.db, notifier: h.notifier, tokenService: h.tokens, fromAddress: 'hi@proovd.co', appBaseUrl: 'http://localhost:3000' });
    expect(first.sent).toBe(1);
    const msg = h.sentEmails.messages.slice(before).find((m) => m.to === email);
    expect(msg!.text).toContain('charge decision');

    // A second sweep sends nothing (reminder_sent_at claim + dedup).
    const second = await sweepPrechargeReminders({ db: h.db, notifier: h.notifier, tokenService: h.tokens, fromAddress: 'hi@proovd.co', appBaseUrl: 'http://localhost:3000' });
    expect(second.sent).toBe(0);
  });

  it('skips a canceled reservation and a campaign that is not near close', async () => {
    // Not near close (14 days out) → no reminder.
    const far = await seedLiveCampaign('rem-far', { type: 'pre_launch', closeInHours: 14 * 24 });
    await placePreorder(far.campaignId, preorderBody());

    // Near close but canceled → no reminder.
    const near = await seedLiveCampaign('rem-cancel', { type: 'pre_launch', closeInHours: 20 });
    const res = await placePreorder(near.campaignId, preorderBody());
    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, res.body.reservationId));
    await cancelReservation(
      { db: h.db, gateway, audit, connectedAccountId: near.connectedAccountId },
      { reservationId: res.body.reservationId, backerIdentityId: row!.backerIdentityId, actor: 'backer:test' },
    );

    const result = await sweepPrechargeReminders({ db: h.db, notifier: h.notifier, tokenService: h.tokens, fromAddress: 'hi@proovd.co', appBaseUrl: 'http://localhost:3000' });
    // Neither the far campaign nor the canceled reservation is reminded.
    const remindedFar = await h.db.select().from(reservations).where(and(eq(reservations.campaignId, far.campaignId)));
    expect(remindedFar.every((r) => r.reminderSentAt === null)).toBe(true);
    expect(result.sent).toBe(0);
  });
});

/* ── The deduplication Admin decision (§4.1) ────────────────────────────────── */

describe('the deduplication Admin decision (§4.1)', () => {
  it('records a merge decision and refuses a second decision', async () => {
    const c = await seedLiveCampaign('dedup', { type: 'pre_build', orderThreshold: 100 });
    const a = contact();
    const b = { email: a.email, phone: '4155559999' }; // soft email match
    await placePreorder(c.campaignId, preorderBody({ contact: a }));
    await placePreorder(c.campaignId, preorderBody({ contact: b }));

    const [openCase] = await h.db
      .select()
      .from(deduplicationCases)
      .where(and(eq(deduplicationCases.campaignId, c.campaignId), eq(deduplicationCases.status, 'open')));
    expect(openCase).toBeTruthy();

    const decided = await decideDeduplicationCase(h.db, audit, {
      caseId: openCase!.id,
      decision: 'merged',
      reason: 'Same person; typo in phone.',
      evidence: { note: 'confirmed by email reply' },
      actor: 'admin:test',
    });
    expect(decided.status).toBe('decided');

    const again = await decideDeduplicationCase(h.db, audit, {
      caseId: openCase!.id,
      decision: 'separated',
      reason: 'changed my mind',
      actor: 'admin:test',
    });
    expect(again.status).toBe('already_decided');

    // Two backer identities exist regardless of the merge (the merge is a
    // fraud-control decision recorded against them, not a row deletion).
    const identities = await h.db.select().from(backerIdentities).where(eq(backerIdentities.campaignId, c.campaignId));
    expect(identities).toHaveLength(2);
  });
});
