/**
 * Phase 17a — live campaign operations: Glance, Act, Explore, and the event
 * substrate.
 *
 * Acceptance:
 *  **§33.6.6** — "Founder Glance delta is exact; failed render does not advance
 *  last-seen."
 *  **§33.6.7** — "Act shows one correctly ranked real action or caught-up
 *  ending."
 *  **§33.6.8** — "Explore contains complete data/freshness without widget grid."
 *  **§33.6.9** — "New/canceled/net counts reconcile."
 *  **§33.6.10** — "Threshold reached/lost notifications fire once per crossing."
 *  **§33.6.11** — "No scheduled generic Day 3/7/10 check email exists."
 *
 * Also covered, because the phase's done-when list names them:
 *  - Act rank corrections store prior rank, reason, actor, and time (§31.9);
 *  - the documented safety override cannot manufacture an action;
 *  - no counters table exists — the counts compose from the append-only history.
 *
 * Drift guards run first: `live/logic.ts` restates every register and derivation
 * because the backend cannot import `@proovd/shared` at runtime, and a ranking
 * that disagreed between the two would show a Founder the wrong next action.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import {
  campaigns,
  reservations,
  reservationStatusHistory,
  campaignAffiliateAssociations,
} from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignRewardPackages, materialChanges } from '../db/schema/build.js';
import { backerIdentities, campaignReservationCapacity } from '../db/schema/reservations.js';
import { campaignUpdates } from '../db/schema/updates.js';
import {
  campaignThresholdCrossings,
  campaignMilestones,
  campaignHomeDeliveries,
  founderCampaignLastSeen,
  actRankCorrections,
} from '../db/schema/live.js';

import {
  ACT_ACTION_KINDS,
  ACT_RANK_BY_KIND,
  ACT_CORRECTION_KINDS,
  ACT_CAUGHT_UP,
  BANNED_FRESHNESS_TERMS,
  EXPLORE_SECTION_KEYS,
  GLANCE_NOT_YET_CHARGED,
  MILESTONE_KINDS,
  ATTRIBUTION_BREAKDOWN_SOURCES,
  crossingFor,
  reachedMilestones,
  reconcileCounts,
  thresholdStateFor,
} from '../live/logic.js';
import { readPreorderCounts } from '../live/counts.js';
import { readGlance, acknowledgeDelivery, listOpenDeliveries } from '../live/glance.js';
import { gatherActCandidates, decideAct, recordActCorrection } from '../live/act.js';
import { readExplore } from '../live/explore.js';
import {
  evaluateThresholdCrossing,
  listCrossings,
  listMilestones,
} from '../live/thresholds.js';

import {
  ACT_RANKS as SHARED_ACT_RANKS,
  ACT_ACTION_KINDS as SHARED_ACT_KINDS,
  ACT_CORRECTION_KINDS as SHARED_CORRECTION_KINDS,
  ACT_CAUGHT_UP as SHARED_CAUGHT_UP,
  BANNED_FRESHNESS_TERMS as SHARED_BANNED_TERMS,
  EXPLORE_SECTION_KEYS as SHARED_EXPLORE_KEYS,
  GLANCE_NOT_YET_CHARGED as SHARED_NOT_CHARGED,
  MILESTONE_KINDS as SHARED_MILESTONE_KINDS,
  ATTRIBUTION_BREAKDOWN_SOURCES as SHARED_BREAKDOWN,
  crossingFor as sharedCrossingFor,
  reachedMilestones as sharedReachedMilestones,
  reconcileCounts as sharedReconcileCounts,
  thresholdStateFor as sharedThresholdStateFor,
} from '@proovd/shared';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_live_suite',
  connectWebhookSecret: 'whsec_connect_for_live_suite',
  taxEnabled: true,
});

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'live-ops',
  );
  await seedAdminReauthWindow(h.db, 900);
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

interface Fixture {
  campaignId: string;
  founderUserId: string;
  founderEmail: string;
  founderPassword: string;
  rewardId: string;
  identityIds: string[];
}

async function seedLiveCampaign(
  label: string,
  opts: { model?: 'idea' | 'product'; threshold?: number; status?: string } = {},
): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', `liveops-founder-${label}`);
  const legalName = `Founder ${label}`;
  const closeAt = new Date(Date.now() + 14 * 86_400_000);
  const model = opts.model ?? 'idea';

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName,
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
      status: (opts.status ?? 'live') as never,
      type: model === 'idea' ? 'pre_build' : 'pre_launch',
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
    legalName,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: legalName,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: closeAt,
    ...(model === 'idea' ? { orderThreshold: opts.threshold ?? 3 } : {}),
    refundPolicyTitle: `${label} Refund Policy`,
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  const [reward] = await h.db
    .insert(campaignRewardPackages)
    .values({
      campaignId,
      sku: `${label}-sku`,
      title: `Reward ${label}`,
      priceCents: 5_000n,
      contents: 'One unit.',
      fulfillmentCommitment: 'Ships when ready.',
      delivery: 'March 2027',
    })
    .returning({ id: campaignRewardPackages.id });

  await h.db.insert(campaignReservationCapacity).values({
    campaignId,
    capCents: 5_000_000_00n,
    reservedSubtotalCents: 0n,
  });

  return {
    campaignId,
    founderUserId: founder.id,
    founderEmail: founder.email,
    founderPassword: founder.password,
    rewardId: reward!.id,
    identityIds: [],
  };
}

/**
 * Adds one active pre-order, writing the same `reservation_status_history` row
 * the real pre-order writes. The counts compose from that history, so a fixture
 * that skipped it would be testing a different mechanism than the one that runs.
 */
async function addPreorder(fixture: Fixture, index: number): Promise<string> {
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId: fixture.campaignId,
      email: `backer-${index}-${fixture.campaignId.slice(0, 8)}@example.com`,
      phone: `+1555000${String(index).padStart(4, '0')}`,
      emailNormalized: `backer-${index}-${fixture.campaignId.slice(0, 8)}@example.com`,
      phoneNormalized: `1555000${String(index).padStart(4, '0')}`,
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });

  const [reservation] = await h.db
    .insert(reservations)
    .values({
      campaignId: fixture.campaignId,
      backerIdentityId: identity!.id,
      status: 'reserved_active',
      rewardPackageId: fixture.rewardId,
      rewardSubtotalCents: 5_000n,
      salesTaxCents: 400n,
      totalAuthorizedCents: 5_400n,
      backerEmail: `backer-${index}@example.com`,
      reservedAt: new Date(),
      attributionSource: index % 2 === 0 ? 'direct' : 'creator',
    })
    .returning({ id: reservations.id });

  await h.db.insert(reservationStatusHistory).values({
    reservationId: reservation!.id,
    fromStatus: null,
    toStatus: 'reserved_active',
    actor: `backer:${identity!.id}`,
  });

  fixture.identityIds.push(identity!.id);
  return reservation!.id;
}

async function cancelPreorder(reservationId: string): Promise<void> {
  await h.db
    .update(reservations)
    .set({ status: 'reserved_canceled', canceledAt: new Date() })
    .where(eq(reservations.id, reservationId));
  await h.db.insert(reservationStatusHistory).values({
    reservationId,
    fromStatus: 'reserved_active',
    toStatus: 'reserved_canceled',
    actor: 'backer:test',
  });
}

async function killPreorder(reservationId: string): Promise<void> {
  await h.db
    .update(reservations)
    .set({ status: 'killed_no_charge' })
    .where(eq(reservations.id, reservationId));
  await h.db.insert(reservationStatusHistory).values({
    reservationId,
    fromStatus: 'reserved_active',
    toStatus: 'killed_no_charge',
    actor: 'admin:test',
  });
}

async function founderCookie(fixture: Fixture): Promise<string> {
  return signInPlain(h, fixture.founderEmail);
}

/**
 * Runs a statement as the application role.
 *
 * The suite connects as the migration role, which owns the tables and is not
 * subject to the grants — so an insert-only claim tested from that connection
 * would pass while the app could still rewrite the row. `SET LOCAL ROLE` is the
 * `support-operations.test.ts` pattern, and it is what makes the assertion mean
 * anything.
 */
async function asAppRole(statement: ReturnType<typeof sql>): Promise<void> {
  await h.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE proovd_app`);
    await tx.execute(statement);
  });
}

/**
 * Asserts a statement is refused, and that the refusal is the *named* one.
 *
 * Drizzle wraps the driver error in `Failed query: …`, so matching on the
 * top-level message would pass for any refusal at all — including a typo in the
 * table name. The trigger's own sentence lives on `cause`.
 */
async function expectRefusal(
  run: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'the statement was not refused').toBeDefined();

  const messages: string[] = [];
  let current: unknown = thrown;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
}

/* ── Drift: the backend restates §20's registers ───────────────────────────── */

describe('§20 registers do not drift from @proovd/shared', () => {
  it('restates the five Act ranks with the same numbering', () => {
    expect([...ACT_ACTION_KINDS]).toEqual([...SHARED_ACT_KINDS]);
    for (const definition of SHARED_ACT_RANKS) {
      expect(ACT_RANK_BY_KIND[definition.kind]).toBe(definition.rank);
    }
  });

  it('restates the correction kinds, milestones, Explore keys, and breakdown sources', () => {
    expect([...ACT_CORRECTION_KINDS]).toEqual([...SHARED_CORRECTION_KINDS]);
    expect([...MILESTONE_KINDS]).toEqual([...SHARED_MILESTONE_KINDS]);
    expect([...EXPLORE_SECTION_KEYS]).toEqual([...SHARED_EXPLORE_KEYS]);
    expect([...ATTRIBUTION_BREAKDOWN_SOURCES]).toEqual([...SHARED_BREAKDOWN]);
    expect([...BANNED_FRESHNESS_TERMS]).toEqual([...SHARED_BANNED_TERMS]);
  });

  it('restates the exact §20 copy', () => {
    expect(ACT_CAUGHT_UP).toBe(SHARED_CAUGHT_UP);
    expect(GLANCE_NOT_YET_CHARGED).toBe(SHARED_NOT_CHARGED);
  });

  it('restates the derivations, and the two agree on every case', () => {
    for (const [count, threshold] of [
      [0, 5],
      [4, 5],
      [5, 5],
      [9, 5],
    ] as const) {
      expect(thresholdStateFor(count, threshold)).toBe(sharedThresholdStateFor(count, threshold));
    }
    for (const last of [null, 'reached', 'lost'] as const) {
      for (const current of ['reached', 'below'] as const) {
        expect(crossingFor(last, current)).toBe(sharedCrossingFor(last, current));
      }
    }
    const counts = { newCount: 10, canceledCount: 3, otherExits: 2, activeCount: 5 };
    expect(reconcileCounts(counts)).toEqual(sharedReconcileCounts(counts));
    const milestoneInput = {
      model: 'idea' as const,
      everHadPreorder: true,
      uniqueActiveBackers: 6,
      threshold: 5,
      ended: false,
    };
    expect(reachedMilestones(milestoneInput)).toEqual(sharedReachedMilestones(milestoneInput));
  });
});

/* ── §33.6.9 — new, canceled, and net counts reconcile ─────────────────────── */

describe('§33.6.9 — new, canceled, and net counts reconcile', () => {
  it('composes the four numbers from the append-only history and they agree', async () => {
    const fixture = await seedLiveCampaign('counts', { model: 'product' });
    const ids = [
      await addPreorder(fixture, 1),
      await addPreorder(fixture, 2),
      await addPreorder(fixture, 3),
      await addPreorder(fixture, 4),
      await addPreorder(fixture, 5),
    ];
    await cancelPreorder(ids[0]!);
    await cancelPreorder(ids[1]!);
    await killPreorder(ids[2]!);

    const counts = await readPreorderCounts(h.db, fixture.campaignId);
    expect(counts.newCount).toBe(5);
    expect(counts.canceledCount).toBe(2);
    expect(counts.otherExits).toBe(1);
    expect(counts.activeCount).toBe(2);
    // Net change is what Backers did. The killed one is not a cancellation.
    expect(counts.netChange).toBe(3);
    expect(counts.uniqueActiveBackers).toBe(2);
  });

  it('has no counters table — the counts compose, so they cannot drift', async () => {
    const result = await h.db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%preorder_count%'
          OR table_name LIKE '%campaign_counters%'
          OR table_name LIKE '%reservation_counts%')
    `);
    expect(result.rows).toHaveLength(0);
  });

  it('reports zeroes honestly for a campaign that never had a pre-order', async () => {
    const fixture = await seedLiveCampaign('empty', { model: 'product' });
    const counts = await readPreorderCounts(h.db, fixture.campaignId);
    expect(counts).toMatchObject({
      newCount: 0,
      canceledCount: 0,
      otherExits: 0,
      activeCount: 0,
      netChange: 0,
      everHadPreorder: false,
    });
  });
});

/* ── §33.6.6 — the Glance delta, and the failed render ─────────────────────── */

describe('§33.6.6 — the Glance delta is exact and a failed render does not advance last-seen', () => {
  it('reads no delta on a first visit rather than inventing one', async () => {
    const fixture = await seedLiveCampaign('firstvisit', { model: 'product' });
    await addPreorder(fixture, 1);

    const glance = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(glance!.delta).toBeNull();
    expect(glance!.activePreorderCount).toBe(1);
  });

  it('does NOT advance last-seen on the read — only the acknowledgement does', async () => {
    const fixture = await seedLiveCampaign('noadvance', { model: 'product' });
    await addPreorder(fixture, 1);

    await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    const positions = await h.db
      .select()
      .from(founderCampaignLastSeen)
      .where(eq(founderCampaignLastSeen.campaignId, fixture.campaignId));
    expect(positions).toHaveLength(0);
  });

  it('a failed render leaves the receipt open and the SAME delta on the next read', async () => {
    const fixture = await seedLiveCampaign('failedrender', { model: 'product' });
    await addPreorder(fixture, 1);
    await addPreorder(fixture, 2);

    // First visit acknowledged: the position is established at 2.
    const first = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    await acknowledgeDelivery(h.db, {
      deliveryId: first!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    await addPreorder(fixture, 3);
    await addPreorder(fixture, 4);

    // The render that "failed": issued, never acknowledged.
    const failed = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(failed!.delta).toEqual({ count: 2, since: expect.any(String) });

    const open = await listOpenDeliveries(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(open.map((d) => d.id)).toContain(failed!.deliveryId);

    // The next read computes the SAME delta — nothing was consumed.
    const retry = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(retry!.delta!.count).toBe(2);
    expect(retry!.delta!.since).toBe(failed!.delta!.since);
  });

  it('advances to the count the receipt rendered, not the count at acknowledgement', async () => {
    const fixture = await seedLiveCampaign('renderedcount', { model: 'product' });
    await addPreorder(fixture, 1);

    const rendered = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(rendered!.activePreorderCount).toBe(1);

    // A pre-order arrives between the render and the acknowledgement. It must
    // survive as a delta — the Founder never saw it.
    await addPreorder(fixture, 2);

    await acknowledgeDelivery(h.db, {
      deliveryId: rendered!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    const [position] = await h.db
      .select()
      .from(founderCampaignLastSeen)
      .where(eq(founderCampaignLastSeen.campaignId, fixture.campaignId));
    expect(position!.lastSeenCount).toBe(1);

    const next = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(next!.delta!.count).toBe(1);
  });

  it('acknowledges a receipt exactly once — a retry cannot consume a second delta', async () => {
    const fixture = await seedLiveCampaign('ackonce', { model: 'product' });
    await addPreorder(fixture, 1);

    const glance = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    const first = await acknowledgeDelivery(h.db, {
      deliveryId: glance!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(first).toEqual({ ok: true, advanced: true });

    const second = await acknowledgeDelivery(h.db, {
      deliveryId: glance!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(second).toEqual({ ok: false, code: 'already_acknowledged' });
  });

  it('an out-of-order acknowledgement does not rewind the position', async () => {
    const fixture = await seedLiveCampaign('outoforder', { model: 'product' });
    await addPreorder(fixture, 1);

    const stale = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    await addPreorder(fixture, 2);
    const fresh = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    await acknowledgeDelivery(h.db, {
      deliveryId: fresh!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    const late = await acknowledgeDelivery(h.db, {
      deliveryId: stale!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    // Spent, but the position stayed where the newer render put it.
    expect(late).toEqual({ ok: true, advanced: false });

    const [position] = await h.db
      .select()
      .from(founderCampaignLastSeen)
      .where(eq(founderCampaignLastSeen.campaignId, fixture.campaignId));
    expect(position!.lastSeenCount).toBe(2);
  });

  it('keeps two viewers on one campaign at independent positions', async () => {
    const fixture = await seedLiveCampaign('twoviewers', { model: 'product' });
    await addPreorder(fixture, 1);
    const other = await seedUser(h, 'founder', 'liveops-second-viewer');

    const mine = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    await acknowledgeDelivery(h.db, {
      deliveryId: mine!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    const theirs = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: other.id,
    });
    // Their first visit — my acknowledgement consumed nothing of theirs.
    expect(theirs!.delta).toBeNull();
  });

  it('renders the permanent not-yet-charged clarification, and no immediacy claim', async () => {
    const fixture = await seedLiveCampaign('notcharged', { model: 'idea', threshold: 4 });
    await addPreorder(fixture, 1);

    const glance = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(glance!.notYetChargedNotice).toBe(GLANCE_NOT_YET_CHARGED);
    expect(glance!.freshnessBasis).toBe('refresh');
    expect(glance!.remainingToThreshold).toBe(3);

    const rendered = JSON.stringify(glance).toLowerCase();
    for (const term of BANNED_FRESHNESS_TERMS) {
      expect(rendered).not.toContain(term);
    }
  });

  it('states Creator liveness only when true — never a zero', async () => {
    const fixture = await seedLiveCampaign('liveness', { model: 'product' });
    const none = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(none!.activeCreators).toBeNull();

    await h.db.insert(campaignAffiliateAssociations).values({
      campaignId: fixture.campaignId,
      affiliateId: randomUUID(),
      status: 'active',
      rosterMembership: 'initial_roster',
    });

    const some = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    expect(some!.activeCreators).toBe(1);
  });

  it('serves Glance and the acknowledgement over HTTP, scoped to the session', async () => {
    const fixture = await seedLiveCampaign('http', { model: 'product' });
    await addPreorder(fixture, 1);
    const cookie = await founderCookie(fixture);

    const read = await request(h.app)
      .get(`/api/founder/campaigns/${fixture.campaignId}/home`)
      .set('cookie', cookie);
    expect(read.status).toBe(200);
    expect(read.body.home.glance.activePreorderCount).toBe(1);

    const ack = await request(h.app)
      .post(`/api/founder/campaigns/${fixture.campaignId}/home/seen`)
      .set('cookie', cookie)
      .send({ deliveryId: read.body.home.glance.deliveryId });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ acknowledged: true, advanced: true });

    // Another Founder's campaign answers the same 404 a missing one gets.
    const stranger = await seedLiveCampaign('stranger', { model: 'product' });
    const denied = await request(h.app)
      .get(`/api/founder/campaigns/${stranger.campaignId}/home`)
      .set('cookie', cookie);
    expect(denied.status).toBe(404);
  });

  it('refuses an anonymous read', async () => {
    const fixture = await seedLiveCampaign('anon', { model: 'product' });
    const response = await request(h.app).get(
      `/api/founder/campaigns/${fixture.campaignId}/home`,
    );
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.status).toBeLessThan(404);
  });
});

/* ── §33.6.7 — one correctly ranked real action, or the caught-up ending ───── */

describe('§33.6.7 — Act shows one correctly ranked real action or the caught-up ending', () => {
  it('shows the caught-up ending, and no action, when nothing real is outstanding', async () => {
    const fixture = await seedLiveCampaign('caughtup', { model: 'product' });

    const candidates = await gatherActCandidates(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
    });
    expect(candidates).toEqual([]);

    const act = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: new Date('2026-09-01T17:00:00Z'),
    });
    expect(act.state).toBe('caught_up');
    // No manufactured CTA: there is no href anywhere in the payload.
    expect(JSON.stringify(act)).not.toContain('href');
  });

  it('ranks a milestone below a required update and shows only the higher one', async () => {
    const fixture = await seedLiveCampaign('ranked', { model: 'idea', threshold: 2 });
    await addPreorder(fixture, 1);

    // Rank 5: a real milestone (first pre-order).
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    const milestones = await listMilestones(h.db, fixture.campaignId);
    expect(milestones.map((m) => m.kind)).toContain('first_preorder');

    // Rank 4: a recorded material delivery change with no update pairing it.
    await h.db.insert(materialChanges).values({
      campaignId: fixture.campaignId,
      classification: 'material',
      reason: 'Delivery moved from March to May.',
      affectedFields: ['deliveryWindow'],
      newVersion: 1,
      reacceptanceState: 'complete',
      actor: 'admin:test',
    });

    const act = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: new Date('2026-09-01T17:00:00Z'),
    });
    expect(act.state).toBe('action');
    if (act.state !== 'action') return;
    expect(act.action.kind).toBe('required_campaign_update');
    expect(act.action.rank).toBe(4);
    // The milestone is deferred, not deleted — DNA §5.2.
    expect(act.deferred.map((c) => c.kind)).toContain('optional_milestone_update');
  });

  it('stops requiring the update once §18’s prior/revised pairing is published', async () => {
    const fixture = await seedLiveCampaign('paired', { model: 'product' });
    await h.db.insert(materialChanges).values({
      campaignId: fixture.campaignId,
      classification: 'material',
      reason: 'Delivery moved.',
      affectedFields: ['deliveryWindow'],
      newVersion: 1,
      reacceptanceState: 'complete',
      actor: 'admin:test',
    });

    let candidates = await gatherActCandidates(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
    });
    expect(candidates.map((c) => c.kind)).toContain('required_campaign_update');

    await h.db.insert(campaignUpdates).values({
      campaignId: fixture.campaignId,
      author: 'user:test',
      audience: 'general_public',
      body: 'Delivery has moved. Here is the prior and revised commitment.',
      publishedAt: new Date(Date.now() + 1_000),
      isMaterialDeliveryChange: true,
      priorCommitment: 'March 2027',
      revisedCommitment: 'May 2027',
    });

    candidates = await gatherActCandidates(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
    });
    expect(candidates.map((c) => c.kind)).not.toContain('required_campaign_update');
  });

  it('a non-material change never becomes a required update (§33.4.2’s rule here)', async () => {
    const fixture = await seedLiveCampaign('nonmaterial', { model: 'product' });
    await h.db.insert(materialChanges).values({
      campaignId: fixture.campaignId,
      classification: 'non_material',
      reason: 'Fixed a typo in the story.',
      affectedFields: ['publicStory'],
      reacceptanceState: 'not_required',
      actor: 'admin:test',
    });

    const candidates = await gatherActCandidates(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
    });
    expect(candidates).toEqual([]);
  });

  it('a documented safety override promotes a real candidate and records the four facts', async () => {
    const fixture = await seedLiveCampaign('override', { model: 'idea', threshold: 2 });
    await addPreorder(fixture, 1);
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    await h.db.insert(materialChanges).values({
      campaignId: fixture.campaignId,
      classification: 'material',
      reason: 'Delivery moved.',
      affectedFields: ['deliveryWindow'],
      newVersion: 1,
      reacceptanceState: 'complete',
      actor: 'admin:test',
    });

    const before = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: null,
    });
    if (before.state !== 'action') throw new Error('expected an action');
    expect(before.action.kind).toBe('required_campaign_update');

    const recorded = await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'optional_milestone_update',
      correctionKind: 'safety_override',
      priorRank: 5,
      newRank: 1,
      reason: 'A named reviewer asked us to surface the milestone first this week.',
      actor: 'admin:test',
    });
    expect(recorded.ok).toBe(true);

    const after = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: null,
    });
    if (after.state !== 'action') throw new Error('expected an action');
    expect(after.action.kind).toBe('optional_milestone_update');
    expect(after.overridden).toBe(true);
    expect(after.override?.reason).toContain('named reviewer');
  });

  it('an override naming a kind with no real record manufactures nothing', async () => {
    const fixture = await seedLiveCampaign('emptyoverride', { model: 'product' });
    await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'safety_compliance_blocker',
      correctionKind: 'safety_override',
      priorRank: 1,
      reason: 'Recorded before the blocker existed.',
      actor: 'admin:test',
    });

    const act = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: null,
    });
    expect(act.state).toBe('caught_up');
  });

  it('refuses a second live safety override', async () => {
    const fixture = await seedLiveCampaign('twooverrides', { model: 'product' });
    const first = await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'unanswered_backer_question',
      correctionKind: 'safety_override',
      priorRank: 3,
      reason: 'First.',
      actor: 'admin:test',
    });
    expect(first.ok).toBe(true);

    const second = await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'required_campaign_update',
      correctionKind: 'safety_override',
      priorRank: 4,
      reason: 'Second.',
      actor: 'admin:test',
    });
    expect(second).toMatchObject({ ok: false, code: 'override_exists' });
  });

  it('stores prior rank, reason, actor, and time on every correction (§31.9)', async () => {
    const fixture = await seedLiveCampaign('corrections', { model: 'product' });
    const result = await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'optional_milestone_update',
      correctionKind: 'reclassification',
      priorRank: 5,
      newRank: 3,
      reason: 'This was really a Backer question in a milestone’s clothing.',
      actor: 'user:founder-1',
      sourceTable: 'campaign_milestones',
      sourceId: randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.correction.priorRank).toBe(5);
    expect(result.correction.newRank).toBe(3);
    expect(result.correction.reason).toContain('Backer question');
    expect(result.correction.actor).toBe('user:founder-1');
    expect(result.correction.occurredAt).toBeInstanceOf(Date);
  });

  it('refuses a correction with no reason, and a reclassification with no new rank', async () => {
    const fixture = await seedLiveCampaign('badcorrections', { model: 'product' });
    expect(
      await recordActCorrection(h.db, { audit }, {
        campaignId: fixture.campaignId,
        actionKind: 'optional_milestone_update',
        correctionKind: 'dismissal',
        priorRank: 5,
        reason: '   ',
        actor: 'admin:test',
      }),
    ).toMatchObject({ ok: false, code: 'missing_reason' });

    expect(
      await recordActCorrection(h.db, { audit }, {
        campaignId: fixture.campaignId,
        actionKind: 'optional_milestone_update',
        correctionKind: 'reclassification',
        priorRank: 5,
        reason: 'Wrong rank.',
        actor: 'admin:test',
      }),
    ).toMatchObject({ ok: false, code: 'invalid_rank' });
  });

  it('the corrections record is insert-only', async () => {
    const fixture = await seedLiveCampaign('insertonly', { model: 'product' });
    await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'optional_milestone_update',
      correctionKind: 'dismissal',
      priorRank: 5,
      reason: 'Not worth showing.',
      actor: 'admin:test',
    });

    // As the application role — the migration role owns the tables and is not
    // subject to the grants, so testing from it would prove nothing.
    await expectRefusal(
      () =>
        asAppRole(sql`
          UPDATE act_rank_corrections SET reason = 'rewritten'
          WHERE campaign_id = ${fixture.campaignId}
        `),
      /permission denied|denied for/i,
    );
    await expectRefusal(
      () =>
        asAppRole(
          sql`DELETE FROM act_rank_corrections WHERE campaign_id = ${fixture.campaignId}`,
        ),
      /permission denied|denied for/i,
    );
  });

  it('a dismissed candidate stops being shown', async () => {
    // Threshold 6 so one pre-order reaches `first_preorder` and nothing else —
    // halfway would be a second rank-5 candidate and the test would be about
    // dismissing one of two rather than about dismissal.
    const fixture = await seedLiveCampaign('dismissed', { model: 'idea', threshold: 6 });
    await addPreorder(fixture, 1);
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });

    const milestones = await listMilestones(h.db, fixture.campaignId);
    expect(milestones.map((m) => m.kind)).toEqual(['first_preorder']);
    const [milestone] = milestones;
    const before = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: null,
    });
    expect(before.state).toBe('action');

    await recordActCorrection(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actionKind: 'optional_milestone_update',
      correctionKind: 'dismissal',
      priorRank: 5,
      reason: 'We are not posting about the first pre-order.',
      actor: 'user:founder',
      sourceTable: 'campaign_milestones',
      sourceId: milestone!.id,
    });

    const after = await decideAct(h.db, {
      campaignId: fixture.campaignId,
      campaignStatus: 'live',
      closesAt: null,
    });
    expect(after.state).toBe('caught_up');
  });
});

/* ── §33.6.8 — Explore holds complete data with stated freshness ───────────── */

describe('§33.6.8 — Explore is complete, defined, and fresh, without a widget grid', () => {
  it('returns all eleven §20 sections in order, each with a definition', async () => {
    const fixture = await seedLiveCampaign('explore', { model: 'idea', threshold: 3 });
    await addPreorder(fixture, 1);
    await addPreorder(fixture, 2);

    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });
    expect(explore!.sections.map((s) => s.key)).toEqual([...EXPLORE_SECTION_KEYS]);
    for (const section of explore!.sections) {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.definition.trim().length).toBeGreaterThan(20);
    }
    expect(explore!.freshnessBasis).toBe('refresh');
    expect(typeof explore!.readAt).toBe('string');
  });

  it('names what a not-yet-populated section is waiting for instead of showing a zero', async () => {
    const fixture = await seedLiveCampaign('awaiting', { model: 'product' });
    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });

    const comments = explore!.sections.find((s) => s.key === 'comments_and_updates')!;
    expect(comments.awaiting).toBeTruthy();
    expect((comments.data as { comments: unknown }).comments).toBeNull();

    const exports = explore!.sections.find((s) => s.key === 'exports')!;
    expect(exports.awaiting).toBeTruthy();
  });

  it('reports an undefined conversion rate rather than 0% when there are no clicks', async () => {
    const fixture = await seedLiveCampaign('conversion', { model: 'product' });
    await addPreorder(fixture, 1);
    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });
    const conversion = explore!.sections.find((s) => s.key === 'conversion_and_time')!;
    expect((conversion.data as { conversionRate: unknown }).conversionRate).toBeNull();
  });

  it('keeps §11’s Founder boundary — no email, legal name, or quality tier', async () => {
    const fixture = await seedLiveCampaign('boundary', { model: 'product' });
    await addPreorder(fixture, 1);
    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });
    const rendered = JSON.stringify(explore);

    expect(rendered).not.toContain('qualityTier');
    expect(rendered).not.toContain('quality_tier');
    expect(rendered).not.toContain('legalName');
    expect(rendered).not.toContain('verificationEvidence');
    // The exports section names what is withheld before anything is downloaded.
    const exports = explore!.sections.find((s) => s.key === 'exports')!;
    expect((exports.data as { withheldColumns: string[] }).withheldColumns).toContain(
      'backer email',
    );
  });

  it('shows survey answers only where the Backer consented', async () => {
    const fixture = await seedLiveCampaign('survey', { model: 'product' });
    const withheld = await addPreorder(fixture, 1);
    await h.db
      .update(reservations)
      .set({ surveyWhy: 'Secret reason', founderMarketingConsent: false })
      .where(eq(reservations.id, withheld));
    const shared = await addPreorder(fixture, 2);
    await h.db
      .update(reservations)
      .set({ surveyWhy: 'Shared reason', founderMarketingConsent: true })
      .where(eq(reservations.id, shared));

    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });
    const answers = explore!.sections.find((s) => s.key === 'survey_answers')!;
    expect((answers.data as { consentedCount: number }).consentedCount).toBe(1);
    expect(JSON.stringify(answers)).toContain('Shared reason');
    expect(JSON.stringify(answers)).not.toContain('Secret reason');
  });

  it('never claims immediacy anywhere in the payload', async () => {
    const fixture = await seedLiveCampaign('freshness', { model: 'product' });
    const explore = await readExplore(h.db, { campaignId: fixture.campaignId });
    const rendered = JSON.stringify(explore).toLowerCase();
    for (const term of BANNED_FRESHNESS_TERMS) {
      expect(rendered).not.toContain(term);
    }
  });
});

/* ── §33.6.10 — threshold crossings fire once each, repeatedly ─────────────── */

describe('§33.6.10 — threshold reached/lost fire once per crossing', () => {
  it('emits reached, then lost, then reached again as the count moves', async () => {
    const fixture = await seedLiveCampaign('crossings', { model: 'idea', threshold: 3 });

    // Below: nothing to lose, so nothing is emitted.
    const a = await addPreorder(fixture, 1);
    const b = await addPreorder(fixture, 2);
    let result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing).toBeNull();

    // Up over the threshold.
    const c = await addPreorder(fixture, 3);
    result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing?.direction).toBe('reached');

    // Evaluating again with no change emits nothing — deduplicated by transition.
    result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing).toBeNull();

    // Back below.
    await cancelPreorder(c);
    result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing?.direction).toBe('lost');

    // And up again — §20: a campaign may cross repeatedly.
    await addPreorder(fixture, 4);
    result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing?.direction).toBe('reached');

    const crossings = await listCrossings(h.db, fixture.campaignId);
    expect(crossings.map((row) => row.direction).reverse()).toEqual([
      'reached',
      'lost',
      'reached',
    ]);
    void a;
    void b;
  });

  it('the database refuses two crossings in the same direction', async () => {
    const fixture = await seedLiveCampaign('alternate', { model: 'idea', threshold: 2 });
    await h.db.insert(campaignThresholdCrossings).values({
      campaignId: fixture.campaignId,
      direction: 'reached',
      uniqueActiveBackers: 5,
      threshold: 2,
    });
    await expectRefusal(
      () =>
        h.db.insert(campaignThresholdCrossings).values({
          campaignId: fixture.campaignId,
          direction: 'reached',
          uniqueActiveBackers: 6,
          threshold: 2,
        }),
      /alternate/i,
    );
  });

  it('refuses a lost on a campaign that never reached', async () => {
    const fixture = await seedLiveCampaign('neverreached', { model: 'idea', threshold: 9 });
    await expectRefusal(
      () =>
        h.db.insert(campaignThresholdCrossings).values({
          campaignId: fixture.campaignId,
          direction: 'lost',
          uniqueActiveBackers: 1,
          threshold: 9,
        }),
      /never reached/i,
    );
  });

  it('refuses a crossing that disagrees with the counts it claims', async () => {
    const fixture = await seedLiveCampaign('inconsistent', { model: 'idea', threshold: 5 });
    await expect(
      h.db.insert(campaignThresholdCrossings).values({
        campaignId: fixture.campaignId,
        direction: 'reached',
        uniqueActiveBackers: 2,
        threshold: 5,
      }),
    ).rejects.toThrow();
  });

  it('never crosses a Product campaign — §14.4 gives it no public funding gate', async () => {
    const fixture = await seedLiveCampaign('productgate', { model: 'product' });
    for (let i = 1; i <= 5; i += 1) await addPreorder(fixture, i);

    const result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    expect(result.crossing).toBeNull();

    const milestones = await listMilestones(h.db, fixture.campaignId);
    expect(milestones.map((m) => m.kind)).toEqual(['first_preorder']);
  });

  it('does not cross a campaign that is no longer collecting', async () => {
    const fixture = await seedLiveCampaign('closed', { model: 'idea', threshold: 2, status: 'closed_pending_capture' });
    await addPreorder(fixture, 1);
    await addPreorder(fixture, 2);

    const result = await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    // The Idea threshold is fixed at close (§21) — a late change must not emit.
    expect(result.crossing).toBeNull();
    // The ended milestone is still recorded.
    const milestones = await listMilestones(h.db, fixture.campaignId);
    expect(milestones.map((m) => m.kind)).toContain('campaign_ended');
  });

  it('records each §20 milestone exactly once', async () => {
    const fixture = await seedLiveCampaign('milestones', { model: 'idea', threshold: 2 });
    await addPreorder(fixture, 1);
    await addPreorder(fixture, 2);

    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });

    const rows = await h.db
      .select()
      .from(campaignMilestones)
      .where(eq(campaignMilestones.campaignId, fixture.campaignId));
    const kinds = rows.map((row) => row.kind).sort();
    expect(kinds).toEqual(['first_preorder', 'halfway', 'threshold_met']);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('a milestone moved to history does not come back', async () => {
    const fixture = await seedLiveCampaign('history', { model: 'product' });
    await addPreorder(fixture, 1);
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });

    await h.db
      .update(campaignMilestones)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: 'user:test' })
      .where(eq(campaignMilestones.campaignId, fixture.campaignId));

    await expectRefusal(
      () =>
        h.db.execute(sql`
          UPDATE campaign_milestones SET acknowledged_at = NULL
          WHERE campaign_id = ${fixture.campaignId}
        `),
      /history/i,
    );
  });
});

/* ── §33.6.11 — no scheduled generic check-in email exists ─────────────────── */

describe('§33.6.11 — no scheduled generic Day 3/7/10 check email exists', () => {
  it('registers no engagement notification key anywhere', async () => {
    const { NOTIFICATION_EVENTS } = await import('@proovd/shared');
    const forbidden = /check[_ ]?your[_ ]?campaign|day_?(3|7|10)|check_?in|nudge|reminder_to_post|engagement/i;
    for (const [key, definition] of Object.entries(NOTIFICATION_EVENTS)) {
      const described = `${key} ${(definition as { description: string }).description}`;
      // The Backer pre-charge reminder and the interview reminder are real
      // consequences with a real deadline behind them — they are not check-ins.
      if (key === 'backer_precharge_reminder' || key === 'founder_interview_reminder') continue;
      expect(described).not.toMatch(forbidden);
    }
  });

  it('has no scheduled job that sends mail without a state transition behind it', async () => {
    const { readFile } = await import('node:fs/promises');
    const scheduler = await readFile(
      new URL('../jobs/scheduler.ts', import.meta.url),
      'utf8',
    );
    // Every scheduled job name in the file, and none of them is a check-in.
    const jobNames = [...scheduler.matchAll(/_JOB = '([a-z-]+)'/g)].map((m) => m[1]!);
    expect(jobNames.length).toBeGreaterThan(0);
    for (const name of jobNames) {
      expect(name).not.toMatch(/check|nudge|digest|engagement|day-?(3|7|10)/i);
    }
  });

  it('has no schedule, cadence, or next-send column on any Phase 17a table', async () => {
    const result = await h.db.execute(sql`
      SELECT column_name, table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'campaign_milestones',
          'campaign_threshold_crossings',
          'act_rank_corrections',
          'campaign_home_deliveries',
          'founder_campaign_last_seen'
        )
        AND (column_name LIKE '%scheduled%'
          OR column_name LIKE '%cadence%'
          OR column_name LIKE '%recurrence%'
          OR column_name LIKE '%next_send%'
          OR column_name LIKE '%nudge%')
    `);
    expect(result.rows).toHaveLength(0);
  });

  it('sends nothing at all when a threshold did not move', async () => {
    const fixture = await seedLiveCampaign('nomail', { model: 'idea', threshold: 5 });
    await addPreorder(fixture, 1);
    const before = h.sentEmails.messages.length;

    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });

    expect(h.sentEmails.messages.length).toBe(before);
  });
});

/* ── The delivery receipt is a record, not a mutable row ───────────────────── */

describe('the §33.6.6 receipt cannot be rewritten', () => {
  it('refuses to change what a delivery rendered', async () => {
    const fixture = await seedLiveCampaign('receipt', { model: 'product' });
    await addPreorder(fixture, 1);
    const glance = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    // The trigger refuses it for anyone; the grant additionally refuses the
    // column to the application role. Both matter — one is a rule, one is a
    // permission, and a rule the owner can step around is not a guarantee.
    await expectRefusal(
      () =>
        h.db.execute(sql`
          UPDATE campaign_home_deliveries SET rendered_active_count = 99
          WHERE id = ${glance!.deliveryId}
        `),
      /cannot be rewritten/i,
    );
    await expectRefusal(
      () =>
        asAppRole(sql`DELETE FROM campaign_home_deliveries WHERE id = ${glance!.deliveryId}`),
      /permission denied|denied for/i,
    );
  });

  it('refuses to rewind a last-seen position', async () => {
    const fixture = await seedLiveCampaign('rewind', { model: 'product' });
    await addPreorder(fixture, 1);
    const glance = await readGlance(h.db, {
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });
    await acknowledgeDelivery(h.db, {
      deliveryId: glance!.deliveryId,
      campaignId: fixture.campaignId,
      viewerUserId: fixture.founderUserId,
    });

    await expectRefusal(
      () =>
        h.db.execute(sql`
          UPDATE founder_campaign_last_seen
          SET last_seen_at = last_seen_at - interval '1 day'
          WHERE campaign_id = ${fixture.campaignId}
        `),
      /only moves forward/i,
    );
  });
});

/* ── Phase 17a writes no campaign content and no roster change ─────────────── */

describe('Phase 17a offers no write path it was not asked for', () => {
  it('has no route that edits campaign content or the roster from the home surface', async () => {
    const fixture = await seedLiveCampaign('nowrites', { model: 'product' });
    const cookie = await founderCookie(fixture);
    const base = `/api/founder/campaigns/${fixture.campaignId}/home`;

    for (const path of [
      `${base}/build`,
      `${base}/rewards`,
      `${base}/dates`,
      `${base}/creators`,
      `${base}/threshold`,
    ]) {
      const response = await request(h.app)
        .post(path)
        .set('cookie', cookie)
        .send({ anything: true });
      expect(response.status).toBe(404);
    }

    // And the campaign's own fields are untouched.
    const [campaign] = await h.db
      .select({ type: campaigns.type })
      .from(campaigns)
      .where(eq(campaigns.id, fixture.campaignId));
    expect(campaign!.type).toBe('pre_launch');
  });

  it('refuses an unknown action kind or correction kind over HTTP', async () => {
    const fixture = await seedLiveCampaign('unknownkind', { model: 'product' });
    const cookie = await founderCookie(fixture);
    const path = `/api/founder/campaigns/${fixture.campaignId}/home/act/corrections`;

    const bad = await request(h.app).post(path).set('cookie', cookie).send({
      actionKind: 'invented_action',
      correctionKind: 'dismissal',
      priorRank: 1,
      reason: 'Nope.',
    });
    expect(bad.status).toBe(422);

    const badKind = await request(h.app).post(path).set('cookie', cookie).send({
      actionKind: 'optional_milestone_update',
      correctionKind: 'deleted',
      priorRank: 5,
      reason: 'Nope.',
    });
    expect(badKind.status).toBe(422);

    const stored = await h.db
      .select()
      .from(actRankCorrections)
      .where(eq(actRankCorrections.campaignId, fixture.campaignId));
    expect(stored).toHaveLength(0);
  });
});

/* ── §3.2 / §3.1: no banned vocabulary in Phase 17a ────────────────────────── */

describe('Phase 17a speaks the customer-facing vocabulary', () => {
  it('never uses a §3.2 holding-account word or a §3.1 internal name in its copy', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = [
      '../live/logic.ts',
      '../live/glance.ts',
      '../live/act.ts',
      '../live/explore.ts',
      '../live/thresholds.ts',
      '../live/counts.ts',
      '../live/home.ts',
      '../live/notifications.ts',
    ];
    const banned = [
      'escrow',
      'custody',
      'held in a proovd account',
      'all-or-nothing',
      'pledge',
      'donate',
      'day 30',
    ];
    for (const file of files) {
      const source = (await readFile(new URL(file, import.meta.url), 'utf8')).toLowerCase();
      for (const word of banned) {
        expect(source, `${file} contains "${word}"`).not.toContain(word);
      }
    }
  });
});

/* ── Composition: the whole home reads as one campaign at one instant ──────── */

describe('§20 — the composed home', () => {
  it('returns Glance, Act, Explore, and milestone history from one read', async () => {
    const fixture = await seedLiveCampaign('composed', { model: 'idea', threshold: 2 });
    await addPreorder(fixture, 1);
    await evaluateThresholdCrossing(h.db, { audit }, {
      campaignId: fixture.campaignId,
      actor: 'system:test',
    });

    const cookie = await founderCookie(fixture);
    const response = await request(h.app)
      .get(`/api/founder/campaigns/${fixture.campaignId}/home`)
      .set('cookie', cookie);
    expect(response.status).toBe(200);

    const home = response.body.home;
    expect(home.campaignId).toBe(fixture.campaignId);
    expect(home.glance.activePreorderCount).toBe(1);
    expect(home.act.state).toBe('action');
    expect(home.explore.sections).toHaveLength(11);
    expect(home.milestoneHistory.map((m: { kind: string }) => m.kind)).toContain('first_preorder');

    // §20's ordering: Glance, then Act, then Explore. The payload is a loop, not
    // a map of panels (DNA §5.3).
    expect(Object.keys(home)).toEqual([
      'campaignId',
      'status',
      'glance',
      'act',
      'explore',
      'milestoneHistory',
    ]);
  });
});
