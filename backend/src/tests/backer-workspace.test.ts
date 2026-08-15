/**
 * The Backers Admin workspace — §26.1, §26.5, §25.7, §28.4, §19, §18, §33.12.5.
 *
 * Built 2026-08-15 over the reservation domain Phase 15 shipped. This suite
 * proves what the workspace reads and, far more importantly, what it refuses.
 * The decisions a later session is most likely to undo by accident:
 *
 *   1. CONSENT IS NEVER DEFAULTED. The reference wrote
 *      `b.share || 'Yes — share my name and email'`; a reservation with no
 *      recorded consent must read `not_granted`, and the word "granted" must
 *      not appear on its row. This is the single most important test here.
 *   2. It is READ-ONLY, and it has NO EXPORT. Every verb but GET answers 404,
 *      the module contains no `.insert(` / `.update(` / `.delete(`, and no
 *      route serves a file — §25.7 keeps Backer email and survey answers on
 *      screen and out of every export.
 *   3. Filtering, searching, and paging happen in POSTGRES. A response must
 *      never carry rows the filter excluded: what is displayed and what is
 *      transmitted are the same set, which is the privacy property.
 *   4. `Organic` is the ABSENCE of attribution, not a name. A Creator whose
 *      display name is literally "Organic" must not be caught by the organic
 *      filter, and must not swallow the unattributed rows.
 *   5. The time window is a REAL bound on `reserved_at`, never the reference's
 *      prorated arithmetic.
 *   6. A canceled pre-order is not a Backer, and a refunded one still is.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInAs, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { trackingLinks } from '../db/schema/decisions.js';

import {
  BACKER_PAGE_SIZE,
  COUNTED_BACKER_STATUSES,
  SURVEY_RECOMMEND_QUESTION,
  SURVEY_WHY_QUESTION,
  UNATTRIBUTED_FILTER_VALUE,
  clampPageSize,
  formatRecommendAnswer,
  windowDays,
} from '../backers/workspace/logic.js';

import {
  BACKER_TIME_WINDOWS as SHARED_WINDOWS,
  COUNTED_BACKER_STATUSES as SHARED_STATUSES,
  UNATTRIBUTED_FILTER_VALUE as SHARED_SENTINEL,
  SURVEY_WHY_QUESTION as SHARED_WHY,
  SURVEY_RECOMMEND_QUESTION as SHARED_RECOMMEND,
  backerConsentDisclosure,
  formatRecommendAnswer as sharedFormatRecommend,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'backerws');
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'backerws');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── Seeding ──────────────────────────────────────────────────────────────── */

let seq = 0;

async function seedCampaign(
  label: string,
  options: { liveAt?: Date | null; title?: string } = {},
): Promise<string> {
  const founder = await seedUser(h, 'founder', `bkrws-${label}-${seq++}`);
  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
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
      status: 'live' as never,
      type: 'pre_launch' as never,
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt:
        options.liveAt === undefined ? new Date(Date.now() - 30 * 86_400_000) : options.liveAt,
      campaignCloseAt: new Date(Date.now() + 14 * 86_400_000),
    })
    .returning({ id: campaigns.id });

  await h.db.insert(campaignDrafts).values({
    campaignId: campaign!.id,
    prospectId: prospect!.id,
    status: 'claimed',
    createdBy: 'admin:test',
  });

  await h.db.insert(campaignBuild).values({
    campaignId: campaign!.id,
    title: options.title ?? `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    refundPolicyTitle: 'Refund Policy',
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  return campaign!.id;
}

/** A Creator on a campaign, with an activated tracking link. */
async function seedCreator(
  campaignId: string,
  name: string,
  handle: string,
  activatedAt: Date | null = new Date(Date.now() - 20 * 86_400_000),
): Promise<string> {
  const [prospect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: name,
      publicHandle: handle,
      email: `creator-${seq++}@example.com`,
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [association] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: prospect!.id,
      status: 'active' as never,
      rosterMembership: 'initial_roster' as never,
    })
    .returning({ id: campaignAffiliateAssociations.id });

  await h.db.insert(trackingLinks).values({
    associationId: association!.id,
    campaignId,
    code: `code-${seq++}`,
    active: activatedAt !== null,
    activatedAt,
  });

  return association!.id;
}

interface SeedReservation {
  status?: string;
  subtotal?: bigint;
  associationId?: string | null;
  consent?: boolean;
  why?: string | null;
  recommend?: number | null;
  reservedAt?: Date;
  email?: string;
}

async function seedReservation(campaignId: string, options: SeedReservation = {}): Promise<string> {
  const index = seq++;
  const email = options.email ?? `backer-${index}@example.com`;
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email,
      phone: `+1555${String(index).padStart(6, '0')}`,
      emailNormalized: email,
      phoneNormalized: `1555${String(index).padStart(6, '0')}`,
      dedupKey: `${campaignId}-${index}`,
    })
    .returning({ id: backerIdentities.id });

  const [row] = await h.db
    .insert(reservations)
    .values({
      campaignId,
      backerIdentityId: identity!.id,
      status: (options.status ?? 'reserved_active') as never,
      rewardSku: 'SKU-1',
      rewardTitle: 'Founding pack',
      rewardSubtotalCents: options.subtotal ?? 12_000n,
      backerEmail: email,
      reservedAt: options.reservedAt ?? new Date(Date.now() - 10 * 86_400_000),
      attributionAssociationId: options.associationId ?? null,
      attributionStatus: options.associationId ? 'verified' : null,
      surveyWhy: options.why === undefined ? 'I want fewer tools.' : options.why,
      surveyRecommend: options.recommend === undefined ? 9 : options.recommend,
      /* Left UNSET where the caller does not pass one, so the column default is
         what the test observes — which is the point of the consent tests. */
      ...(options.consent === undefined ? {} : { founderMarketingConsent: options.consent }),
    })
    .returning({ id: reservations.id });

  return row!.id;
}

function get(path: string, cookie = admin.cookie) {
  return request(h.app).get(path).set('Cookie', cookie);
}

const PATH = '/api/admin/backers';

/* ── Registers do not drift ───────────────────────────────────────────────── */

describe('the shared register and the backend restatement agree', () => {
  it('every vocabulary matches @proovd/shared', () => {
    expect([...COUNTED_BACKER_STATUSES]).toEqual([...SHARED_STATUSES]);
    expect(UNATTRIBUTED_FILTER_VALUE).toBe(SHARED_SENTINEL);
    expect(SURVEY_WHY_QUESTION).toBe(SHARED_WHY);
    expect(SURVEY_RECOMMEND_QUESTION).toBe(SHARED_RECOMMEND);
    expect(formatRecommendAnswer(8)).toBe(sharedFormatRecommend(8));
  });

  it('the window keys and their day counts match', () => {
    for (const window of SHARED_WINDOWS) {
      expect(windowDays(window.key)).toBe(window.days);
    }
    // An unknown key is the lifetime, never an invented bound.
    expect(windowDays('first_90')).toBeNull();
  });

  it('the survey questions come from §19 rather than the reference', () => {
    // The reference asked three questions. §19 asks two, and the third was a
    // consent, not a question.
    expect(SURVEY_WHY_QUESTION).toBe('Why do you want this product?');
    expect(SURVEY_RECOMMEND_QUESTION).toBe('How likely are you to recommend this to someone?');
    // The reference's second question does not exist in this product.
    expect(SURVEY_WHY_QUESTION).not.toContain('How clear was the campaign');
    expect(SURVEY_RECOMMEND_QUESTION).not.toContain('How clear was the campaign');
  });

  it('the consent disclosure never says yes or no', () => {
    // A badge is read out of its column. "No" beside a survey answer invites
    // "this Backer said no to the survey".
    for (const granted of [true, false]) {
      const disclosure = backerConsentDisclosure(granted);
      expect(disclosure.label.toLowerCase()).not.toMatch(/^(yes|no)\b/);
      expect(disclosure.permits.length).toBeGreaterThan(20);
    }
  });
});

/* ── Authorization (brief §9) ─────────────────────────────────────────────── */

describe('server-side authorization', () => {
  it('refuses an anonymous caller', async () => {
    await request(h.app).get(PATH).expect(401);
  });

  it('refuses a signed-in Founder', async () => {
    const founder = await seedUser(h, 'founder', 'bkrws-role-f');
    const cookie = await signInAs(h, founder.email);
    await get(PATH, cookie).expect(403);
  });

  it('refuses a signed-in Creator', async () => {
    // §25.7 names Backer email and identifiable survey responses among the
    // fields an Affiliate never receives. The strongest form of that is an
    // endpoint their role cannot enter.
    const creator = await seedUser(h, 'affiliate', 'bkrws-role-c');
    const cookie = await signInAs(h, creator.email);
    await get(PATH, cookie).expect(403);
  });

  it('answers an authorized Admin', async () => {
    await get(PATH).expect(200);
  });

  it('a manipulated campaign or affiliate id cannot widen access', async () => {
    // Neither parameter is a scope: `requireAdmin` has already decided the
    // caller may read every campaign, so a filter only narrows. A malformed one
    // is dropped rather than passed to the driver, so it 200s with everything
    // rather than 500ing at an invalid uuid literal.
    await get(`${PATH}?campaignId=not-a-uuid`).expect(200);
    await get(`${PATH}?affiliate=' OR 1=1--`).expect(200);
    await get(`${PATH}?campaignId=${'../'.repeat(8)}etc/passwd`).expect(200);
  });
});

/* ── Read-only, and no export (brief §4) ──────────────────────────────────── */

describe('the workspace is read-only', () => {
  it('every write verb answers 404 at the path', async () => {
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      await request(h.app)[verb](PATH).set('Cookie', admin.cookie).expect(404);
    }
  });

  it('there is no per-Backer address and no export route', async () => {
    const campaignId = await seedCampaign('noroute');
    const reservationId = await seedReservation(campaignId);
    // "One row per Backer. No extra record page." — the reference's own promise.
    await get(`${PATH}/${reservationId}`).expect(404);
    // §25.7: bulk export of Backer identity is not a convenience feature.
    await get(`${PATH}/export`).expect(404);
    await get(`${PATH}.csv`).expect(404);
  });

  it('the module contains no insert, update, or delete', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const workspace = join(dir, '..', 'backers', 'workspace');
    for (const file of readdirSync(workspace)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join(workspace, file), 'utf8')
        // Strip comments first: these files explain at length what they refuse
        // to do, and a scan that cannot tell an explanation from a usage would
        // force the explanations out.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source, `${file} must not write`).not.toMatch(/\.insert\(/);
      expect(source, `${file} must not write`).not.toMatch(/\.update\(/);
      expect(source, `${file} must not write`).not.toMatch(/\.delete\(/);
    }
  });
});

/* ── Consent (brief §3 — the most important section) ──────────────────────── */

describe('consent is never defaulted to permissive', () => {
  it('a reservation with no recorded consent reads not_granted', async () => {
    const campaignId = await seedCampaign('consent-absent');
    await seedReservation(campaignId, { email: 'absent@example.com' });

    const res = await get(`${PATH}?campaignId=${campaignId}&view=backers`).expect(200);
    const row = res.body.backers.rows.find((r: { email: string }) => r.email === 'absent@example.com');

    expect(row).toBeDefined();
    expect(row.consentState).toBe('not_granted');
    // The reference's bug, stated as an assertion: an absent answer must never
    // become "Yes — share my name and email".
    expect(JSON.stringify(row)).not.toMatch(/share my name and email/i);
    expect(row.consentLabel).toBe('Founder contact not allowed');
  });

  it('the column default is false, so absence is not-granted at the database', async () => {
    const campaignId = await seedCampaign('consent-default');
    const reservationId = await seedReservation(campaignId);
    const [row] = await h.db
      .select({ consent: reservations.founderMarketingConsent })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(row!.consent).toBe(false);
  });

  it('a granted consent reads granted, and only when it was actually given', async () => {
    const campaignId = await seedCampaign('consent-given');
    await seedReservation(campaignId, { consent: true, email: 'yes@example.com' });
    await seedReservation(campaignId, { consent: false, email: 'no@example.com' });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const rows = res.body.backers.rows as Array<{ email: string; consentState: string }>;

    expect(rows.find((r) => r.email === 'yes@example.com')!.consentState).toBe('granted');
    expect(rows.find((r) => r.email === 'no@example.com')!.consentState).toBe('not_granted');
  });

  it('every row carries the permission sentence, not just a badge', async () => {
    const campaignId = await seedCampaign('consent-permits');
    await seedReservation(campaignId, { consent: false });
    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const row = res.body.backers.rows[0];
    // An Admin holding "may I forward this to the Founder" needs the answer,
    // not a colour.
    expect(row.consentPermits).toMatch(/Do not forward/i);
  });
});

/* ── The payload exposes only what the tab needs (brief §3) ───────────────── */

describe('the payload carries no payment or auth data', () => {
  it('no provider identifier, card metadata, phone, or billing address appears', async () => {
    const campaignId = await seedCampaign('leak');
    const associationId = await seedCreator(campaignId, 'Maya Johnson', '@mayajohnson');
    await seedReservation(campaignId, { associationId, consent: true });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const body = JSON.stringify(res.body);

    for (const forbidden of [
      'stripeCustomerId',
      'setupIntentId',
      'paymentIntentId',
      'chargeId',
      'paymentMethodFingerprint',
      'paymentMethodLast4',
      'paymentMethodBrand',
      'backerPhone',
      'billingLine1',
      'billingPostalCode',
      'dedupKey',
      'consentHash',
    ]) {
      expect(body, `${forbidden} must not reach this surface`).not.toContain(forbidden);
    }
  });
});

/* ── Filtering happens in Postgres (brief §7.2) ───────────────────────────── */

describe('filtering, searching, and paging are server-side', () => {
  it('a campaign filter excludes other campaigns from the RESPONSE', async () => {
    const wanted = await seedCampaign('filter-a', { title: 'Wanted Campaign' });
    const other = await seedCampaign('filter-b', { title: 'Other Campaign' });
    await seedReservation(wanted, { email: 'wanted@example.com' });
    await seedReservation(other, { email: 'other@example.com' });

    const res = await get(`${PATH}?campaignId=${wanted}`).expect(200);
    const body = JSON.stringify(res.body.backers);
    // Not merely "not displayed" — not transmitted. A row filtered in the
    // browser is a row that was sent to the browser first.
    expect(body).toContain('wanted@example.com');
    expect(body).not.toContain('other@example.com');
  });

  it('the search matches email, answer text, and campaign name', async () => {
    const campaignId = await seedCampaign('search', { title: 'Looplight Launch' });
    await seedReservation(campaignId, {
      email: 'findme@example.com',
      why: 'A very distinctive phrase about handoffs.',
    });
    await seedReservation(campaignId, { email: 'other@example.com', why: 'Something else.' });

    const byEmail = await get(`${PATH}?campaignId=${campaignId}&backerSearch=findme`).expect(200);
    expect(byEmail.body.backers.rows).toHaveLength(1);

    const byAnswer = await get(
      `${PATH}?campaignId=${campaignId}&backerSearch=${encodeURIComponent('distinctive phrase')}`,
    ).expect(200);
    expect(byAnswer.body.backers.rows).toHaveLength(1);
    expect(byAnswer.body.backers.rows[0].email).toBe('findme@example.com');
  });

  it('a wildcard in the search term is escaped, not interpreted', async () => {
    const campaignId = await seedCampaign('escape');
    await seedReservation(campaignId, { email: 'literal@example.com' });
    // An unescaped `%` would match everything. It must match nothing here.
    const res = await get(`${PATH}?campaignId=${campaignId}&backerSearch=${encodeURIComponent('%')}`).expect(200);
    expect(res.body.backers.rows).toHaveLength(0);
  });

  it('the page is bounded and the total is the whole match', async () => {
    const campaignId = await seedCampaign('paging');
    for (let i = 0; i < 3; i += 1) await seedReservation(campaignId);

    const res = await get(`${PATH}?campaignId=${campaignId}&pageSize=2`).expect(200);
    expect(res.body.backers.rows.length).toBeLessThanOrEqual(res.body.backers.pageSize);
    expect(res.body.backers.total).toBe(3);
    expect(res.body.backers.hasMore).toBe(true);

    const second = await get(`${PATH}?campaignId=${campaignId}&pageSize=2&page=2`).expect(200);
    expect(second.body.backers.page).toBe(2);
    expect(second.body.backers.hasMore).toBe(false);
  });

  it('a caller cannot widen the page size past the ceiling', () => {
    expect(clampPageSize(1_000_000)).toBeLessThanOrEqual(100);
    expect(clampPageSize(undefined)).toBe(BACKER_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(BACKER_PAGE_SIZE);
  });
});

/* ── Organic is an absence, not a name (brief §5.4) ───────────────────────── */

describe('Organic is the absence of attribution', () => {
  it('an unattributed pre-order has a null affiliate rather than the word', async () => {
    const campaignId = await seedCampaign('organic');
    await seedReservation(campaignId, { associationId: null, email: 'organic@example.com' });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const row = res.body.backers.rows[0];
    expect(row.affiliateName).toBeNull();
    expect(row.associationId).toBeNull();
  });

  it('a Creator literally named Organic does not collide with the sentinel', async () => {
    // The reference stored the string 'Organic' in the same field that holds
    // real names. This is the case that breaks.
    const campaignId = await seedCampaign('collide');
    const associationId = await seedCreator(campaignId, 'Organic', '@organic');
    await seedReservation(campaignId, { associationId, email: 'attributed@example.com' });
    await seedReservation(campaignId, { associationId: null, email: 'unattributed@example.com' });

    const organic = await get(
      `${PATH}?campaignId=${campaignId}&affiliate=${UNATTRIBUTED_FILTER_VALUE}`,
    ).expect(200);
    const organicEmails = organic.body.backers.rows.map((r: { email: string }) => r.email);
    expect(organicEmails).toEqual(['unattributed@example.com']);

    const byCreator = await get(`${PATH}?campaignId=${campaignId}&affiliate=${associationId}`).expect(200);
    const creatorEmails = byCreator.body.backers.rows.map((r: { email: string }) => r.email);
    expect(creatorEmails).toEqual(['attributed@example.com']);
  });

  it('the affiliate filter list sends a key, never a display string', async () => {
    const campaignId = await seedCampaign('filterlist');
    const associationId = await seedCreator(campaignId, 'Riley Knox', '@rileybuilds');
    await seedReservation(campaignId, { associationId });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const options = res.body.affiliates as Array<{ value: string; label: string }>;
    expect(options[0]!.value).toBe(UNATTRIBUTED_FILTER_VALUE);
    const creator = options.find((o) => o.label === 'Riley Knox');
    expect(creator!.value).toBe(associationId);
  });
});

/* ── What counts as a Backer (§23.5) ──────────────────────────────────────── */

describe('a canceled pre-order is not a Backer, and a refunded one is', () => {
  it('excludes the three no-charge exits and the dropped capture', async () => {
    const campaignId = await seedCampaign('counting');
    await seedReservation(campaignId, { status: 'reserved_active', email: 'active@example.com' });
    await seedReservation(campaignId, { status: 'reserved_canceled', email: 'canceled@example.com' });
    await seedReservation(campaignId, { status: 'killed_no_charge', email: 'killed@example.com' });
    await seedReservation(campaignId, {
      status: 'threshold_not_met_no_charge',
      email: 'missed@example.com',
    });
    await seedReservation(campaignId, {
      status: 'capture_failed_dropped',
      email: 'dropped@example.com',
    });
    await seedReservation(campaignId, { status: 'refunded', email: 'refunded@example.com' });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const emails = (res.body.backers.rows as Array<{ email: string }>).map((r) => r.email).sort();

    // A refund does not un-Backer somebody who was charged (§24.8).
    expect(emails).toEqual(['active@example.com', 'refunded@example.com']);
  });
});

/* ── Totals (brief §5.1) ──────────────────────────────────────────────────── */

describe('the header totals count attributed pre-orders only', () => {
  it('excludes organic Backers and says so', async () => {
    const campaignId = await seedCampaign('totals');
    const associationId = await seedCreator(campaignId, 'Devon Miles', 'The Useful Show');
    await seedReservation(campaignId, { associationId, subtotal: 10_000n });
    await seedReservation(campaignId, { associationId, subtotal: 20_000n });
    await seedReservation(campaignId, { associationId: null, subtotal: 50_000n });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);

    expect(res.body.totals.attributedBackers.value).toBe('2');
    expect(res.body.totals.attributedBackers.label).toBe('Affiliate Backers');
    // The organic US$500 is excluded from the preorderValue total.
    expect(res.body.totals.attributedValue.value).toBe('US$300.00');
    expect(res.body.totals.affiliates.value).toBe('1');
    expect(res.body.totals.organicBackers).toBe(1);
    expect(res.body.totals.excludesNote).toMatch(/Organic pre-orders appear in Every Backer/);

    // But the Backer view shows all three — which is why the note exists.
    expect(res.body.backers.total).toBe(3);
  });

  it('the preorderValue total is the pre-tax subtotal (§24.3)', async () => {
    const campaignId = await seedCampaign('pretax');
    const associationId = await seedCreator(campaignId, 'Lina Patel', 'Ops Weekly');
    // A reservation whose authorized total includes tax; the subtotal is what
    // "preorderValue" means, because tax is outside every percentage in the product.
    await seedReservation(campaignId, { associationId, subtotal: 12_900n });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    expect(res.body.totals.attributedValue.value).toBe('US$129.00');
    expect(res.body.affiliateResults.rows[0].preorderValue).toBe('US$129.00');
  });
});

/* ── The time window is real (brief §5.3) ─────────────────────────────────── */

describe('the time window is a real bound, never prorated', () => {
  it('First 7 days excludes a pre-order made on day 10', async () => {
    const liveAt = new Date(Date.now() - 30 * 86_400_000);
    const campaignId = await seedCampaign('window', { liveAt });
    const associationId = await seedCreator(campaignId, 'Owen Gray', 'Build Class', liveAt);

    const day2 = new Date(liveAt.getTime() + 2 * 86_400_000);
    const day10 = new Date(liveAt.getTime() + 10 * 86_400_000);
    await seedReservation(campaignId, { associationId, reservedAt: day2, email: 'early@example.com' });
    await seedReservation(campaignId, { associationId, reservedAt: day10, email: 'late@example.com' });

    const lifetime = await get(`${PATH}?campaignId=${campaignId}&window=lifetime`).expect(200);
    expect(lifetime.body.totals.attributedBackers.value).toBe('2');

    const first7 = await get(`${PATH}?campaignId=${campaignId}&window=first_7`).expect(200);
    // A real bound: one row, not two rows scaled by 7/30.
    expect(first7.body.totals.attributedBackers.value).toBe('1');
    expect(JSON.stringify(first7.body.backers)).not.toContain('late@example.com');

    const first14 = await get(`${PATH}?campaignId=${campaignId}&window=first_14`).expect(200);
    expect(first14.body.totals.attributedBackers.value).toBe('2');
  });

  it('a campaign with no launch instant says so rather than falling back', async () => {
    const campaignId = await seedCampaign('noanchor', { liveAt: null });
    await seedReservation(campaignId);

    const res = await get(`${PATH}?campaignId=${campaignId}&window=first_7`).expect(200);
    expect(res.body.affiliateResults.anchorNote).toMatch(/has not gone live/i);
    // It shows everything rather than silently answering a different question.
    expect(res.body.backers.total).toBe(1);
  });

  it('the time active is derived from the link, and is null before activation', async () => {
    const campaignId = await seedCampaign('active');
    const never = await seedCreator(campaignId, 'Marcus Reed', 'Founder Tools', null);
    await seedReservation(campaignId, { associationId: never });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const row = res.body.affiliateResults.rows[0];
    expect(row.timeActive).toBeNull();
    expect(row.timeActiveWaitingOn).toMatch(/not been activated/i);
  });
});

/* ── Unanswered questions (brief §12) ─────────────────────────────────────── */

describe('an unanswered question is visible as an absence', () => {
  it('renders "Not answered" rather than a fabricated default', async () => {
    const campaignId = await seedCampaign('unanswered');
    await seedReservation(campaignId, { why: null, recommend: null });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const answers = res.body.backers.rows[0].answers as Array<{
      question: string;
      answer: string;
      answered: boolean;
    }>;

    expect(answers).toHaveLength(2);
    for (const answer of answers) {
      expect(answer.answered).toBe(false);
      expect(answer.answer).toBe('Not answered');
    }
    // The reference substituted 'Clear' for a missing clarity answer.
    expect(JSON.stringify(answers)).not.toContain('Clear');
  });

  it('the recommendation carries its scale', async () => {
    const campaignId = await seedCampaign('scale');
    await seedReservation(campaignId, { recommend: 8 });
    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const answers = res.body.backers.rows[0].answers as Array<{ answer: string }>;
    // A bare `8` is not an answer to a 1–10 question.
    expect(answers[1]!.answer).toBe('8 out of 10');
  });

  it('renders §19 two questions, and not the reference three', async () => {
    const campaignId = await seedCampaign('twoq');
    await seedReservation(campaignId);
    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const questions = (res.body.backers.rows[0].answers as Array<{ question: string }>).map(
      (a) => a.question,
    );
    expect(questions).toEqual([SURVEY_WHY_QUESTION, SURVEY_RECOMMEND_QUESTION]);
    expect(JSON.stringify(questions)).not.toMatch(/Share name and email/i);
  });
});

/* ── The third empty state (brief §12) ────────────────────────────────────── */

describe('a campaign with Backers and no attribution', () => {
  it('says what is true rather than "No Affiliate results match."', async () => {
    const campaignId = await seedCampaign('noattr');
    await seedReservation(campaignId, { associationId: null });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    expect(res.body.affiliateResults.rows).toHaveLength(0);
    // An Admin reading "no match" would go looking for a broken filter.
    expect(res.body.affiliateResults.noAttributionNote).toMatch(/arrived organically/i);
    expect(res.body.backers.total).toBe(1);
  });

  it('a genuinely empty filter result carries no such note', async () => {
    const campaignId = await seedCampaign('trulyempty');
    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    expect(res.body.affiliateResults.noAttributionNote).toBeNull();
  });
});

/* ── The averages (brief §7) ──────────────────────────────────────────────── */

describe('derived numbers', () => {
  it('the average is preorderValue over backers, and null over zero', async () => {
    const campaignId = await seedCampaign('avg');
    const associationId = await seedCreator(campaignId, 'Sofia Kent', '@sofia');
    await seedReservation(campaignId, { associationId, subtotal: 10_000n });
    await seedReservation(campaignId, { associationId, subtotal: 20_000n });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    const row = res.body.affiliateResults.rows[0];
    expect(row.backers).toBe(2);
    expect(row.preorderValue).toBe('US$300.00');
    // §16a: an average of nothing is not US$0.00 — but here there are Backers.
    expect(row.average).toBe('US$150.00');
  });

  it('the drill-through target is the row it came from', async () => {
    const campaignId = await seedCampaign('drill');
    const associationId = await seedCreator(campaignId, 'Riley Knox', '@rileybuilds');
    await seedReservation(campaignId, { associationId });

    const res = await get(`${PATH}?campaignId=${campaignId}`).expect(200);
    expect(res.body.affiliateResults.rows[0].drillThrough).toEqual({ campaignId, associationId });
  });
});
