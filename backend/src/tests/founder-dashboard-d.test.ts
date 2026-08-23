/**
 * Founder Dashboard Session D — Chapter 2, Live.
 *
 * The D4 done-when, minus the parts that are properties of a rendered surface
 * (`founder-dashboard.test.tsx` owns those). What this file drives is the
 * record and the routes: the §33.6.6 receipt split, §20's three tiers decided
 * by the FIELD, deviation 2's guarantees at the DATABASE, and the absence of a
 * ranking anywhere in `creator_results`.
 *
 * ── Most of it is about what CANNOT happen ──────────────────────────────────
 * Deviation 2 sits beside a §30 entry, so what keeps it narrow is not anybody's
 * intention — it is a table with no free-text column, a revoked UPDATE grant,
 * and a route whose body is ignored. Those are the assertions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignBuild } from '../db/schema/build.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { founderPostAcknowledgements } from '../db/schema/posts.js';
import { campaignLiveEdits, campaignChangeRequests } from '../db/schema/live-editing.js';
import { campaignHomeDeliveries } from '../db/schema/live.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import {
  ACKNOWLEDGEMENT_HAS_NO_MESSAGE,
  ACKNOWLEDGEMENT_IS_ONE_WAY,
} from '../live/post-logic.js';
import * as shared from '@proovd/shared';

let h: Harness;

const gateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_fdd_suite',
  connectWebhookSecret: 'whsec_connect_for_fdd_suite',
  taxEnabled: true,
});

beforeAll(async () => {
  h = await startHarness(
    {
      stripeGateway: gateway,
      stripeConnectUrls: {
        returnUrl: 'https://app.example.com/stripe/return',
        refreshUrl: 'https://app.example.com/stripe/refresh',
      },
    },
    'fdd',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');

/** Comments explain what these files refuse to do; a scan must not read one as a usage. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Drizzle wraps the driver error, so the constraint's words are on `cause`. */
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

interface Seeded {
  campaignId: string;
  associationId: string;
  submissionId: string;
  founderId: string;
  founderEmail: string;
  creatorEmail: string;
}

/** One LIVE campaign, with one Creator and one submitted post on it. */
async function seedLive(
  label: string,
  opts: { postStatus?: string; handles?: string[] } = {},
): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `fdd-founder-${label}`);
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

  const liveAt = new Date(Date.now() - 6 * 24 * 3_600_000);
  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'live',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(Date.now() - 10 * 24 * 3_600_000),
      campaignLiveAt: liveAt,
      campaignCloseAt: new Date(Date.now() + 8 * 24 * 3_600_000),
      highEffort: true,
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

  // Handles are seeded in a deliberately UNsorted order, so the alphabetical
  // ordering assertion cannot pass by the insert order happening to match.
  const handles = opts.handles ?? [`@zeta-${label}`, `@alpha-${label}`];
  let first: { associationId: string; submissionId: string } | null = null;
  let creatorEmail = '';

  for (const [index, handle] of handles.entries()) {
    const creator = await seedUser(h, 'affiliate', `fdd-creator-${label}-${index}`);
    if (index === 0) creatorEmail = creator.email;
    const [cp] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: `Creator ${handle}`,
        publicHandle: handle,
        email: creator.email,
        subtype: 'social_creator',
        audienceNiche: 'workbench',
        audienceSize: '48k',
        adminBio: 'Weekly bench builds.',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });
    const [assoc] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: randomUUID(),
        prospectId: cp!.id,
        status: 'active',
        rosterMembership: 'initial_roster',
      })
      .returning({ id: campaignAffiliateAssociations.id });
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId: cp!.id,
      associationId: assoc!.id,
      email: creator.email,
      publicHandle: handle,
      claimedUserId: creator.id,
      claimedAt: new Date(),
      updatedBy: 'test',
    });
    const [submission] = await h.db
      .insert(creatorPostSubmissions)
      .values({
        associationId: assoc!.id,
        campaignId,
        postUrl: `https://example.social/${handle.slice(1)}/p/${index}`,
        channel: 'social',
        submittedAt: new Date(Date.now() - (index + 1) * 3_600_000),
        submittedBy: `user:${creator.id}`,
        status: (opts.postStatus ?? 'passed') as 'passed',
      })
      .returning({ id: creatorPostSubmissions.id });
    if (index === 0) {
      first = { associationId: assoc!.id, submissionId: submission!.id };
    }
  }

  return {
    campaignId,
    associationId: first!.associationId,
    submissionId: first!.submissionId,
    founderId: founder.id,
    founderEmail: founder.email,
    creatorEmail,
  };
}

const signIn = (email: string) => signInPlain(h, email);

/**
 * Run a statement as the APPLICATION role.
 *
 * `h.db` connects as the migrator, which OWNS every table and is not subject
 * to a REVOKE — so a grant assertion made through it passes for the wrong
 * reason. `admin-tasks.test.ts` and `support-workspace.test.ts` established
 * this shape for the same reason.
 */
async function asAppRole<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await h.pool.connect();
  try {
    await client.query('SET ROLE proovd_app');
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}
const homeBase = (campaignId: string) => `/api/founder/campaigns/${campaignId}`;

/* ══════════════════════════════════════════════════════════════════════════
   D1 — one render, one receipt
   ══════════════════════════════════════════════════════════════════════════ */

describe('D1 · the Glance receipt is minted once per render', () => {
  it('one chapter render mints exactly one receipt, and every refresh mints none', async () => {
    const seeded = await seedLive('receipt');
    const cookie = await signIn(seeded.founderEmail);

    const countReceipts = async () => {
      const [row] = await h.db
        .select({ n: sql<number>`count(*)::int` })
        .from(campaignHomeDeliveries)
        .where(eq(campaignHomeDeliveries.campaignId, seeded.campaignId));
      return Number(row?.n ?? 0);
    };

    expect(await countReceipts()).toBe(0);

    // The chapter's ONE `home` read on mount.
    const home = await request(h.app).get(`${homeBase(seeded.campaignId)}/home`).set('Cookie', cookie);
    expect(home.status).toBe(200);
    expect(await countReceipts()).toBe(1);

    // Every later refresh in the chapter goes here — after posting an update,
    // after a live edit, after an acknowledgement. Five of them mint nothing.
    for (let i = 0; i < 5; i++) {
      const explore = await request(h.app)
        .get(`${homeBase(seeded.campaignId)}/home/explore`)
        .set('Cookie', cookie);
      expect(explore.status).toBe(200);
    }
    expect(await countReceipts()).toBe(1);

    // And the two reads agree about the sections, so the refresh is a real
    // substitute rather than a smaller thing wearing the same name.
    const explore = await request(h.app)
      .get(`${homeBase(seeded.campaignId)}/home/explore`)
      .set('Cookie', cookie);
    expect(explore.body.explore.sections.map((s: { key: string }) => s.key)).toEqual(
      home.body.home.explore.sections.map((s: { key: string }) => s.key),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D2 — the field's tier decides, and a `never_direct` field opens nothing
   ══════════════════════════════════════════════════════════════════════════ */

describe('D2 · §20 three tiers, decided by the field', () => {
  it('a column-one field publishes; a column-two field opens a request; column three opens nothing', async () => {
    const seeded = await seedLive('tiers');
    const cookie = await signIn(seeded.founderEmail);
    const post = (body: Record<string, unknown>) =>
      request(h.app).post(`${homeBase(seeded.campaignId)}/live-edit`).set('Cookie', cookie).send(body);

    /* Column one — direct, with version history. */
    const direct = await post({
      surface: 'build',
      field: 'brandVoice',
      value: 'Plain, unhurried, and specific.',
    });
    expect(direct.status).toBe(200);
    expect(direct.body.tier).toBe('direct_versioned');

    /* Column two — routed to Admin, and nothing published. */
    const review = await post({
      surface: 'build',
      field: 'deliveryWindow',
      value: 'March 2027',
      reason: 'The anodiser moved.',
    });
    expect(review.status).toBe(202);
    expect(review.body.tier).toBe('requires_review');

    /* Column three — refused, and NOTHING opened. §20: these were fixed when
       people agreed to them, so there is no request to make. */
    const beforeRequests = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignChangeRequests)
      .where(eq(campaignChangeRequests.campaignId, seeded.campaignId));

    const locked = await post({
      surface: 'build',
      field: 'orderThreshold',
      value: 500,
      reason: 'I would like a lower one.',
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe('never_direct');

    const afterRequests = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignChangeRequests)
      .where(eq(campaignChangeRequests.campaignId, seeded.campaignId));
    expect(Number(afterRequests[0]!.n)).toBe(Number(beforeRequests[0]!.n));

    const edits = await h.db
      .select({ field: campaignLiveEdits.field })
      .from(campaignLiveEdits)
      .where(eq(campaignLiveEdits.campaignId, seeded.campaignId));
    expect(edits.map((e) => e.field)).toEqual(['brandVoice']);
    expect(edits.map((e) => e.field)).not.toContain('orderThreshold');
    expect(edits.map((e) => e.field)).not.toContain('deliveryWindow');
  });

  it('the caller cannot choose the tier — a tier in the body changes nothing', async () => {
    const seeded = await seedLive('nochoice');
    const cookie = await signIn(seeded.founderEmail);

    /*
      §15 makes materiality an Admin judgement and §20's columns are a property
      of the FIELD. A caller that could name its own tier could publish a
      delivery date directly, which is exactly what §33.6.12 forbids.
    */
    const forged = await request(h.app)
      .post(`${homeBase(seeded.campaignId)}/live-edit`)
      .set('Cookie', cookie)
      .send({
        surface: 'build',
        field: 'deliveryWindow',
        value: 'March 2027',
        reason: 'The anodiser moved.',
        tier: 'direct_versioned',
        requiresReview: false,
      });
    expect(forged.status).toBe(202);
    expect(forged.body.tier).toBe('requires_review');

    const edits = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignLiveEdits)
      .where(eq(campaignLiveEdits.campaignId, seeded.campaignId));
    expect(Number(edits[0]!.n)).toBe(0);
  });

  it('§20 names the FAQ loophole by example, so a commitment in a column-one field routes too', async () => {
    const seeded = await seedLive('loophole');
    const cookie = await signIn(seeded.founderEmail);

    const redirected = await request(h.app)
      .post(`${homeBase(seeded.campaignId)}/live-edit`)
      .set('Cookie', cookie)
      .send({
        surface: 'build',
        field: 'brandVoice',
        value: 'Warm and direct. Everything ships by March 2027.',
        reason: 'Tightening the voice note.',
      });
    expect(redirected.status).toBe(202);
    expect(redirected.body.tier).toBe('requires_review');
    expect(redirected.body.redirectedBy).toBe('field_commitment');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Disagreement 2 — the numbers are permitted; the ranking is not
   ══════════════════════════════════════════════════════════════════════════ */

describe('disagreement 2 · no ranking anywhere in creator_results', () => {
  it('carries no rank, position, or per-Creator metric, and states a non-metric order', async () => {
    const seeded = await seedLive('order');
    const cookie = await signIn(seeded.founderEmail);

    const response = await request(h.app)
      .get(`${homeBase(seeded.campaignId)}/home/explore`)
      .set('Cookie', cookie);
    expect(response.status).toBe(200);

    const section = (response.body.explore.sections as { key: string; data: unknown }[]).find(
      (s) => s.key === 'creator_results',
    );
    expect(section).toBeTruthy();

    const serialized = JSON.stringify(section);
    // Word-bounded: a random uuid can contain any three letters, which is why
    // the Session C scan was tightened the same way.
    for (const term of ['rank', 'position', 'leading', 'podium', 'winner', 'revenue', 'score']) {
      expect(serialized).not.toMatch(new RegExp(`\\b${term}\\b`, 'i'));
    }

    const creators = (section as { data: { creators: { publicHandle: string }[] } }).data.creators;
    expect(creators.length).toBe(2);
    // The seed inserts `@zeta…` first. A stated alphabetical order is what the
    // read returns, so the list can never be read as a league table.
    expect(creators.map((c) => c.publicHandle)).toEqual([
      creators.map((c) => c.publicHandle).slice().sort()[0],
      creators.map((c) => c.publicHandle).slice().sort()[1],
    ]);
    expect(creators[0]!.publicHandle.startsWith('@alpha')).toBe(true);

    // And no per-Creator key that would BE a metric even unsorted.
    for (const creator of creators as unknown as Record<string, unknown>[]) {
      expect(Object.keys(creator)).not.toContain('backers');
      expect(Object.keys(creator)).not.toContain('revenueCents');
      expect(Object.keys(creator)).not.toContain('conversionRate');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Deviation 2 — the post acknowledgement
   ══════════════════════════════════════════════════════════════════════════ */

describe('deviation 2 · the acknowledgement carries no message and cannot be undone', () => {
  it('the table has no free-text column of any kind', async () => {
    const rows = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'founder_post_acknowledgements'
    `);
    const columns = (rows.rows as { column_name: string }[]).map((r) => r.column_name).sort();

    // The exact set. A column added without a decision fails this rather than
    // quietly widening what the record may hold.
    expect(columns).toEqual([
      'acknowledged_at',
      'association_id',
      'campaign_id',
      'created_at',
      'founder_user_id',
      'id',
      'submission_id',
    ]);

    for (const forbidden of ['note', 'body', 'comment', 'text', 'message', 'reason', 'withdrawn_at']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('the route ignores a note in the body, and one repeat sends nothing', async () => {
    const seeded = await seedLive('ack');
    const cookie = await signIn(seeded.founderEmail);
    const url = `${homeBase(seeded.campaignId)}/home/posts/${seeded.submissionId}/acknowledge`;

    const first = await request(h.app)
      .post(url)
      .set('Cookie', cookie)
      .send({ note: 'I LOVED THIS POST', message: 'call me', reaction: 'fire' });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const stored = await h.db
      .select()
      .from(founderPostAcknowledgements)
      .where(eq(founderPostAcknowledgements.submissionId, seeded.submissionId));
    expect(stored.length).toBe(1);
    const serialized = JSON.stringify(stored[0]);
    expect(serialized).not.toContain('LOVED');
    expect(serialized).not.toContain('call me');
    expect(serialized).not.toContain('fire');

    // §27.2: a repeat is not a second message.
    const second = await request(h.app).post(url).set('Cookie', cookie).send({});
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);

    const stillOne = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(founderPostAcknowledgements)
      .where(eq(founderPostAcknowledgements.submissionId, seeded.submissionId));
    expect(Number(stillOne[0]!.n)).toBe(1);

    const deliveries = await h.db
      .select({ key: notificationDeliveries.eventKey })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, seeded.submissionId));
    expect(deliveries.map((d) => d.key)).toEqual(['affiliate_post_acknowledged']);
  });

  it('is one-way at the database, not by service discipline', async () => {
    const seeded = await seedLive('oneway');
    const cookie = await signIn(seeded.founderEmail);
    await request(h.app)
      .post(`${homeBase(seeded.campaignId)}/home/posts/${seeded.submissionId}/acknowledge`)
      .set('Cookie', cookie)
      .send({});

    // Neither grant exists, so a support script gets the same answer a service
    // would. There is deliberately no `withdrawAcknowledgement` to call.
    await expect(
      asAppRole((client) => client.query('DELETE FROM founder_post_acknowledgements')),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAppRole((client) =>
        client.query("UPDATE founder_post_acknowledgements SET acknowledged_at = now()"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses a post Proovd has asked for a change to, and sends nothing', async () => {
    const seeded = await seedLive('correction', { postStatus: 'correction_needed' });
    const cookie = await signIn(seeded.founderEmail);

    const response = await request(h.app)
      .post(`${homeBase(seeded.campaignId)}/home/posts/${seeded.submissionId}/acknowledge`)
      .set('Cookie', cookie)
      .send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('under_correction');

    const rows = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(founderPostAcknowledgements)
      .where(eq(founderPostAcknowledgements.submissionId, seeded.submissionId));
    expect(Number(rows[0]!.n)).toBe(0);

    const deliveries = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.entityId, seeded.submissionId));
    expect(Number(deliveries[0]!.n)).toBe(0);
  });

  it('cannot reach a post on somebody else’s campaign, at the route and at the trigger', async () => {
    const mine = await seedLive('mine');
    const theirs = await seedLive('theirs');
    const cookie = await signIn(mine.founderEmail);

    const crossed = await request(h.app)
      .post(`${homeBase(mine.campaignId)}/home/posts/${theirs.submissionId}/acknowledge`)
      .set('Cookie', cookie)
      .send({});
    expect(crossed.status).toBe(404);

    // The service refuses by name; the 0057 trigger refuses regardless of who
    // is calling, which is the half a service cannot forget.
    await expectDbRefusal(
      h.db.insert(founderPostAcknowledgements).values({
        campaignId: mine.campaignId,
        associationId: mine.associationId,
        submissionId: theirs.submissionId,
        founderUserId: mine.founderId,
      }),
      /not on this campaign/i,
    );
  });

  it('the post read is §11’s projection and carries no Admin working record', async () => {
    const seeded = await seedLive('projection');
    const cookie = await signIn(seeded.founderEmail);

    const response = await request(h.app)
      .get(`${homeBase(seeded.campaignId)}/home/posts`)
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    const [post] = response.body.posts as Record<string, unknown>[];
    expect(Object.keys(post!).sort()).toEqual([
      'acknowledgeable',
      'acknowledgedAt',
      'associationId',
      'channel',
      'postUrl',
      'publicHandle',
      'status',
      'submissionId',
      'submittedAt',
    ]);
    // §17's working record, §25.6's internal column, and the person behind the
    // handle are all absent because they are not in the projection at all.
    for (const forbidden of ['checklist', 'correctionDetail', 'enforcementReason', 'evidence', 'email', 'legalName']) {
      expect(Object.keys(post!)).not.toContain(forbidden);
    }
  });

  it('sends exactly one key, and no acknowledgement response key exists', async () => {
    const keys = Object.keys(shared.NOTIFICATION_EVENTS);
    const acknowledgement = keys.filter((k) => /acknowledg/i.test(k));
    expect(acknowledgement).toEqual(['affiliate_post_acknowledged']);
    expect(keys).not.toContain('founder_post_acknowledged');
    expect(shared.NOTIFICATION_EVENTS['affiliate_post_acknowledged']!.audience).toBe('affiliate');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The register, the drift, and the vocabulary
   ══════════════════════════════════════════════════════════════════════════ */

describe('the Live register', () => {
  it('every absence names a real reason, and none is a one-word dismissal', () => {
    const ids = shared.LIVE_ABSENCES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const absence of shared.LIVE_ABSENCES) {
      expect(absence.reference.length).toBeGreaterThan(20);
      // A one-word reason is how a register stops being an argument.
      expect(absence.sentence.length).toBeGreaterThan(60);
      expect(absence.specRef).toMatch(/§|Track/);
    }
    expect(ids).toContain('creator_leaderboard');
    expect(ids).toContain('money_made');
    expect(ids).toContain('post_issue');
    expect(ids).toContain('acknowledgement_note');
  });

  it('names all three §20 tiers, once each, and resolves every register entry', () => {
    expect(shared.EDIT_TIER_GROUPS.map((g) => g.tier)).toEqual([
      'direct_versioned',
      'requires_review',
      'never_direct',
    ]);
    for (const field of shared.EDITABLE_FIELDS) {
      expect(shared.editTierGroup(field.tier).label.length).toBeGreaterThan(0);
    }
  });

  it('the backend restates only what a MESSAGE renders, and it has not drifted', () => {
    expect(ACKNOWLEDGEMENT_HAS_NO_MESSAGE).toBe(shared.ACKNOWLEDGEMENT_HAS_NO_MESSAGE);
    expect(ACKNOWLEDGEMENT_IS_ONE_WAY).toBe(shared.ACKNOWLEDGEMENT_IS_ONE_WAY);
  });

  it('carries no §3.1 or §3.2 banned term, including in identifiers', () => {
    const serialized = JSON.stringify({
      absences: shared.LIVE_ABSENCES,
      tiers: shared.EDIT_TIER_GROUPS,
      sentences: [
        shared.RESERVED_IS_NOT_RAISED,
        shared.FRESHNESS_IS_A_READ_TIME,
        shared.TIER_IS_A_PROPERTY_OF_THE_FIELD,
        shared.COMMITMENT_ROUTES_TO_REVIEW,
        shared.ACKNOWLEDGEMENT_HAS_NO_MESSAGE,
        shared.ACKNOWLEDGEMENT_IS_ONE_WAY,
        shared.ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION,
      ],
    });
    // `affiliate` is customer-facing-banned and a Founder is a customer;
    // `goal`, `pledge` and `upfront` are §3.2's, binding identifiers too, and
    // three supplied references in a row have shipped one of them.
    for (const term of ['affiliate', 'pledge', 'upfront', 'goal', 'escrow', 'reservation', 'pre-build', 'pre-launch']) {
      expect(serialized.toLowerCase()).not.toMatch(new RegExp(`\\b${term}\\b`));
    }
  });

  it('the chapter never says “real time”, and mints no receipt on a refresh', () => {
    const source = stripComments(
      readFileSync(path.join(FRONTEND_SRC, 'surfaces/founder/chapters/LiveChapter.tsx'), 'utf8'),
    );
    // §20: freshness reads `Updated 3:40 PM`. §30 bans the immediacy claim.
    for (const banned of ['real time', 'real-time', 'realtime', 'live updating', 'auto-refresh']) {
      expect(source.toLowerCase()).not.toContain(banned);
    }
    // §33.6.6's trap: exactly ONE `fetchCampaignHome` call site in the chapter.
    expect(source.match(/fetchCampaignHome\(/g)?.length ?? 0).toBe(1);
    // And no timer that navigates or refetches (disagreement 14).
    expect(source).not.toMatch(/setInterval\(/);
    expect(source).not.toMatch(/setTimeout\([^)]*fetch/);
  });
});
