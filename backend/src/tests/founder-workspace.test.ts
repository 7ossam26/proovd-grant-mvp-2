/**
 * The Founder Admin workspace, driven over real HTTP — Spec §7, §9, §22.7,
 * §25.6, §25.8, §26.1, §26.2, §26.7, §26.8, §33.12.4, §33.12.5.
 *
 * `founder-workspace-registers.test.ts` proves the vocabulary does not drift
 * across the package boundary and that the pure derivations answer correctly.
 * This file proves the product: the routes a person actually reaches, with a
 * real session, a real Postgres, and the real `createApp` wiring — because a
 * guard that only works when a test wires it is a guard that is not mounted, and
 * a derivation that is right in isolation can still be reached by a route that
 * never calls it.
 *
 * Four things here are not "coverage" but the claims the workspace was rebuilt
 * to make true, and each is asserted as a property rather than as a happy path:
 *
 *   · the list is PER PERSON, so §9's archive-and-restart shows one Founder;
 *   · an invitation override writes the DRAFT and never the profile, and the
 *     value it stores is the value that reaches the inbox;
 *   · there is no key — under any spelling — that writes §9's three answers;
 *   · the history composes and stores nothing, which is checkable from the
 *     response because every entry names the table it came from.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { TOKEN_REJECTION_STATUS } from '../auth/token-rejection.js';

import { auditEvents } from '../db/schema/integrity.js';
import { campaignVetting, founderClaimProfiles } from '../db/schema/vetting.js';
import {
  campaignDrafts,
  campaignInvitationSends,
  founderProspects,
} from '../db/schema/invitations.js';
import { campaigns } from '../db/schema/domain.js';
import { founderGhostBans } from '../db/schema/fulfillment.js';
import {
  founderAccessActions,
  founderDeletionRequests,
  founderDeletionReviews,
} from '../db/schema/founder-workspace.js';

import { FOUNDER_HISTORY_CATEGORIES } from '../founders/logic.js';
import {
  FOUNDER_ACCESS_RECORDED,
  FOUNDER_DELETION_REQUESTED,
  FOUNDER_DELETION_REVIEWED,
  FOUNDER_FIELD_UPDATED,
  FOUNDER_OVERRIDE_CLEARED,
  FOUNDER_OVERRIDE_SET,
} from '../founders/audit-actions.js';
import type { FounderWorkspaceDetail } from '../founders/types.js';

let h: Harness;
let admin: AdminSession;
/** A real Admin whose sign-in is two days old. Nothing else about it differs. */
let staleAdmin: AdminSession;
let founderCookie: string;
let affiliateCookie: string;

beforeAll(async () => {
  h = await startHarness({}, 'founder-workspace');
  admin = await createAdmin(h, 'workspace-admin');

  // Every gated route below fails closed while §6's reauthentication window is
  // unset, which would make the whole sweep pass for the wrong reason.
  await seedAdminReauthWindow(h.db, 3600);

  staleAdmin = await createAdmin(h, 'workspace-stale-admin');
  await h.pool.query(`UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1`, [
    staleAdmin.id,
  ]);

  const founder = await seedUser(h, 'founder', 'workspace-founder');
  founderCookie = await signInPlain(h, founder.email);
  const affiliate = await seedUser(h, 'affiliate', 'workspace-affiliate');
  affiliateCookie = await signInPlain(h, affiliate.email);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

const COMPOSE = {
  whatWeUnderstood:
    'A scheduling tool for independent physiotherapists that fills cancelled slots from a waitlist.',
  whyInvited: 'Two clinics have run it for eight months and both renewed without being asked.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
  expectedSetupTime: 'About two hours of your time, spread over a week or two.',
};

const VETTING_ANSWERS = {
  problem: 'Clinics lose late-cancelled slots and the time just goes empty.',
  solution: 'A freed slot texts the waitlist in order; first to answer takes it.',
  competition: 'Most clinics use a paper list and a receptionist with a phone.',
};

interface Founder {
  prospectId: string;
  draftId: string;
  campaignId: string;
  email: string;
}

async function createFounder(label: string, extra: Record<string, unknown> = {}): Promise<Founder> {
  const email = `${label}-${randomUUID()}@example.com`;
  const res = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
      ...extra,
    })
    .expect(201);
  return { ...(res.body as Omit<Founder, 'email'>), email };
}

async function compose(draftId: string): Promise<void> {
  await request(h.app)
    .put(`/api/admin/founders/${draftId}/invitation`)
    .set('cookie', admin.cookie)
    .send(COMPOSE)
    .expect(200);
}

/** Sends the first invitation through the PERSON-scoped route, and returns the link. */
async function sendInvitation(founder: Founder): Promise<string> {
  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${founder.prospectId}/invitation/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);

  const message = h.sentEmails.messages[before];
  expect(message, 'the send produced no message').toBeTruthy();
  const match = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(message!.text);
  expect(match, 'the email carried no draft link').toBeTruthy();
  return match![1]!;
}

async function invited(label: string): Promise<Founder & { raw: string }> {
  const founder = await createFounder(label);
  await compose(founder.draftId);
  return { ...founder, raw: await sendInvitation(founder) };
}

/** Fills the three simplified answers through the Founder's link and submits. */
async function completeVetting(
  raw: string,
  type: 'pre_build' | 'pre_launch',
  draftId: string,
): Promise<void> {
  // Admin's step in the simplified flow: the campaign path, set on the draft.
  await request(h.app)
    .put(`/api/admin/founders/${draftId}/campaign-path`)
    .set('cookie', admin.cookie)
    .send({ campaignPath: type })
    .expect(200);
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({ problem: VETTING_ANSWERS.problem, solution: VETTING_ANSWERS.solution })
    .expect(200);
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({ views: '10k_100k' })
    .expect(200);
  await request(h.app).post(`/api/draft/${raw}/vetting/submit`).send({}).expect(201);
}

/**
 * Attaches a real account to a prospect.
 *
 * The claim flow itself refuses today — all eight §31.4 documents are drafts and
 * a consent may cite only a published version, which is the correct state and
 * not something to route around — so a suite that needed a claimed Founder would
 * otherwise have nothing to test against. The account is real (both
 * `founder_access_actions` and `founder_deletion_requests` carry foreign keys to
 * `"user"`), and the two records a real claim writes are written here: the
 * prospect's own claim stamp and the `founder_claim_profiles` row every read
 * resolves the person's details from once an account exists.
 */
async function claimAccount(founder: Founder, label: string): Promise<{ id: string }> {
  const account = await seedUser(h, 'founder', label);
  await h.db.insert(founderClaimProfiles).values({
    draftId: founder.draftId,
    prospectId: founder.prospectId,
    campaignId: founder.campaignId,
    legalName: 'Rowan Vale',
    preferredName: 'Rowan',
    email: founder.email,
    claimedUserId: account.id,
    claimedAt: new Date(),
    updatedBy: `user:${account.id}`,
  });
  await h.pool.query(
    `UPDATE founder_prospects SET claimed_user_id = $1, claimed_at = now() WHERE id = $2`,
    [account.id, founder.prospectId],
  );
  return { id: account.id };
}

async function workspaceOf(prospectId: string): Promise<FounderWorkspaceDetail> {
  const res = await request(h.app)
    .get(`/api/admin/founders/${prospectId}`)
    .set('cookie', admin.cookie)
    .expect(200);
  return res.body as FounderWorkspaceDetail;
}

async function auditRows(action: string, targetId: string) {
  return h.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.targetId, targetId)))
    .orderBy(desc(auditEvents.occurredAt));
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · Authorization — every route, every way in (§1.1, §5.1, §33.12.5)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every route on the router, with whether §5.1's recent-reauthentication gate
 * applies.
 *
 * The path parameters are deliberately ids that do not exist: each guard runs
 * before the handler, so what is being measured is the guard rather than the
 * record. A route that started answering 404 before it answered 401 would be
 * telling an anonymous caller which ids are real.
 */
const ROUTES: ReadonlyArray<{ method: 'get' | 'put' | 'post' | 'delete'; path: string; gated: boolean }> = [
  { method: 'get', path: '/api/admin/founders/invitation-copy', gated: false },
  { method: 'get', path: '/api/admin/founders', gated: false },
  { method: 'post', path: '/api/admin/founders', gated: false },
  { method: 'get', path: `/api/admin/founders/${randomUUID()}`, gated: false },
  // Gated because the process cannot tell whose record this is: an unknown
  // Founder takes the gate, which is `guards.ts`'s posture everywhere else. The
  // pre-claim case, where the gate correctly does NOT apply, is asserted below.
  { method: 'put', path: `/api/admin/founders/${randomUUID()}/fields/legal`, gated: true },
  {
    method: 'put',
    path: `/api/admin/founders/${randomUUID()}/invitation/overrides/recipientEmail`,
    gated: false,
  },
  {
    method: 'delete',
    path: `/api/admin/founders/${randomUUID()}/invitation/overrides/recipientEmail`,
    gated: false,
  },
  { method: 'get', path: `/api/admin/founders/${randomUUID()}/invitation/preview`, gated: false },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/invitation/send`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/invitation/new`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/invitation/cancel`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/access`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/ban`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/deletion-request`, gated: false },
  {
    method: 'post',
    path: `/api/admin/founders/${randomUUID()}/deletion-request/${randomUUID()}/reviews`,
    gated: true,
  },
  {
    method: 'post',
    path: `/api/admin/founders/${randomUUID()}/next-campaign-readiness`,
    gated: true,
  },
  { method: 'put', path: `/api/admin/founders/${randomUUID()}/vetting-prefill`, gated: false },
  { method: 'put', path: `/api/admin/founders/${randomUUID()}/campaign-path`, gated: false },
  { method: 'put', path: `/api/admin/founders/${randomUUID()}/invitation`, gated: false },
  { method: 'put', path: `/api/admin/founders/${randomUUID()}/prospect`, gated: false },
  { method: 'get', path: `/api/admin/founders/${randomUUID()}/preview`, gated: false },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/send`, gated: true },
  { method: 'post', path: `/api/admin/founders/${randomUUID()}/revoke`, gated: true },
  { method: 'post', path: `/api/admin/campaigns/${randomUUID()}/creator-signal`, gated: true },
  { method: 'post', path: `/api/admin/campaigns/${randomUUID()}/archive-and-restart`, gated: true },
];

describe('every workspace route fails closed (§1.1, §5.1, §33.12.5)', () => {
  it('refuses an anonymous caller on every route', async () => {
    for (const route of ROUTES) {
      const res = await request(h.app)[route.method](route.path).send({});
      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(401);
      expect(res.body.error).toBe('authentication_required');
    }
  });

  it('refuses a signed-in Founder and a signed-in Creator on every route', async () => {
    for (const cookie of [founderCookie, affiliateCookie]) {
      for (const route of ROUTES) {
        const res = await request(h.app)[route.method](route.path).set('cookie', cookie).send({});
        expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(403);
        expect(res.body.error).toBe('forbidden');
        // §5's role refusal names no other role and offers no switch — reaching
        // an Admin route must teach a Founder nothing about what is behind it.
        expect(JSON.stringify(res.body)).not.toContain('admin');
      }
    }
  });

  it('refuses a two-day-old Admin session on every sensitive route, and only those', async () => {
    for (const route of ROUTES) {
      const res = await request(h.app)[route.method](route.path)
        .set('cookie', staleAdmin.cookie)
        .send({});

      if (route.gated) {
        expect(res.status, `${route.method.toUpperCase()} ${route.path} must take the gate`).toBe(
          403,
        );
        expect(res.body.error).toBe('reauthentication_required');
      } else {
        // Not 403-for-freshness. The record refuses these on its own terms —
        // §5.1 names the high-impact category, and reauthenticating for
        // ordinary work teaches an Admin to clear the gate without thinking.
        expect(res.body?.error, `${route.path}`).not.toBe('reauthentication_required');
      }
    }
  });

  it('lets a stale Admin correct Proovd’s own pre-claim record, deliberately', async () => {
    // The other half of `freshWhenClaimed`, and the reason it is a predicate
    // rather than a blanket rule: before the claim a Founder record is Proovd's
    // own prep, and demanding a fresh sign-in to fix a typo in it is how the
    // gate stops meaning anything (`admin.ts`, since Phase 06a).
    const founder = await createFounder('stale-preclaim');
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/product`)
      .set('cookie', staleAdmin.cookie)
      .send({ value: 'Waitlist Pro' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(row!.productName).toBe('Waitlist Pro');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The list is one row per PERSON (§26.1, §9)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§26.1 the Founders list is keyed on the person, not the invitation', () => {
  it('shows a Founder once after §9’s archive-and-restart', async () => {
    const founder = await invited('restart');
    await completeVetting(founder.raw, 'pre_build', founder.draftId);

    // The wrong-type path: §9 archives the record and begins a fresh setup for
    // the same person. That makes a SECOND draft and a SECOND campaign, which
    // is exactly what the per-draft list showed as two unrelated Founders.
    const restarted = await request(h.app)
      .post(`/api/admin/campaigns/${founder.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'the Founder picked the wrong campaign type at setup' })
      .expect(201);

    expect(restarted.body.campaignId).not.toBe(founder.campaignId);

    const drafts = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.prospectId, founder.prospectId));
    expect(drafts, 'the restart should leave two drafts behind one person').toHaveLength(2);

    const list = await request(h.app)
      .get('/api/admin/founders')
      .set('cookie', admin.cookie)
      .expect(200);

    const rows = (list.body.founders as Array<{ prospectId: string; campaignId: string | null }>)
      .filter((row) => row.prospectId === founder.prospectId);
    expect(rows, 'one person, one row').toHaveLength(1);
    // …and the row points at the LIVE campaign, not the archived one.
    expect(rows[0]!.campaignId).toBe(restarted.body.campaignId);
  });

  it('gathers both campaigns under the one workspace, the archived one behind', async () => {
    const founder = await invited('restart-panes');
    await completeVetting(founder.raw, 'pre_launch', founder.draftId);
    const restarted = await request(h.app)
      .post(`/api/admin/campaigns/${founder.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'wrong type' })
      .expect(201);

    const detail = await workspaceOf(founder.prospectId);
    expect(detail.campaigns.current?.campaignId).toBe(restarted.body.campaignId);
    expect(detail.campaigns.previous.map((c) => c.campaignId)).toEqual([founder.campaignId]);
    // §9 is explicit that this is not a conversion, so the archived row says so
    // rather than reporting results it never had.
    expect(detail.campaigns.previous[0]!.lines).toEqual([
      'Archived — a fresh setup was started for this Founder.',
    ]);
  });

  it('answers the same 404 for a Founder who does not exist', async () => {
    const res = await request(h.app)
      .get(`/api/admin/founders/${randomUUID()}`)
      .set('cookie', admin.cookie)
      .expect(404);
    expect(res.body.error).toBe('not_found');
  });

  it('answers 404 rather than failing for an id that is not an id at all', async () => {
    // A pasted or truncated URL is how this happens, and §1.1 requires the
    // surface to answer. Letting the malformed value reach the query turns a
    // typo into a 500 carrying a database error.
    const res = await request(h.app)
      .get('/api/admin/founders/not-a-real-id')
      .set('cookie', admin.cookie)
      .expect(404);
    expect(res.body.error).toBe('not_found');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · The workspace read (§26.1, §26.2, §1.4)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§26.1 the workspace serves five panes composed from the records', () => {
  it('returns the header and all five panes for a real person', async () => {
    const founder = await invited('panes');
    const detail = await workspaceOf(founder.prospectId);

    expect(Object.keys(detail).sort()).toEqual([
      'campaigns',
      'details',
      'header',
      'history',
      'historyCounts',
      'money',
      'overview',
    ]);

    expect(detail.header).toMatchObject({
      prospectId: founder.prospectId,
      preferredName: 'Rowan',
      email: founder.email,
      // §33.1.8 pins this false at the database; the header states it as a fact
      // rather than leaving an unverified number looking verified.
      phoneVerified: false,
    });
    expect(detail.overview.invitation.state).toBe('Invite sent');
    expect(detail.overview.invitation.overrides).toHaveLength(5);
    expect(detail.details.personal.length).toBeGreaterThan(0);
    expect(detail.campaigns.current?.campaignId).toBe(founder.campaignId);
    expect(Array.isArray(detail.history)).toBe(true);
  });

  it('never puts the raw invitation token anywhere in the payload (§28.1)', async () => {
    const founder = await invited('no-token-leak');
    const detail = await workspaceOf(founder.prospectId);

    expect(JSON.stringify(detail)).not.toContain(founder.raw);
    // Admin sees that a live link exists, its version, and its expiry.
    expect(detail.overview.invitation.technical).toContain('only the hash is stored');
  });

  it('says what a money section is waiting for instead of showing a zero (§1.4, §16a)', async () => {
    const founder = await invited('honest-money');
    const detail = await workspaceOf(founder.prospectId);

    expect(detail.money.payments.populated).toBe(false);
    expect(detail.money.payments.value).toBeNull();
    expect(detail.money.payments.waitingOn).toBeTruthy();
    expect(detail.money.payments.waitingOn!.length).toBeGreaterThan(10);

    // A campaign whose close batch has not run has a 0 in every ledger column,
    // and US$0.00 is indistinguishable from a campaign that captured nothing.
    expect(JSON.stringify(detail.money)).not.toContain('US$0.00');

    // Stripe is not configured on this deployment, and the pane says so rather
    // than making a claim about the Founder's payment setup (§32.2).
    expect(detail.money.setup.value).toBe('Not available');
    expect(detail.money.setup.body).toContain('not configured');

    // §10's result is `null` when never recorded, which is not zero — telling
    // those apart is the whole reason a zero routes to Admin.
    expect(detail.overview.vetting.creatorMatches).toBeNull();
  });

  it('offers only the menu actions this record’s state permits (§1.4)', async () => {
    const fresh = await createFounder('menu-unsent');
    const before = await workspaceOf(fresh.prospectId);
    expect(before.header.availableActions).toContain('sendinvite');
    expect(before.header.availableActions).not.toContain('newinvite');
    expect(before.header.availableActions).not.toContain('cancelinvite');
    // Nobody to suspend or ban before an account exists.
    expect(before.header.availableActions).not.toContain('suspend');
    expect(before.header.availableActions).not.toContain('ban');

    const sent = await invited('menu-sent');
    const after = await workspaceOf(sent.prospectId);
    expect(after.header.availableActions).toEqual(
      expect.arrayContaining(['newinvite', 'cancelinvite']),
    );
    expect(after.header.availableActions).not.toContain('sendinvite');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · Overrides write the invitation, never the profile (§7, §26.2)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§7 a per-invitation override changes one message and nothing else', () => {
  it('writes campaign_drafts and leaves founder_prospects byte-identical', async () => {
    const founder = await createFounder('override-isolated');

    const [before] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));

    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/recipientEmail`)
      .set('cookie', admin.cookie)
      .send({ value: 'rowan.work@example.com', reason: 'they asked us to use their work address' })
      .expect(200);

    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    expect(draft!.overrideRecipientEmail).toBe('rowan.work@example.com');

    const [after] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));

    // The whole row, not a spot check: the failure this guards against is a
    // "fix one email" edit silently rewriting the person's own record and every
    // other surface that auto-fills from it.
    expect(after).toEqual(before);
  });

  it('labels the value as custom and keeps showing what the profile says', async () => {
    const founder = await createFounder('override-labelled');
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/recipientEmail`)
      .set('cookie', admin.cookie)
      .send({ value: 'rowan.work@example.com' })
      .expect(200);

    const detail = await workspaceOf(founder.prospectId);
    const field = detail.overview.invitation.overrides.find((f) => f.key === 'recipientEmail')!;

    expect(field.overridden).toBe(true);
    expect(field.value).toBe('rowan.work@example.com');
    // Both, always — an Admin looking at a value that disagrees with the record
    // needs to know which one is authoritative (§26.2).
    expect(field.profileValue).toBe(founder.email);
    expect(field.helper).toContain('Custom value for this invitation');
  });

  it('treats an override equal to the profile as no override at all', async () => {
    const founder = await createFounder('override-reference');

    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/product`)
      .set('cookie', admin.cookie)
      // The profile's own value, typed back in.
      .send({ value: 'Waitlist' })
      .expect(200);

    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    // Not a copy frozen in time: a duplicate stops tracking the profile the
    // moment the profile changes, which is a divergence nobody chose.
    expect(draft!.overrideProduct).toBeNull();

    const detail = await workspaceOf(founder.prospectId);
    const field = detail.overview.invitation.overrides.find((f) => f.key === 'product')!;
    expect(field.overridden).toBe(false);
    expect(field.value).toBe('Waitlist');
  });

  it('clears back to the profile value, and records both acts (§25.6, §33.12.4)', async () => {
    const founder = await createFounder('override-cleared');

    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/recipientName`)
      .set('cookie', admin.cookie)
      .send({ value: 'Ro' })
      .expect(200);
    await request(h.app)
      .delete(`/api/admin/founders/${founder.prospectId}/invitation/overrides/recipientName`)
      .set('cookie', admin.cookie)
      .expect(200);

    const [draft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, founder.draftId));
    expect(draft!.overrideRecipientName).toBeNull();

    const detail = await workspaceOf(founder.prospectId);
    const field = detail.overview.invitation.overrides.find((f) => f.key === 'recipientName')!;
    expect(field.overridden).toBe(false);
    expect(field.value).toBe('Rowan Vale');

    const set = await auditRows(FOUNDER_OVERRIDE_SET, founder.draftId);
    const cleared = await auditRows(FOUNDER_OVERRIDE_CLEARED, founder.draftId);
    expect(set).toHaveLength(1);
    expect(cleared).toHaveLength(1);
    // The "before" is read from the row, never supplied by the caller — the
    // clear's prior value is what the set actually stored.
    expect((cleared[0]!.priorValue as { value: string | null }).value).toBe('Ro');
    expect((cleared[0]!.newValue as { value: string | null }).value).toBeNull();
    expect(cleared[0]!.actor).toBe(`user:${admin.id}`);
  });

  it('refuses a key that is not an overridable invitation value, by name', async () => {
    const founder = await createFounder('override-unknown');
    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/legalName`)
      .set('cookie', admin.cookie)
      .send({ value: 'anything' })
      .expect(400);
    expect(res.body.whatHappened).toContain('legalName');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · The override reaches the message — the point of storing one (§7)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§7 the value Admin approves is the value that is delivered and recorded', () => {
  it('previews, sends, and records the override rather than the profile', async () => {
    const founder = await createFounder('override-delivered');
    await compose(founder.draftId);

    const workAddress = `work-${randomUUID()}@example.com`;
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/recipientEmail`)
      .set('cookie', admin.cookie)
      .send({ value: workAddress })
      .expect(200);
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/invitation/overrides/product`)
      .set('cookie', admin.cookie)
      .send({ value: 'Waitlist for Clinics' })
      .expect(200);

    // The address Admin approves in the preview is the RESOLVED one. A gate
    // that approved one recipient while the send reached another would be the
    // exact failure the gate exists to prevent.
    const preview = await request(h.app)
      .get(`/api/admin/founders/${founder.prospectId}/invitation/preview`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect(preview.body.recipientEmail).toBe(workAddress);
    expect(preview.body.blocked).toBe(false);
    expect(preview.body.subject).toContain('Waitlist for Clinics');

    const before = h.sentEmails.messages.length;
    await sendInvitation(founder);
    const message = h.sentEmails.messages[before]!;

    expect(message.to).toBe(workAddress);
    expect(message.subject).toContain('Waitlist for Clinics');

    // §7 records what was DELIVERED.
    const [send] = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(send!.recipientEmail).toBe(workAddress);
    expect(send!.recipientEmail).not.toBe(founder.email);
  });

  it('leaves an already-sent row alone when the profile changes afterwards', async () => {
    const founder = await createFounder('history-preserved');
    await compose(founder.draftId);
    await sendInvitation(founder);

    const [before] = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(before!.recipientEmail).toBe(founder.email);

    const corrected = `corrected-${randomUUID()}@example.com`;
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/email`)
      .set('cookie', admin.cookie)
      .send({ value: corrected })
      .expect(200);

    const [profile] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(profile!.email).toBe(corrected);

    // The send row is the historical answer to "who did we actually write to",
    // and a later profile edit cannot rewrite it.
    const [after] = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId));
    expect(after).toEqual(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · Field edits (§25.6, §26.2, §33.12.4) — and the three answers with no key
   ══════════════════════════════════════════════════════════════════════════ */

describe('§25.6 editing a Founder’s own record takes a reason and is recorded', () => {
  it('refuses a claimed Founder’s profile edit with no reason, and changes nothing', async () => {
    const founder = await createFounder('reason-required');
    await claimAccount(founder, 'reason-required-account');

    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/legal`)
      .set('cookie', admin.cookie)
      .send({ value: 'Rowan A. Vale' })
      .expect(400);
    expect(res.body.whatHappened).toContain('needs a reason');

    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(row!.legalName).toBe('Rowan Vale');
    expect(await auditRows(FOUNDER_FIELD_UPDATED, founder.prospectId)).toHaveLength(0);
  });

  it('records prior value, new value, reason, evidence, and actor on the edit', async () => {
    const founder = await createFounder('edit-recorded');
    await claimAccount(founder, 'edit-recorded-account');

    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/legal`)
      .set('cookie', admin.cookie)
      .send({
        value: 'Rowan A. Vale',
        reason: 'the Founder sent a passport scan showing the middle initial',
        evidence: 'support case PVD-4TK9M-2XR7C',
      })
      .expect(200);

    const [event] = await auditRows(FOUNDER_FIELD_UPDATED, founder.prospectId);
    expect(event).toBeTruthy();
    expect(event!.actor).toBe(`user:${admin.id}`);
    expect(event!.internalReason).toContain('passport scan');
    expect((event!.priorValue as { value: string | null }).value).toBe('Rowan Vale');
    expect((event!.newValue as { value: string | null }).value).toBe('Rowan A. Vale');
    expect(JSON.stringify(event!.evidenceLinks)).toContain('PVD-4TK9M-2XR7C');
    // §25.6 asks for the MFA and reauthentication context, which the database
    // cannot see and which is why it is taken from the guarded session.
    expect(event!.mfaContext).toBeTruthy();
    expect(event!.reauthContext).toContain('session_established_at=');
  });

  it('needs no reason before the claim — it is Proovd’s own prep', async () => {
    const founder = await createFounder('preclaim-edit');
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/phone`)
      .set('cookie', admin.cookie)
      .send({ value: '+1 555 0100' })
      .expect(200);

    const [event] = await auditRows(FOUNDER_FIELD_UPDATED, founder.prospectId);
    // The audit row still says something true rather than nothing.
    expect(event!.internalReason).toContain('before the account was claimed');
  });

  it('refuses an unregistered field key by name, and writes nothing', async () => {
    const founder = await createFounder('unknown-field');
    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/nickname`)
      .set('cookie', admin.cookie)
      .send({ value: 'Ro' })
      .expect(400);

    // A route that accepted any string would happily record an override of
    // something that does not exist, and the trail would look complete while
    // pointing at nothing (16a's `AUTO_POPULATED_FIELDS` reasoning).
    expect(res.body.whatHappened).toContain('nickname');
    expect(await auditRows(FOUNDER_FIELD_UPDATED, founder.prospectId)).toHaveLength(0);
  });

  it('saves an identity field before the claim onto the prospect, where the workspace reads it', async () => {
    const founder = await createFounder('preclaim-identity');
    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/dob`)
      .set('cookie', admin.cookie)
      .send({ value: '1990-01-01' })
      .expect(200);

    // Migration 0043's pre-claim home. The claim profile wins later, wherever
    // it holds a value.
    const [row] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, founder.prospectId));
    expect(row!.dateOfBirth).toBe('1990-01-01');

    const detail = res.body as {
      details: { personal: { key: string; value: string | null; editable: boolean }[] };
    };
    const dob = detail.details.personal.find((f) => f.key === 'dob');
    expect(dob).toMatchObject({ value: '1990-01-01', editable: true });
  });

  it('refuses a date of birth the date column could not hold, by shape', async () => {
    const founder = await createFounder('preclaim-bad-dob');
    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/dob`)
      .set('cookie', admin.cookie)
      .send({ value: 'April 1990' })
      .expect(400);
    expect(res.body.whatHappened).toContain('YYYY-MM-DD');
    expect(await auditRows(FOUNDER_FIELD_UPDATED, founder.prospectId)).toHaveLength(0);
  });

  it('has no key, under any spelling, that writes the three §9 answers', async () => {
    const founder = await invited('no-vetting-key');
    await completeVetting(founder.raw, 'pre_build', founder.draftId);

    const [before] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, founder.draftId));
    expect(before!.problemText).toBe(VETTING_ANSWERS.problem);

    // §9 states the Competition rule twice and §33.1.5 tests it. The guarantee
    // is an ABSENCE: with no register key there is nothing to dispatch on, so
    // every spelling an author might reach for gets the same refusal.
    for (const key of [
      'problem',
      'solution',
      'competition',
      'problemText',
      'solutionText',
      'competitionText',
      'problem_text',
      'competition_text',
      'vettingProblem',
      'answers',
    ]) {
      const res = await request(h.app)
        .put(`/api/admin/founders/${founder.prospectId}/fields/${key}`)
        .set('cookie', admin.cookie)
        .send({ value: 'AN ADMIN MUST NOT BE ABLE TO WRITE THIS', reason: 'trying anyway' });
      expect(res.status, `${key} must not be writable`).toBe(400);
    }

    const [after] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, founder.draftId));
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('MUST NOT BE ABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7 · Person-level access (§26.7, §25.6, §27.1)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§26.7 suspending and restoring a person’s Founder access', () => {
  it('refuses a suspension with no reason', async () => {
    const founder = await createFounder('access-noreason');
    await claimAccount(founder, 'access-noreason-account');

    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend' })
      .expect(400);
    expect(res.body.whatHappened).toContain('Say why');
    expect(
      await h.db
        .select()
        .from(founderAccessActions)
        .where(eq(founderAccessActions.prospectId, founder.prospectId)),
    ).toHaveLength(0);
  });

  it('records the suspension, derives the state from it, and audits it', async () => {
    const founder = await createFounder('access-suspend');
    const account = await claimAccount(founder, 'access-suspend-account');
    expect((await workspaceOf(founder.prospectId)).header.account).toBe('Active');

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({
        action: 'suspend',
        reason: 'a Backer reported the product was never shipped on a previous campaign',
        evidence: 'support case PVD-9QK3M-7ZT2X',
        reviewOwner: 'Ada Admin',
        nextReviewAt: '2026-09-01T00:00:00.000Z',
      })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(founderAccessActions)
      .where(eq(founderAccessActions.prospectId, founder.prospectId));
    expect(row).toMatchObject({ action: 'suspend', userId: account.id });
    expect(row!.reason).toContain('never shipped');
    expect(row!.reviewOwner).toBe('Ada Admin');

    const detail = await workspaceOf(founder.prospectId);
    // Nothing stores the state — a flag is what a failed write strands out of
    // step with the reason that justified it.
    expect(detail.header.account).toBe('Access suspended');
    expect(detail.details.standing.value).toBe('Under review');
    expect(detail.details.standing.detail).toContain('never shipped');
    // §27.1 asks a waiting person who owns this and when they hear next.
    expect(detail.details.standing.owner).toBe('Ada Admin');
    expect(detail.details.standing.nextReviewAt).toBeTruthy();
    // The one act the record now permits.
    expect(detail.header.availableActions).toContain('restore');
    expect(detail.header.availableActions).not.toContain('suspend');

    const [event] = await auditRows(FOUNDER_ACCESS_RECORDED, founder.prospectId);
    expect(event!.actor).toBe(`user:${admin.id}`);
    expect((event!.priorValue as { accountState: string }).accountState).toBe('Active');
    expect((event!.newValue as { accountState: string }).accountState).toBe('Access suspended');
  });

  it('refuses a second suspension and an unnecessary restore, by name', async () => {
    const founder = await createFounder('access-twice');
    await claimAccount(founder, 'access-twice-account');

    const early = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'restore', reason: 'nothing to restore' })
      .expect(422);
    expect(early.body.whatHappened).toContain('not suspended');

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend', reason: 'first' })
      .expect(200);

    const again = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend', reason: 'second' })
      .expect(422);
    expect(again.body.whatHappened).toContain('already suspended');

    // One refusal, one row: a refused decision leaves no record of a decision.
    expect(
      await h.db
        .select()
        .from(founderAccessActions)
        .where(eq(founderAccessActions.prospectId, founder.prospectId)),
    ).toHaveLength(1);
  });

  it('restores access, and a restoration carries no owner and no next review', async () => {
    const founder = await createFounder('access-restore');
    await claimAccount(founder, 'access-restore-account');

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend', reason: 'reviewing a Backer report' })
      .expect(200);

    // A restoration ends the review, so carrying a promise past the end would
    // leave one nothing will honour (§1.4). Refused in the service and by CHECK.
    const withOwner = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'restore', reason: 'the report was withdrawn', reviewOwner: 'Ada Admin' })
      .expect(400);
    expect(withOwner.body.whatHappened).toContain('carries no owner');

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'restore', reason: 'the report was withdrawn' })
      .expect(200);

    const detail = await workspaceOf(founder.prospectId);
    expect(detail.header.account).toBe('Active');
    expect(detail.details.standing.value).toBe('No issues');
    expect(detail.details.standing.nextReviewAt).toBeNull();

    // Append-only: both decisions survive, and each has its own audit row.
    const rows = await h.db
      .select()
      .from(founderAccessActions)
      .where(eq(founderAccessActions.prospectId, founder.prospectId));
    expect(rows.map((r) => r.action).sort()).toEqual(['restore', 'suspend']);
    expect(await auditRows(FOUNDER_ACCESS_RECORDED, founder.prospectId)).toHaveLength(2);
  });

  it('refuses an action that is neither of the two', async () => {
    const founder = await createFounder('access-verb');
    await claimAccount(founder, 'access-verb-account');
    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'ban', reason: 'trying the wrong door' })
      .expect(400);
    expect(res.body.whatHappened).toContain('suspension or a restoration');
  });

  it('refuses to rewrite an access decision after the fact, at the database', async () => {
    const founder = await createFounder('access-immutable');
    await claimAccount(founder, 'access-immutable-account');
    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend', reason: 'the reason this decision was made' })
      .expect(200);

    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET ROLE proovd_app');
      // A suspension reason an Admin can edit afterwards is not the §25.6
      // record it claims to be.
      await expect(
        client.query(`UPDATE founder_access_actions SET reason = 'something kinder'`),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8 · §22.7's one strike — the refusals, which is what this route owns
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The happy path is deliberately not here.
 *
 * A ban that is actually permitted needs a campaign whose stored facts MEET one
 * of §22.7's four triggers — a closed campaign with a failed Day 14 review, or
 * thirty days of recorded silence after payment — and Phase 21a's
 * `fulfillment.test.ts` builds exactly that and proves §33.10.4 against it.
 * Rebuilding it here would give the product a second answer to "is this ban
 * permitted", which is the one thing `banFounder` exists not to have: it
 * resolves the campaign and hands over to `recordGhostBan`, and what THIS route
 * owns is that every refusal arrives with its reason and leaves no row behind.
 */
describe('§22.7 a ban is refused unless the record already meets a defined trigger', () => {
  it('refuses a trigger the record does not meet, and writes no ban', async () => {
    // A real §22.7 subject: a Founder who submitted setup (so the campaign has
    // a locked type for the per-type triggers to be gated on) and owns an
    // account. Nothing about the record meets any of the four.
    const founder = await invited('ban-not-met');
    await completeVetting(founder.raw, 'pre_launch', founder.draftId);
    await claimAccount(founder, 'ban-not-met-account');

    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/ban`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'failed_day_14',
        evidence: 'nothing has happened on this campaign at all',
        notice: 'Your Proovd Founder account has been closed.',
        paymentRecoveryStatus: 'no payments were made',
        enforcementDecision: 'permanent removal',
        reason: 'trying it on',
      })
      .expect(422);

    expect(res.body.whatHappened).toContain('does not currently meet that trigger');
    // "The record currently meets: none of them" — the refusal says what the
    // record actually supports rather than only what it refused.
    expect(res.body.whatHappened).toContain('none of them');
    expect(await h.db.select().from(founderGhostBans)).toHaveLength(0);
  });

  it('refuses a trigger that is not one of the four — there is no discretionary one', async () => {
    const founder = await createFounder('ban-unknown');
    await claimAccount(founder, 'ban-unknown-account');

    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/ban`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'seems_inactive',
        evidence: 'e',
        notice: 'n',
        paymentRecoveryStatus: 'p',
        enforcementDecision: 'd',
        reason: 'r',
      })
      .expect(422);
    expect(res.body.whatHappened).toContain('four defined triggers');
    expect(await h.db.select().from(founderGhostBans)).toHaveLength(0);
  });

  it('refuses a ban with any of §22.7’s five recorded facts left blank, naming which', async () => {
    const founder = await createFounder('ban-blank');
    await claimAccount(founder, 'ban-blank-account');

    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/ban`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'failed_day_14',
        evidence: 'the Day 14 review',
        notice: '',
        paymentRecoveryStatus: '',
        enforcementDecision: 'permanent removal',
        reason: 'r',
      })
      .expect(422);
    expect(res.body.whatHappened).toContain('notice');
    expect(res.body.whatHappened).toContain('payment_recovery_status');
    expect(await h.db.select().from(founderGhostBans)).toHaveLength(0);
  });

  it('refuses when there is no account to ban, and offers no ban control either', async () => {
    const founder = await invited('ban-no-account');
    await completeVetting(founder.raw, 'pre_launch', founder.draftId);
    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/ban`)
      .set('cookie', admin.cookie)
      .send({
        trigger: 'failed_day_14',
        evidence: 'e',
        notice: 'n',
        paymentRecoveryStatus: 'p',
        enforcementDecision: 'd',
        reason: 'r',
      })
      .expect(422);
    expect(res.body.whatHappened).toContain('has not created an account');

    const detail = await workspaceOf(founder.prospectId);
    expect(detail.header.availableActions).not.toContain('ban');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9 · §25.8's account-closure request, and its reviews
   ══════════════════════════════════════════════════════════════════════════ */

describe('§25.8 the account-closure request records an ask and deletes nothing', () => {
  it('requires the date the Founder asked, and records nothing without it', async () => {
    const founder = await createFounder('deletion-nodate');
    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({ detail: 'please close my account', receivedVia: 'email' })
      .expect(400);
    // Not defaulted to now: §25.8's record is of when the FOUNDER asked, which
    // is not when an Admin got round to writing it down.
    expect(res.body.whatHappened).toContain('date the Founder asked');
    expect(await h.db.select().from(founderDeletionRequests)).toHaveLength(0);
  });

  it('records the request and its review, and renders both with the retention note', async () => {
    const founder = await createFounder('deletion-recorded');

    const recorded = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({
        detail: 'Please close my account — I am not going to run a campaign after all.',
        receivedVia: 'support case PVD-2LM8K-9WQ4T',
        requestedAt: '2026-08-01T09:30:00.000Z',
      })
      .expect(200);

    const detail = recorded.body as FounderWorkspaceDetail;
    const requestId = detail.details.deletionRequest!.id;
    expect(detail.details.deletionRequest!.receivedVia).toContain('PVD-2LM8K-9WQ4T');
    // §25.8: closing an account does not end the retention obligations, and the
    // surface says so where somebody might assume otherwise.
    expect(detail.details.deletionRequest!.detail).toContain('may still need to be retained');
    expect(detail.details.deletionRequest!.reviews).toEqual([]);

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/deletion-request/${requestId}/reviews`)
      .set('cookie', admin.cookie)
      .send({ note: 'Acknowledged. No campaign or payment records exist to retain beyond audit.' })
      .expect(200);

    const after = await workspaceOf(founder.prospectId);
    expect(after.details.deletionRequest!.reviews).toHaveLength(1);
    expect(after.details.deletionRequest!.reviews[0]!.note).toContain('Acknowledged');

    expect(await h.db.select().from(founderDeletionRequests).where(
      eq(founderDeletionRequests.prospectId, founder.prospectId),
    )).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(founderDeletionReviews)
        .where(eq(founderDeletionReviews.requestId, requestId)),
    ).toHaveLength(1);

    expect(await auditRows(FOUNDER_DELETION_REQUESTED, founder.prospectId)).toHaveLength(1);
    expect(await auditRows(FOUNDER_DELETION_REVIEWED, founder.prospectId)).toHaveLength(1);
  });

  it('refuses a review with no note, and a review against somebody else’s request', async () => {
    const mine = await createFounder('deletion-mine');
    const theirs = await createFounder('deletion-theirs');

    const recorded = await request(h.app)
      .post(`/api/admin/founders/${mine.prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({ detail: 'close it', receivedVia: 'email', requestedAt: '2026-08-01T09:30:00.000Z' })
      .expect(200);
    const requestId = (recorded.body as FounderWorkspaceDetail).details.deletionRequest!.id;

    await request(h.app)
      .post(`/api/admin/founders/${mine.prospectId}/deletion-request/${requestId}/reviews`)
      .set('cookie', admin.cookie)
      .send({ note: '   ' })
      .expect(400);

    // A review recorded against the wrong account attaches a conclusion to
    // somebody else's record, and answers the same 404 a missing request gets.
    await request(h.app)
      .post(`/api/admin/founders/${theirs.prospectId}/deletion-request/${requestId}/reviews`)
      .set('cookie', admin.cookie)
      .send({ note: 'wrong person' })
      .expect(404);

    expect(
      await h.db
        .select()
        .from(founderDeletionReviews)
        .where(eq(founderDeletionReviews.requestId, requestId)),
    ).toHaveLength(0);
  });

  it('is insert-only: the application role cannot rewrite a request or a review', async () => {
    // A deletion request the product can edit or delete is a joke that writes
    // itself. The grant is what makes that structural rather than a convention.
    for (const table of ['founder_deletion_requests', 'founder_deletion_reviews']) {
      const client = await h.pool.connect();
      try {
        // One failing statement per transaction — the first error aborts the
        // block, so a second assertion in the same one only sees the abort.
        await client.query('BEGIN');
        await client.query('SET ROLE proovd_app');
        await expect(
          client.query(`UPDATE ${table} SET id = id`),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }

      const client2 = await h.pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query('SET ROLE proovd_app');
        await expect(client2.query(`DELETE FROM ${table}`)).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await client2.query('ROLLBACK');
        client2.release();
      }
    }
  });

  it('has no column that implies the product deletes anything (§25.8)', async () => {
    const columns = await h.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
           where table_name = 'founder_deletion_requests'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    // A column named `approved` would be the first step toward an action §25.8
    // does not permit.
    for (const forbidden of ['approved', 'deleted_at', 'purge_scheduled_at', 'purged_at', 'decision']) {
      expect(names, `${forbidden} must not exist`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   10 · The history composes (§26.1, §26.8, §25.6)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§26.8 the Founder history is a read, scoped to one person', () => {
  it('carries a registered category and the name of a real table on every entry', async () => {
    const founder = await invited('history-shape');
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/website`)
      .set('cookie', admin.cookie)
      .send({ value: 'https://waitlist.example/clinics' })
      .expect(200);

    const detail = await workspaceOf(founder.prospectId);
    expect(detail.history.length).toBeGreaterThan(2);

    const tables = await h.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const realTables = new Set(tables.rows.map((r) => r.table_name));

    for (const entry of detail.history) {
      // The categories partition: an entry outside the register is one the
      // filter chips cannot show, so it would be invisible on the surface.
      expect(FOUNDER_HISTORY_CATEGORIES, `category ${entry.category}`).toContain(entry.category);
      // "Composed, not stored" is checkable from the response only because
      // every entry names where it came from.
      expect(realTables, `source ${entry.source}`).toContain(entry.source);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.body.trim().length).toBeGreaterThan(0);
      expect(new Date(entry.occurredAt).toString()).not.toBe('Invalid Date');
    }

    // Newest first, so a support call starts at what just happened.
    const instants = detail.history.map((e) => new Date(e.occurredAt).getTime());
    expect([...instants].sort((a, b) => b - a)).toEqual(instants);

    // The counts the chips render agree with the entries they filter.
    expect(detail.historyCounts['all']).toBe(detail.history.length);
    for (const category of FOUNDER_HISTORY_CATEGORIES) {
      const counted = detail.history.filter((e) => e.category === category).length;
      if (counted > 0) expect(detail.historyCounts[category]).toBe(counted);
    }
  });

  it('shows the invitation send and the Admin field edit, each from its own record', async () => {
    const founder = await invited('history-entries');
    await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/invOwner`)
      .set('cookie', admin.cookie)
      .send({ value: 'Maya Admin' })
      .expect(200);

    const detail = await workspaceOf(founder.prospectId);

    const send = detail.history.find((e) => e.source === 'campaign_invitation_sends');
    expect(send, 'the send is missing from the history').toBeTruthy();
    expect(send!.category).toBe('invite');
    expect(send!.body).toContain(founder.email);

    const edit = detail.history.find(
      (e) => e.source === 'audit_events' && e.title === 'Proovd owner updated',
    );
    expect(edit, 'the Admin edit is missing from the history').toBeTruthy();
    expect(edit!.category).toBe('admin');
    // §25.6's record rides with the entry, and the label rather than the column
    // name — `internal_owner` is exactly the vocabulary §3.1 keeps off a screen
    // an Admin quotes on a support call.
    expect(edit!.audit).toMatchObject({
      field: 'Proovd owner',
      priorValue: 'Ada Admin',
      newValue: 'Maya Admin',
    });
    expect(edit!.audit!.by).not.toBe(`user:${admin.id}`);
  });

  it('never carries another Founder’s facts', async () => {
    const mine = await invited('history-scope-mine');
    const theirs = await invited('history-scope-theirs');

    const detail = await workspaceOf(mine.prospectId);
    const serialised = JSON.stringify(detail);
    expect(serialised).toContain(mine.email);
    expect(serialised).not.toContain(theirs.email);
    expect(serialised).not.toContain(theirs.campaignId);
  });

  it('gathers both campaigns of an archived-and-restarted Founder into one feed', async () => {
    // A person outlives a campaign: this is the case §26.8's campaign-scoped
    // timeline cannot hold, and the reason the feed is its own read.
    const founder = await invited('history-restart');
    await completeVetting(founder.raw, 'pre_build', founder.draftId);
    const restarted = await request(h.app)
      .post(`/api/admin/campaigns/${founder.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'wrong type' })
      .expect(201);

    const detail = await workspaceOf(founder.prospectId);
    const restart = detail.history.find(
      (e) => e.title === 'Campaign record archived and setup restarted',
    );
    expect(restart).toBeTruthy();
    expect(restart!.category).toBe('campaign');

    // The original campaign's own lifecycle rows are still in the feed, which
    // is what a per-campaign timeline would have lost at the restart.
    const submitted = detail.history.filter((e) => e.title === 'Founder setup submitted');
    expect(submitted.length).toBeGreaterThan(0);
    expect(restarted.body.campaignId).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   11 · There is no second event store (§26.8's trap)
   ══════════════════════════════════════════════════════════════════════════ */

describe('the history has no store of its own', () => {
  it('has no timeline- or history-shaped table anywhere in the schema', async () => {
    const tables = await h.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = tables.rows.map((r) => r.table_name);

    for (const name of names) {
      expect(name, 'a timeline table drifts from the records it summarises').not.toMatch(
        /timeline/,
      );
      expect(name).not.toMatch(/^founder_(history|feed|activity|events)$/);
    }
  });

  it('writes nothing: the composer has no insert, update, or delete in it', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../founders/history.ts'), 'utf8');

    // The schema check above passes right up until somebody adds a table, and
    // this one fails the moment the read starts writing — which is how a second
    // event store actually arrives.
    for (const write of ['.insert(', '.update(', '.delete(']) {
      expect(source, `history.ts must not call ${write}`).not.toContain(write);
    }
  });

  it('reads the same facts twice without changing them', async () => {
    const founder = await invited('history-idempotent');
    const first = await workspaceOf(founder.prospectId);
    const second = await workspaceOf(founder.prospectId);

    // A read that recorded something would grow its own feed on every visit.
    expect(second.history.map((e) => `${e.source}|${e.occurredAt}|${e.title}`)).toEqual(
      first.history.map((e) => `${e.source}|${e.occurredAt}|${e.title}`),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The invitation, addressed by the person (§7)
   ══════════════════════════════════════════════════════════════════════════ */

describe('§7 send and resend are two acts with two refusals', () => {
  it('refuses a first send when a working link already exists, and names the other act', async () => {
    const founder = await invited('send-twice');
    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);
    expect(res.body.whatHappened).toContain('Send a new invite instead');
  });

  it('refuses a resend before anything has been sent', async () => {
    const founder = await createFounder('resend-first');
    await compose(founder.draftId);
    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/new`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);
    expect(res.body.whatHappened).toContain('Send the first one instead');
  });

  it('resends, rotating the link, and records §7’s sender from the Admin’s own account', async () => {
    const founder = await invited('resend');
    const before = h.sentEmails.messages.length;

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/new`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(201);

    expect(h.sentEmails.messages.length).toBe(before + 1);
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(TOKEN_REJECTION_STATUS);

    const sends = await h.db
      .select()
      .from(campaignInvitationSends)
      .where(eq(campaignInvitationSends.draftId, founder.draftId))
      .orderBy(desc(campaignInvitationSends.sentAt));
    expect(sends).toHaveLength(2);
    // A resend by a colleague must not rewrite who the first message came from,
    // so the recorded sender is left alone once it exists.
    expect(sends[0]!.senderName).toBe(sends[1]!.senderName);

    const detail = await workspaceOf(founder.prospectId);
    expect(detail.overview.invitation.state).toBe('New invite sent');
    expect(detail.overview.invitation.meaning).toContain('no longer works');
  });

  it('cancels the invitation with a reason, and refuses without one', async () => {
    const founder = await invited('cancel');

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/cancel`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(400);
    await request(h.app).get(`/api/draft/${founder.raw}`).expect(200);

    await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/cancel`)
      .set('cookie', admin.cookie)
      .send({ reason: 'the product is not a fit after all' })
      .expect(200);

    await request(h.app).get(`/api/draft/${founder.raw}`).expect(TOKEN_REJECTION_STATUS);
    const detail = await workspaceOf(founder.prospectId);
    expect(detail.overview.invitation.state).toBe('Invite canceled');
  });

  it('refuses to send to a Founder who already has an account', async () => {
    const founder = await createFounder('send-claimed');
    await compose(founder.draftId);
    await claimAccount(founder, 'send-claimed-account');

    const res = await request(h.app)
      .post(`/api/admin/founders/${founder.prospectId}/invitation/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(422);
    expect(res.body.whatHappened).toContain('already been claimed');
    expect(
      await h.db
        .select()
        .from(campaignInvitationSends)
        .where(eq(campaignInvitationSends.draftId, founder.draftId)),
    ).toHaveLength(0);
  });

  it('states what is missing rather than surfacing a null from two layers down', async () => {
    // Every person-scoped route resolves the context first and refuses by name,
    // so an unknown person gets an answer at the route rather than a failure
    // from inside a service that assumed one existed (§27.1).
    const missing = randomUUID();

    await request(h.app)
      .get(`/api/admin/founders/${missing}/invitation/preview`)
      .set('cookie', admin.cookie)
      .expect(404);

    const send = await request(h.app)
      .post(`/api/admin/founders/${missing}/invitation/send`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(404);
    expect(send.body.whatHappened).toContain('no invitation to send');

    const override = await request(h.app)
      .put(`/api/admin/founders/${missing}/invitation/overrides/product`)
      .set('cookie', admin.cookie)
      .send({ value: 'anything' })
      .expect(404);
    expect(override.body.whatHappened).toContain('no Founder at that address');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §26.2 — the auto-populated half stays auto-populated
   ══════════════════════════════════════════════════════════════════════════ */

describe('§26.2 what the record already knows is not re-keyable here', () => {
  it('serves the lifecycle, the anchors, and the campaign status as read facts', async () => {
    const founder = await invited('autopopulated');
    const detail = await workspaceOf(founder.prospectId);

    expect(detail.campaigns.current).toMatchObject({
      campaignId: founder.campaignId,
      status: 'Invited — setup not started',
      rawStatus: 'invited_draft',
    });
    // §23: lifecycle only. No payment flag has leaked into the status.
    expect(detail.campaigns.current!.status).not.toMatch(/payment|w-9|captured/i);

    // There is no route that writes a campaign status or an anchor from here.
    const [campaign] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, founder.campaignId));
    expect(campaign!.listingPaidAt).toBeNull();
    expect(campaign!.campaignLiveAt).toBeNull();
    expect(campaign!.campaignCloseAt).toBeNull();
  });

  it('shows the §27.7 digest preference as read-only, with the rule beside it', async () => {
    const founder = await createFounder('digest-readonly');
    const detail = await workspaceOf(founder.prospectId);

    const summary = detail.details.preferences.find((f) => f.key === 'summary')!;
    expect(summary.editable).toBe(false);
    expect(summary.value).toBe('Not chosen yet');
    // §27.7's preference exists only because a person chose it, and §30 forbids
    // the product answering for them.
    expect(summary.helper).toContain('never chooses a summary frequency');

    // …and there is no key for it, so no route can write one however it is called.
    const res = await request(h.app)
      .put(`/api/admin/founders/${founder.prospectId}/fields/summary`)
      .set('cookie', admin.cookie)
      .send({ value: 'daily', reason: 'they asked' })
      .expect(400);
    expect(res.body.whatHappened).toContain('summary');
  });
});
