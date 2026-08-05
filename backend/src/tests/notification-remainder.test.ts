/**
 * Phase 22b's last seven senders — Spec §27.3, §27.5, §27.6, §27.8, §5.5.
 *
 * These are the messages 22b recorded in `unsent.ts` rather than declared,
 * because `events.ts` carries one rule — a key appears when something SENDS it
 * — and each still needed a call site, a sweep, or a public route. With them
 * built, the register holds only the three `never` decisions and Phase 21b's
 * five capabilities, and `notification-coverage.test.ts` asserts that partition.
 *
 * What is worth testing here is not that an email renders — 22a's catalog and
 * contract suite already prove every message satisfies §27.2. It is the three
 * things a template cannot express:
 *
 *   1. **Which** transitions earn a roster message, and that the rest are
 *      silent (§27.3, §30) — the judgement 22b deferred.
 *   2. That every dedup entity is the RECORD, so the second legitimate
 *      occurrence sends and the second delivery of the first does not.
 *   3. That §5.5's reissue route is not an enumeration oracle — the property
 *      that made this a missing *ask* rather than a missing message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { seedUser } from './admin-session.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { associationStatusHistory } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { supportCases } from '../db/schema/support.js';

import {
  ROSTER_UPDATES_COVERED_ELSEWHERE,
  rosterUpdateFor,
  FOUNDER_ROSTER_STATUS_LABELS,
} from '../affiliates/roster-labels.js';
import {
  ROSTER_UPDATES_COVERED_ELSEWHERE as SHARED_COVERED,
  rosterUpdateFor as sharedRosterUpdateFor,
} from '@proovd/shared';
import { announceRosterUpdate, sweepRosterUpdates } from '../affiliates/roster-notifications.js';
import { sweepSupportPromises, breachedClocks } from '../support/promises.js';
import { openSupportCase, addCaseMessage } from '../support/cases.js';
import { reissueMagicLink, MAGIC_LINK_REISSUE_ACK } from '../reservations/magic-link-reissue.js';
import { UNSENT_NOTIFICATION_EVENTS, unsentOwnedBy } from '../notifications/unsent.js';
import { ASSOCIATION_STATUSES } from '@proovd/shared';

const DAY = 86_400_000;

let h: Harness;

beforeAll(async () => {
  // The Backer magic-link router is mounted behind a configured gateway,
  // because its cancellation path detaches a payment method. The reissue route
  // needs no gateway of its own; it lives in that router because it is the
  // recovery path for the surface that router serves.
  h = await startHarness(
    { stripeGateway: createMemoryStripeGateway({}), globalRateLimit: 1_000_000 },
    'remainder',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

interface Seeded {
  campaignId: string;
  founderEmail: string;
  associationId: string;
  backerIdentityId: string;
  backerEmail: string;
}

async function seedCampaign(label: string): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `rm-founder-${label}`);
  const creator = await seedUser(h, 'affiliate', `rm-creator-${label}`);

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
      type: 'pre_build',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 5 * DAY),
      campaignCloseAt: new Date(Date.now() + 14 * DAY),
      orderThreshold: 10,
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

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `The ${label} Kettle`,
    updatedBy: `user:${founder.id}`,
  });

  const [affiliateProspect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      audienceNiche: 'hardware',
      audienceSize: '120k',
      adminBio: 'Reviews hardware.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [association] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: affiliateProspect!.id,
      status: 'active',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });

  await h.db.insert(affiliateSignupProfiles).values({
    associationId: association!.id,
    prospectId: affiliateProspect!.id,
    email: creator.email,
    publicHandle: `@creator-${label}`,
    claimedUserId: creator.id,
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  const backerEmail = `rm-backer-${label}@example.com`;
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email: backerEmail,
      phone: '+15555550199',
      emailNormalized: backerEmail,
      phoneNormalized: '+15555550199',
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });

  return {
    campaignId,
    founderEmail: founder.email,
    associationId: association!.id,
    backerIdentityId: identity!.id,
    backerEmail,
  };
}

/** Writes a real history row, the way `transitionAssociation` does. */
async function recordTransition(
  associationId: string,
  from: string,
  to: string,
): Promise<string> {
  const [row] = await h.db
    .insert(associationStatusHistory)
    .values({
      associationId,
      fromStatus: from as never,
      toStatus: to as never,
      actor: 'admin:test',
    })
    .returning({ id: associationStatusHistory.id });
  return row!.id;
}

async function deliveriesFor(eventKey: string, target?: string) {
  const where = target
    ? and(eq(notificationDeliveries.eventKey, eventKey), eq(notificationDeliveries.target, target))
    : eq(notificationDeliveries.eventKey, eventKey);
  return h.db.select().from(notificationDeliveries).where(where);
}

function notifyDeps() {
  return {
    db: h.db,
    notifier: h.notifier,
    context: {
      appBaseUrl: 'https://app.proovd.co',
      supportEmail: 'support@proovd.co',
      fromAddress: 'Proovd <no-reply@proovd.co>',
    },
    internalRecipient: 'ops@proovd.co',
  };
}

/* ── Drift (the rootDir constraint, as always) ────────────────────────────── */

describe('the backend restatement matches the shared register', () => {
  it('agrees on every covering rule', () => {
    expect(ROSTER_UPDATES_COVERED_ELSEWHERE.map((r) => [r.from, r.to, r.coveredBy])).toEqual(
      SHARED_COVERED.map((r) => [r.from, r.to, r.coveredBy]),
    );
  });

  it('agrees on the decision for every edge of the §23.4 machine', () => {
    for (const from of ASSOCIATION_STATUSES) {
      for (const to of ASSOCIATION_STATUSES) {
        expect(rosterUpdateFor(from, to)).toEqual(sharedRosterUpdateFor(from, to));
      }
    }
  });
});

/* ── §27.3 the roster update ──────────────────────────────────────────────── */

describe('§27.3 roster updates', () => {
  it('announces a real change, on the history row, exactly once', async () => {
    const s = await seedCampaign('roster1');
    const historyId = await recordTransition(s.associationId, 'active', 'paused');

    const first = await announceRosterUpdate(notifyDeps(), {
      historyId,
      associationId: s.associationId,
      from: 'active',
      to: 'paused',
      campaignId: s.campaignId,
    });
    expect(first.status).toBe('sent');

    // §27.2: a duplicate job delivery cannot produce a second email.
    const second = await announceRosterUpdate(notifyDeps(), {
      historyId,
      associationId: s.associationId,
      from: 'active',
      to: 'paused',
      campaignId: s.campaignId,
    });
    expect(second.status).toBe('duplicate');

    const rows = await deliveriesFor('founder_roster_update', s.founderEmail);
    expect(rows).toHaveLength(1);
    // The entity §27.7's digest exclusion binds on. If this ever becomes the
    // association id, the digest starts restating messages people already got.
    expect(rows[0]!.entityId).toBe(historyId);
    expect(rows[0]!.entityType).toBe('association_status_history');
  });

  it('sends a SECOND message for a second real change (§7)', async () => {
    const s = await seedCampaign('roster2');
    const pause = await recordTransition(s.associationId, 'active', 'paused');
    const resume = await recordTransition(s.associationId, 'paused', 'active');

    for (const [historyId, from, to] of [
      [pause, 'active', 'paused'],
      [resume, 'paused', 'active'],
    ] as const) {
      const outcome = await announceRosterUpdate(notifyDeps(), {
        historyId,
        associationId: s.associationId,
        from,
        to,
        campaignId: s.campaignId,
      });
      expect(outcome.status).toBe('sent');
    }

    expect(await deliveriesFor('founder_roster_update', s.founderEmail)).toHaveLength(2);
  });

  it('is silent where §14.5 shows the Founder the same word', async () => {
    const s = await seedCampaign('roster3');
    const historyId = await recordTransition(s.associationId, 'readiness_blocked', 'ready');

    const outcome = await announceRosterUpdate(notifyDeps(), {
      historyId,
      associationId: s.associationId,
      from: 'readiness_blocked',
      to: 'ready',
      campaignId: s.campaignId,
    });
    expect(outcome.status).toBe('silent');
    expect(outcome.reason).toBe('no_change_in_founder_facing_status');
    expect(await deliveriesFor('founder_roster_update', s.founderEmail)).toHaveLength(0);
  });

  it('defers to the covering key rather than doubling a campaign-wide event', async () => {
    const s = await seedCampaign('roster4');
    const historyId = await recordTransition(s.associationId, 'ready', 'active');

    const outcome = await announceRosterUpdate(notifyDeps(), {
      historyId,
      associationId: s.associationId,
      from: 'ready',
      to: 'active',
      campaignId: s.campaignId,
    });
    expect(outcome.status).toBe('silent');
    expect(outcome.reason).toBe('covered_by:founder_campaign_live');
    expect(await deliveriesFor('founder_roster_update', s.founderEmail)).toHaveLength(0);
  });

  it('re-derives the decision from the row, so a caller cannot force a message', async () => {
    const s = await seedCampaign('roster5');
    // A caller asking for a message about a no-change transition gets silence,
    // because the decision comes from `rosterUpdateFor` and not from the ask.
    const historyId = await recordTransition(s.associationId, 'reviewing', 'formal_decision_open');
    const outcome = await announceRosterUpdate(notifyDeps(), {
      historyId,
      associationId: s.associationId,
      from: 'reviewing',
      to: 'formal_decision_open',
      campaignId: s.campaignId,
    });
    expect(outcome.announce).toBeUndefined();
    expect(outcome.status).toBe('silent');
  });

  it('the sweep is idempotent and sends nothing on an empty run', async () => {
    const s = await seedCampaign('roster6');
    await recordTransition(s.associationId, 'active', 'paused');

    const first = await sweepRosterUpdates(notifyDeps());
    expect(first.sent).toBeGreaterThan(0);

    const second = await sweepRosterUpdates(notifyDeps());
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBeGreaterThan(0);

    expect(await deliveriesFor('founder_roster_update', s.founderEmail)).toHaveLength(1);
  });

  it('sends nothing at all for a campaign whose roster nobody is reading', async () => {
    const s = await seedCampaign('roster7');
    // §23.1: a killed campaign has no roster to act on. The transition is still
    // recorded; the message is not owed (§1.4).
    await h.db.update(campaigns).set({ status: 'killed' }).where(eq(campaigns.id, s.campaignId));
    await recordTransition(s.associationId, 'active', 'paused');

    await sweepRosterUpdates(notifyDeps());
    expect(await deliveriesFor('founder_roster_update', s.founderEmail)).toHaveLength(0);
  });
});

/* ── §27.6 / §27.8 the support promises ───────────────────────────────────── */

describe('§27.8 promises and §27.6 breaches', () => {
  async function openCase(s: Seeded, owner: 'proovd_support' | 'founder_coordinated' = 'proovd_support') {
    const result = await openSupportCase(h.db, {
      topic: 'delivery',
      owner,
      requesterKind: 'backer',
      backerIdentityId: s.backerIdentityId,
      requesterEmail: s.backerEmail,
      campaignId: s.campaignId,
      message: 'When does the kettle ship?',
      createdBy: 'admin:test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return result.result.caseId;
  }

  it('sends the follow-up at the promised checkpoint, even with no resolution', async () => {
    const s = await seedCampaign('sup1');
    const caseId = await openCase(s);
    const promisedAt = new Date(Date.now() - 2 * 3_600_000);
    await addCaseMessage(h.db, {
      caseId,
      direction: 'outbound',
      customerFacing: true,
      body: 'Looking into this with the Founder now.',
      author: 'admin:test',
      nextPromisedUpdateAt: promisedAt,
    });

    const result = await sweepSupportPromises(notifyDeps());
    expect(result.followupsSent).toBe(1);

    const rows = await deliveriesFor('backer_support_followup', s.backerEmail);
    expect(rows).toHaveLength(1);
    // The promised INSTANT: a second promise is a second commitment.
    expect(rows[0]!.entityId).toBe(`${caseId}:${promisedAt.toISOString()}`);
  });

  it('discharges the promise so the Admin badge stops claiming it is late', async () => {
    const s = await seedCampaign('sup2');
    const caseId = await openCase(s);
    await addCaseMessage(h.db, {
      caseId,
      direction: 'outbound',
      customerFacing: true,
      body: 'An update is coming.',
      author: 'admin:test',
      nextPromisedUpdateAt: new Date(Date.now() - 3_600_000),
    });

    await sweepSupportPromises(notifyDeps());
    const [row] = await h.db
      .select({ next: supportCases.nextPromisedUpdateAt })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));
    expect(row!.next).toBeNull();

    // And a second promise gets a second follow-up, on its own instant.
    const secondPromise = new Date(Date.now() - 60_000);
    await addCaseMessage(h.db, {
      caseId,
      direction: 'outbound',
      customerFacing: true,
      body: 'Still working on it.',
      author: 'admin:test',
      nextPromisedUpdateAt: secondPromise,
    });
    const again = await sweepSupportPromises(notifyDeps());
    expect(again.followupsSent).toBe(1);
    expect(await deliveriesFor('backer_support_followup', s.backerEmail)).toHaveLength(2);
  });

  it('never discharges a promise it could not deliver', async () => {
    const s = await seedCampaign('sup3');
    const caseId = await openCase(s);
    const promisedAt = new Date(Date.now() - 3_600_000);
    await addCaseMessage(h.db, {
      caseId,
      direction: 'outbound',
      customerFacing: true,
      body: 'An update is coming.',
      author: 'admin:test',
      nextPromisedUpdateAt: promisedAt,
    });

    // No notifier: the deployment cannot send. The promise must survive, or the
    // queue stops showing a commitment nobody kept.
    const result = await sweepSupportPromises({ db: h.db });
    expect(result.followupsSent).toBe(0);
    const [row] = await h.db
      .select({ next: supportCases.nextPromisedUpdateAt })
      .from(supportCases)
      .where(eq(supportCases.id, caseId));
    expect(row!.next?.toISOString()).toBe(promisedAt.toISOString());
  });

  it('notifies a breach once per lapsed deadline, not once per tick', async () => {
    const s = await seedCampaign('sup4');
    // The response deadline is immutable by trigger (§29.6: a retry or edit can
    // never silently reset a promised deadline), so the case is OPENED with a
    // clock that has already run out rather than moved afterwards. That is the
    // §33.7 rule applied here — tests move time, not the anchor.
    const past = new Date(Date.now() - 5 * DAY);
    const late = await openSupportCase(h.db, {
      topic: 'delivery',
      owner: 'proovd_support',
      requesterKind: 'backer',
      backerIdentityId: s.backerIdentityId,
      requesterEmail: s.backerEmail,
      campaignId: s.campaignId,
      message: 'Still waiting.',
      createdBy: 'admin:test',
      now: past,
    });
    expect(late.ok).toBe(true);

    expect(late.ok).toBe(true);
    if (!late.ok) throw new Error('unreachable');
    const caseId = late.result.caseId;

    await sweepSupportPromises(notifyDeps());
    // The sweep is global, so counts include other tests' cases. What is
    // asserted is the delivery for THIS case — one row, however many ticks.
    const after = await deliveriesFor('internal_support_sla_breach', 'ops@proovd.co');
    const mine = after.filter((r) => r.entityId.startsWith(`${caseId}:`));
    expect(mine).toHaveLength(1);
    // (case, clock, the instant that lapsed).
    expect(mine[0]!.entityId).toBe(`${caseId}:human_response:${late.result.humanResponseDueAt.toISOString()}`);

    await sweepSupportPromises(notifyDeps());
    const again = (await deliveriesFor('internal_support_sla_breach', 'ops@proovd.co')).filter((r) =>
      r.entityId.startsWith(`${caseId}:`),
    );
    expect(again).toHaveLength(1);
  });

  it('sends nothing for a case whose clocks are all still running (§33.6.11)', async () => {
    const s = await seedCampaign('sup5');
    const caseId = await openCase(s);
    await sweepSupportPromises(notifyDeps());

    // Scoped to this case: the sweep is global and other tests deliberately
    // leave lapsed promises behind for it to retry, which is the design.
    const followups = (await deliveriesFor('backer_support_followup', s.backerEmail)).filter((r) =>
      r.entityId.startsWith(`${caseId}:`),
    );
    const breaches = (await deliveriesFor('internal_support_sla_breach', 'ops@proovd.co')).filter(
      (r) => r.entityId.startsWith(`${caseId}:`),
    );
    expect(followups).toHaveLength(0);
    expect(breaches).toHaveLength(0);
  });

  it('reports each of §27.8s three clocks separately', async () => {
    const entry = {
      caseId: 'c1',
      reference: 'PVD-A-B',
      topic: 'delivery',
      owner: 'founder_coordinated',
      status: 'open',
      humanResponseDueAt: '2026-08-01T00:00:00.000Z',
      nextPromisedUpdateAt: '2026-08-02T00:00:00.000Z',
      founderFollowupDueAt: '2026-08-03T00:00:00.000Z',
      responseOverdue: true,
      promiseOverdue: true,
      founderFollowupOverdue: true,
      requesterEmail: 'x@example.com',
      campaignId: null,
    };
    expect(breachedClocks(entry as never).map((b) => b.clock)).toEqual([
      'human_response',
      'promised_update',
      'founder_followup',
    ]);
    // A case fine on one clock and late on another reports only the late one.
    expect(
      breachedClocks({ ...entry, responseOverdue: false, founderFollowupOverdue: false } as never),
    ).toEqual([{ clock: 'promised_update', at: '2026-08-02T00:00:00.000Z' }]);
  });
});

/* ── §5.5 the magic-link reissue ──────────────────────────────────────────── */

describe('§5.5 magic-link reissue', () => {
  function reissueDeps() {
    return {
      db: h.db,
      tokenService: h.tokens,
      notifier: h.notifier,
      appBaseUrl: 'https://app.proovd.co',
      fromAddress: 'Proovd <no-reply@proovd.co>',
      supportEmail: 'support@proovd.co',
      secret: 'test-secret-value-for-hmac',
    };
  }

  async function seedReservation(s: Seeded): Promise<void> {
    await h.db.insert(reservations).values({
      campaignId: s.campaignId,
      backerIdentityId: s.backerIdentityId,
      status: 'reserved_active',
      quantity: 1,
      unitPriceCents: 9900n,
      subtotalCents: 9900n,
      taxCents: 0n,
      totalAuthorizedCents: 9900n,
    });
  }

  it('answers identically for a hit, a miss, and a campaign that does not exist', async () => {
    const s = await seedCampaign('link1');
    await seedReservation(s);

    const hit = await request(h.app)
      .post('/api/link/request')
      .send({ email: s.backerEmail, campaignId: s.campaignId });
    const miss = await request(h.app)
      .post('/api/link/request')
      .send({ email: 'nobody-at-all@example.com', campaignId: s.campaignId });
    const noCampaign = await request(h.app)
      .post('/api/link/request')
      .send({ email: s.backerEmail, campaignId: randomUUID() });
    const malformed = await request(h.app)
      .post('/api/link/request')
      .send({ email: 'not-an-address', campaignId: 'not-a-uuid' });
    const empty = await request(h.app).post('/api/link/request').send({});

    for (const res of [hit, miss, noCampaign, malformed, empty]) {
      expect(res.status).toBe(202);
      expect(res.body).toEqual(MAGIC_LINK_REISSUE_ACK);
    }
    // Byte-identical, not merely equal-shaped: any per-request value is a channel.
    expect(new Set([hit.text, miss.text, noCampaign.text, malformed.text, empty.text]).size).toBe(1);
  });

  it('carries nothing per-request in the acknowledgement', () => {
    const serialised = JSON.stringify(MAGIC_LINK_REISSUE_ACK);
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no timestamp
    expect(Object.isFrozen(MAGIC_LINK_REISSUE_ACK)).toBe(true);
  });

  it('sends a working link where one is owed', async () => {
    const s = await seedCampaign('link2');
    await seedReservation(s);

    await reissueMagicLink(reissueDeps(), { email: s.backerEmail, campaignId: s.campaignId });

    const rows = await deliveriesFor('backer_magic_link_reissue', s.backerEmail);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('magic_link_request');
    // §28.1: the raw token is never at rest. The entity is an HMAC of the URL,
    // so it cannot be used to reach the page.
    expect(rows[0]!.entityId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('answers a repeat ask with a second link (§5.5)', async () => {
    const s = await seedCampaign('link3');
    await seedReservation(s);

    await reissueMagicLink(reissueDeps(), { email: s.backerEmail, campaignId: s.campaignId });
    await reissueMagicLink(reissueDeps(), { email: s.backerEmail, campaignId: s.campaignId });

    // Someone asking twice is someone whose first link did not arrive. Keying
    // on the identity would swallow the second, in the one flow where being
    // locked out is the entire problem.
    expect(await deliveriesFor('backer_magic_link_reissue', s.backerEmail)).toHaveLength(2);
  });

  it('finds the identity through §4.1s normalisation, not by exact match', async () => {
    const s = await seedCampaign('link4');
    await seedReservation(s);

    await reissueMagicLink(reissueDeps(), {
      email: s.backerEmail.toUpperCase(),
      campaignId: s.campaignId,
    });
    expect(await deliveriesFor('backer_magic_link_reissue', s.backerEmail)).toHaveLength(1);
  });

  it('sends nothing to an identity with no pre-order on that campaign', async () => {
    // §4.1's dedup means an identity row can exist with no reservation behind
    // it. A link to a page with nothing on it is not a link worth sending.
    const s = await seedCampaign('link5');
    await reissueMagicLink(reissueDeps(), { email: s.backerEmail, campaignId: s.campaignId });
    expect(await deliveriesFor('backer_magic_link_reissue', s.backerEmail)).toHaveLength(0);
  });

  it('does not leak one campaigns Backer to another campaign', async () => {
    const a = await seedCampaign('link6a');
    const b = await seedCampaign('link6b');
    await seedReservation(a);

    // A's address, B's campaign. The identity is campaign-scoped, so this is
    // both a miss and the exact probe the non-enumeration rule exists for.
    await reissueMagicLink(reissueDeps(), { email: a.backerEmail, campaignId: b.campaignId });
    expect(await deliveriesFor('backer_magic_link_reissue', a.backerEmail)).toHaveLength(0);
  });
});

/* ── The register is empty of everything but decisions ────────────────────── */

describe('the deliberate-absence register after 22b', () => {
  it('owes nothing to Phase 22b any more', () => {
    expect(unsentOwnedBy('none')).toHaveLength(3);
    // The whole point of the phase: `message` — behaviour recorded, message
    // missing — is empty. Phase 21b then closed the `capability` five, so what
    // is left is only what the Spec itself rules out.
    const kinds = Object.values(UNSENT_NOTIFICATION_EVENTS).map((e) => e.kind);
    expect(kinds).not.toContain('message');
    expect(kinds).not.toContain('capability');
  });

  it('leaves exactly the three §1 rule 6 decisions', () => {
    expect(Object.keys(UNSENT_NOTIFICATION_EVENTS)).toHaveLength(3);
    // No phase owns a message any more. The owner field existed so a gap could
    // be handed to whoever owned the behaviour, and every one was.
    expect(Object.values(UNSENT_NOTIFICATION_EVENTS).every((e) => e.owner === 'none')).toBe(true);
  });
});
