/**
 * Phase 12a — the formal Affiliate decisions, the immutable proposal versions,
 * the bilateral lock, and the §14.6 no-acceptance deadline.
 *
 * Acceptance: §33.2.5 through §33.2.13 — nine named tests, the §33.2 half of
 * Phase 12's thirteen. (§33.3.9, §33.3.10, §33.4.1, §33.4.2 are 12b's.)
 *
 * The draft-policy refusal runs FIRST, in its own describe, because §29.8
 * makes publication one-way (affiliate-signup.test.ts documents the same
 * constraint at length).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_PLATFORM_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  associationStatusHistory,
} from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles, policyConsents } from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { listingFeePayments, listingFeeRefunds } from '../db/schema/listing.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  associationAcceptanceConfirmations,
  trackingLinks,
  creatorBonuses,
  responseDeadlineEvaluations,
} from '../db/schema/decisions.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { sweepListingDeadlines } from '../payments/listing-clocks.js';
import { IP_AGREEMENT_SLUG } from '../affiliates/decisions.js';
import {
  FOUNDER_ROSTER_STATUS_LABELS as BACKEND_ROSTER_LABELS,
  PENDING_PROPOSAL_NOTE as BACKEND_PENDING_NOTE,
  NO_FIXED_MONEY_AT_FIRST_POST as BACKEND_NO_FIXED,
  DECLINE_NO_PENALTY_NOTE as BACKEND_DECLINE_NOTE,
  LINK_TEST_MARKER as BACKEND_LINK_TEST_MARKER,
} from '../affiliates/roster-labels.js';
import {
  FOUNDER_ROSTER_STATUS_LABELS,
  PENDING_PROPOSAL_NOTE,
  NO_FIXED_MONEY_AT_FIRST_POST,
  DECLINE_NO_PENALTY_NOTE,
  LINK_TEST_MARKER,
  ASSOCIATION_STATUSES,
  resolveCompensation,
  combinedPercent,
  earnedBonusPercent,
  creatorAttributedResults,
  MoneyRuleError,
  type CapturedCharge,
} from '@proovd/shared';

const PLATFORM_SECRET = 'whsec_platform_for_decisions_suite';
const CONNECT_SECRET = 'whsec_connect_for_decisions_suite';

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
      stripeConnectUrls: {
        returnUrl: 'https://app.example.com/stripe/return',
        refreshUrl: 'https://app.example.com/stripe/refresh',
      },
      authRouteLimit: 1_000_000,
      globalRateLimit: 1_000_000,
    },
    'decisions',
  );
  admin = await createAdmin(h, 'decisions-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── One journey: a paid campaign with signed-in Creators ─────────────────── */

interface Creator {
  associationId: string;
  userId: string;
  email: string;
  cookie: string;
}

interface Journey {
  campaignId: string;
  founder: { id: string; email: string; cookie: string };
  creators: Creator[];
}

const CONFIRM = {
  compensationTerms: true,
  ipAgreement: true,
  ftcDisclosure: true,
  termsAup: true,
};

async function journey(
  label: string,
  options: { type?: 'pre_build' | 'pre_launch'; highEffort?: boolean; creators?: number } = {},
): Promise<Journey> {
  const type = options.type ?? 'pre_launch';
  const founder = await seedUser(h, 'founder', `dec-founder-${label}`);
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

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'account_claimed',
      type,
      typeLockedAt: new Date(),
      highEffort: options.highEffort ?? false,
      highEffortCalculatedAt: new Date(),
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
    preferredName: `Fondi-${label}`,
    legalName: `Founder ${label}`,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_dec${label.replace(/[^a-z0-9]/gi, '')}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.id,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  const creators: Creator[] = [];
  for (let i = 0; i < (options.creators ?? 1); i += 1) {
    const user = await seedUser(h, 'affiliate', `dec-creator-${label}-${i}`);
    const creatorCookie = await signInPlain(h, user.email);
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: `Creator ${label}-${i}`,
        publicHandle: `@creator-${label}-${i}`,
        email: user.email,
        subtype: 'social_creator',
        audienceNiche: 'hardware and prototyping',
        audienceSize: '120k followers',
        adminBio: 'Reviews early hardware for a technical audience.',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });

    const [assoc] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: randomUUID(),
        prospectId: cp!.id,
        status: 'preparing',
        rosterMembership: 'initial_roster',
        preparingRevealedAt: new Date(),
        whyRecruited: 'Your audience builds hardware. This campaign is a hardware tool.',
      })
      .returning({ id: campaignAffiliateAssociations.id });

    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId: assoc!.id,
      email: user.email,
      publicHandle: `@creator-${label}-${i}`,
      claimedUserId: user.id,
      claimedAt: new Date(),
      updatedBy: 'test',
    });

    creators.push({
      associationId: assoc!.id,
      userId: user.id,
      email: user.email,
      cookie: creatorCookie,
    });
  }

  // Opening the workspace creates the calculation the Checkout charges — and
  // classifies high-effort. §12: high effort = true when ALL THREE inputs are
  // absent, so a bare campaign is high-effort. A STANDARD campaign is earned
  // the way a real one is: a recorded Admin override completes Branding, and
  // the re-evaluation classifies standard.
  await request(h.app)
    .get(`/api/founder/campaigns/${campaignId}/workspace`)
    .set('cookie', cookie)
    .expect(200);

  if (!(options.highEffort ?? false)) {
    await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/branding/override`)
      .set('cookie', admin.cookie)
      .send({
        complete: true,
        reason: 'brand direction reviewed with the Founder on a call',
        explanation: 'We reviewed your branding together and counted it as complete.',
        evidence: 'call recording 2026-08-01',
      })
      .expect(200);
    await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
  }

  return { campaignId, founder: { ...founder, cookie }, creators };
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

/** Pays the listing fee, opening the formal decisions (§13 effect 4). */
async function payListing(j: Journey, createdAtSeconds?: number): Promise<void> {
  const res = await request(h.app)
    .post(`/api/founder/campaigns/${j.campaignId}/listing/checkout`)
    .set('cookie', j.founder.cookie)
    .send({ address: { postalCode: '94105', state: 'CA', country: 'US' }, newsletterOptIn: false })
    .expect(200);
  const { res: hook } = await completeSession(
    res.body.checkout.sessionId,
    createdAtSeconds ? { createdAtSeconds } : {},
  );
  expect(hook.status).toBe(200);
}

async function association(id: string) {
  const [row] = await h.db
    .select()
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, id));
  return row!;
}

async function agreementOf(associationId: string) {
  const [row] = await h.db
    .select()
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, associationId));
  return row ?? null;
}

async function versionsOf(associationId: string) {
  return h.db
    .select()
    .from(proposalVersions)
    .where(eq(proposalVersions.associationId, associationId))
    .orderBy(proposalVersions.versionNumber);
}

const accept = (c: Creator, body: Record<string, unknown> = CONFIRM) =>
  request(h.app)
    .post(`/api/creator/campaigns/${c.associationId}/accept`)
    .set('cookie', c.cookie)
    .send(body);

const decline = (c: Creator, reason?: string) =>
  request(h.app)
    .post(`/api/creator/campaigns/${c.associationId}/decline`)
    .set('cookie', c.cookie)
    .send(reason ? { reason } : {});

const propose = (c: Creator, body: Record<string, unknown>) =>
  request(h.app)
    .post(`/api/creator/campaigns/${c.associationId}/proposals`)
    .set('cookie', c.cookie)
    .send(body);

const creatorRespond = (c: Creator, versionId: string, body: Record<string, unknown>) =>
  request(h.app)
    .post(`/api/creator/proposals/${versionId}/respond`)
    .set('cookie', c.cookie)
    .send(body);

const founderRespond = (j: Journey, versionId: string, body: Record<string, unknown>) =>
  request(h.app)
    .post(`/api/founder/proposals/${versionId}/respond`)
    .set('cookie', j.founder.cookie)
    .send(body);

/** Publishes what the §14.2 acceptance requires. One-way; idempotent. */
async function publishDecisionPolicies(): Promise<void> {
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(
      and(
        inArray(policyVersions.slug, [IP_AGREEMENT_SLUG, 'terms', 'affiliate-aup', 'aup']),
        eq(policyVersions.status, 'draft'),
      ),
    );
}

const emailsTo = (address: string) => h.sentEmails.messages.filter((m) => m.to === address);

/**
 * Asserts a write is refused by the database with the trigger's own message.
 * Drizzle wraps the driver error, so the Postgres text lives down the cause
 * chain — the same walk `isUniqueViolation` does in the services.
 */
async function expectDbRefusal(work: Promise<unknown>, message: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const texts: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    texts.push(current.message);
    current = current.cause;
  }
  expect(texts.join(' | ')).toMatch(message);
}

/* ═══ The draft-agreement refusal — must run before anything publishes ═════ */

describe('§14.2 + §31.5 — a draft IP agreement blocks acceptance, in the open', () => {
  it('refuses with policies_unpublished and changes nothing', async () => {
    const j = await journey('draft');
    await payListing(j);

    const res = await accept(j.creators[0]!).expect(409);
    expect(res.body.error).toBe('policies_unpublished');
    expect(res.body.whatHappened).toMatch(/still with our lawyers/i);

    expect((await association(j.creators[0]!.associationId)).status).toBe('formal_decision_open');
    expect(await agreementOf(j.creators[0]!.associationId)).toBeNull();
  });
});

/* ═══ §33.2.5 — listing payment activates the decision exactly once ════════ */

describe('§33.2.5 — activation is exactly once', () => {
  let j: Journey;

  beforeAll(async () => {
    await publishDecisionPolicies();
    j = await journey('activate');
    await payListing(j);
  });

  it('opens the formal decision with the §25.4 activation stamp', async () => {
    const row = await association(j.creators[0]!.associationId);
    expect(row.status).toBe('formal_decision_open');
    expect(row.formalOpenedAt).not.toBeNull();
  });

  it('a duplicate delivery under a fresh event id activates nothing twice', async () => {
    const sessionId = gateway.sessions.find((s) =>
      s.metadata['proovd_campaign_id'] === j.campaignId,
    )!.id;
    const again = await completeSession(sessionId);
    expect(again.res.status).toBe(200);

    const hops = await h.db
      .select()
      .from(associationStatusHistory)
      .where(
        and(
          eq(associationStatusHistory.associationId, j.creators[0]!.associationId),
          eq(associationStatusHistory.toStatus, 'formal_decision_open'),
        ),
      );
    expect(hops).toHaveLength(1);

    const opportunities = await h.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventKey, 'affiliate_formal_opportunity_available'),
          eq(notificationDeliveries.entityId, j.creators[0]!.associationId),
        ),
      );
    expect(opportunities).toHaveLength(1);
  });
});

/* ═══ §33.2.6 — accept, decline, propose are all reachable ═════════════════ */

describe('§33.2.6 — the three decisions', () => {
  it('the opportunity names all three outcomes and hides none', async () => {
    const j = await journey('reach', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    const res = await request(h.app)
      .get(`/api/creator/campaigns/${c.associationId}/opportunity`)
      .set('cookie', c.cookie)
      .expect(200);
    const o = res.body.opportunity;
    expect(o.decisionsAvailable).toBe(true);
    expect(o.whyThisFitsYourAudience).toMatch(/your audience/i);
    expect(o.compensation.basePercent).toBe(30);
    expect(o.compensation.bidAllowed).toBe(true);
    expect(o.compensation.fixedPaymentAvailable).toBe(true);
    expect(o.responseDeadlineAt).not.toBeNull();
    // §14.5: the first read records `reviewing`.
    expect((await association(c.associationId)).status).toBe('reviewing');
  });

  it('accept locks standard terms, mints an INACTIVE link, and confirms durably', async () => {
    const j = await journey('accept');
    await payListing(j);
    const c = j.creators[0]!;

    const res = await accept(c).expect(200);
    expect(res.body.accepted.totalPercent).toBe(30);

    const row = await association(c.associationId);
    expect(row.status).toBe('accepted'); // §14.2: accepted, not active.

    const agreement = await agreementOf(c.associationId);
    expect(agreement!.source).toBe('standard_terms');
    expect(agreement!.totalPercent).toBe(30);
    expect(agreement!.fixedPaymentCents).toBeNull();

    const [link] = await h.db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.associationId, c.associationId));
    expect(link).toBeDefined();
    expect(link!.active).toBe(false);
    expect(link!.activatedAt).toBeNull();

    // §31.5: the per-association instance cites the published version.
    const [confirmation] = await h.db
      .select()
      .from(associationAcceptanceConfirmations)
      .where(eq(associationAcceptanceConfirmations.associationId, c.associationId));
    expect(confirmation).toBeDefined();
    const [consent] = await h.db
      .select()
      .from(policyConsents)
      .where(eq(policyConsents.id, confirmation!.ipAgreementConsentId));
    expect(consent!.slug).toBe(IP_AGREEMENT_SLUG);

    // §14.2: the durable confirmation — worked example, fixed vs conditional,
    // and the no-fixed-money-at-first-post statement.
    const confirmations = emailsTo(c.email).filter((m) => /terms.*locked/i.test(m.subject));
    expect(confirmations).toHaveLength(1);
    const message = confirmations[0]!;
    expect(message.text).toContain('US$100.00');
    expect(message.text).toContain('US$30.00');
    expect(message.text).toContain(NO_FIXED_MONEY_AT_FIRST_POST);
    expect(message.text).toMatch(/inactive/i);
  });

  it('a missing confirmation refuses by name — no bundling (§28.4)', async () => {
    const j = await journey('confirm');
    await payListing(j);
    const res = await accept(j.creators[0]!, { ...CONFIRM, ftcDisclosure: false }).expect(422);
    expect(res.body.error).toBe('confirmations_incomplete');
    expect(res.body.missing).toEqual(['ftcDisclosure']);
    expect(await agreementOf(j.creators[0]!.associationId)).toBeNull();
  });

  it('decline records time and optional reason, and carries no penalty', async () => {
    const j = await journey('decline');
    await payListing(j);
    const c = j.creators[0]!;

    await decline(c, 'Not a fit for my audience right now').expect(200);

    const row = await association(c.associationId);
    expect(row.status).toBe('declined');
    expect(row.declinedAt).not.toBeNull();
    expect(row.declineReason).toBe('Not a fit for my audience right now');

    // No penalty: the prospect record survives untouched and the confirmation
    // says so in the promised words.
    const [prospect] = await h.db
      .select()
      .from(affiliateProspects)
      .where(eq(affiliateProspects.email, c.email));
    expect(prospect).toBeDefined();
    const confirmations = emailsTo(c.email).filter((m) => /decline was recorded/i.test(m.subject));
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.text).toContain(DECLINE_NO_PENALTY_NOTE);
  });

  it('propose is reachable and notifies both parties', async () => {
    const j = await journey('propose', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    const res = await propose(c, { bidTotalPercent: 40 }).expect(200);
    expect(res.body.proposal.versionNumber).toBe(1);
    expect((await association(c.associationId)).status).toBe('proposal_pending');

    expect(emailsTo(c.email).some((m) => /proposal was submitted/i.test(m.subject))).toBe(true);
    expect(emailsTo(j.founder.email).some((m) => /Creator proposed terms/i.test(m.subject))).toBe(
      true,
    );
  });
});

/* ═══ §33.2.7 — the six matrix cells ═══════════════════════════════════════ */

describe('§33.2.7 — six compensation-matrix cells', () => {
  it('the four campaign configurations serve the correct cell facts', async () => {
    const configs: Array<{
      type: 'pre_build' | 'pre_launch';
      highEffort: boolean;
      bid: boolean;
      fixed: boolean;
    }> = [
      { type: 'pre_build', highEffort: false, bid: false, fixed: false },
      { type: 'pre_build', highEffort: true, bid: true, fixed: false },
      { type: 'pre_launch', highEffort: false, bid: false, fixed: true },
      { type: 'pre_launch', highEffort: true, bid: true, fixed: true },
    ];

    for (const [index, config] of configs.entries()) {
      const j = await journey(`cell${index}`, {
        type: config.type,
        highEffort: config.highEffort,
      });
      await payListing(j);
      const c = j.creators[0]!;
      const res = await request(h.app)
        .get(`/api/creator/campaigns/${c.associationId}/opportunity`)
        .set('cookie', c.cookie)
        .expect(200);
      const cell = res.body.opportunity.compensation;
      expect(cell.basePercent).toBe(30);
      expect(cell.bidAllowed).toBe(config.bid);
      expect(cell.fixedPaymentAvailable).toBe(config.fixed);
      expect(cell.ceilingPercent).toBe(50);
      if (config.fixed) expect(cell.basePercentWithFixed).toBe(20);

      // Drift: the Phase 03 kernel answers identically for the same cell.
      const shared = resolveCompensation(config.type, config.highEffort, false);
      expect(shared.basePercent).toBe(cell.basePercent);
      expect(shared.bidAllowed).toBe(cell.bidAllowed);
      expect(shared.fixedPaymentAllowed).toBe(cell.fixedPaymentAvailable);
    }
  });

  it('an accepted fixed payment produces the 20% base (Product, standard)', async () => {
    const j = await journey('fixedstd', { type: 'pre_launch', highEffort: false });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { fixedPaymentRequestCents: '50000' }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'accept' }).expect(200);

    const agreement = await agreementOf(c.associationId);
    expect(agreement!.basePercent).toBe(20);
    expect(agreement!.bidIncreasePercent).toBe(0);
    expect(agreement!.totalPercent).toBe(20);
    expect(agreement!.fixedPaymentCents).toBe(50000n);

    const shared = resolveCompensation('pre_launch', false, true);
    expect(shared.basePercent).toBe(20);
  });

  it('an accepted fixed payment plus a bid produces 20 + increase (Product, high effort)', async () => {
    const j = await journey('fixedhigh', { type: 'pre_launch', highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 45, fixedPaymentRequestCents: '25000' }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'accept' }).expect(200);

    const agreement = await agreementOf(c.associationId);
    expect(agreement!.basePercent).toBe(20);
    expect(agreement!.bidIncreasePercent).toBe(25);
    expect(agreement!.totalPercent).toBe(45);
    expect(agreement!.fixedPaymentCents).toBe(25000n);
  });
});

/* ═══ §33.2.8 — the two refusals ═══════════════════════════════════════════ */

describe('§33.2.8 — Idea rejects a fixed request; standard rejects a bid above base', () => {
  it('an Idea Campaign refuses a fixed-payment request, at the route and in the database', async () => {
    const j = await journey('ideafixed', { type: 'pre_build', highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    const res = await propose(c, { fixedPaymentRequestCents: '50000' }).expect(422);
    expect(res.body.error).toBe('invalid_terms');
    expect(res.body.whatHappened).toMatch(/Idea Campaign/);

    // The 0017 trigger holds even for a hand-written INSERT.
    await expectDbRefusal(
      h.db.insert(proposalVersions).values({
        associationId: c.associationId,
        campaignId: j.campaignId,
        versionNumber: 99,
        proposedBy: 'affiliate',
        fixedPaymentRequestCents: 50000n,
        state: 'awaiting_founder',
        affiliateDecision: 'proposed',
        affiliateDecidedAt: new Date(),
      }),
      /Idea Campaign/,
    );
  });

  it('a standard campaign refuses a bid above base', async () => {
    const j = await journey('stdbid', { type: 'pre_launch', highEffort: false });
    await payListing(j);
    const res = await propose(j.creators[0]!, { bidTotalPercent: 40 }).expect(422);
    expect(res.body.error).toBe('invalid_terms');
    expect(res.body.whatHappened).toMatch(/high-effort/i);
    expect(await versionsOf(j.creators[0]!.associationId)).toHaveLength(0);
  });
});

/* ═══ §33.2.9 + §33.2.10 — versioning, stale responses, the bilateral lock ═ */

describe('§33.2.9 / §33.2.10 — only exact bilateral acceptance locks, once', () => {
  it('a Founder revision is a new immutable version awaiting the Creator — not acceptance', async () => {
    const j = await journey('revise', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 40 }).expect(200);
    const [v1] = await versionsOf(c.associationId);

    const res = await founderRespond(j, v1!.id, { action: 'revise', bidTotalPercent: 35 }).expect(
      200,
    );
    expect(res.body.response.outcome).toBe('revised');
    expect(res.body.response.state).toBe('awaiting_creator');

    const versions = await versionsOf(c.associationId);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.state).toBe('superseded');
    expect(versions[0]!.supersededByVersionId).toBe(versions[1]!.id);
    expect(versions[1]!.state).toBe('awaiting_creator');
    expect(versions[1]!.proposedBy).toBe('founder');

    // Not acceptance: nothing locked, nothing agreed.
    expect(await agreementOf(c.associationId)).toBeNull();
    expect((await association(c.associationId)).status).toBe('proposal_pending');
  });

  it('a stale acceptance of a superseded version matches nothing', async () => {
    const j = await journey('stale', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 40 }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'revise', bidTotalPercent: 35 }).expect(200);

    // The Founder now answers the version they already superseded.
    const res = await founderRespond(j, v1!.id, { action: 'accept' }).expect(409);
    expect(res.body.error).toBe('stale_version');
    expect(await agreementOf(c.associationId)).toBeNull();

    const locked = await h.db
      .select()
      .from(proposalVersions)
      .where(
        and(eq(proposalVersions.associationId, c.associationId), eq(proposalVersions.state, 'locked')),
      );
    expect(locked).toHaveLength(0);
  });

  it('concurrent accept-and-counter resolves to exactly one outcome, never two locks', async () => {
    const j = await journey('race', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 40 }).expect(200);
    const [v1] = await versionsOf(c.associationId);

    // The Founder accepts v1 while simultaneously revising it.
    const [acceptRes, counterRes] = await Promise.all([
      founderRespond(j, v1!.id, { action: 'accept' }),
      founderRespond(j, v1!.id, { action: 'revise', bidTotalPercent: 35 }),
    ]);

    const outcomes = [acceptRes.status, counterRes.status].sort();
    expect(outcomes[0]).toBe(200);
    expect(outcomes[1]).toBe(409);

    const locked = await h.db
      .select()
      .from(proposalVersions)
      .where(
        and(eq(proposalVersions.associationId, c.associationId), eq(proposalVersions.state, 'locked')),
      );
    const agreements = await h.db
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.associationId, c.associationId));

    if (acceptRes.status === 200) {
      expect(locked).toHaveLength(1);
      expect(agreements).toHaveLength(1);
      expect(agreements[0]!.totalPercent).toBe(40);
    } else {
      // The revision won; nothing locked.
      expect(locked).toHaveLength(0);
      expect(agreements).toHaveLength(0);
    }
  });

  it('a second acceptance changes nothing — one lock, one agreement, ever', async () => {
    const j = await journey('double', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 38 }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'accept' }).expect(200);
    const second = await founderRespond(j, v1!.id, { action: 'accept' });
    expect(second.status).toBeGreaterThanOrEqual(400);

    const agreements = await h.db
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.associationId, c.associationId));
    expect(agreements).toHaveLength(1);
    expect(agreements[0]!.totalPercent).toBe(38);
    // §14.2: the locked version carries both decisions and times.
    const [lockedVersion] = await h.db
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.id, v1!.id));
    expect(lockedVersion!.state).toBe('locked');
    expect(lockedVersion!.affiliateDecision).toBe('proposed');
    expect(lockedVersion!.founderDecision).toBe('accepted');
    expect(lockedVersion!.lockedAt).not.toBeNull();
  });

  it('the Creator accepting a Founder revision locks that exact version, with the §14.2 requirements', async () => {
    const j = await journey('bilateral', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 44 }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'revise', bidTotalPercent: 36 }).expect(200);
    const versions = await versionsOf(c.associationId);
    const v2 = versions[1]!;

    // Without the four confirmations, the Creator's acceptance is refused.
    await creatorRespond(c, v2.id, { action: 'accept' }).expect(422);

    const res = await creatorRespond(c, v2.id, { action: 'accept', ...CONFIRM }).expect(200);
    expect(res.body.response.outcome).toBe('locked');

    const agreement = await agreementOf(c.associationId);
    expect(agreement!.proposalVersionId).toBe(v2.id);
    expect(agreement!.totalPercent).toBe(36);
    expect((await association(c.associationId)).status).toBe('accepted');
  });

  it('Admin can reject a version but has no path to lock one', async () => {
    const j = await journey('mediation', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 49 }).expect(200);
    const [v1] = await versionsOf(c.associationId);

    // No admin acceptance route exists at all.
    const noRoute = await request(h.app)
      .post(`/api/admin/proposals/${v1!.id}/accept`)
      .set('cookie', admin.cookie)
      .send({});
    expect(noRoute.status).toBe(404);

    await request(h.app)
      .post(`/api/admin/proposals/${v1!.id}/reject`)
      .set('cookie', admin.cookie)
      .send({
        internalReason: 'terms conflict with the campaign policy',
        customerExplanation: 'This proposal could not be carried as written.',
      })
      .expect(200);

    const [rejected] = await h.db
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.id, v1!.id));
    expect(rejected!.state).toBe('rejected_by_admin');

    // The rejected version cannot be answered into a lock.
    await founderRespond(j, v1!.id, { action: 'accept' }).expect(409);
    expect(await agreementOf(c.associationId)).toBeNull();

    // And the database refuses an agreement citing a version that never locked.
    await expectDbRefusal(
      h.db.insert(associationCompensationAgreements).values({
        associationId: c.associationId,
        campaignId: j.campaignId,
        source: 'proposal_version',
        proposalVersionId: v1!.id,
        basePercent: 30,
        bidIncreasePercent: 19,
        totalPercent: 49,
        affiliateAcceptedAt: new Date(),
        founderAcceptedAt: new Date(),
      }),
      /locked version/i,
    );
  });
});

/* ═══ §33.2.11 — the deadline expires pending proposals; the refund happens ═ */

describe('§33.2.11 — a pending proposal expires and does not prevent the refund', () => {
  let j: Journey;
  let futureNow: Date;

  beforeAll(async () => {
    j = await journey('expire', { highEffort: true, creators: 2 });
    await payListing(j);
    // A live proposal — interest, not acceptance (§14.5).
    await propose(j.creators[0]!, { bidTotalPercent: 40 }).expect(200);

    const [payment] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    futureNow = new Date(payment!.responseDeadlineAt.getTime() + 1000);
  });

  it('the sweep expires the proposals, fails the roster, and refunds the full total once', async () => {
    const audit = createAuditWriter(h.db);
    const result = await sweepListingDeadlines(h.db, audit, futureNow, {
      gateway,
      notifier: h.notifier,
      notificationContext: {
        appBaseUrl: 'http://localhost:3000',
        supportEmail: 'support@proovd.co',
        fromAddress: 'hello@proovd.co',
      },
    });

    const evaluated = result.evaluations.find((e) => e.campaignId === j.campaignId);
    expect(evaluated).toBeDefined();
    expect(evaluated!.result.status).toBe('evaluated');
    if (evaluated!.result.status !== 'evaluated') return;
    expect(evaluated!.result.outcome).toBe('failed_no_mutual_acceptance');

    // Every open decision expired; the open version expired with them.
    for (const c of j.creators) {
      expect((await association(c.associationId)).status).toBe('expired_no_acceptance');
    }
    const versions = await versionsOf(j.creators[0]!.associationId);
    expect(versions[0]!.state).toBe('expired_no_acceptance');

    // The roster failed, the campaign moved, and review readiness is closed off.
    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaign!.affiliateRosterStatus).toBe('failed');
    expect(campaign!.status).toBe('refunded_no_creator');

    // §33.3.8: the ENTIRE Checkout total — subtotal plus tax — refunded once.
    const [payment] = await h.db
      .select()
      .from(listingFeePayments)
      .where(eq(listingFeePayments.campaignId, j.campaignId));
    const [refund] = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, j.campaignId));
    expect(refund).toBeDefined();
    expect(refund!.trigger).toBe('no_mutual_acceptance');
    expect(refund!.totalRefundedCents).toBe(payment!.totalCents);
    expect(refund!.taxRefundedCents).toBe(payment!.taxCents);

    // Everyone heard: the Founder's refund message, each Creator's expiry.
    expect(emailsTo(j.founder.email).some((m) => /refund/i.test(m.subject))).toBe(true);
    for (const c of j.creators) {
      expect(emailsTo(c.email).some((m) => /response window closed/i.test(m.subject))).toBe(true);
    }
  });

  it('a second sweep evaluates nothing twice and refunds nothing twice', async () => {
    const audit = createAuditWriter(h.db);
    const before = h.sentEmails.messages.length;
    await sweepListingDeadlines(h.db, audit, futureNow, {
      gateway,
      notifier: h.notifier,
      notificationContext: {
        appBaseUrl: 'http://localhost:3000',
        supportEmail: 'support@proovd.co',
        fromAddress: 'hello@proovd.co',
      },
    });

    const evaluations = await h.db
      .select()
      .from(responseDeadlineEvaluations)
      .where(eq(responseDeadlineEvaluations.campaignId, j.campaignId));
    expect(evaluations).toHaveLength(1);

    const refunds = await h.db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.campaignId, j.campaignId));
    expect(refunds).toHaveLength(1);
    expect(h.sentEmails.messages.length).toBe(before);
  });

  it('a late response cannot silently reactivate the failed and refunded campaign', async () => {
    const c = j.creators[1]!;
    const late = await accept(c);
    expect(late.status).toBe(409);

    const versions = await versionsOf(j.creators[0]!.associationId);
    const lateFounder = await founderRespond(j, versions[0]!.id, { action: 'accept' });
    expect(lateFounder.status).toBe(409);

    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, j.campaignId));
    expect(campaign!.status).toBe('refunded_no_creator');
    expect(campaign!.affiliateRosterStatus).toBe('failed');
    expect(await agreementOf(c.associationId)).toBeNull();
  });
});

/* ═══ §33.2.12 — the ceiling includes base + bid + bonus ═══════════════════ */

describe('§33.2.12 — base + bid + bonus never exceeds 50%', () => {
  it('a bid over the ceiling is refused at submission', async () => {
    const j = await journey('ceilbid', { highEffort: true });
    await payListing(j);
    const res = await propose(j.creators[0]!, { bidTotalPercent: 55 }).expect(422);
    expect(res.body.whatHappened).toMatch(/50/);
  });

  it('a bonus that would breach the ceiling over locked terms is refused; one inside it stores the §14.3 facts', async () => {
    const j = await journey('ceilbonus', { highEffort: true });
    await payListing(j);
    const c = j.creators[0]!;

    await propose(c, { bidTotalPercent: 40 }).expect(200);
    const [v1] = await versionsOf(c.associationId);
    await founderRespond(j, v1!.id, { action: 'accept' }).expect(200);

    const over = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/roster/${c.associationId}/bonus`)
      .set('cookie', j.founder.cookie)
      .send({ triggerUnit: 'attributed_subtotal_cents', threshold: '100000', additionalPercent: 15 })
      .expect(422);
    expect(over.body.whatHappened).toMatch(/never exceed 50/);

    const ok = await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/roster/${c.associationId}/bonus`)
      .set('cookie', j.founder.cookie)
      .send({ triggerUnit: 'attributed_subtotal_cents', threshold: '100000', additionalPercent: 10 })
      .expect(200);
    expect(ok.body.bonus.maxCombinedPercent).toBe(50);

    const [bonus] = await h.db
      .select()
      .from(creatorBonuses)
      .where(eq(creatorBonuses.associationId, c.associationId));
    expect(bonus!.triggerUnit).toBe('attributed_subtotal_cents');
    expect(bonus!.threshold).toBe(100000n);
    expect(bonus!.additionalPercent).toBe(10);
    expect(bonus!.maxCombinedPercent).toBe(50);
    expect(bonus!.earnedRecordedAt).toBeNull();

    // The database's own ceiling holds against a direct INSERT.
    await expect(
      h.db.insert(creatorBonuses).values({
        associationId: j.creators[0]!.associationId,
        campaignId: j.campaignId,
        triggerUnit: 'unique_attributed_backers',
        threshold: 10n,
        additionalPercent: 60,
        maxCombinedPercent: 60,
        offeredBy: 'test',
      }),
    ).rejects.toThrow();

    // The Phase 03 kernel agrees: 40 + 15 breaches, 40 + 10 does not.
    expect(() => combinedPercent({ basePercent: 30, bidIncreasePercent: 10, bonusPercent: 15 })).toThrow(
      MoneyRuleError,
    );
    expect(combinedPercent({ basePercent: 30, bidIncreasePercent: 10, bonusPercent: 10 })).toBe(50);
  });
});

/* ═══ §33.2.13 — the bonus base is that Creator's results only ═════════════ */

describe('§33.2.13 — Creator-specific bonuses ignore organic, house, and other-Creator results', () => {
  it('only the Creator’s own captured, validly attributed, pre-tax subtotal triggers the stored bonus', async () => {
    const j = await journey('bonusbase', { highEffort: false, creators: 2 });
    await payListing(j);
    const mine = j.creators[0]!.associationId;
    const other = j.creators[1]!.associationId;

    await request(h.app)
      .post(`/api/founder/campaigns/${j.campaignId}/roster/${mine}/bonus`)
      .set('cookie', j.founder.cookie)
      .send({ triggerUnit: 'attributed_subtotal_cents', threshold: '70000', additionalPercent: 5 })
      .expect(200);
    const [stored] = await h.db
      .select()
      .from(creatorBonuses)
      .where(eq(creatorBonuses.associationId, mine));

    const terms = {
      triggerUnit: stored!.triggerUnit,
      threshold: stored!.threshold,
      additionalPercent: stored!.additionalPercent,
      maxCombinedPercent: stored!.maxCombinedPercent,
    } as const;

    const charges: CapturedCharge[] = [
      // Mine: captured, valid → counts.
      { rewardSubtotalCents: 60000n, captured: true, validlyAttributed: true, attribution: { kind: 'creator', associationId: mine }, backerId: 'b1' },
      // Mine but never captured → does not count.
      { rewardSubtotalCents: 40000n, captured: false, validlyAttributed: true, attribution: { kind: 'creator', associationId: mine }, backerId: 'b2' },
      // Mine but attribution failed validation → does not count.
      { rewardSubtotalCents: 40000n, captured: true, validlyAttributed: false, attribution: { kind: 'creator', associationId: mine }, backerId: 'b3' },
      // Organic, house, and another Creator's — §14.3: never trigger it.
      { rewardSubtotalCents: 500000n, captured: true, validlyAttributed: true, attribution: { kind: 'organic' }, backerId: 'b4' },
      { rewardSubtotalCents: 500000n, captured: true, validlyAttributed: true, attribution: { kind: 'house' }, backerId: 'b5' },
      { rewardSubtotalCents: 500000n, captured: true, validlyAttributed: true, attribution: { kind: 'creator', associationId: other }, backerId: 'b6' },
    ];

    // The whole campaign captured over US$15,000 — but MY base is US$600.
    expect(creatorAttributedResults(mine, charges).subtotalCents).toBe(60000n);
    // 60000 < 70000 threshold: not triggered, whatever the campaign total did.
    expect(earnedBonusPercent(terms, mine, charges)).toBe(0);

    // One more of MY captured charges crosses the threshold; nothing else did.
    const withOneMore: CapturedCharge[] = [
      ...charges,
      { rewardSubtotalCents: 15000n, captured: true, validlyAttributed: true, attribution: { kind: 'creator', associationId: mine }, backerId: 'b7' },
    ];
    expect(earnedBonusPercent(terms, mine, withOneMore)).toBe(5);
  });
});

/* ═══ §14.5 — the Founder's roster view, in the customer vocabulary ════════ */

describe('§14.5 — the roster view', () => {
  it('serves the cards, the exact deadline, the refund outcome, and the pending-proposal note — and leaks nothing', async () => {
    const j = await journey('roster', { highEffort: true, creators: 2 });
    await payListing(j);
    await propose(j.creators[0]!, { bidTotalPercent: 40 }).expect(200);

    const res = await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/roster`)
      .set('cookie', j.founder.cookie)
      .expect(200);
    const roster = res.body.roster;

    expect(roster.responseDeadlineAt).not.toBeNull();
    expect(roster.fullRefundOutcome).toMatch(/refund/i);
    expect(roster.pendingProposalNote).toBe(PENDING_PROPOSAL_NOTE);

    const card = roster.creators.find(
      (c: { associationId: string }) => c.associationId === j.creators[0]!.associationId,
    );
    expect(card.statusLabel).toBe('Proposal pending');
    expect(card.openProposal.awaitingYou).toBe(true);
    expect(card.openProposal.note).toBe(PENDING_PROPOSAL_NOTE);

    // §11's boundary and §3's naming: no email, no internal status words.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(j.creators[0]!.email);
    for (const internal of ['signed_up_waiting_for_founder', 'formal_decision_open', 'expired_no_acceptance', 'pre_launch', 'pre_build']) {
      expect(body).not.toContain(internal);
    }
  });

  it('another Founder cannot read the roster', async () => {
    const j = await journey('rosterown');
    const other = await journey('rosterother');
    await request(h.app)
      .get(`/api/founder/campaigns/${j.campaignId}/roster`)
      .set('cookie', other.founder.cookie)
      .expect(404);
  });

  it('another Creator cannot reach someone else’s opportunity or decisions', async () => {
    const j = await journey('scope', { creators: 2 });
    await payListing(j);
    const [a, b] = j.creators;
    await request(h.app)
      .get(`/api/creator/campaigns/${a!.associationId}/opportunity`)
      .set('cookie', b!.cookie)
      .expect(404);
    await request(h.app)
      .post(`/api/creator/campaigns/${a!.associationId}/accept`)
      .set('cookie', b!.cookie)
      .send(CONFIRM)
      .expect(404);
  });
});

/* ═══ Drift tests — backend restatements match the shared registers ════════ */

describe('drift — the roster vocabulary and the promise sentences', () => {
  it('the backend §14.5 label map matches shared, and covers every §23.4 status', () => {
    for (const status of ASSOCIATION_STATUSES) {
      expect(BACKEND_ROSTER_LABELS[status]).toBe(FOUNDER_ROSTER_STATUS_LABELS[status]);
      expect(BACKEND_ROSTER_LABELS[status]).toBeTruthy();
    }
  });

  it('the three promise sentences and the link-test marker match shared', () => {
    expect(BACKEND_PENDING_NOTE).toBe(PENDING_PROPOSAL_NOTE);
    expect(BACKEND_NO_FIXED).toBe(NO_FIXED_MONEY_AT_FIRST_POST);
    expect(BACKEND_DECLINE_NOTE).toBe(DECLINE_NO_PENALTY_NOTE);
    expect(BACKEND_LINK_TEST_MARKER).toBe(LINK_TEST_MARKER);
  });
});
