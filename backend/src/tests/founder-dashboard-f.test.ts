/**
 * Founder Dashboard Session F — Chapter 4, Wrap, and the Backers page.
 *
 * The F done-when, minus the parts that are properties of a rendered surface
 * (`founder-dashboard.test.tsx` owns those):
 *
 *  - the export carries no restricted column, driven and scanned;
 *  - a `do_not_fulfill` share is never presented as deliverable;
 *  - no marketing-consent column exists anywhere the new records could hold one;
 *  - `NextCampaign.tsx` is reachable.
 *
 * Plus the two things this session's own shape depends on: the export takes no
 * argument that could widen it, and §25.7's two refused purposes are refused by
 * the DATABASE rather than by a service that could be called around.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import {
  backerIdentities,
  founderOperationalShares,
} from '../db/schema/reservations.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';
import { exportBackerRows, readFounderBackers, readFounderWrap } from '../founder-dashboard/wrap.js';
import * as shared from '@proovd/shared';
import * as backendLogic from '../founder-dashboard/logic.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(
    { authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'fdf',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

interface Seeded {
  campaignId: string;
  founderEmail: string;
}

/** A closed campaign owned by a real Founder, with a build so it has a title. */
async function seedCampaign(label: string): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `fdf-founder-${label}`);
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

  const closeAt = new Date(Date.now() - 10 * 24 * 3_600_000);
  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'closed_resolved',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(Date.now() - 60 * 24 * 3_600_000),
      campaignLiveAt: new Date(Date.now() - 40 * 24 * 3_600_000),
      campaignCloseAt: closeAt,
      highEffort: false,
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

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    brandVoice: 'Plain and unhurried.',
    updatedBy: 'user:test',
  });

  return { campaignId, founderEmail: founder.email };
}

/**
 * A pre-order with §19's operational share on it. `withdrawn` stamps
 * `do_not_fulfill_at` and moves the reservation to a terminal no-charge state,
 * which is what a cancellation, a kill and a threshold miss all leave behind.
 */
async function seedShare(
  campaignId: string,
  email: string,
  options: { withdrawn?: boolean; surveyWhy?: string } = {},
): Promise<string> {
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email,
      phone: `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
      emailNormalized: email.toLowerCase(),
      phoneNormalized: email.toLowerCase(),
      dedupKey: `dedup-${email}`,
    })
    .returning({ id: backerIdentities.id });

  const [reservation] = await h.db
    .insert(reservations)
    .values({
      campaignId,
      backerIdentityId: identity!.id,
      status: options.withdrawn ? 'reserved_canceled' : 'captured',
      rewardSku: 'BENCH-1',
      rewardTitle: 'Founding Edition',
      rewardSubtotalCents: 12_000n,
      salesTaxCents: 990n,
      totalAuthorizedCents: 12_990n,
      backerEmail: email,
      ...(options.surveyWhy ? { surveyWhy: options.surveyWhy, founderMarketingConsent: true } : {}),
    })
    .returning({ id: reservations.id });

  await h.db.insert(founderOperationalShares).values({
    reservationId: reservation!.id,
    campaignId,
    founderUserId: 'user:seed',
    backerEmail: email,
    rewardSku: 'BENCH-1',
    rewardTitle: 'Founding Edition',
    purchaseDetail: { subtotalCents: '12000' },
    ...(options.withdrawn
      ? { fulfillmentState: 'do_not_fulfill' as const, doNotFulfillAt: new Date() }
      : {}),
  });

  return reservation!.id;
}

/* ── F3: the export ───────────────────────────────────────────────────────── */

describe('§20 Explore 10 / §25.7 — the Founder export', () => {
  it('carries the register’s columns and nothing else, and there is no way to widen it', async () => {
    const { campaignId } = await seedCampaign('export');
    await seedShare(campaignId, 'rowan@example.com', {
      surveyWhy: 'I have wanted this for two years.',
    });

    const file = await exportBackerRows(h.db, campaignId);

    expect(file.columns).toEqual(shared.FOUNDER_EXPORT_COLUMNS.map((c) => c.header));

    /*
      TWO parameters, and that is the guarantee rather than a comment.
      `exportBackerRows` has no column list, no purpose, no request id and no
      "include survey" flag — so there is nothing an approved §25.7 request
      could arrive as, and approving one cannot change what a file carries.
      16a's rule, applied to the Founder side.
    */
    expect(exportBackerRows.length).toBe(2);
  });

  it('carries no restricted column, asserted against the values rather than the headers', async () => {
    const { campaignId } = await seedCampaign('restricted');
    await seedShare(campaignId, 'private@example.com', {
      surveyWhy: 'A sentence nobody consented to hand over in a file.',
    });

    const file = await exportBackerRows(h.db, campaignId);

    // The survey answer exists on the reservation AND the Backer consented —
    // and it is still not in the file, because a CSV cannot carry the
    // condition that permits it (§25.7, the ledger register's own reason).
    expect(file.csv).not.toContain('A sentence nobody consented');
    for (const banned of ['surveyWhy', 'Checkout comment', 'billing', 'phone', 'fingerprint']) {
      expect(file.csv.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('names `Pre-order`, never the crowdfunding word §3.2 replaces', async () => {
    const { campaignId } = await seedCampaign('naming');
    await seedShare(campaignId, 'naming@example.com');
    const file = await exportBackerRows(h.db, campaignId);

    expect(file.columns[0]).toBe('Pre-order');
    expect(file.csv.toLowerCase()).not.toContain('pledge');
    // §3.1: `reservation` never renders to a Founder, and a file is the worst
    // place for it — it outlives the session.
    expect(file.csv.toLowerCase()).not.toContain('reservation');
  });

  it('writes the pinned sentence for a withdrawn share, not the enum value', async () => {
    const { campaignId } = await seedCampaign('withdrawn-csv');
    await seedShare(campaignId, 'gone@example.com', { withdrawn: true });

    const file = await exportBackerRows(h.db, campaignId);
    expect(file.csv).toContain(shared.DO_NOT_FULFILL_LABEL);
    expect(file.csv).not.toContain('do_not_fulfill');
  });
});

/* ── F2: the §19 operational share ────────────────────────────────────────── */

describe('§19 — the operational share reaches the Founder', () => {
  it('returns a withdrawn share and never presents it as deliverable', async () => {
    const { campaignId } = await seedCampaign('withdrawn');
    await seedShare(campaignId, 'still-owed@example.com');
    await seedShare(campaignId, 'canceled@example.com', { withdrawn: true });

    const view = await readFounderBackers(h.db, campaignId);

    expect(view.sharedCount).toBe(2);
    expect(view.activeCount).toBe(1);
    expect(view.doNotFulfillCount).toBe(1);

    const withdrawn = view.rows.find((row) => row.backerEmail === 'canceled@example.com');
    expect(withdrawn?.fulfillmentState).toBe('do_not_fulfill');
    expect(withdrawn?.doNotFulfillLabel).toBe(shared.DO_NOT_FULFILL_LABEL);
    expect(withdrawn?.doNotFulfillAt).not.toBeNull();
    // §31.8: the step it actually reached, never a predicted one.
    expect(withdrawn?.progressionStep).toBe('no_charge');

    const owed = view.rows.find((row) => row.backerEmail === 'still-owed@example.com');
    expect(owed?.fulfillmentState).toBe('active');
    expect(owed?.doNotFulfillLabel).toBeNull();
  });

  it('names its withheld columns on the read, before anything is downloaded', async () => {
    const { campaignId } = await seedCampaign('withheld');
    const view = await readFounderBackers(h.db, campaignId);
    expect(view.exportWithheld.map((c) => c.header)).toEqual(
      shared.FOUNDER_EXPORT_WITHHELD.map((c) => c.header),
    );
    expect(view.exportWithheld.every((c) => c.reason.length > 40)).toBe(true);
  });
});

/* ── F4: the Backer data request ──────────────────────────────────────────── */

describe('§25.7 — the Backer data request', () => {
  it('records a permitted purpose and refuses the two the reference offers', async () => {
    const { campaignId, founderEmail } = await seedCampaign('request');
    const cookie = await signInPlain(h, founderEmail);

    const ok = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/backer-data-request`)
      .set('Cookie', cookie)
      .send({ purpose: 'support', detail: 'A backer says their reward never arrived.' });
    expect(ok.status).toBe(200);

    for (const purpose of ['marketing', 'community']) {
      const refused = await request(h.app)
        .post(`/api/founder/campaigns/${campaignId}/backer-data-request`)
        .set('Cookie', cookie)
        .send({ purpose, detail: 'Adding them to the Discord.' });
      expect(refused.status).toBe(400);
      expect(String(refused.body.whatHappened)).toContain('§25.7');
    }
  });

  it('is refused by the DATABASE too, so a service bug cannot record one', async () => {
    const { campaignId } = await seedCampaign('check');
    await expect(
      h.db.execute(sql`
        INSERT INTO "founder_backer_data_requests"
          ("campaign_id", "founder_user_id", "purpose", "detail")
        VALUES (${campaignId}, 'user:x', 'marketing', 'Sending a newsletter.')
      `),
    ).rejects.toThrow();
  });

  it('holds no column an exporter could read, and no consent column of any spelling', async () => {
    const result = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'founder_backer_data_requests'
    `);
    const columns = (result.rows as { column_name: string }[]).map((row) => row.column_name);

    /*
      The exact set. A column added without a decision fails here rather than
      quietly widening what a request may hold — the arrangement 0057's own
      suite used for the acknowledgement.
    */
    expect(new Set(columns)).toEqual(
      new Set([
        'id',
        'campaign_id',
        'founder_user_id',
        'purpose',
        'detail',
        'status',
        'requested_at',
        'decided_at',
        'decided_by',
        'decision_note',
        'created_at',
      ]),
    );

    for (const forbidden of [
      'granted_columns',
      'scope',
      'access_level',
      'expires_at',
      'marketing_consent',
      'newsletter_consent',
      'consent',
      'remind_at',
      'recurrence',
      'next_send_at',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('§31.8’s newsletter promise still has nowhere to be recorded', async () => {
    // Phase 21b's assertion, re-run because Session F added a table that a
    // later reader might reach for. The satisfaction record is still the one
    // §31.8 is about, and it still has no consent column.
    const result = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'backer_satisfaction_responses'
    `);
    const columns = (result.rows as { column_name: string }[]).map((row) => row.column_name);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.some((c) => /consent|newsletter|marketing/.test(c))).toBe(false);
  });
});

/* ── F1: the wrap read ────────────────────────────────────────────────────── */

describe('§22.8–§22.11 — the wrap read', () => {
  it('carries no §21 reconciliation item key, because a Founder cannot act on one', async () => {
    const { campaignId } = await seedCampaign('wrap');
    const wrap = await readFounderWrap(h.db, campaignId);
    expect(wrap).not.toBeNull();

    const payload = JSON.stringify(wrap);
    for (const itemKey of shared.RECONCILIATION_ITEMS.map((item) => item.key)) {
      expect(payload).not.toContain(itemKey);
    }
    // What it DOES carry is whether the money is closed out, and §22.11's own
    // sentence keeping that apart from delivery.
    expect(wrap?.resolution.fulfillmentNote).toBe(shared.RESOLUTION_IS_NOT_FULFILLMENT);
  });

  it('offers §22.9’s ask only on a recorded §22.8 completion', async () => {
    const { campaignId } = await seedCampaign('eligibility');
    const wrap = await readFounderWrap(h.db, campaignId);
    // No roster on this campaign, so nothing is eligible — the point being
    // that eligibility is read from a record rather than from a sales figure.
    expect(wrap?.creators).toEqual([]);
  });
});

/* ── The registers, and the surfaces that must exist ──────────────────────── */

describe('Session F registers', () => {
  it('the backend restatement matches shared exactly', () => {
    expect(backendLogic.FOUNDER_EXPORT_COLUMNS).toEqual(shared.FOUNDER_EXPORT_COLUMNS);
    expect(backendLogic.FOUNDER_EXPORT_WITHHELD).toEqual(shared.FOUNDER_EXPORT_WITHHELD);
    expect(backendLogic.DO_NOT_FULFILL_LABEL).toBe(shared.DO_NOT_FULFILL_LABEL);
    expect([...backendLogic.BACKER_DATA_PURPOSE_KEYS]).toEqual(
      shared.BACKER_DATA_PURPOSES.map((p) => p.key),
    );
    expect([...backendLogic.BACKER_DATA_REQUEST_DECISIONS]).toEqual([
      ...shared.BACKER_DATA_REQUEST_DECISIONS,
    ]);
  });

  it('every refusal names its rule at length', () => {
    expect(shared.WRAP_ABSENCES.length).toBeGreaterThanOrEqual(7);
    for (const absence of shared.WRAP_ABSENCES) {
      // A one-word reason is how a register stops being an argument.
      expect(absence.absentBecause.length).toBeGreaterThan(60);
      expect(absence.control.length).toBeGreaterThan(10);
    }
    for (const refused of shared.REFUSED_BACKER_DATA_PURPOSES) {
      expect(refused.refusedBecause.length).toBeGreaterThan(60);
    }
  });

  it('`NextCampaign.tsx` is reachable — it was built in Phase 21b and routed nowhere', () => {
    const chapter = readFileSync(
      path.join(FRONTEND_SRC, 'surfaces', 'founder', 'chapters', 'WrapChapter.tsx'),
      'utf8',
    );
    expect(stripComments(chapter)).toContain('<NextCampaign');
  });

  it('the chapter and the Backers page name no column of their own', () => {
    /*
      §25.7's limit applies to what leaves the SERVER. A column list the
      browser owned would be a limit the requester can widen, so the surfaces
      render `view.exportColumns` and hold no header string themselves.
    */
    for (const file of [
      path.join(FRONTEND_SRC, 'surfaces', 'founder', 'BackersPage.tsx'),
      path.join(FRONTEND_SRC, 'surfaces', 'founder', 'chapters', 'WrapChapter.tsx'),
    ]) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const header of shared.FOUNDER_EXPORT_COLUMNS.map((c) => c.header)) {
        expect(source).not.toContain(`'${header}'`);
      }
    }
  });

  it('the Wrap chapter is registered as built, and every chapter now is', () => {
    expect(shared.FOUNDER_CHAPTER_BUILD.after.ownedForNowBy).toBeNull();
    for (const id of shared.FOUNDER_CHAPTER_IDS) {
      expect(shared.FOUNDER_CHAPTER_BUILD[id].ownedForNowBy).toBeNull();
    }
  });
});
