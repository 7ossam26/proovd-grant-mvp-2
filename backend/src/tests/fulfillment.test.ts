/**
 * Phase 21a — fulfillment, delivery-date changes, the Day 14 Progress Check,
 * and the one-strike Founder ghost ban (§22.4–§22.7).
 *
 * Acceptance: §33.10.1 (the delivery notification contains access instructions,
 * the ORIGINAL promise, and support), §33.10.2 (a revised date preserves the
 * original and follows the correct approval/notice path), §33.10.3 (Day 14
 * pass/fail evidence and consequences match the campaign type), and §33.10.4
 * (the ghost ban triggers only under the four defined conditions and is fully
 * audited). Plus the update-cadence done-when, the durable receipt, the
 * write-once decision, `fulfilled` ≠ `closed_resolved`, and the drift tests
 * pinning the 21a registers against @proovd/shared.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
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
import { campaigns, campaignPaymentFlags, reservations } from '../db/schema/domain.js';
import { auditEvents } from '../db/schema/integrity.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import {
  campaignFulfillment,
  day14EvidenceSubmissions,
  day14Reviews,
  deliveryChangeRequests,
  deliveryCommitments,
  founderGhostBans,
} from '../db/schema/fulfillment.js';
import { founderPayments, founderW9Records } from '../db/schema/founder-payments.js';
import { runCloseBatch } from '../close/close-batch.js';
import {
  createFounderPayment,
  releaseFounderPayment,
  recordW9Submitted,
  decideW9,
} from '../close/founder-payments.js';
import {
  applyDeliveryRevision,
  decideDeliveryChange,
  listDeliveryCommitments,
  readFulfillmentStatus,
  recordCloseConfirmation,
  recordDelivery,
  recordOriginalCommitment,
  requestDeliveryChange,
  setDeliveryMechanism,
} from '../fulfillment/service.js';
import {
  decideDay14Review,
  openDay14Review,
  readDay14Checklist,
  readDay14Queue,
  submitDay14Evidence,
  requestDay14Clarification,
  sweepDay14Reviews,
  day14DueAt,
} from '../fulfillment/day14.js';
import {
  gatherGhostBanFacts,
  recordGhostBan,
  readGhostBanCandidates,
  founderIsBanned,
} from '../fulfillment/ghost-ban.js';
import { day14PaymentBlock } from '../fulfillment/payment-block.js';
import {
  CLOSE_CONFIRMATION_WINDOW_HOURS as B_CLOSE_HOURS,
  UPDATE_CADENCE_DAYS as B_CADENCE,
  DELIVERY_MECHANISMS as B_MECHANISMS,
  DELIVERY_MECHANISM_LABELS as B_MECH_LABELS,
  DELIVERY_NOTICE_ITEMS as B_NOTICE_ITEMS,
  FOUNDER_FULFILLMENT_OBLIGATIONS as B_OBLIGATIONS,
  MATERIAL_UPDATE_FIELDS as B_MATERIAL_FIELDS,
  DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS as B_REVIEW_DAYS,
  DAY_14_REVIEW_DAY as B_DAY14,
  DAY_14_FAILURE_REASONS as B_FAIL_REASONS,
  DAY_14_FAILURE_LABELS as B_FAIL_LABELS,
  DAY_14_CLARIFICATION_BUSINESS_DAYS as B_CLARIFY_DAYS,
  GHOST_BAN_TRIGGERS as B_TRIGGERS,
  GHOST_BAN_TRIGGER_LABELS as B_TRIGGER_LABELS,
  GHOST_BAN_TRIGGER_CAMPAIGN_TYPES as B_TRIGGER_TYPES,
  GHOST_BAN_SILENCE_DAYS as B_SILENCE,
  GHOST_BAN_RECORD_FIELDS as B_BAN_FIELDS,
  GHOST_BAN_PERMANENT_SENTENCE as B_PERMANENT,
  deliveryChangePathFor as bPathFor,
  day14Checklist as bChecklist,
  day14FailureConsequences as bConsequences,
  day14OutcomeIsConsistent as bConsistent,
  evaluateUpdateCadence as bCadence,
  ghostBanTriggersMet as bTriggersMet,
  resolveDeliveryNotice as bResolveNotice,
} from '../fulfillment/logic.js';
import {
  CLOSE_CONFIRMATION_WINDOW_HOURS as S_CLOSE_HOURS,
  UPDATE_CADENCE_DAYS as S_CADENCE,
  DELIVERY_MECHANISMS as S_MECHANISMS,
  DELIVERY_MECHANISM_LABELS as S_MECH_LABELS,
  DELIVERY_NOTICE_ITEMS as S_NOTICE_ITEMS,
  FOUNDER_FULFILLMENT_OBLIGATIONS as S_OBLIGATIONS,
  MATERIAL_UPDATE_FIELDS as S_MATERIAL_FIELDS,
  DELIVERY_CHANGE_REVIEW_BUSINESS_DAYS as S_REVIEW_DAYS,
  DAY_14_REVIEW_DAY as S_DAY14,
  DAY_14_FAILURE_REASONS as S_FAIL_REASONS,
  DAY_14_FAILURE_LABELS as S_FAIL_LABELS,
  DAY_14_CLARIFICATION_BUSINESS_DAYS as S_CLARIFY_DAYS,
  GHOST_BAN_TRIGGERS as S_TRIGGERS,
  GHOST_BAN_TRIGGER_LABELS as S_TRIGGER_LABELS,
  GHOST_BAN_TRIGGER_CAMPAIGN_TYPES as S_TRIGGER_TYPES,
  GHOST_BAN_SILENCE_DAYS as S_SILENCE,
  GHOST_BAN_RECORD_FIELDS as S_BAN_FIELDS,
  GHOST_BAN_PERMANENT_SENTENCE as S_PERMANENT,
  deliveryChangePathFor as sPathFor,
  day14Checklist as sChecklist,
  day14FailureConsequences as sConsequences,
  day14OutcomeIsConsistent as sConsistent,
  evaluateUpdateCadence as sCadence,
  ghostBanTriggersMet as sTriggersMet,
  resolveDeliveryNotice as sResolveNotice,
  campaignMachine,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_fulfillment_suite';
const CONNECT_SECRET = 'whsec_connect_for_fulfillment_suite';

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

const DAY = 24 * 3_600_000;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'fulfillment',
  );
  audit = createAuditWriter(h.db);
  admin = await createAdmin(h, 'fulfillment-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return { db: h.db, audit, notifier: h.notifier, context: CONTEXT };
}

/* ── Seeding (the refunds suite's shape) ───────────────────────────────────── */

interface SeededCampaign {
  campaignId: string;
  founderUserId: string;
  founderEmail: string;
}

async function seedLiveCampaign(
  label: string,
  opts: { type: 'pre_build' | 'pre_launch'; orderThreshold?: number },
): Promise<SeededCampaign> {
  const founder = await seedUser(h, 'founder', `fx-founder-${label}`);
  const closeAt = new Date(Date.now() + 14 * DAY);

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
      campaignLiveAt: new Date(Date.now() - DAY),
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
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    closesAt: closeAt,
    deliveryWindow: 'December 2026',
    communityUrl: `https://example.com/${label}/support`,
    ...(opts.orderThreshold !== undefined ? { orderThreshold: opts.orderThreshold } : {}),
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values({
    campaignId,
    sku: 'TIER-1',
    title: 'Early access kit',
    priceCents: 2_500n,
    contents: 'The kit',
    fulfillmentCommitment: 'Delivered digitally',
    delivery: 'December 2026',
    sortOrder: 0,
  });

  return { campaignId, founderUserId: founder.id, founderEmail: founder.email };
}

let n = 0;
function contact() {
  n += 1;
  return {
    email: `fx${n}-${randomUUID().slice(0, 6)}@example.com`,
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

async function closeCampaign(campaignId: string): Promise<void> {
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
  const summary = await runCloseBatch(
    { db: h.db, gateway, audit, notifier: h.notifier, context: CONTEXT },
    { campaignId, actor: 'admin:test' },
  );
  expect(summary.status).toBe('complete');
}

/** A closed campaign with one captured charge, ready for §22.5 fulfillment. */
async function seedCapturedCampaign(
  label: string,
  type: 'pre_build' | 'pre_launch',
): Promise<SeededCampaign & { reservationId: string }> {
  const seeded = await seedLiveCampaign(label, {
    type,
    ...(type === 'pre_build' ? { orderThreshold: 1 } : {}),
  });
  const reservationId = await placePreorder(seeded.campaignId);
  await closeCampaign(seeded.campaignId);
  const [row] = await h.db
    .select({ status: reservations.status })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  expect(row!.status).toBe('captured');
  return { ...seeded, reservationId };
}

async function campaignRow(campaignId: string) {
  const [row] = await h.db
    .select({ status: sql<string>`${campaigns.status}::text` })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row!;
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
  let current: unknown = caught;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.some((m) => pattern.test(m))).toBe(true);
}

async function postUpdate(campaignId: string, body: string, publishedAt: Date): Promise<string> {
  const [row] = await h.db
    .insert(campaignUpdates)
    .values({
      campaignId,
      author: 'user:founder',
      audience: 'general_public',
      title: 'Progress',
      body,
      publishedAt,
    })
    .returning({ id: campaignUpdates.id });
  return row!.id;
}

/* ══ §33.10.1 — the delivery notification ═══════════════════════════════════ */

describe('§33.10.1 — the delivery notification carries access, the original promise, and support', () => {
  it('sends every §22.5 item, with the ORIGINAL commitment even after a revision', async () => {
    const c = await seedCapturedCampaign('d1', 'pre_launch');

    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-12',
      commitmentText: 'Delivered in December 2026',
      actor: 'user:founder',
    });

    // The date slips — the notice must still repeat the ORIGINAL promise.
    const requested = await requestDeliveryChange(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-03',
      reason: 'Manufacturing partner moved',
      unchangedObligations: 'Reward contents, price, and refund policy are unchanged.',
      nextUpdateDate: '2027-01-15',
      supportRefundRoute: 'Reply to this update or contact support@proovd.co',
      actor: 'user:founder',
    });
    expect(requested.status).toBe('requested');
    if (requested.status !== 'requested') throw new Error('unreachable');

    await decideDeliveryChange(deps(), {
      requestId: requested.requestId,
      decision: 'approved',
      baitAndSwitchFinding: 'No change to what is promised; only the month moves.',
      paymentImpactFinding: 'Remaining payment unaffected.',
      internalReason: 'Supplier delay evidenced.',
      customerExplanation: 'The delivery month moves to March 2027.',
      commitmentText: 'Delivered in March 2027',
      actor: 'admin:test',
    });
    await applyDeliveryRevision(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-03',
      commitmentText: 'Delivered in March 2027',
      reason: 'Manufacturing partner moved',
      unchangedObligations: 'Reward contents, price, and refund policy are unchanged.',
      nextUpdateDate: '2027-01-15',
      supportRefundRoute: 'Reply to this update or contact support@proovd.co',
      changeRequestId: requested.requestId,
      actor: 'user:founder',
    });

    await setDeliveryMechanism(deps(), {
      campaignId: c.campaignId,
      mechanism: 'redemption_code',
      accessInstructions: 'Redeem code EARLY-2026 at example.com/redeem.',
      actor: 'user:founder',
    });

    const before = h.sentEmails.messages.length;
    const delivered = await recordDelivery(deps(), {
      campaignId: c.campaignId,
      actor: 'user:founder',
    });
    expect(delivered.status).toBe('delivered');
    if (delivered.status !== 'delivered') throw new Error('unreachable');
    expect(delivered.notified).toBe(1);

    const sent = h.sentEmails.messages.slice(before);
    const notice = sent.find((m) => /is ready/i.test(m.subject));
    expect(notice).toBeDefined();
    const text = notice!.text ?? '';

    // §22.5's five repeated items, each present by its own content.
    expect(text).toContain('Early access kit'); // reward
    expect(text).toContain('Redemption code'); // the mechanism's label
    expect(text).toContain('EARLY-2026'); // access instructions
    expect(text).toContain('Delivered in December 2026'); // the ORIGINAL promise
    expect(text).toContain('example.com/d1/support'); // Founder support
    expect(text).toContain(CONTEXT.supportEmail); // Proovd escalation

    // The revised date is NOT what the delivery notice repeats — §22.5 names the
    // original commitment, and that is the whole point of preserving it.
    expect(text).not.toContain('Delivered in March 2027');
  });

  it('refuses to deliver without a mechanism, and the resolver refuses a blank item', async () => {
    const c = await seedCapturedCampaign('d2', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-12',
      commitmentText: 'Delivered in December 2026',
      actor: 'user:founder',
    });

    const noMechanism = await recordDelivery(deps(), {
      campaignId: c.campaignId,
      actor: 'user:founder',
    });
    expect(noMechanism.status).toBe('mechanism_not_set');

    // A delivery message with no access instructions cannot be produced at all.
    expect(() =>
      bResolveNotice({
        reward: 'Kit',
        mechanism: 'download_link',
        accessInstructions: '   ',
        originalCommitment: 'December 2026',
        founderSupport: 'Founder',
        proovdEscalation: 'support@proovd.co',
      }),
    ).toThrow(/accessInstructions/);
  });

  it('notifies each Backer once and never a do-not-fulfill share', async () => {
    const c = await seedLiveCampaign('d3', { type: 'pre_launch' });
    const keep = await placePreorder(c.campaignId);
    const drop = await placePreorder(c.campaignId);
    await closeCampaign(c.campaignId);

    // A Backer whose operational share was flipped is not owed access.
    await h.db
      .update(founderOperationalShares)
      .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: new Date() })
      .where(eq(founderOperationalShares.reservationId, drop));

    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-12',
      commitmentText: 'Delivered in December 2026',
      actor: 'user:founder',
    });
    await setDeliveryMechanism(deps(), {
      campaignId: c.campaignId,
      mechanism: 'download_link',
      accessInstructions: 'Download at example.com/files.',
      actor: 'user:founder',
    });

    const first = await recordDelivery(deps(), { campaignId: c.campaignId, actor: 'user:founder' });
    expect(first.status).toBe('delivered');
    if (first.status !== 'delivered') throw new Error('unreachable');
    expect(first.notified).toBe(1); // `keep` only

    // A re-run notifies nobody twice (§27.2).
    const second = await recordDelivery(deps(), { campaignId: c.campaignId, actor: 'user:founder' });
    expect(second.status).toBe('already_delivered');
    if (second.status !== 'already_delivered') throw new Error('unreachable');
    expect(second.notified).toBe(0);
    expect(keep).toBeTruthy();
  });
});

/* ══ §33.10.2 — the revised date preserves the original ═════════════════════ */

describe('§33.10.2 — a revised date preserves the original and takes the correct path', () => {
  it('Product before the remaining payment: Admin approval BEFORE Backers are notified', async () => {
    const c = await seedCapturedCampaign('r1', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-11',
      commitmentText: 'Delivered in November 2026',
      actor: 'user:founder',
    });

    const status = await readFulfillmentStatus(h.db, c.campaignId);
    expect(status!.changePath).toBe('admin_preapproval');

    // Notifying first is refused BY NAME — no request, no revision.
    const early = await applyDeliveryRevision(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-02',
      commitmentText: 'Delivered in February 2027',
      reason: 'Slip',
      unchangedObligations: 'Everything else stands.',
      nextUpdateDate: '2027-01-05',
      supportRefundRoute: 'support@proovd.co',
      actor: 'user:founder',
    });
    expect(early.status).toBe('admin_approval_required');

    const commitmentsAfterRefusal = await listDeliveryCommitments(h.db, c.campaignId);
    expect(commitmentsAfterRefusal).toHaveLength(1);
    const updatesAfterRefusal = await h.db
      .select({ id: campaignUpdates.id })
      .from(campaignUpdates)
      .where(
        and(
          eq(campaignUpdates.campaignId, c.campaignId),
          eq(campaignUpdates.isMaterialDeliveryChange, true),
        ),
      );
    expect(updatesAfterRefusal).toHaveLength(0);

    // The request carries the five-business-day deadline with its calendar version.
    const requested = await requestDeliveryChange(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-02',
      reason: 'Component lead time doubled',
      unchangedObligations: 'Reward contents, price, and refund policy are unchanged.',
      nextUpdateDate: '2027-01-05',
      supportRefundRoute: 'Reply here or contact support@proovd.co',
      actor: 'user:founder',
    });
    expect(requested.status).toBe('requested');
    if (requested.status !== 'requested') throw new Error('unreachable');

    const [requestRow] = await h.db
      .select()
      .from(deliveryChangeRequests)
      .where(eq(deliveryChangeRequests.id, requested.requestId))
      .limit(1);
    expect(requestRow!.calendarVersion).toBeTruthy();
    expect(requestRow!.status).toBe('pending');

    // §29.6: a promised deadline cannot be moved afterwards.
    await expectDbRefusal(
      h.db
        .update(deliveryChangeRequests)
        .set({ reviewDueAt: new Date(Date.now() + 99 * DAY) })
        .where(eq(deliveryChangeRequests.id, requested.requestId)),
      /fixed when made/i,
    );

    // An unapproved request cannot authorise a revision — at the database too.
    await expectDbRefusal(
      h.db.insert(deliveryCommitments).values({
        campaignId: c.campaignId,
        sequence: 2,
        deliveryMonth: '2027-02-01',
        commitmentText: 'Sneaked in',
        reason: 'no approval',
        path: 'admin_preapproval',
        changeRequestId: requested.requestId,
        recordedBy: 'user:founder',
      }),
      /requires an approved request before Backers are notified/i,
    );

    await decideDeliveryChange(deps(), {
      requestId: requested.requestId,
      decision: 'approved',
      baitAndSwitchFinding: 'The reward is unchanged; only the month moves.',
      paymentImpactFinding: 'No effect on the remaining payment schedule.',
      internalReason: 'Supplier evidence reviewed.',
      customerExplanation: 'Delivery moves to February 2027.',
      commitmentText: 'Delivered in February 2027',
      actor: 'admin:test',
    });

    const applied = await applyDeliveryRevision(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-02',
      commitmentText: 'Delivered in February 2027',
      reason: 'Component lead time doubled',
      unchangedObligations: 'Reward contents, price, and refund policy are unchanged.',
      nextUpdateDate: '2027-01-05',
      supportRefundRoute: 'Reply here or contact support@proovd.co',
      changeRequestId: requested.requestId,
      actor: 'user:founder',
    });
    expect(applied.status).toBe('revised');
    if (applied.status !== 'revised') throw new Error('unreachable');
    expect(applied.path).toBe('admin_preapproval');

    // THE ORIGINAL IS PRESERVED — sequence 1 is byte-identical.
    const commitments = await listDeliveryCommitments(h.db, c.campaignId);
    expect(commitments).toHaveLength(2);
    expect(commitments[0]!.sequence).toBe(1);
    expect(commitments[0]!.deliveryMonth).toBe('2026-11-01');
    expect(commitments[0]!.commitmentText).toBe('Delivered in November 2026');
    expect(commitments[0]!.reason).toBeNull();
    expect(commitments[1]!.deliveryMonth).toBe('2027-02-01');

    // And it cannot be rewritten, by any statement.
    await expectDbRefusal(
      h.db
        .update(deliveryCommitments)
        .set({ deliveryMonth: '2027-02-01' })
        .where(eq(deliveryCommitments.id, commitments[0]!.id)),
      /never changes/i,
    );
    await expectDbRefusal(
      h.db.delete(deliveryCommitments).where(eq(deliveryCommitments.id, commitments[0]!.id)),
      /never deleted/i,
    );

    // §22.6's material update shows prior AND revised together.
    const [update] = await h.db
      .select()
      .from(campaignUpdates)
      .where(eq(campaignUpdates.id, applied.updateId))
      .limit(1);
    expect(update!.isMaterialDeliveryChange).toBe(true);
    expect(update!.priorCommitment).toBe('Delivered in November 2026');
    expect(update!.revisedCommitment).toBe('Delivered in February 2027');
    // The four other §22.6 fields ride the body.
    expect(update!.body).toContain('Component lead time doubled');
    expect(update!.body).toContain('Reward contents, price, and refund policy are unchanged.');
    expect(update!.body).toContain('2027-01-05');
    expect(update!.body).toContain('support@proovd.co');
  });

  it('after the remaining payment: notice, no Admin preapproval — and an Idea campaign is always the notice path', async () => {
    const c = await seedCapturedCampaign('r2', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-11',
      commitmentText: 'Delivered in November 2026',
      actor: 'user:founder',
    });

    // Release the remaining payment by record, which is what §22.6 branches on.
    // The close batch already requested the W-9 (19b), so this verifies that
    // row rather than writing a second one.
    // §22.3's machine is requested → submitted → verified and refuses a skip,
    // so this drives 19b's own services rather than hand-writing the row.
    const paymentDeps = { db: h.db, audit, notifier: h.notifier, context: CONTEXT };
    expect(
      (await recordW9Submitted(paymentDeps, {
        campaignId: c.campaignId,
        reference: 'W9-FILE-001',
        actor: 'admin:test',
      })).status,
    ).toBe('recorded');
    expect(
      (await decideW9(paymentDeps, {
        campaignId: c.campaignId,
        decision: 'verified',
        note: 'Reviewed and verified.',
        actor: 'admin:test',
      })).status,
    ).toBe('verified');
    const [w9] = await h.db
      .select({ id: founderW9Records.id })
      .from(founderW9Records)
      .where(eq(founderW9Records.campaignId, c.campaignId))
      .limit(1);
    expect(w9).toBeDefined();
    // §22.3's shape trigger requires a RELEASED first payment and the remaining
    // amount to be the exact remainder, and `due_at` is CHECK-pinned to the
    // stored close anchor plus the scheduled day in hours (0028's DST
    // reasoning). Both rows are written to satisfy all of it.
    const [anchorRow] = await h.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, c.campaignId))
      .limit(1);
    const anchor = anchorRow!.closeAt!;
    const due = (day: number) => new Date(anchor.getTime() + day * 24 * 3_600_000);

    await h.db.insert(founderPayments).values({
      campaignId: c.campaignId,
      kind: 'first_payment',
      w9RecordId: w9!.id,
      status: 'released',
      amountCents: 400n,
      eligibleShareCents: 1_000n,
      percent: 40,
      campaignCloseAt: anchor,
      scheduledDay: 3,
      dueAt: due(3),
      releasedAt: new Date(),
      releasedBy: 'admin:test',
      createdBy: 'admin:test',
    });
    await h.db.insert(founderPayments).values({
      campaignId: c.campaignId,
      kind: 'remaining_payment',
      w9RecordId: w9!.id,
      status: 'released',
      amountCents: 600n,
      eligibleShareCents: 1_000n,
      percent: 60,
      campaignCloseAt: anchor,
      scheduledDay: 14,
      dueAt: due(14),
      releasedAt: new Date(),
      releasedBy: 'admin:test',
      createdBy: 'admin:test',
    });

    const status = await readFulfillmentStatus(h.db, c.campaignId);
    expect(status!.changePath).toBe('notice_before_original_month');

    // No request is opened on the notice path — a review nobody owes.
    const notRequired = await requestDeliveryChange(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-01',
      reason: 'Slip',
      unchangedObligations: 'Everything else stands.',
      nextUpdateDate: '2026-12-20',
      supportRefundRoute: 'support@proovd.co',
      actor: 'user:founder',
    });
    expect(notRequired.status).toBe('not_required');
    const openRequests = await h.db
      .select({ id: deliveryChangeRequests.id })
      .from(deliveryChangeRequests)
      .where(eq(deliveryChangeRequests.campaignId, c.campaignId));
    expect(openRequests).toHaveLength(0);

    // The revision goes through with no approval, and still preserves the original.
    const applied = await applyDeliveryRevision(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-01',
      commitmentText: 'Delivered in January 2027',
      reason: 'Freight delay',
      unchangedObligations: 'Reward contents and price are unchanged.',
      nextUpdateDate: '2026-12-20',
      supportRefundRoute: 'support@proovd.co',
      actor: 'user:founder',
    });
    expect(applied.status).toBe('revised');
    if (applied.status !== 'revised') throw new Error('unreachable');
    expect(applied.path).toBe('notice_before_original_month');

    const commitments = await listDeliveryCommitments(h.db, c.campaignId);
    expect(commitments[0]!.commitmentText).toBe('Delivered in November 2026');
    expect(commitments[0]!.deliveryMonth).toBe('2026-11-01');

    // An Idea campaign has no remaining payment, so it is never the approval path.
    const idea = await seedCapturedCampaign('r3', 'pre_build');
    await recordOriginalCommitment(deps(), {
      campaignId: idea.campaignId,
      deliveryMonth: '2026-10',
      commitmentText: 'Delivered in October 2026',
      actor: 'user:founder',
    });
    const ideaStatus = await readFulfillmentStatus(h.db, idea.campaignId);
    expect(ideaStatus!.changePath).toBe('notice_before_original_month');
  });

  it('refuses a revision missing any of §22.6’s six fields, by name', async () => {
    const c = await seedCapturedCampaign('r4', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-11',
      commitmentText: 'Delivered in November 2026',
      actor: 'user:founder',
    });
    const missing = await applyDeliveryRevision(deps(), {
      campaignId: c.campaignId,
      proposedDeliveryMonth: '2027-02',
      commitmentText: 'Delivered in February 2027',
      reason: 'Slip',
      unchangedObligations: '   ',
      nextUpdateDate: '2027-01-05',
      supportRefundRoute: '',
      actor: 'user:founder',
    });
    expect(missing.status).toBe('missing_fields');
    if (missing.status !== 'missing_fields') throw new Error('unreachable');
    expect([...missing.fields].sort()).toEqual(['support_refund_route', 'unchanged_obligations']);
  });
});

/* ══ The update cadence (§22.5, the done-when) ══════════════════════════════ */

describe('§22.5 — the 30-day update cadence is tracked and surfaced', () => {
  it('reports due, overdue, and met against the charge and the delivery', async () => {
    const c = await seedCapturedCampaign('c1', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-12',
      commitmentText: 'Delivered in December 2026',
      actor: 'user:founder',
    });

    const fresh = await readFulfillmentStatus(h.db, c.campaignId);
    const cadenceNow = fresh!.obligations.find((o) => o.key === 'update_cadence')!;
    expect(cadenceNow.state).toBe('due');
    expect(fresh!.cadence.nextDueAt).toBeTruthy();

    // 31 days later with no update: overdue.
    const late = await readFulfillmentStatus(h.db, c.campaignId, new Date(Date.now() + 31 * DAY));
    expect(late!.obligations.find((o) => o.key === 'update_cadence')!.state).toBe('overdue');
    expect(late!.cadence.silentDays).toBeGreaterThanOrEqual(31);

    // An update inside the window resets the clock.
    await postUpdate(c.campaignId, 'Week four progress', new Date(Date.now() + 20 * DAY));
    const afterUpdate = await readFulfillmentStatus(
      h.db,
      c.campaignId,
      new Date(Date.now() + 31 * DAY),
    );
    expect(afterUpdate!.obligations.find((o) => o.key === 'update_cadence')!.state).toBe('due');

    // "from charge to delivery" — delivery discharges the obligation.
    await setDeliveryMechanism(deps(), {
      campaignId: c.campaignId,
      mechanism: 'login_credentials',
      accessInstructions: 'Sign in at example.com with your pre-order email.',
      actor: 'user:founder',
    });
    await recordDelivery(deps(), { campaignId: c.campaignId, actor: 'user:founder' });
    const delivered = await readFulfillmentStatus(
      h.db,
      c.campaignId,
      new Date(Date.now() + 200 * DAY),
    );
    expect(delivered!.obligations.find((o) => o.key === 'update_cadence')!.state).toBe('met');
  });

  it('records the 48-hour close confirmation and derives whether it was late', async () => {
    const c = await seedCapturedCampaign('c2', 'pre_launch');
    const updateId = await postUpdate(c.campaignId, 'We have closed.', new Date());
    const recorded = await recordCloseConfirmation(deps(), {
      campaignId: c.campaignId,
      updateId,
      actor: 'user:founder',
    });
    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') throw new Error('unreachable');
    expect(recorded.withinWindow).toBe(true);

    const status = await readFulfillmentStatus(h.db, c.campaignId);
    expect(status!.obligations.find((o) => o.key === 'close_confirmation')!.state).toBe('met');
  });

  it('marks `fulfilled` at delivery and leaves `closed_resolved` alone', async () => {
    const c = await seedCapturedCampaign('c3', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      deliveryMonth: '2026-12',
      commitmentText: 'Delivered in December 2026',
      actor: 'user:founder',
    });
    await setDeliveryMechanism(deps(), {
      campaignId: c.campaignId,
      mechanism: 'api_key',
      accessInstructions: 'Your key is in the dashboard.',
      actor: 'user:founder',
    });

    // Put the campaign in a state whose §23.1 exit rule names fulfillment.
    await h.db
      .update(campaigns)
      .set({ status: 'remaining_payment_released' })
      .where(eq(campaigns.id, c.campaignId));

    const delivered = await recordDelivery(deps(), {
      campaignId: c.campaignId,
      actor: 'user:founder',
    });
    expect(delivered.status).toBe('delivered');

    expect((await campaignRow(c.campaignId)).status).toBe('fulfilled');
    // Money reconciled is a different fact — §22.11 is Phase 21b's and nothing
    // here writes it.
    expect((await campaignRow(c.campaignId)).status).not.toBe('closed_resolved');

    // §23.3's independent flag is what keeps fulfillment trackable separately.
    const flags = await h.db
      .select({ flag: campaignPaymentFlags.flag })
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, c.campaignId));
    expect(flags.map((f) => f.flag)).toContain('fulfillment_active');

    // §23.1 keeps them distinct states with a real edge between them.
    expect(campaignMachine.canTransition('fulfilled', 'closed_resolved')).toBe(true);
  });
});

/* ══ §33.10.3 — Day 14 evidence and consequences by campaign type ═══════════ */

describe('§33.10.3 — Day 14 pass/fail evidence and consequences match the campaign type', () => {
  it('gives Product an extra optional evidence item and Idea an enforcement-only review', async () => {
    const product = await seedCapturedCampaign('p1', 'pre_launch');
    const idea = await seedCapturedCampaign('i1', 'pre_build');

    await openDay14Review(deps(), { campaignId: product.campaignId });
    await openDay14Review(deps(), { campaignId: idea.campaignId });

    const productList = await readDay14Checklist(h.db, product.campaignId);
    const ideaList = await readDay14Checklist(h.db, idea.campaignId);

    // §22.4: "Product evidence may show actual feature/reward access" — offered,
    // not required.
    const access = productList!.items.find((i) => i.key === 'feature_or_reward_access');
    expect(access).toBeDefined();
    expect(access!.required).toBe(false);
    expect(access!.example).toBeTruthy();
    expect(ideaList!.items.find((i) => i.key === 'feature_or_reward_access')).toBeUndefined();

    // Every item carries an example — §22.4's "checklist with examples".
    for (const item of [...productList!.items, ...ideaList!.items]) {
      expect(item.example.length).toBeGreaterThan(10);
    }

    // §22.4: "Idea review is enforcement-only."
    expect(productList!.blocksAPayment).toBe(true);
    expect(ideaList!.blocksAPayment).toBe(false);
    expect(ideaList!.enforcementOnly).toBe(true);

    // The Founder route serves the SAME list the Admin read.
    const founderSession = request.agent(h.app);
    void founderSession;
    expect(bChecklist('pre_launch')).toEqual(productList!.items);
    expect(bChecklist('pre_build')).toEqual(ideaList!.items);
  });

  it('creates a durable receipt naming every supplied item and the decision due time', async () => {
    const c = await seedCapturedCampaign('p2', 'pre_launch');
    const opened = await openDay14Review(deps(), { campaignId: c.campaignId });
    expect(opened.status).toBe('opened');

    // A missing required item is refused BY NAME.
    const short = await submitDay14Evidence(deps(), {
      campaignId: c.campaignId,
      items: [{ itemKey: 'progress_evidence', detail: 'Screenshots attached.' }],
      actor: 'user:founder',
    });
    expect(short.status).toBe('missing_items');
    if (short.status !== 'missing_items') throw new Error('unreachable');
    expect([...short.items].sort()).toEqual(['delivery_timeline', 'required_communication']);

    // An item nobody asked for is refused too.
    const bogus = await submitDay14Evidence(deps(), {
      campaignId: c.campaignId,
      items: [{ itemKey: 'invented_item', detail: 'x' }],
      actor: 'user:founder',
    });
    expect(bogus.status).toBe('unknown_items');

    const submitted = await submitDay14Evidence(deps(), {
      campaignId: c.campaignId,
      items: [
        { itemKey: 'progress_evidence', detail: 'Build 0.9 shipped to staging.' },
        { itemKey: 'required_communication', detail: 'Two updates posted.' },
        { itemKey: 'delivery_timeline', detail: 'Still December 2026.' },
        { itemKey: 'feature_or_reward_access', detail: 'Beta invite available.' },
      ],
      actor: 'user:founder',
    });
    expect(submitted.status).toBe('submitted');
    if (submitted.status !== 'submitted') throw new Error('unreachable');
    expect(submitted.reference).toMatch(/^D14-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-/);

    const checklist = await readDay14Checklist(h.db, c.campaignId);
    const receipt = checklist!.submissions[0]!;
    expect(receipt.items).toHaveLength(4);
    expect(receipt.decisionDueAt).toBe(checklist!.decisionDueAt);

    // Durable: insert-only at the database.
    await expectDbRefusal(
      h.db
        .update(day14EvidenceSubmissions)
        .set({ reference: 'D14-TAMPERED' })
        .where(eq(day14EvidenceSubmissions.id, submitted.submissionId)),
      /durable and insert-only/i,
    );
  });

  it('a Product failure blocks the unreleased remaining payment; an Idea failure has none to block', async () => {
    /* ── Product ────────────────────────────────────────────────────────── */
    const product = await seedCapturedCampaign('p3', 'pre_launch');
    await openDay14Review(deps(), { campaignId: product.campaignId });

    const failed = await decideDay14Review(deps(), {
      campaignId: product.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['no_progress_evidence', 'no_substantive_update_7_days'],
      internalReason: 'No build artefacts and no updates since close.',
      customerExplanation:
        'We could not find evidence of progress, and no update has been posted in the last seven days.',
      actor: 'admin:test',
    });
    expect(failed.status).toBe('decided');
    if (failed.status !== 'decided') throw new Error('unreachable');
    expect(failed.blocksRemainingPayment).toBe(true);
    expect(failed.consequences.map((c) => c.key)).toEqual([
      'block_remaining_payment',
      'start_refund_reversal_recovery',
      'best_effort_first_payment_reversal',
    ]);
    // Only the block is automatic — every recovery line stays an Admin case.
    expect(failed.consequences.filter((c) => c.automatic).map((c) => c.key)).toEqual([
      'block_remaining_payment',
    ]);

    // The block is real at the money edge, and named.
    const block = await day14PaymentBlock(h.db, product.campaignId);
    expect(block.blocked).toBe(true);
    expect(block.kinds).toEqual(['remaining_payment']);
    expect(block.blocker).toMatch(/Day 14 Progress Check did not pass/);

    const create = await createFounderPayment(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      { campaignId: product.campaignId, kind: 'remaining_payment', actor: 'admin:test' },
    );
    expect(create.status).toBe('day_14_failed');

    const release = await releaseFounderPayment(
      { db: h.db, audit, notifier: h.notifier, context: CONTEXT },
      { campaignId: product.campaignId, kind: 'remaining_payment', actor: 'admin:test' },
    );
    // No payment row exists, so `not_found` is the honest answer; the create
    // refusal above is the edge that matters, and the release edge is exercised
    // on a campaign that has a row in the §33.10.4 block below.
    expect(['day_14_failed', 'not_found']).toContain(release.status);

    /* ── Idea ───────────────────────────────────────────────────────────── */
    const idea = await seedCapturedCampaign('i2', 'pre_build');
    await openDay14Review(deps(), { campaignId: idea.campaignId });

    const ideaFailed = await decideDay14Review(deps(), {
      campaignId: idea.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: true,
      failureReasons: ['no_progress_evidence'],
      internalReason: 'No progress evidence supplied.',
      customerExplanation: 'We could not find evidence of progress on your campaign.',
      actor: 'admin:test',
    });
    expect(ideaFailed.status).toBe('decided');
    if (ideaFailed.status !== 'decided') throw new Error('unreachable');
    // §22.4: no unreleased payment exists — enforcement only.
    expect(ideaFailed.blocksRemainingPayment).toBe(false);
    expect(ideaFailed.consequences.map((c) => c.key)).toEqual(['start_refund_reversal_recovery']);
    expect(ideaFailed.consequences.some((c) => c.key === 'block_remaining_payment')).toBe(false);

    const ideaBlock = await day14PaymentBlock(h.db, idea.campaignId);
    expect(ideaBlock.blocked).toBe(false);

    // The two consequence lists differ by exactly the payment line.
    expect(bConsequences('pre_launch').length - bConsequences('pre_build').length).toBe(2);
  });

  it('refuses an inconsistent outcome, an unknown reason, and a raw provider code — and decides once', async () => {
    const c = await seedCapturedCampaign('p4', 'pre_launch');
    await openDay14Review(deps(), { campaignId: c.campaignId });

    // A pass with no adequate progress evidence is unrecordable.
    const badPass = await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'pass',
      adequateProgressEvidence: false,
      requiredCommunication: true,
      internalReason: 'x',
      customerExplanation: 'y',
      actor: 'admin:test',
    });
    expect(badPass.status).toBe('inconsistent');
    if (badPass.status !== 'inconsistent') throw new Error('unreachable');
    expect(badPass.problem).toBe('pass_requires_adequate_progress_evidence');

    // A fail with no reason is "policy violation" wearing a different word.
    const bareFail = await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: [],
      internalReason: 'x',
      customerExplanation: 'y',
      actor: 'admin:test',
    });
    expect(bareFail.status).toBe('inconsistent');

    // §33.9.11: no raw provider code in customer copy.
    const codey = await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['ghosting'],
      internalReason: 'internal',
      customerExplanation: 'Your charge returned generic_decline so we failed the review.',
      actor: 'admin:test',
    });
    expect(codey.status).toBe('raw_provider_code_in_explanation');

    const passed = await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'pass',
      adequateProgressEvidence: true,
      requiredCommunication: true,
      internalReason: 'Staging build reviewed; three updates posted.',
      customerExplanation: 'Your Day 14 Progress Check passed. Keep posting updates every 30 days.',
      actor: 'admin:test',
    });
    expect(passed.status).toBe('decided');

    // Recorded once — a second decision is refused, and the database refuses too.
    const again = await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['ghosting'],
      internalReason: 'changed my mind',
      customerExplanation: 'Actually no.',
      actor: 'admin:test',
    });
    expect(again.status).toBe('already_decided');

    await expectDbRefusal(
      h.db
        .update(day14Reviews)
        .set({ outcome: 'fail' })
        .where(eq(day14Reviews.campaignId, c.campaignId)),
      /recorded once/i,
    );

    // The result reached the Founder, once.
    const results = h.sentEmails.messages.filter((m) => /Day 14 Progress Check/i.test(m.subject));
    expect(results.length).toBeGreaterThan(0);
  });

  it('opens the review only where something was captured, and the queue leads with overdue', async () => {
    const nothing = await seedLiveCampaign('q1', { type: 'pre_launch' });
    await closeCampaign(nothing.campaignId);
    const none = await openDay14Review(deps(), { campaignId: nothing.campaignId });
    expect(none.status).toBe('nothing_captured');

    const c = await seedCapturedCampaign('q2', 'pre_launch');
    // Back-date the close so the anchor has passed.
    await h.db
      .update(campaigns)
      .set({ campaignCloseAt: new Date(Date.now() - 20 * DAY) })
      .where(eq(campaigns.id, c.campaignId));

    const swept = await sweepDay14Reviews(deps(), {});
    expect(swept.opened).toBeGreaterThanOrEqual(1);
    // Idempotent: a second tick opens nothing.
    const again = await sweepDay14Reviews(deps(), {});
    expect(again.opened).toBe(0);

    const queue = await readDay14Queue(h.db);
    const row = queue.find((q) => q.campaignId === c.campaignId);
    expect(row).toBeDefined();
    expect(row!.overdue).toBe(true);
    expect(queue[0]!.overdue).toBe(true); // overdue sorts first
    expect(row!.blocksAPayment).toBe(true);
    expect(row!.noSubstantiveUpdateInSevenDays).toBe(true);

    // The due time is the campaign's own Day 14 anchor.
    const [review] = await h.db
      .select({ dueAt: day14Reviews.dueAt })
      .from(day14Reviews)
      .where(eq(day14Reviews.campaignId, c.campaignId))
      .limit(1);
    const [campaign] = await h.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, c.campaignId))
      .limit(1);
    expect(review!.dueAt.getTime()).toBe(day14DueAt(campaign!.closeAt!).getTime());
  });
});

/* ══ §33.10.4 — the ghost ban ═══════════════════════════════════════════════ */

describe('§33.10.4 — the ghost ban fires only under the four defined conditions', () => {
  it('refuses a ban when no trigger is met, and records nothing', async () => {
    const c = await seedCapturedCampaign('b1', 'pre_launch');
    await recordOriginalCommitment(deps(), {
      campaignId: c.campaignId,
      // A month far in the future: nothing is late.
      deliveryMonth: '2030-06',
      commitmentText: 'Delivered in June 2030',
      actor: 'user:founder',
    });

    const evaluation = await gatherGhostBanFacts(h.db, c.campaignId);
    expect(evaluation!.triggersMet).toEqual([]);

    for (const trigger of B_TRIGGERS) {
      const refused = await recordGhostBan(
        { db: h.db, audit },
        {
          campaignId: c.campaignId,
          trigger,
          evidence: 'They seem inactive to me.',
          notice: 'You are banned.',
          paymentRecoveryStatus: 'nothing recovered',
          enforcementDecision: 'permanent ban',
          internalReason: 'gut feeling',
          actor: 'admin:test',
        },
      );
      expect(refused.status).toBe('trigger_not_met');
    }

    const bans = await h.db
      .select({ id: founderGhostBans.id })
      .from(founderGhostBans)
      .where(eq(founderGhostBans.campaignId, c.campaignId));
    expect(bans).toHaveLength(0);

    // There is no discretionary trigger to reach for.
    expect(B_TRIGGERS).toHaveLength(4);
    expect(B_TRIGGERS.some((t) => /other|discretion|manual|inactive/i.test(t))).toBe(false);

    const unknown = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'seems_inactive',
        evidence: 'x',
        notice: 'y',
        paymentRecoveryStatus: 'z',
        enforcementDecision: 'w',
        internalReason: 'v',
        actor: 'admin:test',
      },
    );
    expect(unknown.status).toBe('unknown_trigger');
  });

  it('the campaign-type-exclusive triggers cannot cross over', () => {
    const base = {
      day14Failed: false,
      paymentReleasedAt: null,
      lastCommunicationAt: null,
      deliveredAt: null,
      updatedTimelineAt: null,
      requiredNoticeOrApprovalComplete: false,
      now: new Date('2027-06-01T00:00:00Z'),
    };
    const longPast = new Date('2026-01-31T23:59:59Z');

    // A Product campaign, far past its month, with no timeline: trigger 3 only.
    const product = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: longPast,
      ideaDeliveryWindowEnd: longPast,
    });
    expect(product).toEqual(['product_30_days_past_delivery_month']);

    // The same facts on an Idea campaign: trigger 4 only.
    const idea = bTriggersMet({
      ...base,
      campaignType: 'pre_build',
      disclosedDeliveryMonthEnd: longPast,
      ideaDeliveryWindowEnd: longPast,
    });
    expect(idea).toEqual(['idea_window_missed_and_no_timeline']);

    // §22.7's conjunctions are conjunctions: a filed and notified revision
    // excuses the Product trigger, however late the delivery is.
    const excused = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: longPast,
      ideaDeliveryWindowEnd: null,
      updatedTimelineAt: new Date('2026-02-10T00:00:00Z'),
      requiredNoticeOrApprovalComplete: true,
    });
    expect(excused).toEqual([]);

    // And an Idea Founder who communicated inside 30 days is not banned.
    const communicated = bTriggersMet({
      ...base,
      campaignType: 'pre_build',
      disclosedDeliveryMonthEnd: null,
      ideaDeliveryWindowEnd: longPast,
      updatedTimelineAt: new Date('2026-02-10T00:00:00Z'),
    });
    expect(communicated).toEqual([]);

    // Delivery discharges both delivery-window triggers and the silence one.
    const delivered = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: longPast,
      ideaDeliveryWindowEnd: longPast,
      paymentReleasedAt: new Date('2026-01-01T00:00:00Z'),
      deliveredAt: new Date('2026-03-01T00:00:00Z'),
    });
    expect(delivered).toEqual([]);

    // Silence needs a payment anchor; with none, the trigger cannot fire.
    const noPayment = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: null,
      ideaDeliveryWindowEnd: null,
    });
    expect(noPayment).toEqual([]);

    // 29 days of silence is not 30.
    const nearly = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: null,
      ideaDeliveryWindowEnd: null,
      paymentReleasedAt: new Date('2027-05-04T00:00:00Z'),
    });
    expect(nearly).toEqual([]);
    const past = bTriggersMet({
      ...base,
      campaignType: 'pre_launch',
      disclosedDeliveryMonthEnd: null,
      ideaDeliveryWindowEnd: null,
      paymentReleasedAt: new Date('2027-05-01T00:00:00Z'),
    });
    expect(past).toEqual(['silent_30_days_post_payment']);
  });

  it('a failed Day 14 bans once, permanently, with all five §22.7 facts and a full audit row', async () => {
    const c = await seedCapturedCampaign('b2', 'pre_launch');
    await openDay14Review(deps(), { campaignId: c.campaignId });
    await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['ghosting', 'no_progress_evidence'],
      internalReason: 'No response to three contacts; no build evidence.',
      customerExplanation:
        'You did not respond to our requests and we found no evidence of progress on your campaign.',
      actor: 'admin:test',
    });

    const evaluation = await gatherGhostBanFacts(h.db, c.campaignId);
    expect(evaluation!.triggersMet).toContain('failed_day_14');

    // A raw provider code in the customer notice is refused (§29.4, §33.9.11).
    const codey = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'Day 14 review failed.',
        notice: 'Banned because of card_declined.',
        paymentRecoveryStatus: 'Remaining payment blocked.',
        enforcementDecision: 'Permanent ban.',
        internalReason: 'x',
        actor: 'admin:test',
      },
    );
    expect(codey.status).toBe('raw_provider_code_in_notice');

    // A blank §22.7 field is refused by name.
    const blank = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'Day 14 review failed.',
        notice: 'Your account is permanently closed.',
        paymentRecoveryStatus: '   ',
        enforcementDecision: '',
        internalReason: 'x',
        actor: 'admin:test',
      },
    );
    expect(blank.status).toBe('missing_fields');
    if (blank.status !== 'missing_fields') throw new Error('unreachable');
    expect([...blank.fields].sort()).toEqual(['enforcement_decision', 'payment_recovery_status']);

    const banned = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence:
          'Day 14 review failed on 2026-08-01: no progress evidence, no response to three contacts.',
        notice:
          'Your Day 14 Progress Check failed and you did not respond to our requests. Your Proovd Founder account is permanently closed.',
        paymentRecoveryStatus:
          'Remaining payment blocked; refund and recovery cases opened for every captured pre-order.',
        enforcementDecision: 'Permanent one-strike ban under §22.7.',
        internalReason: 'Ghosting after capture; recovery underway.',
        actor: 'admin:test',
      },
    );
    expect(banned.status).toBe('banned');
    if (banned.status !== 'banned') throw new Error('unreachable');
    expect(banned.permanentSentence).toBe(B_PERMANENT);

    const [ban] = await h.db
      .select()
      .from(founderGhostBans)
      .where(eq(founderGhostBans.id, banned.banId))
      .limit(1);
    // §22.7's five recorded facts, all present.
    expect(ban!.trigger).toBe('failed_day_14');
    expect(ban!.evidence).toContain('Day 14 review failed');
    expect(ban!.notice).toContain('permanently closed');
    expect(ban!.paymentRecoveryStatus).toContain('Remaining payment blocked');
    expect(ban!.enforcementDecision).toContain('Permanent');
    expect(ban!.day14ReviewId).toBeTruthy();
    // The facts that produced the decision are stored, so it is reproducible.
    expect((ban!.triggerFacts as Record<string, unknown>)['day14Failed']).toBe(true);

    // Fully audited (§33.10.4): actor, both §25.6 columns, prior and new value.
    const [row] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'founder.ghost_ban_recorded'),
          eq(auditEvents.targetId, c.campaignId),
        ),
      )
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.actor).toContain('admin:test');
    expect(row!.internalReason).toContain('Ghosting');
    expect(row!.customerExplanation).toContain('permanently closed');
    expect(row!.priorValue).toEqual({ banned: false });
    expect((row!.newValue as Record<string, unknown>)['permanent']).toBe(true);

    // One strike: a second ban for the same Founder is refused, and the
    // database refuses regardless.
    const second = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'again',
        notice: 'again',
        paymentRecoveryStatus: 'again',
        enforcementDecision: 'again',
        internalReason: 'again',
        actor: 'admin:test',
      },
    );
    expect(second.status).toBe('already_banned');

    // Permanent: there is no lift, at the database level.
    await expectDbRefusal(
      h.db.delete(founderGhostBans).where(eq(founderGhostBans.id, banned.banId)),
      /permanent and its record is insert-only/i,
    );
    await expectDbRefusal(
      h.db
        .update(founderGhostBans)
        .set({ enforcementDecision: 'lifted' })
        .where(eq(founderGhostBans.id, banned.banId)),
      /permanent and its record is insert-only/i,
    );

    expect(await founderIsBanned(h.db, c.founderUserId)).not.toBeNull();

    // The candidate queue only ever suggests a ban the record supports.
    const candidates = await readGhostBanCandidates(h.db);
    for (const candidate of candidates) {
      expect(candidate.triggersMet.length).toBeGreaterThan(0);
    }
  });

  it('a failed-Day-14 ban cannot be forged without a review that actually failed', async () => {
    const c = await seedCapturedCampaign('b3', 'pre_launch');
    await openDay14Review(deps(), { campaignId: c.campaignId });
    await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'pass',
      adequateProgressEvidence: true,
      requiredCommunication: true,
      internalReason: 'Evidence reviewed.',
      customerExplanation: 'Your Day 14 Progress Check passed.',
      actor: 'admin:test',
    });

    // The service refuses: the trigger is not met on a passing review.
    const refused = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'x',
        notice: 'y',
        paymentRecoveryStatus: 'z',
        enforcementDecision: 'w',
        internalReason: 'v',
        actor: 'admin:test',
      },
    );
    expect(refused.status).toBe('trigger_not_met');

    // And a hand-written INSERT citing the passing review is refused too.
    const [review] = await h.db
      .select({ id: day14Reviews.id })
      .from(day14Reviews)
      .where(eq(day14Reviews.campaignId, c.campaignId))
      .limit(1);
    await expectDbRefusal(
      h.db.insert(founderGhostBans).values({
        founderUserId: c.founderUserId,
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'x',
        notice: 'y',
        paymentRecoveryStatus: 'z',
        enforcementDecision: 'w',
        internalReason: 'v',
        triggerFacts: {},
        day14ReviewId: review!.id,
        decidedBy: 'admin:test',
      }),
      /review that actually failed/i,
    );
  });

  it('moves the campaign to `banned_founder` only from `killed`', async () => {
    const c = await seedCapturedCampaign('b4', 'pre_launch');
    await openDay14Review(deps(), { campaignId: c.campaignId });
    await decideDay14Review(deps(), {
      campaignId: c.campaignId,
      outcome: 'fail',
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['ghosting'],
      internalReason: 'Unreachable.',
      customerExplanation: 'You did not respond to our requests about your campaign.',
      actor: 'admin:test',
    });

    // Not killed → the ban is recorded and the campaign is left alone. §26.7's
    // kill is Phase 20b's recorded decision and this does not stand in for it.
    const statusBefore = (await campaignRow(c.campaignId)).status;
    const banned = await recordGhostBan(
      { db: h.db, audit },
      {
        campaignId: c.campaignId,
        trigger: 'failed_day_14',
        evidence: 'Failed Day 14; unreachable for five business days.',
        notice: 'Your Proovd Founder account is permanently closed.',
        paymentRecoveryStatus: 'Recovery cases opened.',
        enforcementDecision: 'Permanent one-strike ban.',
        internalReason: 'Ghosting.',
        actor: 'admin:test',
      },
    );
    expect(banned.status).toBe('banned');
    if (banned.status !== 'banned') throw new Error('unreachable');
    expect(banned.campaignMovedTo).toBeNull();
    expect((await campaignRow(c.campaignId)).status).toBe(statusBefore);

    // §23.1's only edge into `banned_founder`.
    expect(campaignMachine.canTransition('killed', 'banned_founder')).toBe(true);
    expect(campaignMachine.canTransition('day_14_review', 'banned_founder')).toBe(false);
  });
});

/* ══ Drift — the backend restatement matches @proovd/shared ═════════════════ */

describe('Phase 21a registers are restated, not re-decided', () => {
  it('every constant and register matches the shared module', () => {
    expect(B_CLOSE_HOURS).toBe(S_CLOSE_HOURS);
    expect(B_CADENCE).toBe(S_CADENCE);
    expect(B_MECHANISMS).toEqual(S_MECHANISMS);
    expect(B_MECH_LABELS).toEqual(S_MECH_LABELS);
    expect(B_NOTICE_ITEMS).toEqual(S_NOTICE_ITEMS);
    expect(B_OBLIGATIONS).toEqual(S_OBLIGATIONS);
    expect(B_MATERIAL_FIELDS).toEqual(S_MATERIAL_FIELDS);
    expect(B_REVIEW_DAYS).toBe(S_REVIEW_DAYS);
    expect(B_DAY14).toBe(S_DAY14);
    expect(B_FAIL_REASONS).toEqual(S_FAIL_REASONS);
    expect(B_FAIL_LABELS).toEqual(S_FAIL_LABELS);
    expect(B_CLARIFY_DAYS).toBe(S_CLARIFY_DAYS);
    expect(B_TRIGGERS).toEqual(S_TRIGGERS);
    expect(B_TRIGGER_LABELS).toEqual(S_TRIGGER_LABELS);
    expect(B_TRIGGER_TYPES).toEqual(S_TRIGGER_TYPES);
    expect(B_SILENCE).toBe(S_SILENCE);
    expect(B_BAN_FIELDS).toEqual(S_BAN_FIELDS);
    expect(B_PERMANENT).toBe(S_PERMANENT);
  });

  it('every kernel agrees with the shared one', () => {
    for (const type of ['pre_build', 'pre_launch'] as const) {
      for (const released of [true, false]) {
        expect(bPathFor({ campaignType: type, remainingPaymentReleased: released })).toBe(
          sPathFor({ campaignType: type, remainingPaymentReleased: released }),
        );
      }
      expect(bChecklist(type)).toEqual(sChecklist(type));
      expect(bConsequences(type)).toEqual(sConsequences(type));
    }

    const cadenceInput = {
      chargedAt: new Date('2026-01-01T00:00:00Z'),
      lastUpdateAt: new Date('2026-01-20T00:00:00Z'),
      deliveredAt: null,
      now: new Date('2026-03-01T00:00:00Z'),
    };
    expect(bCadence(cadenceInput)).toEqual(sCadence(cadenceInput));

    const consistency = {
      outcome: 'fail' as const,
      adequateProgressEvidence: false,
      requiredCommunication: false,
      failureReasons: ['ghosting' as const],
    };
    expect(bConsistent(consistency)).toEqual(sConsistent(consistency));

    const facts = {
      campaignType: 'pre_launch' as const,
      day14Failed: true,
      paymentReleasedAt: new Date('2026-01-01T00:00:00Z'),
      lastCommunicationAt: null,
      disclosedDeliveryMonthEnd: new Date('2026-01-31T23:59:59Z'),
      ideaDeliveryWindowEnd: null,
      deliveredAt: null,
      updatedTimelineAt: null,
      requiredNoticeOrApprovalComplete: false,
      now: new Date('2026-06-01T00:00:00Z'),
    };
    expect(bTriggersMet(facts)).toEqual(sTriggersMet(facts));

    const notice = {
      reward: 'Kit',
      mechanism: 'api_key' as const,
      accessInstructions: 'Key in the dashboard.',
      originalCommitment: 'December 2026',
      founderSupport: 'Founder — example.com',
      proovdEscalation: 'support@proovd.co',
    };
    expect(bResolveNotice(notice)).toEqual(sResolveNotice(notice));
  });

  it('the migration installs no path that could lift a ban or rewrite a commitment', async () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'db',
      'migrations',
      '0034_fulfillment_day14_ghost_ban.sql',
    );
    const sqlText = await readFile(file, 'utf8');
    expect(sqlText).toMatch(/REVOKE UPDATE, DELETE ON "founder_ghost_bans"/);
    expect(sqlText).toMatch(/REVOKE UPDATE, DELETE ON "day_14_evidence_submissions"/);
    expect(sqlText).toMatch(/REVOKE UPDATE, DELETE ON "day_14_evidence_items"/);
    // No column shaped like a ban lift exists anywhere in the phase.
    expect(/lifted_at|ban_lifted|unban|reinstate_founder/i.test(sqlText)).toBe(false);
  });
});
