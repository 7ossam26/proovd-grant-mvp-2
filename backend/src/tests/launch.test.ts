/**
 * Phase 14a — coordinated launch, first-post verification, and required
 * launch-Creator failure.
 *
 * Acceptance: the launch/verification/failure half of §33.4 —
 *   §33.4.5  launch executes page → links → posts → verification, in order;
 *   §33.4.6  duplicate activation/verification → one state, one message, no money;
 *   §33.4.7  first-post verification releases US$0;
 *   §33.4.8  correction/reject pauses the Creator and their link and blocks
 *            invalid earnings, without reversing the page launch;
 *   §33.4.9  required Creator failure → one non-resettable three-business-day
 *            deadline; a missed deadline returns the allocation and refunds the
 *            full listing Checkout total.
 * Plus the drift tests: the shared launch register and the business calendar
 * agree with the backend restatements.
 *
 * The attribution/discovery half (§33.6.1–5) is Phase 14b. Each scenario seeds
 * its own launch-ready campaign directly — the readiness journey is Phase
 * 12/13's suite, already green; what is under test here is what launch,
 * verification, and §29.6 do.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignStatusHistory,
  campaignPaymentFlags,
} from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  trackingLinks,
} from '../db/schema/decisions.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { creatorPaymentAllocations } from '../db/schema/creator-payment.js';
import { listingFeeCalculations } from '../db/schema/workspace.js';
import { listingFeePayments, listingFeeRefunds } from '../db/schema/listing.js';
import { creatorPostSubmissions, campaignLaunches, requiredCreatorFailures } from '../db/schema/launch.js';

import { launchCampaign, findLaunch, sweepScheduledLaunches } from '../launch/launch.js';
import { submitPost, verifyPost, findLatestSubmission } from '../launch/post-verification.js';
import { recordCreatorFailure, failReplacement, findCreatorFailure, resolveCreatorReplacement, sweepCreatorReplacementDeadlines } from '../launch/creator-failure.js';
import { creatorReplacementDeadline as backendDeadline, US_FEDERAL_HOLIDAYS as backendHolidays } from '../launch/business-calendar.js';
import { FIRST_POST_CHECK_KEYS, POST_OUTCOMES, OUTCOME_EFFECTS } from '../launch/logic.js';
import {
  FIRST_POST_VERIFICATION_CHECKS,
  POST_VERIFICATION_OUTCOMES,
  POST_VERIFICATION_EFFECTS,
  US_FEDERAL_HOLIDAYS as sharedHolidays,
  creatorReplacementDeadline as sharedDeadline,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_launch_suite';
const CONNECT_SECRET = 'whsec_connect_for_launch_suite';

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
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'launch',
  );
  admin = await createAdmin(h, 'launch-admin');
  audit = createAuditWriter(h.db);
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

const FIXED_AMOUNT = 50_000n; // US$500.00
const CHECKLIST_ALL_TRUE: Record<string, boolean> = Object.fromEntries(
  FIRST_POST_CHECK_KEYS.map((k) => [k, true]),
);

/* ── A launch-ready campaign: creator_prep, a ready Creator, a link, a date ── */

interface Seeded {
  campaignId: string;
  founderId: string;
  associationId: string;
  creatorUserId: string;
  agreementId: string;
  versionId: string;
  trackingLinkId: string;
}

async function seedReadyCampaign(
  label: string,
  options: { fixedPayment?: boolean; liveAt?: Date; associationStatus?: 'ready' | 'accepted' } = {},
): Promise<Seeded> {
  const liveAt = options.liveAt ?? new Date(Date.now() - 1000);
  const founder = await seedUser(h, 'founder', `launch-founder-${label}`);

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
      status: 'creator_prep',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      highEffort: false,
      highEffortCalculatedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: liveAt,
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

  const creator = await seedUser(h, 'affiliate', `launch-creator-${label}`);
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
      status: options.associationStatus ?? 'ready',
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

  await h.db.insert(campaignBuild).values({
    campaignId,
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
    campaignId,
    sku: 'TIER-1',
    title: 'Early bird',
    priceCents: 5_000n,
    contents: 'One unit.',
    fulfillmentCommitment: 'We will ship it.',
    delivery: '2026-12',
  });

  const [link] = await h.db
    .insert(trackingLinks)
    .values({
      associationId,
      campaignId,
      code: `code-${label}-${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: trackingLinks.id });

  return {
    campaignId,
    founderId: founder.id,
    associationId,
    creatorUserId: creator.id,
    agreementId: agreement!.id,
    versionId: version!.id,
    trackingLinkId: link!.id,
  };
}

/** Insert a fully funded allocation directly (the funding path is Phase 13's suite). */
async function seedFundedAllocation(seeded: Seeded): Promise<string> {
  const [row] = await h.db
    .insert(creatorPaymentAllocations)
    .values({
      associationId: seeded.associationId,
      campaignId: seeded.campaignId,
      proposalVersionId: seeded.versionId,
      agreementId: seeded.agreementId,
      mode: 'test',
      amountCents: FIXED_AMOUNT,
      taxTreatment: 'test',
      status: 'funded',
      fundedAt: new Date(),
    })
    .returning({ id: creatorPaymentAllocations.id });
  return row!.id;
}

/** A listing_fee_payments row for the campaign, so §29.6's refund has something to refund. */
async function seedListingPayment(campaignId: string): Promise<{ totalCents: bigint; taxCents: bigint }> {
  const [calc] = await h.db
    .insert(listingFeeCalculations)
    .values({
      campaignId,
      baseCents: 20_000n,
      itemDiscountCents: 0n,
      maxDiscountCents: 5_000n,
      minSubtotalCents: 10_000n,
      completedItems: 0,
      discountCents: 0n,
      subtotalCents: 20_000n,
      discountLines: [],
      itemsSnapshot: [],
      actor: 'admin:test',
      trigger: 'test',
      lockedAt: new Date(),
    })
    .returning({ id: listingFeeCalculations.id });

  const paidAt = new Date(Date.now() - 5 * 86_400_000);
  const totalCents = 21_600n;
  const taxCents = 1_600n;
  await h.db.insert(listingFeePayments).values({
    campaignId,
    calculationId: calc!.id,
    mode: 'test',
    checkoutSessionId: `cs_test_${randomUUID().replace(/-/g, '')}`,
    paymentIntentId: `pi_test_${randomUUID().replace(/-/g, '')}`,
    baseCents: 20_000n,
    discountCents: 0n,
    promotionCents: 0n,
    subtotalCents: 20_000n,
    taxCents,
    totalCents,
    descriptor: 'PROOVD LISTING',
    paidAt,
    responseWindowHours: 72,
    responseDeadlineAt: new Date(paidAt.getTime() + 72 * 3_600_000),
    freeCancellationWindowHours: 48,
    freeCancellationDeadlineAt: new Date(paidAt.getTime() + 48 * 3_600_000),
  });
  return { totalCents, taxCents };
}

async function campaignStatus(campaignId: string): Promise<string> {
  const [row] = await h.db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaignId));
  return row!.status;
}
async function associationStatus(associationId: string): Promise<string> {
  const [row] = await h.db
    .select({ status: campaignAffiliateAssociations.status })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId));
  return row!.status;
}
async function trackingLink(associationId: string) {
  const [row] = await h.db.select().from(trackingLinks).where(eq(trackingLinks.associationId, associationId));
  return row!;
}
async function paymentFlagCount(campaignId: string): Promise<number> {
  const [row] = await h.db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignPaymentFlags)
    .where(eq(campaignPaymentFlags.campaignId, campaignId));
  return Number(row!.n);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.5 — launch executes page → links → posts → verification, in order     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.5 — launch order: page first, links second', () => {
  it('activates the page (→ live), then the links at exactly campaign_live_at, then the Creator goes active', async () => {
    const seeded = await seedReadyCampaign('order');
    const [before] = await h.db.select({ liveAt: campaigns.campaignLiveAt }).from(campaigns).where(eq(campaigns.id, seeded.campaignId));

    // Before launch: page not live, link inactive.
    expect(await campaignStatus(seeded.campaignId)).toBe('creator_prep');
    expect((await trackingLink(seeded.associationId)).active).toBe(false);

    const result = await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    expect(result.status).toBe('launched');

    // Step 1: the page is live and the close anchor is stamped from the build.
    expect(await campaignStatus(seeded.campaignId)).toBe('live');
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, seeded.campaignId));
    expect(campaign!.campaignCloseAt).not.toBeNull();

    // Step 2: the link is active, at EXACTLY campaign_live_at, and resolves to the now-live page.
    const link = await trackingLink(seeded.associationId);
    expect(link.active).toBe(true);
    expect(link.activatedAt?.getTime()).toBe(before!.liveAt!.getTime());

    // The Creator is active; the launch record counts one activated link.
    expect(await associationStatus(seeded.associationId)).toBe('active');
    const launch = await findLaunch(h.db, seeded.campaignId);
    expect(launch?.activatedLinkCount).toBe(1);
  });

  it('the scheduled sweep launches a campaign whose campaign_live_at has arrived, and only then', async () => {
    // Due now: launches. Scheduled in the future: left alone.
    const due = await seedReadyCampaign('sweep-due', { liveAt: new Date(Date.now() - 1000) });
    const future = await seedReadyCampaign('sweep-future', { liveAt: new Date(Date.now() + 7 * 86_400_000) });

    const { result } = await sweepScheduledLaunches(h.db, { audit });
    expect(result.launched).toContain(due.campaignId);
    expect(result.launched).not.toContain(future.campaignId);

    expect(await campaignStatus(due.campaignId)).toBe('live');
    expect(await campaignStatus(future.campaignId)).toBe('creator_prep');

    // A second sweep re-launches nothing — the due campaign is already live.
    const again = await sweepScheduledLaunches(h.db, { audit });
    expect(again.result.launched).not.toContain(due.campaignId);
  });

  it('a post cannot be submitted before the link is live (posts third, after links second)', async () => {
    const seeded = await seedReadyCampaign('post-before-link');
    // Not launched: association is `ready`, link inactive → submission refused.
    const early = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/post',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    expect(early.status).toBe('not_active');
  });

  it('end-to-end through HTTP: launch, then the Creator submits, then Admin verifies', async () => {
    const seeded = await seedReadyCampaign('e2e');

    // Admin launches.
    await request(h.app)
      .post(`/api/admin/campaigns/${seeded.campaignId}/launch`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(200);

    // The Creator submits the post URL (their own session, scoped).
    const creatorCookie = await signInPlain(h, await creatorEmail(seeded.creatorUserId));
    const submitRes = await request(h.app)
      .post(`/api/creator/campaigns/${seeded.associationId}/submit-post`)
      .set('cookie', creatorCookie)
      .send({ postUrl: 'https://youtube.com/watch?v=abc', channel: 'youtube' })
      .expect(200);
    const submissionId = submitRes.body.submission.id as string;

    // Admin verifies it passed.
    const verifyRes = await request(h.app)
      .post(`/api/admin/post-submissions/${submissionId}/verify`)
      .set('cookie', admin.cookie)
      .send({ outcome: 'passed', checklist: CHECKLIST_ALL_TRUE })
      .expect(200);
    expect(verifyRes.body.verification.outcome).toBe('passed');
  });
});

async function creatorEmail(userId: string): Promise<string> {
  const [row] = await h.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.claimedUserId, userId))
    .limit(1);
  return row!.email;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.6 — duplicate activation/verification: one state, one message, no money*/
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.6 — duplicate activation and verification are idempotent and move no money', () => {
  it('launching twice yields one launch record, one live transition, and no money', async () => {
    const seeded = await seedReadyCampaign('dup-launch', { fixedPayment: true });
    await seedFundedAllocation(seeded);

    const first = await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    expect(first.status).toBe('launched');
    const second = await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    expect(second.status).toBe('already_live');

    // One launch record.
    const launches = await h.db.select().from(campaignLaunches).where(eq(campaignLaunches.campaignId, seeded.campaignId));
    expect(launches).toHaveLength(1);
    // One `live` transition in history.
    const liveHops = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(and(eq(campaignStatusHistory.campaignId, seeded.campaignId), eq(campaignStatusHistory.toStatus, 'live')));
    expect(liveHops).toHaveLength(1);

    // No money: no payment flags, no refund, the funded allocation unchanged.
    expect(await paymentFlagCount(seeded.campaignId)).toBe(0);
    const refunds = await h.db.select().from(listingFeeRefunds).where(eq(listingFeeRefunds.campaignId, seeded.campaignId));
    expect(refunds).toHaveLength(0);
    const [allocation] = await h.db.select().from(creatorPaymentAllocations).where(eq(creatorPaymentAllocations.campaignId, seeded.campaignId));
    expect(allocation!.status).toBe('funded');
  });

  it('verifying twice yields one outcome and moves no money', async () => {
    const seeded = await seedReadyCampaign('dup-verify');
    await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    const submitted = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/dup',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    expect(submitted.status).toBe('submitted');
    if (submitted.status !== 'submitted') return;
    const submissionId = submitted.submission.id;

    const first = await verifyPost(h.db, { audit }, { submissionId, outcome: 'passed', checklist: CHECKLIST_ALL_TRUE, actor: 'admin:test' });
    expect(first.status).toBe('verified');
    const verifiedAt = (await findLatestSubmission(h.db, seeded.associationId))!.verifiedAt;

    const second = await verifyPost(h.db, { audit }, { submissionId, outcome: 'correction_needed', checklist: {}, actor: 'admin:test' });
    expect(second.status).toBe('already_verified');
    // The outcome did not change, and neither did the verification time.
    const again = await findLatestSubmission(h.db, seeded.associationId);
    expect(again!.status).toBe('passed');
    expect(again!.verifiedAt?.getTime()).toBe(verifiedAt?.getTime());

    expect(await paymentFlagCount(seeded.campaignId)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.7 — first-post verification releases US$0                              */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.7 — verification is a compliance gate, not a payment trigger', () => {
  it('verifying a post passed releases no money — the funded allocation is untouched', async () => {
    const seeded = await seedReadyCampaign('zero-dollar', { fixedPayment: true });
    const allocationId = await seedFundedAllocation(seeded);
    await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });

    const submitted = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/zero',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    if (submitted.status !== 'submitted') throw new Error('submit failed');

    await verifyPost(h.db, { audit }, { submissionId: submitted.submission.id, outcome: 'passed', checklist: CHECKLIST_ALL_TRUE, actor: 'admin:test' });

    // §16: funded is not paid. Verification does not advance it.
    const [allocation] = await h.db.select().from(creatorPaymentAllocations).where(eq(creatorPaymentAllocations.id, allocationId));
    expect(allocation!.status).toBe('funded');
    expect(allocation!.transferObjectId).toBeNull();
    // No payment flag, no refund.
    expect(await paymentFlagCount(seeded.campaignId)).toBe(0);
    const refunds = await h.db.select().from(listingFeeRefunds).where(eq(listingFeeRefunds.campaignId, seeded.campaignId));
    expect(refunds).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.8 — correction/reject pauses the Creator/link; the page stays live     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.8 — correction and rejection pause the Creator and link but do not reverse the launch', () => {
  it('a correction pauses the link and the Creator; the page stays live', async () => {
    const seeded = await seedReadyCampaign('correction');
    await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    const submitted = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/correct',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    if (submitted.status !== 'submitted') throw new Error('submit failed');

    const result = await verifyPost(h.db, { audit }, {
      submissionId: submitted.submission.id,
      outcome: 'correction_needed',
      checklist: { ...CHECKLIST_ALL_TRUE, ftc_disclosure: false },
      correctionDetail: 'Add the FTC disclosure naming the Founder and product.',
      correctionDueAt: new Date(Date.now() + 2 * 86_400_000),
      actor: 'admin:test',
    });
    expect(result.status).toBe('verified');

    // The link is paused (but still active/activated — the 0017 CHECK holds).
    const link = await trackingLink(seeded.associationId);
    expect(link.pausedAt).not.toBeNull();
    expect(link.active).toBe(true);
    expect(link.activatedAt).not.toBeNull();
    // The Creator is paused; the page is still live.
    expect(await associationStatus(seeded.associationId)).toBe('paused');
    expect(await campaignStatus(seeded.campaignId)).toBe('live');
  });

  it('a rejection pauses the link, opens enforcement, preserves evidence — page still live', async () => {
    const seeded = await seedReadyCampaign('reject');
    await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    const submitted = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/reject',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    if (submitted.status !== 'submitted') throw new Error('submit failed');

    await verifyPost(h.db, { audit }, {
      submissionId: submitted.submission.id,
      outcome: 'rejected',
      checklist: { ...CHECKLIST_ALL_TRUE, no_prohibited_claim: false },
      enforcementReason: 'Made a prohibited health claim.',
      evidence: { screenshot: 's3://evidence/reject.png' },
      actor: 'admin:test',
    });

    const submission = await findLatestSubmission(h.db, seeded.associationId);
    expect(submission!.status).toBe('rejected');
    expect(submission!.enforcementReason).toBeTruthy();
    expect(submission!.evidence).not.toBeNull();
    expect((await trackingLink(seeded.associationId)).pausedAt).not.toBeNull();
    expect(await associationStatus(seeded.associationId)).toBe('paused');
    // §33.4.8's trap: a rejected post does not unlaunch the campaign.
    expect(await campaignStatus(seeded.campaignId)).toBe('live');
  });

  it('a corrected resubmission that passes resumes the link and the Creator', async () => {
    const seeded = await seedReadyCampaign('resume');
    await launchCampaign(h.db, { audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    const first = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/first',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    if (first.status !== 'submitted') throw new Error('submit failed');
    await verifyPost(h.db, { audit }, {
      submissionId: first.submission.id,
      outcome: 'correction_needed',
      checklist: {},
      correctionDetail: 'Fix it.',
      actor: 'admin:test',
    });
    expect(await associationStatus(seeded.associationId)).toBe('paused');

    // The Creator fixes it and resubmits — permitted while paused, because that
    // is exactly how a correction is fixed. Admin verifies the corrected post,
    // and passing it resumes the link and the Creator.
    const second = await submitPost(h.db, { audit }, {
      associationId: seeded.associationId,
      postUrl: 'https://example.com/second',
      submittedBy: `user:${seeded.creatorUserId}`,
    });
    expect(second.status).toBe('submitted');
    if (second.status !== 'submitted') return;

    const passed = await verifyPost(h.db, { audit }, {
      submissionId: second.submission.id,
      outcome: 'passed',
      checklist: CHECKLIST_ALL_TRUE,
      actor: 'admin:test',
    });
    expect(passed.status).toBe('verified');
    if (passed.status === 'verified') expect(passed.associationResumed).toBe(true);

    expect(await associationStatus(seeded.associationId)).toBe('active');
    expect((await trackingLink(seeded.associationId)).pausedAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* §33.4.9 — required Creator failure: non-resettable deadline; miss → refund   */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('§33.4.9 — required launch Creator failure and the three-business-day window', () => {
  it('records the failure once with a 3-business-day deadline carrying its calendar version; a retry cannot reset it', async () => {
    const seeded = await seedReadyCampaign('failure', { liveAt: new Date(Date.now() + 5 * 86_400_000) });

    const recordedAt = new Date('2026-03-02T15:00:00.000Z'); // a Monday
    const first = await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement social creator.',
      recordedBy: 'admin:test',
      now: recordedAt,
    });
    expect(first.status).toBe('recorded');
    if (first.status !== 'recorded') return;
    expect(first.alreadyExisted).toBe(false);

    // The campaign moved to creator_replacement.
    expect(await campaignStatus(seeded.campaignId)).toBe('creator_replacement');

    // The deadline is three business days out, versioned. 2026-03-02 (Mon) + 3
    // business days = 2026-03-05 (Thu).
    const expected = backendDeadline(recordedAt);
    expect(first.failure.dueAt.getTime()).toBe(expected.dueAt.getTime());
    expect(first.failure.dueCalendarVersion).toBe(expected.calendarVersion);
    expect(first.failure.dueAt.toISOString()).toBe('2026-03-05T15:00:00.000Z');

    // A retry with a DIFFERENT designation and time returns the SAME record.
    const retry = await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'A different plan entirely.',
      recordedBy: 'admin:test',
      now: new Date('2026-03-04T00:00:00.000Z'),
    });
    expect(retry.status).toBe('recorded');
    if (retry.status !== 'recorded') return;
    expect(retry.alreadyExisted).toBe(true);
    expect(retry.failure.dueAt.getTime()).toBe(first.failure.dueAt.getTime());
    expect(retry.failure.replacementDesignation).toBe('Recruit a replacement social creator.');
  });

  it('the database refuses to move the recorded deadline (§33.12.2)', async () => {
    const seeded = await seedReadyCampaign('immutable', { liveAt: new Date(Date.now() + 5 * 86_400_000) });
    await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement.',
      recordedBy: 'admin:test',
    });
    const failure = await findCreatorFailure(h.db, seeded.campaignId);
    await expect(
      h.db
        .update(requiredCreatorFailures)
        .set({ dueAt: new Date(Date.now() + 30 * 86_400_000) })
        .where(eq(requiredCreatorFailures.id, failure!.id)),
    ).rejects.toThrow();
  });

  it('a missed deadline returns the funded allocation and refunds the full listing total', async () => {
    const seeded = await seedReadyCampaign('missed', {
      fixedPayment: true,
      liveAt: new Date(Date.now() + 10 * 86_400_000),
    });
    const allocationId = await seedFundedAllocation(seeded);
    const payment = await seedListingPayment(seeded.campaignId);

    const recordedAt = new Date('2026-03-02T15:00:00.000Z');
    const recorded = await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement.',
      recordedBy: 'admin:test',
      now: recordedAt,
    });
    if (recorded.status !== 'recorded') throw new Error('record failed');

    // The deadline passes with no ready replacement.
    const afterDeadline = new Date(recorded.failure.dueAt.getTime() + 1000);
    const result = await failReplacement({ db: h.db, gateway, audit }, seeded.campaignId, afterDeadline);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;

    // §23.1/§23.2: refunded_no_creator, roster failed.
    expect(await campaignStatus(seeded.campaignId)).toBe('refunded_no_creator');
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, seeded.campaignId));
    expect(campaign!.affiliateRosterStatus).toBe('failed');

    // §29.6: the funded allocation is returned to the Founder.
    const [allocation] = await h.db.select().from(creatorPaymentAllocations).where(eq(creatorPaymentAllocations.id, allocationId));
    expect(allocation!.status).toBe('returned');
    expect(allocation!.returnEligible).toBe(true);
    expect(allocation!.returnAmountCents).toBe(FIXED_AMOUNT);

    // §29.6: the ENTIRE listing Checkout total — subtotal plus tax — refunded once.
    const refunds = await h.db.select().from(listingFeeRefunds).where(eq(listingFeeRefunds.campaignId, seeded.campaignId));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.trigger).toBe('creator_replacement_failed');
    expect(refunds[0]!.totalRefundedCents).toBe(payment.totalCents);
    expect(refunds[0]!.taxRefundedCents).toBe(payment.taxCents);

    // The failure record is resolved and linked to the refund.
    const failure = await findCreatorFailure(h.db, seeded.campaignId);
    expect(failure!.status).toBe('replacement_failed');
    expect(failure!.refundId).toBe(refunds[0]!.id);
  });

  it('the miss path is idempotent — a second sweep refunds nothing twice', async () => {
    const seeded = await seedReadyCampaign('missed-twice', { fixedPayment: true, liveAt: new Date(Date.now() + 10 * 86_400_000) });
    await seedFundedAllocation(seeded);
    await seedListingPayment(seeded.campaignId);
    const recorded = await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement.',
      recordedBy: 'admin:test',
      now: new Date('2026-03-02T15:00:00.000Z'),
    });
    if (recorded.status !== 'recorded') throw new Error('record failed');
    const after = new Date(recorded.failure.dueAt.getTime() + 1000);

    await failReplacement({ db: h.db, gateway, audit }, seeded.campaignId, after);
    const again = await failReplacement({ db: h.db, gateway, audit }, seeded.campaignId, after);
    expect(again.status).toBe('already_failed');

    const refunds = await h.db.select().from(listingFeeRefunds).where(eq(listingFeeRefunds.campaignId, seeded.campaignId));
    expect(refunds).toHaveLength(1);
  });

  it('the scheduled sweep fails a due replacement window and refunds it', async () => {
    const seeded = await seedReadyCampaign('sweep-fail', { fixedPayment: true, liveAt: new Date(Date.now() + 10 * 86_400_000) });
    await seedListingPayment(seeded.campaignId);
    const recorded = await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement.',
      recordedBy: 'admin:test',
      now: new Date('2026-03-02T15:00:00.000Z'),
    });
    if (recorded.status !== 'recorded') throw new Error('record failed');

    const after = new Date(recorded.failure.dueAt.getTime() + 1000);
    const { result } = await sweepCreatorReplacementDeadlines({ db: h.db, gateway, audit }, after);
    expect(result.failed).toContain(seeded.campaignId);
    expect(await campaignStatus(seeded.campaignId)).toBe('refunded_no_creator');
  });

  it('a replacement that becomes ready before the deadline returns the campaign to creator_prep', async () => {
    const seeded = await seedReadyCampaign('replaced', { liveAt: new Date(Date.now() + 10 * 86_400_000) });
    await recordCreatorFailure({ db: h.db, audit }, {
      campaignId: seeded.campaignId,
      failedAssociationId: seeded.associationId,
      replacementDesignation: 'Recruit a replacement.',
      recordedBy: 'admin:test',
    });
    expect(await campaignStatus(seeded.campaignId)).toBe('creator_replacement');

    const resolved = await resolveCreatorReplacement({ db: h.db, audit }, { campaignId: seeded.campaignId, actor: 'admin:test' });
    expect(resolved.status).toBe('resolved');
    expect(await campaignStatus(seeded.campaignId)).toBe('creator_prep');
    const failure = await findCreatorFailure(h.db, seeded.campaignId);
    expect(failure!.status).toBe('replacement_ready');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* Drift — the backend restatements match the shared register                  */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('the backend launch register matches the shared reference (drift)', () => {
  it('the first-post check keys agree', () => {
    expect([...FIRST_POST_CHECK_KEYS]).toEqual(FIRST_POST_VERIFICATION_CHECKS.map((c) => c.key));
  });

  it('the outcomes and their effects agree', () => {
    expect([...POST_OUTCOMES]).toEqual([...POST_VERIFICATION_OUTCOMES]);
    for (const outcome of POST_OUTCOMES) {
      expect(OUTCOME_EFFECTS[outcome].pausesLink).toBe(POST_VERIFICATION_EFFECTS[outcome].pausesLink);
      expect(OUTCOME_EFFECTS[outcome].opensEnforcement).toBe(POST_VERIFICATION_EFFECTS[outcome].opensEnforcement);
    }
  });

  it('the business calendar and the computed replacement deadline agree', () => {
    expect(backendHolidays.version).toBe(sharedHolidays.version);
    expect(backendHolidays.timezone).toBe(sharedHolidays.timezone);
    expect(backendHolidays.holidays.map((holiday) => holiday.date)).toEqual(
      sharedHolidays.holidays.map((holiday) => holiday.date),
    );
    const anchor = new Date('2026-03-02T15:00:00.000Z');
    const b = backendDeadline(anchor);
    const s = sharedDeadline(anchor);
    expect(b.dueAt.getTime()).toBe(s.dueAt.getTime());
    expect(b.calendarVersion).toBe(s.calendarVersion);
  });
});
