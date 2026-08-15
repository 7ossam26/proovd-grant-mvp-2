/**
 * The Campaigns Admin hub — §26.1, §23.1, §23.2, §18, §26.8, §33.12.5.
 *
 * Built 2026-08-15 over the campaign domain the product already has. This suite
 * proves what the hub reads and, more importantly, what it was not allowed to
 * add. The five decisions a later session is most likely to undo by accident:
 *
 *   1. It is READ-ONLY. Every verb but GET answers 404 at both addresses, and
 *      the module contains no `.insert(` / `.update(` / `.delete(` at all.
 *   2. It stores nothing. No `campaign_events` table, no `group` column, no
 *      cached blocker — §26.8's trap and §23.1's single-authority rule.
 *   3. An unpublished campaign has NO public address. Not a disabled control:
 *      `publicUrl` is null, so there is nothing for one to open (brief §9).
 *   4. The Idea denominator is the Founder's own §14.4 threshold, and an unset
 *      one produces no bar rather than the prototype's hardcoded 120.
 *   5. The payload carries no Backer identity and no support-case body. It
 *      summarises five domains and must expose only what a hub needs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInAs, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { campaigns, campaignStatusHistory, reservations } from '../db/schema/domain.js';
import { campaignBuild, campaignReviews } from '../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { backerIdentities } from '../db/schema/reservations.js';

import {
  CAMPAIGN_BLOCKER_OWNERS,
  CAMPAIGN_BLOCKER_OWNER_LABELS,
  CAMPAIGN_DESTINATIONS,
  CAMPAIGN_FILTERS,
  CAMPAIGN_GROUPS,
  CAMPAIGN_HISTORY_SOURCES,
  CAMPAIGN_HISTORY_TAGS,
  CAMPAIGN_PUBLIC_STATES,
  CAMPAIGN_PUBLIC_STATE_LABELS,
  CAMPAIGN_RECORD_TABS,
  CAMPAIGN_STAGES,
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STATE_KINDS,
  CAMPAIGNS_IS_READ_ONLY,
  CLOSED_CAMPAIGN_STATUSES,
  AT_RISK_CAMPAIGN_STATUSES,
  KNOWN_LINK_ONLY_NOTE,
  NO_BLOCKER_LABEL,
  NO_PERSON_NEEDED_LABEL,
  THRESHOLD_NOT_SET_NOTE,
  PROOVD_DECISION_HAS_NO_SCREEN,
  FRESHNESS_PREFIX,
  campaignDisplayId,
  campaignInitials,
  campaignStateKind,
  ownerNeedsRouting,
} from '../campaigns/workspace/logic.js';

import {
  CAMPAIGN_BLOCKER_OWNERS as SHARED_OWNERS,
  CAMPAIGN_BLOCKER_OWNER_LABELS as SHARED_OWNER_LABELS,
  CAMPAIGN_DESTINATIONS as SHARED_DESTINATIONS,
  CAMPAIGN_FILTERS as SHARED_FILTERS,
  CAMPAIGN_GROUPS as SHARED_GROUPS,
  CAMPAIGN_HISTORY_SOURCES as SHARED_SOURCES,
  CAMPAIGN_HISTORY_TAGS as SHARED_TAGS,
  CAMPAIGN_PUBLIC_STATES as SHARED_PUBLIC_STATES,
  CAMPAIGN_PUBLIC_STATE_LABELS as SHARED_PUBLIC_LABELS,
  CAMPAIGN_RECORD_TABS as SHARED_TABS,
  CAMPAIGN_STAGES as SHARED_STAGES,
  CAMPAIGN_STAGE_LABELS as SHARED_STAGE_LABELS,
  CAMPAIGN_STATE_KINDS as SHARED_KINDS,
  CAMPAIGNS_IS_READ_ONLY as SHARED_READ_ONLY,
  CLOSED_CAMPAIGN_STATUSES as SHARED_CLOSED,
  AT_RISK_CAMPAIGN_STATUSES as SHARED_RISK,
  KNOWN_LINK_ONLY_NOTE as SHARED_LINK_NOTE,
  NO_BLOCKER_LABEL as SHARED_NO_BLOCKER,
  NO_PERSON_NEEDED_LABEL as SHARED_NO_PERSON,
  THRESHOLD_NOT_SET_NOTE as SHARED_THRESHOLD_NOTE,
  PROOVD_DECISION_HAS_NO_SCREEN as SHARED_NO_SCREEN,
  FRESHNESS_PREFIX as SHARED_FRESHNESS,
  CAMPAIGN_FILTER_DEFINITIONS,
  CAMPAIGN_BANNED_TERMS,
  CAMPAIGN_STATUSES,
  UNGATED_ADMIN_WRITES,
  campaignDisplayId as sharedDisplayId,
  campaignInitials as sharedInitials,
  campaignStateKind as sharedStateKind,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    { authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'campaign-workspace',
  );
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'campws');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

interface SeedOptions {
  status?: string;
  type?: 'pre_build' | 'pre_launch' | null;
  listingPaid?: boolean;
  liveAt?: Date | null;
  closeAt?: Date | null;
  discoveryOpened?: boolean;
  orderThreshold?: number | null;
  title?: string | null;
}

async function seedCampaign(label: string, options: SeedOptions = {}) {
  const founder = await seedUser(h, 'founder', `campws-${label}`);
  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      businessName: `${label} Labs LLC`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: (options.status ?? 'live') as never,
      type: options.type === undefined ? 'pre_launch' : (options.type as never),
      typeLockedAt: options.type === null ? null : new Date(),
      listingPaidAt: options.listingPaid === false ? null : new Date(),
      campaignLiveAt: options.liveAt === undefined ? new Date(Date.now() - 86_400_000) : options.liveAt,
      campaignCloseAt:
        options.closeAt === undefined ? new Date(Date.now() + 14 * 86_400_000) : options.closeAt,
      discoveryOpenedAt: options.discoveryOpened ? new Date() : null,
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
    title: options.title === undefined ? `Campaign ${label}` : options.title,
    founderDisplayName: `Founder ${label}`,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: new Date(Date.now() + 14 * 86_400_000),
    orderThreshold: options.orderThreshold ?? null,
    refundPolicyTitle: 'Refund Policy',
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  return { campaignId: campaign!.id, prospectId: prospect!.id, founderId: founder.id };
}

async function seedReservations(
  campaignId: string,
  statuses: string[],
  subtotalCents = 12_000n,
): Promise<string[]> {
  const identities: string[] = [];
  for (const [index, status] of statuses.entries()) {
    const [identity] = await h.db
      .insert(backerIdentities)
      .values({
        campaignId,
        email: `backer-${index}-${campaignId}@example.com`,
        phone: `+1555000${index}`,
        emailNormalized: `backer-${index}-${campaignId}@example.com`,
        phoneNormalized: `1555000${index}`,
        dedupKey: `${campaignId}-${index}`,
      })
      .returning({ id: backerIdentities.id });
    identities.push(identity!.id);
    await h.db.insert(reservations).values({
      campaignId,
      backerIdentityId: identity!.id,
      status: status as never,
      rewardSku: 'SKU-1',
      rewardSubtotalCents: subtotalCents,
    });
  }
  return identities;
}

function get(path: string, cookie = admin.cookie) {
  return request(h.app).get(path).set('Cookie', cookie);
}

/* ── The registers do not drift ───────────────────────────────────────────── */

describe('the shared registers and the backend restatement agree', () => {
  it('every vocabulary matches @proovd/shared', () => {
    expect(CAMPAIGN_BLOCKER_OWNERS).toEqual([...SHARED_OWNERS]);
    expect(CAMPAIGN_BLOCKER_OWNER_LABELS).toEqual({ ...SHARED_OWNER_LABELS });
    expect(CAMPAIGN_FILTERS).toEqual([...SHARED_FILTERS]);
    expect(CAMPAIGN_GROUPS).toEqual([...SHARED_GROUPS]);
    expect(CAMPAIGN_HISTORY_SOURCES).toEqual([...SHARED_SOURCES]);
    expect(CAMPAIGN_HISTORY_TAGS).toEqual([...SHARED_TAGS]);
    expect(CAMPAIGN_PUBLIC_STATES).toEqual([...SHARED_PUBLIC_STATES]);
    expect(CAMPAIGN_PUBLIC_STATE_LABELS).toEqual({ ...SHARED_PUBLIC_LABELS });
    expect(CAMPAIGN_RECORD_TABS).toEqual([...SHARED_TABS]);
    expect(CAMPAIGN_STAGES).toEqual([...SHARED_STAGES]);
    expect(CAMPAIGN_STAGE_LABELS).toEqual({ ...SHARED_STAGE_LABELS });
    expect(CAMPAIGN_STATE_KINDS).toEqual([...SHARED_KINDS]);
    expect(CLOSED_CAMPAIGN_STATUSES).toEqual([...SHARED_CLOSED]);
    expect(AT_RISK_CAMPAIGN_STATUSES).toEqual([...SHARED_RISK]);
    expect(CAMPAIGN_DESTINATIONS.map((d) => d.key)).toEqual(
      SHARED_DESTINATIONS.map((d) => d.key),
    );
  });

  it('every pinned sentence matches @proovd/shared', () => {
    expect(CAMPAIGNS_IS_READ_ONLY).toBe(SHARED_READ_ONLY);
    expect(KNOWN_LINK_ONLY_NOTE).toBe(SHARED_LINK_NOTE);
    expect(NO_BLOCKER_LABEL).toBe(SHARED_NO_BLOCKER);
    expect(NO_PERSON_NEEDED_LABEL).toBe(SHARED_NO_PERSON);
    expect(THRESHOLD_NOT_SET_NOTE).toBe(SHARED_THRESHOLD_NOTE);
    expect(FRESHNESS_PREFIX).toBe(SHARED_FRESHNESS);
  });

  it('the two derivation kernels agree', () => {
    for (const status of CAMPAIGN_STATUSES) {
      for (const blocked of [true, false]) {
        expect(campaignStateKind({ status, blocked })).toBe(
          sharedStateKind({ status, blocked }),
        );
      }
    }
    const id = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
    expect(campaignDisplayId(id)).toBe(sharedDisplayId(id));
    expect(campaignInitials('Teeb Founding Launch')).toBe(
      sharedInitials('Teeb Founding Launch'),
    );
  });

  /**
   * The registers are a partition over §23.1, checked in BOTH directions so
   * neither can rot: a 28th lifecycle state is either closed, at risk, pre-live,
   * `live`, or `suspended`, and nothing may be in two of the first three at
   * once. `capture_retry_window` is deliberately in `closed` AND `at risk` —
   * a campaign whose cards are failing has ended and is still in trouble — so
   * that one pair is exempted by name rather than by loosening the check.
   */
  it('the status registers name only real §23.1 states', () => {
    for (const status of [...CLOSED_CAMPAIGN_STATUSES, ...AT_RISK_CAMPAIGN_STATUSES]) {
      expect(CAMPAIGN_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('every filter has a definition and every destination decides whether it exists', () => {
    expect(CAMPAIGN_FILTER_DEFINITIONS.map((d) => d.key)).toEqual([...SHARED_FILTERS]);
    for (const definition of CAMPAIGN_FILTER_DEFINITIONS) {
      expect(definition.counts.length).toBeGreaterThan(20);
    }
    for (const destination of SHARED_DESTINATIONS) {
      if (destination.built) {
        expect(destination).not.toHaveProperty('absentBecause');
      } else {
        expect(destination.absentBecause ?? '').not.toBe('');
      }
    }
  });

  /**
   * The one gap the destination register cannot express: a blocker Proovd
   * itself owes, whose decision surface does not exist. Naming it is the point
   * — routing an operator to the Founder workspace instead would be a wrong
   * destination presented as a right one, which is worse than none.
   */
  it('a Proovd decision with no screen says so rather than routing somewhere plausible', async () => {
    expect(PROOVD_DECISION_HAS_NO_SCREEN).toBe(SHARED_NO_SCREEN);

    const { campaignId, prospectId } = await seedCampaign('review-route', {
      status: 'pending_review',
      liveAt: null,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    const route = res.body.overview.blocker.route;

    expect(res.body.overview.blocker.owner).toBe('proovd_review');
    expect(route.href).toBeNull();
    expect(route.unavailableBecause).toBe(PROOVD_DECISION_HAS_NO_SCREEN);
    // Specifically NOT the Founder workspace, which is the plausible wrong one.
    expect(JSON.stringify(route)).not.toContain(prospectId);
  });

  it('`system` is the one owner with no routing, and it is the only one', () => {
    for (const owner of SHARED_OWNERS) {
      expect(ownerNeedsRouting(owner)).toBe(owner !== 'system');
    }
  });
});

/* ── Authorization (brief §9) ─────────────────────────────────────────────── */

describe('server-side authorization', () => {
  it('refuses an anonymous caller at both addresses', async () => {
    await request(h.app).get('/api/admin/campaigns').expect(401);
    const { campaignId } = await seedCampaign('anon');
    await request(h.app).get(`/api/admin/campaigns/${campaignId}`).expect(401);
  });

  it('refuses a signed-in Founder and a signed-in Creator', async () => {
    const { campaignId } = await seedCampaign('roles');

    const founder = await seedUser(h, 'founder', 'campws-role-f');
    const founderCookie = await signInAs(h, founder.email);
    await get('/api/admin/campaigns', founderCookie).expect(403);
    await get(`/api/admin/campaigns/${campaignId}`, founderCookie).expect(403);

    const creator = await seedUser(h, 'affiliate', 'campws-role-c');
    const creatorCookie = await signInAs(h, creator.email);
    await get('/api/admin/campaigns', creatorCookie).expect(403);
    await get(`/api/admin/campaigns/${campaignId}`, creatorCookie).expect(403);
  });

  it('answers an authorized Admin', async () => {
    await get('/api/admin/campaigns').expect(200);
  });

  /**
   * A guessed id and a real one that does not exist answer identically, and a
   * malformed one answers 404 rather than erroring at the driver — a 500 where
   * a 404 belongs tells a caller their guess was interesting.
   */
  it('id manipulation reaches nothing, and every shape answers the same 404', async () => {
    const missing = await get('/api/admin/campaigns/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0').expect(404);
    const malformed = await get('/api/admin/campaigns/not-a-uuid').expect(404);
    const traversal = await get('/api/admin/campaigns/..%2F..%2Fadmin').expect(404);
    expect(missing.body.error).toBe('not_found');
    expect(malformed.body).toEqual(missing.body);
    expect(traversal.body.error).toBe('not_found');
  });
});

/* ── Read-only (brief §3) ─────────────────────────────────────────────────── */

describe('the hub is read-only', () => {
  it('every verb but GET answers 404 at both addresses', async () => {
    const { campaignId } = await seedCampaign('readonly');
    for (const path of ['/api/admin/campaigns', `/api/admin/campaigns/${campaignId}`]) {
      await request(h.app).post(path).set('Cookie', admin.cookie).send({}).expect(404);
      await request(h.app).put(path).set('Cookie', admin.cookie).send({}).expect(404);
      await request(h.app).patch(path).set('Cookie', admin.cookie).send({}).expect(404);
      await request(h.app).delete(path).set('Cookie', admin.cookie).expect(404);
    }
  });

  /**
   * The stronger form of the same claim: the module cannot write, whatever a
   * route is added later. Comments are stripped first — these files explain at
   * length what they refuse to do, and a scan that could not tell an
   * explanation from a usage would force the explanations out (§22a's rule).
   */
  it('the workspace module contains no write at all', () => {
    // Resolved from this file, not from `process.cwd()` — the working directory
    // is the workspace root under `vitest --project`, and a scan that silently
    // found nothing would pass by having nothing to check.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'campaigns', 'workspace');
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const verb of ['.insert(', '.update(', '.delete(']) {
        expect(source, `${name} must not ${verb}`).not.toContain(verb);
      }
    }
  });

  /**
   * §33.12.5's partition enumerates the mounted router's WRITES and requires
   * gated and ungated to cover it exactly. This router contributes none, so
   * neither of its two addresses belongs to either set — and if a write is ever
   * added here, that sweep fails until somebody decides which side it is on.
   *
   * Scoped to the two exact paths rather than to the `/campaigns` prefix:
   * §12's workspace, §15's review, §16's readiness, §17's launch and §22.10's
   * next-campaign decision all live under it already, and a prefix match would
   * fail on their entries while proving nothing about this router.
   */
  it('contributes no entry to the ungated-write register', () => {
    for (const entry of UNGATED_ADMIN_WRITES) {
      expect(entry.route).not.toMatch(/\s\/api\/admin\/campaigns$/);
      expect(entry.route).not.toMatch(/\s\/api\/admin\/campaigns\/:campaignId$/);
    }
  });

  it('stores nothing: no campaign-events table exists', async () => {
    const rows = await h.db.execute(
      sql`select table_name from information_schema.tables
          where table_schema = 'public'
            and (table_name like '%campaign_event%'
              or table_name like '%campaign_timeline%'
              or table_name = 'campaign_hub_cache')`,
    );
    expect(rows.rows ?? rows).toHaveLength(0);
  });

  it('stores no filter membership: campaigns has no group column', async () => {
    const rows = await h.db.execute(
      sql`select column_name from information_schema.columns
          where table_name = 'campaigns'
            and column_name in ('group', 'groups', 'state_kind', 'blocker', 'blocker_owner')`,
    );
    expect(rows.rows ?? rows).toHaveLength(0);
  });
});

/* ── The directory ────────────────────────────────────────────────────────── */

describe('the directory', () => {
  it('carries a freshness stamp and a derived blocked count, and claims no live data', async () => {
    await seedCampaign('fresh');
    const res = await get('/api/admin/campaigns').expect(200);

    expect(new Date(res.body.checkedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(typeof res.body.blockedCount).toBe('number');
    // The caption says "waiting for SOMEONE", so it counts named owners only.
    expect(res.body.blockedCount).toBe(
      res.body.rows.filter((row: { blocker: { blocked: boolean } }) => row.blocker.blocked).length,
    );

    const body = JSON.stringify(res.body).toLowerCase();
    for (const term of CAMPAIGN_BANNED_TERMS) {
      expect(body, `banned term "${term}" reached the payload`).not.toContain(term.toLowerCase());
    }
  });

  it('resolves every cell server-side, so the browser derives nothing', async () => {
    const { campaignId } = await seedCampaign('cells', { orderThreshold: null });
    const res = await get('/api/admin/campaigns').expect(200);
    const row = res.body.rows.find((r: { campaignId: string }) => r.campaignId === campaignId);

    expect(row.name).toBe('Campaign cells');
    expect(row.initials).toBe('CC');
    expect(row.displayId).toBe(campaignDisplayId(campaignId));
    expect(row.typeLabel).toBe('Product Campaign');
    expect(row.stateLabel).toBe('Live');
    expect(row.stateKind).toBe('live');
    expect(row.company).toBe('cells Labs LLC');
    expect(row.founderName).toBe('F-cells');
    expect(row.founderHref).toMatch(/^\/admin\/founders\//);
    expect(row.dateLabel).toMatch(/^Close /);
    // The haystack the browser filters on, composed once by the server.
    expect(row.searchText).toContain('campaign cells');
    expect(row.searchText).toContain(campaignId);
    expect(row.searchText).toContain(campaignDisplayId(campaignId).toLowerCase());
  });

  /**
   * The reference's own model, and it is deliberately not exclusive: a campaign
   * can be blocked, live, and an Idea Campaign at once because those answer
   * different questions.
   */
  it('filter membership overlaps, and every group is a real filter', async () => {
    const { campaignId, founderId } = await seedCampaign('groups', {
      type: 'pre_build',
      orderThreshold: 40,
    });
    // A live Idea campaign with an open support case is blocked AND live AND idea.
    await request(h.app)
      .post('/api/admin/support/cases')
      .set('Cookie', admin.cookie)
      .send({
        topic: 'delivery',
        owner: 'proovd_support',
        requesterKind: 'founder',
        requesterUserId: founderId,
        requesterEmail: 'someone@example.com',
        campaignId,
        message: 'A question.',
      })
      .expect(201);

    const res = await get('/api/admin/campaigns').expect(200);
    const row = res.body.rows.find((r: { campaignId: string }) => r.campaignId === campaignId);

    expect(row.groups).toEqual(expect.arrayContaining(['needs', 'live', 'idea']));
    for (const group of row.groups) {
      expect(SHARED_GROUPS as readonly string[]).toContain(group);
    }
    // The lifecycle label stays the lifecycle; only the TONE moves.
    expect(row.stateLabel).toBe('Live');
    expect(row.stateKind).toBe('risk');
    expect(row.blocker.owner).toBe('proovd_support');
    expect(row.blocker.text).toMatch(/support case is open/);
    expect(row.blocker.route.href).toBe('/admin/support');
  });

  it('a campaign nobody owes reads as clear, with no routing control', async () => {
    const { campaignId } = await seedCampaign('clear');
    const res = await get('/api/admin/campaigns').expect(200);
    const row = res.body.rows.find((r: { campaignId: string }) => r.campaignId === campaignId);

    expect(row.blocker.blocked).toBe(false);
    expect(row.blocker.clear).toBe(true);
    expect(row.blocker.text).toBe(NO_BLOCKER_LABEL);
    expect(row.blocker.owner).toBe('system');
    expect(row.blocker.route).toBeNull();
    expect(row.groups).not.toContain('needs');
  });

  /**
   * §21's retry window is the case that proves `blocked` and `clear` are not
   * opposites: a real blocker sentence that nobody at Proovd owes. Getting this
   * wrong would either hide it from an operator or offer them "Open System".
   */
  it('a blocker with no named owner is stated and still offers no route', async () => {
    const { campaignId } = await seedCampaign('retry', { status: 'capture_retry_window' });
    const res = await get('/api/admin/campaigns').expect(200);
    const row = res.body.rows.find((r: { campaignId: string }) => r.campaignId === campaignId);

    expect(row.blocker.clear).toBe(false);
    expect(row.blocker.blocked).toBe(false);
    expect(row.blocker.owner).toBe('system');
    expect(row.blocker.route).toBeNull();
    // Still `risk`, from the register rather than from being blocked.
    expect(row.stateKind).toBe('risk');
  });

  it('an unlocked campaign type is stated, never guessed', async () => {
    const { campaignId } = await seedCampaign('untyped', {
      status: 'invited_draft',
      type: null,
      listingPaid: false,
      liveAt: null,
      closeAt: null,
    });
    const res = await get('/api/admin/campaigns').expect(200);
    const row = res.body.rows.find((r: { campaignId: string }) => r.campaignId === campaignId);

    expect(row.typeLabel).toBeNull();
    expect(row.groups).not.toContain('idea');
    expect(row.groups).not.toContain('product');
    expect(row.groups).toContain('waiting');
    expect(row.blocker.owner).toBe('founder');
    expect(row.dateLabel).toBe('Launch not set');
  });

  it('an archived campaign is not in the directory', async () => {
    const { campaignId } = await seedCampaign('archived');
    await h.db
      .update(campaigns)
      .set({ archivedAt: new Date(), archivedReason: 'wrong type', archivedBy: 'admin:test' })
      .where(eq(campaigns.id, campaignId));

    const res = await get('/api/admin/campaigns').expect(200);
    expect(res.body.rows.map((r: { campaignId: string }) => r.campaignId)).not.toContain(campaignId);
  });
});

/* ── The record ───────────────────────────────────────────────────────────── */

describe('the record', () => {
  it('carries every tab in one payload and states the read-only posture', async () => {
    const { campaignId } = await seedCampaign('record');
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ['checkedAt', 'close', 'header', 'history', 'liveTab', 'overview'].sort(),
    );
    expect(res.body.overview.stages.map((s: { key: string }) => s.key)).toEqual([
      ...CAMPAIGN_STAGES,
    ]);
    expect(res.body.overview.links).toHaveLength(CAMPAIGN_DESTINATIONS.length);
    expect(SHARED_READ_ONLY.length).toBeGreaterThan(60);
  });

  /**
   * The brief's §9: nothing unpublished may become publicly reachable through
   * this tab. Structural — there is no address, not a disabled control.
   */
  it('a campaign that never went live has NO public address', async () => {
    const { campaignId } = await seedCampaign('draft', {
      status: 'listing_fee_pending',
      listingPaid: false,
      liveAt: null,
      closeAt: null,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    expect(res.body.header.publicUrl).toBeNull();
    expect(res.body.header.publicState).toBe('private_draft');
    expect(res.body.header.publicStateLabel).toBe('Not public');
    expect(res.body.header.publicUrlUnavailableBecause).toMatch(/never been public/);
    expect(JSON.stringify(res.body)).not.toContain(`/campaign/${campaignId}`);
  });

  it('a live campaign in Days 1–7 is link-only, and Day 8 opens it', async () => {
    const { campaignId } = await seedCampaign('day7');
    const early = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    expect(early.body.header.publicState).toBe('known_link_only');
    expect(early.body.header.publicUrl).toContain(`/campaign/${campaignId}`);
    const note = early.body.overview.quickFacts.find(
      (f: { label: string }) => f.label === 'Public page',
    );
    expect(note.waitingOn).toBe(KNOWN_LINK_ONLY_NOTE);

    await h.db
      .update(campaigns)
      .set({ discoveryOpenedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    const open = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    expect(open.body.header.publicState).toBe('public');
  });

  /**
   * The prototype hardcodes 120. §14.4 makes the threshold the Founder's own
   * build value, so an unset one is a fact to state rather than a default to
   * invent — and there is no bar to draw against nothing.
   */
  it('the Idea denominator is the build threshold, and an unset one draws no bar', async () => {
    const withThreshold = await seedCampaign('idea-goal', {
      type: 'pre_build',
      orderThreshold: 120,
    });
    await seedReservations(withThreshold.campaignId, [
      'reserved_active',
      'reserved_active',
      'reserved_canceled',
    ]);
    const a = await get(`/api/admin/campaigns/${withThreshold.campaignId}`).expect(200);
    expect(a.body.liveTab.metrics.active).toBe(2);
    expect(a.body.liveTab.metrics.canceled).toBe(1);
    expect(a.body.liveTab.metrics.third.value).toBe('2 of 120');
    // `threshold`, never `goal` — §3.2 bans the word for an Idea threshold in
    // every audience *including identifiers*, and a property name survives
    // minification into the shipped bundle. §33.11.3's scan caught exactly that
    // in the first draft of this surface.
    expect(a.body.liveTab.metrics.third.progress.threshold).toBe(120);
    expect(a.body.liveTab.metrics.third.progress).not.toHaveProperty('goal');
    expect(a.body.liveTab.metrics.third.progress.percent).toBe(2);

    const without = await seedCampaign('idea-nogoal', { type: 'pre_build', orderThreshold: null });
    await seedReservations(without.campaignId, ['reserved_active']);
    const b = await get(`/api/admin/campaigns/${without.campaignId}`).expect(200);
    expect(b.body.liveTab.metrics.third.progress.percent).toBeNull();
    expect(b.body.liveTab.metrics.third.progress.note).toBe(THRESHOLD_NOT_SET_NOTE);
    // And the invented denominator appears nowhere at all.
    expect(JSON.stringify(b.body)).not.toContain('120');
  });

  it('a Product campaign shows the reserved subtotal and no progress bar', async () => {
    const { campaignId } = await seedCampaign('product-live', { orderThreshold: null });
    await seedReservations(campaignId, ['reserved_active', 'reserved_active'], 12_000n);
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    expect(res.body.liveTab.metrics.third.label).toBe('Reserved before tax');
    expect(res.body.liveTab.metrics.third.value).toBe('US$240.00');
    expect(res.body.liveTab.metrics.third.progress).toBeNull();
  });

  /**
   * §16a's rule on the most quotable panel in the section: a hero reading three
   * zeros for a campaign that never launched is a zero meaning two things.
   */
  it('a campaign that never launched gets the not-live state, not three zeros', async () => {
    const { campaignId } = await seedCampaign('notlive', {
      status: 'approved',
      liveAt: null,
      closeAt: null,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    expect(res.body.liveTab.live).toBe(false);
    expect(res.body.liveTab.metrics).toBeNull();
    expect(res.body.liveTab.dates).toHaveLength(3);
  });

  it('every fact carries a value or what it is waiting for, never a bare blank', async () => {
    const { campaignId } = await seedCampaign('facts', {
      status: 'listing_fee_pending',
      listingPaid: false,
      liveAt: null,
      closeAt: null,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    const all = [
      ...res.body.overview.quickFacts,
      ...res.body.overview.dates,
      ...res.body.liveTab.dates,
      ...res.body.close.facts,
    ];
    expect(all.length).toBeGreaterThan(10);
    for (const fact of all) {
      expect(
        fact.value !== null || fact.waitingOn !== null,
        `"${fact.label}" is blank in both directions`,
      ).toBe(true);
    }
    // The close pane specifically: no US$0.00 standing in for "never ran".
    const result = res.body.close.facts.find((f: { label: string }) => f.label === 'Result');
    expect(result.value).toBeNull();
    expect(result.waitingOn).toMatch(/close batch has not run/);
  });

  it('the two unbuilt destinations are shown and say why; the four built ones link', async () => {
    const { campaignId, prospectId } = await seedCampaign('links');
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);

    const byKey = new Map(
      res.body.overview.links.map((l: { key: string }) => [l.key, l as Record<string, unknown>]),
    );
    expect(byKey.get('founder_admin')!['href']).toBe(`/admin/founders/${prospectId}`);
    expect(byKey.get('affiliate_admin')!['href']).toMatch(/^\/admin\/creators\?q=/);
    expect(byKey.get('support_admin')!['href']).toBe('/admin/support');
    /* Built 2026-08-15. It lands on the Backers workspace already filtered to
       this campaign and on the Every Backer view — an unfiltered list would
       make the Admin narrow it again by hand. */
    expect(byKey.get('backer_admin')!['href']).toBe(
      `/admin/backers?view=backers&campaignId=${campaignId}`,
    );

    for (const key of ['money_admin', 'tasks']) {
      const link = byKey.get(key)!;
      expect(link['href'], `${key} must not fabricate a destination`).toBeNull();
      expect(String(link['unavailableBecause']).length).toBeGreaterThan(40);
    }
    // Never both, in either direction.
    for (const link of res.body.overview.links) {
      expect(Boolean(link.href) === Boolean(link.unavailableBecause)).toBe(false);
    }
  });

  it('the six stages are marked from records, and one is current', async () => {
    const { campaignId } = await seedCampaign('stages', { status: 'pending_review', liveAt: null });
    await h.db.insert(campaignReviews).values({
      campaignId,
      round: 1,
      submittedBy: 'user:founder',
      outcome: 'pending' as never,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    const stages = res.body.overview.stages as { key: string; state: string; caption: string }[];

    expect(stages.filter((s) => s.state === 'current')).toHaveLength(1);
    expect(stages.find((s) => s.key === 'founder_setup')!.state).toBe('done');
    expect(stages.find((s) => s.key === 'campaign_review')!.state).toBe('current');
    expect(stages.find((s) => s.key === 'campaign_review')!.caption).toBe('In review');
    expect(stages.find((s) => s.key === 'closed')!.state).toBe('upcoming');
    for (const stage of stages) expect(stage.caption.length).toBeGreaterThan(0);
  });

  it('the §26.7 CUSTOMER explanation is shown and the internal reason is not', async () => {
    const { campaignId } = await seedCampaign('suspended');
    await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/enforcement`)
      .set('Cookie', admin.cookie)
      .send({
        action: 'suspend',
        reasonCategory: 'aup_violation',
        reasonDetail: 'Radar flagged card_declined on three attempts',
        customerExplanation: 'This campaign is paused while Proovd reviews it.',
      })
      .expect(201);

    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    expect(res.body.overview.blocker.text).toBe('This campaign is paused while Proovd reviews it.');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Radar flagged');
    expect(body).not.toContain('card_declined');
  });

  /** The brief's §9: the hub exposes only what a hub needs. */
  it('carries no Backer identity and no support-case body', async () => {
    const { campaignId } = await seedCampaign('privacy');
    const [identityId] = await seedReservations(campaignId, ['reserved_active']);
    await request(h.app)
      .post('/api/admin/support/cases')
      .set('Cookie', admin.cookie)
      .send({
        topic: 'delivery',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: identityId,
        requesterEmail: 'private-backer@example.com',
        campaignId,
        message: 'A private thing I told support in confidence.',
      })
      .expect(201);

    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('private-backer@example.com');
    expect(body).not.toContain('A private thing I told support');
    expect(body).not.toContain('backer-0-');
  });
});

/* ── The composed history (§26.8) ─────────────────────────────────────────── */

describe('the history composes and stores nothing', () => {
  it('every entry names the table it was read from, and the tag it belongs to', async () => {
    const { campaignId } = await seedCampaign('history');
    await h.db.insert(campaignStatusHistory).values({
      campaignId,
      fromStatus: 'approved' as never,
      toStatus: 'live' as never,
      actor: 'system:launch',
    });
    await h.db.insert(campaignReviews).values({
      campaignId,
      round: 1,
      submittedBy: 'user:founder',
      outcome: 'approved' as never,
      decidedAt: new Date(),
      decidedBy: 'user:admin',
    });

    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    for (const item of res.body.history) {
      expect(SHARED_SOURCES as readonly string[]).toContain(item.source);
      expect(SHARED_TAGS as readonly string[]).toContain(item.tag);
      expect(item.headline.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
      expect(Number.isNaN(new Date(item.at).getTime())).toBe(false);
      // §27.1: an instant spells out its zone. A bare ISO string spells nothing.
      expect(item.atLabel).toMatch(/UTC$/);
    }
    // Newest first.
    const times = res.body.history.map((i: { at: string }) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('a campaign with nothing recorded gets an empty feed, not a fabricated one', async () => {
    const { campaignId } = await seedCampaign('quiet', {
      status: 'invited_draft',
      listingPaid: false,
      liveAt: null,
      closeAt: null,
    });
    const res = await get(`/api/admin/campaigns/${campaignId}`).expect(200);
    expect(Array.isArray(res.body.history)).toBe(true);
  });
});
