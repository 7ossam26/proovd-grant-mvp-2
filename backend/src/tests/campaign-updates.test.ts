/**
 * Phase 14c — campaign updates (§18).
 *
 * §18: Product allows general/public or Backer-only; Idea adds
 * milestone/progress; updates post only after live and may continue after
 * close; a material delivery change carries the previous and revised commitment
 * together. Backer-only updates are stored but never on the public page.
 *
 * Each scenario seeds its own campaign directly — the build/launch journey is
 * Phase 12–14b's suite; what is under test here is what an update does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';

import {
  postUpdate,
  listPublicUpdates,
  listFounderUpdates,
  UPDATE_AUDIENCES,
  UPDATE_AUDIENCES_BY_MODEL,
  PUBLIC_UPDATE_AUDIENCES,
} from '../campaign/updates.js';
import {
  UPDATE_AUDIENCES as SHARED_AUDIENCES,
  UPDATE_AUDIENCES_BY_MODEL as SHARED_BY_MODEL,
  PUBLIC_UPDATE_AUDIENCES as SHARED_PUBLIC,
} from '@proovd/shared';

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness({}, 'updates');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

interface Seeded {
  campaignId: string;
  founderId: string;
  founderEmail: string;
}

async function seedCampaign(
  label: string,
  options: { status?: 'live' | 'creator_prep' | 'ended_no_charge'; type?: 'pre_build' | 'pre_launch' } = {},
): Promise<Seeded> {
  const status = options.status ?? 'live';
  const type = options.type ?? 'pre_launch';
  const founder = await seedUser(h, 'founder', `upd-founder-${label}`);

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
      status,
      type,
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 1000),
      campaignCloseAt: new Date(Date.now() + 14 * 86_400_000),
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
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    heroPreference: 'hero-image',
    requiredWording: 'Truthful.',
    prohibitedClaims: 'None.',
    opensAt: new Date(Date.now() + 86_400_000),
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    orderThreshold: type === 'pre_build' ? 250 : null,
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

  return { campaignId, founderId: founder.id, founderEmail: founder.email };
}

/* ── Drift (shared ⇄ backend) ───────────────────────────────────────────────── */

describe('update vocabulary drift (shared ⇄ backend)', () => {
  it('the audiences, the per-model rule, and the public filter match', () => {
    expect([...UPDATE_AUDIENCES]).toEqual([...SHARED_AUDIENCES]);
    expect([...PUBLIC_UPDATE_AUDIENCES]).toEqual([...SHARED_PUBLIC]);
    expect([...UPDATE_AUDIENCES_BY_MODEL.idea]).toEqual([...SHARED_BY_MODEL.idea]);
    expect([...UPDATE_AUDIENCES_BY_MODEL.product]).toEqual([...SHARED_BY_MODEL.product]);
  });
});

/* ── The posting rules (§18) ────────────────────────────────────────────────── */

describe('§18 posting rules', () => {
  it('refuses an update before the campaign is live', async () => {
    const seeded = await seedCampaign('prelive', { status: 'creator_prep' });
    const result = await postUpdate(h.db, { audit }, {
      campaignId: seeded.campaignId,
      author: `founder:${seeded.founderId}`,
      audience: 'general_public',
      body: 'Too early.',
    });
    expect(result.status).toBe('not_live');
  });

  it('allows an update once live, and still after a natural close', async () => {
    const live = await seedCampaign('live');
    const posted = await postUpdate(h.db, { audit }, {
      campaignId: live.campaignId,
      author: `founder:${live.founderId}`,
      audience: 'general_public',
      body: 'We are live.',
    });
    expect(posted.status).toBe('posted');

    const closed = await seedCampaign('closed', { status: 'ended_no_charge' });
    const afterClose = await postUpdate(h.db, { audit }, {
      campaignId: closed.campaignId,
      author: `founder:${closed.founderId}`,
      audience: 'general_public',
      body: 'A closing note.',
    });
    expect(afterClose.status).toBe('posted');
  });

  it('milestone/progress is Idea-only — refused on a Product campaign, allowed on Idea', async () => {
    const product = await seedCampaign('prodms', { type: 'pre_launch' });
    const refused = await postUpdate(h.db, { audit }, {
      campaignId: product.campaignId,
      author: `founder:${product.founderId}`,
      audience: 'milestone_progress',
      body: 'A milestone.',
    });
    expect(refused.status).toBe('audience_not_allowed');

    const idea = await seedCampaign('ideams', { type: 'pre_build' });
    const allowed = await postUpdate(h.db, { audit }, {
      campaignId: idea.campaignId,
      author: `founder:${idea.founderId}`,
      audience: 'milestone_progress',
      body: 'Halfway there.',
    });
    expect(allowed.status).toBe('posted');
  });

  it('the database refuses a milestone update on a Product campaign even by a direct insert', async () => {
    const product = await seedCampaign('prodtrig', { type: 'pre_launch' });
    await expect(
      h.db.insert(campaignUpdates).values({
        campaignId: product.campaignId,
        author: 'founder:test',
        audience: 'milestone_progress',
        body: 'Bypass attempt.',
        publishedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('a material delivery change stores both commitments; the CHECK forbids a half one', async () => {
    const seeded = await seedCampaign('material');
    const posted = await postUpdate(h.db, { audit }, {
      campaignId: seeded.campaignId,
      author: `founder:${seeded.founderId}`,
      audience: 'general_public',
      body: 'Delivery moved.',
      deliveryChange: { prior: 'December 2026', revised: 'February 2027' },
    });
    expect(posted.status).toBe('posted');
    expect((posted as { update: { isMaterialDeliveryChange: boolean } }).update.isMaterialDeliveryChange).toBe(true);

    // A row that claims to be material but names only one side is refused by the CHECK.
    await expect(
      h.db.insert(campaignUpdates).values({
        campaignId: seeded.campaignId,
        author: 'founder:test',
        audience: 'general_public',
        body: 'Half a change.',
        publishedAt: new Date(),
        isMaterialDeliveryChange: true,
        priorCommitment: 'December 2026',
      }),
    ).rejects.toThrow();
  });

  it('refuses a blank body and an invalid media URL', async () => {
    const seeded = await seedCampaign('invalid');
    const blank = await postUpdate(h.db, { audit }, {
      campaignId: seeded.campaignId,
      author: `founder:${seeded.founderId}`,
      audience: 'general_public',
      body: '   ',
    });
    expect(blank.status).toBe('invalid');

    const badUrl = await postUpdate(h.db, { audit }, {
      campaignId: seeded.campaignId,
      author: `founder:${seeded.founderId}`,
      audience: 'general_public',
      body: 'Has a bad link.',
      imageUrl: 'javascript:alert(1)',
    });
    expect(badUrl.status).toBe('invalid');
  });
});

/* ── Public vs Founder listing (§18) ────────────────────────────────────────── */

describe('§18 a Backer-only update never reaches the public page', () => {
  it('listPublicUpdates excludes backer_only; listFounderUpdates includes everything', async () => {
    const seeded = await seedCampaign('audience', { type: 'pre_build' });
    const author = `founder:${seeded.founderId}`;
    await postUpdate(h.db, { audit }, { campaignId: seeded.campaignId, author, audience: 'general_public', body: 'Public one.' });
    await postUpdate(h.db, { audit }, { campaignId: seeded.campaignId, author, audience: 'backer_only', body: 'Backers only.' });
    await postUpdate(h.db, { audit }, { campaignId: seeded.campaignId, author, audience: 'milestone_progress', body: 'Milestone.' });

    const publicUpdates = await listPublicUpdates(h.db, seeded.campaignId);
    const founderUpdates = await listFounderUpdates(h.db, seeded.campaignId);

    expect(founderUpdates).toHaveLength(3);
    expect(publicUpdates).toHaveLength(2);
    expect(publicUpdates.every((u) => u.audience !== 'backer_only')).toBe(true);
    expect(publicUpdates.some((u) => u.audience === 'milestone_progress')).toBe(true);
  });

  it('the public campaign endpoint returns the public updates and never a Backer-only one', async () => {
    const seeded = await seedCampaign('http');
    const author = `founder:${seeded.founderId}`;
    await postUpdate(h.db, { audit }, { campaignId: seeded.campaignId, author, audience: 'general_public', body: 'Shown publicly.' });
    await postUpdate(h.db, { audit }, { campaignId: seeded.campaignId, author, audience: 'backer_only', body: 'Hidden from the public.' });

    const res = await request(h.app).get(`/api/campaign/${seeded.campaignId}`).expect(200);
    const bodies = (res.body.updates as Array<{ body: string; audience: string }>).map((u) => u.body);
    expect(bodies).toContain('Shown publicly.');
    expect(bodies).not.toContain('Hidden from the public.');
    expect(res.body.updates.every((u: { audience: string }) => u.audience !== 'backer_only')).toBe(true);
  });
});

/* ── The Founder route (§18) ────────────────────────────────────────────────── */

describe('§18 the Founder posts through the authenticated route', () => {
  it('posts an update and reads it back; another Founder cannot', async () => {
    const seeded = await seedCampaign('route');
    const cookie = await signInPlain(h, seeded.founderEmail);

    const posted = await request(h.app)
      .post(`/api/founder/campaigns/${seeded.campaignId}/updates`)
      .set('Cookie', cookie)
      .send({ audience: 'general_public', title: 'Big news', body: 'It shipped.' })
      .expect(201);
    expect(posted.body.update.title).toBe('Big news');

    const list = await request(h.app)
      .get(`/api/founder/campaigns/${seeded.campaignId}/updates`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.updates).toHaveLength(1);
    expect(list.body.canPost).toBe(true);

    // A different Founder gets the same 404 a non-existent campaign would.
    const otherFounder = await seedUser(h, 'founder', 'upd-intruder');
    const otherCookie = await signInPlain(h, otherFounder.email);
    await request(h.app)
      .get(`/api/founder/campaigns/${seeded.campaignId}/updates`)
      .set('Cookie', otherCookie)
      .expect(404);
  });
});

/* ── Append-only (§25.6) ────────────────────────────────────────────────────── */

describe('§25.6 an update is append-only for the app role', () => {
  it('the app role cannot UPDATE or DELETE a posted update', async () => {
    const seeded = await seedCampaign('appendonly');
    const posted = await postUpdate(h.db, { audit }, {
      campaignId: seeded.campaignId,
      author: `founder:${seeded.founderId}`,
      audience: 'general_public',
      body: 'Immutable.',
    });
    const id = (posted as { update: { id: string } }).update.id;

    // Each denial is its own transaction: the failing statement aborts it, and
    // drizzle rolls back and re-throws, so the whole transaction rejects.
    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx.update(campaignUpdates).set({ body: 'edited' }).where(eq(campaignUpdates.id, id));
      }),
    ).rejects.toThrow();

    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx.delete(campaignUpdates).where(eq(campaignUpdates.id, id));
      }),
    ).rejects.toThrow();

    // The row is still there, unchanged.
    const [row] = await h.db.select().from(campaignUpdates).where(eq(campaignUpdates.id, id));
    expect(row?.body).toBe('Immutable.');
  });
});
