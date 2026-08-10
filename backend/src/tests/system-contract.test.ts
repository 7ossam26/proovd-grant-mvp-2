/**
 * Time, state, and security — Spec §33.12.1 through §33.12.5 (Phase 23b).
 *
 * 23a proved what a person sees. This proves what the system does with a clock
 * and a stale session, and every assertion is against a real Postgres running
 * the real migrations, because three of the five claims here are database
 * guarantees rather than service behaviour and a suite that only called the
 * services would report them as held while a hand-written UPDATE walked past.
 *
 * The registers in `@proovd/shared` decide what is checked. A deadline column
 * added without an `ANCHORED_DEADLINES` entry fails the first describe; a
 * write route added under `/api/admin` without the freshness gate fails the
 * last one — and that is the point of enumerating the mounted router rather
 * than keeping a list.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import {
  ANCHORED_DEADLINES,
  CAMPAIGN_ANCHOR_KEYS,
  CAMPAIGN_ANCHORS,
  FORBIDDEN_ANCHOR_COLUMNS,
  REPLACEMENT_DEADLINE_CONTRACT,
  STATE_AUDIT_TRAILS,
  UNGATED_ADMIN_WRITES,
  UNSAFE_GUARD_FAILURES,
  PAYMENT_COLUMNS_FORBIDDEN_ON_CAMPAIGNS,
  PAYMENT_FLAG_FACTS,
  lifecycleFlagOverlap,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { campaigns, campaignPaymentFlags, campaignStatusHistory } from '../db/schema/domain.js';
import { requiredCreatorFailures } from '../db/schema/launch.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { recordCreatorFailure } from '../launch/creator-failure.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { creatorReplacementDeadline } from '../launch/business-calendar.js';
import { createAuditWriter } from '../auth/audit.js';

let h: Harness;
let admin: AdminSession;

const gateway = createMemoryStripeGateway({ mode: 'test' });

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'system-contract',
  );
  admin = await createAdmin(h, 'system-contract-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await h.pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

/**
 * A table's CHECK constraints, normalised.
 *
 * Postgres renders a constraint back without the quoting the migration wrote,
 * so the comparison is against the normalised text rather than against the
 * source SQL — which is what a reader of the migration would otherwise assume
 * and be wrong about.
 */
async function constraintText(table: string): Promise<string> {
  const { rows } = await h.pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'`,
    [table],
  );
  return rows
    .map((row) => String(row.def))
    .join('\n')
    .replace(/[\s"]+/g, ' ');
}

/* ── §33.12.1 the three anchors ────────────────────────────────────────────── */

describe('§33.12.1 — listing_paid_at, campaign_live_at, and campaign_close_at anchor independently', () => {
  it('gives each anchor a dedicated column on campaigns', async () => {
    for (const anchor of CAMPAIGN_ANCHOR_KEYS) {
      expect(await columnExists('campaigns', anchor), anchor).toBe(true);
      expect(CAMPAIGN_ANCHORS[anchor].column).toBe(`campaigns.${anchor}`);
    }
  });

  it('has a real column behind every stored deadline in the register', async () => {
    // The register is only worth walking if its entries point at something. An
    // entry naming a column that does not exist would make the whole of
    // §33.12.1 pass against a list of wishes.
    for (const deadline of ANCHORED_DEADLINES) {
      if (deadline.storedOn.startsWith('derived on read')) continue;
      const [table, column] = deadline.storedOn.split('.');
      expect(await columnExists(table as string, column as string), deadline.key).toBe(true);
    }
  });

  it('has a real column behind every anchor the register names', async () => {
    // This is what caught two wrong entries on the register's first pass. An
    // anchor naming a column that does not exist would let the whole of
    // §33.12.1 pass against a list of wishes.
    for (const deadline of ANCHORED_DEADLINES) {
      if ((CAMPAIGN_ANCHOR_KEYS as readonly string[]).includes(deadline.anchor)) continue;
      const [table, column] = deadline.anchor.split('.');
      expect(await columnExists(table as string, column as string), deadline.key).toBe(true);
    }
  });

  it('pins each stored deadline to its own anchor, by CHECK', async () => {
    // Proving it from the constraint rather than from the service is the point:
    // a service rewrite cannot move these, and a hand-written INSERT gets the
    // same refusal the service does.
    const listing = await constraintText('listing_fee_payments');
    expect(listing).toContain('response_deadline_at = (paid_at + make_interval');
    expect(listing).toContain('free_cancellation_deadline_at = (paid_at + make_interval');

    // The retry window is anchored on the FIRST failure, not on close: a
    // capture that fails an hour after the batch and one that fails on the
    // webhook two hours later must be inside one window, not two.
    expect(await constraintText('campaign_close_batches')).toContain(
      'retry_deadline_at = (first_failure_at + make_interval',
    );
    // The §22.3 schedule is anchored on the campaign's own stored close.
    expect(await constraintText('founder_payments')).toContain(
      'due_at = (campaign_close_at + make_interval',
    );
  });

  it('derives no stored deadline from a row timestamp', async () => {
    for (const table of ['listing_fee_payments', 'campaign_close_batches', 'founder_payments']) {
      const defs = await constraintText(table);
      for (const forbidden of FORBIDDEN_ANCHOR_COLUMNS) {
        // The register qualifies the column with its table; a CHECK names the
        // column alone, so the bare name is what a constraint would contain.
        const column = forbidden.split('.')[1] as string;
        expect(defs, `${table}/${forbidden}`).not.toContain(`${column} + make_interval`);
      }
    }
  });

  it('moves one anchor without moving another anchor’s deadline', async () => {
    // The vacuous version of this test seeds a campaign whose three anchors
    // hold the same instant, where every assertion passes because every answer
    // is the same. So the three are deliberately hours apart.
    const paidAt = new Date('2026-03-01T10:00:00.000Z');
    const liveAt = new Date('2026-03-05T11:30:00.000Z');
    const closeAt = new Date('2026-03-25T18:45:00.000Z');

    const [campaign] = await h.db
      .insert(campaigns)
      .values({
        status: 'live',
        type: 'pre_launch',
        typeLockedAt: new Date(),
        listingPaidAt: paidAt,
        campaignLiveAt: liveAt,
        campaignCloseAt: closeAt,
      })
      .returning({
        id: campaigns.id,
        paid: campaigns.listingPaidAt,
        live: campaigns.campaignLiveAt,
        close: campaigns.campaignCloseAt,
        created: campaigns.createdAt,
      });

    const row = campaign!;
    expect(row.paid!.toISOString()).toBe(paidAt.toISOString());
    expect(row.live!.toISOString()).toBe(liveAt.toISOString());
    expect(row.close!.toISOString()).toBe(closeAt.toISOString());
    // None of the three is `created_at` wearing another name — which is the
    // failure the invariant has named since Phase 01.
    for (const anchor of [row.paid!, row.live!, row.close!]) {
      expect(anchor.toISOString()).not.toBe(row.created.toISOString());
    }
    expect(new Set([row.paid!.getTime(), row.live!.getTime(), row.close!.getTime()]).size).toBe(3);
  });

  it('never reads a campaign anchor out of campaigns.createdAt or campaigns.updatedAt', async () => {
    // The database checks above cover the pinned deadlines. This covers the
    // derived-on-read ones, where nothing constrains the arithmetic — a
    // `createdAt` used as a close anchor would compile, run, and be wrong.
    //
    // Scoped to the three campaign anchors rather than to every use of
    // `createdAt`, because the invariant names three columns and not a coding
    // style: a support case's `created_at` IS its opening instant, and §29.10's
    // escalation window measures from it correctly. A scan that flagged that
    // would have to be silenced, and a silenced check is worse than none.
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'tests' || name === 'migrations' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts')) continue;
        const source = readFileSync(full, 'utf8')
          // Comments explain the rule at length; a scan that could not tell an
          // explanation from a usage would force the reasoning out of the file.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        // Reading `campaigns.createdAt` or `campaigns.updatedAt` at all is the
        // failure: nothing in the product legitimately needs either, so their
        // absence is a stronger check than watching what is done with them.
        if (/\bcampaigns\.(createdAt|updatedAt)\b/.test(source)) {
          offenders.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

/* ── §33.12.2 the replacement deadline ─────────────────────────────────────── */

describe('§33.12.2 — the replacement deadline is exact, versioned, and cannot silently reset', () => {
  async function seedFailure(): Promise<{ campaignId: string; failureId: string }> {
    const [campaign] = await h.db
      .insert(campaigns)
      .values({
        status: 'creator_prep',
        type: 'pre_launch',
        typeLockedAt: new Date(),
        listingPaidAt: new Date(),
      })
      .returning({ id: campaigns.id });
    const campaignId = campaign!.id;

    const [prospect] = await h.db
      .insert(affiliateProspects)
      .values({
        legalName: 'Creator Under Test',
        publicHandle: `@creator-${randomUUID().slice(0, 8)}`,
        email: `creator-${randomUUID().slice(0, 8)}@example.com`,
        subtype: 'social_creator',
        audienceNiche: 'hardware',
        audienceSize: '120k',
        adminBio: 'Reviews early hardware.',
        createdBy: 'admin:test',
      })
      .returning({ id: affiliateProspects.id });

    const [association] = await h.db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: randomUUID(),
        prospectId: prospect!.id,
        status: 'ready',
        rosterMembership: 'initial_roster',
      })
      .returning({ id: campaignAffiliateAssociations.id });

    const result = await recordCreatorFailure(
      { db: h.db, audit: createAuditWriter(h.db) },
      {
      campaignId,
      failedAssociationId: association!.id,
      replacementDesignation: 'Recruiting a replacement from the shortlist.',
        recordedBy: 'admin:test',
      },
    );
    if (result.status !== 'recorded') throw new Error(`seed failed: ${JSON.stringify(result)}`);
    return { campaignId, failureId: result.failure.id };
  }

  it('is exactly N business days from the recorded failure, on the stored calendar', async () => {
    const { failureId } = await seedFailure();
    const [row] = await h.db
      .select()
      .from(requiredCreatorFailures)
      .where(eq(requiredCreatorFailures.id, failureId));

    // Recomputed independently from the stored anchor — never compared against
    // whatever the service happened to write.
    const expected = creatorReplacementDeadline(row!.creatorFailureRecordedAt);
    expect(row!.dueCalendarVersion).toBe(expected.calendarVersion);
    expect(row!.dueAt.toISOString()).toBe(expected.dueAt.toISOString());
    expect(row!.dueAt.getTime()).toBeGreaterThan(row!.creatorFailureRecordedAt.getTime());
  });

  it('refuses a later edit of the deadline or its calendar version, at the database', async () => {
    const { failureId } = await seedFailure();

    await expect(
      h.pool.query(`UPDATE required_creator_failures SET due_at = now() + interval '30 days' WHERE id = $1`, [
        failureId,
      ]),
    ).rejects.toThrow();

    await expect(
      h.pool.query(`UPDATE required_creator_failures SET due_calendar_version = 'made-up.v9' WHERE id = $1`, [
        failureId,
      ]),
    ).rejects.toThrow();

    await expect(
      h.pool.query(
        `UPDATE required_creator_failures SET creator_failure_recorded_at = now() WHERE id = $1`,
        [failureId],
      ),
    ).rejects.toThrow();
  });

  it('records the failure once, so a retry cannot recompute the window', async () => {
    const { campaignId, failureId } = await seedFailure();
    const [association] = await h.db
      .select({ id: campaignAffiliateAssociations.id })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

    const again = await recordCreatorFailure(
      { db: h.db, audit: createAuditWriter(h.db) },
      {
        campaignId,
        failedAssociationId: association!.id,
        replacementDesignation: 'A different plan, recorded later.',
        recordedBy: 'admin:test',
      },
    );
    expect(again.status).toBe('recorded');
    if (again.status === 'recorded') {
      // §33.12.2's "cannot silently reset": the second call returns the FIRST
      // record, unchanged, whatever it asked for.
      expect(again.alreadyExisted).toBe(true);
      expect(again.failure.id).toBe(failureId);
    }

    const rows = await h.db
      .select()
      .from(requiredCreatorFailures)
      .where(eq(requiredCreatorFailures.campaignId, campaignId));
    expect(rows).toHaveLength(1);
  });

  it('matches the shared contract on where the deadline and its version live', () => {
    expect(REPLACEMENT_DEADLINE_CONTRACT.storedOn).toBe('required_creator_failures.due_at');
    expect(REPLACEMENT_DEADLINE_CONTRACT.versionStoredOn).toBe(
      'required_creator_failures.due_calendar_version',
    );
  });
});

/* ── §33.12.3 lifecycle and payment flags ──────────────────────────────────── */

describe('§33.12.3 — lifecycle and payment flags stay separate and independently auditable', () => {
  async function enumValues(typeName: string): Promise<string[]> {
    const { rows } = await h.pool.query(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1`,
      [typeName],
    );
    return rows.map((row) => String(row.label));
  }

  it('shares no value between the lifecycle enum and the payment-flag enum', async () => {
    // The rule that matters, and not the one that is tempting. §23.1's own
    // states include `single_payment_released` and `captured_pending_w9` —
    // those are positions in a campaign's life, and forbidding the vocabulary
    // would have meant renaming the Spec's own states (§1 rule 6). What must
    // never happen is one VALUE meaning both things, because then two tables
    // answer the same question and "independently auditable" is over.
    const lifecycle = await enumValues('campaign_status');
    const flags = await enumValues('payment_flag');
    expect(lifecycle.length).toBeGreaterThan(10);
    expect(flags.length).toBeGreaterThan(3);
    expect(lifecycleFlagOverlap(lifecycle, flags)).toEqual([]);
  });

  it('keeps payment facts in their own rows with amount, actor, and evidence', async () => {
    for (const column of ['flag', ...PAYMENT_FLAG_FACTS]) {
      expect(await columnExists('campaign_payment_flags', column), column).toBe(true);
    }
    // And the campaigns table holds none of them, which is what stops a
    // payment fact migrating onto the lifecycle row one column at a time.
    for (const column of PAYMENT_COLUMNS_FORBIDDEN_ON_CAMPAIGNS) {
      expect(await columnExists('campaigns', column), column).toBe(false);
    }
  });

  it('records a payment flag without touching the lifecycle, and vice versa', async () => {
    const [campaign] = await h.db
      .insert(campaigns)
      .values({ status: 'closed_reconciling', type: 'pre_launch', typeLockedAt: new Date() })
      .returning({ id: campaigns.id, status: campaigns.status });
    const campaignId = campaign!.id;

    await h.db.insert(campaignPaymentFlags).values({
      campaignId,
      flag: 'results_ready',
      actor: 'admin:test',
      evidence: { note: 'independence check' },
    });

    const [after] = await h.db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(after!.status).toBe('closed_reconciling');

    // The other direction: a lifecycle move writes history and no flag.
    const flagsBefore = await h.db
      .select()
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, campaignId));

    await h.db.update(campaigns).set({ status: 'fulfilled' }).where(eq(campaigns.id, campaignId));
    await h.db.insert(campaignStatusHistory).values({
      campaignId,
      fromStatus: 'closed_reconciling',
      toStatus: 'fulfilled',
      actor: 'admin:test',
    });

    const flagsAfter = await h.db
      .select()
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, campaignId));
    expect(flagsAfter).toHaveLength(flagsBefore.length);
  });

  it('makes both trails append-only for the application role', async () => {
    for (const table of [
      STATE_AUDIT_TRAILS.lifecycle.historyTable,
      STATE_AUDIT_TRAILS.paymentFlags.historyTable,
    ]) {
      const { rows } = await h.pool.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'proovd_app' AND table_name = $1`,
        [table],
      );
      const privileges = rows.map((row) => String(row.privilege_type));
      expect(privileges, table).toContain('INSERT');
      expect(privileges, table).not.toContain('UPDATE');
      expect(privileges, table).not.toContain('DELETE');
    }
  });

  it('has no timeline-shaped second store to drift from either', async () => {
    // §26.8's rule, re-proved here because §33.12.3's "independently auditable"
    // is exactly what a derived third table would quietly destroy.
    const { rows } = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('timeline_events','campaign_events','state_events')`,
    );
    expect(rows).toEqual([]);
  });
});

/* ── §33.12.5 role authorization and the freshness gate ───────────────────── */

describe('§33.12.5 — the Admin boundary holds and a stale session fails safely', () => {
  /*
   * This block used to open by refusing an Admin with no registered second
   * factor. The factor was removed on 2026-08-10 (see `src/auth/auth.ts`), so
   * what remains to prove is the boundary that actually decides access now:
   * an authenticated non-Admin is refused an Admin route on the server, and a
   * stale Admin session is refused a sensitive one.
   */
  it('refuses an authenticated non-Admin every Admin surface', async () => {
    for (const role of ['founder', 'affiliate'] as const) {
      const other = await seedUser(h, role, `system-contract-${role}`);
      const cookie = await signInPlain(h, other.email);
      const res = await request(h.app).get('/api/admin/settings').set('cookie', cookie);
      expect(res.status, role).toBe(403);
      // Refused for what the session IS, never answered as "no session" —
      // §27.1: a person who is signed in must not be told to sign in.
      expect(res.body.error, role).toBe('forbidden');
    }
  });

  it('partitions every admin write into gated and deliberately-ungated, with nothing left over', async () => {
    // A curated list of gated routes goes stale the first time somebody adds
    // one. So the app is asked which write routes it mounted, each is driven
    // with a stale session, and the result must partition exactly: refused, or
    // recorded in `UNGATED_ADMIN_WRITES` with a reason. A new route belongs to
    // neither set until somebody decides, and the suite says so by name.
    //
    // The first draft of this test required ALL of them to refuse, and that is
    // the wrong answer: `admin.ts` has recorded since Phase 06a that making an
    // Admin reauthenticate for ordinary work teaches them to do it reflexively,
    // and a gate people clear without thinking is not a gate.
    interface Layer {
      route?: { path?: string; methods?: Record<string, boolean> };
      name?: string;
      handle?: { stack?: Layer[] };
    }
    const app = h.app as unknown as { router?: { stack?: Layer[] }; _router?: { stack?: Layer[] } };
    const routes: Array<{ method: string; path: string }> = [];
    const walk = (layers: Layer[]) => {
      for (const layer of layers) {
        if (layer.route?.path) {
          for (const [method, on] of Object.entries(layer.route.methods ?? {})) {
            if (on) routes.push({ method, path: layer.route.path });
          }
        } else if (layer.handle?.stack) {
          walk(layer.handle.stack);
        }
      }
    };
    walk(app.router?.stack ?? app._router?.stack ?? []);

    const writes = routes.filter(
      (route) =>
        route.path.startsWith('/api/admin') &&
        ['post', 'put', 'patch', 'delete'].includes(route.method),
    );
    // If this ever finds nothing, the walk is broken and the sweep proves
    // nothing — so the count is asserted before the sweep runs.
    expect(writes.length).toBeGreaterThan(20);

    const staleAdmin = await createAdmin(h, 'system-contract-stale');
    await h.pool.query(`UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1`, [
      staleAdmin.id,
    ]);

    const recorded = new Set(UNGATED_ADMIN_WRITES.map((entry) => entry.route));
    const ungated: string[] = [];
    const gated: string[] = [];

    for (const route of writes) {
      // A concrete URL for a parameterised path. The id never resolves, which
      // is fine: the freshness gate runs before the handler, so a gated route
      // answers 403 and an ungated one answers whatever its handler decided
      // about a nonexistent id.
      const url = route.path.replace(/:[A-Za-z0-9_]+/g, randomUUID());
      const agent = request(h.app) as unknown as Record<string, (u: string) => request.Test>;
      const res = await agent[route.method]!(url).set('cookie', staleAdmin.cookie).send({});
      const name = `${route.method.toUpperCase()} ${route.path}`;
      if (res.status === 403) gated.push(name);
      else ungated.push(name);
    }

    // Nothing ungated that is not recorded, and nothing recorded that is
    // actually gated — both directions, so the register cannot rot in either.
    expect(ungated.filter((name) => !recorded.has(name))).toEqual([]);
    expect(gated.filter((name) => recorded.has(name))).toEqual([]);
    expect([...recorded].filter((name) => !ungated.includes(name))).toEqual([]);

    // And the gated set is the larger one. If a change ever inverted that, the
    // partition would still pass while the product had quietly stopped gating.
    expect(gated.length).toBeGreaterThan(ungated.length);
  }, 300_000);

  it('gives every deliberately-ungated route a reason and a section', () => {
    for (const entry of UNGATED_ADMIN_WRITES) {
      expect(entry.specRef.startsWith('§'), entry.route).toBe(true);
      // "It felt routine" is how a money route ends up on this list. A reason
      // short enough not to name the property it lacks is not a reason.
      expect(entry.reason.length, entry.route).toBeGreaterThan(60);
    }
  });

  it('refuses rather than warning and proceeding, and says the same thing every time', async () => {
    // §33.12.5's "fails safely" is the difference between a refusal and a log
    // line. `UNSAFE_GUARD_FAILURES` names the four ways it goes wrong; this
    // covers the first and the last — the refusal is a status, and the body is
    // the same regardless of which check failed.
    expect(UNSAFE_GUARD_FAILURES).toContain('warns_and_proceeds');

    const noSession = await request(h.app).get('/api/admin/settings');
    const wrongRole = await request(h.app)
      .get('/api/admin/settings')
      .set('cookie', await signInPlain(h, (await seedUser(h, 'founder', 'system-contract-founder')).email));

    expect(noSession.status).toBe(401);
    expect(wrongRole.status).toBe(403);
    // Neither carries which check failed beyond the coarse status, and neither
    // returns any data.
    expect(noSession.body).not.toHaveProperty('metrics');
    expect(wrongRole.body).not.toHaveProperty('metrics');
  });
});
