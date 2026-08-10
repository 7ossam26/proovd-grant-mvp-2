/**
 * Phase 20b — post-capture enforcement, outcome-specific ended pages, and the
 * §29 records.
 *
 * Acceptance: §33.9.8 (a pre-charge kill closes without charge; a post-charge
 * kill invokes the refund/reversal/recovery policy — the §24.8 path opens, the
 * unreleased-funds hold refuses by name, charged reservations are never
 * rewritten), §33.9.9 (ended pages distinguish threshold miss, natural close,
 * pre-charge kill, and post-charge suspension — one generic message is
 * prohibited). Plus the §29.4 affiliate enforcement record with its five
 * required customer-statement fields and final appeal, §29.1's earns-nothing
 * consequence, §29.8's reacceptance suspension, and §29.9/§29.10's Backer
 * support path with the recorded escalation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, createAdmin, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { affiliateEnforcementAppeals } from '../db/schema/enforcement.js';
import { policyVersions } from '../db/schema/policies.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { associationCompensationAgreements } from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import {
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveEarningsForTransfer,
  createAffiliateTransfer,
} from '../close/earnings.js';
import { createFounderPayment } from '../close/founder-payments.js';
import { recordTaxAccountability } from '../payments/tax-accountability.js';
import {
  recordRefundCase,
  previewRefundExecution,
  executeRefund,
} from '../refunds/service.js';
import {
  recordAffiliateEnforcement,
  submitAffiliateAppeal,
  decideAffiliateAppeal,
  recordSelfPreorderDisclosure,
} from '../enforcement/affiliates.js';
import { requirePolicyReacceptance } from '../enforcement/reacceptance.js';
import { campaignEnforcementHold } from '../support/enforcement-hold.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import { POST_CAPTURE_EFFECTS } from '../support/logic.js';
import {
  POST_CAPTURE_EFFECTS as SHARED_POST_CAPTURE,
  AFFILIATE_ENFORCEMENT_ACTIONS as SHARED_ACTIONS,
  AFFILIATE_ENFORCEMENT_REASONS as SHARED_REASONS,
  TERMINATION_VALIDITY as SHARED_VALIDITY,
  CONFLICT_RELATIONSHIP_KINDS as SHARED_CONFLICTS,
  ESCALATION_WAIT_DAYS as SHARED_WAIT,
  ISSUER_RIGHTS_SENTENCE as SHARED_ISSUER,
} from '@proovd/shared';
import {
  AFFILIATE_ENFORCEMENT_ACTIONS,
  AFFILIATE_ENFORCEMENT_REASONS,
  TERMINATION_VALIDITY,
  CONFLICT_RELATIONSHIP_KINDS,
  ESCALATION_WAIT_DAYS,
  ISSUER_RIGHTS_SENTENCE,
} from '../enforcement/logic.js';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_enforce20b',
  connectWebhookSecret: 'whsec_connect_for_enforce20b',
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
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'enforce20b',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'enforce20b-admin');
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
): Promise<{ campaignId: string; founderUserId: string; founderEmail: string; connectedAccountId: string }> {
  const founder = await seedUser(h, 'founder', `en-founder-${label}`);
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
          refundPolicyText: `Version one for ${label}.`,
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

  return {
    campaignId,
    founderUserId: founder.id,
    founderEmail: founder.email,
    connectedAccountId: stripeAccountId,
  };
}

interface SeededCreator {
  associationId: string;
  trackingLinkId: string;
  creatorEmail: string;
}

async function seedCreator(campaignId: string, label: string): Promise<SeededCreator> {
  const creator = await seedUser(h, 'affiliate', `en-creator-${label}`);
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
      code: `en-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });
  return { associationId, trackingLinkId: link!.id, creatorEmail: creator.email };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `en${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777770${String(n).padStart(2, '0')}`,
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

async function enforceOverHttp(
  campaignId: string,
  action: 'suspend' | 'kill',
  explanation: string,
): Promise<request.Response> {
  return request(h.app)
    .post(`/api/admin/campaigns/${campaignId}/enforcement`)
    .set('cookie', admin.cookie)
    .send({
      action,
      reasonCategory: 'fraud',
      reasonDetail: 'documented in the enforcement suite',
      customerExplanation: explanation,
    });
}

async function endedState(campaignId: string): Promise<{ kind: string; explanation: string | null }> {
  const res = await request(h.app).get(`/api/campaign/${campaignId}`);
  expect(res.status).toBe(200);
  return res.body.ended;
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

/* ── Drift ─────────────────────────────────────────────────────────────────── */

describe('drift — the §29 registers are the shared ones', () => {
  it('restates every register byte for byte', () => {
    expect(POST_CAPTURE_EFFECTS).toEqual(SHARED_POST_CAPTURE);
    expect(AFFILIATE_ENFORCEMENT_ACTIONS).toEqual(SHARED_ACTIONS);
    expect(AFFILIATE_ENFORCEMENT_REASONS).toEqual(SHARED_REASONS);
    expect(TERMINATION_VALIDITY).toEqual(SHARED_VALIDITY);
    expect(CONFLICT_RELATIONSHIP_KINDS).toEqual(SHARED_CONFLICTS);
    expect(ESCALATION_WAIT_DAYS).toBe(SHARED_WAIT);
    expect(ISSUER_RIGHTS_SENTENCE).toBe(SHARED_ISSUER);
  });
});

/* ── §33.9.8 — pre-charge vs post-charge kill ──────────────────────────────── */

describe('§33.9.8 — pre-charge kill closes without charge; post-charge kill invokes recovery', () => {
  it('a pre-charge kill closes reservations at US$0, keeps the SetupIntent, and creates no PaymentIntent', async () => {
    const { campaignId, connectedAccountId } = await seedLiveCampaign('prek', {
      type: 'pre_launch',
    });
    const reservationId = await placePreorder(campaignId);
    const before = await reservationRow(reservationId);
    expect(before.setupIntentId).toBeTruthy();
    const intentsBefore = gateway.paymentIntents.filter(
      (p) => p.connectedAccountId === connectedAccountId,
    ).length;

    const res = await enforceOverHttp(
      campaignId,
      'kill',
      'This campaign was stopped before any charge. No card was charged, and none will be.',
    );
    expect(res.status).toBe(201);
    expect(res.body.phase).toBe('pre_capture');
    expect(res.body.reservationsClosed).toBe(1);
    expect(res.body.effectsApplied).toContain('close_active_reservations_without_charge');
    expect(res.body.effectsApplied).toContain('notify_affected_roles');

    const after = await reservationRow(reservationId);
    expect(after.status).toBe('killed_no_charge');
    // §29.7: the successful SetupIntent stays historical.
    expect(after.setupIntentId).toBe(before.setupIntentId);
    // No charge was created by the kill — nothing to refund (§33.7.4's rule).
    expect(
      gateway.paymentIntents.filter((p) => p.connectedAccountId === connectedAccountId).length,
    ).toBe(intentsBefore);

    // The Backer heard, factually: no charge.
    const backerNotice = h.sentEmails.messages.find(
      (m) => m.to === before.backerEmail && m.text.includes('Your card was NOT charged'),
    );
    expect(backerNotice).toBeDefined();
  });

  it('a post-charge kill leaves charged money in its recorded state, holds unreleased funds by name, and opens the §24.8 path', async () => {
    const { campaignId } = await seedLiveCampaign('postk', { type: 'pre_launch' });
    const creator = await seedCreator(campaignId, 'postk');
    const reservationId = await placePreorder(campaignId);
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
    await closeCampaign(campaignId);
    expect((await reservationRow(reservationId)).status).toBe('captured');

    // Finalize and approve the Creator's money — but do NOT transfer yet: the
    // hold must be what stops it.
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

    const res = await enforceOverHttp(
      campaignId,
      'kill',
      'Proovd stopped this campaign after charges occurred. Charged pre-orders keep their recorded state; refunds follow the recorded rules.',
    );
    expect(res.status).toBe(201);
    expect(res.body.phase).toBe('post_capture');
    expect(res.body.postCaptureConsequencesDeferred).toBe(false);
    for (const effect of POST_CAPTURE_EFFECTS) {
      expect(res.body.effectsApplied).toContain(effect);
    }

    // The charged reservation is NEVER rewritten to a no-charge state — its
    // status is the money's history.
    expect((await reservationRow(reservationId)).status).toBe('captured');

    // "Restrict unreleased funds": the hold reader answers, and both money
    // edges refuse by name.
    const hold = await campaignEnforcementHold(h.db, campaignId);
    expect(hold.restricted).toBe(true);
    expect(hold.action).toBe('kill');

    const transfer = await createAffiliateTransfer(deps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(transfer.status).toBe('enforcement_hold');

    const payment = await createFounderPayment(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      { campaignId, kind: 'first_payment', actor: 'admin:test' },
    );
    expect(payment.status).toBe('enforcement_hold');

    // "Invoke the refund/reversal/recovery policy": the §24.8 machine is the
    // open path, and it works — an Admin-recorded case, previewed, executed.
    const reservation = await reservationRow(reservationId);
    const recorded = await recordRefundCase(deps(), {
      reservationId,
      cause: 'founder_or_product',
      affiliateTreatment: 'earnings_remain',
      proovdFeeTreatment: 'retained',
      founderLiabilityCents: reservation.totalCapturedCents,
      evidence: 'post-capture kill: refunding this charge under the recorded rules',
      amountCents: reservation.totalCapturedCents,
      actor: 'admin:test',
    });
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') throw new Error('unreachable');
    const preview = await previewRefundExecution(h.db, {
      refundId: recorded.refund.id,
      issuedBy: 'admin:test',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const executed = await executeRefund(deps(), {
      refundId: recorded.refund.id,
      previewId: preview.previewId,
      actor: 'admin:test',
    });
    expect(executed.status).toBe('succeeded');
    expect((await reservationRow(reservationId)).status).toBe('refunded');
  });
});

/* ── §33.9.9 — outcome-specific ended pages ────────────────────────────────── */

describe('§33.9.9 — ended pages distinguish the four outcomes', () => {
  it('threshold miss, natural close, pre-charge kill, and post-charge suspension are four different answers', async () => {
    // Threshold miss: an Idea campaign far short of its threshold.
    const miss = await seedLiveCampaign('miss', { type: 'pre_build', orderThreshold: 250 });
    await placePreorder(miss.campaignId);
    await closeCampaign(miss.campaignId);
    const missEnded = await endedState(miss.campaignId);
    expect(missEnded.kind).toBe('threshold_not_met');

    // Natural close: a Product campaign that captured.
    const closed = await seedLiveCampaign('clsd', { type: 'pre_launch' });
    await placePreorder(closed.campaignId);
    await closeCampaign(closed.campaignId);
    const closedEnded = await endedState(closed.campaignId);
    expect(closedEnded.kind).toBe('closed');

    // Pre-charge kill.
    const killed = await seedLiveCampaign('kild', { type: 'pre_launch' });
    await placePreorder(killed.campaignId);
    await enforceOverHttp(killed.campaignId, 'kill', 'Stopped before any charge was created.');
    const killedEnded = await endedState(killed.campaignId);
    expect(killedEnded.kind).toBe('killed_before_charge');
    expect(killedEnded.explanation).toBe('Stopped before any charge was created.');

    // Post-charge suspension.
    const susp = await seedLiveCampaign('susp', { type: 'pre_launch' });
    await placePreorder(susp.campaignId);
    await closeCampaign(susp.campaignId);
    await enforceOverHttp(
      susp.campaignId,
      'suspend',
      'Paused for review after close; charged pre-orders keep their recorded state.',
    );
    const suspEnded = await endedState(susp.campaignId);
    expect(suspEnded.kind).toBe('suspended_after_charge');
    expect(suspEnded.explanation).toContain('Paused for review after close');

    // Four outcomes, four distinct kinds — one generic message is prohibited.
    const kinds = [missEnded.kind, closedEnded.kind, killedEnded.kind, suspEnded.kind];
    expect(new Set(kinds).size).toBe(4);
  });
});

/* ── §29.4/§29.5 — the affiliate enforcement record and its appeal ─────────── */

describe('§29.4 — affiliate enforcement states the whole customer statement', () => {
  it('a pause records the five fields, computes the appeal deadline, pauses the partnership, and the appeal decision is final', async () => {
    const { campaignId } = await seedLiveCampaign('aff', { type: 'pre_launch' });
    const creator = await seedCreator(campaignId, 'aff');

    // A vague "policy violation" has no representable record.
    const vague = await recordAffiliateEnforcement(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      {
        associationId: creator.associationId,
        actionKind: 'pause',
        reasonCategory: 'metric_manipulation',
        internalReason: 'internal: click farm pattern on pi_12345abcde',
        evidenceAndBehavior: '',
        ruleViolated: 'AUP §4',
        immediateEffect: 'Partnership paused.',
        correctionPath: 'Remove the automation and reply.',
        humanRoute: 'support@proovd.co',
        actor: 'admin:test',
        mfaContext: 'password_session_admin_role_verified',
        reauthContext: 'test',
      },
    );
    expect(vague.ok).toBe(false);
    if (vague.ok) throw new Error('unreachable');
    expect(vague.code).toBe('invalid');

    // §33.9.11: a raw provider code in a customer field is refused by name.
    const leaky = await recordAffiliateEnforcement(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      {
        associationId: creator.associationId,
        actionKind: 'pause',
        reasonCategory: 'metric_manipulation',
        internalReason: 'internal detail',
        evidenceAndBehavior: 'We saw pi_1234567890abc used to boost clicks.',
        ruleViolated: 'AUP §4',
        immediateEffect: 'Partnership paused.',
        correctionPath: 'Remove the automation and reply.',
        humanRoute: 'support@proovd.co',
        actor: 'admin:test',
        mfaContext: 'password_session_admin_role_verified',
        reauthContext: 'test',
      },
    );
    expect(leaky.ok).toBe(false);
    if (leaky.ok) throw new Error('unreachable');
    expect(leaky.code).toBe('raw_provider_code');

    const recorded = await recordAffiliateEnforcement(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      {
        associationId: creator.associationId,
        actionKind: 'pause',
        reasonCategory: 'metric_manipulation',
        internalReason: 'click-farm pattern documented in case notes',
        evidenceAndBehavior:
          'Between August 1 and August 3, 4,200 clicks arrived from one device fingerprint on your link.',
        ruleViolated: 'Affiliate AUP: no engagement or click boosting (§29.1).',
        immediateEffect: 'Your partnership and tracking link are paused.',
        correctionPath: 'Remove the automation and reply with what changed.',
        humanRoute: 'support@proovd.co — a person answers.',
        actor: 'admin:test',
        mfaContext: 'password_session_admin_role_verified',
        reauthContext: 'test',
      },
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error('unreachable');
    expect(recorded.action.appealDueAt.getTime()).toBeGreaterThan(Date.now());
    expect(recorded.action.calendarVersion).toBeTruthy();

    // The partnership and its link actually paused.
    const [assoc] = await h.db
      .select({ status: sql<string>`${campaignAffiliateAssociations.status}::text` })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, creator.associationId))
      .limit(1);
    expect(assoc!.status).toBe('paused');
    const [link] = await h.db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.associationId, creator.associationId))
      .limit(1);
    expect(link!.pausedAt).not.toBeNull();

    // The Creator's notice carries the statement, not the internal reason.
    const notice = h.sentEmails.messages.find(
      (m) => m.to === creator.creatorEmail && m.subject.includes('About your Creator partnership'),
    );
    expect(notice).toBeDefined();
    expect(notice!.text).toContain('4,200 clicks');
    expect(notice!.text).toContain('Appeal deadline');
    expect(notice!.text).not.toContain('click-farm pattern documented');

    // The appeal: submitted once, decided once, and the decision is final.
    const appeal = await submitAffiliateAppeal(
      { db: h.db, audit },
      { actionId: recorded.action.id, grounds: 'That device is my own testing setup.', actor: 'affiliate:test' },
    );
    expect(appeal.ok).toBe(true);
    if (!appeal.ok) throw new Error('unreachable');

    const again = await submitAffiliateAppeal(
      { db: h.db, audit },
      { actionId: recorded.action.id, grounds: 'again', actor: 'affiliate:test' },
    );
    expect(again.ok).toBe(false);

    const decided = await decideAffiliateAppeal(
      { db: h.db, audit },
      { appealId: appeal.appealId, decision: 'overturned', note: 'verified the testing claim', actor: 'admin:test' },
    );
    expect(decided.ok).toBe(true);

    // An overturned pause restores the partnership.
    const [restored] = await h.db
      .select({ status: sql<string>`${campaignAffiliateAssociations.status}::text` })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, creator.associationId))
      .limit(1);
    expect(restored!.status).toBe('active');

    const redecided = await decideAffiliateAppeal(
      { db: h.db, audit },
      { appealId: appeal.appealId, decision: 'upheld', actor: 'admin:test' },
    );
    expect(redecided.ok).toBe(false);
    if (redecided.ok) throw new Error('unreachable');
    expect(redecided.code).toBe('already_decided');

    // The database refuses too — the decision is final at the trigger.
    await expectDbRefusal(
      h.db
        .update(affiliateEnforcementAppeals)
        .set({ decision: 'upheld' })
        .where(eq(affiliateEnforcementAppeals.id, appeal.appealId)),
      /final/i,
    );
  });

  it('§29.1: a disclosed self-pre-order attributed to the discloser earns nothing', async () => {
    const { campaignId } = await seedLiveCampaign('self', { type: 'pre_launch' });
    const creator = await seedCreator(campaignId, 'self');
    const reservationId = await placePreorder(campaignId);
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

    // Uncertified → no record (§29.1's conditions are the permission).
    const uncertified = await recordSelfPreorderDisclosure(
      { db: h.db, audit },
      {
        associationId: creator.associationId,
        reservationId,
        intentNote: 'I want to back my own campaign.',
        selfFundedCertified: false,
        identityDisclosed: true,
        actor: 'admin:test',
      },
    );
    expect(uncertified.ok).toBe(false);

    const disclosed = await recordSelfPreorderDisclosure(
      { db: h.db, audit },
      {
        associationId: creator.associationId,
        reservationId,
        intentNote: 'Disclosed self-funded purchase with identity shared.',
        selfFundedCertified: true,
        identityDisclosed: true,
        actor: 'admin:test',
      },
    );
    expect(disclosed.ok).toBe(true);

    // The attribution moved to `blocked` — finalization counts only verified.
    expect((await reservationRow(reservationId)).attributionStatus).toBe('blocked');
  });
});

/* ── §29.8 — reacceptance suspends continued use ───────────────────────────── */

describe('§29.8 — a material policy update suspends continued use until accepted', () => {
  it('requires a published version, gates the Founder prefix, and the acceptance route ends the suspension', async () => {
    // Publication is one-way; this suite owns its database.
    await h.db.execute(
      sql`UPDATE policy_versions SET status = 'published', effective_date = now(), published_at = now() WHERE slug = 'terms'`,
    );
    const [terms] = await h.db
      .select({ version: policyVersions.version })
      .from(policyVersions)
      .where(eq(policyVersions.slug, 'terms'))
      .limit(1);

    const draftAttempt = await requirePolicyReacceptance(
      { db: h.db, audit },
      {
        slug: 'privacy',
        version: 'v0',
        audience: 'founder',
        reason: 'x',
        actor: 'admin:test',
      },
    );
    expect(draftAttempt.ok).toBe(false);

    const required = await requirePolicyReacceptance(
      { db: h.db, audit },
      {
        slug: 'terms',
        version: terms!.version,
        audience: 'founder',
        reason: 'Material liability-terms update in §7 of the Terms.',
        actor: 'admin:test',
      },
    );
    expect(required.ok).toBe(true);

    const founder = await seedUser(h, 'founder', 'reaccept-founder');
    const cookie = await signInPlain(h, founder.email);

    // Continued use is suspended: any Founder-prefix request answers 403
    // naming the document.
    const gated = await request(h.app).get('/api/founder/campaigns').set('cookie', cookie);
    expect(gated.status).toBe(403);
    expect(gated.body.error).toBe('policy_reacceptance_required');
    expect(gated.body.requirements[0].slug).toBe('terms');

    // The acceptance route lives OUTSIDE the gated prefix and ends it.
    const accepted = await request(h.app)
      .post('/api/account/policy-reacceptance')
      .set('cookie', cookie)
      .send({ slug: 'terms' });
    expect(accepted.status).toBe(201);

    const ungated = await request(h.app).get('/api/founder/campaigns').set('cookie', cookie);
    expect(ungated.status).not.toBe(403);
  });
});

/* ── §29.9/§29.10 — the Backer support path and the recorded escalation ────── */

describe('§29.10 — Founder first, then the recorded escalation to Proovd', () => {
  it('opens a case with full context, relays the Founder response, and records the escalation', async () => {
    const { campaignId } = await seedLiveCampaign('sup', { type: 'pre_launch' });
    const reservationId = await placePreorder(campaignId);
    const reservation = await reservationRow(reservationId);
    const link = await mintOrReissueMagicLink(
      { db: h.db, tokenService: h.tokens, appBaseUrl: CONTEXT.appBaseUrl },
      { campaignId, backerIdentityId: reservation.backerIdentityId },
    );

    // Open: a not-as-described case goes to the Founder first (§29.10).
    const opened = await request(h.app)
      .post(`/api/link/${link.raw}/support`)
      .send({
        topic: 'reward_not_as_described',
        message: 'The reward that arrived is not what the page promised.',
        reservationId,
      });
    expect(opened.status).toBe(201);
    expect(opened.body.owner).toBe('founder_coordinated');
    expect(opened.body.reference).toMatch(/^PVD-/);
    expect(opened.body.acknowledgement).toContain(opened.body.reference);
    expect(opened.body.issuerRights).toBe(ISSUER_RIGHTS_SENTENCE);

    // §27.5 "Support received": the same B.8 string reached the inbox.
    const ack = h.sentEmails.messages.find(
      (m) => m.to === reservation.backerEmail && m.subject.includes('We received your request'),
    );
    expect(ack).toBeDefined();
    expect(ack!.text).toContain(ISSUER_RIGHTS_SENTENCE);

    const view = await request(h.app).get(`/api/link/${link.raw}/support`);
    expect(view.status).toBe(200);
    const caseId = view.body.cases[0].caseId as string;
    expect(view.body.cases[0].canEscalate).toBe(false);
    expect(view.body.cases[0].escalationOpensAt).toBeTruthy();

    // Too early, no response: refused by name with the date the arm opens.
    const early = await request(h.app)
      .post(`/api/link/${link.raw}/support/${caseId}/escalate`)
      .send({ reason: 'No answer yet.' });
    expect(early.status).toBe(422);
    expect(early.body.error).toBe('not_eligible_yet');
    expect(early.body.opensAt).toBeTruthy();

    // The Founder responds (through Admin's coordinated reply) — and the
    // response actually reaches the Backer's inbox (§27.5).
    const reply = await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('cookie', admin.cookie)
      .send({
        direction: 'outbound',
        customerFacing: true,
        body: 'The Founder confirms the strap color differs and offers a replacement.',
      });
    expect(reply.status).toBe(201);
    const relayed = h.sentEmails.messages.find(
      (m) => m.to === reservation.backerEmail && m.subject.includes('Response to your request'),
    );
    expect(relayed).toBeDefined();

    // Responded-but-not-resolved: the §29.10 second arm opens now.
    const after = await request(h.app).get(`/api/link/${link.raw}/support`);
    expect(after.body.cases[0].responded).toBe(true);
    expect(after.body.cases[0].canEscalate).toBe(true);

    const escalated = await request(h.app)
      .post(`/api/link/${link.raw}/support/${caseId}/escalate`)
      .send({ reason: 'The replacement offer does not address the missing feature.' });
    expect(escalated.status).toBe(201);
    expect(escalated.body.kind).toBe('not_resolved');

    const final = await request(h.app).get(`/api/link/${link.raw}/support`);
    expect(final.body.cases[0].owner).toBe('proovd_support');
    expect(final.body.cases[0].escalatedAt).toBeTruthy();

    // One escalation per case.
    const second = await request(h.app)
      .post(`/api/link/${link.raw}/support/${caseId}/escalate`)
      .send({ reason: 'again' });
    expect(second.status).toBe(422);
  });
});
