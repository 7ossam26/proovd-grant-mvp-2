/**
 * Phase 19b — the Founder W-9, the payment schedule, and early remaining
 * release (§22.3, §24.5, §23.3).
 *
 * Acceptance: §33.8.9 (a missing or unverified W-9 blocks every Founder
 * payment), §33.8.10 (Idea creates only the 100% Day 3 single payment, with no
 * second object), §33.8.11 (Product creates 40%/60%; early remaining payment
 * cannot occur before Day 3 or without actual delivery/communication/tax/
 * no-risk evidence), §33.8.12 (early release does not skip Day 14), §33.8.13
 * (every money surface shows identical amounts, statuses, and reasons) — plus
 * the drift tests pinning the 19b registers against @proovd/shared, the §27.6
 * internal due notices, and the banned-vocabulary scan.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, createAdmin, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow, updateSetting } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  campaignStatusHistory,
  reservations,
} from '../db/schema/domain.js';
import {
  founderW9Records,
  founderW9Events,
  founderPayments,
  earlyReleaseEvidence,
} from '../db/schema/founder-payments.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { associationCompensationAgreements, trackingLinks } from '../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import { recordCompletionDecision, finalizeCreatorEarnings } from '../close/earnings.js';
import {
  requestFounderW9,
  recordW9Submitted,
  decideW9,
  readFounderPaymentStatus,
  createFounderPayment,
  releaseFounderPayment,
  recordEarlyReleaseEvidence,
  requestEarlyRemaining,
  decideEarlyRemaining,
  sweepFounderPaymentSchedule,
  looksLikeTin,
} from '../close/founder-payments.js';
import { formatCents } from '../reservations/restated.js';
import {
  W9_STATUSES as BACKEND_W9_STATUSES,
  W9_STATE_TRANSITIONS as BACKEND_W9_TRANSITIONS,
  W9_STATE_LINES as BACKEND_W9_LINES,
  W9_SECURE_ACTION as BACKEND_W9_ACTION,
  FOUNDER_PAYMENT_KINDS as BACKEND_KINDS,
  FOUNDER_PAYMENT_KIND_LABELS as BACKEND_LABELS,
  FOUNDER_PAYMENT_SCHEDULES as BACKEND_SCHEDULES,
  EARLY_REMAINING_SETTING_KEY as BACKEND_EARLY_KEY,
  EARLY_RELEASE_EVIDENCE_FACTS as BACKEND_EVIDENCE_FACTS,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14 as BACKEND_NEVER_SKIPS,
  FOUNDER_PAYMENT_STATUS_FACTS as BACKEND_STATUS_FACTS,
  FOUNDER_SHARE_TAX_NOTE as BACKEND_TAX_NOTE,
  eligibleFounderShareCents as backendShare,
  founderPaymentAmountCents as backendAmount,
} from '../close/founder-payments-logic.js';
import {
  W9_STATUSES as SHARED_W9_STATUSES,
  W9_STATE_TRANSITIONS as SHARED_W9_TRANSITIONS,
  W9_STATE_LINES as SHARED_W9_LINES,
  W9_SECURE_ACTION as SHARED_W9_ACTION,
  FOUNDER_PAYMENT_KINDS as SHARED_KINDS,
  FOUNDER_PAYMENT_KIND_LABELS as SHARED_LABELS,
  FOUNDER_PAYMENT_SCHEDULES as SHARED_SCHEDULES,
  EARLY_REMAINING_SETTING_KEY as SHARED_EARLY_KEY,
  EARLY_RELEASE_EVIDENCE_FACTS as SHARED_EVIDENCE_FACTS,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14 as SHARED_NEVER_SKIPS,
  FOUNDER_PAYMENT_STATUS_FACTS as SHARED_STATUS_FACTS,
  FOUNDER_SHARE_TAX_NOTE as SHARED_TAX_NOTE,
  eligibleFounderShareCents as sharedShare,
  founderPaymentAmountCents as sharedAmount,
  BANNED_MONEY_STATUS_WORDS,
  campaignMachine,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_founder_payments';
const CONNECT_SECRET = 'whsec_connect_for_founder_payments';

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

/** Comfortably past Day 3 / Day 14 for a campaign closed "now". */
const AFTER_DAY_3 = () => new Date(Date.now() + (3 * 24 + 2) * 3_600_000);
const AFTER_DAY_14 = () => new Date(Date.now() + (14 * 24 + 2) * 3_600_000);

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'founder-payments',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'founder-payments-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return { db: h.db, audit, notifier: h.notifier, context: CONTEXT };
}

function closeDeps() {
  return { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT };
}

/* ── Seeding (the earnings suite's shape) ───────────────────────────────────── */

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; orderThreshold?: number },
): Promise<{ campaignId: string; founderUserId: string; founderEmail: string }> {
  const founder = await seedUser(h, 'founder', `fp-founder-${label}`);
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

  return { campaignId, founderUserId: founder.id, founderEmail: founder.email };
}

async function seedCreator(
  campaignId: string,
  label: string,
  percent = 20,
): Promise<{ associationId: string; trackingLinkId: string }> {
  const creator = await seedUser(h, 'affiliate', `fp-creator-${label}`);
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
      code: `fp-${label}-${randomUUID().slice(0, 8)}`,
      active: true,
      activatedAt: new Date(),
    })
    .returning({ id: trackingLinks.id });
  return { associationId, trackingLinkId: link!.id };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `fp${n}-${randomUUID().slice(0, 6)}@example.com`,
    phone: `41777750${String(n).padStart(2, '0')}`,
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

async function closeCampaign(campaignId: string): Promise<void> {
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
  const summary = await runCloseBatch(closeDeps(), { campaignId, actor: 'admin:test' });
  expect(summary.status).toBe('complete');
}

async function campaignRow(id: string) {
  const [row] = await h.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row!;
}

async function w9Row(campaignId: string) {
  const [row] = await h.db
    .select()
    .from(founderW9Records)
    .where(eq(founderW9Records.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

async function paymentRows(campaignId: string) {
  return h.db.select().from(founderPayments).where(eq(founderPayments.campaignId, campaignId));
}

/** Verify a campaign's W-9 through the real receipt → decision path. */
async function verifyW9(campaignId: string): Promise<void> {
  const submitted = await recordW9Submitted(deps(), {
    campaignId,
    reference: 'secure store folder W9/2026/received',
    actor: 'admin:test',
  });
  expect(submitted.status).toBe('recorded');
  const decided = await decideW9(deps(), {
    campaignId,
    decision: 'verified',
    note: 'complete and legible',
    actor: 'admin:test',
  });
  expect(decided.status).toBe('verified');
}

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

/* ── Drift — the 19b registers and kernels match @proovd/shared ─────────────── */

describe('drift — the 19b registers match the shared originals', () => {
  it('restates the W-9 machine, the schedules, and the §22.3 vocabulary', () => {
    expect([...BACKEND_W9_STATUSES]).toEqual([...SHARED_W9_STATUSES]);
    expect({ ...BACKEND_W9_TRANSITIONS }).toEqual({ ...SHARED_W9_TRANSITIONS });
    expect({ ...BACKEND_W9_LINES }).toEqual({ ...SHARED_W9_LINES });
    expect(BACKEND_W9_ACTION).toBe(SHARED_W9_ACTION);
    expect([...BACKEND_KINDS]).toEqual([...SHARED_KINDS]);
    expect({ ...BACKEND_LABELS }).toEqual({ ...SHARED_LABELS });
    expect({
      idea: BACKEND_SCHEDULES.idea.map((e) => ({ ...e })),
      product: BACKEND_SCHEDULES.product.map((e) => ({ ...e })),
    }).toEqual({
      idea: SHARED_SCHEDULES.idea.map((e) => ({ ...e })),
      product: SHARED_SCHEDULES.product.map((e) => ({ ...e })),
    });
    expect(BACKEND_EARLY_KEY).toBe(SHARED_EARLY_KEY);
    expect(BACKEND_EVIDENCE_FACTS.map((f) => ({ ...f }))).toEqual(
      SHARED_EVIDENCE_FACTS.map((f) => ({ ...f })),
    );
    expect(BACKEND_NEVER_SKIPS).toBe(SHARED_NEVER_SKIPS);
    expect(BACKEND_STATUS_FACTS.map((f) => ({ ...f }))).toEqual(
      SHARED_STATUS_FACTS.map((f) => ({ ...f })),
    );
    expect(BACKEND_TAX_NOTE).toBe(SHARED_TAX_NOTE);
  });

  it('restates the eligible-share and payment-amount kernels', () => {
    const input = {
      rewardSubtotalCapturedCents: 100_001n,
      proovdFeeCents: 5_000n,
      finalizedCreatorCompensationCents: 20_000n,
      causeBasedAdjustmentsCents: 0n,
      stripeFeesAllocatedToFounderCents: 1_234n,
    };
    expect(backendShare(input)).toBe(sharedShare(input));
    const share = backendShare(input);
    const first = { kind: 'first_payment' as const, eligibleShareCents: share, percent: 40 };
    expect(backendAmount(first)).toBe(sharedAmount(first));
    const remaining = {
      kind: 'remaining_payment' as const,
      eligibleShareCents: share,
      percent: 60,
      firstPaymentCents: backendAmount(first),
    };
    expect(backendAmount(remaining)).toBe(sharedAmount(remaining));
    expect(backendAmount(first) + backendAmount(remaining)).toBe(share);
  });
});

/* ── The Idea campaign: W-9 and the one single payment ──────────────────────── */

describe('§33.8.9 / §33.8.10 — the W-9 block and the Idea single payment', () => {
  let campaignId: string;
  let founderEmail: string;
  let creator: { associationId: string; trackingLinkId: string };
  /** §22.3: subtotal − 5% − finalized Creator compensation − adjustments −
      allocated Stripe fees. Read from the capture ledger, never invented:
      the memory gateway reports a real per-charge fee, and the formula must
      subtract exactly what the ledger recorded (§24.5). */
  let EXPECTED_SHARE = 0n;

  beforeAll(async () => {
    const seeded = await seedLiveCampaign('idea', { type: 'pre_build', orderThreshold: 1 });
    campaignId = seeded.campaignId;
    founderEmail = seeded.founderEmail;
    creator = await seedCreator(campaignId, 'idea-a', 20);

    const r1 = await placePreorder(campaignId);
    const r2 = await placePreorder(campaignId);
    await placePreorder(campaignId);
    await attributeTo(r1, creator);
    await attributeTo(r2, creator);
    await closeCampaign(campaignId);

    // 20% of the 5000 attributed subtotal finalizes to 1000 later in this
    // describe; the ledger already fixed the other terms at capture.
    const c = await campaignRow(campaignId);
    EXPECTED_SHARE =
      c.rewardSubtotalCapturedCents - c.proovdFeeCents - 1_000n - c.stripeFeeCents;
    expect(c.rewardSubtotalCapturedCents).toBe(7_500n);
    expect(c.proovdFeeCents).toBe(375n);
  }, 120_000);

  it('requests the W-9 immediately after close, exactly once', async () => {
    const record = await w9Row(campaignId);
    expect(record).not.toBeNull();
    expect(record!.status).toBe('requested');

    // The batch again and the sweep again: one record, one prompt (§27.2).
    const again = await runCloseBatch(closeDeps(), { campaignId, actor: 'admin:test' });
    expect(again.status).toBe('already_complete');
    await requestFounderW9(deps(), { campaignId, actor: 'admin:test' });
    const prompts = emailsMatching(
      (t) => t.includes('Your W-9 is needed') && t.includes(`Campaign idea`),
    );
    expect(prompts).toBe(1);
    const events = await h.db
      .select()
      .from(founderW9Events)
      .where(eq(founderW9Events.campaignId, campaignId));
    expect(events).toHaveLength(1);
  });

  it('§33.8.9 — an unverified W-9 blocks the payment, by name and by trigger', async () => {
    // Before Creator finalization AND before the W-9: the W-9 refusal comes
    // first — it is §22.3's own first requirement.
    const refused = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'checks recorded',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(refused.status).toBe('w9_not_verified');

    // The database refuses the same row a service bug would write.
    const record = await w9Row(campaignId);
    await expectDbRefusal(
      h.db.insert(founderPayments).values({
        campaignId,
        kind: 'single_payment',
        status: 'eligible',
        w9RecordId: record!.id,
        eligibleShareCents: EXPECTED_SHARE,
        percent: 100,
        amountCents: EXPECTED_SHARE,
        campaignCloseAt: (await campaignRow(campaignId)).campaignCloseAt!,
        scheduledDay: 3,
        dueAt: new Date((await campaignRow(campaignId)).campaignCloseAt!.getTime() + 3 * 86_400_000),
        paymentChecksNote: 'x',
        approvedBy: 'x',
        createdBy: 'admin:test',
      }),
      /blocks every Founder payment/,
    );
  });

  it('refuses a TIN-shaped value in the receipt, in the service and the database', async () => {
    expect(looksLikeTin('123-45-6789')).toBe(true);
    expect(looksLikeTin('12-3456789')).toBe(true);
    const refused = await recordW9Submitted(deps(), {
      campaignId,
      reference: 'form for 123-45-6789',
      actor: 'admin:test',
    });
    expect(refused.status).toBe('tin_rejected');

    const record = await w9Row(campaignId);
    await expectDbRefusal(
      h.db
        .update(founderW9Records)
        .set({ status: 'submitted', submittedAt: new Date(), submittedReference: 'ssn 123-45-6789' })
        .where(eq(founderW9Records.id, record!.id)),
      /founder_w9_no_tin/,
    );
  });

  it('a returned submission re-prompts; verify lifts the block', async () => {
    const submitted = await recordW9Submitted(deps(), {
      campaignId,
      reference: 'secure store W9/idea/1',
      actor: 'admin:test',
    });
    expect(submitted.status).toBe('recorded');

    // While under review, the Founder owes nothing (§22.3).
    const underReview = await readFounderPaymentStatus(h.db, { campaignId });
    expect(underReview!.w9.state).toBe('submitted');
    expect(underReview!.w9.action).toBe('No action needed');

    const returned = await decideW9(deps(), {
      campaignId,
      decision: 'resubmission_required',
      note: 'signature page missing',
      actor: 'admin:test',
    });
    expect(returned.status).toBe('returned');
    expect(
      emailsMatching((t) => t.includes('resubmitted') && t.includes('signature page missing')),
    ).toBe(1);

    await verifyW9(campaignId);
    const record = await w9Row(campaignId);
    expect(record!.status).toBe('verified');

    // Verified is terminal — even a hand-written UPDATE cannot un-verify it.
    await expectDbRefusal(
      h.db
        .update(founderW9Records)
        .set({ status: 'requested' })
        .where(eq(founderW9Records.id, record!.id)),
      /verified W-9 record is immutable/,
    );
  });

  it('refuses to compute the share while Creator earnings are unfinalized (§24.4)', async () => {
    const refused = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'checks recorded',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(refused.status).toBe('creator_earnings_not_finalized');

    const decided = await recordCompletionDecision(closeDeps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'all deliverables verified in the founder-payments suite',
      actor: 'admin:test',
    });
    expect(decided.status).toBe('recorded');
    const finalized = await finalizeCreatorEarnings(closeDeps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });
    expect(finalized.status).toBe('finalized');
  });

  it('§33.8.10 — one 100% Day 3 single payment, and nothing before Day 3', async () => {
    const early = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'checks recorded',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
    });
    expect(early.status).toBe('before_scheduled_day');

    // §22.3 Idea: the recorded checks and named approval are requirements.
    const noChecks = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(noChecks.status).toBe('checks_missing');

    const created = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'payment and risk checks performed against §31.7 signals',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    // The §22.3 formula, read from the ledger: 7500 − 375 − 1000 = 6125.
    expect(created.payment.eligibleShareCents).toBe(EXPECTED_SHARE);
    expect(created.payment.amountCents).toBe(EXPECTED_SHARE);
    expect(created.payment.percent).toBe(100);

    // The exact share lands in founder_net_cents (§26.6's payable line).
    expect((await campaignRow(campaignId)).founderNetCents).toBe(EXPECTED_SHARE);

    // A second create is the same object; a second row is refused by index.
    const again = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'x',
      approvedBy: 'y',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(again.status).toBe('already_exists');
    await expectDbRefusal(
      h.db.insert(founderPayments).values({
        campaignId,
        kind: 'single_payment',
        status: 'eligible',
        w9RecordId: (await w9Row(campaignId))!.id,
        eligibleShareCents: EXPECTED_SHARE,
        percent: 100,
        amountCents: EXPECTED_SHARE,
        campaignCloseAt: created.payment.campaignCloseAt,
        scheduledDay: created.payment.scheduledDay,
        dueAt: created.payment.dueAt,
        paymentChecksNote: 'x',
        approvedBy: 'x',
        createdBy: 'admin:test',
      }),
      /duplicate key|founder_payments_campaign_kind/,
    );

    // An Idea campaign cannot hold a first payment by any path.
    const wrongKind = await createFounderPayment(deps(), {
      campaignId,
      kind: 'first_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(wrongKind.status).toBe('wrong_model');
    await expectDbRefusal(
      h.db.insert(founderPayments).values({
        campaignId,
        kind: 'first_payment',
        status: 'eligible',
        w9RecordId: (await w9Row(campaignId))!.id,
        eligibleShareCents: EXPECTED_SHARE,
        percent: 40,
        amountCents: (EXPECTED_SHARE * 40n) / 100n,
        campaignCloseAt: created.payment.campaignCloseAt,
        scheduledDay: 3,
        dueAt: created.payment.dueAt,
        createdBy: 'admin:test',
      }),
      /Idea campaign has exactly one single payment/,
    );
  });

  it('releases once, moves the lifecycle, writes both §23.3 flags, one email', async () => {
    const released = await releaseFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(released.status).toBe('released');
    expect((await campaignRow(campaignId)).status).toBe('single_payment_released');

    const flags = await h.db
      .select()
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, campaignId));
    const eligible = flags.filter((f) => f.flag === 'founder_payment_eligible');
    const paid = flags.filter((f) => f.flag === 'founder_payment_paid');
    expect(eligible).toHaveLength(1);
    expect(paid).toHaveLength(1);
    expect(eligible[0]!.amountCents).toBe(EXPECTED_SHARE);
    expect(paid[0]!.amountCents).toBe(EXPECTED_SHARE);

    const again = await releaseFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(again.status).toBe('already_released');
    expect(emailsMatching((t) => t.includes('Single Founder payment released'))).toBe(1);

    // A released payment is immutable, even for a support script.
    const [payment] = await paymentRows(campaignId);
    await expectDbRefusal(
      h.db
        .update(founderPayments)
        .set({ amountCents: 1n })
        .where(eq(founderPayments.id, payment!.id)),
      /released Founder payment is immutable|immutable/,
    );
  });

  it('§33.8.10 — Day 14 creates no second payment object', async () => {
    const before = await paymentRows(campaignId);
    expect(before).toHaveLength(1);
    await sweepFounderPaymentSchedule(deps(), AFTER_DAY_14());
    const after = await paymentRows(campaignId);
    expect(after).toHaveLength(1);
    expect(after.filter((p) => p.kind === 'single_payment')).toHaveLength(1);
  });

  it('§33.8.13 — the Founder read, the Admin read, §26.6, and the email agree', async () => {
    const founderCookie = await signInPlain(h, founderEmail);
    const founderRes = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/payments`)
      .set('cookie', founderCookie);
    expect(founderRes.status).toBe(200);
    const founderView = founderRes.body.payments;

    const adminRes = await request(h.app)
      .get(`/api/admin/close/${campaignId}/founder-payments`)
      .set('cookie', admin.cookie);
    expect(adminRes.status).toBe(200);
    const adminView = adminRes.body.status;

    // One resolver, many renderers: identical amounts, statuses, reasons.
    expect(founderView.payments).toEqual(adminView.payments);
    expect(founderView.eligibleShare).toEqual(adminView.eligibleShare);
    expect(founderView.w9).toEqual(adminView.w9);
    expect(founderView.eligibleShare.amountCents).toBe(EXPECTED_SHARE.toString());
    expect(founderView.payments[0].status).toBe('released');

    // §33.8.13's "one source, many renderers" — the §26.6 money-control line
    // was a third renderer of `readFounderPaymentStatus` and went with the
    // Admin money panel. The Founder and Admin views above are the two that
    // remain, and they are compared against each other and the stored amount.

    // The release email carried the identical amount.
    expect(
      emailsMatching(
        (t) =>
          t.includes('Single Founder payment released') &&
          t.includes(`US$${formatCents(EXPECTED_SHARE)}`),
      ),
    ).toBe(1);

    // §22.3's six display facts are all answered by the one view.
    expect(founderView.eligibleShare.amountCents).toBeDefined(); // exact amount affected
    expect(founderView.w9.state).toBe('verified'); // submitted/verified state
    expect(founderView.w9.action).toBe('No action needed');
    expect(founderView.payments[0].blockers).toEqual([]); // nothing blocked now
    expect(founderView.eligibleShare.note).toContain('Sales tax is separate');
  });
});

/* ── The Product campaign: 40%/60% and the early release ────────────────────── */

describe('§33.8.11 / §33.8.12 — Product 40%/60% and evidence-gated early release', () => {
  let campaignId: string;
  let founderEmail: string;
  /** §22.3's formula over the capture ledger — no Creator attribution here,
      so the compensation term is zero and the Stripe-fee term is whatever the
      ledger recorded at capture (§24.5). */
  let SHARE = 0n;
  let FIRST = 0n;
  let REMAINING = 0n;

  beforeAll(async () => {
    const seeded = await seedLiveCampaign('product', { type: 'pre_launch' });
    campaignId = seeded.campaignId;
    founderEmail = seeded.founderEmail;
    await placePreorder(campaignId);
    await placePreorder(campaignId);
    await placePreorder(campaignId);
    await closeCampaign(campaignId);

    const c = await campaignRow(campaignId);
    SHARE = c.rewardSubtotalCapturedCents - c.proovdFeeCents - c.stripeFeeCents;
    FIRST = (SHARE * 40n) / 100n;
    REMAINING = SHARE - FIRST;
  }, 120_000);

  it('§33.8.9 — the W-9 blocks the Product payments too', async () => {
    const refused = await createFounderPayment(deps(), {
      campaignId,
      kind: 'first_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(refused.status).toBe('w9_not_verified');
  });

  it('the Founder can ask for early release; one pending request at a time', async () => {
    const cookie = await signInPlain(h, founderEmail);
    const first = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/early-remaining-request`)
      .set('cookie', cookie)
      .send({ message: 'All backers already have their access codes and the announcement email went out.' });
    expect(first.status).toBe(201);
    const second = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/early-remaining-request`)
      .set('cookie', cookie)
      .send({ message: 'asking again' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_pending');
    expect(emailsMatching((t) => t.includes('early remaining payment request was received'))).toBe(1);
  });

  it('creates 40% at Day 3 after retry and W-9, never before', async () => {
    await verifyW9(campaignId);

    const early = await createFounderPayment(deps(), {
      campaignId,
      kind: 'first_payment',
      actor: 'admin:test',
    });
    expect(early.status).toBe('before_scheduled_day');

    // The remaining payment cannot even be attempted before the first exists.
    const remainingFirst = await createFounderPayment(deps(), {
      campaignId,
      kind: 'remaining_payment',
      actor: 'admin:test',
      now: AFTER_DAY_14(),
    });
    expect(remainingFirst.status).toBe('not_creatable');

    const created = await createFounderPayment(deps(), {
      campaignId,
      kind: 'first_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    expect(created.payment.eligibleShareCents).toBe(SHARE);
    expect(created.payment.amountCents).toBe(FIRST);
    expect(created.payment.percent).toBe(40);

    const released = await releaseFounderPayment(deps(), {
      campaignId,
      kind: 'first_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(released.status).toBe('released');
    expect((await campaignRow(campaignId)).status).toBe('first_payment_released');
    expect(emailsMatching((t) => t.includes('First payment released'))).toBe(1);
  });

  it('§33.8.11 — early release is gated four ways, each refusing by name', async () => {
    // 1. Disabled by default (§6): nothing can be approved.
    const disabled = await decideEarlyRemaining(deps(), {
      campaignId,
      decision: 'approved',
      reason: 'looks ready',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(disabled.status).toBe('early_release_disabled');

    const enabled = await updateSetting(h.db, {
      key: 'product_early_remaining_payment_enabled',
      value: 'true',
      actor: `user:${admin.id}`,
      reason: 'founder-payments suite: exercising the §22.3 early path',
    });
    expect(enabled.ok).toBe(true);

    // 2. Not before Day 3 — even with the control on.
    const beforeDay3 = await decideEarlyRemaining(deps(), {
      campaignId,
      decision: 'approved',
      reason: 'looks ready',
      actor: 'admin:test',
    });
    expect(beforeDay3.status).toBe('before_day_3');

    // 3. Not without evidence at all.
    const noEvidence = await decideEarlyRemaining(deps(), {
      campaignId,
      decision: 'approved',
      reason: 'looks ready',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(noEvidence.status).toBe('evidence_incomplete');
    if (noEvidence.status === 'evidence_incomplete') {
      expect(noEvidence.missing).toEqual([
        'delivery_available',
        'communication_sent',
        'tax_payment_complete',
        'no_immediate_risk',
      ]);
    }

    // 4. Internal readiness alone is insufficient: delivery not actually
    // available to affected Backers refuses, whatever the detail says.
    const partial = await recordEarlyReleaseEvidence(deps(), {
      campaignId,
      facts: {
        delivery_available: {
          recorded: false,
          detail: 'staging environment is ready internally; Backer access not yet live',
        },
        communication_sent: { recorded: true, detail: 'announcement email sent 2026-08-03' },
        tax_payment_complete: { recorded: true, detail: 'tax calculation and charges reconciled' },
        no_immediate_risk: { recorded: true, detail: 'no §31.7 blocking signal at review' },
      },
      actor: 'admin:test',
    });
    expect(partial.status).toBe('recorded');
    const stillMissing = await decideEarlyRemaining(deps(), {
      campaignId,
      decision: 'approved',
      reason: 'internal readiness recorded',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(stillMissing.status).toBe('evidence_incomplete');
    if (stillMissing.status === 'evidence_incomplete') {
      expect(stillMissing.missing).toEqual(['delivery_available']);
    }

    // A blank detail is refused outright — an answer needs its evidence.
    const blank = await recordEarlyReleaseEvidence(deps(), {
      campaignId,
      facts: {
        delivery_available: { recorded: true, detail: '   ' },
        communication_sent: { recorded: true, detail: 'x' },
        tax_payment_complete: { recorded: true, detail: 'x' },
        no_immediate_risk: { recorded: true, detail: 'x' },
      },
      actor: 'admin:test',
    });
    expect(blank.status).toBe('detail_missing');

    // Complete evidence → the approval stands, with its reason recorded.
    const complete = await recordEarlyReleaseEvidence(deps(), {
      campaignId,
      facts: {
        delivery_available: {
          recorded: true,
          detail: 'every captured Backer redeemed or received a working access code; spot-checked 3',
        },
        communication_sent: { recorded: true, detail: 'announcement email sent 2026-08-03' },
        tax_payment_complete: { recorded: true, detail: 'tax calculation and charges reconciled' },
        no_immediate_risk: { recorded: true, detail: 'no §31.7 blocking signal at review' },
      },
      actor: 'admin:test',
    });
    expect(complete.status).toBe('recorded');
    if (complete.status === 'recorded') expect(complete.missing).toEqual([]);

    const approved = await decideEarlyRemaining(deps(), {
      campaignId,
      decision: 'approved',
      reason: 'delivery verified with affected Backers; all four §22.3 proofs recorded',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(approved.status).toBe('approved');
    expect(
      emailsMatching(
        (t) =>
          t.includes('early remaining payment request was approved') &&
          t.includes('does not skip the Day 14 status review'),
      ),
    ).toBe(1);
  });

  it('creates the remaining payment early — never before Day 3 — as the exact remainder', async () => {
    // The named Day 3 refusal on the create path itself (§33.8.11).
    const tooEarly = await createFounderPayment(deps(), {
      campaignId,
      kind: 'remaining_payment',
      actor: 'admin:test',
    });
    expect(tooEarly.status).toBe('before_day_3');

    const created = await createFounderPayment(deps(), {
      campaignId,
      kind: 'remaining_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    expect(created.payment.releasedEarly).toBe(true);
    expect(created.payment.earlyEvidenceId).not.toBeNull();
    expect(created.payment.amountCents).toBe(REMAINING);
    // first + remaining = the eligible share, to the cent.
    expect(FIRST + created.payment.amountCents).toBe(SHARE);

    // The database refuses a remainder that is not the remainder.
    await expectDbRefusal(
      h.db.insert(founderPayments).values({
        campaignId,
        kind: 'remaining_payment',
        status: 'eligible',
        w9RecordId: (await w9Row(campaignId))!.id,
        eligibleShareCents: SHARE,
        percent: 60,
        amountCents: REMAINING - 1n,
        campaignCloseAt: created.payment.campaignCloseAt,
        scheduledDay: created.payment.scheduledDay,
        dueAt: created.payment.dueAt,
        createdBy: 'admin:test',
      }),
      /exact remainder|duplicate key/,
    );
  });

  it('§33.8.12 — early release does not skip Day 14', async () => {
    const released = await releaseFounderPayment(deps(), {
      campaignId,
      kind: 'remaining_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(released.status).toBe('released');
    expect((await campaignRow(campaignId)).status).toBe('remaining_payment_released');

    // The release notice carries the §33.8.12 sentence.
    expect(
      emailsMatching(
        (t) =>
          t.includes('Remaining payment released') &&
          t.includes('does not skip the Day 14 status review'),
      ),
    ).toBe(1);

    // The status still shows the Day 14 review as due — released early is not
    // reviewed early.
    const view = await readFounderPaymentStatus(h.db, { campaignId });
    expect(view!.day14).not.toBeNull();
    expect(view!.day14!.line).toContain('does not skip the Day 14 status review');

    // §23.1: the machine keeps the review reachable after the early release.
    expect(campaignMachine.canTransition('remaining_payment_released', 'day_14_review')).toBe(true);

    // Nothing recorded a Day 14 review as passed — the review is Phase 21's,
    // and no record of it exists to have been satisfied.
    expect((await campaignRow(campaignId)).status).not.toBe('fulfilled');
  });

  it('never uses a banned money-status word on any §22.3 surface', async () => {
    const cookie = await signInPlain(h, founderEmail);
    const founderRes = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/payments`)
      .set('cookie', cookie);
    const adminRes = await request(h.app)
      .get(`/api/admin/close/${campaignId}/founder-payments`)
      .set('cookie', admin.cookie);
    const payloads = `${JSON.stringify(founderRes.body)}\n${JSON.stringify(adminRes.body)}`.toLowerCase();
    for (const banned of BANNED_MONEY_STATUS_WORDS) {
      expect(payloads).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    // And the §3.2 vocabulary stays out of every Phase 19b source file.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      '../close/founder-payments.ts',
      '../close/founder-payments-logic.ts',
      '../close/founder-payment-notifications.ts',
      '../notifications/templates/founder-payments.tsx',
      '../db/schema/founder-payments.ts',
      '../db/migrations/0031_founder_payments.sql',
    ];
    for (const file of files) {
      const source = (await readFile(path.resolve(here, file), 'utf8')).toLowerCase();
      for (const banned of [...BANNED_MONEY_STATUS_WORDS, 'escrow', 'custody', 'tranche']) {
        expect(source, `${file} contains "${banned}"`).not.toMatch(new RegExp(`\\b${banned}\\b`));
      }
    }
  });
});

/* ── The schedule sweep and the §27.6 internal notices ──────────────────────── */

describe('the Day 3 sweep — captured_pending_w9, the block notice, and §27.6', () => {
  let campaignId: string;
  let creator: { associationId: string; trackingLinkId: string };

  beforeAll(async () => {
    const seeded = await seedLiveCampaign('sweep', { type: 'pre_build', orderThreshold: 1 });
    campaignId = seeded.campaignId;
    creator = await seedCreator(campaignId, 'sweep-a', 20);
    const r1 = await placePreorder(campaignId);
    await attributeTo(r1, creator);
    await closeCampaign(campaignId);
  }, 120_000);

  it('moves the campaign, sends the block with the exact amount, and both internal notices — once', async () => {
    await sweepFounderPaymentSchedule(deps(), AFTER_DAY_3());
    await sweepFounderPaymentSchedule(deps(), AFTER_DAY_3());

    expect((await campaignRow(campaignId)).status).toBe('captured_pending_w9');
    const moves = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(
        and(
          eq(campaignStatusHistory.campaignId, campaignId),
          eq(campaignStatusHistory.toStatus, 'captured_pending_w9'),
        ),
      );
    expect(moves).toHaveLength(1);

    expect(
      emailsMatching(
        (t) => t.includes('W-9 required for your payment') && t.includes('Campaign sweep'),
      ),
    ).toBe(1);
    expect(
      emailsMatching((t) => t.includes(`Money decisions due — campaign ${campaignId}`)),
    ).toBe(1);
    expect(
      emailsMatching((t) => t.includes(`Deliverable verification due — campaign ${campaignId}`)),
    ).toBe(1);
  });

  it('verifying the W-9 opens the path: create and release from captured_pending_w9', async () => {
    await verifyW9(campaignId);

    const notFinalized = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'checks recorded',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(notFinalized.status).toBe('creator_earnings_not_finalized');

    await recordCompletionDecision(closeDeps(), {
      associationId: creator.associationId,
      outcome: 'complete_verified',
      deliverablesNote: 'verified in the sweep flow',
      actor: 'admin:test',
    });
    await finalizeCreatorEarnings(closeDeps(), {
      associationId: creator.associationId,
      actor: 'admin:test',
    });

    const created = await createFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      checksNote: 'checks recorded',
      approvedBy: 'admin:reviewer',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(created.status).toBe('created');

    const released = await releaseFounderPayment(deps(), {
      campaignId,
      kind: 'single_payment',
      actor: 'admin:test',
      now: AFTER_DAY_3(),
    });
    expect(released.status).toBe('released');
    expect((await campaignRow(campaignId)).status).toBe('single_payment_released');
  });
});

/* ── The refusal surfaces the Spec names ────────────────────────────────────── */

describe('named refusals and honest not-applicable states', () => {
  it('a campaign that captured nothing gets no W-9 request and no payment', async () => {
    const seeded = await seedLiveCampaign('zero', { type: 'pre_build', orderThreshold: 5 });
    // One backer against a threshold of five: the miss path charges nothing.
    await placePreorder(seeded.campaignId);
    await h.db
      .update(campaigns)
      .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
      .where(eq(campaigns.id, seeded.campaignId));
    const summary = await runCloseBatch(closeDeps(), {
      campaignId: seeded.campaignId,
      actor: 'admin:test',
    });
    expect(summary.status).toBe('complete');
    expect((await campaignRow(seeded.campaignId)).status).toBe('ended_no_charge');

    expect(await w9Row(seeded.campaignId)).toBeNull();
    const requested = await requestFounderW9(deps(), {
      campaignId: seeded.campaignId,
      actor: 'admin:test',
    });
    expect(['nothing_captured', 'not_closed']).toContain(requested.status);

    const view = await readFounderPaymentStatus(h.db, { campaignId: seeded.campaignId });
    expect(view!.applicable).toBe(false);
    expect(view!.notApplicableReason).toContain('without any charge');
  }, 120_000);

  it('a pre-close campaign reports the honest waiting state, not a zero', async () => {
    const seeded = await seedLiveCampaign('live', { type: 'pre_launch' });
    const view = await readFounderPaymentStatus(h.db, { campaignId: seeded.campaignId });
    expect(view!.applicable).toBe(false);
    expect(view!.notApplicableReason).toContain('after the campaign closes');
  }, 120_000);
});
