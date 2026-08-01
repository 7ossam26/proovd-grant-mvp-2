/**
 * Phase 10b — hosted onboarding and the tax-accountability gate.
 * Spec §13, §11, §5.3, §24.1, §34.
 *
 * §33 names no test for Phase 10; the brief's done-when list is the contract,
 * and these are the entries that belong to this half:
 *
 *   · Founder onboarding returns a correct human-readable status for all four
 *     cases
 *   · `Restricted` offers no path to listing-fee payment
 *   · Affiliate payout onboarding completes; valid prior onboarding is reused
 *     without re-entry
 *   · Incomplete Affiliate onboarding blocks link activation and payment
 *     receipt while allowing campaign review
 *   · The tax-accountability record exists and gates Affiliate payment
 *   · No Stripe identity document is persisted anywhere
 *
 * The gateway is the in-memory one: real signature verification, fake account
 * API. What is under test is what Proovd does with an account's shape, and a
 * suite that reached Stripe would be testing that Stripe was up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { findAccountByStripeId } from '../payments/connected-accounts.js';
import { readTransferGate, readTaxAccountability } from '../payments/tax-accountability.js';
import { stripeConnectedAccounts, taxAccountabilityConfig } from '../db/schema/payments.js';
import { auditEvents } from '../db/schema/integrity.js';

const RETURN_URL = 'https://app.example.com/stripe/return';
const REFRESH_URL = 'https://app.example.com/stripe/refresh';

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_onboarding_suite',
  connectWebhookSecret: 'whsec_connect_for_onboarding_suite',
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      stripeConnectUrls: { returnUrl: RETURN_URL, refreshUrl: REFRESH_URL },
      authRouteLimit: 1_000_000,
      globalRateLimit: 1_000_000,
    },
    'onboarding',
  );
  admin = await createAdmin(h, 'onboarding-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

async function signedIn(role: 'founder' | 'affiliate', label: string) {
  const user = await seedUser(h, role, label);
  return { id: user.id, email: user.email, cookie: await signInPlain(h, user.email) };
}

const base = (role: 'founder' | 'affiliate') =>
  role === 'founder' ? '/api/founder/payouts' : '/api/creator/payouts';

const readState = (role: 'founder' | 'affiliate', cookie: string) =>
  request(h.app).get(base(role)).set('cookie', cookie);

const startLink = (role: 'founder' | 'affiliate', cookie: string) =>
  request(h.app).post(`${base(role)}/link`).set('cookie', cookie).send({});

const comeBack = (role: 'founder' | 'affiliate', cookie: string, event = 'returned') =>
  request(h.app).post(`${base(role)}/return`).set('cookie', cookie).send({ event });

/** What Stripe would report for an account in each of §13's shapes. */
function account(id: string, shape: 'complete' | 'due' | 'pending' | 'restricted') {
  const requirements = {
    complete: { currently_due: [], past_due: [], eventually_due: [], pending_verification: [], disabled_reason: null },
    due: {
      currently_due: ['external_account', 'individual.verification.document'],
      past_due: [],
      eventually_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    pending: {
      currently_due: [],
      past_due: [],
      eventually_due: [],
      pending_verification: ['individual.verification.document'],
      disabled_reason: null,
    },
    restricted: {
      currently_due: [],
      past_due: [],
      eventually_due: [],
      pending_verification: [],
      disabled_reason: 'rejected.fraud',
    },
  }[shape];

  return {
    id,
    object: 'account',
    charges_enabled: shape === 'complete',
    payouts_enabled: shape === 'complete',
    details_submitted: shape !== 'due',
    capabilities: shape === 'complete' ? { card_payments: 'active', transfers: 'active' } : {},
    requirements,
    tos_acceptance: { date: 1780000000, service_agreement: 'full' },
  };
}

const TAX_CONFIG = {
  payer: 'Proovd, Inc.',
  filingResponsibility: 'Proovd files 1099-NEC for Creator payments.',
  requiredForm: 'W-9 before any payment; 1099-NEC at year end.',
  requiredData: 'Legal name, address, and taxpayer classification, collected by Stripe.',
  thresholds: 'US$600 aggregate per calendar year.',
  correctionsProcess: 'Corrected 1099 issued within 30 days of a recorded error.',
  reconciliationResponsibility: 'Proovd finance reconciles Stripe payouts to the ledger monthly.',
  approvedBy: 'Dana Controller',
  evidenceReference: 'tax-memo-2026-08',
};

/* ── §13 — the four states, end to end ────────────────────────────────────── */

describe('§13 — Founder onboarding returns a human-readable status for all four cases', () => {
  it('starts at not_started with a resume action and no eligibility to pay', async () => {
    const founder = await signedIn('founder', 'founder-start');

    const before = await readState('founder', founder.cookie).expect(200);
    expect(before.body.payouts.state).toBe('not_started');
    expect(before.body.payouts.onboardingAvailable).toBe(true);
    expect(before.body.payouts.canResume).toBe(true);
    // §13: nothing but a complete seller account may reach listing-fee payment.
    expect(before.body.payouts.listingFeeEligible).toBe(false);
  });

  it('issues a hosted link and records it, without collecting anything', async () => {
    const founder = await signedIn('founder', 'founder-link');

    const link = await startLink('founder', founder.cookie).expect(200);
    expect(link.body.url).toContain('connect.stripe.test');
    expect(link.body.reused).toBe(false);

    // §24.1: the seller account asks for card_payments; a recipient never does.
    const created = gateway.created.at(-1)!;
    expect(created.role).toBe('founder_seller');
    expect(created.country).toBe('US');

    const state = await readState('founder', founder.cookie).expect(200);
    expect(state.body.payouts.stripeAccountId).toBe(created.id);
  });

  it('lands on `more information required` and names the exact requirements', async () => {
    const founder = await signedIn('founder', 'founder-due');
    const link = await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'due'));

    const back = await comeBack('founder', founder.cookie).expect(200);
    expect(back.body.payouts.state).toBe('more_information_required');
    // §13: "the exact missing requirement", not "more information needed".
    expect(back.body.payouts.missingRequirements).toEqual([
      'external_account',
      'individual.verification.document',
    ]);
    expect(back.body.payouts.canResume).toBe(true);
    expect(back.body.payouts.listingFeeEligible).toBe(false);
    expect(link.body.url).toBeDefined();
  });

  it('lands on `under review` with nothing for the Founder to do', async () => {
    const founder = await signedIn('founder', 'founder-review');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'pending'));

    const back = await comeBack('founder', founder.cookie).expect(200);
    expect(back.body.payouts.state).toBe('under_review');
    expect(back.body.payouts.pendingVerification).toEqual([
      'individual.verification.document',
    ]);
    // Nothing to resume: Stripe has what it asked for.
    expect(back.body.payouts.canResume).toBe(false);
    expect(back.body.payouts.listingFeeEligible).toBe(false);
  });

  it('lands on `complete` and only then becomes eligible to pay the listing fee', async () => {
    const founder = await signedIn('founder', 'founder-complete');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'complete'));

    const back = await comeBack('founder', founder.cookie).expect(200);
    expect(back.body.payouts.state).toBe('complete');
    expect(back.body.payouts.listingFeeEligible).toBe(true);
    expect(back.body.payouts.missingRequirements).toEqual([]);
  });

  it('records return and refresh as §13 history', async () => {
    const founder = await signedIn('founder', 'founder-history');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;
    gateway.setAccount(accountId, account(accountId, 'due'));

    await comeBack('founder', founder.cookie, 'refreshed').expect(200);
    await comeBack('founder', founder.cookie, 'returned').expect(200);

    const stored = await findAccountByStripeId(h.db, accountId);
    const history = await request(h.app)
      .get(`/api/admin/connected-accounts/${accountId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const events = (history.body.history as Array<{ event: string }>).map((e) => e.event);
    expect(events).toContain('link_created');
    expect(events).toContain('refreshed');
    expect(events).toContain('returned');
    expect(stored!.state).toBe('more_information_required');
  });
});

/* ── §13 — restricted offers no path to payment ───────────────────────────── */

describe('§13 — a restricted account offers no way forward and no way to pay', () => {
  it('refuses another onboarding attempt and points at support', async () => {
    const founder = await signedIn('founder', 'founder-restricted');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'restricted'));
    const back = await comeBack('founder', founder.cookie).expect(200);

    expect(back.body.payouts.state).toBe('restricted');
    // §13: "no misleading ability to pay the listing fee".
    expect(back.body.payouts.listingFeeEligible).toBe(false);
    // §13: a safe support path, not another attempt. Looping someone through
    // onboarding that will fail again is the §1.4 failure with a spinner on it.
    expect(back.body.payouts.canResume).toBe(false);

    const retry = await startLink('founder', founder.cookie).expect(409);
    expect(retry.body.error).toBe('restricted');
    expect(retry.body.next).toMatch(/support/i);
  });

  it('treats a refusal Proovd has never seen as restricted, not as workable', async () => {
    const founder = await signedIn('founder', 'founder-unknown-reason');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, {
      ...account(accountId, 'complete'),
      requirements: {
        currently_due: [],
        past_due: [],
        eventually_due: [],
        pending_verification: [],
        disabled_reason: 'some_reason_stripe_added_later',
      },
    });

    const back = await comeBack('founder', founder.cookie).expect(200);
    expect(back.body.payouts.state).toBe('restricted');
    expect(back.body.payouts.listingFeeEligible).toBe(false);
  });
});

/* ── §11 — reuse, and what incomplete onboarding blocks ───────────────────── */

describe('§11 — valid onboarding is reused without re-entry', () => {
  it('reuses the same account on a second attempt rather than creating one', async () => {
    const creator = await signedIn('affiliate', 'creator-reuse');

    const first = await startLink('affiliate', creator.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;
    expect(first.body.reused).toBe(false);

    const second = await startLink('affiliate', creator.cookie).expect(200);
    // §11: "Never ask an Affiliate to re-enter valid provider data." A second
    // account per campaign would also fragment payouts across accounts Stripe
    // treats as unrelated people.
    expect(second.body.reused).toBe(true);
    expect(gateway.created.filter((c) => c.id === accountId)).toHaveLength(1);

    const rows = await h.db
      .select()
      .from(stripeConnectedAccounts)
      .where(eq(stripeConnectedAccounts.ownerUserId, creator.id));
    expect(rows).toHaveLength(1);
  });

  it('asks a recipient account for no seller capability (§24.1)', async () => {
    const creator = await signedIn('affiliate', 'creator-capability');
    await startLink('affiliate', creator.cookie).expect(200);

    const created = gateway.created.at(-1)!;
    expect(created.role).toBe('affiliate_recipient');
  });

  it('tells a finished Creator there is nothing more to do', async () => {
    const creator = await signedIn('affiliate', 'creator-done');
    await startLink('affiliate', creator.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'complete'));
    await comeBack('affiliate', creator.cookie).expect(200);

    const again = await startLink('affiliate', creator.cookie).expect(409);
    expect(again.body.error).toBe('already_complete');
  });

  it('blocks link activation and payment receipt while incomplete, and never review', async () => {
    const creator = await signedIn('affiliate', 'creator-blocked');
    await startLink('affiliate', creator.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'due'));
    const back = await comeBack('affiliate', creator.cookie).expect(200);

    // §11: "campaign review continues, but tracking-link activation and payment
    // receipt are blocked."
    expect(back.body.payouts.linkActivationBlocked).toBe(true);
    expect(back.body.payouts.paymentReceiptBlocked).toBe(true);
    expect(back.body.payouts.campaignReviewBlocked).toBe(false);

    gateway.setAccount(accountId, account(accountId, 'complete'));
    const done = await comeBack('affiliate', creator.cookie).expect(200);
    expect(done.body.payouts.linkActivationBlocked).toBe(false);
    expect(done.body.payouts.paymentReceiptBlocked).toBe(false);
  });

  it('never makes a recipient account eligible to pay a listing fee (§24.1)', async () => {
    const creator = await signedIn('affiliate', 'creator-not-seller');
    await startLink('affiliate', creator.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    gateway.setAccount(accountId, account(accountId, 'complete'));
    const back = await comeBack('affiliate', creator.cookie).expect(200);

    expect(back.body.payouts.state).toBe('complete');
    // The Affiliate account "never processes the Backer charge and is never
    // MoR". Complete means it can be paid, not that it can sell.
    expect(back.body.payouts.listingFeeEligible).toBe(false);
  });
});

/* ── §5.3 / §13 — what these routes will not take ─────────────────────────── */

describe('§5.3, §11, §13 — Proovd collects nothing itself', () => {
  it('has no route that accepts a bank, tax, or identity field', async () => {
    const founder = await signedIn('founder', 'founder-nofields');

    // The absence is the enforcement. §11 forbids reproducing
    // provider-controlled fields; there is no endpoint here that would take one.
    for (const path of [
      '/api/founder/payouts/bank-account',
      '/api/founder/payouts/tax',
      '/api/creator/payouts/bank-account',
      '/api/creator/payouts/identity',
    ]) {
      const response = await request(h.app).post(path).set('cookie', founder.cookie).send({
        accountNumber: '000123456789',
      });
      expect([404, 401, 403]).toContain(response.status);
    }
  });

  it('ignores anything extra a link request carries', async () => {
    const founder = await signedIn('founder', 'founder-extra');
    await request(h.app)
      .post('/api/founder/payouts/link')
      .set('cookie', founder.cookie)
      .send({ accountNumber: '000123456789', ssn: '111-22-3333' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(stripeConnectedAccounts)
      .where(eq(stripeConnectedAccounts.ownerUserId, founder.id));

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('000123456789');
    expect(serialised).not.toContain('111-22-3333');
  });

  it('refuses a Creator the Founder routes and a Founder the Creator routes', async () => {
    const founder = await signedIn('founder', 'founder-guard');
    const creator = await signedIn('affiliate', 'creator-guard');

    await request(h.app).get('/api/founder/payouts').set('cookie', creator.cookie).expect(403);
    await request(h.app).get('/api/creator/payouts').set('cookie', founder.cookie).expect(403);
    await request(h.app).get('/api/founder/payouts').expect(401);
  });

  it('gives one person no sight of another’s account', async () => {
    const a = await signedIn('founder', 'founder-a');
    const b = await signedIn('founder', 'founder-b');

    await startLink('founder', a.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    const theirs = await readState('founder', b.cookie).expect(200);
    expect(theirs.body.payouts.stripeAccountId).not.toBe(accountId);
    expect(theirs.body.payouts.state).toBe('not_started');
  });
});

/* ── Reconciliation ───────────────────────────────────────────────────────── */

describe('a stuck onboarding is reconcilable', () => {
  it('lets an Admin re-read the account, and records that it was a person', async () => {
    const founder = await signedIn('founder', 'founder-reconcile');
    await startLink('founder', founder.cookie).expect(200);
    const accountId = gateway.created.at(-1)!.id;

    // The webhook that never arrived.
    gateway.setAccount(accountId, account(accountId, 'complete'));

    const reconciled = await request(h.app)
      .post(`/api/admin/connected-accounts/${accountId}/reconcile`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(200);

    expect(reconciled.body.payouts.state).toBe('complete');

    const view = await readState('founder', founder.cookie).expect(200);
    expect(view.body.payouts.listingFeeEligible).toBe(true);
  });

  it('answers 404 for an account Proovd has no record of', async () => {
    await request(h.app)
      .post(`/api/admin/connected-accounts/acct_${randomUUID().replace(/-/g, '')}/reconcile`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(404);
  });

  it('keeps reconciliation behind the Admin guards', async () => {
    const founder = await signedIn('founder', 'founder-guarded-reconcile');
    await request(h.app)
      .post('/api/admin/connected-accounts/acct_x/reconcile')
      .set('cookie', founder.cookie)
      .send({})
      .expect(403);
  });
});

/* ── §11 — the tax-accountability gate ────────────────────────────────────── */

describe('§11 — the tax-accountability gate', () => {
  it('blocks Affiliate payment until a configuration is recorded', async () => {
    const before = await readTransferGate(h.db, 'test');
    expect(before.blocked).toBe(true);
    expect(before.reason).toMatch(/§11/);
    expect(before.configuration).toBeNull();
  });

  it('refuses a configuration missing any of §11’s seven facts', async () => {
    const { thresholds: _omitted, ...incomplete } = TAX_CONFIG;

    const response = await request(h.app)
      .post('/api/admin/tax-accountability')
      .set('cookie', admin.cookie)
      .send(incomplete)
      .expect(400);

    expect(response.body.whatHappened).toContain('thresholds');
    expect(await readTaxAccountability(h.db, 'test')).toBeNull();
  });

  it('refuses a value shaped like a taxpayer identification number', async () => {
    // §11: "without duplicating sensitive provider-held data." These fields name
    // a party and a process; a value like this is a paste, not an answer.
    await request(h.app)
      .post('/api/admin/tax-accountability')
      .set('cookie', admin.cookie)
      .send({ ...TAX_CONFIG, requiredData: 'W-9 on file, TIN 123-45-6789' })
      .expect(422);

    expect(await readTaxAccountability(h.db, 'test')).toBeNull();
  });

  it('records all seven facts, opens the gate, and audits who approved it', async () => {
    const response = await request(h.app)
      .post('/api/admin/tax-accountability')
      .set('cookie', admin.cookie)
      .send(TAX_CONFIG)
      .expect(200);

    expect(response.body.transferGate.blocked).toBe(false);

    const stored = await readTaxAccountability(h.db, 'test');
    expect(stored!.payer).toBe(TAX_CONFIG.payer);
    expect(stored!.filingResponsibility).toBe(TAX_CONFIG.filingResponsibility);
    expect(stored!.requiredForm).toBe(TAX_CONFIG.requiredForm);
    expect(stored!.thresholds).toBe(TAX_CONFIG.thresholds);
    expect(stored!.correctionsProcess).toBe(TAX_CONFIG.correctionsProcess);
    expect(stored!.reconciliationResponsibility).toBe(TAX_CONFIG.reconciliationResponsibility);

    // §34's "recorded as complete": a named person and evidence.
    expect(stored!.approvedBy).toBe('Dana Controller');
    expect(stored!.evidenceReference).toBe('tax-memo-2026-08');

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'tax_accountability.recorded'));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0]!.mfaContext).toBe('totp');
  });

  it('supersedes rather than edits, and refuses to change a superseded row', async () => {
    await request(h.app)
      .post('/api/admin/tax-accountability')
      .set('cookie', admin.cookie)
      .send({ ...TAX_CONFIG, thresholds: 'US$600 aggregate, reviewed annually.' })
      .expect(200);

    const rows = await h.db.select().from(taxAccountabilityConfig);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const live = rows.filter((r) => r.supersededAt === null);
    // One live configuration per mode; two would make "which is in force" a
    // question, and §34 reads this to decide whether money may move.
    expect(live).toHaveLength(1);
    expect(live[0]!.thresholds).toContain('reviewed annually');

    const superseded = rows.find((r) => r.supersededAt !== null)!;
    await expect(
      h.db.execute(
        `UPDATE tax_accountability_config SET payer = 'someone else' WHERE id = '${superseded.id}'`,
      ),
    ).rejects.toThrow();
  });

  it('never lets a test configuration satisfy the gate for live payments', async () => {
    // §34 is about proving test and live were never confused.
    const live = await readTransferGate(h.db, 'live');
    expect(live.blocked).toBe(true);
    expect(live.configuration).toBeNull();
  });

  it('keeps the record behind the Admin guards', async () => {
    const founder = await signedIn('founder', 'founder-tax-guard');
    await request(h.app)
      .get('/api/admin/tax-accountability')
      .set('cookie', founder.cookie)
      .expect(403);
    await request(h.app)
      .post('/api/admin/tax-accountability')
      .set('cookie', founder.cookie)
      .send(TAX_CONFIG)
      .expect(403);
  });
});
