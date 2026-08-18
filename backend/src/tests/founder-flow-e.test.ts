/**
 * Founder Flow v2, Session E — the money (screens 25, 20).
 *
 * The brief's E3 done-when, minus the parts that are properties of a rendered
 * surface. `frontend/src/surfaces/founder/listing-payment.test.tsx` owns
 * Appendix A.5 rendering verbatim and §13's four no-payment states;
 * `founder-flow.test.tsx` owns the two pages' own behaviour. What is here is
 * what only the server can answer.
 *
 * ── It does NOT re-drive Phase 11 ───────────────────────────────────────────
 * `listing-checkout.test.ts` owns the payment: the seven effects in one
 * transaction, the §33.3.7 clock, the total lock on the calculation and the
 * five items, the campaign move, and the refusals while the seller account is
 * incomplete or tax is off. Session E rebuilt the SCREEN and changed none of
 * it, and the strongest statement of that is that suite passing unchanged.
 *
 * ── What this file adds ─────────────────────────────────────────────────────
 * Three things, all of them Session E's own:
 *
 *   · the ORDER — Stripe before the fee is a server refusal, not a preference,
 *     and the refusal names payout setup rather than failing generically;
 *   · ONE fee — the number the page's hero reads and the number the Checkout
 *     charges come from the same §12 calculation, and both move together when
 *     a §6 setting changes;
 *   · where Stripe sends somebody BACK — the retired campaign workspace is not
 *     an address a payment should land on.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, desc } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { policyVersions } from '../db/schema/policies.js';
import { listingFeeCalculations } from '../db/schema/workspace.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { user } from '../db/schema/auth.js';
import { FOUNDER_CLAIM_POLICY_SLUGS } from '../vetting/claim.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { FOUNDER_FLOW_PAGES, founderFlowPath } from '@proovd/shared';

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_flow_e',
  connectWebhookSecret: 'whsec_connect_for_flow_e',
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
    'flowe',
  );
  admin = await createAdmin(h, 'flowe-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── The order: Stripe before the fee, and the server is why ──────────────── */

describe('the order is a refusal, not a preference', () => {
  it('refuses the fee while the seller account is incomplete, and names payout setup', async () => {
    const founder = await claimedFounder('order');

    const state = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/listing`)
      .set('cookie', founder.cookie)
      .expect(200);

    // What the fee page reads to decide whether to render a payment control.
    expect(state.body.listing.paid).toBe(false);
    expect(state.body.listing.listingFeeEligible).toBe(false);
    expect(state.body.listing.checkoutAvailable).toBe(false);

    // And the POST re-decides regardless — a disabled control is not
    // authorization (§1.1). This is the mechanism that puts screen 25 before
    // screen 20: drawn the reference's way round, screen 20 offers a payment
    // the server declines.
    const refused = await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/listing/checkout`)
      .set('cookie', founder.cookie)
      .send({ address: { postalCode: '97201', country: 'US', state: 'OR' } })
      .expect(422);

    expect(refused.body.error).toBe('onboarding_incomplete');
    expect(String(refused.body.whatHappened)).toMatch(/payout setup is not finished/i);
    // §27.1: what to do now, by name. "Payment cannot open yet" on its own is
    // the generic failure §30 forbids.
    expect(String(refused.body.next)).toMatch(/payout setup/i);
    expect(gateway.sessions).toHaveLength(0);
  });

  it('registers both money screens in stage 4, after Last look', async () => {
    // The register the router, the help drawer and §33.11 all read. Asserted
    // here as well as in `shared` because this is the file that proves the
    // server refusal those two pages are ordered by.
    const ids = FOUNDER_FLOW_PAGES.map((page) => page.id);
    expect(ids.indexOf('payouts')).toBeGreaterThan(ids.indexOf('last-look'));
    expect(ids.indexOf('fee')).toBeGreaterThan(ids.indexOf('payouts'));
    for (const id of ['payouts', 'fee']) {
      const page = FOUNDER_FLOW_PAGES.find((p) => p.id === id)!;
      expect(page.stage, id).toBe(4);
      expect(page.param, id).toBe('campaignId');
    }
  });
});

/* ── One fee, two readers ─────────────────────────────────────────────────── */

describe('the fee on the page is the fee the Checkout charges', () => {
  it('reads the same §12 calculation the session is opened for', async () => {
    const founder = await sellerFounder('onefee');

    // What the page's hero renders.
    const workspace = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/workspace`)
      .set('cookie', founder.cookie)
      .expect(200);
    const shown = workspace.body.workspace.fee;

    // What the Checkout charges.
    const checkout = await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/listing/checkout`)
      .set('cookie', founder.cookie)
      .send({ address: { postalCode: '97201', country: 'US', state: 'OR' } })
      .expect(200);

    expect(checkout.body.checkout.subtotalCents).toBe(shown.subtotalCents);
    expect(checkout.body.checkout.baseCents).toBe(shown.baseCents);
    expect(checkout.body.checkout.discountLines).toEqual(shown.discountLines);

    // And both are the stored row, rather than two computations that agree
    // today. §12: "After payment, the calculation and evidence snapshot lock" —
    // the thing that locks is what both of these read.
    const [row] = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(eq(listingFeeCalculations.campaignId, founder.campaignId))
      .orderBy(desc(listingFeeCalculations.calculatedAt))
      .limit(1);
    expect(String(row!.subtotalCents)).toBe(shown.subtotalCents);
    expect(gateway.sessions.at(-1)!.subtotalCents).toBe(BigInt(shown.subtotalCents));
  });

  it('moves with the §6 settings, in both places at once', async () => {
    const founder = await sellerFounder('setting');
    const before = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/workspace`)
      .set('cookie', founder.cookie)
      .expect(200);
    expect(before.body.workspace.fee.baseCents).toBe('3500');

    // Phase 06's rule: a hardcoded number is a bug even when it is right. The
    // reference hardcodes FEE_BASE=35; this is what makes that a bug.
    await request(h.app)
      .put('/api/admin/settings/listing_fee_base_cents')
      .set('cookie', admin.cookie)
      .send({ value: '4200', reason: 'Session E: proving the fee follows the setting.' })
      .expect(200);

    const after = await request(h.app)
      .get(`/api/founder/campaigns/${founder.campaignId}/workspace`)
      .set('cookie', founder.cookie)
      .expect(200);
    expect(after.body.workspace.fee.baseCents).toBe('4200');

    const checkout = await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/listing/checkout`)
      .set('cookie', founder.cookie)
      .send({ address: { postalCode: '97201', country: 'US', state: 'OR' } })
      .expect(200);
    expect(checkout.body.checkout.baseCents).toBe('4200');
    expect(checkout.body.checkout.subtotalCents).toBe(after.body.workspace.fee.subtotalCents);

    // Put it back: the setting is global and the suites share a harness.
    await request(h.app)
      .put('/api/admin/settings/listing_fee_base_cents')
      .set('cookie', admin.cookie)
      .send({ value: '3500', reason: 'Session E: restoring §6’s stated value.' })
      .expect(200);
  });
});

/* ── Where Stripe sends somebody back ─────────────────────────────────────── */

describe('the Checkout lands back on the listing fee', () => {
  it('returns to the fee page rather than the retired campaign workspace', async () => {
    const founder = await sellerFounder('return');
    await request(h.app)
      .post(`/api/founder/campaigns/${founder.campaignId}/listing/checkout`)
      .set('cookie', founder.cookie)
      .send({ address: { postalCode: '97201', country: 'US', state: 'OR' } })
      .expect(200);

    const session = gateway.sessions.at(-1)!;
    const fee = founderFlowPath('fee', founder.campaignId);
    expect(session.successUrl).toContain(`${fee}?listing=paid`);
    expect(session.cancelUrl).toContain(`${fee}?listing=canceled`);

    // Session E made the fee page the ONE address for the listing fee, and
    // retired `/campaigns/:campaignId/workspace` to a redirect. Landing a
    // payment on a redirect works and is still wrong: the address a charge
    // returns to is the one whose state it changed.
    expect(session.successUrl).not.toContain('/workspace');
    expect(session.cancelUrl).not.toContain('/workspace');
  });
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

let policiesPublished = false;
async function publishClaimPolicies(): Promise<void> {
  if (policiesPublished) return;
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(inArray(policyVersions.slug, [...FOUNDER_CLAIM_POLICY_SLUGS]));
  policiesPublished = true;
}

/** An invited Founder taken all the way through §10's claim, and signed in. */
async function claimedFounder(
  label: string,
): Promise<{ cookie: string; campaignId: string; userId: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const created = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      phone: '+1 555 0100',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    })
    .expect(201);

  await request(h.app)
    .put(`/api/admin/founders/${created.body.draftId}/invitation`)
    .set('cookie', admin.cookie)
    .send({
      whatWeUnderstood: 'You are building a waitlist that fills cancelled appointments.',
      whyInvited: 'A clinic operator we know described exactly this problem.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: '~3 mins',
    })
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);
  const token = new RegExp(String.raw`http://localhost:3000/draft/([A-Za-z0-9_-]+)`).exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;

  await request(h.app)
    .patch(`/api/draft/${token}/vetting`)
    .send({
      problem: 'Cancelled appointments go unfilled because nobody has time to call the list.',
      solution: 'A waitlist that texts the next person the moment a slot opens.',
      competition: 'A paper list by the front desk, and doing nothing.',
      selectedType: 'pre_launch',
    })
    .expect(200);
  await request(h.app).post(`/api/draft/${token}/vetting/submit`).send({}).expect(201);

  await request(h.app)
    .patch(`/api/draft/${token}/claim`)
    .send({
      legalName: 'Rowan Vale',
      email,
      dateOfBirth: '1990-01-31',
      country: 'United States',
      stateRegion: 'Oregon',
      soleProprietor: true,
      representationUsPerson: true,
      representationAge18Plus: true,
      representationSanctions: true,
    })
    .expect(200);

  await publishClaimPolicies();
  const view = await request(h.app).get(`/api/draft/${token}/claim`).expect(200);
  const slugs = (view.body.policies as Array<{ slug: string; status?: string }>)
    .filter((p) => p.status === 'published')
    .map((p) => p.slug);

  const password = `flow-e-${randomUUID()}`;
  await request(h.app)
    .post(`/api/draft/${token}/claim`)
    .send({ password, acceptedPolicySlugs: slugs })
    .expect(201);

  const signIn = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password })
    .expect(200);

  // The claim answers with the campaign, not the account (`routes/vetting.ts`),
  // so the id comes from the record the claim created.
  const [account] = await h.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  return {
    cookie: (signIn.headers['set-cookie'] as unknown as string[]).join('; '),
    campaignId: created.body.campaignId,
    userId: account!.id,
  };
}

/**
 * The same Founder, with a complete `founder_seller` account.
 *
 * Screen 25's happy path, reached the way the product reaches it: Stripe says
 * the account is ready, and only then is the fee payable. The account is
 * written directly rather than walked through hosted onboarding — `stripe-
 * onboarding.test.ts` owns that walk, and re-driving it here would prove
 * Phase 10b's work rather than Session E's.
 */
async function sellerFounder(
  label: string,
): Promise<{ cookie: string; campaignId: string }> {
  const founder = await claimedFounder(label);
  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId: `acct_flowe${label}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.userId,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  // One workspace read, which is what writes the first §12 calculation —
  // `beginListingCheckout` refuses `no_calculation` without one, and in the
  // product Last look has always read it before either money screen opens.
  await request(h.app)
    .get(`/api/founder/campaigns/${founder.campaignId}/workspace`)
    .set('cookie', founder.cookie)
    .expect(200);

  return { cookie: founder.cookie, campaignId: founder.campaignId };
}
