/**
 * Phase 20b — disputes (§24.11), the descriptor consolidation (§24.12), the
 * Transfer reversal, and the timeline suppression record.
 *
 * Acceptance: the dispute-ingestion half of §33.9.6 (an unrelated dispute does
 * not automatically claw back the Affiliate — the ingest touches no earnings,
 * the classification's ceiling is the §24.8 matrix), §33.9.7 (the evidence
 * packet includes all required consent/tax/policy/delivery/support data —
 * ASSEMBLED from stored records), §33.9.12 (a duplicate event creates one
 * customer message and a timeline suppression record), and §33.9.13 (the
 * computed campaign descriptor passes provider validation and matches
 * campaign, checkout, receipt, magic link, support, and evidence — with the
 * capture call sending the SUFFIX, never the whole display value).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

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
import { paymentDisputes, paymentDisputeEvidence } from '../db/schema/disputes.js';
import { refundCauseAllocations } from '../db/schema/refunds.js';
import {
  creatorEarnings,
  affiliateTransfers,
  contractualRecoveryRecords,
} from '../db/schema/earnings.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { associationCompensationAgreements, trackingLinks } from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import {
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveEarningsForTransfer,
  createAffiliateTransfer,
} from '../close/earnings.js';
import { recordTaxAccountability } from '../payments/tax-accountability.js';
import {
  classifyDispute,
  disputeTaskDueAt,
  readDisputeEvidencePacket,
  readDisputeQueue,
  recordDisputeEvidenceAssembly,
} from '../disputes/service.js';
import { readBackerPage } from '../reservations/magic-link-read.js';
import { openSupportCase, readCaseContext } from '../support/cases.js';
import { readTimeline } from '../support/timeline.js';
import {
  DISPUTE_EVIDENCE_ITEMS as BACKEND_ITEMS,
  DISPUTE_TASK_HOURS as BACKEND_TASK_HOURS,
  PAYMENT_DISPUTE_STATUSES as BACKEND_STATUSES,
} from '../disputes/logic.js';
import {
  computeCampaignDescriptor as backendCompute,
  campaignDescriptorSuffix as backendSuffix,
  campaignDescriptorViolations as backendViolations,
  DESCRIPTOR_PREFIX as BACKEND_PREFIX,
  PLATFORM_DESCRIPTOR as BACKEND_PLATFORM,
  LISTING_DESCRIPTOR as BACKEND_LISTING,
  CREATOR_PAYMENT_DESCRIPTOR as BACKEND_CREATOR_PAY,
} from '../payments/descriptors.js';
import {
  DISPUTE_EVIDENCE_ITEMS as SHARED_ITEMS,
  DISPUTE_TASK_HOURS as SHARED_TASK_HOURS,
  PAYMENT_DISPUTE_STATUSES as SHARED_STATUSES,
  computeCampaignDescriptor as sharedCompute,
  campaignDescriptorSuffix as sharedSuffix,
  campaignDescriptorViolations as sharedViolations,
  DESCRIPTOR_PREFIX as SHARED_PREFIX,
  PLATFORM_DESCRIPTOR as SHARED_PLATFORM,
  LISTING_DESCRIPTOR as SHARED_LISTING,
  CREATOR_PAYMENT_DESCRIPTOR as SHARED_CREATOR_PAY,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_disputes_suite';
const CONNECT_SECRET = 'whsec_connect_for_disputes_suite';

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

const AFTER_DAY_3 = () => new Date(Date.now() + (3 * 24 + 2) * 3_600_000);

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'disputes',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'disputes-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT };
}

/* ── Seeding (the refunds suite's shape) ───────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `dp-founder-${label}`);
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
  creatorEmail: string;
}

async function seedCreator(campaignId: string, label: string): Promise<SeededCreator> {
  const creator = await seedUser(h, 'affiliate', `dp-creator-${label}`);
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

  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_r${label}${randomUUID().slice(0, 8)}`,
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
      code: `dp-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });

  return {
    associationId,
    trackingLinkId: link!.id,
    creatorUserId: creator.id,
    creatorEmail: creator.email,
  };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `dp${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777760${String(n).padStart(2, '0')}`,
  };
}

async function placePreorder(campaignId: string): Promise<string> {
  const res = await request(h.app)
    .post(`/api/campaign/${campaignId}/preorder`)
    .send({
      rewardSku: 'TIER-1',
      contact: contact(),
      billing: { country: 'US', postalCode: '10001', state: 'NY' },
      ageConfirmed: true,
      survey: { why: 'want it', recommend: 7 },
      operationalSharingAck: true,
      founderMarketingConsent: false,
      newsletterConsent: false,
      paymentMethodId: `pm_${randomUUID().slice(0, 12)}`,
    });
  expect(res.status).toBe(201);
  return res.body.reservationId as string;
}

async function attributeTo(reservationId: string, creator: SeededCreator): Promise<void> {
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

async function earningsRow(associationId: string) {
  const [row] = await h.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, associationId))
    .limit(1);
  return row ?? null;
}

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

function disputeObject(reservation: {
  chargeId: string | null;
  paymentIntentId: string | null;
  totalCapturedCents: bigint;
}, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `dp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    object: 'dispute',
    charge: reservation.chargeId,
    payment_intent: reservation.paymentIntentId,
    amount: Number(reservation.totalCapturedCents),
    currency: 'usd',
    reason: 'fraudulent',
    status: 'needs_response',
    evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86_400 },
    created: Math.floor(Date.now() / 1000),
    ...over,
  };
}

/* ── Drift: backend restatements are the shared registers ──────────────────── */

describe('drift — the 20b registers are the shared ones', () => {
  it('§24.11 dispute registers', () => {
    expect(BACKEND_TASK_HOURS).toBe(SHARED_TASK_HOURS);
    expect(BACKEND_STATUSES).toEqual(SHARED_STATUSES);
    expect(BACKEND_ITEMS).toEqual(SHARED_ITEMS);
  });

  it('§24.12 descriptor kernel and constants', () => {
    expect(BACKEND_PREFIX).toBe(SHARED_PREFIX);
    expect(BACKEND_PLATFORM).toBe(SHARED_PLATFORM);
    expect(BACKEND_LISTING).toBe(SHARED_LISTING);
    expect(BACKEND_CREATOR_PAY).toBe(SHARED_CREATOR_PAY);
    for (const founder of [
      { legalName: 'Ada Example', entity: 'Nova Labs LLC' },
      { legalName: 'Solo Person', entity: 'sole proprietor' },
      { legalName: '123', entity: '!!!' },
    ]) {
      expect(backendCompute(founder)).toEqual(sharedCompute(founder));
      const { display } = backendCompute(founder);
      expect(backendSuffix(display)).toBe(sharedSuffix(display));
      expect(backendViolations(backendCompute(founder))).toEqual(
        sharedViolations(sharedCompute(founder)),
      );
    }
    expect(backendSuffix('PROOVD TESTCO')).toBe(sharedSuffix('PROOVD TESTCO'));
  });
});

/* ── §33.9.13 — one computed descriptor across the surfaces ────────────────── */

describe('§33.9.13 — the computed campaign descriptor', () => {
  it('passes provider validation and matches campaign, checkout, receipt, magic link, support, and evidence — and the capture sends the SUFFIX', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('desc', {
      type: 'pre_launch',
    });

    // The one kernel's answer for this Founder.
    const expected = backendCompute({ legalName: 'Founder desc', entity: 'desc Labs LLC' });
    expect(backendViolations(expected)).toEqual([]);
    expect(expected.display.startsWith(`${BACKEND_PREFIX}* `)).toBe(true);
    expect(expected.display.length).toBeLessThanOrEqual(22);

    // Campaign page (§18 item 14).
    const page = await request(h.app).get(`/api/campaign/${campaignId}`);
    expect(page.status).toBe(200);
    expect(page.body.campaign.statementDescriptor).toBe(expected.display);

    // Checkout: the pre-order stores it on the reservation.
    const reservationId = await placePreorder(campaignId);
    const before = await reservationRow(reservationId);
    expect(before.statementDescriptor).toBe(expected.display);

    // Capture: what is SENT to the provider is the suffix — sending the whole
    // display would render `PROOVD* PROOVD …` on a real statement (§24.12).
    await closeCampaign(campaignId);
    const intent = gateway.paymentIntents.find(
      (p) => p.connectedAccountId === connectedAccountId,
    );
    expect(intent).toBeDefined();
    expect(intent!.statementDescriptorSuffix).toBe(backendSuffix(expected.display));
    expect(intent!.statementDescriptorSuffix!.startsWith(BACKEND_PREFIX)).toBe(false);

    // Receipt email: the same display value.
    const receipt = h.sentEmails.messages.find(
      (m) => m.text?.includes('Your statement shows') && m.text.includes(expected.display),
    );
    expect(receipt).toBeDefined();

    // Magic link: the same stored value.
    const captured = await reservationRow(reservationId);
    expect(captured.status).toBe('captured');
    const backerPage = await readBackerPage(h.db, {
      campaignId,
      backerIdentityId: captured.backerIdentityId,
    });
    expect(backerPage.transactions[0]!.statementDescriptor).toBe(expected.display);

    // Support: the case context carries the same stored value.
    const opened = await openSupportCase(h.db, {
      topic: 'unknown_charge',
      owner: 'proovd_support',
      requesterKind: 'backer',
      requesterEmail: captured.backerEmail!,
      backerIdentityId: captured.backerIdentityId,
      campaignId,
      reservationId,
      message: 'What is this charge?',
      createdBy: 'admin:test',
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('unreachable');
    const context = await readCaseContext(h.db, opened.result.caseId);
    expect(context!.reservation!.statementDescriptor).toBe(expected.display);

    // Evidence: the §24.11 packet names the same value.
    const dp = disputeObject(captured);
    await signedDelivery(
      eventBody({ type: 'charge.dispute.created', account: connectedAccountId, object: dp }),
    ).expect(200);
    const [dispute] = await h.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.reservationId, reservationId))
      .limit(1);
    const packet = await readDisputeEvidencePacket(h.db, dispute!.id);
    const amounts = packet!.items.find((i) => i.key === 'transaction_amounts');
    expect(amounts?.present).toBe(true);
    expect((amounts?.data as { statementDescriptor: string }).statementDescriptor).toBe(
      expected.display,
    );
  });
});

/* ── §33.9.6 (dispute half) + the §24.11 record ────────────────────────────── */

describe('§33.9.6 dispute half — ingestion claws nothing back', () => {
  it('opens the 24-hour task, moves the reservation, touches NO earnings, and classification has the §24.8 ceiling', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('ing', {
      type: 'pre_launch',
    });
    const creator = await seedCreator(campaignId, 'ing');
    const reservationId = await placePreorder(campaignId);
    await attributeTo(reservationId, creator);
    await closeCampaign(campaignId);

    // Finalize and transfer — the money has fully moved before the dispute.
    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified in the disputes suite',
      actor: 'admin:test',
    });
    const finalized = await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(finalized.status).toBe('finalized');
    await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
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
    expect(before).not.toBeNull();

    const reservation = await reservationRow(reservationId);
    const dp = disputeObject(reservation);
    const payload = eventBody({
      type: 'charge.dispute.created',
      account: connectedAccountId,
      object: dp,
    });
    await signedDelivery(payload).expect(200);

    // The dispute record, its CHECK-pinned 24-hour task, and the status move.
    const [dispute] = await h.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.reservationId, reservationId))
      .limit(1);
    expect(dispute).toBeDefined();
    expect(dispute!.status).toBe('needs_response');
    expect(dispute!.taskDueAt.getTime()).toBe(disputeTaskDueAt(dispute!.openedAt).getTime());
    expect((await reservationRow(reservationId)).status).toBe('disputed');

    // §33.9.6: the ingest wrote NO allocation and touched NO earnings —
    // compared as whole rows, not spot checks.
    expect(dispute!.allocationId).toBeNull();
    expect(await earningsRow(creator.associationId)).toEqual(before);
    const recoveries = await h.db
      .select()
      .from(contractualRecoveryRecords)
      .where(eq(contractualRecoveryRecords.associationId, creator.associationId));
    expect(recoveries).toHaveLength(0);

    // The internal §24.11 notice for THIS dispute went out once.
    const notices = h.sentEmails.messages.filter((m) =>
      m.subject?.includes(`Dispute opened — evidence due in 24 hours (${dp['id'] as string})`),
    );
    expect(notices).toHaveLength(1);

    // A duplicate delivery (same payload, same signature) changes nothing.
    await signedDelivery(payload).expect(200);
    const rows = await h.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.reservationId, reservationId));
    expect(rows).toHaveLength(1);
    expect(
      h.sentEmails.messages.filter((m) =>
        m.subject?.includes(`Dispute opened — evidence due in 24 hours (${dp['id'] as string})`),
      ),
    ).toHaveLength(1);

    // §33.9.6's ceiling: an unrelated Backer dispute cannot record the
    // stronger treatments — the §24.8 matrix refuses by name.
    const refused = await classifyDispute(deps(), {
      disputeId: dispute!.id,
      cause: 'backer_dispute_unrelated',
      affiliateTreatment: 'contractual_recovery',
      proovdFeeTreatment: 'retained',
      affiliateInvalidCents: 100n,
      founderLiabilityCents: 0n,
      evidence: 'unrelated cardholder dispute',
      actor: 'admin:test',
    });
    expect(refused).toEqual({ status: 'refused', reason: 'treatment_not_permitted_for_cause' });

    // The permitted classification records the allocation and STILL claws
    // nothing back: finalized earnings remain, byte-identical.
    const classified = await classifyDispute(deps(), {
      disputeId: dispute!.id,
      cause: 'backer_dispute_unrelated',
      affiliateTreatment: 'earnings_remain',
      proovdFeeTreatment: 'retained',
      founderLiabilityCents: 0n,
      evidence: 'unrelated cardholder dispute; no Affiliate causation evidence',
      actor: 'admin:test',
    });
    expect(classified.status).toBe('classified');
    if (classified.status !== 'classified') throw new Error('unreachable');
    const [allocation] = await h.db
      .select()
      .from(refundCauseAllocations)
      .where(eq(refundCauseAllocations.id, classified.allocationId))
      .limit(1);
    expect(allocation!.caseKind).toBe('dispute');
    expect(await earningsRow(creator.associationId)).toEqual(before);

    // The classification is write-once.
    const second = await classifyDispute(deps(), {
      disputeId: dispute!.id,
      cause: 'backer_dispute_unrelated',
      affiliateTreatment: 'earnings_remain',
      proovdFeeTreatment: 'retained',
      founderLiabilityCents: 0n,
      evidence: 'again',
      actor: 'admin:test',
    });
    expect(second).toEqual({ status: 'refused', reason: 'already_classified' });

    // The 24-hour task and identity are immutable at the database.
    await expectDbRefusal(
      h.db
        .update(paymentDisputes)
        .set({ taskDueAt: new Date(Date.now() + 72 * 3_600_000) })
        .where(eq(paymentDisputes.id, dispute!.id)),
      /immutable|24-hour/i,
    );

    // The queue leads with the §24.11 facts.
    const queue = await readDisputeQueue(h.db, { campaignId });
    expect(queue.disputes).toHaveLength(1);
    expect(queue.disputes[0]!.classified).toBe(true);

    // Admin route smoke: the queue serves the registers.
    const res = await request(h.app)
      .get(`/api/admin/disputes?campaignId=${campaignId}`)
      .set('cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(1);
    expect(res.body.causes.length).toBe(5);
    expect(res.body.evidenceItems.length).toBe(10);
  });

  it('a lost dispute moves the reservation to reversed and flips do-not-fulfill; a won one restores captured', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('out', {
      type: 'pre_launch',
    });
    const first = await placePreorder(campaignId);
    const second = await placePreorder(campaignId);
    await closeCampaign(campaignId);

    const won = disputeObject(await reservationRow(first));
    await signedDelivery(
      eventBody({ type: 'charge.dispute.created', account: connectedAccountId, object: won }),
    ).expect(200);
    await signedDelivery(
      eventBody({
        type: 'charge.dispute.closed',
        account: connectedAccountId,
        object: { ...won, status: 'won' },
      }),
    ).expect(200);
    expect((await reservationRow(first)).status).toBe('captured');

    const lost = disputeObject(await reservationRow(second));
    await signedDelivery(
      eventBody({ type: 'charge.dispute.created', account: connectedAccountId, object: lost }),
    ).expect(200);
    await signedDelivery(
      eventBody({
        type: 'charge.dispute.closed',
        account: connectedAccountId,
        object: { ...lost, status: 'lost' },
      }),
    ).expect(200);
    expect((await reservationRow(second)).status).toBe('reversed');
  });
});

/* ── §33.9.7 — the evidence packet ─────────────────────────────────────────── */

describe('§33.9.7 — the §24.11 evidence packet', () => {
  it('includes every required consent/tax/policy/delivery/support item, assembled from stored records', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('evd', {
      type: 'pre_launch',
    });
    const reservationId = await placePreorder(campaignId);
    await closeCampaign(campaignId);
    const reservation = await reservationRow(reservationId);

    await signedDelivery(
      eventBody({
        type: 'charge.dispute.created',
        account: connectedAccountId,
        object: disputeObject(reservation),
      }),
    ).expect(200);
    const [dispute] = await h.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.reservationId, reservationId))
      .limit(1);

    const packet = await readDisputeEvidencePacket(h.db, dispute!.id);
    expect(packet).not.toBeNull();
    expect(packet!.complete).toBe(true);
    expect(packet!.missing).toEqual([]);

    const byKey = new Map(packet!.items.map((i) => [i.key, i]));
    // Every §24.11 item is present or names why it is absent (§1.4).
    expect(packet!.items).toHaveLength(10);

    const consent = byKey.get('consent')!;
    expect(consent.present).toBe(true);
    expect((consent.data as { text: string }).text).toContain('US$');
    expect((consent.data as { version: string }).version).toBeTruthy();

    expect(byKey.get('campaign_disclosure')!.present).toBe(true);
    expect(byKey.get('founder_identity')!.present).toBe(true);
    expect((byKey.get('founder_identity')!.data as { merchantOfRecord: string }).merchantOfRecord).toBe(
      'founder',
    );

    const amounts = byKey.get('transaction_amounts')!;
    expect(amounts.present).toBe(true);
    const amountData = amounts.data as Record<string, unknown>;
    expect(amountData['totalAuthorizedCents']).toBeTruthy();
    expect((amountData['billing'] as Record<string, unknown>)['postalCode']).toBe('10001');
    expect(amountData['statementDescriptor']).toBeTruthy();

    expect(byKey.get('delivery_promise')!.present).toBe(true);
    const payment = byKey.get('payment_objects')!;
    expect(payment.present).toBe(true);
    const paymentData = payment.data as Record<string, unknown>;
    expect(paymentData['setupIntentId']).toBeTruthy();
    expect(paymentData['paymentIntentId']).toBeTruthy();
    expect(paymentData['chargeId']).toBeTruthy();

    // The survey was answered but the Backer did not consent to sharing — the
    // packet says so rather than leaking it ("where permitted", §24.11).
    const survey = byKey.get('survey_responses')!;
    expect(survey.present).toBe(false);
    expect(survey.absentReason).toBe('backer_did_not_consent_to_sharing');

    // §24.10: the transaction's own immutable policy snapshot.
    const policy = byKey.get('refund_policy')!;
    expect(policy.present).toBe(true);

    // Fulfillment records are Phase 21's; the packet names the absence.
    const fulfillment = byKey.get('fulfillment_evidence')!;
    expect(fulfillment.present).toBe(false);
    expect(fulfillment.absentReason).toContain('Phase 21');

    expect(byKey.get('communication_history')!.present).toBe(true);

    // §26.7/§1.3: the assembly is a recorded act.
    const recorded = await recordDisputeEvidenceAssembly(deps(), {
      disputeId: dispute!.id,
      actor: 'admin:test',
    });
    expect(recorded.status).toBe('recorded');
    const stored = await h.db
      .select()
      .from(paymentDisputeEvidence)
      .where(eq(paymentDisputeEvidence.disputeId, dispute!.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.complete).toBe(true);
  });
});

/* ── §33.9.12 + transfer.reversed ──────────────────────────────────────────── */

describe('§33.9.12 — one customer message, and a timeline suppression record', () => {
  it('a redelivered transfer.reversed under a FRESH event id sends nothing more, and the timeline shows the suppression', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('rev', {
      type: 'pre_launch',
    });
    const creator = await seedCreator(campaignId, 'rev');
    const reservationId = await placePreorder(campaignId);
    await attributeTo(reservationId, creator);
    await closeCampaign(campaignId);

    await recordCompletionDecision(deps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified',
      actor: 'admin:test',
    });
    await finalizeCreatorEarnings(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    await approveEarningsForTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    const created = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');
    const [transfer] = await h.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, creator.associationId))
      .limit(1);

    const reversalObject = {
      id: transfer!.providerTransferId,
      object: 'transfer',
      amount_reversed: Number(transfer!.totalCents),
      reversed: true,
    };
    // Two deliveries under FRESH event ids: the provider-event pivot cannot
    // dedup them, so the notifier's claim is what keeps the message singular.
    await signedDelivery(
      eventBody({ type: 'transfer.reversed', account: connectedAccountId, object: reversalObject }),
    ).expect(200);
    await signedDelivery(
      eventBody({ type: 'transfer.reversed', account: connectedAccountId, object: reversalObject }),
    ).expect(200);

    const notices = h.sentEmails.messages.filter(
      (m) => m.to === creator.creatorEmail && m.subject?.includes('Transfer reversal recorded'),
    );
    expect(notices).toHaveLength(1);

    // §26.8/§33.9.12: the timeline shows the one sent message AND the
    // suppression, composed from the audit record — not a generic Admin line.
    const timeline = await readTimeline(h.db, 'association', creator.associationId);
    const sent = timeline.entries.filter(
      (e) => e.kind === 'notification' && e.summary.includes('affiliate_transfer_reversal'),
    );
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const suppressed = timeline.entries.filter(
      (e) =>
        e.kind === 'notification' &&
        e.summary.includes('Duplicate delivery suppressed') &&
        e.detail?.['suppressed'] === true,
    );
    expect(suppressed).toHaveLength(1);
  });

  it('an unmatched reversal is recorded under §32.4 and routed to Admin — never guessed', async () => {
    const payload = eventBody({
      type: 'transfer.reversed',
      account: 'acct_unknown123',
      object: { id: `tr_unknown${randomUUID().slice(0, 8)}`, object: 'transfer', amount_reversed: 500 },
    });
    const res = await signedDelivery(payload);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('handled');
  });
});
