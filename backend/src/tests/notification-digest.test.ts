/**
 * §27.7 — the optional digest and the notification history (Phase 22c).
 *
 * The two things this suite exists to prove are the two that would be quietly
 * untrue otherwise:
 *
 *  1. **the digest cannot carry a transactional message.** §27.2 makes every
 *     other message not opt-out-able; §27.7 makes this one optional. That is
 *     only coherent while they are disjoint, so the suite asserts no eligible
 *     activity is a money message or a deadline message, and that the composer
 *     reads activity records rather than deliveries.
 *
 *  2. **the history is not a dashboard.** §27.7 names the failure by example —
 *     "does not turn Founder home into a widget dashboard or override the one
 *     ranked Act item" — so the suite asserts the payload carries no count, the
 *     router exposes no read-state write, and §20's Act is untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { campaigns, campaignAffiliateAssociations, associationStatusHistory } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { campaignComments, campaignBackerNumbers } from '../db/schema/live-editing.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import {
  notificationDigestPreferences,
  notificationDigestPreferenceEvents,
} from '../db/schema/digest.js';
import {
  readDigestPreference,
  setDigestPreference,
  readPreferenceHistory,
} from '../notifications/preferences.js';
import { composeDigest, sendDigest, sweepDigests } from '../notifications/digest.js';
import { readNotificationHistory } from '../notifications/history.js';
import * as backendDigest from '../notifications/digest-logic.js';
import * as sharedDigest from '@proovd/shared';
import {
  MONEY_MESSAGE_CLASS,
  DEADLINE_MESSAGE_KEYS,
} from '../notifications/contract-logic.js';

let h: Harness;

/**
 * 22a's helper, restated for this suite. A source scan that could not tell a
 * comment from a usage would force these files to stop explaining what they
 * deliberately do not do.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Drizzle wraps the driver error, so a trigger's own sentence lives on `cause`
 * rather than on the thrown message — the shape `fulfillment.test.ts` and the
 * `23505` checks already use.
 */
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
  expect(messages.some((m) => pattern.test(m))).toBe(true);
}

const CONTEXT = {
  fromAddress: 'hello@proovd.co',
  supportEmail: 'support@proovd.co',
  appBaseUrl: 'http://localhost:3000',
};
const DAY = 24 * 3_600_000;

/**
 * The instant a sweep runs, as one that is unambiguously after the rows this
 * suite just wrote.
 *
 * Postgres timestamps carry microseconds and a JS `Date` carries milliseconds,
 * so a row stamped by `now()` in the same millisecond as `new Date()` is
 * strictly *after* it — and the window's upper bound would exclude activity
 * written a moment earlier. That is a property of the test, not of the product:
 * no real sweep runs in the same millisecond as the activity it summarises, and
 * an item missed at the boundary is still inside the next window's lower bound,
 * so nothing is ever permanently lost. Racing the clock here would make the
 * suite flaky rather than make it prove anything.
 */
function sweepInstant(): Date {
  return new Date(Date.now() + 1_000);
}

beforeAll(async () => {
  h = await startHarness({}, 'digest');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

function deps() {
  return { db: h.db, notifier: h.notifier, ...CONTEXT };
}

/* ── Seeding ──────────────────────────────────────────────────────────────── */

interface Seeded {
  campaignId: string;
  founderUserId: string;
  founderEmail: string;
  creatorUserId: string;
  creatorEmail: string;
  associationId: string;
  backerIdentityId: string;
  backerEmail: string;
}

async function seedCampaign(label: string): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', `dg-founder-${label}`);
  const creator = await seedUser(h, 'affiliate', `dg-creator-${label}`);

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

  const backerEmail = `dg-backer-${label}@example.com`;
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email: backerEmail,
      phone: '+15555550100',
      emailNormalized: backerEmail,
      phoneNormalized: '+15555550100',
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });

  return {
    campaignId,
    founderUserId: founder.id,
    founderEmail: founder.email,
    creatorUserId: creator.id,
    creatorEmail: creator.email,
    associationId: association!.id,
    backerIdentityId: identity!.id,
    backerEmail,
  };
}

async function postUpdate(
  campaignId: string,
  audience: 'general_public' | 'backer_only' | 'milestone_progress',
  title: string,
  publishedAt = new Date(),
) {
  await h.db.insert(campaignUpdates).values({
    campaignId,
    author: 'founder',
    audience,
    title,
    body: 'Body text long enough to be a real update on this campaign.',
    publishedAt,
  });
}

/* ── The preference (§27.7, §30) ──────────────────────────────────────────── */

describe('§27.7 — the digest preference', () => {
  it('no row means "has not chosen", which is not the same as "chose off" (§1.4)', async () => {
    const s = await seedCampaign('pref1');
    const view = await readDigestPreference(h.db, {
      audience: 'founder',
      userId: s.founderUserId,
    });

    expect(view.chosen).toBe(false);
    expect(view.frequency).toBeNull();
    // The distinction is what makes §27.7's "selects preference at first
    // magic-link visit" answerable: only an unchosen preference is asked again.
    expect(view.question).toBeTruthy();
    expect(view.options.map((o) => o.value)).toEqual(['off', 'daily', 'weekly']);
  });

  it('nothing on the read path creates a preference row (§30: no prechecked consent)', async () => {
    const s = await seedCampaign('pref2');
    await readDigestPreference(h.db, { audience: 'founder', userId: s.founderUserId });
    await readDigestPreference(h.db, { audience: 'backer', backerIdentityId: s.backerIdentityId });
    await composeDigest(h.db, {
      audience: 'founder',
      frequency: 'daily',
      userId: s.founderUserId,
      target: s.founderEmail,
      now: sweepInstant(),
    });

    const rows = await h.db.select().from(notificationDigestPreferences);
    const mine = rows.filter(
      (r) => r.userId === s.founderUserId || r.backerIdentityId === s.backerIdentityId,
    );
    expect(mine).toHaveLength(0);
  });

  it('`off` is a recorded choice, and the history keeps every change (§1.1)', async () => {
    const s = await seedCampaign('pref3');
    const subject = { audience: 'founder' as const, userId: s.founderUserId };

    expect(await setDigestPreference(h.db, subject, 'weekly')).toEqual({
      status: 'recorded',
      frequency: 'weekly',
    });
    await setDigestPreference(h.db, subject, 'off');

    const view = await readDigestPreference(h.db, subject);
    expect(view.chosen).toBe(true);
    expect(view.frequency).toBe('off');

    // Written by trigger, so no service call can skip it.
    const history = await readPreferenceHistory(h.db, subject);
    expect(history.map((e) => [e.priorFrequency, e.newFrequency])).toEqual([
      [null, 'weekly'],
      ['weekly', 'off'],
    ]);
  });

  it('refuses a frequency that is not one of the three, by name', async () => {
    const s = await seedCampaign('pref4');
    const result = await setDigestPreference(
      h.db,
      { audience: 'founder', userId: s.founderUserId },
      'hourly',
    );
    expect(result.status).toBe('invalid_frequency');
    if (result.status === 'invalid_frequency') {
      expect(result.permitted).toEqual(['off', 'daily', 'weekly']);
    }
  });

  it('a preference cannot be re-pointed at another person (trigger)', async () => {
    const a = await seedCampaign('pref5a');
    const b = await seedCampaign('pref5b');
    await setDigestPreference(h.db, { audience: 'founder', userId: a.founderUserId }, 'daily');

    await expectDbRefusal(
      h.db
        .update(notificationDigestPreferences)
        .set({ userId: b.founderUserId })
        .where(eq(notificationDigestPreferences.userId, a.founderUserId)),
      /never moves/i,
    );
  });

  it('the preference history is insert-only (trigger)', async () => {
    const s = await seedCampaign('pref6');
    await setDigestPreference(h.db, { audience: 'founder', userId: s.founderUserId }, 'daily');
    const [event] = await h.db
      .select()
      .from(notificationDigestPreferenceEvents)
      .orderBy(sql`occurred_at desc`)
      .limit(1);

    await expectDbRefusal(
      h.db
        .delete(notificationDigestPreferenceEvents)
        .where(eq(notificationDigestPreferenceEvents.id, event!.id)),
      /insert-only/i,
    );
  });

  it('a Backer preference is per campaign, because the identity is (§4.1)', async () => {
    const s = await seedCampaign('pref7');
    await setDigestPreference(
      h.db,
      { audience: 'backer', backerIdentityId: s.backerIdentityId },
      'weekly',
    );

    const [row] = await h.db
      .select()
      .from(notificationDigestPreferences)
      .where(eq(notificationDigestPreferences.backerIdentityId, s.backerIdentityId));
    expect(row!.userId).toBeNull();
    expect(row!.audience).toBe('backer');
  });
});

/* ── Composition (§27.7, §18) ─────────────────────────────────────────────── */

describe('§27.7 — what a digest is made of', () => {
  it('carries only the three §27.7 activity kinds, and never a delivery record', async () => {
    const s = await seedCampaign('comp1');
    await postUpdate(s.campaignId, 'general_public', 'Tooling finished');

    // A transactional delivery to the same person, in the same window.
    await h.db.insert(notificationDeliveries).values({
      eventKey: 'founder_listing_fee_receipt',
      target: s.founderEmail,
      entityType: 'listing_fee_payment',
      entityId: randomUUID(),
      deliveredAt: new Date(),
    });

    const items = await composeDigest(h.db, {
      audience: 'founder',
      frequency: 'daily',
      userId: s.founderUserId,
      target: s.founderEmail,
      now: sweepInstant(),
    });

    // The Founder's digest carries comments and roster changes — never their
    // own update, and never the receipt.
    for (const item of items) {
      expect(['campaign_comment', 'roster_change']).toContain(item.kind);
    }
    expect(items.some((i) => i.headline.includes('receipt'))).toBe(false);
  });

  it('a Backer sees backer-only updates; a Creator on the same campaign does not (§18)', async () => {
    const s = await seedCampaign('comp2');
    await postUpdate(s.campaignId, 'backer_only', 'Backers only: the shipping plan');
    await postUpdate(s.campaignId, 'general_public', 'Public: tooling finished');

    const backer = await composeDigest(h.db, {
      audience: 'backer',
      frequency: 'daily',
      backerIdentityId: s.backerIdentityId,
      target: s.backerEmail,
      now: sweepInstant(),
    });
    const creator = await composeDigest(h.db, {
      audience: 'affiliate',
      frequency: 'daily',
      userId: s.creatorUserId,
      target: s.creatorEmail,
      now: sweepInstant(),
    });

    expect(backer.map((i) => i.headline).sort()).toEqual([
      'Backers only: the shipping plan',
      'Public: tooling finished',
    ]);
    // Getting this backwards would put a Founder's Backer-only update in front
    // of a Creator, which is a §18 disclosure failure rather than a digest bug.
    expect(creator.map((i) => i.headline)).toEqual(['Public: tooling finished']);
  });

  it('a removed comment is not summarised — the removal would be undone by email', async () => {
    const s = await seedCampaign('comp3');
    await h.db
      .insert(campaignBackerNumbers)
      .values({ campaignId: s.campaignId, backerIdentityId: s.backerIdentityId, backerNumber: 1 });

    const [visible] = await h.db
      .insert(campaignComments)
      .values({
        campaignId: s.campaignId,
        backerIdentityId: s.backerIdentityId,
        authorDisplay: 'Backer 001',
        body: 'When does this ship?',
      })
      .returning({ id: campaignComments.id });

    await h.db.insert(campaignComments).values({
      campaignId: s.campaignId,
      backerIdentityId: s.backerIdentityId,
      authorDisplay: 'Backer 001',
      body: 'A comment an Admin took down.',
      visibility: 'removed',
      removedBy: 'admin:test',
      removedAt: new Date(),
      removedReason: 'off-topic',
    });

    const items = await composeDigest(h.db, {
      audience: 'founder',
      frequency: 'daily',
      userId: s.founderUserId,
      target: s.founderEmail,
      now: sweepInstant(),
    });

    const comments = items.filter((i) => i.kind === 'campaign_comment');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.sourceId).toBe(visible!.id);
  });

  it('activity outside the window is not carried', async () => {
    const s = await seedCampaign('comp4');
    await postUpdate(s.campaignId, 'general_public', 'Old news', new Date(Date.now() - 3 * DAY));
    await postUpdate(s.campaignId, 'general_public', 'Today', new Date());

    const daily = await composeDigest(h.db, {
      audience: 'backer',
      frequency: 'daily',
      backerIdentityId: s.backerIdentityId,
      target: s.backerEmail,
      now: sweepInstant(),
    });
    expect(daily.map((i) => i.headline)).toEqual(['Today']);

    const weekly = await composeDigest(h.db, {
      audience: 'backer',
      frequency: 'weekly',
      backerIdentityId: s.backerIdentityId,
      target: s.backerEmail,
      now: sweepInstant(),
    });
    expect(weekly.map((i) => i.headline).sort()).toEqual(['Old news', 'Today']);
  });

  it('an item whose covering transactional key already delivered is excluded (§27.2, §30)', async () => {
    const s = await seedCampaign('comp5');

    const [history] = await h.db
      .insert(associationStatusHistory)
      .values({ associationId: s.associationId, toStatus: 'active', actor: 'admin:test' })
      .returning({ id: associationStatusHistory.id });

    const before = await composeDigest(h.db, {
      audience: 'founder',
      frequency: 'daily',
      userId: s.founderUserId,
      target: s.founderEmail,
      now: sweepInstant(),
    });
    expect(before.some((i) => i.sourceId === history!.id)).toBe(true);

    // 22b's `founder_roster_update` keyed on the history row — the contract
    // `unsent.ts` records. Once it delivers, the digest must not restate it.
    await h.db.insert(notificationDeliveries).values({
      eventKey: 'founder_roster_update',
      target: s.founderEmail,
      entityType: 'association_status_history',
      entityId: history!.id,
      deliveredAt: new Date(),
    });

    const after = await composeDigest(h.db, {
      audience: 'founder',
      frequency: 'daily',
      userId: s.founderUserId,
      target: s.founderEmail,
      now: sweepInstant(),
    });
    expect(after.some((i) => i.sourceId === history!.id)).toBe(false);
  });
});

/* ── Sending (§27.2, §33.6.11) ────────────────────────────────────────────── */

describe('§27.7 — sending', () => {
  it('an empty digest sends nothing and records nothing (§33.6.11, §30)', async () => {
    const s = await seedCampaign('send1');
    await setDigestPreference(h.db, { audience: 'founder', userId: s.founderUserId }, 'daily');
    const before = h.sentEmails.messages.length;

    const result = await sweepDigests(deps(), { frequency: 'daily', now: sweepInstant() });

    expect(result.sent).toBe(0);
    expect(h.sentEmails.messages).toHaveLength(before);
    const deliveries = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventKey, 'founder_activity_digest'));
    expect(deliveries.filter((d) => d.target === s.founderEmail)).toHaveLength(0);
  });

  it('sends once per subscriber per period, however often the job runs (§27.2)', async () => {
    const s = await seedCampaign('send2');
    await postUpdate(s.campaignId, 'general_public', 'Tooling finished');
    await setDigestPreference(
      h.db,
      { audience: 'backer', backerIdentityId: s.backerIdentityId },
      'daily',
    );

    const first = await sweepDigests(deps(), { frequency: 'daily', now: sweepInstant() });
    const second = await sweepDigests(deps(), { frequency: 'daily', now: sweepInstant() });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(
      h.sentEmails.messages.filter((m) => m.to === s.backerEmail),
    ).toHaveLength(1);
  });

  it('a subscriber who chose `off` is never sent one', async () => {
    const s = await seedCampaign('send3');
    await postUpdate(s.campaignId, 'general_public', 'Tooling finished');
    await setDigestPreference(
      h.db,
      { audience: 'backer', backerIdentityId: s.backerIdentityId },
      'off',
    );

    await sweepDigests(deps(), { frequency: 'daily', now: sweepInstant() });
    await sweepDigests(deps(), { frequency: 'weekly', now: sweepInstant() });

    expect(h.sentEmails.messages.filter((m) => m.to === s.backerEmail)).toHaveLength(0);
  });

  it('the rendered message carries no pressure vocabulary (§30, DNA §5.5)', async () => {
    const s = await seedCampaign('send4');
    await postUpdate(s.campaignId, 'general_public', 'Tooling finished');
    await setDigestPreference(
      h.db,
      { audience: 'backer', backerIdentityId: s.backerIdentityId },
      'weekly',
    );

    const outcome = await sendDigest(deps(), {
      audience: 'backer',
      frequency: 'weekly',
      backerIdentityId: s.backerIdentityId,
      target: s.backerEmail,
      now: sweepInstant(),
      preferenceId: randomUUID(),
    });
    expect(outcome.status).toBe('sent');

    const message = h.sentEmails.messages.find((m) => m.to === s.backerEmail)!;
    const body = `${message.subject}\n${message.text}\n${message.html}`.toLowerCase();
    for (const term of backendDigest.BANNED_DIGEST_TERMS) {
      expect(body.includes(term.toLowerCase()), term).toBe(false);
    }
    // §27.2's specific subject, naming the campaign.
    expect(message.subject).toContain('Kettle');
    // §27.7 vs §27.2: the reader is told which kind of email this is.
    expect(message.text).toContain(backendDigest.DIGEST_NEVER_REPLACES_TRANSACTIONAL);
  });
});

/* ── The disjointness that makes §27.2 and §27.7 compatible ───────────────── */

describe('§27.2 vs §27.7 — the digest carries no transactional content', () => {
  it('no eligible activity is a money message or a deadline message', () => {
    for (const kind of backendDigest.ELIGIBLE_ACTIVITY_KINDS) {
      const coveredBy = backendDigest.DIGEST_ELIGIBLE_ACTIVITY[kind].coveredBy;
      if (!coveredBy) continue;
      expect(MONEY_MESSAGE_CLASS[coveredBy], `${kind} is money`).toBeUndefined();
      expect(DEADLINE_MESSAGE_KEYS.includes(coveredBy), `${kind} is a deadline`).toBe(false);
    }
  });

  it('the composer reads activity tables and never `notification_deliveries` as a source', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../notifications/digest.ts'), 'utf8');
    // It appears exactly once, in the exclusion query — the one place §27.2
    // requires it. A second use would be the "everything we emailed you" digest
    // this design exists to refuse.
    const uses = source.match(/from\(notificationDeliveries\)/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(source).toContain('withoutAlreadySentItems');
  });
});

/* ── History (§27.7, DNA §5.2) ────────────────────────────────────────────── */

describe('§27.7 — notification history', () => {
  it('shows what was sent to this address, and never another audience’s messages', async () => {
    const s = await seedCampaign('hist1');
    for (const eventKey of [
      'founder_campaign_live',
      'internal_campaign_submitted',
      'affiliate_campaign_live',
    ]) {
      await h.db.insert(notificationDeliveries).values({
        eventKey,
        target: s.founderEmail,
        entityType: 'campaign',
        entityId: s.campaignId,
        deliveredAt: new Date(),
      });
    }

    const result = await readNotificationHistory(h.db, {
      audience: 'founder',
      email: s.founderEmail,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const keys = result.page.entries.map((e) => e.eventKey);
    expect(keys).toContain('founder_campaign_live');
    // The prefix IS the audience: a Founder must never read the Admin queue's
    // own messages about them, nor a Creator's.
    expect(keys).not.toContain('internal_campaign_submitted');
    expect(keys).not.toContain('affiliate_campaign_live');
  });

  it('an unconfirmed delivery says so rather than reading as sent (§1.4)', async () => {
    const s = await seedCampaign('hist2');
    await h.db.insert(notificationDeliveries).values({
      eventKey: 'founder_campaign_live',
      target: s.founderEmail,
      entityType: 'campaign',
      entityId: s.campaignId,
      // Claimed, provider never confirmed — send.ts's honest middle state.
      deliveredAt: null,
    });

    const result = await readNotificationHistory(h.db, {
      audience: 'founder',
      email: s.founderEmail,
    });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.page.entries[0]!.state).toBe('unconfirmed');
  });

  it('a customer history refuses rather than returning everything when unscoped', async () => {
    const result = await readNotificationHistory(h.db, { audience: 'founder' });
    expect(result.status).toBe('email_required');
  });

  it('Admin sees the recipient and the provider id; a customer sees neither', async () => {
    const s = await seedCampaign('hist3');
    await h.db.insert(notificationDeliveries).values({
      eventKey: 'founder_campaign_live',
      target: s.founderEmail,
      entityType: 'campaign',
      entityId: s.campaignId,
      notificationId: 'test-msg-provider',
      deliveredAt: new Date(),
    });

    const asAdmin = await readNotificationHistory(h.db, {
      audience: 'admin',
      email: s.founderEmail,
    });
    const asFounder = await readNotificationHistory(h.db, {
      audience: 'founder',
      email: s.founderEmail,
    });
    if (asAdmin.status !== 'ok' || asFounder.status !== 'ok') throw new Error('expected ok');

    expect(asAdmin.page.entries[0]!.target).toBe(s.founderEmail);
    expect(asFounder.page.entries[0]!.target).toBeUndefined();
    expect(asFounder.page.entries[0]!.providerNotificationId).toBeUndefined();
  });

  it('is a record, not a dashboard: no count, no unread state, no write path (§27.7)', async () => {
    const s = await seedCampaign('hist4');
    await h.db.insert(notificationDeliveries).values({
      eventKey: 'founder_campaign_live',
      target: s.founderEmail,
      entityType: 'campaign',
      entityId: s.campaignId,
      deliveredAt: new Date(),
    });

    const result = await readNotificationHistory(h.db, {
      audience: 'founder',
      email: s.founderEmail,
    });
    if (result.status !== 'ok') throw new Error('expected ok');

    // The payload's whole shape. A count field is what a badge is computed from.
    expect(Object.keys(result.page).sort()).toEqual(['entries', 'nextCursor']);
    const serialised = JSON.stringify(result.page).toLowerCase();
    for (const term of ['unread', 'badge', 'count', 'lastseen', 'last_seen']) {
      expect(serialised.includes(term), term).toBe(false);
    }

    // No route under /notifications writes anything except the preference.
    const here = dirname(fileURLToPath(import.meta.url));
    const router = readFileSync(join(here, '../routes/notifications.ts'), 'utf8');
    const writes = router.match(/router\.(post|put|patch|delete)\(/g) ?? [];
    expect(writes).toEqual(['router.put(']);

    // §20's Act ranking never learns about a delivered email.
    for (const file of ['act.ts', 'home.ts', 'glance.ts']) {
      const live = readFileSync(join(here, '../live', file), 'utf8');
      expect(live.includes('notificationDeliveries'), file).toBe(false);
      expect(live.includes('digest'), file).toBe(false);
    }
  });

  it('no surface renders an unread badge, and no column could hold one', async () => {
    const columns = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name IN (
        'notification_deliveries',
        'notification_digest_preferences',
        'notification_digest_preference_events'
      )
    `);
    const names = (columns.rows as { column_name: string }[]).map((r) => r.column_name);
    for (const forbidden of ['unread_count', 'read_at', 'last_opened_at', 'opened_at', 'seen_at']) {
      expect(names, forbidden).not.toContain(forbidden);
    }

    // 22a's rule: these files explain at length what they refuse to render, and
    // a scan that could not tell an explanation from a usage would force the
    // reasoning out — which is the more valuable of the two.
    const here = dirname(fileURLToPath(import.meta.url));
    const surfaces = join(here, '../../../frontend/src/surfaces/notifications');
    for (const file of readdirSync(surfaces)) {
      // The suite's own file asserts the absence and therefore contains the
      // word. Scanning it would make the guard fail because it is enforced.
      if (file.includes('.test.')) continue;
      const text = stripComments(readFileSync(join(surfaces, file), 'utf8')).toLowerCase();
      expect(text.includes('unread'), file).toBe(false);
    }
  });
});

/* ── Drift (the rootDir constraint) ───────────────────────────────────────── */

describe('the backend restatement matches shared', () => {
  it('the digest register, the kernels, and the banned terms agree', () => {
    expect(backendDigest.DIGEST_FREQUENCIES).toEqual(sharedDigest.DIGEST_FREQUENCIES);
    expect(backendDigest.DIGEST_PREFERENCES).toEqual(sharedDigest.DIGEST_PREFERENCES);
    expect(backendDigest.DIGEST_AUDIENCES).toEqual(sharedDigest.DIGEST_AUDIENCES);
    expect(backendDigest.DIGEST_ELIGIBLE_ACTIVITY).toEqual(sharedDigest.DIGEST_ELIGIBLE_ACTIVITY);
    expect(backendDigest.DIGEST_WINDOW_HOURS).toEqual(sharedDigest.DIGEST_WINDOW_HOURS);
    expect(backendDigest.DIGEST_PROHIBITIONS).toEqual(sharedDigest.DIGEST_PROHIBITIONS);
    expect(backendDigest.BANNED_DIGEST_TERMS).toEqual(sharedDigest.BANNED_DIGEST_TERMS);
    expect(backendDigest.HISTORY_AUDIENCES).toEqual(sharedDigest.HISTORY_AUDIENCES);
    expect(backendDigest.HISTORY_DELIVERY_STATES).toEqual(sharedDigest.HISTORY_DELIVERY_STATES);
    expect(backendDigest.DIGEST_NEVER_REPLACES_TRANSACTIONAL).toBe(
      sharedDigest.DIGEST_NEVER_REPLACES_TRANSACTIONAL,
    );
    expect(backendDigest.DIGEST_OPTION_LABELS).toEqual(sharedDigest.DIGEST_OPTION_LABELS);

    const at = new Date('2026-09-20T14:00:00Z');
    for (const frequency of sharedDigest.DIGEST_FREQUENCIES) {
      expect(backendDigest.digestPeriodKey(frequency, at)).toBe(
        sharedDigest.digestPeriodKey(frequency, at),
      );
      expect(backendDigest.digestWindow(frequency, at)).toEqual(
        sharedDigest.digestWindow(frequency, at),
      );
      expect(backendDigest.activityKindsFor('founder')).toEqual(
        sharedDigest.activityKindsFor('founder'),
      );
    }
  });
});
