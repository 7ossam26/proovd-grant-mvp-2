/**
 * The Creator (Affiliate) Admin workspace, driven over real HTTP — Spec §8,
 * §5.3, §11, §2.2, §25.6, §25.8, §26.1, §26.7, §33.12.5.
 *
 * `creator-workspace-registers.test.ts` proves the vocabulary does not drift
 * across the package boundary. This file proves the product: the routes a
 * person actually reaches, with a real session, a real Postgres, and the real
 * `createApp` wiring — because a guard that only works when a test wires it is a
 * guard that is not mounted.
 *
 * Five things here are not "coverage" but the claims the workspace was built to
 * make true, and each is asserted as a property rather than as a happy path:
 *
 *   · the directory is PER PERSON, so a Creator recruited to two campaigns is
 *     one row that names both;
 *   · the §2.2 slot count is derived across every campaign, never per campaign;
 *   · the history composes and STORES NOTHING, which is checkable from the
 *     response because every entry names the table it came from;
 *   · a second relationship on the same campaign is refused, and the refusal
 *     says why;
 *   · the freshness gate is on the review and off the two acts that record what
 *     somebody told us — exactly the partition the register declares.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';

import { auditEvents } from '../db/schema/integrity.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  affiliateDeletionRequests,
  affiliateDeletionReviews,
  affiliateEvidenceFiles,
  affiliateEvidenceVerifications,
} from '../db/schema/creator-workspace.js';
import {
  CREATOR_ASSIGNED_TO_CAMPAIGN,
  CREATOR_DELETION_REVIEWED,
} from '../affiliates/workspace/audit-actions.js';
import { recordCreatorAccessAction } from '../affiliates/workspace/mutations.js';
import type {
  CreatorDirectoryRow,
  CreatorWorkspaceDetail,
} from '../affiliates/workspace/types.js';

let h: Harness;
let admin: AdminSession;
/** A real Admin whose sign-in is two days old. Nothing else about it differs. */
let staleAdmin: AdminSession;
let founderCookie: string;
let affiliateCookie: string;

beforeAll(async () => {
  h = await startHarness({}, 'creator-workspace');
  admin = await createAdmin(h, 'creators-admin');

  // Every gated route below fails closed while §6's reauthentication window is
  // unset, which would make the whole sweep pass for the wrong reason.
  await seedAdminReauthWindow(h.db, 3600);

  staleAdmin = await createAdmin(h, 'creators-stale-admin');
  await h.pool.query(`UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1`, [
    staleAdmin.id,
  ]);

  const founder = await seedUser(h, 'founder', 'creators-founder');
  founderCookie = await signInPlain(h, founder.email);
  const affiliate = await seedUser(h, 'affiliate', 'creators-affiliate');
  affiliateCookie = await signInPlain(h, affiliate.email);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * A campaign, made the way the product makes one: by recording a Founder
 * prospect, which creates the campaign, draft, and vetting record together.
 * Fabricating a bare `campaigns` row would leave the name composition — build
 * title, else product name — with nothing to read.
 */
async function createCampaign(label: string): Promise<{ campaignId: string; name: string }> {
  const res = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: `Founder ${label}`,
      preferredName: label,
      email: `${label}-${randomUUID()}@example.com`,
      productName: `Product ${label}`,
    })
    .expect(201);
  const body = res.body as { campaignId: string };
  return { campaignId: body.campaignId, name: `Product ${label}` };
}

const RECRUIT = {
  publicHandle: '@rowan.builds',
  channelReference: 'https://instagram.com/rowan.builds',
  audienceNiche: 'Independent clinic operations',
  permissionBasis: 'Sole operator of the account; no manager or agency involved.',
  adminBio: 'Posts weekly about running a one-person clinic.',
  recruitmentSource: 'Found through a clinic-operations newsletter.',
  recruitingAdmin: 'Ada Admin',
  subtype: 'social_creator',
};

/** Recruits a Creator to a campaign and returns both ids. */
async function recruit(
  campaignId: string,
  label: string,
  extra: Record<string, unknown> = {},
): Promise<{ prospectId: string; associationId: string; email: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const res = await request(h.app)
    .post('/api/admin/affiliates')
    .set('cookie', admin.cookie)
    .send({ ...RECRUIT, legalName: `Rowan ${label}`, email, campaignId, ...extra })
    .expect(201);
  const body = res.body as { prospectId: string; associationId: string };
  return { ...body, email };
}

async function readDirectory(): Promise<CreatorDirectoryRow[]> {
  const res = await request(h.app)
    .get('/api/admin/creators')
    .set('cookie', admin.cookie)
    .expect(200);
  return (res.body as { creators: CreatorDirectoryRow[] }).creators;
}

async function readWorkspace(prospectId: string): Promise<CreatorWorkspaceDetail> {
  const res = await request(h.app)
    .get(`/api/admin/creators/${prospectId}`)
    .set('cookie', admin.cookie)
    .expect(200);
  return res.body as CreatorWorkspaceDetail;
}

/* ── The directory is per person ──────────────────────────────────────────── */

describe('§26.1, §8 — the directory answers for a PERSON, not a campaign', () => {
  it('shows one row for a Creator recruited to two campaigns, naming both', async () => {
    const first = await createCampaign('two-camps-a');
    const second = await createCampaign('two-camps-b');
    const { prospectId } = await recruit(first.campaignId, 'two-camps');

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/assign-campaign`)
      .set('cookie', admin.cookie)
      .send({ campaignId: second.campaignId, rosterIntent: 'initial_roster' })
      .expect(200);

    const rows = await readDirectory();
    const mine = rows.filter((row) => row.prospectId === prospectId);

    // The claim the whole read exists to make. The deleted campaign-scoped
    // screen produced two unrelated rows here.
    expect(mine).toHaveLength(1);
    expect(mine[0]!.campaigns.total).toBe(2);

    // And both campaigns are searchable from the one row, so an Admin who
    // remembers only the campaign can still find the person.
    expect(mine[0]!.searchText).toContain(first.name.toLowerCase());
    expect(mine[0]!.searchText).toContain(second.name.toLowerCase());
  });

  it('derives the §2.2 slot count across every campaign, and never stores it', async () => {
    const campaign = await createCampaign('slots');
    const { prospectId, associationId } = await recruit(campaign.campaignId, 'slots');

    const before = await readWorkspace(prospectId);
    expect(before.header.slots).toEqual({ used: 0, limit: 3, remaining: 3, atLimit: false });

    // §2.2: a slot runs from tracking-link activation, and `paused` still holds
    // one — a paused Creator is not a closed campaign.
    await h.db
      .update(campaignAffiliateAssociations)
      .set({ status: 'paused' })
      .where(eq(campaignAffiliateAssociations.id, associationId));

    const after = await readWorkspace(prospectId);
    expect(after.header.slots.used).toBe(1);

    // There is no column holding it, so it cannot go stale.
    const columns = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'affiliate_prospects' AND column_name LIKE '%slot%'`,
    );
    expect(columns.rowCount).toBe(0);
  });

  it('resolves every cell server-side, including the filter answers', async () => {
    const campaign = await createCampaign('filters');
    const { prospectId } = await recruit(campaign.campaignId, 'filters');

    const row = (await readDirectory()).find((r) => r.prospectId === prospectId)!;

    // A freshly recruited prospect is unverified with §5.3 evidence
    // outstanding, so the verification pill selects it; nobody has claimed the
    // account, so the payout pill does NOT — §16a's rule, applied to a filter:
    // an unclaimed prospect has no payout problem, it has no payout.
    expect(row.filters.verification).toBe(true);
    expect(row.filters.payout).toBe(false);
    expect(row.verification.label).toBe('Not verified yet');
    expect(row.payout.label).toBe('No payout account yet');
    expect(row.account).toBe('Not claimed yet');
  });

  it('names one thing to do, from a record, with the owner who owns it', async () => {
    const campaign = await createCampaign('attention');
    const { prospectId } = await recruit(campaign.campaignId, 'attention');

    const row = (await readDirectory()).find((r) => r.prospectId === prospectId)!;
    expect(row.attention.needed).toBe(true);
    if (!row.attention.needed) throw new Error('unreachable');

    // Verification outranks the unsent invitation: the register's order is the
    // priority, and a row shows one thing (DNA §5.1).
    expect(row.attention.kind).toBe('verification_due');
    expect(row.attention.owner).toBe('Admin');
    expect(row.filters.adminWork).toBe(true);
  });
});

/* ── The record ───────────────────────────────────────────────────────────── */

describe('§26.1, §5.3, §13 — the record is composed from the records that hold it', () => {
  it('splits the profile by who supplied each value', async () => {
    const campaign = await createCampaign('provenance');
    const { prospectId } = await recruit(campaign.campaignId, 'provenance');

    const detail = await readWorkspace(prospectId);
    const provenances = detail.profile.blocks.map((block) => block.provenance);
    expect(provenances).toEqual(['affiliate', 'admin']);

    const research = detail.profile.blocks.find((b) => b.provenance === 'admin')!;
    expect(research.fields.find((f) => f.key === 'bio')?.value).toBe(RECRUIT.adminBio);

    // §13: Proovd holds a status and an id, never the data behind them. Before
    // a claim there is no connected account at all, and the block says what it
    // is waiting on rather than rendering an empty Stripe panel (§16a).
    expect(detail.profile.provider.populated).toBe(false);
    expect(detail.profile.provider.waitingOn).toContain('claimed');
    expect(detail.profile.provider.accountId).toBeNull();
  });

  it('reports the §5.3 evidence gap without enforcing it', async () => {
    const campaign = await createCampaign('evidence');
    const { prospectId } = await recruit(campaign.campaignId, 'evidence');

    const detail = await readWorkspace(prospectId);
    // The record saved with evidence outstanding — refusing the save would push
    // an Admin to type a placeholder into an evidence field, which is a worse
    // record than an honestly incomplete one.
    expect(detail.header.verification.missing.length).toBeGreaterThan(0);
    expect(detail.profile.verification.evidence.some((item) => item.required)).toBe(true);
    expect(
      detail.profile.verification.evidence.every((item) => item.value === null || item.value !== ''),
    ).toBe(true);
  });

  it('offers exactly the actions the record permits, and no others', async () => {
    const campaign = await createCampaign('actions');
    const { prospectId } = await recruit(campaign.campaignId, 'actions');

    const before = await readWorkspace(prospectId);
    expect(before.header.availableActions).toContain('suspend');
    expect(before.header.availableActions).not.toContain('restore');

    await recordCreatorAccessAction(
      { db: h.db },
      {
        prospectId,
        action: 'suspend',
        reason: 'Reviewing a disclosed conflict before the relationship continues.',
        evidence: null,
        reviewOwner: 'Ada Admin',
        nextReviewAt: null,
        who: { actor: 'user:test', mfaContext: 'test', reauthContext: 'test' },
      },
    );

    const after = await readWorkspace(prospectId);
    expect(after.header.account).toBe('Access suspended');
    expect(after.header.availableActions).toContain('restore');
    expect(after.header.availableActions).not.toContain('suspend');
  });

  it('has no permanent Creator sanction to record, at the database', async () => {
    // §22.7's one-strike ban is a FOUNDER record with four defined triggers.
    // The Spec states no Creator equivalent, so `action` admits two values and
    // there is nowhere for a third to go without editing the constraint.
    const campaign = await createCampaign('no-ban');
    const { prospectId } = await recruit(campaign.campaignId, 'no-ban');

    await expect(
      h.pool.query(
        `INSERT INTO affiliate_access_actions (prospect_id, action, reason, actor)
         VALUES ($1, 'ban', 'because', 'user:test')`,
        [prospectId],
      ),
    ).rejects.toThrow();

    const tables = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name LIKE '%affiliate%ban%'`,
    );
    expect(tables.rowCount).toBe(0);
  });
});

/* ── The history ──────────────────────────────────────────────────────────── */

describe('§26.8, §25.6 — the history composes and stores nothing', () => {
  it('names the table every entry came from, and has no store of its own', async () => {
    const campaign = await createCampaign('history');
    const { prospectId } = await recruit(campaign.campaignId, 'history');

    const detail = await readWorkspace(prospectId);
    expect(detail.history.length).toBeGreaterThan(0);
    for (const entry of detail.history) {
      expect(entry.source).toMatch(/^[a-z_]+$/);
      expect(entry.reference.startsWith(`${entry.source}:`)).toBe(true);
    }

    // The claim is checkable both ways: from the response, and from the schema.
    const tables = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE '%creator_history%' OR table_name LIKE '%affiliate_history%'
               OR table_name LIKE '%creator_timeline%')`,
    );
    expect(tables.rowCount).toBe(0);
  });

  it('writes nothing: the composer has no insert, update, or delete in it', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../affiliates/workspace/history.ts'), 'utf8');
    // Comments strip first: this file explains at length what it refuses to do,
    // and a scan that could not tell an explanation from a usage would force
    // the explanations out.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.insert\(/);
    expect(code).not.toMatch(/\.update\(/);
    expect(code).not.toMatch(/\.delete\(/);
  });

  it('reads the same facts twice without changing them', async () => {
    const campaign = await createCampaign('idempotent-read');
    const { prospectId } = await recruit(campaign.campaignId, 'idempotent-read');

    const first = await readWorkspace(prospectId);
    const second = await readWorkspace(prospectId);
    expect(second).toEqual(first);
  });

  it('renders no raw audit action name it does not recognise', async () => {
    const campaign = await createCampaign('allowlist');
    const { prospectId } = await recruit(campaign.campaignId, 'allowlist');

    await h.db.insert(auditEvents).values({
      actor: 'user:test',
      targetType: 'affiliate_prospect',
      targetId: prospectId,
      action: 'affiliate.some_future_action_nobody_mapped',
      internalReason: 'A later phase wrote this and did not tell the history about it.',
    });

    const detail = await readWorkspace(prospectId);
    // §3.1: an audit action name is an internal identifier, and a history line
    // reading it aloud on a support call is the leak §3.1 names. Skipped, never
    // rendered raw.
    expect(
      detail.history.some((entry) => entry.title.includes('some_future_action')),
    ).toBe(false);
  });
});

/* ── Assigning to another campaign ────────────────────────────────────────── */

describe('§8, §11 — a second relationship is a second row, never a second person', () => {
  it('creates a prospect-state relationship and sends nothing', async () => {
    const first = await createCampaign('assign-a');
    const second = await createCampaign('assign-b');
    const { prospectId } = await recruit(first.campaignId, 'assign');

    const before = h.sentEmails.messages.length;
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/assign-campaign`)
      .set('cookie', admin.cookie)
      .send({ campaignId: second.campaignId, rosterIntent: 'mid_campaign' })
      .expect(200);

    const detail = res.body as CreatorWorkspaceDetail;
    expect(detail.relationships).toHaveLength(2);
    const fresh = detail.relationships.find((r) => r.campaignId === second.campaignId)!;
    expect(fresh.statusRaw).toBe('prospect');
    expect(fresh.designation).toBe('Mid-campaign addition');

    // No message, no account. The invitation is the separate act.
    expect(h.sentEmails.messages.length).toBe(before);

    // And exactly one prospect row exists for this person, so their §2.2 count,
    // verification, and history are not split in half.
    const prospects = await h.db
      .select({ id: affiliateProspects.id })
      .from(affiliateProspects)
      .where(eq(affiliateProspects.id, prospectId));
    expect(prospects).toHaveLength(1);
  });

  it('refuses a second relationship on the same campaign, and says why', async () => {
    const campaign = await createCampaign('duplicate');
    const { prospectId } = await recruit(campaign.campaignId, 'duplicate');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/assign-campaign`)
      .set('cookie', admin.cookie)
      .send({ campaignId: campaign.campaignId, rosterIntent: 'initial_roster' })
      .expect(422);

    expect((res.body as { whatHappened: string }).whatHappened).toContain(
      'one relationship per campaign',
    );
  });

  it('records the §25.6 row in the same transaction as the relationship', async () => {
    const first = await createCampaign('audit-a');
    const second = await createCampaign('audit-b');
    const { prospectId } = await recruit(first.campaignId, 'audit');

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/assign-campaign`)
      .set('cookie', admin.cookie)
      .send({ campaignId: second.campaignId, rosterIntent: 'initial_roster' })
      .expect(200);

    const rows = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, prospectId),
          eq(auditEvents.action, CREATOR_ASSIGNED_TO_CAMPAIGN),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(`user:${admin.id}`);
    expect(rows[0]!.reauthContext).toContain('session_established_at=');
  });
});

/* ── The §25.8 deletion ask ───────────────────────────────────────────────── */

describe('§25.8 — the deletion request records an ask and deletes nothing', () => {
  it('records the ask, its provenance, and when they asked', async () => {
    const campaign = await createCampaign('deletion');
    const { prospectId } = await recruit(campaign.campaignId, 'deletion');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({
        detail: 'Asked us to close the account and remove their details.',
        receivedVia: 'Support case PVD-38fkx-2q7wp',
        requestedAt: '2026-08-01T09:00:00.000Z',
      })
      .expect(200);

    const detail = res.body as CreatorWorkspaceDetail;
    expect(detail.profile.deletionRequest?.receivedVia).toContain('PVD-');

    const [row] = await h.db
      .select()
      .from(affiliateDeletionRequests)
      .where(eq(affiliateDeletionRequests.prospectId, prospectId));
    // When they asked, not when an Admin got round to it.
    expect(row!.requestedAt.toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });

  it('refuses a request with no provenance', async () => {
    const campaign = await createCampaign('deletion-no-source');
    const { prospectId } = await recruit(campaign.campaignId, 'deletion-no-source');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/deletion-request`)
      .set('cookie', admin.cookie)
      .send({ detail: 'Wants the account closed.' })
      .expect(422);
    expect((res.body as { whatHappened: string }).whatHappened).toContain('provenance');
  });

  it('has no deleted_at, no purge schedule, and no approval state', async () => {
    const columns = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'affiliate_deletion_requests'`,
    );
    const names = columns.rows.map((r) => (r as { column_name: string }).column_name);
    for (const forbidden of ['deleted_at', 'purge_scheduled_at', 'approved', 'approved_at']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('makes all three records insert-only for the application role', async () => {
    for (const table of [
      'affiliate_access_actions',
      'affiliate_deletion_requests',
      'affiliate_deletion_reviews',
    ]) {
      const grants = await h.pool.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'proovd_app' AND table_name = $1`,
        [table],
      );
      const privileges = grants.rows.map((r) => (r as { privilege_type: string }).privilege_type);
      expect(privileges).toContain('INSERT');
      expect(privileges).toContain('SELECT');
      expect(privileges).not.toContain('UPDATE');
      expect(privileges).not.toContain('DELETE');
    }
  });
});

/* ── Authorization ────────────────────────────────────────────────────────── */

describe('§33.12.5 — the Admin boundary holds, and the gate is where the register says', () => {
  const READS = (prospectId: string) => [
    '/api/admin/creators',
    '/api/admin/creators/campaigns',
    `/api/admin/creators/${prospectId}`,
    `/api/admin/creators/${prospectId}/history`,
  ];

  it('refuses an anonymous caller on every route', async () => {
    const campaign = await createCampaign('anon');
    const { prospectId } = await recruit(campaign.campaignId, 'anon');
    for (const path of READS(prospectId)) {
      await request(h.app).get(path).expect(401);
    }
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/assign-campaign`)
      .send({ campaignId: campaign.campaignId })
      .expect(401);
  });

  it('refuses a signed-in Founder and a signed-in Creator on every route', async () => {
    const campaign = await createCampaign('wrong-role');
    const { prospectId } = await recruit(campaign.campaignId, 'wrong-role');
    for (const cookie of [founderCookie, affiliateCookie]) {
      for (const path of READS(prospectId)) {
        await request(h.app).get(path).set('cookie', cookie).expect(403);
      }
    }
  });

  it('refuses a two-day-old Admin session on the review, and only there', async () => {
    const campaign = await createCampaign('freshness');
    const { prospectId } = await recruit(campaign.campaignId, 'freshness');

    // Ungated by decision, and registered with its reason: recording that
    // somebody asked decides nothing (Phase 20b's §29.1 posture).
    const created = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/deletion-request`)
      .set('cookie', staleAdmin.cookie)
      .send({ detail: 'Please close it.', receivedVia: 'Email' })
      .expect(200);
    const requestId = (created.body as CreatorWorkspaceDetail).profile.deletionRequest!.id;

    // Gated: the review is a decision somebody may be asked to stand behind.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/deletion-request/${requestId}/reviews`)
      .set('cookie', staleAdmin.cookie)
      // 403, not 401: the session is real and the role is right — what is stale
      // is the sign-in. `requireFreshSession` says so rather than pretending
      // the caller is anonymous.
      .expect(403);

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/deletion-request/${requestId}/reviews`)
      .set('cookie', admin.cookie)
      .send({ note: 'Acknowledged; retention obligations reviewed.' })
      .expect(200);

    const reviews = await h.db
      .select()
      .from(affiliateDeletionReviews)
      .where(eq(affiliateDeletionReviews.requestId, requestId));
    expect(reviews).toHaveLength(1);

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, prospectId),
          eq(auditEvents.action, CREATOR_DELETION_REVIEWED),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it('answers the same 404 for a malformed id and an unknown one', async () => {
    const malformed = await request(h.app)
      .get('/api/admin/creators/not-an-id')
      .set('cookie', admin.cookie)
      .expect(404);
    const unknown = await request(h.app)
      .get(`/api/admin/creators/${randomUUID()}`)
      .set('cookie', admin.cookie)
      .expect(404);
    expect(malformed.body).toEqual(unknown.body);
  });

  it('never puts an invitation token anywhere in the payload (§28.1)', async () => {
    const campaign = await createCampaign('token');
    const { prospectId } = await recruit(campaign.campaignId, 'token');

    const detail = await readWorkspace(prospectId);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/creator-invitation\/[A-Za-z0-9_-]{10,}/);
    expect(serialized).not.toMatch(/"token"\s*:/);
  });
});

/* ── The campaign picker ──────────────────────────────────────────────────── */

describe('§8 — the campaign is chosen from a list, never typed', () => {
  it('lists campaigns with their Founder and status, and excludes archived ones', async () => {
    const campaign = await createCampaign('picker');

    const res = await request(h.app)
      .get('/api/admin/creators/campaigns')
      .set('cookie', admin.cookie)
      .expect(200);
    const rows = (res.body as { campaigns: { campaignId: string; name: string; status: string }[] })
      .campaigns;

    const mine = rows.find((row) => row.campaignId === campaign.campaignId);
    expect(mine).toBeTruthy();
    expect(mine!.name).toBe(campaign.name);
    // §3.1: a lifecycle value never reaches a screen raw.
    expect(mine!.status).not.toMatch(/_/);

    // §9's archive-and-restart records all three facts together — the
    // `campaigns_archive_pair` CHECK refuses a half-archived row.
    await h.pool.query(
      `UPDATE campaigns
          SET archived_at = now(), archived_reason = 'wrong type', archived_by = 'user:test'
        WHERE id = $1`,
      [campaign.campaignId],
    );
    const after = await request(h.app)
      .get('/api/admin/creators/campaigns')
      .set('cookie', admin.cookie)
      .expect(200);
    expect(
      (after.body as { campaigns: { campaignId: string }[] }).campaigns.some(
        (row) => row.campaignId === campaign.campaignId,
      ),
    ).toBe(false);
  });
});

/* ── §8's own rule, re-proved where it changed ────────────────────────────── */

describe('§8, §5.3 — recruiting saves an honestly incomplete record', () => {
  it('records a prospect with no campaign-fit note, and keeps the column', async () => {
    const campaign = await createCampaign('no-fit');
    const { prospectId } = await recruit(campaign.campaignId, 'no-fit');

    const [row] = await h.db
      .select({ campaignFit: affiliateProspects.campaignFit })
      .from(affiliateProspects)
      .where(eq(affiliateProspects.id, prospectId));
    expect(row!.campaignFit).toBeNull();

    // The column is still there, still editable through the research record,
    // and still rendered — only the required-at-create rule went.
    const detail = await readWorkspace(prospectId);
    const research = detail.profile.blocks.find((b) => b.provenance === 'admin')!;
    expect(research.fields.some((field) => field.key === 'fit')).toBe(true);
  });

  it('still refuses a numeric quality tier (§8)', async () => {
    const campaign = await createCampaign('tier');
    const res = await request(h.app)
      .post('/api/admin/affiliates')
      .set('cookie', admin.cookie)
      .send({
        ...RECRUIT,
        legalName: 'Rowan Tier',
        email: `tier-${randomUUID()}@example.com`,
        campaignId: campaign.campaignId,
        qualityTier: '3',
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/tier/i);
  });
});

/* ── A note on what is NOT asserted here ──────────────────────────────────── */

/*
 * The campaign-relationship views, the post review, and the account-standing
 * route are Stage 2 and Stage 3. `recordCreatorAccessAction` is exercised above
 * as a service because the workspace already derives account state from it;
 * its ROUTE, its freshness gate, and the `/api/creator` standing gate arrive
 * with Stage 3 and are asserted there. A test that drove a route that does not
 * exist would be a claim that it does (§1.4).
 */

/* ── §26.7's account standing, and the gate it decides ────────────────────── */

describe('§26.7 — account standing is an access decision, per request', () => {
  it('suspends, and the Creator stops reaching /api/creator on the next call', async () => {
    const campaign = await createCampaign('standing');
    const { prospectId, associationId } = await recruit(campaign.campaignId, 'standing');

    // A claimed account, so there is a session to refuse. The signup profile is
    // what carries the account identity — `affiliate_id` is the PROSPECT id.
    const creator = await seedUser(h, 'affiliate', 'standing-creator');
    const creatorCookie = await signInPlain(h, creator.email);
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId,
      associationId,
      claimedUserId: creator.id,
      claimedAt: new Date(),
      updatedBy: 'user:test',
    });

    // Before: the Creator reaches their own surface.
    await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', creatorCookie)
      .expect(200);

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({
        action: 'suspend',
        reason: 'Reviewing a disclosed conflict before the relationship continues.',
        reviewOwner: 'Ada Admin',
      })
      .expect(200);

    // After: the same session is refused, with §27.1's two promises.
    const refused = await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', creatorCookie)
      .expect(403);
    expect((refused.body as { error: string }).error).toBe('account_suspended');
    expect((refused.body as { owner: string }).owner).toBe('Ada Admin');

    // And a restore lets them back in, on the next call.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'restore', reason: 'Review closed; nothing was substantiated.' })
      .expect(200);

    await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', creatorCookie)
      .expect(200);
  });

  it('binds a suspension recorded BEFORE the account was claimed', async () => {
    const campaign = await createCampaign('pre-claim');
    const { prospectId, associationId } = await recruit(campaign.campaignId, 'pre-claim');

    // The invitation is live and worth stopping, so a suspension before the
    // claim is legal — `affiliate_access_actions.user_id` is nullable for it.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({
        action: 'suspend',
        reason: 'Sanctions research is outstanding.',
        reviewOwner: 'Ada Admin',
      })
      .expect(200);

    const creator = await seedUser(h, 'affiliate', 'pre-claim-creator');
    const creatorCookie = await signInPlain(h, creator.email);
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId,
      associationId,
      claimedUserId: creator.id,
      claimedAt: new Date(),
      updatedBy: 'user:test',
    });

    // The gate matches through the prospect, so the earlier decision binds.
    await request(h.app)
      .get('/api/creator/campaigns')
      .set('cookie', creatorCookie)
      .expect(403);
  });

  it('never lets a suspended Creator be recorded as banned', async () => {
    const campaign = await createCampaign('no-ban-route');
    const { prospectId } = await recruit(campaign.campaignId, 'no-ban-route');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'ban', reason: 'Nope.', reviewOwner: 'Ada Admin' })
      .expect(422);
    expect((res.body as { whatHappened: string }).whatHappened).toContain(
      'no permanent Creator sanction',
    );
  });

  it('refuses a suspension with no named review owner', async () => {
    const campaign = await createCampaign('no-owner');
    const { prospectId } = await recruit(campaign.campaignId, 'no-owner');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({ action: 'suspend', reason: 'Reviewing.' })
      .expect(422);
    // §27.1 asks a suspended person who owns the review. A suspension with no
    // owner is a promise nobody is on the hook for.
    expect((res.body as { whatHappened: string }).whatHappened).toContain('who owns the review');
  });

  it('takes the freshness gate, because it changes standing', async () => {
    const campaign = await createCampaign('access-fresh');
    const { prospectId } = await recruit(campaign.campaignId, 'access-fresh');

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', staleAdmin.cookie)
      .send({ action: 'suspend', reason: 'Reviewing.', reviewOwner: 'Ada Admin' })
      .expect(403);
  });

  it('surfaces the standing and the §29 records without merging them', async () => {
    const campaign = await createCampaign('standing-pane');
    const { prospectId } = await recruit(campaign.campaignId, 'standing-pane');

    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/access`)
      .set('cookie', admin.cookie)
      .send({
        action: 'suspend',
        reason: 'Reviewing a disclosed conflict.',
        reviewOwner: 'Ada Admin',
      })
      .expect(200);

    const detail = await readWorkspace(prospectId);
    expect(detail.standing.account.state).toBe('Access suspended');
    expect(detail.standing.account.latest?.reviewOwner).toBe('Ada Admin');
    // The two scopes are separate lists. An account suspension is not a §29
    // enforcement action, and reading them as one is the mistake the pane
    // exists to prevent.
    expect(detail.standing.enforcement).toHaveLength(0);
    expect(detail.standing.disclosures).toHaveLength(0);
  });
});

/* ── Migration 0048: the six record families hold their own rules ─────────── */

describe('§24.8, §22.4, §14.2 — the 0048 records refuse what their rules refuse', () => {
  async function terminationSeed() {
    const campaign = await createCampaign(`term-${randomUUID().slice(0, 6)}`);
    const creator = await recruit(campaign.campaignId, `term-${randomUUID().slice(0, 6)}`);
    return creator;
  }

  it('CHECK-matrixes the termination money treatment to its §24.8 cause', async () => {
    const { associationId } = await terminationSeed();

    // §33.9.3's most tempting wrong simplification, unrepresentable here too:
    // a Founder-caused termination cannot record cancel_unpaid_invalid.
    await expect(
      h.pool.query(
        `INSERT INTO association_termination_requests
           (association_id, reason, effective_at, cause, money_treatment, received_via, requested_at, recorded_by)
         VALUES ($1, 'Founder ended the campaign direction.', now(), 'founder_or_product',
                 'cancel_unpaid_invalid', 'support case', now(), 'Ada Admin')`,
        [associationId],
      ),
    ).rejects.toThrow(/association_termination_requests_cause_matrix/);

    // The same cause with a treatment its register row permits records fine.
    await h.pool.query(
      `INSERT INTO association_termination_requests
         (association_id, reason, effective_at, cause, money_treatment, received_via, requested_at, recorded_by)
       VALUES ($1, 'Founder ended the campaign direction.', now(), 'founder_or_product',
               'earnings_remain', 'support case', now(), 'Ada Admin')`,
      [associationId],
    );
  });

  it('allows one open termination request per relationship, and the decision is write-once', async () => {
    const { associationId } = await terminationSeed();
    await h.pool.query(
      `INSERT INTO association_termination_requests
         (association_id, reason, effective_at, cause, money_treatment, received_via, requested_at, recorded_by)
       VALUES ($1, 'Affiliate asked to end the partnership.', now(), 'proovd_or_system_error',
               'not_attributed', 'email', now(), 'Ada Admin')`,
      [associationId],
    );

    // A second ask while one waits is a duplicate, not a new decision.
    await expect(
      h.pool.query(
        `INSERT INTO association_termination_requests
           (association_id, reason, effective_at, cause, money_treatment, received_via, requested_at, recorded_by)
         VALUES ($1, 'Second ask.', now(), 'proovd_or_system_error',
                 'not_attributed', 'email', now(), 'Ada Admin')`,
        [associationId],
      ),
    ).rejects.toThrow(/association_termination_requests_one_open_idx/);

    // The recorded ask is immutable even before the decision…
    await expect(
      h.pool.query(
        `UPDATE association_termination_requests SET reason = 'Reworded.' WHERE association_id = $1`,
        [associationId],
      ),
    ).rejects.toThrow(/immutable/);

    // …the decision arrives whole…
    await expect(
      h.pool.query(
        `UPDATE association_termination_requests SET decision = 'declined' WHERE association_id = $1`,
        [associationId],
      ),
    ).rejects.toThrow(/association_termination_requests_decision_whole/);
    await h.pool.query(
      `UPDATE association_termination_requests
         SET decision = 'declined', decision_note = 'The partnership continues.',
             decided_by = 'Ada Admin', decided_at = now()
       WHERE association_id = $1`,
      [associationId],
    );

    // …and a decided request cannot be re-decided, whoever writes the SQL.
    await expect(
      h.pool.query(
        `UPDATE association_termination_requests
           SET decision = 'applied', decision_note = 'Changed my mind.',
               decided_by = 'Ada Admin', decided_at = now()
         WHERE association_id = $1`,
        [associationId],
      ),
    ).rejects.toThrow(/decided request cannot be changed/);
  });

  it('ties a deliverable waiver to its named recorder and reason, both ways', async () => {
    const { associationId } = await terminationSeed();
    const deliverable = await h.pool.query(
      `INSERT INTO association_deliverables (association_id, title, source, created_by)
       VALUES ($1, 'Launch post', 'Accepted agreement', 'Ada Admin') RETURNING id`,
      [associationId],
    );
    const deliverableId = (deliverable.rows[0] as { id: string }).id;

    // A waiver with no named recorder is a decision nobody made.
    await expect(
      h.pool.query(
        `INSERT INTO association_deliverable_decisions (deliverable_id, outcome, findings, decided_by)
         VALUES ($1, 'waived', 'Founder released the obligation.', 'Ada Admin')`,
        [deliverableId],
      ),
    ).rejects.toThrow(/association_deliverable_decisions_waiver_coherent/);

    // And a verified decision cannot smuggle waiver fields.
    await expect(
      h.pool.query(
        `INSERT INTO association_deliverable_decisions
           (deliverable_id, outcome, findings, waiver_recorded_by, waiver_reason, decided_by)
         VALUES ($1, 'verified', 'The post is live and meets the terms.', 'Ada Admin', 'n/a', 'Ada Admin')`,
        [deliverableId],
      ),
    ).rejects.toThrow(/association_deliverable_decisions_waiver_coherent/);

    await h.pool.query(
      `INSERT INTO association_deliverable_decisions
         (deliverable_id, outcome, findings, waiver_recorded_by, waiver_reason, decided_by)
       VALUES ($1, 'waived', 'Founder released the obligation.', 'Fiona Founder',
               'Campaign pivoted; the post is no longer wanted.', 'Ada Admin')`,
      [deliverableId],
    );
  });

  it('refuses duplicate live evidence files and makes removal one-way', async () => {
    const { prospectId } = await terminationSeed();
    const checksum = randomUUID().replaceAll('-', '');
    await h.pool.query(
      `INSERT INTO affiliate_evidence_files
         (prospect_id, category, storage_key, state, checksum_sha256, byte_size, content_type, uploaded_by)
       VALUES ($1, 'channel_permission', $2, 'stored', $3, 1024, 'image/png', 'Ada Admin')`,
      [prospectId, `affiliate-evidence/${prospectId}/${randomUUID()}`, checksum],
    );

    // §12's duplicate rule, rescoped to the person and enforced by the
    // database rather than a SELECT a concurrent request could race past.
    await expect(
      h.pool.query(
        `INSERT INTO affiliate_evidence_files
           (prospect_id, category, storage_key, state, checksum_sha256, byte_size, content_type, uploaded_by)
         VALUES ($1, 'sponsored_history', $2, 'stored', $3, 1024, 'image/png', 'Ada Admin')`,
        [prospectId, `affiliate-evidence/${prospectId}/${randomUUID()}`, checksum],
      ),
    ).rejects.toThrow(/affiliate_evidence_files_duplicate_idx/);

    await h.pool.query(
      `UPDATE affiliate_evidence_files SET removed_at = now(), removed_by = 'Ada Admin'
       WHERE prospect_id = $1`,
      [prospectId],
    );
    // Removing frees the checksum for a correction…
    await h.pool.query(
      `INSERT INTO affiliate_evidence_files
         (prospect_id, category, storage_key, state, checksum_sha256, byte_size, content_type, uploaded_by)
       VALUES ($1, 'channel_permission', $2, 'stored', $3, 1024, 'image/png', 'Ada Admin')`,
      [prospectId, `affiliate-evidence/${prospectId}/${randomUUID()}`, checksum],
    );
    // …and a removal can never be undone: an evidence file that can quietly
    // come back is one whose absence nobody can rely on.
    await expect(
      h.pool.query(
        `UPDATE affiliate_evidence_files SET removed_at = NULL, removed_by = NULL
         WHERE prospect_id = $1 AND removed_at IS NOT NULL`,
        [prospectId],
      ),
    ).rejects.toThrow(/removal cannot be undone/);
  });

  it('stores no proposal access, no acceptance, and no schedule anywhere in 0048', async () => {
    // §1.8 item 4: the Standard/Restricted badge is derived from §29 records.
    // The strongest form of "never stored" is a column that does not exist.
    const proposalAccess = await h.pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE column_name LIKE '%proposal_access%'`,
    );
    expect(proposalAccess.rows).toHaveLength(0);

    // Admin mediates and never agrees: the mediation note has no acceptance,
    // outcome, or decision column a later phase could read as an answer.
    const mediation = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'proposal_mediation_notes'
         AND (column_name LIKE '%accept%' OR column_name LIKE '%outcome%' OR column_name LIKE '%decision%')`,
    );
    expect(mediation.rows).toHaveLength(0);

    // §30: no schedule-shaped column on any of the six families, so there is
    // nowhere to record a cadence and nothing a job could sweep.
    const schedule = await h.pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('affiliate_evidence_files', 'affiliate_evidence_verifications',
                            'association_deliverables', 'association_deliverable_evidence',
                            'association_deliverable_decisions', 'association_availability_verifications',
                            'proposal_mediation_notes', 'association_termination_requests')
         AND (column_name LIKE '%remind%' OR column_name LIKE '%recurrence%'
              OR column_name LIKE '%next_send%' OR column_name LIKE '%cadence%'
              OR column_name LIKE '%snooze%' OR column_name LIKE '%escalate%')`,
    );
    expect(schedule.rows).toHaveLength(0);
  });

  it('grants the app role exactly what each family permits', async () => {
    const grants = await h.pool.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'proovd_app'
         AND table_name IN ('affiliate_evidence_verifications', 'association_deliverables',
                            'association_deliverable_evidence', 'association_deliverable_decisions',
                            'association_availability_verifications', 'proposal_mediation_notes')`,
    );
    // Five insert-only families (plus the evidence receipts): SELECT and
    // INSERT, never UPDATE or DELETE — a decision an Admin can rewrite
    // afterwards is not the record it claims to be.
    for (const row of grants.rows as { table_name: string; privilege_type: string }[]) {
      expect(['SELECT', 'INSERT'], row.table_name).toContain(row.privilege_type);
    }

    // The termination request's UPDATE grant names the four decision columns
    // and nothing else — the recorded ask is outside every grant.
    const columnGrants = await h.pool.query(
      `SELECT column_name FROM information_schema.role_column_grants
       WHERE grantee = 'proovd_app' AND table_name = 'association_termination_requests'
         AND privilege_type = 'UPDATE'
       ORDER BY column_name`,
    );
    expect((columnGrants.rows as { column_name: string }[]).map((r) => r.column_name)).toEqual([
      'decided_at',
      'decided_by',
      'decision',
      'decision_note',
    ]);
  });

  it('serves the three Selected-relationship facts from the record read', async () => {
    const { prospectId } = await terminationSeed();
    const detail = await readWorkspace(prospectId);
    expect(detail.relationships).toHaveLength(1);
    const rel = detail.relationships[0];
    // A fresh prospect-state relationship: nothing agreed, no link minted, and
    // completion is honestly "not due" rather than a zero (§16a).
    expect(rel.agreement).toBe('Not started');
    expect(rel.trackingLink).toBe('No Affiliate link yet');
    expect(rel.completion).toBe('Not due before close');
  });
});

/* ── Session B: the person-level writes, and what they refuse ─────────────── */

describe('§5.3, §11, §5.5, §13 — the Session B machine (metric trail, corrections, asks, re-read)', () => {
  async function claimedSeed(label: string) {
    const campaign = await createCampaign(label);
    const { prospectId, associationId } = await recruit(campaign.campaignId, label);
    const account = await seedUser(h, 'affiliate', `${label}-claimed`);
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId,
      associationId,
      claimedUserId: account.id,
      claimedAt: new Date(),
      email: account.email,
      publicHandle: '@claimed.handle',
      legalName: 'Claimed Person',
      updatedBy: 'user:test',
    });
    return { prospectId, associationId, account };
  }

  it('records a per-metric decision on the 0048 trail, and a request sends the §11 ask', async () => {
    const campaign = await createCampaign('metrics');
    const { prospectId } = await recruit(campaign.campaignId, 'metrics');

    // GATED: a stale session is refused before anything records (§33.12.4).
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/evidence/metric-decision`)
      .set('cookie', staleAdmin.cookie)
      .send({ metric: 'audience_size', decision: 'verified', detail: 'x' })
      .expect(403);

    // A made-up metric and a blank detail are refused by name.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/evidence/metric-decision`)
      .set('cookie', admin.cookie)
      .send({ metric: 'vibes', decision: 'verified', detail: 'Looks good.' })
      .expect(422);
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/evidence/metric-decision`)
      .set('cookie', admin.cookie)
      .send({ metric: 'audience_size', decision: 'verified', detail: '   ' })
      .expect(422);

    // Verified records the trail and sends nothing.
    const before = h.sentEmails.messages.length;
    const verified = await request(h.app)
      .post(`${'/api/admin/creators/'}${prospectId}/evidence/metric-decision`)
      .set('cookie', admin.cookie)
      .send({
        metric: 'audience_size',
        decision: 'verified',
        detail: 'Analytics screenshot matches the recorded audience size.',
      })
      .expect(200);
    expect((verified.body as { ask: { sent: boolean } }).ask.sent).toBe(false);
    expect(h.sentEmails.messages.length).toBe(before);

    // More-evidence-needed records AND sends, deduped on the recorded row —
    // and the message carries the Admin's exact ask.
    const asked = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/evidence/metric-decision`)
      .set('cookie', admin.cookie)
      .send({
        metric: 'engagement_rate',
        decision: 'more_evidence_needed',
        detail: 'Share a current analytics screenshot for the channel, taken this month.',
      })
      .expect(200);
    expect((asked.body as { ask: { sent: boolean } }).ask.sent).toBe(true);
    const sent = h.sentEmails.messages.at(-1)!;
    expect(sent.subject).toContain('review one detail');
    expect(sent.text).toContain('taken this month');

    const rows = await h.db
      .select()
      .from(affiliateEvidenceVerifications)
      .where(eq(affiliateEvidenceVerifications.prospectId, prospectId));
    expect(rows).toHaveLength(2);

    // The record read composes the latest decision per metric, in register
    // order, with the undecided three as their honest absence (§16a).
    const detail = await readWorkspace(prospectId);
    expect(detail.profile.metricDecisions).toHaveLength(5);
    const audience = detail.profile.metricDecisions.find((m) => m.metric === 'audience_size')!;
    expect(audience.decision).toBe('verified');
    expect(
      detail.profile.metricDecisions.filter((m) => m.decision === null),
    ).toHaveLength(3);
  });

  it('corrects a confirmed account field with the prior read from the row, and refuses pre-claim', async () => {
    const campaign = await createCampaign('correct');
    const { prospectId } = await recruit(campaign.campaignId, 'correct');

    // Pre-claim: nothing here has been confirmed by the Affiliate, so the
    // correction route refuses and points at the research record.
    const preClaim = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/account-correction`)
      .set('cookie', admin.cookie)
      .send({ field: 'username', newValue: '@new.handle', reason: 'Handle changed.' })
      .expect(422);
    expect((preClaim.body as { whatHappened: string }).whatHappened).toContain('research record');

    const { prospectId: claimedId } = await claimedSeed('correct-claimed');

    // A field outside the register, and a blank reason, are refused.
    await request(h.app)
      .post(`/api/admin/creators/${claimedId}/account-correction`)
      .set('cookie', admin.cookie)
      .send({ field: 'quality_tier', newValue: 'Tier A', reason: 'No.' })
      .expect(422);
    await request(h.app)
      .post(`/api/admin/creators/${claimedId}/account-correction`)
      .set('cookie', admin.cookie)
      .send({ field: 'username', newValue: '@corrected.handle', reason: '  ' })
      .expect(422);

    await request(h.app)
      .post(`/api/admin/creators/${claimedId}/account-correction`)
      .set('cookie', admin.cookie)
      .send({
        field: 'username',
        newValue: '@corrected.handle',
        reason: 'The platform handle changed and the Affiliate confirmed the new one by email.',
      })
      .expect(200);

    // §33.12.4: the audit's before/after is the ROW's answer, not the caller's.
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetId, claimedId), eq(auditEvents.action, 'creator.account_corrected')),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].priorValue).toEqual({ field: 'username', value: '@claimed.handle' });
    expect(audits[0].newValue).toEqual({ field: 'username', value: '@corrected.handle' });

    const [profile] = await h.db
      .select({ publicHandle: affiliateSignupProfiles.publicHandle })
      .from(affiliateSignupProfiles)
      .where(eq(affiliateSignupProfiles.prospectId, claimedId));
    expect(profile.publicHandle).toBe('@corrected.handle');
  });

  it('records the field-level §11 ask and sends it keyed on the recorded row', async () => {
    const { prospectId } = await claimedSeed('ask');

    const before = h.sentEmails.messages.length;
    const first = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/correction-request`)
      .set('cookie', admin.cookie)
      .send({
        subjectLabel: 'Username · @claimed.handle',
        note: 'The handle appears to have changed on the platform — confirm the current one.',
      })
      .expect(200);
    expect((first.body as { ask: { sent: boolean } }).ask.sent).toBe(true);
    expect(h.sentEmails.messages.length).toBe(before + 1);
    const message = h.sentEmails.messages.at(-1)!;
    expect(message.text).toContain('current value stays until you supply a correction');

    // A second deliberate ask is a second message (§7's resend rule): each ask
    // is its own recorded row, so the dedup key never swallows it.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/correction-request`)
      .set('cookie', admin.cookie)
      .send({ subjectLabel: 'Email · old@example.com', note: 'Bounced twice this week.' })
      .expect(200);
    expect(h.sentEmails.messages.length).toBe(before + 2);

    // A blank note is refused — the Affiliate reads that sentence.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/correction-request`)
      .set('cookie', admin.cookie)
      .send({ subjectLabel: 'Email', note: '   ' })
      .expect(422);
  });

  it('asks for recovery through the ONE reset path, and refuses when nobody claimed', async () => {
    const campaign = await createCampaign('recovery');
    const { prospectId } = await recruit(campaign.campaignId, 'recovery');

    // §1.4: there is no password to reset before the claim.
    const refused = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/password-recovery`)
      .set('cookie', admin.cookie)
      .expect(422);
    expect((refused.body as { whatHappened: string }).whatHappened).toContain('claimed');

    const { prospectId: claimedId, account } = await claimedSeed('recovery-claimed');
    const before = h.resetLinks.length;
    await request(h.app)
      .post(`/api/admin/creators/${claimedId}/password-recovery`)
      .set('cookie', admin.cookie)
      .expect(200);

    // The link came out of Better Auth's own reset flow — the harness captures
    // what `sendResetPassword` was handed, which is the ONE path §5.5 has.
    expect(h.resetLinks.length).toBe(before + 1);
    expect(h.resetLinks.at(-1)!.email).toBe(account.email);

    // The raw link appears nowhere in the audit record (§28.1).
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, claimedId),
          eq(auditEvents.action, 'creator.password_recovery_sent'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain(h.resetLinks.at(-1)!.url);
  });

  it('chooses the §27 key by the account role inside the one reset sender', async () => {
    // The five-part chain's sender, driven directly: an Affiliate's reset is
    // recorded under THEIR audience key, because Phase 22c's history filters
    // on the prefix and a reset filed under `founder_*` would be invisible on
    // the person's own notification history.
    const { sendPasswordReset } = await import('../notifications/customer-remaining.js');
    const { createNotifier } = await import('../notifications/send.js');
    const captured: string[] = [];
    const notifier = createNotifier({
      db: h.db,
      transport: {
        async send() {
          return { providerId: `probe-${captured.length}` };
        },
      },
      audit: async () => {},
    });

    const affiliateAccount = await seedUser(h, 'affiliate', 'reset-key-affiliate');
    await sendPasswordReset(
      {
        db: h.db,
        notifier,
        context: { appBaseUrl: 'http://localhost', supportEmail: 's@x.co', fromAddress: 'f@x.co' },
        authSecret: 'test-secret-for-reset-ids',
      },
      { email: affiliateAccount.email, name: null, url: 'http://localhost/reset/affiliate-probe' },
    );
    const founderAccount = await seedUser(h, 'founder', 'reset-key-founder');
    await sendPasswordReset(
      {
        db: h.db,
        notifier,
        context: { appBaseUrl: 'http://localhost', supportEmail: 's@x.co', fromAddress: 'f@x.co' },
        authSecret: 'test-secret-for-reset-ids',
      },
      { email: founderAccount.email, name: null, url: 'http://localhost/reset/founder-probe' },
    );

    const deliveries = await h.pool.query(
      `SELECT event_key, target FROM notification_deliveries WHERE target IN ($1, $2)`,
      [affiliateAccount.email, founderAccount.email],
    );
    const byTarget = new Map(
      (deliveries.rows as { event_key: string; target: string }[]).map((r) => [r.target, r.event_key]),
    );
    expect(byTarget.get(affiliateAccount.email)).toBe('affiliate_password_reset');
    expect(byTarget.get(founderAccount.email)).toBe('founder_password_reset');
  });

  it('refuses an evidence presign honestly while storage is unconfigured, over HTTP', async () => {
    const campaign = await createCampaign('evidence-503');
    const { prospectId } = await recruit(campaign.campaignId, 'evidence-503');

    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/evidence/uploads`)
      .set('cookie', admin.cookie)
      .send({
        category: 'channel_permission',
        contentType: 'image/png',
        byteSize: 1024,
        checksumSha256: 'a'.repeat(64),
      })
      .expect(503);
    expect((res.body as { whatHappened: string }).whatHappened).toContain('Track A4');
    // The read says the same thing, so the surface never offers a dead control.
    const detail = await readWorkspace(prospectId);
    expect(detail.profile.evidenceFiles.available).toBe(false);
    expect(detail.profile.evidenceFiles.waitingOn).toContain('Track A4');
  });

  it('runs the Phase 09a three steps against the 0048 file record, and the bytes decide', async () => {
    const campaign = await createCampaign('evidence-bytes');
    const { prospectId } = await recruit(campaign.campaignId, 'evidence-bytes');
    const { createMemoryStorage } = await import('../storage/object-storage.js');
    const { requestEvidenceUpload, verifyEvidenceUpload, removeEvidenceFile } = await import(
      '../affiliates/workspace/evidence.js'
    );
    const storage = createMemoryStorage();
    const who = { actor: 'user:test-admin', mfaContext: 'test', reauthContext: 'test' };

    // A real 400×1 PNG-shaped payload is more than this needs: the memory
    // storage returns whatever was put, and `inspectMedia` decides from the
    // bytes — so a payload that is NOT a PNG under a PNG declaration must land
    // `rejected`, which is exactly step 3's job.
    const notAPng = Buffer.from('<html>this is not an image</html>');
    const { createHash } = await import('node:crypto');
    const checksum = createHash('sha256').update(notAPng).digest('hex');

    const presigned = await requestEvidenceUpload(
      { db: h.db, storage },
      {
        prospectId,
        category: 'channel_permission',
        contentType: 'image/png',
        byteSize: notAPng.byteLength,
        checksumSha256: checksum,
        originalFilename: 'analytics.png',
        who,
      },
    );
    if (!presigned.ok) throw new Error(presigned.message);

    const [fileRow] = await h.db
      .select()
      .from(affiliateEvidenceFiles)
      .where(eq(affiliateEvidenceFiles.id, presigned.fileId));
    expect(fileRow.state).toBe('pending');
    // The key derives from ids and a UUID — never from the filename.
    expect(fileRow.storageKey).not.toContain('analytics');

    storage.put(fileRow.storageKey, 'image/png', notAPng);
    const verified = await verifyEvidenceUpload(
      { db: h.db, storage },
      { prospectId, fileId: presigned.fileId, who },
    );
    if (!verified.ok) throw new Error(verified.message);
    expect(verified.state).toBe('rejected');
    expect(verified.rejection).toBe('file_unreadable');

    // The same checksum is refused while the first row is live…
    const duplicate = await requestEvidenceUpload(
      { db: h.db, storage },
      {
        prospectId,
        category: 'channel_permission',
        contentType: 'image/png',
        byteSize: notAPng.byteLength,
        checksumSha256: checksum,
        originalFilename: 'again.png',
        who,
      },
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('duplicate');

    // …and permitted again after a one-way removal — a correction, not a
    // duplicate (the §12 arrangement).
    const removed = await removeEvidenceFile(
      { db: h.db },
      { prospectId, fileId: presigned.fileId, reason: 'Wrong screenshot.', who },
    );
    expect(removed.ok).toBe(true);
    const again = await requestEvidenceUpload(
      { db: h.db, storage },
      {
        prospectId,
        category: 'channel_permission',
        contentType: 'image/png',
        byteSize: notAPng.byteLength,
        checksumSha256: checksum,
        originalFilename: 'corrected.png',
        who,
      },
    );
    expect(again.ok).toBe(true);
  });

  it('re-reads the provider or refuses with the reason, and stays ungated', async () => {
    const { prospectId } = await claimedSeed('stripe-refresh');

    // The harness deliberately wires no Stripe client, so the refusal names
    // exactly that (§1.4 — the block shows what the provider last reported).
    // A STALE session gets the same 422, not a 403: the route is ungated and
    // registered, because it writes only what Stripe reports about Stripe's
    // own fact. With a gateway configured, `reconcileAccount` is Phase 10b's
    // own reconciliation path, proved by `stripe-onboarding.test.ts`.
    const stale = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/stripe-refresh`)
      .set('cookie', staleAdmin.cookie)
      .expect(422);
    expect((stale.body as { whatHappened: string }).whatHappened).toContain('no Stripe client');
  });

  it('derives proposal access from §29, and an overturned appeal lifts it', async () => {
    const campaign = await createCampaign('access-derive');
    const { prospectId, associationId } = await recruit(campaign.campaignId, 'access-derive');

    const before = await readWorkspace(prospectId);
    expect(before.profile.proposalAccess.key).toBe('standard');

    // A §29 restrict_bidding action, recorded with its five statement fields.
    await request(h.app)
      .post(`/api/admin/associations/${associationId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        actionKind: 'restrict_bidding',
        reasonCategory: 'aup_breach',
        internalReason: 'Repeated policy-invalid proposals.',
        evidenceAndBehavior: 'Three proposals above the §14.3 ceiling in one week.',
        ruleViolated: 'Proposals must fit the accepted compensation matrix.',
        immediateEffect: 'New proposal bids are restricted on this campaign.',
        correctionPath: 'Submit proposals within the stated matrix.',
        humanRoute: 'Reply to this notice to reach a person.',
      })
      .expect(201);

    const restricted = await readWorkspace(prospectId);
    expect(restricted.profile.proposalAccess.key).toBe('restricted');
    expect(restricted.profile.proposalAccess.derivedFrom).toContain('Restrict bidding');

    // No column stores it — the badge is a read over §29's records (0048's
    // header states the absence).
    const columns = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('affiliate_prospects', 'affiliate_signup_profiles')
         AND column_name LIKE '%proposal_access%'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it('serves the agreements block and the invitation lifecycle facts from stored records', async () => {
    const { prospectId } = await claimedSeed('agreements');
    const detail = await readWorkspace(prospectId);

    // Every §31.4 document is draft, so there is nothing a §29.8 requirement
    // could cite — the payload says so by carrying no published versions.
    expect(detail.profile.agreements.publishedVersions).toHaveLength(0);
    expect(detail.profile.agreements.policyState).toBe('accepted');
    expect(detail.profile.agreements.perCampaign).toHaveLength(1);

    // The lifecycle facts are stored instants or their honest absence; the
    // claim instant is the signup profile's own record.
    const invitation = detail.profile.invitations[0];
    expect(invitation.createdAt).toBeTruthy();
    expect(invitation.claimedAt).toBeTruthy();
    expect(invitation.signupStartedAt).toBeNull();
  });
});

/* ── Session C: the payout reminder, case intake, and communications ──────── */

describe('§13, §26.7, §27 — the Session C person-level machine', () => {
  async function claimedSeedC(label: string) {
    const campaign = await createCampaign(label);
    const { prospectId, associationId } = await recruit(campaign.campaignId, label);
    const account = await seedUser(h, 'affiliate', `${label}-claimed`);
    await h.db.insert(affiliateSignupProfiles).values({
      prospectId,
      associationId,
      claimedUserId: account.id,
      claimedAt: new Date(),
      email: account.email,
      publicHandle: '@claimed.handle',
      legalName: 'Claimed Person',
      updatedBy: 'user:test',
    });
    return { prospectId, associationId, account };
  }

  it('refuses a payout reminder unless Stripe genuinely has something outstanding', async () => {
    const { prospectId } = await claimedSeedC('remind-none');

    // No connected account at all — there is nothing to remind anyone about.
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/payout-reminder`)
      .set('cookie', admin.cookie)
      .expect(422);
    expect((res.body as { whatHappened: string }).whatHappened).toContain('No payout account');
  });

  it('sends the EXISTING §27 key, records the ask first, and a second ask is a second message', async () => {
    const { prospectId, account } = await claimedSeedC('remind');
    const stripeAccountId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await h.db
      .update(affiliateSignupProfiles)
      .set({ payoutStatus: 'requirements_due', connectedAccountId: stripeAccountId })
      .where(eq(affiliateSignupProfiles.prospectId, prospectId));
    await h.db.insert(stripeConnectedAccounts).values({
      stripeAccountId,
      mode: 'test',
      role: 'affiliate_recipient',
      ownerUserId: account.id,
      state: 'more_information_required',
      requirementsPastDue: ['external_account'],
      requirementsCurrentlyDue: ['individual.id_number'],
    });

    // GATED — it reaches a real person's inbox.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/payout-reminder`)
      .set('cookie', staleAdmin.cookie)
      .expect(403);

    const before = h.sentEmails.messages.length;
    const first = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/payout-reminder`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect((first.body as { ask: { sent: boolean } }).ask.sent).toBe(true);

    const sent = h.sentEmails.messages.slice(before).filter((m) => m.to === account.email);
    expect(sent).toHaveLength(1);
    // §13: the exact missing requirement, named — never "more information".
    expect(sent[0]!.text).toContain('external_account');
    expect(sent[0]!.subject).toContain('payout account');

    // The delivery row carries the EXISTING key, deduped on the recorded ask —
    // so a deliberate second ask is a second message (§7's resend rule).
    const second = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/payout-reminder`)
      .set('cookie', admin.cookie)
      .expect(200);
    expect((second.body as { ask: { sent: boolean } }).ask.sent).toBe(true);

    const deliveries = await h.pool.query(
      `SELECT event_key, entity_type FROM notification_deliveries WHERE target = $1 AND event_key = 'affiliate_connected_account_info_required'`,
      [account.email],
    );
    expect(deliveries.rows).toHaveLength(2);
    expect(deliveries.rows[0].entity_type).toBe('affiliate_payout_reminder');
  });

  it('opens a §26.7 case through the ONE intake — born with its reference and calendar promise', async () => {
    const campaign = await createCampaign('case-preclaim');
    const { prospectId: unclaimed } = await recruit(campaign.campaignId, 'case-preclaim');

    // Pre-claim there is no requester account to anchor a case on (§1.4).
    await request(h.app)
      .post(`/api/admin/creators/${unclaimed}/support-case`)
      .set('cookie', admin.cookie)
      .send({ topic: 'account_access', message: 'Cannot sign in.' })
      .expect(422);

    const { prospectId, associationId } = await claimedSeedC('case');

    // A made-up topic is refused — §26.7's ten, one list.
    await request(h.app)
      .post(`/api/admin/creators/${prospectId}/support-case`)
      .set('cookie', admin.cookie)
      .send({ topic: 'vibes', message: 'x' })
      .expect(422);

    // UNGATED — the Support workspace's own posture for opening a case.
    const res = await request(h.app)
      .post(`/api/admin/creators/${prospectId}/support-case`)
      .set('cookie', staleAdmin.cookie)
      .send({
        topic: 'account_access',
        subject: 'Locked out after a password change',
        subcategory: 'Password reset loop',
        message: 'I changed my password and now cannot sign in at all.',
        associationId,
      })
      .expect(200);
    const body = res.body as {
      detail: CreatorWorkspaceDetail;
      opened: { caseId: string; reference: string };
    };
    expect(body.opened.reference).toMatch(/^PVD-/);

    // No second queue: the case is a `support_cases` row with §27.8's
    // business-day promise computed on the committed calendar.
    const caseRow = await h.pool.query(
      `SELECT reference, topic, subject, human_response_due_at, calendar_version, association_id
         FROM support_cases WHERE id = $1`,
      [body.opened.caseId],
    );
    expect(caseRow.rows).toHaveLength(1);
    expect(caseRow.rows[0].human_response_due_at).not.toBeNull();
    expect(caseRow.rows[0].calendar_version).toBeTruthy();
    expect(caseRow.rows[0].association_id).toBe(associationId);
    expect(caseRow.rows[0].subject).toBe('Locked out after a password change');

    // The record read lists it, and the Support-tab badge counts the same rows.
    expect(body.detail.standing.cases).toHaveLength(1);
    expect(body.detail.standing.cases[0]!.open).toBe(true);
    expect(body.detail.standing.cases[0]!.href).toBe(`/admin/support/${body.opened.caseId}`);
    expect(body.detail.header.openCases).toBe(1);

    // The absence that proves "no second queue": no affiliate-scoped case
    // table exists anywhere in the schema.
    const tables = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('affiliate_cases', 'creator_cases', 'affiliate_support_cases')`,
    );
    expect(tables.rows).toHaveLength(0);
  });

  it('lists the delivery record for the person, audience-prefixed to affiliate_*', async () => {
    const { prospectId, account } = await claimedSeedC('comms');

    await h.pool.query(
      `INSERT INTO notification_deliveries (event_key, target, entity_type, entity_id, notification_id)
       VALUES
         ('affiliate_campaign_invitation', $1, 'invitation_send', 'send-1', 'msg-1'),
         ('affiliate_password_reset', $1, 'password_reset', 'reset-1', NULL),
         ('internal_dispute_opened', $1, 'dispute', 'd-1', 'msg-2'),
         ('founder_password_reset', $1, 'password_reset', 'reset-2', 'msg-3')`,
      [account.email],
    );

    const res = await request(h.app)
      .get(`/api/admin/creators/${prospectId}`)
      .set('cookie', admin.cookie)
      .expect(200);
    const detail = res.body as CreatorWorkspaceDetail;
    const keys = detail.communications.map((entry) => entry.eventKey).sort();
    // The audience prefix keeps internal_* and every other role's mail out —
    // Phase 22c's rule, applied to the Admin read of the same record.
    expect(keys).toEqual(['affiliate_campaign_invitation', 'affiliate_password_reset']);

    // §1.4's two states: confirmed at the provider, or recorded-not-confirmed.
    const reset = detail.communications.find((e) => e.eventKey === 'affiliate_password_reset')!;
    expect(reset.confirmed).toBe(false);
    const invitation = detail.communications.find(
      (e) => e.eventKey === 'affiliate_campaign_invitation',
    )!;
    expect(invitation.confirmed).toBe(true);
  });
});
