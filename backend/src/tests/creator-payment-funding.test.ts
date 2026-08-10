/**
 * Phase 13 — the optional fixed Creator payment funding and the §16 Creator
 * readiness checklist.
 *
 * Acceptance: §33.4.3 (fixed funding requires the exact full amount and a
 * mutually accepted version; failed/partial/duplicate funding cannot mark it
 * funded) and §33.4.4 (no Creator begins work before every applicable readiness
 * item is complete) — plus the brief's done-when list: an Idea Campaign can
 * reach no allocation by any path; missing the funding deadline cancels the
 * association and the 20% base stops applying; the allocation appears in no
 * percentage/tax/threshold/cap; stable idempotency keys; and the banned words
 * appear nowhere in Phase 13's code.
 *
 * The gateway is the in-memory one: real webhook signature verification (the
 * suite signs with Stripe's own helper, so `constructEvent` is what runs), fake
 * payment API. Each scenario seeds its own campaign and Creator directly — the
 * acceptance journey is Phase 12a's suite, already green; what is under test
 * here is what funding and readiness do.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import path from 'node:path';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_PLATFORM_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles, policyConsents } from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  associationAcceptanceConfirmations,
  trackingLinks,
} from '../db/schema/decisions.js';
import {
  campaignBuild,
  campaignRewardPackages,
  campaignReviews,
  approvedCampaignSnapshots,
  associationReadiness,
} from '../db/schema/build.js';
import {
  creatorPaymentAllocations,
  creatorPaymentFundingAttempts,
} from '../db/schema/creator-payment.js';
import {
  ensureAllocation,
  beginAllocationFunding,
  creatorPaymentKeys,
  findAllocation,
} from '../creator-payment/allocations.js';
import {
  evaluateCreatorReadiness,
  gatherCreatorReadiness,
  scheduleCampaignLive,
  cancelAssociationForFundingLapse,
} from '../creator-payment/readiness.js';
import {
  deriveCreatorReadiness as backendDerive,
  READINESS_ITEMS as BACKEND_ITEMS,
  type CreatorReadinessSnapshot,
} from '../creator-payment/logic.js';
import { FIXED_PAYMENT_LABEL } from '../creator-payment/labels.js';
import {
  deriveCreatorReadiness as sharedDerive,
  READINESS_ITEMS as SHARED_ITEMS,
  FIXED_PAYMENT_LABELS,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_funding_suite';
const CONNECT_SECRET = 'whsec_connect_for_funding_suite';
const APP_BASE = 'https://app.example.com';

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      stripeConnectUrls: { returnUrl: `${APP_BASE}/stripe/return`, refreshUrl: `${APP_BASE}/stripe/refresh` },
      authRouteLimit: 1_000_000,
      globalRateLimit: 1_000_000,
    },
    'funding',
  );
  admin = await createAdmin(h, 'funding-admin');
  audit = createAuditWriter(h.db);
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

const FIXED_AMOUNT = 50_000n; // US$500.00

/* ── A seeded, accepted Creator with (optionally) a fixed payment ──────────── */

interface Seeded {
  campaignId: string;
  founderId: string;
  associationId: string;
  creatorUserId: string;
  agreementId: string;
  versionId: string;
}

async function seedAccepted(
  label: string,
  options: {
    type?: 'pre_build' | 'pre_launch';
    status?: 'approved' | 'creator_prep' | 'affiliate_response_and_build';
    fixedPayment?: boolean;
    associationStatus?: 'accepted' | 'readiness_blocked' | 'ready';
  } = {},
): Promise<Seeded> {
  const type = options.type ?? 'pre_launch';
  const founder = await seedUser(h, 'founder', `fund-founder-${label}`);

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
      status: options.status ?? 'creator_prep',
      type,
      typeLockedAt: new Date(),
      highEffort: false,
      highEffortCalculatedAt: new Date(),
      listingPaidAt: new Date(),
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
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const creator = await seedUser(h, 'affiliate', `fund-creator-${label}`);
  const [cp] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      audienceNiche: 'hardware',
      audienceSize: '120k',
      adminBio: 'Reviews early hardware.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: cp!.id,
      status: options.associationStatus ?? 'accepted',
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
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  const [version] = await h.db
    .insert(proposalVersions)
    .values({
      associationId,
      campaignId,
      versionNumber: 1,
      proposedBy: 'affiliate',
      // The version must carry a value (§14.2's values-present CHECK): a fixed
      // request, or a bid. The non-fixed case locks at a 30% bid.
      bidTotalPercent: options.fixedPayment ? null : 30,
      fixedPaymentRequestCents: options.fixedPayment ? FIXED_AMOUNT : null,
      state: 'locked',
      affiliateDecision: 'proposed',
      affiliateDecidedAt: new Date(),
      founderDecision: 'accepted',
      founderDecidedAt: new Date(),
      lockedAt: new Date(),
    })
    .returning({ id: proposalVersions.id });

  const [agreement] = await h.db
    .insert(associationCompensationAgreements)
    .values({
      associationId,
      campaignId,
      source: 'proposal_version',
      proposalVersionId: version!.id,
      basePercent: options.fixedPayment ? 20 : 30,
      bidIncreasePercent: 0,
      totalPercent: options.fixedPayment ? 20 : 30,
      fixedPaymentCents: options.fixedPayment ? FIXED_AMOUNT : null,
      affiliateAcceptedAt: new Date(),
      founderAcceptedAt: new Date(),
    })
    .returning({ id: associationCompensationAgreements.id });

  return {
    campaignId,
    founderId: founder.id,
    associationId,
    creatorUserId: creator.id,
    agreementId: agreement!.id,
    versionId: version!.id,
  };
}

/**
 * Fills every remaining §16 fact so the Creator can begin work — the approved
 * snapshot and build, the reward package, the tracking link, the acceptance
 * confirmation, the confirmed deliverables, and the complete recipient account.
 * The fixed-allocation item is the only one left to the caller.
 */
async function seedRemainingReadinessFacts(seeded: Seeded, label: string): Promise<void> {
  const [review] = await h.db
    .insert(campaignReviews)
    .values({ campaignId: seeded.campaignId, round: 1, submittedBy: 'user:test', outcome: 'approved', decidedAt: new Date(), decidedBy: 'admin:test' })
    .returning({ id: campaignReviews.id });

  await h.db.insert(approvedCampaignSnapshots).values({
    campaignId: seeded.campaignId,
    reviewId: review!.id,
    snapshot: {},
    creatorTerms: [],
    approvedBy: 'admin:test',
  });

  await h.db.insert(campaignBuild).values({
    campaignId: seeded.campaignId,
    title: `Campaign ${label}`,
    publicStory: 'A launch story.',
    heroPreference: 'hero-image',
    requiredWording: 'Say it truthfully.',
    prohibitedClaims: 'No medical claims.',
    opensAt: new Date(Date.now() + 86_400_000),
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values({
    campaignId: seeded.campaignId,
    sku: 'TIER-1',
    title: 'Early bird',
    priceCents: 5_000n,
    contents: 'One unit.',
    fulfillmentCommitment: 'We will ship it.',
    delivery: '2026-12',
  });

  await h.db.insert(trackingLinks).values({
    associationId: seeded.associationId,
    campaignId: seeded.campaignId,
    code: `code-${label}-${randomUUID().slice(0, 8)}`,
  });

  // A published policy version so the acceptance-confirmation consent FK is valid.
  const [pv] = await h.db
    .insert(policyVersions)
    .values({
      slug: `test-ip-${label}`,
      route: `/policies/test-ip-${label}`,
      title: 'Test IP agreement',
      version: 'v1',
      status: 'published',
      effectiveDate: '2026-01-01',
      publishedAt: new Date(),
    })
    .returning({ id: policyVersions.id });

  const [consent] = await h.db
    .insert(policyConsents)
    .values({
      subjectType: 'user',
      subjectId: seeded.creatorUserId,
      policyVersionId: pv!.id,
      slug: `test-ip-${label}`,
      version: 'v1',
      acceptedVia: 'test',
    })
    .returning({ id: policyConsents.id });

  await h.db.insert(associationAcceptanceConfirmations).values({
    associationId: seeded.associationId,
    campaignId: seeded.campaignId,
    compensationTermsConfirmedAt: new Date(),
    ipAgreementConsentId: consent!.id,
    ftcDisclosureAcknowledgedAt: new Date(),
    termsAupState: { terms: { version: 'v1', status: 'published' } },
  });

  await h.db.insert(associationReadiness).values({
    associationId: seeded.associationId,
    campaignId: seeded.campaignId,
    rosterDecision: 'included',
    launchRequired: true,
    readinessConfirmedAt: new Date(),
    decidedBy: 'admin:test',
    decidedAt: new Date(),
  });

  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_fund${label.replace(/[^a-z0-9]/gi, '')}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    mode: 'test',
    role: 'affiliate_recipient',
    ownerUserId: seeded.creatorUserId,
    state: 'complete',
    chargesEnabled: false,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
}

/* ── Signed Stripe events ──────────────────────────────────────────────────── */

function signedEvent(input: { type: string; object: Record<string, unknown>; id?: string }): {
  payload: string;
  signature: string;
  id: string;
} {
  const id = input.id ?? `evt_${randomUUID().replace(/-/g, '')}`;
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: PLATFORM_SECRET }),
    id,
  };
}

async function deliverFundingCompleted(
  sessionId: string,
  opts: { amountTotal: bigint; eventId?: string },
): Promise<void> {
  const session = gateway.sessions.find((s) => s.id === sessionId)!;
  const { payload, signature } = signedEvent({
    type: 'checkout.session.completed',
    ...(opts.eventId ? { id: opts.eventId } : {}),
    object: {
      id: sessionId,
      object: 'checkout.session',
      amount_total: Number(opts.amountTotal),
      payment_intent: session.paymentIntentId,
      metadata: session.metadata,
      status: 'complete',
    },
  });
  await request(h.app)
    .post(STRIPE_PLATFORM_WEBHOOK_PATH)
    .set(STRIPE_SIGNATURE_HEADER, signature)
    .set('content-type', 'application/json')
    .send(payload)
    .expect(200);
}

async function openFunding(seeded: Seeded): Promise<string> {
  const result = await beginAllocationFunding(
    { db: h.db, gateway, audit, successUrl: `${APP_BASE}/ok`, cancelUrl: `${APP_BASE}/no` },
    { associationId: seeded.associationId, founderUserId: seeded.founderId, actor: `user:${seeded.founderId}` },
  );
  if (!result.ok) throw new Error(`funding did not open: ${result.code}`);
  return result.sessionId;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.3 — fixed funding                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.3 — fixed funding requires the exact full amount and an accepted version', () => {
  it('creates exactly ONE allocation for the exact accepted amount, idempotently', async () => {
    const seeded = await seedAccepted('one-alloc', { fixedPayment: true });

    const first = await ensureAllocation(h.db, gateway, seeded.associationId);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.allocation.amountCents).toBe(FIXED_AMOUNT);
    expect(first.allocation.status).toBe('payment_pending');

    // A second ensure is a no-op — one allocation per association.
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const rows = await h.db
      .select()
      .from(creatorPaymentAllocations)
      .where(eq(creatorPaymentAllocations.associationId, seeded.associationId));
    expect(rows).toHaveLength(1);
  });

  it('a standard-terms association (no fixed payment) has no allocation to fund', async () => {
    const seeded = await seedAccepted('no-fixed', { fixedPayment: false });
    const result = await ensureAllocation(h.db, gateway, seeded.associationId);
    expect(result.status).toBe('not_applicable');
  });

  it('the EXACT full amount marks it funded', async () => {
    const seeded = await seedAccepted('exact', { fixedPayment: true });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);

    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT });

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.status).toBe('funded');
    expect(allocation?.fundedAt).not.toBeNull();

    const attempts = await h.db
      .select()
      .from(creatorPaymentFundingAttempts)
      .where(eq(creatorPaymentFundingAttempts.allocationId, allocation!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('succeeded');
  });

  it('PARTIAL funding is rejected outright — never marked funded', async () => {
    const seeded = await seedAccepted('partial', { fixedPayment: true });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);

    // $400 against a $500 allocation — the failure §33.4.3 tests.
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT - 10_000n });

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.status).toBe('payment_failed');
    expect(allocation?.fundedAt).toBeNull();

    const attempts = await h.db
      .select()
      .from(creatorPaymentFundingAttempts)
      .where(eq(creatorPaymentFundingAttempts.allocationId, allocation!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('failed');
    expect(attempts[0]!.failureCode).toBe('amount_mismatch');
  });

  it('an OVER-payment is also rejected — the amount must be exact', async () => {
    const seeded = await seedAccepted('over', { fixedPayment: true });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);

    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT + 100n });

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.status).toBe('payment_failed');
    expect(allocation?.fundedAt).toBeNull();
  });

  it('an expired funding Checkout leaves it payment_failed, never funded, and retryable', async () => {
    const seeded = await seedAccepted('expired', { fixedPayment: true });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);
    const session = gateway.sessions.find((s) => s.id === sessionId)!;

    const { payload, signature } = signedEvent({
      type: 'checkout.session.expired',
      object: { id: sessionId, metadata: session.metadata },
    });
    await request(h.app)
      .post(STRIPE_PLATFORM_WEBHOOK_PATH)
      .set(STRIPE_SIGNATURE_HEADER, signature)
      .set('content-type', 'application/json')
      .send(payload)
      .expect(200);

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.status).toBe('payment_failed');
    expect(allocation?.fundedAt).toBeNull();
    // The exact accepted amount is preserved on the allocation.
    expect(allocation?.amountCents).toBe(FIXED_AMOUNT);

    // Work stays blocked but funding can be retried — the allocation is neither
    // funded nor canceled, so `beginAllocationFunding` opens again (§16), and no
    // second allocation is created.
    const retry = await beginAllocationFunding(
      { db: h.db, gateway, audit, successUrl: `${APP_BASE}/ok`, cancelUrl: `${APP_BASE}/no` },
      { associationId: seeded.associationId, founderUserId: seeded.founderId, actor: `user:${seeded.founderId}` },
    );
    expect(retry.ok).toBe(true);
    const allocations = await h.db
      .select()
      .from(creatorPaymentAllocations)
      .where(eq(creatorPaymentAllocations.associationId, seeded.associationId));
    expect(allocations).toHaveLength(1);
  });

  it('DUPLICATE funding — a replayed event and a fresh event both change nothing', async () => {
    const seeded = await seedAccepted('dupe', { fixedPayment: true });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);

    const eventId = `evt_dupe_${randomUUID().replace(/-/g, '')}`;
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT, eventId });
    // Same event id again — provider_events dedup.
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT, eventId });
    // A fresh event id for the same allocation — already-funded suppression.
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT });

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.status).toBe('funded');

    const succeeded = await h.db
      .select()
      .from(creatorPaymentFundingAttempts)
      .where(
        and(
          eq(creatorPaymentFundingAttempts.allocationId, allocation!.id),
          eq(creatorPaymentFundingAttempts.status, 'succeeded'),
        ),
      );
    expect(succeeded).toHaveLength(1);

    // Exactly one funded-idempotency key claim.
    const allocationId = allocation!.id;
    const keys = await h.db.execute(
      sql`SELECT count(*)::int AS n FROM idempotency_keys WHERE key = ${creatorPaymentKeys.funding(allocationId)}`,
    );
    expect(Number((keys.rows[0] as { n: number }).n)).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* An Idea Campaign can reach no fixed-payment allocation by any path          */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('An Idea Campaign cannot reach a fixed-payment allocation', () => {
  it('the agreement trigger refuses a fixed payment on an Idea Campaign (§14.3, §33.2.8)', async () => {
    // Even a hand-written agreement is refused at the database level.
    await expect(
      seedAccepted('idea-agreement', { type: 'pre_build', fixedPayment: true }),
    ).rejects.toThrow();
  });

  it('the allocation trigger refuses an Idea campaign_id even by direct INSERT', async () => {
    // A Product association's version/agreement, then a direct allocation insert
    // pointed at an Idea campaign — the belt-and-suspenders 0019 trigger.
    const idea = await seedAccepted('idea-alloc', { type: 'pre_build', fixedPayment: false });
    const product = await seedAccepted('prod-src', { type: 'pre_launch', fixedPayment: true });
    await expect(
      h.db.insert(creatorPaymentAllocations).values({
        associationId: product.associationId,
        campaignId: idea.campaignId,
        proposalVersionId: product.versionId,
        agreementId: product.agreementId,
        mode: 'test',
        amountCents: FIXED_AMOUNT,
        taxTreatment: 'test',
      }),
    ).rejects.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.4 — no Creator begins work before all readiness items                 */
/* ══════════════════════════════════════════════════════════════════════════ */

const ALL_COMPLETE: CreatorReadinessSnapshot = {
  campaignApproved: true,
  rewardsFinal: true,
  compensationFinal: true,
  brandAssetsPresent: true,
  claimsRulesPresent: true,
  trackingLinkPresent: true,
  ftcAcknowledged: true,
  deliverablesConfirmed: true,
  campaignDatesSet: true,
  ipAgreementAccepted: true,
  termsAupAccepted: true,
  fixedPaymentApplicable: true,
  fixedAllocationFunded: true,
  connectedAccountReady: true,
};

describe('§33.4.4 — readiness is all-or-nothing (pure)', () => {
  it('every applicable item complete → the Creator may begin work', () => {
    const result = backendDerive(ALL_COMPLETE);
    expect(result.canBeginWork).toBe(true);
    expect(result.incompleteItems).toHaveLength(0);
  });

  it('twelve of thirteen complete → the Creator cannot begin, and the gap is named', () => {
    const keys: Array<keyof CreatorReadinessSnapshot> = [
      'campaignApproved',
      'rewardsFinal',
      'compensationFinal',
      'brandAssetsPresent',
      'claimsRulesPresent',
      'trackingLinkPresent',
      'ftcAcknowledged',
      'deliverablesConfirmed',
      'campaignDatesSet',
      'ipAgreementAccepted',
      'termsAupAccepted',
      'fixedAllocationFunded',
      'connectedAccountReady',
    ];
    for (const key of keys) {
      const dropped = backendDerive({ ...ALL_COMPLETE, [key]: false });
      expect(dropped.canBeginWork).toBe(false);
      expect(dropped.incompleteItems.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the fixed-allocation item does not apply when no fixed payment was accepted', () => {
    const noFixed = backendDerive({ ...ALL_COMPLETE, fixedPaymentApplicable: false, fixedAllocationFunded: false });
    expect(noFixed.canBeginWork).toBe(true);
    expect(noFixed.incompleteItems).not.toContain('fixed_allocation_funded');
  });
});

describe('§33.4.4 — the backend derivation matches the shared reference (drift)', () => {
  it('the item registry keys/labels agree', () => {
    expect(BACKEND_ITEMS.map((i) => i.key)).toEqual(SHARED_ITEMS.map((i) => i.key));
    expect(BACKEND_ITEMS.map((i) => i.label)).toEqual(SHARED_ITEMS.map((i) => i.label));
    expect(BACKEND_ITEMS.map((i) => i.fixedPaymentOnly)).toEqual(SHARED_ITEMS.map((i) => i.fixedPaymentOnly));
  });

  it('the decision agrees on the complete and the drop-one snapshots', () => {
    expect(backendDerive(ALL_COMPLETE).canBeginWork).toBe(sharedDerive(ALL_COMPLETE).canBeginWork);
    const dropped = { ...ALL_COMPLETE, connectedAccountReady: false };
    expect(backendDerive(dropped).incompleteItems).toEqual(sharedDerive(dropped).incompleteItems);
  });

  it('the customer-facing labels are the §16 permitted vocabulary', () => {
    const permitted = Object.values(FIXED_PAYMENT_LABELS);
    for (const label of Object.values(FIXED_PAYMENT_LABEL)) {
      expect(permitted).toContain(label);
    }
  });
});

describe('§33.4.4 — readiness drives the association status (integration)', () => {
  it('a fully-ready Creator (no fixed payment) moves accepted → ready', async () => {
    const seeded = await seedAccepted('ready-nofixed', { fixedPayment: false, status: 'creator_prep' });
    await seedRemainingReadinessFacts(seeded, 'ready-nofixed');

    const gathered = await gatherCreatorReadiness(h.db, 'test', seeded.associationId);
    expect(gathered).not.toBeNull();
    expect(backendDerive(gathered!.snapshot).canBeginWork).toBe(true);

    const report = await evaluateCreatorReadiness(h.db, { audit, mode: 'test' }, {
      associationId: seeded.associationId,
      actor: 'admin:test',
    });
    expect(report?.canBeginWork).toBe(true);
    expect(report?.associationStatus).toBe('ready');
  });

  it('a Creator whose only gap is the unfunded fixed allocation stays blocked until funded', async () => {
    const seeded = await seedAccepted('ready-fixed', { fixedPayment: true, status: 'creator_prep' });
    await seedRemainingReadinessFacts(seeded, 'ready-fixed');
    await ensureAllocation(h.db, gateway, seeded.associationId);

    // Unfunded → the one incomplete item is the fixed allocation → blocked.
    const blocked = await evaluateCreatorReadiness(h.db, { audit, mode: 'test' }, {
      associationId: seeded.associationId,
      actor: 'admin:test',
    });
    expect(blocked?.canBeginWork).toBe(false);
    expect(blocked?.incompleteItems).toEqual(['fixed_allocation_funded']);
    expect(blocked?.associationStatus).toBe('readiness_blocked');

    // Fund it exactly → now ready.
    const sessionId = await openFunding(seeded);
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT });

    const ready = await evaluateCreatorReadiness(h.db, { audit, mode: 'test' }, {
      associationId: seeded.associationId,
      actor: 'admin:test',
    });
    expect(ready?.canBeginWork).toBe(true);
    expect(ready?.associationStatus).toBe('ready');
  });
});

describe('§16 — Admin schedules ONE campaign_live_at only when everything is ready', () => {
  it('refuses to schedule while a required Creator is not ready, then schedules once ready', async () => {
    const seeded = await seedAccepted('schedule', { fixedPayment: false, status: 'creator_prep' });
    await seedRemainingReadinessFacts(seeded, 'schedule');

    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

    // The required Creator is still `accepted`, not `ready` → refused.
    const early = await scheduleCampaignLive(h.db, { audit, mode: 'test' }, {
      campaignId: seeded.campaignId,
      liveAt: new Date(future),
      actor: 'admin:test',
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('not_ready');

    // Make the Creator ready, then schedule succeeds and sets the anchor once.
    await evaluateCreatorReadiness(h.db, { audit, mode: 'test' }, { associationId: seeded.associationId, actor: 'admin:test' });
    const ok = await scheduleCampaignLive(h.db, { audit, mode: 'test' }, {
      campaignId: seeded.campaignId,
      liveAt: new Date(future),
      actor: 'admin:test',
    });
    expect(ok.ok).toBe(true);

    const [row] = await h.db
      .select({ liveAt: campaigns.campaignLiveAt })
      .from(campaigns)
      .where(eq(campaigns.id, seeded.campaignId));
    expect(row!.liveAt).not.toBeNull();

    // A second schedule is refused — one exact campaign_live_at (§16).
    const second = await scheduleCampaignLive(h.db, { audit, mode: 'test' }, {
      campaignId: seeded.campaignId,
      liveAt: new Date(Date.now() + 5 * 86_400_000),
      actor: 'admin:test',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('already_scheduled');
  });
});

describe('§16 — missing the funding deadline cancels the association; the 20% base stops applying', () => {
  it('removes the association and closes the allocation, so no live 20% relationship remains', async () => {
    const seeded = await seedAccepted('lapse', { fixedPayment: true, status: 'creator_prep' });
    await ensureAllocation(h.db, gateway, seeded.associationId);

    const result = await cancelAssociationForFundingLapse(h.db, { audit }, {
      associationId: seeded.associationId,
      reason: 'funding deadline missed',
      actor: 'admin:test',
    });
    expect(result.ok).toBe(true);

    const [assoc] = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, seeded.associationId));
    // §23.4: removed is terminal — the reduced 20% base has no live association
    // to govern.
    expect(assoc!.status).toBe('removed');

    const allocation = await findAllocation(h.db, seeded.associationId);
    expect(allocation?.canceledAt).not.toBeNull();
    expect(allocation?.status).not.toBe('funded');
  });

  it('will NOT cancel a funded allocation as a lapse', async () => {
    const seeded = await seedAccepted('lapse-funded', { fixedPayment: true, status: 'creator_prep' });
    await ensureAllocation(h.db, gateway, seeded.associationId);
    const sessionId = await openFunding(seeded);
    await deliverFundingCompleted(sessionId, { amountTotal: FIXED_AMOUNT });

    const result = await cancelAssociationForFundingLapse(h.db, { audit }, {
      associationId: seeded.associationId,
      actor: 'admin:test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('funded');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* The stream touches no percentage, tax base, threshold, or cap               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('The allocation is its own stream (§24.7, §33.4.3)', () => {
  it('carries no reservation, association-ledger, or Connect-account money columns', async () => {
    const columns = await h.db.execute(
      sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('creator_payment_allocations', 'creator_payment_funding_attempts')
      `,
    );
    const names = columns.rows.map((r) => (r as { column_name: string }).column_name);
    for (const forbidden of ['reservation_id', 'reward_subtotal_cents', 'connected_account_id', 'percent', 'sales_tax_cents']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('the stable idempotency keys are distinct and deterministic', () => {
    const id = 'alloc-123';
    expect(creatorPaymentKeys.funding(id)).toBe('creator_payment_funded:alloc-123');
    expect(creatorPaymentKeys.return(id)).toBe('creator-payment-return:alloc-123');
    expect(creatorPaymentKeys.finalization(id)).toBe('creator-payment-finalized:alloc-123');
    expect(creatorPaymentKeys.transfer(id)).toBe('creator-payment-transfer:alloc-123');
    // Funding, return, finalization, Transfer — four distinct keys.
    const all = [
      creatorPaymentKeys.funding(id),
      creatorPaymentKeys.return(id),
      creatorPaymentKeys.finalization(id),
      creatorPaymentKeys.transfer(id),
    ];
    expect(new Set(all).size).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* Banned vocabulary (§16, §3.1)                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('The banned words appear nowhere in Phase 13 code, schema, or copy', () => {
  it('escrow, custody, trust, upfront payout, first half, final half are absent', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '..', '..', '..');
    const phase13Files = [
      'backend/src/db/schema/creator-payment.ts',
      'backend/src/db/migrations/0019_creator_payment_funding.sql',
      'backend/src/creator-payment/allocations.ts',
      'backend/src/creator-payment/readiness.ts',
      'backend/src/creator-payment/logic.ts',
      'backend/src/creator-payment/labels.ts',
      'backend/src/creator-payment/views.ts',
      'backend/src/routes/founder-creator-payment.ts',
      'backend/src/routes/admin-creator-readiness.ts',
      'shared/src/creator-payment/index.ts',
      'frontend/src/surfaces/founder/CreatorReadiness.tsx',
      // The Admin-side §16 verification panel was removed with the rest of the
      // old Admin Dashboard; its workspace will be supplied with the Creators
      // section. The §24.7 vocabulary rule is unchanged — this list names the
      // files that exist, and the Founder-facing surface still carries it.
    ];
    const banned = [/\bescrow\b/i, /\bcustody\b/i, /\btrust\b/i, /upfront payout/i, /first half/i, /final half/i];
    for (const file of phase13Files) {
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const pattern of banned) {
        expect(pattern.test(text), `${file} must not contain ${pattern}`).toBe(false);
      }
    }
  });
});
