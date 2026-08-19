/**
 * Creator Flow v2 — Session D: the app shell and Home.
 *
 * `docs/phases/creator-flow-v2.md` is the brief. What this suite exists to hold
 * is the part of deviations 2, 3 and 5 that a comment cannot:
 *
 *   * the standing tier binds NOTHING — a source scan over the four modules
 *     that could read it as an eligibility input;
 *   * the three states Home has to serve, and none of them a zero standing in
 *     for a gap (§16a);
 *   * the notification drawer's four dashboard assertions;
 *   * the referral records an introduction, pays nothing, and admits nobody.
 *
 * Session A's own suite (`creator-flow.test.ts`) holds the column sets and the
 * CHECK-pinned vocabularies. Nothing here re-drives them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import {
  CREATOR_APP_ABSENCES,
  CREATOR_APP_SECTIONS,
  CREATOR_STANDING_COHORT_MINIMUM,
  CREATOR_STANDING_INPUTS,
  CREATOR_STANDING_POINTS,
  CREATOR_STANDING_TIERS,
  CREATOR_TRACK_RECORD_ITEMS,
  creatorPitchesWaitingHeadline,
  creatorStandingPercentile,
  creatorStandingScore,
  creatorStandingTier,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, signInPlain } from './admin-session.js';
import { createAuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateEvidenceVerifications } from '../db/schema/creator-workspace.js';
import { affiliateStandingSnapshots } from '../db/schema/creator-flow.js';
import { ensureStandingSnapshot, gatherStandingInputs } from '../affiliates/standing.js';
import { recordCreatorReferral } from '../affiliates/referrals.js';
import { readCreatorHome } from '../affiliates/home.js';
import * as backendLogic from '../creator-flow/logic.js';

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness({ authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 }, 'creatorhome');
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

const SRC = path.resolve(import.meta.dirname, '..');

interface SeededCreator {
  prospectId: string;
  associationId: string;
  campaignId: string;
  userId: string;
  email: string;
}

/**
 * One Creator with one association.
 *
 * `affiliate_id` and `prospect_id` are BOTH the prospect id, which is what the
 * only two production writers do (`recruitment.ts` and the workspace's own
 * `mutations.ts`). A seed that set them differently would be testing a shape
 * the product cannot create.
 */
async function seedCreator(label: string, status = 'formal_decision_open'): Promise<SeededCreator> {
  const user = await seedUser(h, 'affiliate', `home-${label}`);
  const [prospect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: user.email,
      subtype: 'social_creator',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    // `campaigns_type_lock_pair` (§9): a type and its lock instant are one
    // fact, and a row carrying one without the other is unrepresentable.
    .values({ status: 'affiliate_response_and_build', type: 'pre_launch', typeLockedAt: new Date() })
    .returning({ id: campaigns.id });

  const [assoc] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId: campaign!.id,
      affiliateId: prospect!.id,
      prospectId: prospect!.id,
      status: status as 'formal_decision_open',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });

  await h.db.insert(affiliateSignupProfiles).values({
    prospectId: prospect!.id,
    associationId: assoc!.id,
    email: user.email,
    publicHandle: `@creator-${label}`,
    claimedUserId: user.id,
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  return {
    prospectId: prospect!.id,
    associationId: assoc!.id,
    campaignId: campaign!.id,
    userId: user.id,
    email: user.email,
  };
}

/* ══ The tier binds nothing ═════════════════════════════════════════════════ */

describe('the standing tier decides nothing, and a source scan is what says so', () => {
  /**
   * The four modules a standing tier would be read by if it ever became an
   * eligibility input. Named individually rather than scanned tree-wide,
   * because the failure message has to say WHICH module reached for it.
   */
  const MUST_NOT_READ_STANDING = [
    'affiliates/decisions.ts',
    // The brief names `affiliates/readiness.ts`; §15's roster readiness lives
    // at `campaign/readiness.ts` and §16's Creator readiness at
    // `creator-payment/readiness.ts`. Both are here, because the register has
    // to name modules that exist or the scan passes by finding nothing.
    'campaign/readiness.ts',
    'creator-payment/readiness.ts',
    'creator-payment/allocations.ts',
    'close/earnings.ts',
    'close/founder-payments.ts',
  ];

  it('is imported by no compensation, readiness, or proposal path', () => {
    for (const relative of MUST_NOT_READ_STANDING) {
      const file = path.join(SRC, relative);
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        // A module that has been renamed is a register entry to fix, not a pass
        // to grant silently.
        throw new Error(`${relative} does not exist — update MUST_NOT_READ_STANDING`);
      }
      // Comments first: these files are allowed to EXPLAIN that they must not
      // read it, and a scan that could not tell an explanation from a usage
      // would push the explanation out — which is the more valuable of the two
      // (`notifications/send.ts`'s own rule).
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const forbidden of [
        'affiliate_standing_snapshots',
        'affiliateStandingSnapshots',
        'standingTier',
        'creatorStandingTier',
        'readLatestStanding',
        'ensureStandingSnapshot',
      ]) {
        expect({ relative, forbidden, found: code.includes(forbidden) }).toEqual({
          relative,
          forbidden,
          found: false,
        });
      }
    }
  });

  it('carries no rate, floor, or eligibility value in the module itself', () => {
    const code = readFileSync(path.join(SRC, 'affiliates/standing.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['percent(', 'commissionCents', 'basePercent', 'eligible', 'floor']) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });
});

/* ══ The score kernel, and its restatement ══════════════════════════════════ */

describe('the score is stated arithmetic, restated once, and drift-tested', () => {
  it('the backend restatement matches shared exactly', () => {
    expect(backendLogic.STANDING_POINTS).toEqual(CREATOR_STANDING_POINTS);
    expect(backendLogic.STANDING_COHORT_MINIMUM).toBe(CREATOR_STANDING_COHORT_MINIMUM);
    expect(backendLogic.STANDING_TIERS.map((t) => ({ id: t.id, minScore: t.minScore }))).toEqual(
      CREATOR_STANDING_TIERS.map((t) => ({ id: t.id, minScore: t.minScore })),
    );
    expect(backendLogic.STANDING_INPUT_IDS).toEqual(CREATOR_STANDING_INPUTS.map((i) => i.id));

    for (const counts of [
      { campaigns_completed: 0, posts_verified: 0, obligations_met: 0, evidence_verified: 0 },
      { campaigns_completed: 3, posts_verified: 3, obligations_met: 3, evidence_verified: 1 },
      { campaigns_completed: 40, posts_verified: 40, obligations_met: 40, evidence_verified: 9 },
    ]) {
      expect(backendLogic.standingScore(counts)).toBe(creatorStandingScore(counts));
      const score = creatorStandingScore(counts);
      expect(backendLogic.standingTier(score)).toBe(creatorStandingTier(score));
    }
  });

  it('is bounded by the CHECK, so a long history cannot write an illegal row', () => {
    const huge = {
      campaigns_completed: 999,
      posts_verified: 999,
      obligations_met: 999,
      evidence_verified: 999,
    };
    expect(creatorStandingScore(huge)).toBe(1000);
    expect(creatorStandingScore({})).toBe(0);
  });

  it('has no percentile until the cohort exists, and never a computed-anyway one', () => {
    const short = Array.from({ length: CREATOR_STANDING_COHORT_MINIMUM - 1 }, () => 100);
    expect(creatorStandingPercentile(500, short)).toBeNull();
    expect(backendLogic.standingPercentile(500, short)).toBeNull();

    const cohort = Array.from({ length: CREATOR_STANDING_COHORT_MINIMUM }, (_, i) => i * 100);
    // Never 0: a percentile of zero reads as a rank rather than as a position.
    expect(creatorStandingPercentile(0, cohort)).toBe(10);
    expect(creatorStandingPercentile(10_000, cohort)).toBe(100);
    expect(backendLogic.standingPercentile(400, cohort)).toBe(
      creatorStandingPercentile(400, cohort),
    );
  });

  it('every input and track-record item names a column that exists', async () => {
    // The mechanism that would have caught Session A's own slip: two entries
    // named `creator_post_submissions.outcome`, and the column is `status`.
    const named = [...CREATOR_STANDING_INPUTS, ...CREATOR_TRACK_RECORD_ITEMS]
      .map((entry) => entry.derivedFrom)
      .flatMap((text) => text.match(/\b([a-z_]+)\.([a-z_]+)\b/g) ?? []);
    expect(named.length).toBeGreaterThan(0);

    for (const reference of named) {
      const [table, column] = reference.split('.');
      const found = await h.db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
      `);
      expect({ reference, exists: found.rows.length === 1 }).toEqual({ reference, exists: true });
    }
  });
});

/* ══ The three states Home has to serve ═════════════════════════════════════ */

describe('Home serves three states, and none of them is a zero standing in for a gap', () => {
  it('a Creator with a pitch waiting sees it, and the count is a query', async () => {
    const seeded = await seedCreator('pitch');
    const home = await readCreatorHome(h.db, seeded.userId);
    expect(home.pitches).toHaveLength(1);
    expect(home.pitches[0]!.kind).toBe('opportunity');
    expect(creatorPitchesWaitingHeadline(1)).toBe('1 pitch waiting');
    expect(creatorPitchesWaitingHeadline(4)).toBe('4 pitches waiting');
  });

  it('a Creator with nothing waiting has an empty list, not a zero', async () => {
    const seeded = await seedCreator('calm', 'accepted');
    const home = await readCreatorHome(h.db, seeded.userId);
    expect(home.pitches).toEqual([]);
  });

  it('a brand-new Creator has NO standing row at all, rather than a score of zero', async () => {
    const seeded = await seedCreator('new');
    const home = await readCreatorHome(h.db, seeded.userId);
    // §16a. A stored zero would render as a lowest tier, which reads as a
    // judgement about somebody who has simply not started.
    expect(home.standing).toBeNull();
    const rows = await h.db
      .select()
      .from(affiliateStandingSnapshots)
      .where(sql`${affiliateStandingSnapshots.prospectId} = ${seeded.prospectId}`);
    expect(rows).toHaveLength(0);
  });

  it('a completed campaign produces a snapshot, and reading twice writes once', async () => {
    const seeded = await seedCreator('done', 'successfully_completed');
    await h.db.insert(affiliateEvidenceVerifications).values({
      prospectId: seeded.prospectId,
      metric: 'audience_size',
      decision: 'verified',
      detail: 'Checked the channel.',
      decidedBy: 'admin:test',
    });

    const inputs = await gatherStandingInputs(h.db, seeded.prospectId);
    expect(inputs).toEqual({
      campaigns_completed: 1,
      posts_verified: 0,
      obligations_met: 1,
      evidence_verified: 1,
    });

    const first = await ensureStandingSnapshot(h.db, seeded.prospectId);
    expect(first?.score).toBe(creatorStandingScore(inputs as unknown as Record<string, number>));
    expect(first?.tier).toBe(creatorStandingTier(first!.score));
    // The counts that produced it are stored beside it, so the number can be
    // explained later without re-deriving it from records that have moved.
    expect(first?.inputs).toEqual(inputs);

    await ensureStandingSnapshot(h.db, seeded.prospectId);
    await ensureStandingSnapshot(h.db, seeded.prospectId);
    const rows = await h.db
      .select()
      .from(affiliateStandingSnapshots)
      .where(sql`${affiliateStandingSnapshots.prospectId} = ${seeded.prospectId}`);
    expect(rows).toHaveLength(1);
  });

  it('a moved record appends a NEW row and never rewrites the old one', async () => {
    const seeded = await seedCreator('moved', 'successfully_completed');
    const first = await ensureStandingSnapshot(h.db, seeded.prospectId);

    await h.db.insert(affiliateEvidenceVerifications).values({
      prospectId: seeded.prospectId,
      metric: 'engagement_rate',
      decision: 'verified',
      detail: 'Checked it.',
      decidedBy: 'admin:test',
    });
    const second = await ensureStandingSnapshot(h.db, seeded.prospectId);

    expect(second!.score).toBeGreaterThan(first!.score);
    const rows = await h.db
      .select()
      .from(affiliateStandingSnapshots)
      .where(sql`${affiliateStandingSnapshots.prospectId} = ${seeded.prospectId}`);
    expect(rows).toHaveLength(2);
    // 21b's completion-findings reasoning: the earlier justification survives.
    const older = rows.find((r) => r.score === first!.score);
    expect(older?.inputs).toEqual(first!.inputs);
  });

  it('shows no leaderboard while the cohort is short', async () => {
    const seeded = await seedCreator('lonely', 'successfully_completed');
    const home = await readCreatorHome(h.db, seeded.userId);
    expect(home.standing).not.toBeNull();
    // A ranking of three is a sentence about two strangers.
    expect(home.leaders).toEqual([]);
    expect(home.cohortMinimum).toBe(CREATOR_STANDING_COHORT_MINIMUM);
    expect(home.standing?.percentile).toBeNull();
  });
});

/* ══ The payload is not a dashboard ═════════════════════════════════════════ */

describe('the app shell and its drawers cannot become a dashboard', () => {
  it('Home carries no notification count of any spelling', async () => {
    const seeded = await seedCreator('nocount');
    const cookie = await signInPlain(h, seeded.email);
    const response = await request(h.app).get('/api/creator/home').set('Cookie', cookie);
    expect(response.status).toBe(200);

    const blob = JSON.stringify(response.body).toLowerCase();
    for (const forbidden of ['unread', 'notificationcount', 'newcount', 'badge', 'read_at']) {
      expect({ forbidden, found: blob.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });

  it('the history payload is exactly entries and a cursor', async () => {
    const seeded = await seedCreator('hist');
    const cookie = await signInPlain(h, seeded.email);
    const response = await request(h.app)
      .get('/api/creator/notifications/history')
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.history).sort()).toEqual(['entries', 'nextCursor']);
  });

  it('no read-state column exists for a badge to be computed from', async () => {
    const found = await h.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notification_deliveries'
        AND column_name IN ('unread', 'read_at', 'last_opened_at', 'seen_at')
    `);
    expect(found.rows).toEqual([]);
  });

  it('every rail section is either reachable or explained, never both and never neither', () => {
    expect(CREATOR_APP_SECTIONS.length).toBeGreaterThan(0);
    for (const section of CREATOR_APP_SECTIONS) {
      const both = Boolean(section.href) && Boolean(section.unavailableBecause);
      const neither = !section.href && !section.unavailableBecause;
      expect({ id: section.id, both, neither }).toEqual({ id: section.id, both: false, neither: false });
      if (!section.href) {
        // A one-word reason is how a register stops being an argument.
        expect(section.unavailableBecause!.length).toBeGreaterThan(60);
        expect(section.buildsIn).toBeTruthy();
      }
    }
  });

  it('every refused element is written down with the rule that refuses it', () => {
    expect(CREATOR_APP_ABSENCES.length).toBeGreaterThan(8);
    for (const absence of CREATOR_APP_ABSENCES) {
      expect(absence.reason.length).toBeGreaterThan(60);
      expect(absence.specRef.trim().length).toBeGreaterThan(0);
      expect(absence.element.trim().length).toBeGreaterThan(0);
    }
    // The four the reference would cost the most, named so a later session
    // cannot quietly drop one from the register.
    const ids = CREATOR_APP_ABSENCES.map((a) => a.id);
    expect(ids).toContain('tier_unlocks');
    expect(ids).toContain('referral_percentage');
    expect(ids).toContain('public_join_link');
    expect(ids).toContain('updates_unread_count');
  });
});

/* ══ The referral ═══════════════════════════════════════════════════════════ */

describe('the referral is an introduction, and it admits nobody', () => {
  it('refuses without the four answers, by name', async () => {
    const seeded = await seedCreator('refuse');
    const result = await recordCreatorReferral(h.db, audit, {
      referrerProspectId: seeded.prospectId,
      actorId: `user:${seeded.userId}`,
      referredName: 'J. Park',
      referredContact: '',
      relationship: '',
      why: 'They cover exactly this.',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['referredContact', 'relationship']);
  });

  it('creates no account, prospect, association, or token', async () => {
    const seeded = await seedCreator('vouch');
    const before = {
      prospects: (await h.db.select().from(affiliateProspects)).length,
      associations: (await h.db.select().from(campaignAffiliateAssociations)).length,
      users: (await h.db.execute(sql`SELECT count(*)::int AS n FROM "user"`)).rows[0],
      tokens: (await h.db.execute(sql`SELECT count(*)::int AS n FROM secure_tokens`)).rows[0],
    };

    const cookie = await signInPlain(h, seeded.email);
    const response = await request(h.app)
      .post('/api/creator/referrals')
      .set('Cookie', cookie)
      .send({
        referredName: 'J. Park',
        referredContact: 'j@example.com',
        relationship: 'We ran a series together.',
        why: 'They cover exactly this audience.',
      });
    expect(response.status).toBe(200);
    expect(response.body.referrals).toHaveLength(1);

    expect({
      prospects: (await h.db.select().from(affiliateProspects)).length,
      associations: (await h.db.select().from(campaignAffiliateAssociations)).length,
      users: (await h.db.execute(sql`SELECT count(*)::int AS n FROM "user"`)).rows[0],
      tokens: (await h.db.execute(sql`SELECT count(*)::int AS n FROM secure_tokens`)).rows[0],
    }).toEqual(before);
  });

  it('reaches an Admin through the history, because no §27 key exists for it', async () => {
    const seeded = await seedCreator('audited');
    await recordCreatorReferral(h.db, audit, {
      referrerProspectId: seeded.prospectId,
      actorId: `user:${seeded.userId}`,
      referredName: 'A. Rivera',
      referredContact: 'a@example.com',
      relationship: 'A friend.',
      why: 'Good at this.',
    });

    const events = await h.db.execute(sql`
      SELECT action, target_id FROM audit_events WHERE action = 'affiliate.referral_recorded'
    `);
    expect(events.rows.length).toBeGreaterThan(0);
    // The target is the REFERRER: the referred person has no record to attach
    // anything to, and creating one would be the signup route this refuses.
    expect(events.rows.some((row) => row['target_id'] === seeded.prospectId)).toBe(true);

    // Nothing was sent. Inventing a §27 key would be inventing a message.
    const sent = await h.db.execute(sql`
      SELECT event_key FROM notification_deliveries WHERE event_key LIKE '%referral%'
    `);
    expect(sent.rows).toEqual([]);
  });

  it('takes the referrer from the session and never from the body', async () => {
    const mine = await seedCreator('mine');
    const other = await seedCreator('other');
    const cookie = await signInPlain(h, mine.email);

    await request(h.app)
      .post('/api/creator/referrals')
      .set('Cookie', cookie)
      .send({
        referrerProspectId: other.prospectId,
        referredName: 'Somebody',
        referredContact: 's@example.com',
        relationship: 'Known for years.',
        why: 'Right audience.',
      })
      .expect(200);

    const theirs = await readCreatorHome(h.db, other.userId);
    expect(theirs.referrals).toEqual([]);
    const ours = await readCreatorHome(h.db, mine.userId);
    expect(ours.referrals).toHaveLength(1);
  });
});

/* ══ The route boundary ═════════════════════════════════════════════════════ */

describe('Home is scoped by the session and carries no id', () => {
  it('refuses without a session', async () => {
    await request(h.app).get('/api/creator/home').expect(401);
  });

  it('refuses a Founder session', async () => {
    const founder = await seedUser(h, 'founder', 'home-founder');
    const cookie = await signInPlain(h, founder.email);
    const response = await request(h.app).get('/api/creator/home').set('Cookie', cookie);
    expect(response.status).toBe(403);
  });

  it('shows one Creator nothing of another', async () => {
    const a = await seedCreator('scopea');
    const b = await seedCreator('scopeb');
    const cookie = await signInPlain(h, a.email);
    const response = await request(h.app).get('/api/creator/home').set('Cookie', cookie);
    expect(JSON.stringify(response.body)).not.toContain(b.associationId);
    expect(JSON.stringify(response.body)).not.toContain(b.email);
  });
});
