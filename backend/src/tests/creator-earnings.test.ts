/**
 * Phase 19a — Creator completion, earnings finalization, the one Transfer, the
 * §24.4 provisional reconciliation, and the §22.2 thank-you.
 *
 * Acceptance: §33.8.1 (5% and Creator percentage exclude tax), §33.8.2
 * (provisional maximum and earned/unearned reconciliation happen once and are
 * never Proovd revenue), §33.8.3 (one Transfer combining commission + bonus +
 * eligible fixed), §33.8.4 (a synchronous Transfer failure records and retries
 * idempotently), §33.8.5–§33.8.7 (the fixed-payment outcome table), §33.8.8
 * (a returned or paid allocation cannot repeat), §33.8.14 (the thank-you is
 * never estimated or promised, cannot use campaign balances, and cannot
 * duplicate) — plus the done-when that the §11 tax-accountability record gates
 * every Transfer, and the drift tests pinning the 19a registers against
 * @proovd/shared.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import {
  creatorCompletionDecisions,
  creatorEarnings,
  creatorEarningsStateHistory,
  affiliateTransfers,
  contractualRecoveryRecords,
  thankYouRecords,
} from '../db/schema/earnings.js';
import {
  creatorPaymentAllocations,
  creatorPaymentFundingAttempts,
} from '../db/schema/creator-payment.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  associationCompensationAgreements,
  creatorBonuses,
  proposalVersions,
  trackingLinks,
} from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { listingFeeCalculations } from '../db/schema/workspace.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { runCloseBatch } from '../close/close-batch.js';
import {
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveEarningsForTransfer,
  createAffiliateTransfer,
  sweepTransferRetries,
  returnFixedAllocation,
  recordThankYou,
  readCampaignEarnings,
  earningsTransferKey,
  thankYouPaymentKey,
} from '../close/earnings.js';
import { readCreatorClose } from '../close/creator-close.js';
import { recordTaxAccountability } from '../payments/tax-accountability.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import {
  COMPLETION_OUTCOMES as BACKEND_OUTCOMES,
  EARNINGS_STATE_TRANSITIONS as BACKEND_TRANSITIONS,
  TRANSFER_EARLIEST_DAY as BACKEND_DAY,
  THANK_YOU_FUNDING_SOURCE as BACKEND_FUNDING_SOURCE,
  THANK_YOU_ELIGIBILITY_FACTS as BACKEND_FACTS,
  BANNED_MONEY_STATUS_WORDS as BACKEND_BANNED,
  earnedPercentFor as backendEarnedPercentFor,
  finalizeEarningsRows as backendFinalizeRows,
} from '../close/earnings-logic.js';
import {
  COMPLETION_OUTCOMES as SHARED_OUTCOMES,
  EARNINGS_STATE_TRANSITIONS as SHARED_TRANSITIONS,
  TRANSFER_EARLIEST_DAY as SHARED_DAY,
  THANK_YOU_FUNDING_SOURCE as SHARED_FUNDING_SOURCE,
  THANK_YOU_ELIGIBILITY_FACTS as SHARED_FACTS,
  BANNED_MONEY_STATUS_WORDS as SHARED_BANNED,
  earnedPercentFor as sharedEarnedPercentFor,
  finalizeEarningsRows as sharedFinalizeRows,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_earnings_suite';
const CONNECT_SECRET = 'whsec_connect_for_earnings_suite';

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

/** Comfortably past Day 3 for a campaign whose close was back-dated to now. */
const AFTER_DAY_3 = () => new Date(Date.now() + (BACKEND_DAY * 24 + 2) * 3_600_000);

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'creator-earnings',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'creator-earnings-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return {
    db: h.db,
    gateway,
    audit,
    notifier: h.notifier,
    context: CONTEXT,
  };
}

/* ── Seeding (the close suites' shape) ──────────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `earn-founder-${label}`);
  const closeAt = new Date(Date.now() + 14 * 24 * 3_600_000);

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
      ? {
          refundPolicyTitle: `${label} Refund`,
          refundPolicyVersion: 'v1',
          refundPolicySourceUrl: 'https://app.proovd.co/r',
        }
      : {}),
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values([
    {
      campaignId,
      sku: 'TIER-1',
      title: 'Reward 1',
      priceCents: 2_500n,
      contents: 'x',
      fulfillmentCommitment: 'y',
      delivery: 'December 2026',
      sortOrder: 0,
    },
  ]);

  return { campaignId, founderUserId: founder.id, connectedAccountId: stripeAccountId };
}

const FIXED_AMOUNT = 50_000n; // US$500.00

interface SeededCreator {
  associationId: string;
  trackingLinkId: string;
  creatorUserId: string;
  recipientAccountId: string;
  email: string;
  allocationId: string | null;
}

/**
 * An active Creator with a locked agreement, a recipient connected account,
 * and — when asked — a FUNDED §24.7 fixed allocation and a §14.3 bonus.
 */
async function seedCreator(
  campaignId: string,
  label: string,
  opts: {
    totalPercent?: number;
    fixed?: boolean;
    bonus?: { threshold: bigint; additionalPercent: number; maxCombinedPercent: number };
  } = {},
): Promise<SeededCreator> {
  const percent = opts.totalPercent ?? 20;
  const creator = await seedUser(h, 'affiliate', `earn-creator-${label}`);
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
      // The real recruitment path stores the §8 prospect id here; the account
      // identity lives on the signup profile's claimed_user_id.
      affiliateId: cp!.id,
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

  const recipientAccountId = `acct_r${label}${randomUUID().slice(0, 8)}`;
  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: recipientAccountId,
    mode: 'test',
    role: 'affiliate_recipient',
    ownerUserId: creator.id,
    state: 'complete',
    chargesEnabled: false,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  let allocationId: string | null = null;
  let proposalVersionId: string | null = null;
  if (opts.fixed) {
    const [version] = await h.db
      .insert(proposalVersions)
      .values({
        associationId,
        campaignId,
        versionNumber: 1,
        proposedBy: 'affiliate',
        bidTotalPercent: percent,
        fixedPaymentRequestCents: FIXED_AMOUNT,
        state: 'locked',
        affiliateDecision: 'proposed',
        affiliateDecidedAt: new Date(),
        founderDecision: 'accepted',
        founderDecidedAt: new Date(),
        lockedAt: new Date(),
      })
      .returning({ id: proposalVersions.id });
    proposalVersionId = version!.id;
  }

  const [agreement] = await h.db
    .insert(associationCompensationAgreements)
    .values({
      associationId,
      campaignId,
      source: opts.fixed ? 'proposal_version' : 'standard_terms',
      ...(proposalVersionId ? { proposalVersionId } : {}),
      basePercent: percent,
      bidIncreasePercent: 0,
      totalPercent: percent,
      ...(opts.fixed ? { fixedPaymentCents: FIXED_AMOUNT } : {}),
      affiliateAcceptedAt: new Date(),
      founderAcceptedAt: new Date(),
    })
    .returning({ id: associationCompensationAgreements.id });

  if (opts.fixed && proposalVersionId) {
    const [allocation] = await h.db
      .insert(creatorPaymentAllocations)
      .values({
        associationId,
        campaignId,
        proposalVersionId,
        agreementId: agreement!.id,
        status: 'funded',
        mode: 'test',
        amountCents: FIXED_AMOUNT,
        taxTreatment: 'No sales tax applies to the §24.7 funding charge.',
        fundedAt: new Date(),
      })
      .returning({ id: creatorPaymentAllocations.id });
    allocationId = allocation!.id;
    await h.db.insert(creatorPaymentFundingAttempts).values({
      allocationId: allocation!.id,
      campaignId,
      associationId,
      mode: 'test',
      checkoutSessionId: `cs_fund_${label}_${randomUUID().slice(0, 8)}`,
      paymentIntentId: `pi_fund_${label}_${randomUUID().slice(0, 8)}`,
      amountCents: FIXED_AMOUNT,
      status: 'succeeded',
      idempotencyKey: `creator-payment-funding:seed-${label}-${randomUUID().slice(0, 8)}`,
      confirmedAt: new Date(),
    });
  }

  if (opts.bonus) {
    await h.db.insert(creatorBonuses).values({
      associationId,
      campaignId,
      triggerUnit: 'attributed_subtotal_cents',
      threshold: opts.bonus.threshold,
      additionalPercent: opts.bonus.additionalPercent,
      maxCombinedPercent: opts.bonus.maxCombinedPercent,
      ...(proposalVersionId ? { proposalVersionId } : {}),
      offeredBy: 'founder:test',
    });
  }

  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      code: `earn-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });

  return {
    associationId,
    trackingLinkId: link!.id,
    creatorUserId: creator.id,
    recipientAccountId,
    email: creator.email,
    allocationId,
  };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `earn${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777740${String(n).padStart(2, '0')}`,
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

async function placePreorder(campaignId: string): Promise<string> {
  const res = await request(h.app).post(`/api/campaign/${campaignId}/preorder`).send(preorderBody());
  expect(res.status).toBe(201);
  return res.body.reservationId as string;
}

async function attributeTo(
  reservationId: string,
  creator: { associationId: string; trackingLinkId: string },
  status: 'verified' | 'provisional' = 'verified',
): Promise<void> {
  await h.db
    .update(reservations)
    .set({
      attributionSource: 'creator',
      attributionAssociationId: creator.associationId,
      attributionTrackingLinkId: creator.trackingLinkId,
      attributionStatus: status,
      attributionClickedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));
}

/** Back-dates close and runs the batch; a clean run lands closed_reconciling. */
async function closeCampaign(campaignId: string): Promise<void> {
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
  const summary = await runCloseBatch(
    { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT },
    { campaignId, actor: 'admin:test' },
  );
  expect(['complete']).toContain(summary.status);
}

async function reservationRow(id: string) {
  const [row] = await h.db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return row!;
}

async function campaignRow(id: string) {
  const [row] = await h.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row!;
}

async function earningsRow(associationId: string) {
  const [row] = await h.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, associationId))
    .limit(1);
  return row ?? null;
}

async function allocationRow(allocationId: string) {
  const [row] = await h.db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.id, allocationId))
    .limit(1);
  return row!;
}

const decide = (
  associationId: string,
  outcome: 'no_valid_post' | 'valid_post_later_incomplete' | 'complete_verified' | 'disqualified',
  note = 'verified in the earnings suite',
) =>
  recordCompletionDecision(deps(), {
    associationId,
    outcome,
    deliverablesNote: note,
    actor: 'admin:test',
  });

function emailsMatching(predicate: (text: string) => boolean): number {
  return h.sentEmails.messages.filter((m) => predicate(`${m.subject}\n${m.text}`)).length;
}

/** Drizzle wraps the driver error; the trigger's message lives on `cause`. */
async function expectDbRefusal(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
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

function eventBody(input: {
  id?: string;
  type: string;
  account?: string;
  object: Record<string, unknown>;
}): string {
  return JSON.stringify({
    id: input.id ?? `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'event',
    type: input.type,
    ...(input.account ? { account: input.account } : {}),
    created: Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
}

/* ── Drift — the 19a registers and kernels match @proovd/shared ─────────────── */

describe('drift — the 19a registers match the shared originals', () => {
  it('restates the §22.1 outcome table, the B.7 transitions, and the §22.2 constants', () => {
    expect(BACKEND_OUTCOMES.map((o) => ({ ...o }))).toEqual(SHARED_OUTCOMES.map((o) => ({ ...o })));
    expect({ ...BACKEND_TRANSITIONS }).toEqual({ ...SHARED_TRANSITIONS });
    expect(BACKEND_DAY).toBe(SHARED_DAY);
    expect(BACKEND_FUNDING_SOURCE).toBe(SHARED_FUNDING_SOURCE);
    expect(BACKEND_FACTS.map((f) => ({ ...f }))).toEqual(SHARED_FACTS.map((f) => ({ ...f })));
    expect([...BACKEND_BANNED]).toEqual([...SHARED_BANNED]);
  });

  it('restates the earned-percent and finalization kernels', () => {
    const bonus = {
      triggerUnit: 'attributed_subtotal_cents' as const,
      threshold: 1_000n,
      additionalPercent: 10,
      maxCombinedPercent: 45,
    };
    const input = { lockedTotalPercent: 20, bonus, bonusTriggered: true, ceilingPercent: 50 };
    expect(backendEarnedPercentFor(input)).toEqual(sharedEarnedPercentFor(input));

    const rows = [
      { reservationId: 'a', rewardSubtotalCents: 2_500n, provisionalCents: 750n, validlyAttributed: true },
      { reservationId: 'b', rewardSubtotalCents: 2_500n, provisionalCents: 750n, validlyAttributed: false },
    ];
    const args = { commission: 'genuine' as const, earnedPercent: 30, lockedTotalPercent: 20, ceilingPercent: 50, rows };
    expect(backendFinalizeRows(args)).toEqual(sharedFinalizeRows(args));
  });
});

/* ── §33.8.1 / §33.8.2 / §33.8.3 / §33.8.4 — the full Creator money flow ────── */

describe('§33.8.1–§33.8.4 — finalization, reconciliation, and the one Transfer', () => {
  let campaignId: string;
  let creator: SeededCreator;
  let r1 = '';
  let r2 = '';
  let organic = '';

  beforeAll(async () => {
    const c = await seedLiveCampaign('flow', { type: 'pre_launch' });
    campaignId = c.campaignId;
    creator = await seedCreator(campaignId, 'flow', {
      fixed: true,
      bonus: { threshold: 2_000n, additionalPercent: 10, maxCombinedPercent: 45 },
    });
    r1 = await placePreorder(campaignId);
    r2 = await placePreorder(campaignId);
    organic = await placePreorder(campaignId);
    await attributeTo(r1, creator, 'verified');
    // r2's attribution never verified — it earns nothing (§22.1 "validly
    // attributed") and its whole provisional amount returns (§24.4).
    await attributeTo(r2, creator, 'provisional');
  }, 120_000);

  it('refuses a completion decision while charges can still move (§22.1)', async () => {
    const early = await decide(creator.associationId, 'complete_verified');
    expect(early.status).toBe('not_closed');
  });

  it('captures with the 5% and the provisional percentage computed on the PRE-TAX subtotal (§33.8.1)', async () => {
    await closeCampaign(campaignId);
    const row = await reservationRow(r1);
    expect(row.status).toBe('captured');
    // Tax was charged (8% in this suite) and excluded from every percentage.
    expect(row.salesTaxCents).toBe(200n);
    expect(row.totalCapturedCents).toBe(2_700n);
    expect(row.proovdFeeCents).toBe(125n); // 5% × 2,500 — not 5% × 2,700
    // §24.4: the provisional maximum — locked 20% + conditional bonus 10%,
    // bounded by maxCombined 45 and the §6 ceiling — on the pre-tax subtotal.
    expect(row.affiliateProvisionalCents).toBe(750n); // 30% × 2,500
  });

  it('finalizes once: earned percentage on validly attributed pre-tax subtotal, every unearned cent resolved to the Founder (§33.8.2)', async () => {
    const decided = await decide(creator.associationId, 'complete_verified');
    expect(decided.status).toBe('recorded');
    expect(decided.status === 'recorded' && decided.fixedAction).toBe('eligible_full');

    const outcome = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(outcome.status).toBe('finalized');
    if (outcome.status !== 'finalized') return;
    const e = outcome.earnings;

    // Only r1 verified: valid subtotal 2,500; bonus threshold 2,000 met →
    // earned 30%. Commission is the locked 20% portion; bonus the remainder.
    expect(e.validSubtotalCents).toBe(2_500n);
    expect(e.earnedPercent).toBe(30);
    expect(e.earnedBonusPercent).toBe(10);
    expect(e.commissionCents).toBe(500n);
    expect(e.bonusCents).toBe(250n);
    expect(e.eligibleFixedCents).toBe(FIXED_AMOUNT);
    // §24.4's identity: provisional (750 + 750) = earned (750) + returned (750).
    expect(e.provisionalTotalCents).toBe(1_500n);
    expect(e.earnedTotalCents).toBe(750n);
    expect(e.unearnedReturnedCents).toBe(750n);

    // The reservation ledger, row by row.
    const row1 = await reservationRow(r1);
    expect(row1.affiliateEarnedCents).toBe(750n);
    expect(row1.affiliateUnearnedReturnedCents).toBe(0n);
    const row2 = await reservationRow(r2);
    expect(row2.affiliateEarnedCents).toBe(0n);
    expect(row2.affiliateUnearnedReturnedCents).toBe(750n);
    const rowOrganic = await reservationRow(organic);
    expect(rowOrganic.affiliateProvisionalCents).toBe(0n);
    expect(rowOrganic.affiliateEarnedCents).toBe(0n);

    // The campaign aggregates and the §26.6 comparison.
    const camp = await campaignRow(campaignId);
    expect(camp.affiliateProvisionalCents).toBe(1_500n);
    expect(camp.affiliateEarnedCents).toBe(750n);
    expect(camp.affiliateUnearnedReturnedCents).toBe(750n);
    // §24.4's identity, asserted on the ledger columns directly. The §26.6
    // money-control panel used to derive this line; that surface is gone, and
    // the aggregate it derived from is what the identity actually lives on.
    expect(camp.affiliateEarnedCents + camp.affiliateUnearnedReturnedCents).toBe(
      camp.affiliateProvisionalCents,
    );
    // Provisional resolved to the Creator and the Founder — never to Proovd:
    // the 5% is untouched by finalization (§24.4, §33.8.2).
    expect(camp.proovdFeeCents).toBe(125n * 3n);
  });

  it('reconciles exactly once — a second finalization changes nothing (§33.8.2)', async () => {
    const camp = await campaignRow(campaignId);
    const again = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(again.status).toBe('already_finalized');
    const after = await campaignRow(campaignId);
    expect(after.affiliateEarnedCents).toBe(camp.affiliateEarnedCents);
    expect(after.affiliateUnearnedReturnedCents).toBe(camp.affiliateUnearnedReturnedCents);
    const row1 = await reservationRow(r1);
    expect(row1.affiliateEarnedCents).toBe(750n);
  });

  it('gates the Transfer on Day 3 and on the §11 tax-accountability record', async () => {
    const approved = await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(approved.status).toBe('approved');

    // §22.1: on or after Day 3 — the anchor is campaign_close_at.
    const tooEarly = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: new Date(),
    });
    expect(tooEarly.status).toBe('before_day_3');

    // The done-when: the tax-accountability record gates EVERY Transfer. No
    // record exists yet for test mode, so Day 3 alone opens nothing.
    const blocked = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(blocked.status).toBe('tax_gate_blocked');
    expect(gateway.transfers).toHaveLength(0);

    await recordTaxAccountability(h.db, {
      payer: 'Proovd Inc.',
      filingResponsibility: 'Proovd files 1099-NEC for US Creators over threshold.',
      requiredForm: 'W-9 before any payment; 1099-NEC at year end.',
      requiredData: 'Legal name, address, TIN held by the provider.',
      thresholds: 'IRS 1099-NEC threshold in force for the tax year.',
      correctionsProcess: 'Corrected 1099 within 30 days of a verified error.',
      reconciliationResponsibility: 'Finance reconciles Transfers to filings quarterly.',
      approvedBy: 'admin:test-tax-approver',
      evidenceReference: 'https://intranet.proovd.co/tax/creator-payments',
      mode: 'test',
      actor: 'admin:test',
    });
  });

  it('records a synchronous Transfer failure and retries it idempotently under the SAME key (§33.8.4)', async () => {
    gateway.failNextTransfer('stripe unavailable');
    const failed = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(failed.status).toBe('transfer_failed');
    expect(gateway.transfers).toHaveLength(0);

    const [claimed] = await h.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, creator.associationId))
      .limit(1);
    expect(claimed?.status).toBe('failed');
    expect(claimed?.providerTransferId).toBeNull();
    // The earnings stay approved — a retry-job case is not a payout failure.
    expect((await earningsRow(creator.associationId))?.state).toBe('approved_for_transfer');

    // The sweep re-drives it under the same stable key (§32.3).
    const swept = await sweepTransferRetries(deps(), AFTER_DAY_3());
    expect(swept.created).toBe(1);
    const transfers = gateway.transfers.filter(
      (t) => t.idempotencyKey === earningsTransferKey(creator.associationId),
    );
    expect(transfers).toHaveLength(1);
  });

  it('creates ONE Transfer combining finalized commission, earned bonus, and eligible fixed amount (§33.8.3)', async () => {
    const [transfer] = await h.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, creator.associationId))
      .limit(1);
    expect(transfer?.status).toBe('created');
    expect(transfer?.commissionCents).toBe(500n);
    expect(transfer?.bonusCents).toBe(250n);
    expect(transfer?.fixedCents).toBe(FIXED_AMOUNT);
    expect(transfer?.totalCents).toBe(50_750n);
    expect(transfer?.destinationAccountId).toBe(creator.recipientAccountId);

    // One provider Transfer for the exact combined total.
    const sent = gateway.transfers.filter(
      (t) => t.idempotencyKey === earningsTransferKey(creator.associationId),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.amountCents).toBe(50_750n);

    // A second creation is the same Transfer, not a second (§33.8.3 "once").
    const again = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(again.status).toBe('already_created');
    expect(
      gateway.transfers.filter((t) => t.idempotencyKey === earningsTransferKey(creator.associationId)),
    ).toHaveLength(1);

    // The fixed allocation reached its terminal `paid` in the same act.
    expect((await allocationRow(creator.allocationId!)).status).toBe('paid');
    expect((await earningsRow(creator.associationId))?.state).toBe('transferred');

    // One failure notice, one created notice — however many retries ran.
    expect(emailsMatching((t) => t.includes('Transfer retry in progress'))).toBe(1);
    expect(emailsMatching((t) => t.includes('Transfer created'))).toBe(1);

    // A created Transfer row is immutable at the database level.
    await expectDbRefusal(
      h.db
        .update(affiliateTransfers)
        .set({ totalCents: 1n })
        .where(eq(affiliateTransfers.id, transfer!.id)),
      /immutable|created Transfer/i,
    );
  });

  it('renders the same finalized amounts on the Creator close view — one source, many renderers', async () => {
    const view = await readCreatorClose(h.db, { associationId: creator.associationId });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.view.earnings.state).toBe('transferred');
    expect(view.view.earnings.final?.commissionCents).toBe('500');
    expect(view.view.earnings.final?.bonusCents).toBe('250');
    expect(view.view.earnings.final?.eligibleFixedCents).toBe(FIXED_AMOUNT.toString());
    expect(view.view.earnings.final?.totalCents).toBe('50750');
    expect(view.view.earnings.statusBlock).toContain('507.50 recorded');
    expect(view.view.earnings.statusBlock).toContain('TRANSFERRED');
  });

  it('moves transferred earnings to paid_out on payout.paid, once (§22.1, Appendix B.7)', async () => {
    const payload = eventBody({
      type: 'payout.paid',
      account: creator.recipientAccountId,
      object: { id: 'po_earnflow1', object: 'payout', amount: 50_750, status: 'paid' },
    });
    await signedDelivery(payload).expect(200);
    expect((await earningsRow(creator.associationId))?.state).toBe('paid_out');
    // The same delivery again changes nothing and sends nothing new.
    await signedDelivery(payload).expect(200);
    const paidEmails = emailsMatching((t) => t.includes('Payout paid'));
    expect(paidEmails).toBe(1);
  });

  it('a later disqualification adjusts the earnings and records the contractual recovery (§22.1)', async () => {
    const decided = await decide(
      creator.associationId,
      'disqualified',
      'post-transfer review found self-dealing traffic',
    );
    expect(decided.status).toBe('recorded');
    expect((await earningsRow(creator.associationId))?.state).toBe('adjusted');
    const [recovery] = await h.db
      .select()
      .from(contractualRecoveryRecords)
      .where(eq(contractualRecoveryRecords.associationId, creator.associationId))
      .limit(1);
    expect(recovery?.amountCents).toBe(50_750n);

    // The earlier decision survives — append-only, latest wins (§25.6).
    const decisions = await h.db
      .select()
      .from(creatorCompletionDecisions)
      .where(eq(creatorCompletionDecisions.associationId, creator.associationId));
    expect(decisions).toHaveLength(2);
  });
});

/* ── §33.8.5 — no valid post: fixed returns, commission is zero ─────────────── */

describe('§33.8.5 / §33.8.8 — no valid post', () => {
  let campaignId: string;
  let creator: SeededCreator;

  beforeAll(async () => {
    const c = await seedLiveCampaign('novalid', { type: 'pre_launch' });
    campaignId = c.campaignId;
    creator = await seedCreator(campaignId, 'novalid', { fixed: true });
    const ra = await placePreorder(campaignId);
    const rb = await placePreorder(campaignId);
    await attributeTo(ra, creator, 'verified');
    await attributeTo(rb, creator, 'verified');
    await closeCampaign(campaignId);
  }, 120_000);

  it('returns 100% of the fixed allocation and finalizes zero commission (§33.8.5)', async () => {
    const decided = await decide(creator.associationId, 'no_valid_post');
    expect(decided.status).toBe('recorded');
    expect(decided.status === 'recorded' && decided.fixedAction).toBe('returned_full');

    // The funding charge refunded whole, to the Founder, at the provider.
    const allocation = await allocationRow(creator.allocationId!);
    expect(allocation.status).toBe('returned');
    expect(allocation.returnAmountCents).toBe(FIXED_AMOUNT);
    const refunds = gateway.refunds.filter((r) => r.amountCents === FIXED_AMOUNT);
    expect(refunds.length).toBeGreaterThanOrEqual(1);

    const outcome = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(outcome.status).toBe('finalized');
    if (outcome.status !== 'finalized') return;
    // Commission = zero. Every provisional cent returns to the Founder.
    expect(outcome.earnings.commissionCents).toBe(0n);
    expect(outcome.earnings.earnedTotalCents).toBe(0n);
    expect(outcome.earnings.eligibleFixedCents).toBe(0n);
    expect(outcome.earnings.provisionalTotalCents).toBe(1_000n); // 2 × 20% × 2,500
    expect(outcome.earnings.unearnedReturnedCents).toBe(1_000n);

    // US$0.00 finalized is complete — there is no Transfer to approve (§1.4).
    const approve = await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(approve.status).toBe('nothing_to_transfer');
  });

  it('a returned allocation cannot repeat (§33.8.8)', async () => {
    const refundsBefore = gateway.refunds.length;
    const again = await returnFixedAllocation(deps(), {
      allocationId: creator.allocationId!,
      reason: 'no_valid_post',
      actor: 'admin:test',
    });
    expect(again.status).toBe('already_returned');
    expect(gateway.refunds.length).toBe(refundsBefore);

    // The same decision again is refused — a double-submit, not a new fact.
    const duplicate = await decide(creator.associationId, 'no_valid_post');
    expect(duplicate.status).toBe('already_decided');

    // And the database itself refuses to move a returned allocation.
    await expectDbRefusal(
      h.db
        .update(creatorPaymentAllocations)
        .set({ status: 'funded' })
        .where(eq(creatorPaymentAllocations.id, creator.allocationId!)),
      /terminal|cannot repeat/i,
    );
  });
});

/* ── §33.8.6 — valid post + incomplete later work ───────────────────────────── */

describe('§33.8.6 — valid post with incomplete later deliverables', () => {
  let campaignId: string;
  let creator: SeededCreator;

  beforeAll(async () => {
    const c = await seedLiveCampaign('partial', { type: 'pre_launch' });
    campaignId = c.campaignId;
    creator = await seedCreator(campaignId, 'partial', { fixed: true });
    const ra = await placePreorder(campaignId);
    const rb = await placePreorder(campaignId);
    await attributeTo(ra, creator, 'verified');
    await attributeTo(rb, creator, 'verified');
    await closeCampaign(campaignId);
  }, 120_000);

  it('returns the fixed amount but PRESERVES genuine commission (§33.8.6)', async () => {
    const decided = await decide(creator.associationId, 'valid_post_later_incomplete');
    expect(decided.status).toBe('recorded');
    expect(decided.status === 'recorded' && decided.fixedAction).toBe('returned_full');
    expect((await allocationRow(creator.allocationId!)).status).toBe('returned');

    const outcome = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(outcome.status).toBe('finalized');
    if (outcome.status !== 'finalized') return;
    // The tempting simplification — cancel everything — is exactly wrong:
    // genuine commission from compliant captured attributed sales remains.
    expect(outcome.earnings.commissionCents).toBe(1_000n); // 20% × 5,000
    expect(outcome.earnings.earnedTotalCents).toBe(1_000n);
    expect(outcome.earnings.eligibleFixedCents).toBe(0n);
    expect(outcome.earnings.unearnedReturnedCents).toBe(0n);
  });
});

/* ── §33.8.7 — full completion despite weak sales ───────────────────────────── */

describe('§33.8.7 / §33.8.8 — full completion earns the fixed amount despite weak sales', () => {
  let campaignId: string;
  let creator: SeededCreator;

  beforeAll(async () => {
    const c = await seedLiveCampaign('weak', { type: 'pre_launch' });
    campaignId = c.campaignId;
    creator = await seedCreator(campaignId, 'weak', { fixed: true });
    // Weak sales in the strongest form: not one attributed pre-order.
    const r = await placePreorder(campaignId);
    void r; // organic only
    await closeCampaign(campaignId);
  }, 120_000);

  it('the full fixed amount is eligible and transfers even with zero attributed sales (§33.8.7)', async () => {
    const decided = await decide(creator.associationId, 'complete_verified');
    expect(decided.status).toBe('recorded');
    expect(decided.status === 'recorded' && decided.fixedAction).toBe('eligible_full');

    const outcome = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(outcome.status).toBe('finalized');
    if (outcome.status !== 'finalized') return;
    expect(outcome.earnings.commissionCents).toBe(0n);
    expect(outcome.earnings.eligibleFixedCents).toBe(FIXED_AMOUNT);

    const approved = await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(approved.status).toBe('approved');

    const created = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    expect(created.transfer.totalCents).toBe(FIXED_AMOUNT);
    expect(created.transfer.commissionCents).toBe(0n);
    expect((await allocationRow(creator.allocationId!)).status).toBe('paid');
  });

  it('a paid allocation cannot repeat (§33.8.8)', async () => {
    const again = await returnFixedAllocation(deps(), {
      allocationId: creator.allocationId!,
      reason: 'no_valid_post',
      actor: 'admin:test',
    });
    expect(again.status).toBe('not_returnable');

    await expectDbRefusal(
      h.db
        .update(creatorPaymentAllocations)
        .set({ status: 'funded' })
        .where(eq(creatorPaymentAllocations.id, creator.allocationId!)),
      /terminal|cannot repeat/i,
    );
  });
});

/* ── §33.8.14 — the discretionary thank-you ─────────────────────────────────── */

describe('§33.8.14 — the §22.2 thank-you', () => {
  let campaignId: string;
  let creator: SeededCreator;

  beforeAll(async () => {
    const c = await seedLiveCampaign('thanks', { type: 'pre_launch' });
    campaignId = c.campaignId;
    creator = await seedCreator(campaignId, 'thanks', {});
    const r = await placePreorder(campaignId);
    await attributeTo(r, creator, 'verified');
    await closeCampaign(campaignId);
  }, 120_000);

  it('records recognition without money, and refuses a payment without the recorded approval', async () => {
    const recognition = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'recognition',
      reason: 'Consistent, compliant posting through the whole campaign.',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      actor: 'admin:test',
    });
    expect(recognition.status).toBe('recorded');
    if (recognition.status === 'recorded') {
      expect(recognition.record.amountCents).toBeNull();
      expect(recognition.record.providerTransferId).toBeNull();
    }

    // §22.2: without the approval/path, Admin may record recognition but
    // cannot promise or send money.
    const noApproval = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 5_000n,
      reason: 'good effort',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      actor: 'admin:test',
    });
    expect(noApproval.status).toBe('approval_missing');

    const factsUnconfirmed = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 5_000n,
      reason: 'good effort',
      minimumWorkCompleted: true,
      clickThresholdMet: false,
      brandAupCompliant: true,
      approvalReference: 'FIN-2026-081',
      approvedBy: 'finance:approver',
      taxTreatment: '1099-NEC reportable expense.',
      actor: 'admin:test',
    });
    expect(factsUnconfirmed.status).toBe('eligibility_not_confirmed');
  });

  it('funds only from resolved retained listing-fee revenue — never a campaign balance', async () => {
    // No listing payment exists yet → there is no retained revenue to spend.
    const noRevenue = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 5_000n,
      reason: 'good effort',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      approvalReference: 'FIN-2026-081',
      approvedBy: 'finance:approver',
      taxTreatment: '1099-NEC reportable expense.',
      actor: 'admin:test',
    });
    expect(noRevenue.status).toBe('listing_revenue_unresolved');

    const now = new Date();
    const [calc] = await h.db
      .insert(listingFeeCalculations)
      .values({
        campaignId,
        baseCents: 50_000n,
        itemDiscountCents: 2_000n,
        maxDiscountCents: 10_000n,
        minSubtotalCents: 20_000n,
        completedItems: 0,
        discountCents: 0n,
        subtotalCents: 50_000n,
        discountLines: [],
        itemsSnapshot: {},
        actor: 'admin:test',
        trigger: 'seed',
        lockedAt: now,
      })
      .returning({ id: listingFeeCalculations.id });
    await h.db.insert(listingFeePayments).values({
      campaignId,
      calculationId: calc!.id,
      mode: 'test',
      checkoutSessionId: `cs_listing_${randomUUID().slice(0, 10)}`,
      baseCents: 50_000n,
      discountCents: 0n,
      promotionCents: 0n,
      subtotalCents: 50_000n,
      taxCents: 0n,
      totalCents: 50_000n,
      paidAt: now,
      responseWindowHours: 72,
      responseDeadlineAt: new Date(now.getTime() + 72 * 3_600_000),
      freeCancellationWindowHours: 48,
      freeCancellationDeadlineAt: new Date(now.getTime() + 48 * 3_600_000),
    });

    // The named funding source is finite (§22.2 "funded only from").
    const tooLarge = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 60_000n,
      reason: 'good effort',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      approvalReference: 'FIN-2026-081',
      approvedBy: 'finance:approver',
      taxTreatment: '1099-NEC reportable expense.',
      actor: 'admin:test',
    });
    expect(tooLarge.status).toBe('amount_exceeds_funding_source');
  });

  it('sends the approved payment once and refuses a duplicate (§33.8.14)', async () => {
    const paid = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 5_000n,
      reason: 'good effort with little commission',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      approvalReference: 'FIN-2026-081',
      approvedBy: 'finance:approver',
      taxTreatment: '1099-NEC reportable expense.',
      actor: 'admin:test',
    });
    expect(paid.status).toBe('recorded');
    if (paid.status === 'recorded') {
      expect(paid.record.fundingSource).toBe(BACKEND_FUNDING_SOURCE);
      expect(paid.record.providerTransferId).toBeTruthy();
    }
    const sent = gateway.transfers.filter(
      (t) => t.idempotencyKey === thankYouPaymentKey(creator.associationId),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.amountCents).toBe(5_000n);
    // No campaign reference travels with the money — it cannot draw on a
    // campaign balance.
    expect(sent[0]!.metadata['campaignId']).toBeUndefined();

    const duplicate = await recordThankYou(deps(), {
      associationId: creator.associationId,
      kind: 'payment',
      amountCents: 5_000n,
      reason: 'good effort again',
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      approvalReference: 'FIN-2026-082',
      approvedBy: 'finance:approver',
      taxTreatment: '1099-NEC reportable expense.',
      actor: 'admin:test',
    });
    expect(duplicate.status).toBe('duplicate_payment');
    expect(
      gateway.transfers.filter((t) => t.idempotencyKey === thankYouPaymentKey(creator.associationId)),
    ).toHaveLength(1);

    // The §26.6 money-control line that rendered this expense went with the
    // Admin money panel; the record it read is what actually holds the amount,
    // and it is separate from every campaign money column (asserted below).
    // Named by KIND, not by `limit(1)`. An earlier test in this describe
    // records a RECOGNITION for the same association — which carries no amount
    // by CHECK — so an unordered single-row read returns whichever row Postgres
    // feels like, and the assertion is about the payment.
    const [thankYou] = await h.db
      .select()
      .from(thankYouRecords)
      .where(
        and(
          eq(thankYouRecords.associationId, creator.associationId),
          eq(thankYouRecords.kind, 'payment'),
        ),
      );
    expect(thankYou!.amountCents).toBe(5_000n);
  });

  it('is never estimated: no store, no route, and no message promises one', async () => {
    // Structurally: the record's table has no path to campaign money — no
    // reservation column, no charge column, no source-transaction column.
    const columns = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'thank_you_records'
    `);
    const names = columns.rows.map((r) => String(r['column_name']));
    expect(names).not.toContain('reservation_id');
    expect(names).not.toContain('charge_id');
    expect(names).not.toContain('source_transaction');
    // And no §27 message exists to promise it with (§1.4, §22.2).
    expect(BACKEND_NOTIFICATION_EVENTS.some((k) => k.includes('thank'))).toBe(false);
  });
});

/* ── Vocabulary and surface consistency ─────────────────────────────────────── */

describe('the §22.3 vocabulary and the Admin queue', () => {
  it('no Phase 19 source file uses a banned money-status word', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      '../close/earnings.ts',
      '../close/earnings-logic.ts',
      '../close/earnings-notifications.ts',
      '../notifications/templates/earnings.tsx',
      '../db/schema/earnings.ts',
    ];
    for (const file of files) {
      const text = (await readFile(path.join(here, file), 'utf8'))
        // The register that names the banned words is allowed to name them.
        .replace(/BANNED_MONEY_STATUS_WORDS = \[[^\]]+\]/, '');
      for (const word of BACKEND_BANNED) {
        expect(text.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it('the Admin earnings queue reads the same stored amounts every other surface renders (§33.8.13)', async () => {
    const rows = await readCampaignEarnings(
      h.db,
      (await h.db
        .select({ campaignId: creatorEarnings.campaignId })
        .from(creatorEarnings)
        .limit(1))[0]!.campaignId,
    );
    expect(rows).not.toBeNull();
    const withEarnings = rows!.find((r) => r.earnings !== null);
    expect(withEarnings).toBeTruthy();
    // The queue exposes the stored record, not a recomputation: the identity
    // holds on what it serves.
    const e = withEarnings!.earnings!;
    expect(e.earnedTotalCents + e.unearnedReturnedCents).toBe(e.provisionalTotalCents);
  });

  it('every earnings state transition is history, insert-only', async () => {
    const [anyEarnings] = await h.db.select().from(creatorEarnings).limit(1);
    const history = await h.db
      .select()
      .from(creatorEarningsStateHistory)
      .where(eq(creatorEarningsStateHistory.earningsId, anyEarnings!.id));
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]!.toState).toBe('finalized');
    await expectDbRefusal(
      h.db
        .update(creatorEarningsStateHistory)
        .set({ toState: 'paid_out' })
        .where(eq(creatorEarningsStateHistory.id, history[0]!.id)),
      /append-only/i,
    );
  });

  it('the finalized amounts are immutable at the database level (§22.1)', async () => {
    const [anyEarnings] = await h.db.select().from(creatorEarnings).limit(1);
    await expectDbRefusal(
      h.db
        .update(creatorEarnings)
        .set({ earnedTotalCents: 1n, unearnedReturnedCents: anyEarnings!.provisionalTotalCents - 1n })
        .where(eq(creatorEarnings.id, anyEarnings!.id)),
      /immutable/i,
    );
  });
});
