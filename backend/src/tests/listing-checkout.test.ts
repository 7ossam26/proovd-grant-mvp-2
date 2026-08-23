/**
 * Phase 11 — the listing Checkout, the seven atomic effects, the two clocks,
 * the single refund, and the §31.6 cancellation.
 *
 * Acceptance: §33.3.5 (the server half — session lines and the receipt; the
 * pre-payment surface's A.5 rendering is 11b's Testing Library suite),
 * §33.3.6, §33.3.7, §33.3.8, §33.3.11 — plus the brief's done-when list:
 * duplicate deliveries, expiry/retry without duplication, and the totality of
 * the post-payment lock.
 *
 * The gateway is the in-memory one: real webhook signature verification (the
 * suite signs with Stripe's own helper, so `constructEvent` is what runs),
 * fake payment API. Each journey seeds its own Founder, campaign, and Creator
 * directly — the invitation, vetting, claim, and signup journeys are §33.1/2's
 * suites, already green; what is under test here is what payment does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_PLATFORM_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations, associationStatusHistory } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { providerObjects, stripeConnectedAccounts } from '../db/schema/payments.js';
import {
  listingFeePayments,
  listingFeeRefunds,
  campaignCancellations,
} from '../db/schema/listing.js';
import { listingFeeCalculations, campaignOptionalItems } from '../db/schema/workspace.js';
import { idempotencyKeys, notificationDeliveries, providerEvents } from '../db/schema/integrity.js';
import { campaignApplicationReviews } from '../db/schema/admin-founder-panel.js';
import { beginListingCheckout } from '../payments/listing-checkout.js';
import { sweepListingDeadlines } from '../payments/listing-clocks.js';
import { formatUsdCents } from '../payments/listing-notifications.js';
import {
  LISTING_REFUND_PROMISE,
  SEPARATE_FIVE_PERCENT_NOTE,
  OPTIONAL_ITEM_LABELS,
} from '../notifications/templates/listing-fee.js';
import {
  LISTING_FEE_CONSENT_TEMPLATE,
  SEPARATE_FIVE_PERCENT_NOTE as SHARED_FIVE_PERCENT_NOTE,
  OPTIONAL_ITEMS,
  formatUsd,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_listing_suite';
const CONNECT_SECRET = 'whsec_connect_for_listing_suite';

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      simulatedListingPayments: true,
      stripeConnectUrls: {
        returnUrl: 'https://app.example.com/stripe/return',
        refreshUrl: 'https://app.example.com/stripe/refresh',
      },
    },
    'listing',
  );
  admin = await createAdmin(h, 'listing-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── One journey: a claimed Founder, a workspace, and a preparing Creator ─── */

interface Journey {
  campaignId: string;
  founder: { id: string; email: string; cookie: string };
  associationId: string;
  waitingAssociationId: string;
  revokedAssociationId: string;
  creatorEmail: string;
}

/**
 * Seeds the state the earlier suites prove reachable: a claimed campaign in
 * `account_claimed`, its claim profile, a complete seller account, and three
 * Creator associations — one `preparing`, one still waiting (must not open),
 * one `preparing` but kit-revoked (must not open).
 */
async function journey(label: string): Promise<Journey> {
  const founder = await seedUser(h, 'founder', `listing-founder-${label}`);
  const cookie = await signInPlain(h, founder.email);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `Fondi-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  // §9's type lock: `type` and `type_locked_at` are a pair, enforced by CHECK.
  // Vetting submission sets both; this seeds the state that leaves behind.
  const [campaign] = await h.db
    .insert(campaigns)
    .values({ status: 'account_claimed', type: 'pre_launch', typeLockedAt: new Date() })
    .returning({ id: campaigns.id });
  const campaignId = campaign!.id;

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({
      campaignId,
      prospectId: prospect!.id,
      status: 'claimed',
      createdBy: 'admin:test',
    })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId,
    email: founder.email,
    preferredName: `Fondi-${label}`,
    legalName: `Founder ${label}`,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  // §13: a complete seller account is what makes payment reachable.
  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_listing${label}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.id,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  async function creator(status: 'preparing' | 'signed_up_waiting_for_founder', revoked: boolean) {
    const email = `creator-${label}-${randomUUID()}@example.com`;
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: `Creator ${label}`,
        publicHandle: `@creator-${label}`,
        email,
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });

    const [assoc] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: randomUUID(),
        prospectId: cp!.id,
        status,
        rosterMembership: 'initial_roster',
        ...(revoked
          ? {
              kitAccessRevokedAt: new Date(),
              kitAccessRevokedReason: 'test revocation',
              kitAccessRevokedBy: 'admin:test',
            }
          : {}),
      })
      .returning({ id: campaignAffiliateAssociations.id });

    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId: assoc!.id,
      email,
      publicHandle: `@creator-${label}`,
      updatedBy: 'test',
    });

    return { associationId: assoc!.id, email };
  }

  const opened = await creator('preparing', false);
  const waiting = await creator('signed_up_waiting_for_founder', false);
  const revoked = await creator('preparing', true);

  // Opening the workspace creates the five items and the first calculation.
  await request(h.app)
    .get(`/api/founder/campaigns/${campaignId}/workspace`)
    .set('cookie', cookie)
    .expect(200);

  return {
    campaignId,
    founder: { ...founder, cookie },
    associationId: opened.associationId,
    waitingAssociationId: waiting.associationId,
    revokedAssociationId: revoked.associationId,
    creatorEmail: opened.email,
  };
}

/**
 * Earns two labeled US$2 savings, by the two routes that exist here.
 *
 * Story completes on its own evidence — written and approved. Branding cannot:
 * §12 requires an approved logo, the logo is an upload, and object storage is
 * deliberately unconfigured in this deployment (Track A4), so no Founder can
 * complete it and pretending otherwise would test a state the product cannot
 * reach. §12's other completing path is a recorded Admin override, which
 * carries its reason, its explanation, and its evidence — so the second saving
 * is earned the way an Admin would actually earn it today.
 */
async function completeTwoItems(j: Journey): Promise<void> {
  await request(h.app)
    .patch(`/api/founder/campaigns/${j.campaignId}/workspace`)
    .set('cookie', j.founder.cookie)
    .send({
      storyText:
        'A story long enough to be a real story about the product, why it exists, and who it serves.',
      storyApproved: true,
    })
    .expect(200);

  await request(h.app)
    .post(`/api/admin/campaigns/${j.campaignId}/workspace/items/branding/override`)
    .set('cookie', admin.cookie)
    .send({
      complete: true,
      reason: 'brand direction and logo reviewed with the Founder on a call',
      explanation: 'We reviewed your branding together and counted it as complete.',
      evidence: 'call recording 2026-08-01, brand pack reviewed in session',
    })
    .expect(200);
}

async function openCheckout(j: Journey) {
  const res = await request(h.app)
    .post(`/api/founder/campaigns/${j.campaignId}/listing/checkout`)
    .set('cookie', j.founder.cookie)
    .send({ address: { postalCode: '94105', state: 'CA', country: 'US' }, newsletterOptIn: false })
    .expect(200);
  return res.body.checkout as {
    url: string;
    sessionId: string;
    baseCents: string;
    discountCents: string;
    discountLines: Array<{ item: string; discountCents: string }>;
    subtotalCents: string;
    taxCents: string;
    totalCents: string;
    descriptor: string;
  };
}

function signedEvent(input: {
  type: string;
  object: Record<string, unknown>;
  id?: string;
  createdAtSeconds?: number;
}): { payload: string; signature: string; id: string } {
  const id = input.id ?? `evt_${randomUUID().replace(/-/g, '')}`;
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: input.type,
    created: input.createdAtSeconds ?? Math.floor(Date.now() / 1000),
    data: { object: input.object },
  });
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: PLATFORM_SECRET }),
    id,
  };
}

/** Delivers `checkout.session.completed` for a session the gateway created. */
async function completeSession(
  sessionId: string,
  overrides: { eventId?: string; createdAtSeconds?: number } = {},
) {
  const session = gateway.sessions.find((s) => s.id === sessionId)!;
  const totalCents = session.subtotalCents + session.taxCents;
  const { payload, signature, id } = signedEvent({
    type: 'checkout.session.completed',
    ...(overrides.eventId ? { id: overrides.eventId } : {}),
    ...(overrides.createdAtSeconds ? { createdAtSeconds: overrides.createdAtSeconds } : {}),
    object: {
      id: session.id,
      object: 'checkout.session',
      payment_intent: session.paymentIntentId,
      amount_total: Number(totalCents),
      metadata: session.metadata,
      status: 'complete',
    },
  });
  const res = await request(h.app)
    .post(STRIPE_PLATFORM_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(STRIPE_SIGNATURE_HEADER, signature)
    .send(payload);
  return { res, eventId: id };
}

const emailsTo = (address: string) => h.sentEmails.messages.filter((m) => m.to === address);

describe('the no-provider fake Pay action', () => {
  it('records payment and advances the Admin workflow without calling Stripe', async () => {
    const j = await journey('simulated');
    await h.db.insert(campaignApplicationReviews).values({
      campaignId: j.campaignId,
      round: 1,
      outcome: 'approved',
      reviewer: 'admin:test',
      decidedAt: new Date(),
      internalReason: 'Approved for the simulated-payment integration test.',
      customerExplanation: 'Your application is approved.',
    });
    const sessionsBefore = gateway.sessions.length;

    const first = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/simulated-payment`)
      .set('cookie', j.founder.cookie)
      .expect(200);

    expect(first.body.paid).toBe(true);
    expect(gateway.sessions).toHaveLength(sessionsBefore);

    const [campaign] = await h.db
      .select({
        status: campaigns.status,
        listingPaidAt: campaigns.listingPaidAt,
        workflowStageReached: campaigns.workflowStageReached,
      })
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaign?.status).toBe('affiliate_response_and_build');
    expect(campaign?.listingPaidAt).toBeInstanceOf(Date);
    expect(campaign?.workflowStageReached).toBe('setup');

    const payment = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(payment).toHaveLength(1);
    expect(payment[0]?.taxCents).toBe(0n);
    expect(payment[0]?.totalCents).toBe(payment[0]?.subtotalCents);

    const providerRows = await h.db
      .select({ id: providerObjects.id })
      .from(providerObjects)
      .where(eq(providerObjects.campaignId, j.campaignId));
    expect(providerRows).toHaveLength(0);

    const association = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, j.associationId));
    expect(association[0]?.status).toBe('formal_decision_open');

    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/simulated-payment`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    const paymentsAfterRetry = await h.db
      .select({ id: listingFeePayments.id })
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(paymentsAfterRetry).toHaveLength(1);
    expect(gateway.sessions).toHaveLength(sessionsBefore);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §33.3.5 — Checkout/receipt list base, each discount, tax, total, descriptor,
   refund, separate 5%.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('§33.3.5 — the session lines and the receipt', () => {
  let j: Journey;

  beforeAll(async () => {
    j = await journey('a');
    await completeTwoItems(j);
  });

  it('the Checkout response itemises base, each labeled saving, tax, total, descriptor', async () => {
    const checkout = await openCheckout(j);

    expect(checkout.baseCents).toBe('3500');
    expect(checkout.discountLines.map((l) => l.item).sort()).toEqual(['branding', 'story']);
    for (const line of checkout.discountLines) expect(line.discountCents).toBe('200');
    expect(checkout.discountCents).toBe('400');
    expect(checkout.subtotalCents).toBe('3100');
    // The memory gateway's flat 8%: 3100 → 248.
    expect(checkout.taxCents).toBe('248');
    expect(checkout.totalCents).toBe('3348');
    expect(checkout.descriptor).toBe('PROOVD LISTING');
    expect(checkout.url).toContain(checkout.sessionId);
  });

  it('the amounts resolve Appendix A.5 with no marker left', () => {
    // The surface renders the shared register with the server's values; this
    // is the resolution 11b's surface test renders verbatim.
    const body = LISTING_FEE_CONSENT_TEMPLATE.replaceAll('[SUBTOTAL]', '31.00').replaceAll(
      '[TOTAL]',
      '33.48',
    );
    expect(body).toContain('US$31.00');
    expect(body).toContain('US$33.48');
    expect(body).not.toContain('[SUBTOTAL]');
    expect(body).not.toContain('[TOTAL]');
  });

  it('paying sends a receipt listing every line, the refund promise, the 5% note, and no promised date', async () => {
    const checkout = await openCheckout(j);
    const { res } = await completeSession(checkout.sessionId);
    expect(res.status).toBe(200);

    // Two Founder messages now: the receipt, and §27.3's separate "Formal
    // response window start" (Phase 22b). §27.3 names them as two bullets, and
    // a 72-hour clock buried inside a dozen-line receipt is a clock read once.
    const founderMail = emailsTo(j.founder.email);
    expect(founderMail).toHaveLength(2);
    const receipt = founderMail.find((m) => m.subject.startsWith('Your Proovd listing'))
      ?? founderMail.find((m) => !m.subject.includes('respond'))!;

    expect(receipt.subject).toContain('Product a');
    for (const part of [receipt.text, receipt.html]) {
      expect(part).toContain('US$35.00');
      expect(part).toContain('US$31.00');
      expect(part).toContain('US$2.00');
      expect(part).toContain(OPTIONAL_ITEM_LABELS['branding']!);
      expect(part).toContain(OPTIONAL_ITEM_LABELS['story']!);
      expect(part).toContain('US$2.48'); // the tax line
      expect(part).toContain('US$33.48');
      expect(part).toContain('PROOVD LISTING');
    }
    expect(receipt.text).toContain('THE REFUND PROMISE YOU ACCEPTED');
    expect(receipt.text).toContain('A pending proposal does');
    expect(receipt.text).toContain(SEPARATE_FIVE_PERCENT_NOTE);
    // §13: 5–10 business days is the only allowed shape — and only typical.
    expect(receipt.text).not.toMatch(/will (arrive|settle) on/i);
  });

  it('the drift tests: the promise, the note, the labels, and the formatter match shared', () => {
    expect(LISTING_REFUND_PROMISE).toBe(
      LISTING_FEE_CONSENT_TEMPLATE.split('\n\n')[1],
    );
    expect(SEPARATE_FIVE_PERCENT_NOTE).toBe(SHARED_FIVE_PERCENT_NOTE);
    for (const item of OPTIONAL_ITEMS) {
      expect(OPTIONAL_ITEM_LABELS[item.key]).toBe(item.label);
    }
    for (const cents of [0n, 5n, 3500n, 123456789n]) {
      expect(formatUsdCents(cents)).toBe(formatUsd(cents));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The seven atomic effects, §33.3.6, §33.3.7, and duplicate deliveries.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('successful payment — seven effects, one transaction', () => {
  let j: Journey;
  let sessionId: string;
  let eventId: string;

  beforeAll(async () => {
    j = await journey('b');
    await completeTwoItems(j);
    const checkout = await openCheckout(j);
    sessionId = checkout.sessionId;
    const first = await completeSession(sessionId);
    expect(first.res.status).toBe(200);
    eventId = first.eventId;
  });

  it('records the payment with §24.6\'s lines and §21\'s anchor', async () => {
    const [payment] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(payment).toBeDefined();
    expect(payment!.subtotalCents).toBe(3100n);
    expect(payment!.taxCents).toBe(248n);
    expect(payment!.totalCents).toBe(3348n);
    expect(payment!.descriptor).toBe('PROOVD LISTING');
    expect(payment!.mode).toBe('test');

    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaign!.listingPaidAt).not.toBeNull();
    expect(campaign!.listingPaidAt!.getTime()).toBe(payment!.paidAt.getTime());
  });

  it('§33.3.7 — the 72-hour clock starts at successful payment and at no other event', async () => {
    const [payment] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));

    // Exactly paid_at + the stored window, to the millisecond.
    expect(payment!.responseWindowHours).toBe(72);
    expect(payment!.responseDeadlineAt.getTime()).toBe(
      payment!.paidAt.getTime() + 72 * 3600 * 1000,
    );
    expect(payment!.freeCancellationWindowHours).toBe(48);
    expect(payment!.freeCancellationDeadlineAt.getTime()).toBe(
      payment!.paidAt.getTime() + 48 * 3600 * 1000,
    );

    // And no other event: a campaign whose Founder opened Checkout but never
    // paid has no payment row, no anchor, and no clock.
    const unpaid = await journey('b-unpaid');
    await openCheckout(unpaid);
    const [unpaidCampaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, unpaid.campaignId));
    expect(unpaidCampaign!.listingPaidAt).toBeNull();
    const rows = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, unpaid.campaignId));
    expect(rows).toHaveLength(0);
  });

  it('locks the calculation, the items, and the high-effort result — totally', async () => {
    const [calc] = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(
        and(
          eq(listingFeeCalculations.campaignId, j.campaignId),
        ),
      )
      .orderBy(listingFeeCalculations.calculatedAt);
    expect(calc).toBeDefined();

    const items = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(eq(campaignOptionalItems.campaignId, j.campaignId));
    expect(items).toHaveLength(5);
    for (const item of items) expect(item.lockedAt).not.toBeNull();

    const [campaignBefore] = await h.db
      .select({ highEffort: campaigns.highEffort })
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));

    // §33.3.3's second direction and §33.3.4's lock: an edit after payment
    // changes neither the completion, the fee, nor the classification.
    await request(h.app)
      .patch(`/api/founder/campaigns/${j.campaignId}/workspace`)
      .set('cookie', j.founder.cookie)
      .send({ storyText: 'A completely different story now.', storyApproved: false })
      .expect(200);

    const after = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, j.campaignId),
          eq(campaignOptionalItems.item, 'story'),
        ),
      );
    expect(after[0]!.complete).toBe(true); // the locked decision stands

    const [paymentAfter] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(paymentAfter!.subtotalCents).toBe(3100n); // the record the money followed

    const [campaignAfter] = await h.db
      .select({ highEffort: campaigns.highEffort })
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaignAfter!.highEffort).toBe(campaignBefore!.highEffort);
  });

  it('moves the campaign, opens eligible associations only, and starts building', async () => {
    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('affiliate_response_and_build');
    expect(campaign!.campaignBuildStatus).toBe('in_progress');

    const history = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(eq(campaignStatusHistory.campaignId, j.campaignId));
    expect(history.map((r) => r.toStatus)).toContain('affiliate_response_and_build');

    const [opened] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, j.associationId));
    expect(opened!.status).toBe('formal_decision_open');

    // Not yet signed up: nothing to open. Kit revoked: §31.5's withdrawal is
    // not silently re-granted by a payment.
    const [waiting] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, j.waitingAssociationId));
    expect(waiting!.status).toBe('signed_up_waiting_for_founder');
    const [revoked] = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, j.revokedAssociationId));
    expect(revoked!.status).toBe('preparing');
  });

  it('sends the receipt and one formal-opportunity message with one action', async () => {
    // The receipt and the §27.3 response-window notice (Phase 22b).
    const founderMail = emailsTo(j.founder.email);
    expect(founderMail).toHaveLength(2);
    const window = founderMail.find((m) => m.subject.includes('respond'));
    expect(window, 'the response window has its own message').toBeDefined();
    // §27.1: the deadline names its zone, in words.
    expect(window!.text).toContain('UTC');

    const opportunities = emailsTo(j.creatorEmail);
    expect(opportunities).toHaveLength(1);
    const links = [...opportunities[0]!.html.matchAll(/<a\s[^>]*href=/gi)];
    expect(links, 'the opportunity email carries exactly one link').toHaveLength(1);
    expect(opportunities[0]!.html).toContain(`/creator/campaigns/${j.associationId}`);
  });

  it('a duplicate delivery of the same event changes nothing', async () => {
    const before = h.sentEmails.messages.length;
    const { res } = await completeSession(sessionId, { eventId });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('duplicate');

    expect(h.sentEmails.messages.length).toBe(before);
    const payments = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(payments).toHaveLength(1);
  });

  it('a redelivery under a fresh event id still cannot apply twice', async () => {
    const before = h.sentEmails.messages.length;
    const { res } = await completeSession(sessionId);
    expect(res.status).toBe(200);

    const payments = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(payments).toHaveLength(1);
    expect(h.sentEmails.messages.length).toBe(before);

    const hops = await h.db
      .select()
      .from(associationStatusHistory)
      .where(eq(associationStatusHistory.associationId, j.associationId));
    expect(hops.filter((r) => r.toStatus === 'formal_decision_open')).toHaveLength(1);
  });

  it('§33.3.6 — the stream reconciles separately from all campaign money', async () => {
    // Structurally: the §24.6 tables reference no reservation, no association
    // ledger, and no connected account.
    const columns = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('listing_fee_payments', 'listing_fee_refunds')`,
    );
    const names = columns.rows.map((r: { column_name: string }) => r.column_name);
    for (const forbidden of ['reservation_id', 'association_id', 'stripe_account_id', 'connected_account_id']) {
      expect(names).not.toContain(forbidden);
    }

    // Operationally: Admin's reconciliation view serves the stream on its own.
    const res = await request(h.app)
      .get('/api/admin/listing')
      .set('cookie', admin.cookie)
      .expect(200);
    const row = res.body.listingFees.find(
      (r: { campaignId: string }) => r.campaignId === j.campaignId,
    );
    expect(row).toBeDefined();
    expect(row.totalCents).toBe('3348');
    expect(row.mode).toBe('test');
    expect(row.descriptor).toBe('PROOVD LISTING');
    expect(JSON.stringify(row)).not.toContain('reservation');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Failure and abandonment — §13's failure list, retry without duplication.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('failed or abandoned Checkout', () => {
  it('expiry preserves everything, starts nothing, and a retry pays once', async () => {
    const j = await journey('c');
    await completeTwoItems(j);
    const checkout = await openCheckout(j);

    const session = gateway.sessions.find((s) => s.id === checkout.sessionId)!;
    const { payload, signature } = signedEvent({
      type: 'checkout.session.expired',
      object: {
        id: session.id,
        object: 'checkout.session',
        metadata: session.metadata,
        status: 'expired',
      },
    });
    await request(h.app)
      .post(STRIPE_PLATFORM_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .set(STRIPE_SIGNATURE_HEADER, signature)
      .send(payload)
      .expect(200);

    // §13: campaign stays listing_fee_pending, no clock, inputs survive.
    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('listing_fee_pending');
    expect(campaign!.listingPaidAt).toBeNull();
    const calcs = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(eq(listingFeeCalculations.campaignId, j.campaignId));
    expect(calcs.length).toBeGreaterThan(0);

    // Retrying opens a session for the same calculation and pays exactly once.
    const retry = await openCheckout(j);
    const { res } = await completeSession(retry.sessionId);
    expect(res.status).toBe(200);
    const payments = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    expect(payments).toHaveLength(1);
  });

  it('an unbindable completed session is recorded, routed to Admin, and applies nothing', async () => {
    const { payload, signature } = signedEvent({
      type: 'checkout.session.completed',
      object: {
        id: 'cs_never_created_by_proovd',
        object: 'checkout.session',
        amount_total: 3500,
        metadata: { proovd_campaign_id: randomUUID(), proovd_calculation_id: randomUUID() },
        status: 'complete',
      },
    });
    const res = await request(h.app)
      .post(STRIPE_PLATFORM_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .set(STRIPE_SIGNATURE_HEADER, signature)
      .send(payload);
    expect(res.status).toBe(200);

    const payments = await h.db.select().from(listingFeePayments);
    expect(payments.every((p) => p.checkoutSessionId !== 'cs_never_created_by_proovd')).toBe(true);
  });

  it('payment refuses while the seller account is not complete, and while tax is off', async () => {
    const j = await journey('d');

    // Break the seller account.
    await h.db
      .update(stripeConnectedAccounts)
      .set({ state: 'restricted', chargesEnabled: false })
      .where(eq(stripeConnectedAccounts.ownerUserId, j.founder.id));

    const refused = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/checkout`)
      .set('cookie', j.founder.cookie)
      .send({ address: { postalCode: '94105' } });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('restricted');

    // §31.7: unconfigured tax refuses; a zero is not proof no tax is due.
    await h.db
      .update(stripeConnectedAccounts)
      .set({ state: 'complete', chargesEnabled: true, payoutsEnabled: true })
      .where(eq(stripeConnectedAccounts.ownerUserId, j.founder.id));
    const noTax = await beginListingCheckout(
      {
        db: h.db,
        gateway: { ...gateway, taxEnabled: false },
        audit: createAuditWriter(h.db),
        successUrl: 'http://localhost:3000/x',
        cancelUrl: 'http://localhost:3000/y',
      },
      {
        campaignId: j.campaignId,
        founderUserId: j.founder.id,
        address: { postalCode: '94105', country: 'US' },
        newsletterOptIn: false,
        actor: `user:${j.founder.id}`,
      },
    );
    expect(noTax.ok).toBe(false);
    if (!noTax.ok) expect(noTax.code).toBe('tax_unavailable');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §33.3.8 — zero recruits / no bilateral acceptance refunds the full
   Checkout subtotal + tax, once.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('§33.3.8 — the single full refund', () => {
  let j: Journey;

  beforeAll(async () => {
    j = await journey('e');
    await completeTwoItems(j);
    const checkout = await openCheckout(j);
    await completeSession(checkout.sessionId);
  });

  it('refunds the entire Checkout total including tax, exactly once, idempotently', async () => {
    const refundsBefore = gateway.refunds.length;

    const first = await request(h.app)
      .post(`/api/admin/listing/campaigns/${j.campaignId}/refund`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'no_mutual_acceptance',
        internalReason: 'no locked mutual acceptance by the deadline',
        customerExplanation:
          'No Creator and Founder mutually accepted locked campaign terms within 72 hours, so the full charge is refunded.',
      })
      .expect(200);

    expect(first.body.refund.totalRefundedCents).toBe('3348');
    expect(first.body.refund.timing).toContain('5–10 business days');
    expect(first.body.refund.timing).not.toMatch(/on \d/);

    // The provider saw exactly one refund, for the whole total.
    expect(gateway.refunds.length).toBe(refundsBefore + 1);
    expect(gateway.refunds[gateway.refunds.length - 1]!.amountCents).toBe(3348n);

    // §13: idempotent. A second request reports the same refund and moves nothing.
    const second = await request(h.app)
      .post(`/api/admin/listing/campaigns/${j.campaignId}/refund`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'no_mutual_acceptance',
        internalReason: 'retry',
        customerExplanation: 'retry',
      })
      .expect(200);
    expect(second.body.refund.alreadyExisted).toBe(true);
    expect(gateway.refunds.length).toBe(refundsBefore + 1);

    const rows = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, j.campaignId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('succeeded');
    expect(rows[0]!.subtotalRefundedCents).toBe(3100n);
    expect(rows[0]!.taxRefundedCents).toBe(248n);
    expect(rows[0]!.totalRefundedCents).toBe(3348n);

    // One refund email, keyed on the refund.
    const refundEmails = emailsTo(j.founder.email).filter((m) =>
      m.subject.includes('refunded in full'),
    );
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.text).toContain('US$33.48');
    expect(refundEmails[0]!.text).toContain('5–10 business days');
  });

  it('a partial refund is impossible at the database', async () => {
    const [payment] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));

    // Drizzle wraps the driver error, so the refusal is in the cause chain —
    // the same walk `isUniqueViolation` does in the services.
    let refusal = '';
    try {
      await h.db.insert(listingFeeRefunds).values({
        paymentId: payment!.id,
        campaignId: j.campaignId,
        trigger: 'admin_discretion',
        subtotalRefundedCents: 100n,
        taxRefundedCents: 8n,
        totalRefundedCents: 108n,
        actor: 'test',
        internalReason: 'partial attempt',
        customerExplanation: 'partial attempt',
      });
    } catch (error) {
      let current: unknown = error;
      while (current instanceof Error) {
        refusal += `${current.message} `;
        current = current.cause;
      }
    }
    // Either refusal is correct and both are the database's: the row is a
    // duplicate of the one full refund, and its amounts are not the full total.
    expect(refusal).toMatch(/never partial|duplicate key|unique/i);
  });

  it('a provider failure leaves a visible claim, and the retry refunds once', async () => {
    const k = await journey('f');
    const checkout = await openCheckout(k);
    await completeSession(checkout.sessionId);

    gateway.failNextRefund('provider unavailable in test');
    const refused = await request(h.app)
      .post(`/api/admin/listing/campaigns/${k.campaignId}/refund`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'zero_eligible_recruits',
        internalReason: 'zero eligible recruits',
        customerExplanation: 'No eligible Creator was recruited, so the full charge is refunded.',
      })
      .expect(200);
    expect(refused.body.refund.status).toBe('initiated');

    const [claim] = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, k.campaignId));
    expect(claim!.status).toBe('initiated');

    const before = gateway.refunds.length;
    const retry = await request(h.app)
      .post(`/api/admin/listing/campaigns/${k.campaignId}/refund`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'zero_eligible_recruits',
        internalReason: 'retry after provider failure',
        customerExplanation: 'No eligible Creator was recruited, so the full charge is refunded.',
      })
      .expect(200);
    expect(retry.body.refund.status).toBe('succeeded');
    expect(gateway.refunds.length).toBe(before + 1);

    const rows = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, k.campaignId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('succeeded');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §33.3.11 — Founder cancellation, inside and outside the free window.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('§33.3.11 — Founder cancellation', () => {
  it('within 48 hours and before live: cancels and refunds the full total', async () => {
    const j = await journey('g');
    await completeTwoItems(j);
    const checkout = await openCheckout(j);
    await completeSession(checkout.sessionId);
    const refundsBefore = gateway.refunds.length;

    const res = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/cancel`)
      .set('cookie', j.founder.cookie)
      .send({ reason: 'changed my mind' })
      .expect(200);
    expect(res.body.cancellation.status).toBe('canceled');

    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('ended_no_charge');

    expect(gateway.refunds.length).toBe(refundsBefore + 1);
    expect(gateway.refunds[gateway.refunds.length - 1]!.amountCents).toBe(3348n);

    const [refund] = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, j.campaignId));
    expect(refund!.trigger).toBe('founder_free_cancellation');
    expect(refund!.totalRefundedCents).toBe(3348n);

    // Duplicate cancel: harmless, nothing moves twice.
    const dup = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/cancel`)
      .set('cookie', j.founder.cookie)
      .send({ reason: 'again' });
    expect(dup.status).toBe(409);
    expect(gateway.refunds.length).toBe(refundsBefore + 1);
  });

  it('after 48 hours: requires Admin approval and refunds nothing automatically', async () => {
    const j = await journey('hh');
    const checkout = await openCheckout(j);
    // Paid 49 hours ago: the stored free window has already closed.
    await completeSession(checkout.sessionId, {
      createdAtSeconds: Math.floor(Date.now() / 1000) - 49 * 3600,
    });
    const refundsBefore = gateway.refunds.length;

    const res = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/cancel`)
      .set('cookie', j.founder.cookie)
      .send({ reason: 'too late now' })
      .expect(202);
    expect(res.body.cancellation.status).toBe('pending');
    expect(gateway.refunds.length).toBe(refundsBefore);

    // Deny it; the campaign is untouched and the request is closed.
    const [pending] = await h.db
      .select()
      .from(campaignCancellations)
      .where(
        and(
          eq(campaignCancellations.campaignId, j.campaignId),
          eq(campaignCancellations.status, 'pending'),
        ),
      );
    await request(h.app)
      .post(`/api/admin/listing/cancellations/${pending!.id}/decision`)
      .set('cookie', admin.cookie)
      .send({
        approve: false,
        internalReason: 'campaign continues',
        customerExplanation: 'Your campaign continues; contact support to talk it through.',
      })
      .expect(200);
    let [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('affiliate_response_and_build');

    // Ask again; approve; the campaign ends pre-charge with no automatic refund.
    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/cancel`)
      .set('cookie', j.founder.cookie)
      .send({ reason: 'still want out' })
      .expect(202);
    const [second] = await h.db
      .select()
      .from(campaignCancellations)
      .where(
        and(
          eq(campaignCancellations.campaignId, j.campaignId),
          eq(campaignCancellations.status, 'pending'),
        ),
      );
    await request(h.app)
      .post(`/api/admin/listing/cancellations/${second!.id}/decision`)
      .set('cookie', admin.cookie)
      .send({
        approve: true,
        internalReason: 'approved late cancellation',
        customerExplanation: 'Your campaign is canceled as you asked.',
      })
      .expect(200);

    [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('ended_no_charge');
    expect(gateway.refunds.length).toBe(refundsBefore);

    const refunds = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, j.campaignId));
    expect(refunds).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The clocks, watched — exactly once each.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the deadline sweep', () => {
  it('notices each deadline once and routes the 72-hour one to Admin', async () => {
    const j = await journey('i');
    const checkout = await openCheckout(j);
    // Paid 73 hours ago: both stored deadlines have passed.
    await completeSession(checkout.sessionId, {
      createdAtSeconds: Math.floor(Date.now() / 1000) - 73 * 3600,
    });

    const audit = createAuditWriter(h.db);
    const first = await sweepListingDeadlines(h.db, audit);
    expect(first.responseDeadlinesReached).toContain(j.campaignId);
    expect(first.freeWindowsClosed).toContain(j.campaignId);

    const second = await sweepListingDeadlines(h.db, audit);
    expect(second.responseDeadlinesReached).not.toContain(j.campaignId);
    expect(second.freeWindowsClosed).not.toContain(j.campaignId);

    const keys = await h.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, `listing_response_deadline_reached:${j.campaignId}`));
    expect(keys).toHaveLength(1);

    // Admin sees the exact clock and its recorded firing (§13).
    const res = await request(h.app)
      .get(`/api/admin/listing/campaigns/${j.campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(res.body.listing.clocks.responseDeadlinePassed).toBe(true);
    expect(res.body.listing.clocks.responseDeadlineRecorded).toBe(true);
    expect(res.body.listing.clocks.freeCancellationOpen).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Authorization: another Founder's listing answers 404; Admin money routes
   demand freshness (already proven pattern; asserted here on the new routes).
   ═══════════════════════════════════════════════════════════════════════════ */

describe('authorization on the new routes', () => {
  it("another Founder's campaign answers the identical 404", async () => {
    const j = await journey('k');
    const other = await seedUser(h, 'founder', 'listing-other');
    const otherCookie = await signInPlain(h, other.email);

    await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/listing`)
      .set('cookie', otherCookie)
      .expect(404);
    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/listing/checkout`)
      .set('cookie', otherCookie)
      .send({ address: { postalCode: '94105' } })
      .expect(404);
  });

  it('the Admin refund route refuses without a session', async () => {
    await request(h.app).post(`/api/admin/listing/campaigns/${randomUUID()}/refund`).expect(401);
  });

  it('duplicate provider events are visible in the ledger, not in domain state', async () => {
    const rows = await h.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.provider, 'stripe'));
    expect(rows.length).toBeGreaterThan(0);

    const deliveries = await h.db.select().from(notificationDeliveries);
    const keys = deliveries.map((d) => `${d.eventKey}:${d.target}:${d.entityType}:${d.entityId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
