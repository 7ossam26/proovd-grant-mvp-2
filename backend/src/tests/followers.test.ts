/**
 * The campaign follow record — a RECORDED DEVIATION from §1 rule 6
 * (campaign-page-v2 Session C).
 *
 * The deviation is the reason this suite is written the way it is. Everything
 * below asserts a LIMIT rather than a feature, because the risk here is not
 * that following does not work — it is that it quietly becomes more than a
 * follow. So the suite proves, in order:
 *
 *   1. the public ask is not an enumeration oracle — six branches, one
 *      byte-identical body, including the rate-limited one;
 *   2. double opt-in is real — a row is `pending` until a person opens the
 *      link, and no scanner GET can complete it;
 *   3. the two lineages cannot be swapped, so an unfollow link is never spent
 *      by the confirm route;
 *   4. a follower digest cannot carry a `backer_only` update — a §18
 *      disclosure failure, not a digest bug;
 *   5. nothing chases anybody: no schedule-shaped column exists, no job names
 *      the table, and no public payload carries a count;
 *   6. §25.8 window 4 is enforced at unfollow + 2 years, and an anonymised row
 *      cannot be un-anonymised — refused by the DATABASE, not by a service.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { campaignFollowers, campaignFollowEvents } from '../db/schema/followers.js';
import { secureTokens } from '../db/schema/tokens.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import {
  FOLLOW_ACK,
  confirmFollow,
  countConfirmedFollowers,
  requestFollow,
  unfollowCampaign,
} from '../followers/service.js';
import { sweepFollowConsent, followRetentionCutoff } from '../followers/retention.js';
import { DIGEST_FREQUENCIES, FOLLOW_CONSENT_RETENTION_YEARS } from '../followers/logic.js';
import { composeDigest, sweepDigests } from '../notifications/digest.js';
import { DIGEST_FREQUENCIES as SHARED_FREQUENCIES } from '@proovd/shared';

let h: Harness;
const CONTEXT = {
  fromAddress: 'hello@proovd.co',
  supportEmail: 'support@proovd.co',
  appBaseUrl: 'http://localhost:3000',
};
const DAY = 24 * 3_600_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

beforeAll(async () => {
  h = await startHarness({ globalRateLimit: 1_000_000 }, 'follow');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return { db: h.db, tokenService: h.tokens, notifier: h.notifier, ...CONTEXT };
}

async function seedCampaign(label: string, status = 'live'): Promise<string> {
  const founder = await seedUser(h, 'founder', `fl-${label}`);
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
      status: status as 'live',
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

  return campaignId;
}

/** The raw token out of a delivered URL — the only place it ever exists (§28.1). */
function tokenFrom(body: string, kind: 'confirm' | 'stop'): string {
  const match = body.match(new RegExp(`/follow/${kind}/([A-Za-z0-9_-]+)`));
  expect(match, `no ${kind} link in the message`).not.toBeNull();
  return match![1]!;
}

async function lastMessage(): Promise<string> {
  const sent = h.sentEmails.messages;
  const message = sent[sent.length - 1];
  expect(message, 'no message was sent').toBeDefined();
  return `${message!.html ?? ''}\n${message!.text ?? ''}`;
}

/* ══════════════════════════════════════════════ 1. The non-enumerating ask */

describe('the public follow ask is not an enumeration oracle', () => {
  it('answers one byte-identical body for all six outcomes', async () => {
    const live = await seedCampaign('oracle-live');
    const notLive = await seedCampaign('oracle-draft', 'invited_draft');

    // A real follow first, so the "already following" branch is a genuine hit.
    await requestFollow(deps(), {
      campaignId: live,
      email: 'already@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });

    const bodies: string[] = [];
    const post = async (campaignId: string, body: Record<string, unknown>) => {
      const res = await request(h.app).post(`/api/campaign/${campaignId}/follow`).send(body);
      expect(res.status).toBe(202);
      bodies.push(JSON.stringify(res.body));
    };

    await post(live, { email: 'already@example.com', frequency: 'weekly' }); // hit, again
    await post(live, { email: 'stranger@example.com', frequency: 'weekly' }); // miss
    await post(live, { email: 'not-an-address', frequency: 'weekly' }); // malformed
    await post(randomUUID(), { email: 'x@example.com', frequency: 'weekly' }); // no campaign
    await post(notLive, { email: 'x@example.com', frequency: 'weekly' }); // not live
    await post(live, { email: 'x@example.com', frequency: 'hourly' }); // no such cadence

    // Byte-identical, and identical to the frozen constant. Not "similar".
    const expected = JSON.stringify(FOLLOW_ACK);
    for (const body of bodies) expect(body).toBe(expected);
    expect(new Set(bodies).size).toBe(1);
  });

  it('answers the same body over the rate limit, never a 429', async () => {
    // The limiter is mounted on the route itself, so this drives the real one
    // rather than asserting on its configuration.
    const campaignId = await seedCampaign('oracle-limit');
    const results: number[] = [];
    const bodies = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const res = await request(h.app)
        .post(`/api/campaign/${campaignId}/follow`)
        .send({ email: `limit-${i}@example.com`, frequency: 'weekly' });
      results.push(res.status);
      bodies.add(JSON.stringify(res.body));
    }
    // Phase 04's rule: a limiter that announces itself is the same oracle
    // wearing a different hat.
    expect(results.every((s) => s === 202)).toBe(true);
    expect(results).not.toContain(429);
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toBe(JSON.stringify(FOLLOW_ACK));
  });

  it('carries nothing per-request in the acknowledgement', () => {
    // Anything that varies is a channel. Frozen, so a later edit that adds a
    // timestamp fails here rather than in production.
    expect(Object.isFrozen(FOLLOW_ACK)).toBe(true);
    const json = JSON.stringify(FOLLOW_ACK);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(Object.keys(FOLLOW_ACK).sort()).toEqual(['next', 'status', 'title', 'whatHappened']);
  });
});

/* ═══════════════════════════════════════════════════ 2. Double opt-in */

describe('a follow is pending until a person opens the link', () => {
  it('records the ask as pending, sends one receipt, and starts no digest', async () => {
    const campaignId = await seedCampaign('optin');
    await requestFollow(deps(), {
      campaignId,
      email: 'Maya@Example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    expect(row!.state).toBe('pending');
    expect(row!.confirmedAt).toBeNull();
    // §4.1's normalisation, so one address is one follow however it is typed.
    expect(row!.emailNormalized).toBe('maya@example.com');
    expect(row!.email).toBe('Maya@Example.com');
    // §27.7: the preference exists only because a person chose it.
    expect(row!.frequency).toBe('weekly');
    // The consent is preserved as it was shown, not looked up later.
    expect(row!.consentText).toContain('not a pre-order');
    expect(row!.consentVersion).toBe('follow-consent.v1');

    // The history row is written by TRIGGER, not by the service.
    const events = await h.db
      .select()
      .from(campaignFollowEvents)
      .where(eq(campaignFollowEvents.followerId, row!.id));
    expect(events.map((e) => e.event)).toEqual(['requested']);

    // A pending follow is not a subscriber.
    const swept = await sweepDigests({ ...deps(), notifier: h.notifier }, { frequency: 'weekly' });
    expect(swept.sent).toBe(0);
  });

  it('confirms only through the confirm link, and only once', async () => {
    const campaignId = await seedCampaign('optin-confirm');
    await requestFollow(deps(), {
      campaignId,
      email: 'confirm@example.com',
      frequency: 'daily',
      source: 'campaign_page',
    });
    const body = await lastMessage();
    const confirmToken = tokenFrom(body, 'confirm');

    const first = await confirmFollow(deps(), confirmToken);
    expect(first.ok).toBe(true);

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    expect(row!.state).toBe('confirmed');
    expect(row!.confirmedAt).not.toBeNull();

    // Single-use: the confirm lineage is claimed, so re-opening it changes
    // nothing and is not a second consent.
    const second = await confirmFollow(deps(), confirmToken);
    expect(second.ok).toBe(false);

    const events = await h.db
      .select()
      .from(campaignFollowEvents)
      .where(eq(campaignFollowEvents.followerId, row!.id));
    expect(events.filter((e) => e.event === 'confirmed')).toHaveLength(1);
  });

  it('exposes no GET that could confirm or unfollow', async () => {
    // A link that acts on being FETCHED records the answers email scanners
    // give — Phase 21b's survey reasoning, applied where it matters twice as
    // much. Both actions are POSTs behind a page.
    const campaignId = await seedCampaign('optin-get');
    await requestFollow(deps(), {
      campaignId,
      email: 'scanner@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const body = await lastMessage();
    const confirmToken = tokenFrom(body, 'confirm');
    const stopToken = tokenFrom(body, 'stop');

    for (const token of [confirmToken, stopToken]) {
      for (const path of [`/api/follow/${token}/confirm`, `/api/follow/${token}/stop`]) {
        const res = await request(h.app).get(path);
        expect(res.status).toBe(404);
      }
    }

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    expect(row!.state).toBe('pending');
  });
});

/* ══════════════════════════════════════ 3. Two lineages, never swapped */

describe('the confirm and unfollow lineages cannot be swapped', () => {
  it('refuses an unfollow token at the confirm route, and leaves it usable', async () => {
    const campaignId = await seedCampaign('lineage');
    await requestFollow(deps(), {
      campaignId,
      email: 'lineage@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const body = await lastMessage();
    const confirmToken = tokenFrom(body, 'confirm');
    const stopToken = tokenFrom(body, 'stop');

    // Without this refusal the confirm route would CLAIM the unfollow lineage
    // and leave the person with a dead unsubscribe link in their inbox.
    expect((await confirmFollow(deps(), stopToken)).ok).toBe(false);
    expect((await unfollowCampaign(deps(), confirmToken)).ok).toBe(false);

    // Both links still work at their own routes, in either order.
    expect((await confirmFollow(deps(), confirmToken)).ok).toBe(true);
    expect((await unfollowCampaign(deps(), stopToken)).ok).toBe(true);

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    expect(row!.state).toBe('unfollowed');
    expect(row!.unfollowedAt).not.toBeNull();
  });

  it('revokes every live token for the follow when it ends', async () => {
    const campaignId = await seedCampaign('lineage-revoke');
    await requestFollow(deps(), {
      campaignId,
      email: 'revoke@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const body = await lastMessage();
    const stopToken = tokenFrom(body, 'stop');
    await unfollowCampaign(deps(), stopToken);

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    const tokens = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.campaignFollowerId, row!.id));
    expect(tokens.length).toBeGreaterThan(0);
    // A stale confirmation email must not restart what somebody just ended.
    expect(tokens.every((t) => t.revokedAt !== null || t.claimedAt !== null)).toBe(true);
  });

  it('binds a follow token to one follow and nothing else', async () => {
    const campaignId = await seedCampaign('lineage-bind');
    await requestFollow(deps(), {
      campaignId,
      email: 'bind@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));
    const [token] = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.campaignFollowerId, row!.id))
      .limit(1);

    // 0051's fourth branch: bound to the follow, and to nothing else.
    expect(token!.scope).toBe('campaign_follow');
    expect(token!.campaignId).toBeNull();
    expect(token!.backerIdentityId).toBeNull();
    expect(token!.associationId).toBeNull();
    expect(token!.campaignDraftId).toBeNull();

    // And 0050 named the new column in the immutability trigger, so a live
    // delivered URL cannot be repointed at somebody else's follow (§33.1.2).
    await expect(
      h.db
        .update(secureTokens)
        .set({ campaignFollowerId: randomUUID() })
        .where(eq(secureTokens.id, token!.id)),
    ).rejects.toThrow();
  });
});

/* ═════════════════════════════════ 4. A follower never sees backer_only */

describe('a follower digest cannot carry a backer-only update', () => {
  it('drops backer_only and keeps the public and milestone ones', async () => {
    const campaignId = await seedCampaign('audience');
    await requestFollow(deps(), {
      campaignId,
      email: 'audience@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const confirmToken = tokenFrom(await lastMessage(), 'confirm');
    await confirmFollow(deps(), confirmToken);

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));

    const now = new Date();
    await h.db.insert(campaignUpdates).values([
      {
        campaignId,
        audience: 'general_public',
        title: 'A public update',
        body: 'Everyone may read this.',
        publishedAt: new Date(now.getTime() - 3_600_000),
        author: 'user:test',
      },
      {
        campaignId,
        audience: 'backer_only',
        title: 'A private update',
        body: 'Only people who pre-ordered may read this.',
        publishedAt: new Date(now.getTime() - 3_600_000),
        author: 'user:test',
      },
    ]);

    const items = await composeDigest(h.db, {
      audience: 'backer',
      frequency: 'weekly',
      followerId: row!.id,
      target: 'audience@example.com',
      now,
    });

    const headlines = items.map((i) => i.headline).join(' | ');
    expect(headlines).toContain('A public update');
    // §18 disclosure, not a digest bug: a follower has not pre-ordered.
    expect(headlines).not.toContain('A private update');
  });

  it('branches on follower-ness, not on the audience string', () => {
    // The two share the `backer` audience deliberately — the prefix names the
    // delivery channel, not a claim about pre-ordering — so the source must
    // not decide visibility from `input.audience`.
    const source = readFileSync(join(SRC, 'notifications/digest.ts'), 'utf8');
    // Whitespace-tolerant on purpose: the repository checks out with CRLF on
    // Windows, so a scan pinned to a literal newline would pass or fail on the
    // checkout rather than on the code.
    expect(source).toMatch(/input\.followerId\s*\?\s*CREATOR_VISIBLE_AUDIENCES/);
  });

  it('still reads notification_deliveries exactly once, for the exclusion', () => {
    const source = readFileSync(join(SRC, 'notifications/digest.ts'), 'utf8');
    const uses = source.match(/from\(notificationDeliveries\)/g) ?? [];
    expect(uses).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════ 5. Nothing chases anybody */

describe('the follow record cannot become an engagement sequence', () => {
  it('has no schedule-shaped column, on either table', async () => {
    const rows = await h.db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('campaign_followers', 'campaign_follow_events', 'campaigns')
    `);
    const names = (rows.rows as { table_name: string; column_name: string }[]).map(
      (r) => `${r.table_name}.${r.column_name}`,
    );
    const forbidden = [
      'remind_at',
      'notify_at',
      'recurrence',
      'repeat_interval',
      'next_send_at',
      'cadence',
      'template_id',
      'escalate_at',
      'snooze_until',
    ];
    for (const column of forbidden) {
      expect(names.filter((n) => n.endsWith(`.${column}`))).toEqual([]);
    }
    // §30 defers public like/follow signals. A rolled-up count is also a
    // second answer to a question one query already answers.
    expect(names).not.toContain('campaigns.follower_count');
  });

  it('is named by no job under jobs/, except the retention sweep', () => {
    const dir = join(SRC, 'jobs');
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      if (!/campaignFollowers|campaign_followers/.test(source)) continue;
      offenders.push(name);
    }
    // The sweep REMOVES content on §25.8's clock; it sends nothing. Nothing
    // else under jobs/ may touch the table at all.
    expect(offenders).toEqual([]);
  });

  it('exposes no follower count on the public campaign payload', async () => {
    const campaignId = await seedCampaign('count');
    await requestFollow(deps(), {
      campaignId,
      email: 'counted@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    await confirmFollow(deps(), tokenFrom(await lastMessage(), 'confirm'));

    // The count exists for the Admin record and is computed, never stored.
    expect(await countConfirmedFollowers(h.db, campaignId)).toBe(1);

    const res = await request(h.app).get(`/api/campaign/${campaignId}`);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/follower/i);
  });

  it('adds exactly one notification key, and it is transactional', async () => {
    const registry = readFileSync(
      join(SRC, '../../shared/src/notifications/registry.ts'),
      'utf8',
    );
    // `_follow_` rather than `follow`, so §27.8's long-standing
    // `backer_support_followup` is not counted as one of ours.
    const follows = registry.match(/^\s{2}\w*_follow_\w*:/gm) ?? [];
    expect(follows).toEqual(['  backer_follow_confirmation:']);
    expect(registry).toContain('backer_follow_confirmation');

    // The receipt must carry no opt-out language: §27.2 makes transactional
    // email not opt-out-able, and the thing being consented to carries its own
    // route out.
    const campaignId = await seedCampaign('one-key');
    await requestFollow(deps(), {
      campaignId,
      email: 'onekey@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const body = await lastMessage();
    expect(body).not.toMatch(/unsubscribe|opt[- ]out/i);

    const delivered = await h.db
      .select({ event: notificationDeliveries.eventKey })
      .from(notificationDeliveries);
    expect(delivered.some((d) => d.event === 'backer_follow_confirmation')).toBe(true);
  });
});

/* ══════════════════════════════════ 6. §25.8 window 4, and irreversibility */

describe('§25.8 window 4 — until unsubscribe + 2 years', () => {
  it('uses the Spec’s own window, restated and drift-tested', () => {
    expect(FOLLOW_CONSENT_RETENTION_YEARS).toBe(2);
    expect([...DIGEST_FREQUENCIES]).toEqual([...SHARED_FREQUENCIES]);
    const cutoff = followRetentionCutoff(new Date('2028-06-01T00:00:00Z'));
    expect(cutoff.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('anonymises only after the window, and leaves the provenance', async () => {
    const campaignId = await seedCampaign('retention');
    await requestFollow(deps(), {
      campaignId,
      email: 'retention@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    await unfollowCampaign(deps(), tokenFrom(await lastMessage(), 'stop'));

    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));

    const audits: string[] = [];
    const audit = async (e: { action: string }) => {
      audits.push(e.action);
    };

    // One day short of the window: nothing is due.
    const almost = new Date(row!.unfollowedAt!.getTime() + (365 * 2 - 1) * DAY);
    expect((await sweepFollowConsent({ db: h.db, audit }, almost)).anonymised).toBe(0);

    // Past it: anonymised.
    const after = new Date(row!.unfollowedAt!.getTime() + 365 * 3 * DAY);
    // At least this one. The sweep is global by design — it is a retention
    // obligation, not a per-campaign action — and earlier cases in this file
    // leave their own unfollowed rows behind, so the assertion that matters is
    // about THIS row's columns below, not about a total.
    const result = await sweepFollowConsent({ db: h.db, audit }, after);
    expect(result.anonymised).toBeGreaterThanOrEqual(1);
    expect(audits).toContain('follow.consent_anonymised');

    const [swept] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.id, row!.id));
    expect(swept!.email).toBeNull();
    expect(swept!.emailNormalized).toBeNull();
    expect(swept!.consentText).toBeNull();
    expect(swept!.anonymisedAt).not.toBeNull();
    // Provenance survives: the fact that somebody asked, for which campaign,
    // from where, and under which consent version.
    expect(swept!.campaignId).toBe(campaignId);
    expect(swept!.source).toBe('campaign_page');
    expect(swept!.consentVersion).toBe('follow-consent.v1');

    // Idempotent by construction — an anonymised row no longer matches.
    expect((await sweepFollowConsent({ db: h.db, audit }, after)).anonymised).toBe(0);
  });

  it('cannot be un-anonymised, and the DATABASE is what refuses', async () => {
    const campaignId = await seedCampaign('irreversible');
    await requestFollow(deps(), {
      campaignId,
      email: 'irreversible@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    await unfollowCampaign(deps(), tokenFrom(await lastMessage(), 'stop'));
    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));

    const after = new Date(row!.unfollowedAt!.getTime() + 365 * 3 * DAY);
    await sweepFollowConsent({ db: h.db, audit: async () => {} }, after);

    // A hand-written UPDATE, not a service call. A row that could be
    // un-anonymised was never anonymised, only hidden.
    await expect(
      h.db
        .update(campaignFollowers)
        .set({ email: 'back@example.com', emailNormalized: 'back@example.com' })
        .where(eq(campaignFollowers.id, row!.id)),
    ).rejects.toThrow();

    await expect(
      h.db
        .update(campaignFollowers)
        .set({ anonymisedAt: null })
        .where(eq(campaignFollowers.id, row!.id)),
    ).rejects.toThrow();
  });

  it('refuses a half-swept row outright', async () => {
    const campaignId = await seedCampaign('half-swept');
    await requestFollow(deps(), {
      campaignId,
      email: 'half@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, campaignId));

    // The two-shape CHECK: an address without its consent text, or a stamp
    // without the nulls, is not a state this table can hold.
    await expect(
      h.db
        .update(campaignFollowers)
        .set({ email: null })
        .where(eq(campaignFollowers.id, row!.id)),
    ).rejects.toThrow();
  });

  it('cannot be repointed at another campaign', async () => {
    const a = await seedCampaign('repoint-a');
    const b = await seedCampaign('repoint-b');
    await requestFollow(deps(), {
      campaignId: a,
      email: 'repoint@example.com',
      frequency: 'weekly',
      source: 'campaign_page',
    });
    const [row] = await h.db
      .select()
      .from(campaignFollowers)
      .where(eq(campaignFollowers.campaignId, a));
    await expect(
      h.db
        .update(campaignFollowers)
        .set({ campaignId: b })
        .where(eq(campaignFollowers.id, row!.id)),
    ).rejects.toThrow();
  });
});

/* ═════════════════════════════════════════════ 7. The digest, end to end */

describe('a confirmed follower receives §27.7’s existing digest', () => {
  it('sends one summary carrying its own way out, and none when nothing happened', async () => {
    const campaignId = await seedCampaign('digest-e2e');
    await requestFollow(deps(), {
      campaignId,
      email: 'digest@example.com',
      frequency: 'daily',
      source: 'campaign_page',
    });
    await confirmFollow(deps(), tokenFrom(await lastMessage(), 'confirm'));

    // Nothing has happened yet: an empty digest is never produced (§33.6.11).
    const quiet = await sweepDigests({ ...deps(), notifier: h.notifier }, { frequency: 'daily' });
    expect(quiet.sent).toBe(0);

    await h.db.insert(campaignUpdates).values({
      campaignId,
      audience: 'general_public',
      title: 'The first run is scheduled',
      body: 'Tooling is finished.',
      publishedAt: new Date(),
      author: 'user:test',
    });

    const loud = await sweepDigests({ ...deps(), notifier: h.notifier }, { frequency: 'daily' });
    expect(loud.sent).toBe(1);

    const body = await lastMessage();
    // The digest's single action IS the opt-out for a follower, which is what
    // satisfies `oneActionAtMost` and `optOutRule: 'required'` at once.
    expect(body).toMatch(/\/follow\/stop\//);

    // A job that runs twice sends once — the dedup entity is the period.
    const again = await sweepDigests({ ...deps(), notifier: h.notifier }, { frequency: 'daily' });
    expect(again.sent).toBe(0);
  });

  it('stops sending the moment somebody unfollows', async () => {
    const campaignId = await seedCampaign('digest-stop');
    await requestFollow(deps(), {
      campaignId,
      email: 'stopme@example.com',
      frequency: 'daily',
      source: 'campaign_page',
    });
    const first = await lastMessage();
    await confirmFollow(deps(), tokenFrom(first, 'confirm'));
    await unfollowCampaign(deps(), tokenFrom(first, 'stop'));

    await h.db.insert(campaignUpdates).values({
      campaignId,
      audience: 'general_public',
      title: 'Something happened after they left',
      body: 'They should not hear about this.',
      publishedAt: new Date(),
      author: 'user:test',
    });

    const swept = await sweepDigests({ ...deps(), notifier: h.notifier }, { frequency: 'daily' });
    const bodies = h.sentEmails.messages
      .map((m) => `${m.html ?? ''}${m.text ?? ''}`)
      .join('\n');
    expect(swept.sent).toBe(0);
    expect(bodies).not.toContain('Something happened after they left');
  });

  it('keeps one follow per address per campaign', async () => {
    const campaignId = await seedCampaign('one-per');
    for (const email of ['dup@example.com', 'DUP@example.com', 'dup@example.com']) {
      await requestFollow(deps(), {
        campaignId,
        email,
        frequency: 'weekly',
        source: 'campaign_page',
      });
    }
    const rows = await h.db
      .select()
      .from(campaignFollowers)
      .where(
        and(
          eq(campaignFollowers.campaignId, campaignId),
          eq(campaignFollowers.emailNormalized, 'dup@example.com'),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
