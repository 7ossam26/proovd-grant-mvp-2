/**
 * First-cohort measurement — Spec §31.9, §33.12.6, §33.12.7 (Phase 23b).
 *
 * Two claims, and they pull in opposite directions, which is why they are one
 * suite. §33.12.6 says the baseline must be `not measured` until ten Founders
 * have been invited and that no invented one exists. §33.12.7 says the metrics
 * must come from defined events without hiding cancellations, support requests,
 * or failed payments. A product could satisfy the first by computing nothing and
 * the second by computing everything; what is proved here is both at once —
 * nothing is rendered early, and once it is rendered nothing has been dropped
 * to make it look better.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  COHORT_BASELINE_SIZE,
  FORBIDDEN_MEASUREMENT_TABLES,
  FOUNDER_SCOREBOARD,
  NOT_MEASURED_LABEL,
  NEVER_EXCLUDED_KEYS,
  SCOREBOARD_METRIC_KEYS,
  SECONDARY_METRICS,
  CORRECTION_KINDS_COUNTED as SHARED_CORRECTION_KINDS,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { readScoreboard } from '../measurement/service.js';
import {
  COHORT_BASELINE_SIZE as BACKEND_COHORT_SIZE,
  CORRECTION_KINDS_COUNTED as BACKEND_CORRECTION_KINDS,
  NOT_MEASURED_LABEL as BACKEND_LABEL,
  SCOREBOARD_METRIC_KEYS as BACKEND_METRIC_KEYS,
  NEVER_EXCLUDED_KEYS as BACKEND_NEVER_EXCLUDED,
} from '../measurement/logic.js';
import { campaigns } from '../db/schema/domain.js';
import {
  campaignDrafts,
  campaignInvitationSends,
  founderProspects,
} from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import { possibleCreatorResults } from '../db/schema/vetting.js';

let h: Harness;
let admin: AdminSession;

const gateway = createMemoryStripeGateway({ mode: 'test' });

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'measurement',
  );
  admin = await createAdmin(h, 'measurement-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Drift: the backend restates the shared register ───────────────────────── */

describe('register drift (backend restates shared)', () => {
  it('pins the cohort size, the label, the metric keys, and the correction kinds', () => {
    expect(BACKEND_COHORT_SIZE).toBe(COHORT_BASELINE_SIZE);
    expect(BACKEND_LABEL).toBe(NOT_MEASURED_LABEL);
    expect([...BACKEND_METRIC_KEYS]).toEqual([...SCOREBOARD_METRIC_KEYS]);
    expect([...BACKEND_CORRECTION_KINDS]).toEqual([...SHARED_CORRECTION_KINDS]);
    expect([...BACKEND_NEVER_EXCLUDED]).toEqual([...NEVER_EXCLUDED_KEYS]);
  });
});

/* ── §31.9 the absence of a warehouse ──────────────────────────────────────── */

describe('§31.9 — existing events, and no analytics warehouse', () => {
  it('created none of the tables a warehouse arrives as', async () => {
    const { rows } = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [[...FORBIDDEN_MEASUREMENT_TABLES]],
    );
    expect(rows).toEqual([]);
  });

  it('owns no table of its own and writes nothing', () => {
    // A read module that acquired a write would be the warehouse arriving one
    // column at a time. The scan is on the module rather than on the schema,
    // because the schema check above passes right up until somebody adds one.
    const dir = resolve(__dirname, '../measurement');
    const sources = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({
        name,
        source: readFileSync(join(dir, name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1'),
      }));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(file.source, `${file.name} inserts`).not.toMatch(/\.insert\(/);
      expect(file.source, `${file.name} updates`).not.toMatch(/\.update\(/);
      expect(file.source, `${file.name} deletes`).not.toMatch(/\.delete\(/);
    }
  });

  it('reads only tables that exist for a product reason', async () => {
    for (const metric of FOUNDER_SCOREBOARD) {
      for (const source of metric.sources) {
        const { rows } = await h.pool.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1`,
          [source.table],
        );
        expect(rows.length, `${metric.key} → ${source.table}`).toBe(1);
        if (source.column) {
          const { rows: columns } = await h.pool.query(
            `SELECT 1 FROM information_schema.columns
              WHERE table_name = $1 AND column_name = $2`,
            [source.table, source.column],
          );
          expect(columns.length, `${metric.key} → ${source.table}.${source.column}`).toBe(1);
        }
      }
    }
  });
});

/* ── §33.12.6 the baseline ─────────────────────────────────────────────────── */

describe('§33.12.6 — the baseline is `not measured` until ten Founders', () => {
  it('renders the label and no number on an empty system', async () => {
    const board = await readScoreboard(h.db);
    expect(board.notMeasuredLabel).toBe('not measured');
    expect(board.cohortSize).toBe(10);
    expect(board.invitedFounders).toBe(0);
    expect(board.baselineEstablished).toBe(false);

    for (const metric of board.metrics) {
      expect(metric.value.state, metric.key).toBe('not_measured');
      if (metric.value.state === 'not_measured') {
        expect(metric.value.reason, metric.key).toBe('cohort_incomplete');
      }
      // The whole of §33.12.6 in one assertion: there is no number anywhere in
      // the payload for a surface to start rendering.
      expect(JSON.stringify(metric.value)).not.toMatch(/"value":/);
    }
  });

  it('computes all four §31.9 metrics, in §31.9’s order', async () => {
    const board = await readScoreboard(h.db);
    expect(board.metrics.map((entry) => entry.key)).toEqual([...SCOREBOARD_METRIC_KEYS]);
  });

  /**
   * Ten invited Founders, each with a draft and an opened invitation.
   *
   * "Invited" means a send happened — a prospect row with no send is somebody
   * Admin is considering, and counting them would let the baseline be declared
   * complete by typing names into a table.
   */
  async function inviteFounders(count: number, opened: number): Promise<string[]> {
    const campaignIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const founder = await seedUser(h, 'founder', `cohort-${index}-${randomUUID().slice(0, 6)}`);
      const [prospect] = await h.db
        .insert(founderProspects)
        .values({
          legalName: `Cohort Founder ${index}`,
          preferredName: `C${index}`,
          email: founder.email,
          productName: `Thing ${index}`,
          createdBy: 'admin:test',
        })
        .returning({ id: founderProspects.id });

      const [campaign] = await h.db
        .insert(campaigns)
        .values({ status: 'invited_draft' })
        .returning({ id: campaigns.id });
      campaignIds.push(campaign!.id);

      const [draft] = await h.db
        .insert(campaignDrafts)
        .values({
          campaignId: campaign!.id,
          prospectId: prospect!.id,
          status: 'sent',
          createdBy: 'admin:test',
        })
        .returning({ id: campaignDrafts.id });

      const issued = await h.tokens.issue(
        { scope: 'founder_draft', campaignDraftId: draft!.id },
        { actorId: 'admin:test' },
      );

      await h.db.insert(campaignInvitationSends).values({
        draftId: draft!.id,
        tokenId: issued.record.id,
        tokenVersion: issued.record.version,
        recipientEmail: founder.email,
        recipientName: `Cohort Founder ${index}`,
        subject: 'An invitation',
        senderName: 'Proovd',
        senderEmail: 'hello@proovd.co',
        status: 'sent',
        sentBy: 'admin:test',
      });

      if (index < opened) {
        // Opening the invitation is what stamps `first_used_at` — the real
        // verification path, not a hand-written timestamp, so the metric is
        // reading the same fact production would produce.
        const verified = await h.tokens.verify(issued.raw, 'founder_draft');
        expect(verified.ok).toBe(true);
      }
    }
    return campaignIds;
  }

  it('turns a metric into a number only once the cohort is whole', async () => {
    const campaignIds = await inviteFounders(COHORT_BASELINE_SIZE, COHORT_BASELINE_SIZE);

    const board = await readScoreboard(h.db);
    expect(board.invitedFounders).toBeGreaterThanOrEqual(COHORT_BASELINE_SIZE);
    expect(board.baselineEstablished).toBe(true);

    const completion = board.metrics.find((entry) => entry.key === 'founder_completion')!.value;
    // Ten opened invitations, none of which reached a paid listing fee. That is
    // a real 0/10 — a measured zero, not a rendered absence — and the two are
    // different facts the payload keeps apart.
    expect(completion.state).toBe('measured');
    if (completion.state === 'measured' && completion.unit === 'rate') {
      expect(completion.denominator).toBe(COHORT_BASELINE_SIZE);
      expect(completion.numerator).toBe(0);
      expect(completion.value).toBe(0);
    }

    // Time to first magic still has nothing to observe: no possible-creator
    // result has been rendered to anybody. That is `no_observations`, not zero
    // hours, and not `cohort_incomplete` either.
    const magic = board.metrics.find((entry) => entry.key === 'time_to_first_magic')!.value;
    expect(magic.state).toBe('not_measured');
    if (magic.state === 'not_measured') expect(magic.reason).toBe('no_observations');

    expect(campaignIds.length).toBe(COHORT_BASELINE_SIZE);
  }, 180_000);

  it('measures time to first magic from the first open to the first rendering', async () => {
    // Both halves are stamped by the paths that cause them: the token
    // verification and the Founder-facing read. Nothing here writes a
    // timestamp by hand, because a metric proved against hand-written data
    // proves the arithmetic and not the wiring.
    const [campaign] = await h.db
      .insert(campaigns)
      .values({ status: 'invited_draft' })
      .returning({ id: campaigns.id });

    await h.db.insert(possibleCreatorResults).values({
      campaignId: campaign!.id,
      count: 12,
      basis: 'Shortlist reviewed by hand.',
      recordedBy: 'admin:test',
    });

    const [prospect] = await h.db
      .insert(founderProspects)
      .values({
        legalName: 'Magic Founder',
        preferredName: 'Magic',
        email: `magic-${randomUUID().slice(0, 6)}@example.com`,
        productName: 'A thing',
        createdBy: 'admin:test',
      })
      .returning({ id: founderProspects.id });

    const [draft] = await h.db
      .insert(campaignDrafts)
      .values({
        campaignId: campaign!.id,
        prospectId: prospect!.id,
        status: 'sent',
        createdBy: 'admin:test',
      })
      .returning({ id: campaignDrafts.id });

    const issued = await h.tokens.issue(
      { scope: 'founder_draft', campaignDraftId: draft!.id },
      { actorId: 'admin:test' },
    );

    // The real verification path stamps `first_used_at`, so the metric reads
    // the same fact production produces rather than a hand-written timestamp.
    const verified = await h.tokens.verify(issued.raw, 'founder_draft');
    expect(verified.ok).toBe(true);

    // The Founder-facing read is what stamps the rendering. Driving it through
    // the service rather than the route keeps this test about the metric.
    const { readPossibleCreatorSignal } = await import('../vetting/service.js');
    await readPossibleCreatorSignal(h.db, campaign!.id, { stampRendered: true });

    const [token] = await h.db
      .select({ first: secureTokens.firstUsedAt, last: secureTokens.lastUsedAt })
      .from(secureTokens)
      .where(eq(secureTokens.id, issued.record.id));
    const [result] = await h.db
      .select({ rendered: possibleCreatorResults.firstRenderedAt })
      .from(possibleCreatorResults)
      .where(eq(possibleCreatorResults.campaignId, campaign!.id));

    expect(token!.first).not.toBeNull();
    expect(result!.rendered).not.toBeNull();

    const board = await readScoreboard(h.db);
    const magic = board.metrics.find((entry) => entry.key === 'time_to_first_magic')!.value;
    expect(magic.state).toBe('measured');
    if (magic.state === 'measured' && magic.unit === 'median_hours') {
      expect(magic.observations).toBeGreaterThan(0);
      expect(magic.value).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it('never moves a first stamp once it is set', async () => {
    // `first_used_at` beside `last_used_at` is the whole reason 0037 exists: a
    // first that a later visit can shift is a last with a misleading name, and
    // the metric computed from it would drift toward zero as people came back.
    const [campaign] = await h.db
      .insert(campaigns)
      .values({ status: 'invited_draft' })
      .returning({ id: campaigns.id });
    const [prospect] = await h.db
      .insert(founderProspects)
      .values({
        legalName: 'Returning Founder',
        preferredName: 'Ret',
        email: `ret-${randomUUID().slice(0, 6)}@example.com`,
        productName: 'A thing',
        createdBy: 'admin:test',
      })
      .returning({ id: founderProspects.id });
    const [draft] = await h.db
      .insert(campaignDrafts)
      .values({
        campaignId: campaign!.id,
        prospectId: prospect!.id,
        status: 'sent',
        createdBy: 'admin:test',
      })
      .returning({ id: campaignDrafts.id });
    const issued = await h.tokens.issue(
      { scope: 'founder_draft', campaignDraftId: draft!.id },
      { actorId: 'admin:test' },
    );

    await h.tokens.verify(issued.raw, 'founder_draft');
    const [afterFirst] = await h.db
      .select({ first: secureTokens.firstUsedAt, last: secureTokens.lastUsedAt })
      .from(secureTokens)
      .where(eq(secureTokens.id, issued.record.id));

    await new Promise((resolve) => setTimeout(resolve, 25));
    await h.tokens.verify(issued.raw, 'founder_draft');
    const [afterSecond] = await h.db
      .select({ first: secureTokens.firstUsedAt, last: secureTokens.lastUsedAt })
      .from(secureTokens)
      .where(eq(secureTokens.id, issued.record.id));

    expect(afterSecond!.first!.getTime()).toBe(afterFirst!.first!.getTime());
    expect(afterSecond!.last!.getTime()).toBeGreaterThan(afterFirst!.last!.getTime());
  });

  it('refuses a hand-written move of any of the three stamps, at the database', async () => {
    const [campaign] = await h.db
      .insert(campaigns)
      .values({ status: 'invited_draft' })
      .returning({ id: campaigns.id });
    const [row] = await h.db
      .insert(possibleCreatorResults)
      .values({
        campaignId: campaign!.id,
        count: 3,
        basis: 'x',
        recordedBy: 'admin:test',
        firstRenderedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: possibleCreatorResults.id });

    await expect(
      h.pool.query(`UPDATE possible_creator_results SET first_rendered_at = now() WHERE id = $1`, [
        row!.id,
      ]),
    ).rejects.toThrow();
  });
});

/* ── §33.12.7 what a metric may not hide ───────────────────────────────────── */

describe('§33.12.7 — cohort metrics hide no cancellation, support request, or failure', () => {
  it('makes every scoreboard metric declare it keeps all three in', () => {
    for (const metric of FOUNDER_SCOREBOARD) {
      expect([...metric.neverExcludes].sort(), metric.key).toEqual([...NEVER_EXCLUDED_KEYS].sort());
    }
  });

  it('filters no status out of the completion denominator', () => {
    // The temptation is real and specific: dropping the Founders who canceled
    // inside the §31.6 window raises `founder_completion` immediately. So the
    // query has no status filter at all, and this is the scan that says so.
    const source = readFileSync(resolve(__dirname, '../measurement/service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const excluded of [
      'campaign_cancellations',
      'cancelled',
      "'canceled'",
      'support_cases.status',
      'capture_failed',
      'threshold_not_met',
    ]) {
      expect(source, excluded).not.toContain(excluded);
    }
  });

  it('counts support, cancellation, and failure rather than removing them', async () => {
    const board = await readScoreboard(h.db);
    const keys = board.secondary.map((entry) => entry.key);
    // §31.9's secondary set is where these live, and they are counted as their
    // own facts — the opposite of the exclusion §33.12.7 forbids.
    expect(keys).toContain('support_free_cancellation');
    expect(keys).toContain('support_sla_misses');
    expect(keys).toContain('reservation_failure_step');
    expect(keys).toContain('payment_recovery');
    expect(keys).toContain('unknown_charge_contacts_and_disputes');
  });

  it('reports a secondary metric with no input as absent rather than as zero', async () => {
    const board = await readScoreboard(h.db);
    const autosave = board.secondary.find((entry) => entry.key === 'autosave_failures')!;
    expect(autosave.count).toBeNull();
    expect(autosave.absentBecause).toContain('warehouse');

    const reminder = board.secondary.find(
      (entry) => entry.key === 'reminder_delivery_and_cancel',
    )!;
    // Partially present: delivery is recorded, the open is not, and the entry
    // says which half is missing rather than reporting the metric as available.
    expect(reminder.count).not.toBeNull();
    expect(reminder.absentBecause).toContain('pixel');
  });

  it('covers every entry §31.9’s "also track" list names', async () => {
    const board = await readScoreboard(h.db);
    const keys = new Set(board.secondary.map((entry) => entry.key));
    for (const metric of SECONDARY_METRICS) {
      expect(keys, metric.key).toContain(metric.key);
    }
  });
});

/* ── The Admin surface ─────────────────────────────────────────────────────── */

describe('the scoreboard route', () => {
  it('serves the board to an Admin and to nobody else', async () => {
    const ok = await request(h.app).get('/api/admin/measurement').set('cookie', admin.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.notMeasuredLabel).toBe('not measured');
    expect(ok.body.metrics).toHaveLength(4);

    const anonymous = await request(h.app).get('/api/admin/measurement');
    expect(anonymous.status).toBe(401);
  });

  it('has no write route, so there is nowhere to record a baseline', async () => {
    // §33.12.6's "no invented baseline exists" is strongest as an absence: not
    // a rule the service enforces, but a route that does not exist.
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const agent = request(h.app) as unknown as Record<string, (u: string) => request.Test>;
      const res = await agent[method]!('/api/admin/measurement')
        .set('cookie', admin.cookie)
        .send({ value: 1 });
      expect(res.status, method).toBe(404);
    }
  });
});
