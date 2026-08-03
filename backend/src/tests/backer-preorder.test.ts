/**
 * Phase 15 — the Backer pre-order, card save, tax, cap, and consent.
 *
 * Acceptance: §33.5.1–12 (the backend-testable core; the checkout surface's
 * Testing Library assertions for §33.5.2/3 and the magic-link page §33.5.13 are
 * the frontend suite's / 15b's). Plus the consent drift test that pins the
 * restated A.3/A.4 templates to `@proovd/shared`, which is itself pinned to the
 * Spec appendix.
 *
 * The gateway is the in-memory one: real webhook-signature verification, fake
 * Customer/SetupIntent/tax API. Each scenario seeds its own live campaign with a
 * complete Founder seller account directly — the launch journey is Phase 14a's
 * suite, already green; what is under test here is what a pre-order does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns } from '../db/schema/domain.js';
import { reservations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import {
  backerIdentities,
  reservationDeduplication,
  deduplicationCases,
  founderOperationalShares,
  campaignReservationCapacity,
} from '../db/schema/reservations.js';
import {
  IDEA_CONSENT_TEMPLATE,
  PRODUCT_CONSENT_TEMPLATE,
  resolveIdeaConsent as restatedResolveIdea,
  resolveProductConsent as restatedResolveProduct,
  normalizeDedupInputs as restatedNormalize,
  validateSurvey as restatedSurvey,
} from '../reservations/restated.js';
import {
  IDEA_CONSENT_TEMPLATE as SHARED_IDEA,
  PRODUCT_CONSENT_TEMPLATE as SHARED_PRODUCT,
  resolveIdeaConsent as sharedResolveIdea,
  resolveProductConsent as sharedResolveProduct,
  normalizeDedupInputs as sharedNormalize,
  validateSurvey as sharedSurvey,
} from '@proovd/shared';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_preorder_suite',
  connectWebhookSecret: 'whsec_connect_for_preorder_suite',
  taxEnabled: true,
});

let h: Harness;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'backer-preorder',
  );
}, 180_000);

afterAll(async () => {
  await h.stop();
});

interface SeededCampaign {
  campaignId: string;
  founderUserId: string;
  founderLegalName: string;
}

async function seedLiveCampaign(
  label: string,
  opts: {
    type: 'pre_build' | 'pre_launch';
    rewards: Array<{ sku: string; priceCents: bigint; limitedQuantity?: number }>;
    orderThreshold?: number;
    capCents?: bigint;
  },
): Promise<SeededCampaign> {
  const founder = await seedUser(h, 'founder', `preorder-founder-${label}`);
  const legalName = `Founder ${label}`;
  const closeAt = new Date(Date.now() + 14 * 86_400_000);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName,
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
      highEffort: false,
      highEffortCalculatedAt: new Date(),
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
    legalName,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_${label}${randomUUID().slice(0, 8)}`,
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
    founderDisplayName: legalName,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: closeAt,
    ...(opts.orderThreshold !== undefined ? { orderThreshold: opts.orderThreshold } : {}),
    ...(opts.type === 'pre_launch'
      ? {
          refundPolicyTitle: `${label} Refund Policy`,
          refundPolicyVersion: 'v1',
          refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
        }
      : {}),
    updatedBy: 'user:test',
  });

  for (const [i, r] of opts.rewards.entries()) {
    await h.db.insert(campaignRewardPackages).values({
      campaignId,
      sku: r.sku,
      title: `Reward ${r.sku}`,
      priceCents: r.priceCents,
      contents: 'A digital thing.',
      fulfillmentCommitment: 'We will deliver it.',
      delivery: 'December 2026',
      sortOrder: i,
      ...(r.limitedQuantity !== undefined ? { limitedQuantity: r.limitedQuantity } : {}),
    });
  }

  // A pre-seeded capacity row with a small cap, for the concurrency test.
  if (opts.capCents !== undefined) {
    await h.db.insert(campaignReservationCapacity).values({
      campaignId,
      capCents: opts.capCents,
      reservedSubtotalCents: 0n,
    });
  }

  return { campaignId, founderUserId: founder.id, founderLegalName: legalName };
}

let backerCounter = 0;
function freshContact(): { email: string; phone: string } {
  backerCounter += 1;
  return {
    email: `backer${backerCounter}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41555501${String(backerCounter).padStart(2, '0')}`,
  };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rewardSku: 'TIER-1',
    contact: freshContact(),
    billing: { country: 'US', postalCode: '10001', state: 'NY' },
    ageConfirmed: true,
    survey: { why: 'I want this product.', recommend: 8 },
    operationalSharingAck: true,
    founderMarketingConsent: false,
    newsletterConsent: false,
    paymentMethodId: `pm_${randomUUID().slice(0, 12)}`,
    ...overrides,
  };
}

function post(campaignId: string, body: Record<string, unknown>) {
  return request(h.app).post(`/api/campaign/${campaignId}/preorder`).send(body);
}

/* ── §33.5.1 — non-US billing and unchecked age fail BEFORE SetupIntent ─────── */

describe('§33.5.1 — eligibility fails before SetupIntent', () => {
  it('rejects non-US billing and creates no SetupIntent', async () => {
    const c = await seedLiveCampaign('us1', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const before = gateway.setupIntents.length;
    const res = await post(c.campaignId, validBody({ billing: { country: 'CA', postalCode: 'K1A' } }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('non_us_billing');
    expect(gateway.setupIntents.length).toBe(before);
  });

  it('rejects unchecked age and creates no SetupIntent', async () => {
    const c = await seedLiveCampaign('age1', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const before = gateway.setupIntents.length;
    const res = await post(c.campaignId, validBody({ ageConfirmed: false }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('age_not_confirmed');
    expect(gateway.setupIntents.length).toBe(before);
  });
});

/* ── §33.5.2 — the checkout quote shows every required fact ──────────────────── */

describe('§33.5.2 — the quote shows subtotal+tax=total, $0 today, and the rest', () => {
  it('returns the exact amounts, trigger, delivery, seller, descriptor, cancel, sharing', async () => {
    const c = await seedLiveCampaign('quote', {
      type: 'pre_build',
      orderThreshold: 500,
      rewards: [{ sku: 'TIER-1', priceCents: 2_500n }],
    });
    const res = await request(h.app)
      .post(`/api/campaign/${c.campaignId}/checkout/quote`)
      .send({ rewardSku: 'TIER-1', billing: { country: 'US', postalCode: '10001', state: 'NY' } });
    expect(res.status).toBe(200);
    const q = res.body;
    // subtotal + tax = total (8% memory rate → 2.00 tax on 25.00 → 27.00).
    expect(q.rewardSubtotal).toBe('25.00');
    expect(q.salesTax).toBe('2.00');
    expect(q.totalAuthorized).toBe('27.00');
    expect(q.chargedToday).toBe('0.00');
    expect(q.chargeRule).toContain('order threshold of 500');
    expect(q.delivery).toBe('December 2026');
    expect(q.founderLegalName).toBe(c.founderLegalName);
    expect(q.statementDescriptor).toMatch(/^PROOVD /);
    expect(q.cancellationPath).toMatch(/cancel/i);
    expect(q.sharingDisclosure).toMatch(/shared with the Founder/i);
    // The consent is A.3 (Idea) and says the card is not charged today.
    expect(q.consentAppendix).toBe('A.3');
    expect(q.consentText).toContain('Your card will NOT be charged today.');
  });
});

/* ── §33.5.3 — optional consents are separate and default off ───────────────── */

describe('§33.5.3 — the two optional consents are separate and unchecked', () => {
  it('records marketing and newsletter independently', async () => {
    const c = await seedLiveCampaign('consent', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const res = await post(c.campaignId, validBody({ founderMarketingConsent: false, newsletterConsent: true }));
    expect(res.status).toBe(201);
    const [row] = await h.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, res.body.reservationId));
    expect(row!.founderMarketingConsent).toBe(false);
    expect(row!.founderMarketingConsentAt).toBeNull();
    expect(row!.newsletterConsent).toBe(true);
    expect(row!.newsletterConsentAt).not.toBeNull();
    // The mandatory 18+/operational ack is its own recorded control, always on.
    expect(row!.ageConfirmed).toBe(true);
    expect(row!.operationalSharingAck).toBe(true);
  });
});

/* ── §33.5.4 — success creates one reservation; failure creates none ────────── */

describe('§33.5.4 — a reservation exists only after SetupIntent success', () => {
  it('a successful SetupIntent creates exactly one reserved_active reservation', async () => {
    const c = await seedLiveCampaign('ok', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const res = await post(c.campaignId, validBody());
    expect(res.status).toBe(201);
    const rows = await h.db.select().from(reservations).where(eq(reservations.campaignId, c.campaignId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('reserved_active');
    expect(rows[0]!.setupIntentId).toMatch(/^seti_/);
    expect(rows[0]!.totalCapturedCents).toBe(0n); // nothing captured
  });

  it('a SetupIntent failure creates no reservation and releases the cap', async () => {
    const c = await seedLiveCampaign('fail', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    gateway.setNextSetupOutcome('requires_payment_method');
    const res = await post(c.campaignId, validBody());
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('setup_failed');
    const rows = await h.db.select().from(reservations).where(eq(reservations.campaignId, c.campaignId));
    expect(rows).toHaveLength(0);
    const [cap] = await h.db
      .select()
      .from(campaignReservationCapacity)
      .where(eq(campaignReservationCapacity.campaignId, c.campaignId));
    expect(cap!.reservedSubtotalCents).toBe(0n);
  });
});

/* ── §33.5.5 — operational sharing reaches the Founder immediately ──────────── */

describe('§33.5.5 — the Founder operational share is created immediately', () => {
  it('shares email + purchase details in an active fulfillment state', async () => {
    const c = await seedLiveCampaign('share', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const body = validBody();
    const email = (body.contact as { email: string }).email;
    const res = await post(c.campaignId, body);
    expect(res.status).toBe(201);
    const [share] = await h.db
      .select()
      .from(founderOperationalShares)
      .where(eq(founderOperationalShares.reservationId, res.body.reservationId));
    expect(share).toBeTruthy();
    expect(share!.fulfillmentState).toBe('active');
    expect(share!.backerEmail).toBe(email);
    expect(share!.founderUserId).toBe(`founder:${c.founderUserId}`);
  });
});

/* ── §33.5.6 — the deduplication record is least-privilege (no raw PII) ─────── */

describe('§33.5.6 — no Backer PII leaks into the dedup record', () => {
  it('stores hashes, never the raw email or phone (§25.3)', async () => {
    const c = await seedLiveCampaign('pii', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const body = validBody();
    const { email, phone } = body.contact as { email: string; phone: string };
    const res = await post(c.campaignId, body);
    expect(res.status).toBe(201);
    const [dedup] = await h.db
      .select()
      .from(reservationDeduplication)
      .where(eq(reservationDeduplication.reservationId, res.body.reservationId));
    expect(dedup).toBeTruthy();
    expect(dedup!.emailHash).not.toBe(email);
    expect(dedup!.phoneHash).not.toBe(phone);
    expect(JSON.stringify(dedup)).not.toContain(email);
    expect(JSON.stringify(dedup)).not.toContain(phone);
  });
});

/* ── §33.5.7 — Idea one-active, dedup, and shared-IP-never-merges ───────────── */

describe('§33.5.7 — one active Idea pre-order per Backer, and dedup rules', () => {
  it('refuses a second Idea pre-order from the same Backer', async () => {
    const c = await seedLiveCampaign('idea1', {
      type: 'pre_build',
      orderThreshold: 100,
      rewards: [{ sku: 'TIER-1', priceCents: 2_500n }],
    });
    const contact = freshContact();
    const first = await post(c.campaignId, validBody({ contact }));
    expect(first.status).toBe(201);
    const second = await post(c.campaignId, validBody({ contact }));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('idea_already_active');
    const rows = await h.db.select().from(reservations).where(eq(reservations.campaignId, c.campaignId));
    expect(rows).toHaveLength(1);
  });

  it('opens an Admin case for a soft email match, but never for shared IP alone', async () => {
    const c = await seedLiveCampaign('idea2', {
      type: 'pre_build',
      orderThreshold: 100,
      rewards: [{ sku: 'TIER-1', priceCents: 2_500n }],
    });
    const a = freshContact();
    const b = { email: a.email, phone: '4155559999' }; // same email, different phone → soft match
    await post(c.campaignId, validBody({ contact: a }));
    await post(c.campaignId, validBody({ contact: b }));
    const cases = await h.db
      .select()
      .from(deduplicationCases)
      .where(eq(deduplicationCases.campaignId, c.campaignId));
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(cases[0]!.signals)).toContain('email');

    // Two entirely different Backers from the same loopback IP open no case.
    const before = cases.length;
    await post(c.campaignId, validBody({ contact: freshContact() }));
    await post(c.campaignId, validBody({ contact: freshContact() }));
    const after = await h.db
      .select()
      .from(deduplicationCases)
      .where(eq(deduplicationCases.campaignId, c.campaignId));
    expect(after.length).toBe(before);
  });
});

/* ── §33.5.9 — Product allows multiple; unique Backer count stays one ────────── */

describe('§33.5.9 — Product allows multiple one-reward transactions per Backer', () => {
  it('two pre-orders from one Backer make two reservations and one identity', async () => {
    const c = await seedLiveCampaign('prod', {
      type: 'pre_launch',
      rewards: [
        { sku: 'TIER-1', priceCents: 2_500n },
        { sku: 'TIER-2', priceCents: 4_000n },
      ],
    });
    const contact = freshContact();
    const first = await post(c.campaignId, validBody({ contact, rewardSku: 'TIER-1' }));
    const second = await post(c.campaignId, validBody({ contact, rewardSku: 'TIER-2' }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const rows = await h.db.select().from(reservations).where(eq(reservations.campaignId, c.campaignId));
    expect(rows).toHaveLength(2);
    const identities = await h.db
      .select()
      .from(backerIdentities)
      .where(eq(backerIdentities.campaignId, c.campaignId));
    expect(identities).toHaveLength(1);
  });
});

/* ── §33.5.10 — concurrent requests near the cap cannot exceed it ───────────── */

describe('§33.5.10 — the pre-tax cap holds under concurrency', () => {
  it('two concurrent near-cap pre-orders cannot exceed the cap', async () => {
    // Cap 40.00; each reward 30.00. Two at once = 60.00 > cap → exactly one wins.
    const c = await seedLiveCampaign('cap', {
      type: 'pre_launch',
      rewards: [{ sku: 'TIER-1', priceCents: 3_000n }],
      capCents: 4_000n,
    });
    const [r1, r2] = await Promise.all([
      post(c.campaignId, validBody()),
      post(c.campaignId, validBody()),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = r1.status === 409 ? r1 : r2;
    expect(rejected.body.error.code).toBe('cap_exceeded');
    const [cap] = await h.db
      .select()
      .from(campaignReservationCapacity)
      .where(eq(campaignReservationCapacity.campaignId, c.campaignId));
    expect(cap!.reservedSubtotalCents).toBe(3_000n);
    expect(cap!.reservedSubtotalCents <= cap!.capCents).toBe(true);
  });
});

/* ── §33.5.11 — the stored tax calculation, expiry, and total reconcile ─────── */

describe('§33.5.11 — the stored tax reconciles and no amount is substituted', () => {
  it('subtotal + stored tax = stored total, with a calculation id and expiry', async () => {
    const c = await seedLiveCampaign('tax', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 5_000n }] });
    const res = await post(c.campaignId, validBody());
    expect(res.status).toBe(201);
    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, res.body.reservationId));
    expect(row!.rewardSubtotalCents).toBe(5_000n);
    expect(row!.salesTaxCents).toBe(400n); // 8%
    expect(row!.totalAuthorizedCents).toBe(5_400n);
    expect(row!.totalAuthorizedCents).toBe(row!.rewardSubtotalCents + row!.salesTaxCents);
    expect(row!.taxCalculationId).toMatch(/^taxcalc_/);
    expect(row!.taxCalculationExpiresAt).not.toBeNull();
    expect(row!.taxJurisdiction).toBeTruthy();
    // This phase creates no PaymentIntent/charge — capture is Phase 18.
    expect(row!.status).toBe('reserved_active');
    expect(row!.totalCapturedCents).toBe(0n);
  });
});

/* ── §33.5.12 — success, email, and ledger all agree, and all say not charged ─ */

describe('§33.5.12 — success page, email, and ledger agree', () => {
  it('the response, the email, and the reservation carry the same amounts', async () => {
    const before = h.sentEmails.messages.length;
    const c = await seedLiveCampaign('agree', { type: 'pre_launch', rewards: [{ sku: 'TIER-1', priceCents: 2_500n }] });
    const body = validBody();
    const email = (body.contact as { email: string }).email;
    const res = await post(c.campaignId, body);
    expect(res.status).toBe(201);
    expect(res.body.totalAuthorized).toBe('27.00');
    expect(res.body.chargedToday).toBe('0.00');

    const [row] = await h.db.select().from(reservations).where(eq(reservations.id, res.body.reservationId));
    expect(row!.totalAuthorizedCents).toBe(2_700n);

    const message = h.sentEmails.messages.slice(before).find((m) => m.to === email);
    expect(message).toBeTruthy();
    expect(message!.text).toContain('you were not charged');
    expect(message!.text).toContain('US$27.00');
  });
});

/* ── §33.5.8 — a failed Idea reward replacement keeps the old selection ──────── */

describe('§33.5.8 — a failed reward replacement preserves the old selection', () => {
  it('leaves the original reservation active when the new SetupIntent fails', async () => {
    const c = await seedLiveCampaign('replace', {
      type: 'pre_build',
      orderThreshold: 100,
      rewards: [
        { sku: 'TIER-1', priceCents: 2_500n },
        { sku: 'TIER-2', priceCents: 6_000n },
      ],
    });
    const contact = freshContact();
    const first = await post(c.campaignId, validBody({ contact, rewardSku: 'TIER-1' }));
    expect(first.status).toBe(201);
    const oldId = first.body.reservationId;

    const [identity] = await h.db
      .select()
      .from(backerIdentities)
      .where(eq(backerIdentities.campaignId, c.campaignId));

    const { replaceIdeaReward } = await import('../reservations/preorder.js');
    const { createAuditWriter } = await import('../auth/audit.js');
    gateway.setNextSetupOutcome('requires_payment_method');
    const result = await replaceIdeaReward(
      {
        db: h.db,
        gateway,
        audit: createAuditWriter(h.db),
        tokenService: h.tokens,
        secret: 'test-secret',
        appBaseUrl: 'http://localhost:3000',
      },
      {
        campaignId: c.campaignId,
        backerIdentityId: identity!.id,
        newRewardSku: 'TIER-2',
        billing: { country: 'US', postalCode: '10001', state: 'NY' },
        paymentMethodId: `pm_${randomUUID().slice(0, 8)}`,
      },
    );
    expect(result.ok).toBe(false);

    const rows = await h.db.select().from(reservations).where(eq(reservations.campaignId, c.campaignId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(oldId);
    expect(rows[0]!.status).toBe('reserved_active');
    expect(rows[0]!.rewardSku).toBe('TIER-1');
  });

  it('a successful replacement cancels the old and activates the new', async () => {
    const c = await seedLiveCampaign('replace2', {
      type: 'pre_build',
      orderThreshold: 100,
      rewards: [
        { sku: 'TIER-1', priceCents: 2_500n },
        { sku: 'TIER-2', priceCents: 6_000n },
      ],
    });
    const contact = freshContact();
    const first = await post(c.campaignId, validBody({ contact, rewardSku: 'TIER-1' }));
    const oldId = first.body.reservationId;
    const [identity] = await h.db
      .select()
      .from(backerIdentities)
      .where(eq(backerIdentities.campaignId, c.campaignId));

    const { replaceIdeaReward } = await import('../reservations/preorder.js');
    const { createAuditWriter } = await import('../auth/audit.js');
    const result = await replaceIdeaReward(
      {
        db: h.db,
        gateway,
        audit: createAuditWriter(h.db),
        tokenService: h.tokens,
        secret: 'test-secret',
        appBaseUrl: 'http://localhost:3000',
      },
      {
        campaignId: c.campaignId,
        backerIdentityId: identity!.id,
        newRewardSku: 'TIER-2',
        billing: { country: 'US', postalCode: '10001', state: 'NY' },
        paymentMethodId: `pm_${randomUUID().slice(0, 8)}`,
      },
    );
    expect(result.ok).toBe(true);

    const [oldRow] = await h.db.select().from(reservations).where(eq(reservations.id, oldId));
    expect(oldRow!.status).toBe('reserved_canceled');
    const active = await h.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.campaignId, c.campaignId), eq(reservations.status, 'reserved_active')));
    expect(active).toHaveLength(1);
    expect(active[0]!.rewardSku).toBe('TIER-2');
  });
});

/* ── Consent + restated drift: the backend copies match @proovd/shared ──────── */

describe('the restated backend logic matches @proovd/shared exactly', () => {
  it('A.3 and A.4 consent templates are identical to shared', () => {
    expect(IDEA_CONSENT_TEMPLATE).toBe(SHARED_IDEA);
    expect(PRODUCT_CONSENT_TEMPLATE).toBe(SHARED_PRODUCT);
  });

  it('the resolvers, normalization, and survey produce identical results', () => {
    const ideaVars = {
      campaignTitle: 'X',
      founderLegalName: 'Y',
      rewardPackageName: 'Z',
      rewardSubtotal: '25.00',
      salesTax: '2.00',
      totalAuthorized: '27.00',
      closeDateUtc: 'March 3, 2026, 5:00 PM UTC',
      orderThreshold: '500',
      expectedStatementDescriptor: 'PROOVD X',
    };
    expect(restatedResolveIdea(ideaVars).body).toBe(sharedResolveIdea(ideaVars).body);

    const productVars = {
      campaignTitle: 'X',
      founderLegalName: 'Y',
      rewardPackageName: 'Z',
      rewardSubtotal: '25.00',
      salesTax: '2.00',
      totalAuthorized: '27.00',
      closeDateUtc: 'March 3, 2026, 5:00 PM UTC',
      deliveryMonthYear: 'June 2026',
      policyReference: 'Refund Policy v1',
      preservedPolicyUrl: 'https://app.proovd.co/refunds',
      expectedStatementDescriptor: 'PROOVD X',
    };
    expect(restatedResolveProduct(productVars).body).toBe(sharedResolveProduct(productVars).body);

    expect(restatedNormalize({ email: 'A@B.com', phone: '(415) 555-0100' })).toEqual(
      sharedNormalize({ email: 'A@B.com', phone: '(415) 555-0100' }),
    );
    expect(restatedSurvey({ why: 'ok', recommend: 3 })).toEqual(
      sharedSurvey({ why: 'ok', recommend: 3 }),
    );
  });
});
