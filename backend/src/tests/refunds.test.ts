/**
 * Phase 20a — refunds of campaign charges, §24.8 cause-based allocation, the
 * §24.9 Idea exceptions, §24.10 policy preservation, and Appendix B.6.
 *
 * Acceptance: §33.9.1 (Product consent preserves the immutable Founder policy
 * version), §33.9.2 (every refund has the requested/submitted/succeeded/failed
 * lifecycle and a cause classification), §33.9.3 (a Founder-caused refund does
 * not claw back finalized valid Affiliate earnings), §33.9.4 (an
 * Affiliate-caused refund cancels or recovers ONLY invalid earnings), §33.9.5
 * (a Proovd error does not debit an unrelated Affiliate and returns the fee
 * where appropriate), and the allocation half of §33.9.6 (an unrelated dispute
 * cannot record an automatic clawback — the dispute-ingestion half is 20b's).
 * Plus: the §24.9 no-voluntary-refund door, idempotency under retry and
 * duplicate webhook delivery, B.6 exactness with no raw provider code, the
 * §22.3 adjustments term, and the drift tests pinning the 20a registers
 * against @proovd/shared.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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
import { founderOperationalShares } from '../db/schema/reservations.js';
import {
  refundCauseAllocations,
  reservationRefunds,
  reservationRefundEvents,
} from '../db/schema/refunds.js';
import {
  creatorEarnings,
  affiliateTransfers,
  contractualRecoveryRecords,
} from '../db/schema/earnings.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  associationCompensationAgreements,
  proposalVersions,
  trackingLinks,
} from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import {
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveEarningsForTransfer,
  createAffiliateTransfer,
} from '../close/earnings.js';
import { readFounderPaymentStatus } from '../close/founder-payments.js';
import { recordTaxAccountability } from '../payments/tax-accountability.js';
import {
  recordRefundCase,
  previewRefundExecution,
  executeRefund,
  applyRefundSuccess,
  readRefundQueue,
  refundProviderKey,
  deriveEarningsPhase,
} from '../refunds/service.js';
import { readBackerPage } from '../reservations/magic-link-read.js';
import { readTimeline } from '../support/timeline.js';
import {
  REFUND_CAUSES as BACKEND_CAUSES,
  IDEA_REFUND_EXCEPTIONS as BACKEND_EXCEPTIONS,
  RESERVATION_REFUND_TRANSITIONS as BACKEND_TRANSITIONS,
  REFUND_NOTICE_TEMPLATE as BACKEND_TEMPLATE,
  REFUND_STATUS_LABELS as BACKEND_LABELS,
  TYPICAL_BANK_TIMING as BACKEND_TIMING,
  BEST_EFFORT_RECOVERY_SENTENCE as BACKEND_BEST_EFFORT,
  REFUND_DESTINATION_FALLBACK as BACKEND_FALLBACK,
  resolveRefundNotice as backendResolve,
  allocationInconsistency as backendInconsistency,
  treatmentsForEarningsPhase as backendTreatments,
} from '../refunds/logic.js';
import {
  REFUND_CAUSES as SHARED_CAUSES,
  IDEA_REFUND_EXCEPTIONS as SHARED_EXCEPTIONS,
  RESERVATION_REFUND_TRANSITIONS as SHARED_TRANSITIONS,
  REFUND_NOTICE_TEMPLATE as SHARED_TEMPLATE,
  REFUND_STATUS_LABELS as SHARED_LABELS,
  TYPICAL_BANK_TIMING as SHARED_TIMING,
  BEST_EFFORT_RECOVERY_SENTENCE as SHARED_BEST_EFFORT,
  REFUND_DESTINATION_FALLBACK as SHARED_FALLBACK,
  resolveRefundNotice as sharedResolve,
  allocationInconsistency as sharedInconsistency,
  treatmentsForEarningsPhase as sharedTreatments,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_refunds_suite';
const CONNECT_SECRET = 'whsec_connect_for_refunds_suite';

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
const AFTER_DAY_3 = () => new Date(Date.now() + (3 * 24 + 2) * 3_600_000);

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'refunds',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'refunds-admin');
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

/* ── Seeding (the earnings suite's shape) ───────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `rf-founder-${label}`);
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
          refundPolicyTitle: `${label} Refund Policy`,
          refundPolicyVersion: 'v1',
          refundPolicySourceUrl: 'https://example.com/refunds',
          refundPolicyEffectiveDate: '2026-01-01',
          refundPolicyText: `Version one: returns accepted within 30 days for ${label}.`,
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

interface SeededCreator {
  associationId: string;
  trackingLinkId: string;
  creatorUserId: string;
  recipientAccountId: string;
}

async function seedCreator(
  campaignId: string,
  label: string,
  opts: { totalPercent?: number } = {},
): Promise<SeededCreator> {
  const percent = opts.totalPercent ?? 20;
  const creator = await seedUser(h, 'affiliate', `rf-creator-${label}`);
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

  await h.db.insert(associationCompensationAgreements).values({
    associationId,
    campaignId,
    source: 'standard_terms',
    basePercent: percent,
    bidIncreasePercent: 0,
    totalPercent: percent,
    affiliateAcceptedAt: new Date(),
    founderAcceptedAt: new Date(),
  });

  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      code: `rf-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });

  return {
    associationId,
    trackingLinkId: link!.id,
    creatorUserId: creator.id,
    recipientAccountId,
  };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `rf${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777750${String(n).padStart(2, '0')}`,
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

async function refundRow(id: string) {
  const [row] = await h.db
    .select()
    .from(reservationRefunds)
    .where(eq(reservationRefunds.id, id))
    .limit(1);
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
  let cursor: unknown = caught;
  while (cursor instanceof Error) {
    messages.push(cursor.message);
    cursor = cursor.cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
}

/** A recordable §24.8 case body with sane defaults. */
function caseInput(reservationId: string, over: Record<string, unknown> = {}) {
  return {
    reservationId,
    cause: 'proovd_or_system_error' as const,
    affiliateTreatment: 'not_attributed' as const,
    proovdFeeTreatment: 'returned_elective' as const,
    founderLiabilityCents: 0n,
    evidence: 'duplicate ledger row confirmed against the provider dashboard',
    amountCents: 1_000n,
    ideaExceptionReason: 'duplicate_charge' as const,
    actor: 'admin:test',
    ...over,
  };
}

/* ── Drift: the backend restatement is the shared register ─────────────────── */

describe('register drift (backend restates shared)', () => {
  it('pins the §24.8 causes, §24.9 exceptions, lifecycle, and B.6 against @proovd/shared', () => {
    expect(BACKEND_CAUSES).toEqual(SHARED_CAUSES);
    expect(BACKEND_EXCEPTIONS).toEqual(SHARED_EXCEPTIONS);
    expect(BACKEND_TRANSITIONS).toEqual(SHARED_TRANSITIONS);
    expect(BACKEND_TEMPLATE).toBe(SHARED_TEMPLATE);
    expect(BACKEND_LABELS).toEqual(SHARED_LABELS);
    expect(BACKEND_TIMING).toBe(SHARED_TIMING);
    expect(BACKEND_BEST_EFFORT).toBe(SHARED_BEST_EFFORT);
    expect(BACKEND_FALLBACK).toBe(SHARED_FALLBACK);

    const vars = {
      amount: '1,234.00',
      destination: 'Visa ending 4242',
      startedDate: 'August 4, 2026 (UTC)',
      bankTiming: BACKEND_TIMING,
      status: 'succeeded' as const,
      reference: 'RF-TEST1-TEST2',
    };
    expect(backendResolve(vars)).toEqual(sharedResolve(vars));

    const facts = {
      cause: 'founder_or_product' as const,
      affiliateTreatment: 'contractual_recovery' as const,
      proovdFeeTreatment: 'retained' as const,
      affiliateInvalidCents: 100n,
      founderLiabilityCents: 0n,
      mandate: null,
    };
    for (const phase of [
      'not_attributed',
      'unfinalized',
      'finalized_untransferred',
      'transferred_or_later',
    ] as const) {
      expect(backendInconsistency(facts, phase)).toBe(sharedInconsistency(facts, phase));
      expect(backendTreatments(phase)).toEqual(sharedTreatments(phase));
    }
  });

  it('never uses §3.2 banned money vocabulary in the Phase 20a modules', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      path.join(here, '..', 'refunds', 'logic.ts'),
      path.join(here, '..', 'refunds', 'service.ts'),
      path.join(here, '..', 'refunds', 'notifications.ts'),
      path.join(here, '..', 'db', 'schema', 'refunds.ts'),
      path.join(here, '..', 'db', 'migrations', '0032_reservation_refunds.sql'),
      path.join(here, '..', '..', '..', 'shared', 'src', 'refunds', 'index.ts'),
    ];
    const banned = [/escrow/i, /custod/i, /held in a proovd account/i, /\bpledge\b/i, /tranche/i];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const pattern of banned) {
        expect(text).not.toMatch(pattern);
      }
    }
  });
});

/* ── §33.9.1 — Product consent preserves the immutable policy version ───────── */

describe('§33.9.1 — the Product consent preserves the immutable Founder policy version', () => {
  it('a later website edit cannot alter an existing transaction', async () => {
    const world = await seedLiveCampaign('policy', { type: 'pre_launch' });
    const reservationId = await placePreorder(world.campaignId);

    const before = await reservationRow(reservationId);
    const snapshot = (before.policyVersions as Record<string, unknown>)[
      'founderRefundPolicy'
    ] as Record<string, unknown>;
    expect(snapshot['title']).toBe('policy Refund Policy');
    expect(snapshot['version']).toBe('v1');
    expect(snapshot['text']).toContain('Version one');
    expect(typeof snapshot['textHash']).toBe('string');
    // The consent text names the version the Backer actually agreed to.
    expect(before.consentText).toContain('policy Refund Policy v1');

    // The "later website edit": an Admin-applied change request rewrites the
    // build row. The transaction's own record is what §24.10 protects.
    await h.db
      .update(campaignBuild)
      .set({
        refundPolicyVersion: 'v2',
        refundPolicyText: 'Version two: all sales final.',
        updatedBy: 'admin:test',
      })
      .where(eq(campaignBuild.campaignId, world.campaignId));

    const after = await reservationRow(reservationId);
    expect(after.policyVersions).toEqual(before.policyVersions);
    expect(after.consentText).toBe(before.consentText);
    expect(after.consentHash).toBe(before.consentHash);

    // A NEW transaction cites the new version — versions move forward only.
    const secondId = await placePreorder(world.campaignId);
    const second = await reservationRow(secondId);
    const secondSnapshot = (second.policyVersions as Record<string, unknown>)[
      'founderRefundPolicy'
    ] as Record<string, unknown>;
    expect(secondSnapshot['version']).toBe('v2');
    expect(secondSnapshot['text']).toContain('Version two');
    expect(secondSnapshot['textHash']).not.toBe(snapshot['textHash']);
  });
});

/* ── §33.9.2 — the lifecycle and the cause classification ───────────────────── */

describe('§33.9.2 — every refund has the full lifecycle and a cause classification', () => {
  let campaignId: string;
  let founderAccount: string;
  let reservationId: string;
  let refundId: string;

  beforeAll(async () => {
    const world = await seedLiveCampaign('life', { type: 'pre_build', orderThreshold: 1 });
    campaignId = world.campaignId;
    founderAccount = world.connectedAccountId;
    reservationId = await placePreorder(campaignId);
    await closeCampaign(campaignId);
    expect((await reservationRow(reservationId)).status).toBe('captured');
  });

  it('refuses a refund of a reservation nothing was captured on (§24.8 before-charge)', async () => {
    const openWorld = await seedLiveCampaign('open', { type: 'pre_build', orderThreshold: 5 });
    const openReservation = await placePreorder(openWorld.campaignId);
    const outcome = await recordRefundCase(deps(), caseInput(openReservation));
    expect(outcome).toEqual({ status: 'refused', reason: 'nothing_captured' });
  });

  it('refuses an Idea refund without a §24.9 exception, and there is no voluntary member', async () => {
    const missing = await recordRefundCase(
      deps(),
      caseInput(reservationId, { ideaExceptionReason: null }),
    );
    expect(missing).toEqual({ status: 'refused', reason: 'idea_exception_required' });

    // The database's own door: no enum member exists for a change of mind.
    const [allocation] = await h.db
      .insert(refundCauseAllocations)
      .values({
        campaignId,
        reservationId,
        caseKind: 'refund',
        cause: 'proovd_or_system_error',
        proovdFeeTreatment: 'retained',
        affiliateTreatment: 'not_attributed',
        founderLiabilityCents: 0n,
        evidence: 'x',
        decidedBy: 'admin:test',
      })
      .returning({ id: refundCauseAllocations.id });
    const reservation = await reservationRow(reservationId);
    await expectDbRefusal(
      h.db.insert(reservationRefunds).values({
        reference: `RF-${randomUUID().slice(0, 5)}-A`,
        reservationId,
        campaignId,
        allocationId: allocation!.id,
        amountCents: 100n,
        ideaExceptionReason: 'change_of_mind',
        paymentIntentId: reservation.paymentIntentId!,
        idempotencyKey: `reservation-refund:test-${randomUUID().slice(0, 8)}`,
        requestedBy: 'admin:test',
      }),
      /reservation_refunds_exception|check constraint/i,
    );
  });

  it('records the case, walks requested → submitted → succeeded, and stores the §32.4 object', async () => {
    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservationId, { amountCents: 500n }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    refundId = recorded.refund.id;
    expect(recorded.refund.status).toBe('requested');
    expect(recorded.refund.idempotencyKey).toBe(refundProviderKey(recorded.allocation.id));
    // §33.9.2's second half: the classification exists, NOT NULL, with §24.8's facts.
    expect(recorded.allocation.cause).toBe('proovd_or_system_error');
    expect(recorded.allocation.evidence).not.toBe('');
    expect(recorded.allocation.decidedBy).toBe('admin:test');

    // §26.6: no execution without the read-and-consumed preview.
    const noPreview = await executeRefund(deps(), {
      refundId,
      previewId: null,
      actor: 'admin:test',
    });
    expect(noPreview).toEqual({ status: 'refused', reason: 'preview_required' });

    const preview = await previewRefundExecution(h.db, { refundId, issuedBy: 'admin:test' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const executed = await executeRefund(deps(), {
      refundId,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');

    const events = await h.db
      .select()
      .from(reservationRefundEvents)
      .where(eq(reservationRefundEvents.refundId, refundId))
      .orderBy(reservationRefundEvents.occurredAt);
    expect(events.map((e) => e.toStatus)).toEqual(['requested', 'submitted', 'succeeded']);

    // §24.1: the refund was created on the Founder's connected account.
    const providerRefund = gateway.refunds[gateway.refunds.length - 1]!;
    expect(providerRefund.connectedAccountId).toBe(founderAccount);
    expect(providerRefund.amountCents).toBe(500n);

    // A partial refund does not rewrite the reservation's state.
    expect((await reservationRow(reservationId)).status).toBe('captured');
  });

  it('replays idempotently: a second execute changes nothing and a consumed preview cannot be reused', async () => {
    const preview = await previewRefundExecution(h.db, { refundId, issuedBy: 'admin:test' });
    // Already succeeded: the preview itself refuses to be issued.
    expect(preview).toEqual({ ok: false, reason: 'already_succeeded' });

    const refundsBefore = gateway.refunds.length;
    const again = await executeRefund(deps(), {
      refundId,
      previewId: null,
      actor: 'admin:test',
    });
    expect(again).toEqual({ status: 'already_succeeded' });
    expect(gateway.refunds.length).toBe(refundsBefore);
  });

  it('a synchronous provider failure records `failed` and the retry is the SAME refund at Stripe', async () => {
    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservationId, { amountCents: 300n }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;

    gateway.failNextRefund('stripe unavailable');
    const preview1 = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    expect(preview1.ok).toBe(true);
    if (!preview1.ok) return;
    const failed = await executeRefund(deps(), {
      refundId: recorded.refund.id,
      previewId: preview1.previewId,
      actor: 'admin:test',
    });
    expect(failed.status).toBe('failed');
    const failedRow = await refundRow(recorded.refund.id);
    expect(failedRow.status).toBe('failed');
    expect(failedRow.failureMessage).toContain('stripe unavailable');
    // A never-announced refund announces no failure (§27.2).
    expect(
      h.sentEmails.messages.filter((m) => m.subject.includes('Refund failed')).length,
    ).toBe(0);

    const emailsBefore = h.sentEmails.messages.length;
    const preview2 = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    expect(preview2.ok).toBe(true);
    if (!preview2.ok) return;
    const retried = await executeRefund(deps(), {
      refundId: recorded.refund.id,
      previewId: preview2.previewId,
      actor: 'admin:test',
    });
    expect(retried.status).toBe('succeeded');
    const events = await h.db
      .select()
      .from(reservationRefundEvents)
      .where(eq(reservationRefundEvents.refundId, recorded.refund.id))
      .orderBy(reservationRefundEvents.occurredAt);
    expect(events.map((e) => e.toStatus)).toEqual([
      'requested',
      'failed',
      'submitted',
      'succeeded',
    ]);
    // The retry reused the stable key — one refund at Stripe for this case.
    expect(
      gateway.refunds.filter((r) => r.amountCents === 300n && r.paymentIntentId === failedRow.paymentIntentId),
    ).toHaveLength(1);
    expect(h.sentEmails.messages.length).toBeGreaterThan(emailsBefore);
  });

  it('the database refuses an illegal transition and an edited allocation', async () => {
    await expectDbRefusal(
      h.db
        .update(reservationRefunds)
        .set({ status: 'submitted' })
        .where(eq(reservationRefunds.id, refundId)),
      /illegal refund transition/i,
    );
    const [allocation] = await h.db
      .select()
      .from(refundCauseAllocations)
      .where(eq(refundCauseAllocations.reservationId, reservationId))
      .limit(1);
    await expectDbRefusal(
      h.db
        .update(refundCauseAllocations)
        .set({ evidence: 'rewritten' })
        .where(eq(refundCauseAllocations.id, allocation!.id)),
      /insert-only/i,
    );
  });

  it('refunds can never exceed the captured total, cumulatively', async () => {
    const reservation = await reservationRow(reservationId);
    const captured = reservation.totalCapturedCents ?? 0n;
    const over = await recordRefundCase(
      deps(),
      caseInput(reservationId, { amountCents: captured }),
    );
    // 800 already refunded across the two cases above; the whole total no longer fits.
    expect(over).toEqual({ status: 'refused', reason: 'amount_exceeds_captured' });
  });

  it('a full refund moves the reservation to `refunded` and flips do-not-fulfill', async () => {
    const reservation = await reservationRow(reservationId);
    const remaining = (reservation.totalCapturedCents ?? 0n) - 800n;
    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservationId, { amountCents: remaining }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    const executed = await executeRefund(deps(), {
      refundId: recorded.refund.id,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');

    const after = await reservationRow(reservationId);
    expect(after.status).toBe('refunded');
    const [share] = await h.db
      .select()
      .from(founderOperationalShares)
      .where(eq(founderOperationalShares.reservationId, reservationId))
      .limit(1);
    expect(share?.fulfillmentState).toBe('do_not_fulfill');
  });

  it('a duplicate charge.refunded delivery confirms nothing twice and sends nothing (§27.2)', async () => {
    const row = await refundRow(refundId);
    const stripe = new Stripe('sk_test_ignored', { apiVersion: '2025-02-24.acacia' as never });
    const payload = JSON.stringify({
      id: `evt_${randomUUID().slice(0, 12)}`,
      type: 'charge.refunded',
      account: founderAccount,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `ch_${randomUUID().slice(0, 10)}`,
          object: 'charge',
          payment_intent: row.paymentIntentId,
          refunds: {
            data: [{ id: row.providerRefundId, object: 'refund', status: 'succeeded', amount: Number(row.amountCents) }],
          },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: CONNECT_SECRET,
    });

    const emailsBefore = h.sentEmails.messages.length;
    const eventsBefore = (
      await h.db
        .select()
        .from(reservationRefundEvents)
        .where(eq(reservationRefundEvents.refundId, refundId))
    ).length;

    const first = await request(h.app)
      .post(STRIPE_CONNECT_WEBHOOK_PATH)
      .set(STRIPE_SIGNATURE_HEADER, signature)
      .set('content-type', 'application/json')
      .send(payload);
    expect(first.status).toBe(200);

    const second = await request(h.app)
      .post(STRIPE_CONNECT_WEBHOOK_PATH)
      .set(STRIPE_SIGNATURE_HEADER, signature)
      .set('content-type', 'application/json')
      .send(payload);
    expect(second.status).toBe(200);

    const eventsAfter = (
      await h.db
        .select()
        .from(reservationRefundEvents)
        .where(eq(reservationRefundEvents.refundId, refundId))
    ).length;
    expect(eventsAfter).toBe(eventsBefore);
    expect(h.sentEmails.messages.length).toBe(emailsBefore);
  });

  it('renders Appendix B.6 exactly — email, magic-link page, and no raw provider code', async () => {
    const row = await refundRow(refundId);
    const completed = h.sentEmails.messages.filter((m) =>
      m.text.includes(`Reference: ${row.reference}`),
    );
    expect(completed.length).toBeGreaterThan(0);
    const body = completed[completed.length - 1]!.text;
    expect(body).toContain('Refund started — US$5.00');
    expect(body).toContain('Typical bank timing: 5–10 business days, typically');
    expect(body).toContain('Status: SUCCEEDED');
    expect(body).toContain(BACKEND_FALLBACK);
    // §33.9.11's rule, applied here: no provider object prefix and no decline
    // vocabulary in the customer copy.
    expect(body).not.toMatch(/\bre_[A-Za-z0-9]+/);
    expect(body).not.toMatch(/generic_decline|insufficient_funds/);
    // Never an exact settlement date: the timing is the pinned typical range.
    expect(body).not.toMatch(/will (arrive|settle) on/i);

    const reservation = await reservationRow(reservationId);
    const page = await readBackerPage(h.db, {
      campaignId,
      backerIdentityId: reservation.backerIdentityId!,
    });
    const tx = page.transactions.find((t) => t.reservationId === reservationId)!;
    expect(tx.refunds.length).toBeGreaterThan(0);
    expect(tx.refunds[0]!.body).toContain('Refund started — US$');
    expect(tx.refunds[0]!.action).toBe('View pre-order or get help');
    expect(tx.statusLabel).toBe('Refunded');
  });

  it('appears on the §26.8 timeline composed from the refund tables, and in the Admin queue', async () => {
    const timeline = await readTimeline(h.db, 'reservation', reservationId);
    expect(timeline.sourcesRead).toContain('reservation_refunds');
    expect(timeline.sourcesRead).toContain('refund_cause_allocations');
    const refundEntries = timeline.entries.filter((e) => e.kind === 'refund');
    expect(refundEntries.length).toBeGreaterThan(0);

    const queue = await readRefundQueue(h.db, { campaignId });
    expect(queue.cases.length).toBeGreaterThanOrEqual(3);
    expect(queue.bestEffortRecovery).toBe(BACKEND_BEST_EFFORT);
    for (const c of queue.cases) {
      expect(c.cause).toBeTruthy();
      expect(c.evidence).toBeTruthy();
    }
  });

  it('feeds the §22.3 adjustments term: the eligible share subtracts the recorded Founder liability', async () => {
    const world = await seedLiveCampaign('adjust', { type: 'pre_build', orderThreshold: 1 });
    const reservation = await placePreorder(world.campaignId);
    await closeCampaign(world.campaignId);

    const before = await readFounderPaymentStatus(h.db, { campaignId: world.campaignId });
    expect(before?.eligibleShare.basis.causeBasedAdjustmentsCents).toBe('0');
    const shareBefore = BigInt(before!.eligibleShare.amountCents);

    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'founder_or_product',
        affiliateTreatment: 'not_attributed',
        proovdFeeTreatment: 'retained',
        founderLiabilityCents: 700n,
        amountCents: 700n,
        ideaExceptionReason: 'wrong_amount',
      }),
    );
    expect(recorded.status).toBe('recorded');

    const after = await readFounderPaymentStatus(h.db, { campaignId: world.campaignId });
    expect(after?.eligibleShare.basis.causeBasedAdjustmentsCents).toBe('700');
    expect(BigInt(after!.eligibleShare.amountCents)).toBe(shareBefore - 700n);
  });
});

/* ── §33.9.3 — Founder-caused refunds and finalized earnings ────────────────── */

describe('§33.9.3 — a Founder-caused refund does not claw back finalized valid Affiliate earnings', () => {
  it('finalized earnings are byte-identical after the refund, and the clawback is unrecordable', async () => {
    const world = await seedLiveCampaign('fc', { type: 'pre_build', orderThreshold: 1 });
    const creator = await seedCreator(world.campaignId, 'fc');
    const reservation = await placePreorder(world.campaignId);
    await attributeTo(reservation, creator);
    await closeCampaign(world.campaignId);

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified in the refunds suite',
      actor: 'admin:test',
    });
    const finalized = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(finalized.status).toBe('finalized');

    const before = await earningsRow(creator.associationId);
    expect(before).not.toBeNull();
    expect(before!.earnedTotalCents).toBeGreaterThan(0n);
    const reservationBefore = await reservationRow(reservation);

    // §33.9.3's trap: the tempting wrong simplification is refused BY NAME —
    // no Founder-caused case can even record a finalized-earnings treatment.
    const clawback = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'founder_or_product',
        affiliateTreatment: 'contractual_recovery',
        affiliateInvalidCents: before!.earnedTotalCents,
        ideaExceptionReason: 'material_misrepresentation',
        amountCents: 500n,
      }),
    );
    expect(clawback).toEqual({ status: 'refused', reason: 'treatment_not_permitted_for_cause' });

    // The database refuses the same pair regardless of any service.
    await expectDbRefusal(
      h.db.insert(refundCauseAllocations).values({
        campaignId: world.campaignId,
        reservationId: reservation,
        caseKind: 'refund',
        cause: 'founder_or_product',
        proovdFeeTreatment: 'retained',
        affiliateTreatment: 'contractual_recovery',
        affiliateInvalidCents: 100n,
        founderLiabilityCents: 0n,
        evidence: 'x',
        decidedBy: 'admin:test',
      }),
      /refund_allocations_cause_matrix|check constraint/i,
    );

    // Canceling "unfinalized" earnings that finalized is the same clawback
    // wearing a different word — refused against the derived phase.
    expect(await deriveEarningsPhase(h.db, { attributionAssociationId: creator.associationId })).toBe(
      'finalized_untransferred',
    );
    const stale = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'founder_or_product',
        affiliateTreatment: 'cancel_unfinalized',
        ideaExceptionReason: 'material_misrepresentation',
        amountCents: 500n,
      }),
    );
    expect(stale).toEqual({
      status: 'refused',
      reason: 'treatment_inconsistent_with_earnings_phase',
    });

    // The recordable Founder-caused case: earnings remain. Execute it fully.
    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'founder_or_product',
        affiliateTreatment: 'earnings_remain',
        proovdFeeTreatment: 'retained',
        founderLiabilityCents: 500n,
        ideaExceptionReason: 'material_misrepresentation',
        amountCents: 500n,
      }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    const executed = await executeRefund(deps(), {
      refundId: recorded.refund.id,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');

    // The whole §33.9.3 claim: nothing about the Creator's money moved.
    const after = await earningsRow(creator.associationId);
    expect(after).toEqual(before);
    const reservationAfter = await reservationRow(reservation);
    expect(reservationAfter.affiliateEarnedCents).toBe(reservationBefore.affiliateEarnedCents);
    expect(reservationAfter.affiliateUnearnedReturnedCents).toBe(
      reservationBefore.affiliateUnearnedReturnedCents,
    );
    const recoveries = await h.db
      .select()
      .from(contractualRecoveryRecords)
      .where(eq(contractualRecoveryRecords.associationId, creator.associationId));
    expect(recoveries).toHaveLength(0);
  });
});

/* ── §33.9.4 — Affiliate-caused refunds touch only invalid earnings ─────────── */

describe('§33.9.4 — an Affiliate-caused refund cancels or recovers only invalid earnings', () => {
  it('pre-finalization: only the refunded transaction cancels; the other finalizes normally', async () => {
    const world = await seedLiveCampaign('af1', { type: 'pre_build', orderThreshold: 2 });
    const creator = await seedCreator(world.campaignId, 'af1');
    const fraudulent = await placePreorder(world.campaignId);
    const genuine = await placePreorder(world.campaignId);
    await attributeTo(fraudulent, creator);
    await attributeTo(genuine, creator);
    await closeCampaign(world.campaignId);

    expect(await deriveEarningsPhase(h.db, { attributionAssociationId: creator.associationId })).toBe(
      'unfinalized',
    );

    const recorded = await recordRefundCase(
      deps(),
      caseInput(fraudulent, {
        cause: 'affiliate_fraud_or_breach',
        affiliateTreatment: 'cancel_unfinalized',
        proovdFeeTreatment: 'retained',
        ideaExceptionReason: 'unauthorized_transaction',
        amountCents: (await reservationRow(fraudulent)).totalCapturedCents!,
        evidence: 'self-dealing purchase confirmed against the click ledger',
      }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    expect(
      (
        await executeRefund(deps(), {
          refundId: recorded.refund.id,
          previewId: preview.previewId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('succeeded');

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'valid_post_later_incomplete',
      deliverablesNote: 'one valid post; later deliverables incomplete',
      actor: 'admin:test',
    });
    const finalized = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(finalized.status).toBe('finalized');

    // ONLY the invalid transaction earned nothing; the genuine one earned.
    const fraudRow = await reservationRow(fraudulent);
    expect(fraudRow.affiliateEarnedCents).toBe(0n);
    expect(fraudRow.affiliateUnearnedReturnedCents).toBe(fraudRow.affiliateProvisionalCents);
    const genuineRow = await reservationRow(genuine);
    expect(genuineRow.affiliateEarnedCents).toBeGreaterThan(0n);

    // §24.4's identity still holds at the finalization record.
    const earnings = await earningsRow(creator.associationId);
    expect(earnings!.earnedTotalCents + earnings!.unearnedReturnedCents).toBe(
      earnings!.provisionalTotalCents,
    );
  });

  it('post-Transfer: the recovery record carries ONLY the invalid amount, never the whole Transfer', async () => {
    const world = await seedLiveCampaign('af2', { type: 'pre_build', orderThreshold: 1 });
    const creator = await seedCreator(world.campaignId, 'af2');
    const reservation = await placePreorder(world.campaignId);
    await attributeTo(reservation, creator);
    await closeCampaign(world.campaignId);

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified before the fraud surfaced',
      actor: 'admin:test',
    });
    const finalized = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(finalized.status).toBe('finalized');
    const approved = await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(approved.status).toBe('approved');
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
    const transfer = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(transfer.status).toBe('created');

    const before = await earningsRow(creator.associationId);
    expect(before!.state).toBe('transferred');
    expect(await deriveEarningsPhase(h.db, { attributionAssociationId: creator.associationId })).toBe(
      'transferred_or_later',
    );

    // The invalid portion is the commission on the refunded transaction —
    // recorded by the Admin with evidence, and strictly less than the Transfer.
    const invalid = 100n;
    expect(invalid).toBeLessThan(before!.earnedTotalCents);

    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'affiliate_fraud_or_breach',
        affiliateTreatment: 'contractual_recovery',
        affiliateInvalidCents: invalid,
        proovdFeeTreatment: 'retained',
        ideaExceptionReason: 'unauthorized_transaction',
        amountCents: 500n,
        recoveryNote: 'best-effort recovery against the recipient balance',
        evidence: 'fake-traffic pattern confirmed for this transaction',
      }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    expect(
      (
        await executeRefund(deps(), {
          refundId: recorded.refund.id,
          previewId: preview.previewId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('succeeded');

    // The negative balance IS the recovery record — only the invalid amount.
    const [recovery] = await h.db
      .select()
      .from(contractualRecoveryRecords)
      .where(eq(contractualRecoveryRecords.associationId, creator.associationId));
    expect(recovery).toBeDefined();
    expect(recovery!.amountCents).toBe(invalid);
    expect(recovery!.transferId).not.toBeNull();

    const after = await earningsRow(creator.associationId);
    expect(after!.state).toBe('adjusted');
    // The finalized amounts survive untouched — the adjustment is its own act.
    expect(after!.earnedTotalCents).toBe(before!.earnedTotalCents);

    // The Transfer row itself is untouched: recovery is best-effort and never
    // rewrites what moved (§24.9).
    const [transferRow] = await h.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, creator.associationId));
    expect(transferRow!.status).toBe('created');
    expect(transferRow!.totalCents).toBe(before!.earnedTotalCents + before!.eligibleFixedCents);

    // Idempotent: a second success application changes nothing.
    const adjustedOnce = await applyRefundSuccess(deps(), recorded.refund.id, {
      actor: 'admin:test',
      now: new Date(),
    });
    expect(adjustedOnce.applied).toBe(false);
    const recoveries = await h.db
      .select()
      .from(contractualRecoveryRecords)
      .where(eq(contractualRecoveryRecords.associationId, creator.associationId));
    expect(recoveries).toHaveLength(1);
  });
});

/* ── §33.9.5 — a Proovd error never debits an unrelated Affiliate ───────────── */

describe('§33.9.5 — a Proovd error does not debit an unrelated Affiliate and returns the fee where appropriate', () => {
  it('the unrelated Creator is byte-identical and the fee return is recorded', async () => {
    const world = await seedLiveCampaign('pe', { type: 'pre_build', orderThreshold: 2 });
    const creator = await seedCreator(world.campaignId, 'pe');
    const attributed = await placePreorder(world.campaignId);
    const unrelated = await placePreorder(world.campaignId);
    await attributeTo(attributed, creator);
    await closeCampaign(world.campaignId);

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified',
      actor: 'admin:test',
    });
    expect(
      (
        await finalizeCreatorEarnings(deps(), {
          associationId: creator.associationId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('finalized');
    const before = await earningsRow(creator.associationId);

    // The structural half: a Proovd-error case cannot record a debit at all.
    for (const treatment of ['cancel_unfinalized', 'cancel_unpaid_invalid', 'contractual_recovery'] as const) {
      const refused = await recordRefundCase(
        deps(),
        caseInput(unrelated, {
          cause: 'proovd_or_system_error',
          affiliateTreatment: treatment,
          ...(treatment === 'cancel_unfinalized' ? {} : { affiliateInvalidCents: 100n }),
          amountCents: 400n,
        }),
      );
      expect(refused).toEqual({ status: 'refused', reason: 'treatment_not_permitted_for_cause' });
    }

    // The recordable case: Proovd corrects it and returns its fee.
    const recorded = await recordRefundCase(
      deps(),
      caseInput(unrelated, {
        cause: 'proovd_or_system_error',
        affiliateTreatment: 'not_attributed',
        proovdFeeTreatment: 'returned_elective',
        amountCents: 400n,
        evidence: 'a system error double-charged this Backer',
      }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    expect(recorded.allocation.proovdFeeTreatment).toBe('returned_elective');
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    expect(
      (
        await executeRefund(deps(), {
          refundId: recorded.refund.id,
          previewId: preview.previewId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('succeeded');

    // §33.9.5's claim: the unrelated Affiliate was not debited — anywhere.
    const after = await earningsRow(creator.associationId);
    expect(after).toEqual(before);
    const attributedRow = await reservationRow(attributed);
    expect(attributedRow.affiliateEarnedCents).toBe(before!.earnedTotalCents);
    expect(
      await h.db
        .select()
        .from(contractualRecoveryRecords)
        .where(eq(contractualRecoveryRecords.associationId, creator.associationId)),
    ).toHaveLength(0);
  });
});

/* ── §33.9.6 (allocation half) — an unrelated dispute and the Affiliate ─────── */

describe('§33.9.6 — an unrelated dispute does not automatically claw back the Affiliate', () => {
  it('finalized earnings remain, and the clawback treatments are unrecordable under this cause', async () => {
    const world = await seedLiveCampaign('ud', { type: 'pre_build', orderThreshold: 1 });
    const creator = await seedCreator(world.campaignId, 'ud');
    const reservation = await placePreorder(world.campaignId);
    await attributeTo(reservation, creator);
    await closeCampaign(world.campaignId);

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified',
      actor: 'admin:test',
    });
    expect(
      (
        await finalizeCreatorEarnings(deps(), {
          associationId: creator.associationId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('finalized');
    const before = await earningsRow(creator.associationId);

    // §24.8's row: "finalized Affiliate earnings remain unless evidence shows
    // Affiliate causation" — and a case WITH that evidence is CLASSIFIED as
    // Affiliate-caused. Under this cause, no clawback is recordable.
    for (const treatment of ['cancel_unpaid_invalid', 'contractual_recovery'] as const) {
      const refused = await recordRefundCase(
        deps(),
        caseInput(reservation, {
          cause: 'backer_dispute_unrelated',
          affiliateTreatment: treatment,
          affiliateInvalidCents: 100n,
          ideaExceptionReason: 'required_by_law_or_network',
          amountCents: 500n,
        }),
      );
      expect(refused).toEqual({ status: 'refused', reason: 'treatment_not_permitted_for_cause' });
    }

    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'backer_dispute_unrelated',
        affiliateTreatment: 'earnings_remain',
        proovdFeeTreatment: 'retained',
        ideaExceptionReason: 'required_by_law_or_network',
        amountCents: 500n,
        evidence: 'issuer inquiry names shipping expectations, not the Creator',
      }),
    );
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    if (!preview.ok) throw new Error('preview refused');
    expect(
      (
        await executeRefund(deps(), {
          refundId: recorded.refund.id,
          previewId: preview.previewId,
          actor: 'admin:test',
        })
      ).status,
    ).toBe('succeeded');

    // Nothing automatic touched the Creator: no adjustment, no recovery, no
    // per-row change — the earnings row is byte-identical.
    const after = await earningsRow(creator.associationId);
    expect(after).toEqual(before);
    expect(after!.state).toBe('finalized');
    expect(
      await h.db
        .select()
        .from(contractualRecoveryRecords)
        .where(eq(contractualRecoveryRecords.associationId, creator.associationId)),
    ).toHaveLength(0);
  });

  it('the legal/issuer cause requires its mandate by name', async () => {
    const world = await seedLiveCampaign('mand', { type: 'pre_build', orderThreshold: 1 });
    const reservation = await placePreorder(world.campaignId);
    await closeCampaign(world.campaignId);

    const refused = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'law_stripe_or_issuer',
        affiliateTreatment: 'not_attributed',
        ideaExceptionReason: 'required_by_law_or_network',
        mandate: null,
      }),
    );
    expect(refused).toEqual({ status: 'refused', reason: 'mandate_required' });

    const recorded = await recordRefundCase(
      deps(),
      caseInput(reservation, {
        cause: 'law_stripe_or_issuer',
        affiliateTreatment: 'not_attributed',
        ideaExceptionReason: 'required_by_law_or_network',
        mandate: 'Issuer-mandated refund under network rule 13.1',
      }),
    );
    expect(recorded.status).toBe('recorded');
  });
});
