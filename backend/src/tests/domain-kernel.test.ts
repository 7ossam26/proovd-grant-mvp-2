/**
 * Phase 03 integration suite — the domain kernel against a real Postgres.
 *
 *  - §33.12.1: the three anchors are dedicated, independently settable
 *    columns, never derived from created_at/updated_at.
 *  - §33.12.3: campaign lifecycle and payment flags are separate and
 *    independently auditable.
 *  - §25.6: UPDATE/DELETE on audit_events fails for the application role —
 *    exercised, not assumed.
 *  - §23: history tables are append-only; a forbidden reversal is impossible
 *    at the database level, for every role.
 *  - §28.3/§33.7.7: the integrity tables enforce their uniqueness under
 *    concurrent insert.
 *  - Drift guard: the SQL enums exactly equal the shared/states arrays.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { createDb, createDbPool } from '../db/client.js';
import { migrateSerialized } from './helpers.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  reservations,
  campaignPaymentFlags,
  campaignStatus,
  associationStatus,
  reservationStatus,
  affiliateRosterStatus,
  campaignBuildStatus,
  paymentFlag,
  rosterMembership,
} from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import {
  CAMPAIGN_STATUSES,
  ASSOCIATION_STATUSES,
  RESERVATION_STATUSES,
  AFFILIATE_ROSTER_STATUSES,
  CAMPAIGN_BUILD_STATUSES,
  PAYMENT_FLAGS,
  ROSTER_MEMBERSHIPS,
} from '@proovd/shared';

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  let connectionString: string;
  const testDbUrl = process.env['TEST_DATABASE_URL'];
  if (testDbUrl) {
    connectionString = testDbUrl;
  } else {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  }
  pool = createDbPool(connectionString);
  db = createDb(pool);
  await migrateSerialized(db, pool);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

/** Runs a statement as the unprivileged application role on one connection. */
async function asAppRole<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SET ROLE proovd_app');
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

async function createCampaign(): Promise<string> {
  const [row] = await db.insert(campaigns).values({}).returning({ id: campaigns.id });
  return row!.id;
}

describe('SQL enums mirror shared/states exactly (single source of truth)', () => {
  it('campaign_status = CAMPAIGN_STATUSES', () => {
    expect(campaignStatus.enumValues).toEqual([...CAMPAIGN_STATUSES]);
  });
  it('association_status = ASSOCIATION_STATUSES', () => {
    expect(associationStatus.enumValues).toEqual([...ASSOCIATION_STATUSES]);
  });
  it('reservation_status = RESERVATION_STATUSES', () => {
    expect(reservationStatus.enumValues).toEqual([...RESERVATION_STATUSES]);
  });
  it('parallel-field enums match §23.2/§23.3/§23.4', () => {
    expect(affiliateRosterStatus.enumValues).toEqual([...AFFILIATE_ROSTER_STATUSES]);
    expect(campaignBuildStatus.enumValues).toEqual([...CAMPAIGN_BUILD_STATUSES]);
    expect(paymentFlag.enumValues).toEqual([...PAYMENT_FLAGS]);
    expect(rosterMembership.enumValues).toEqual([...ROSTER_MEMBERSHIPS]);
  });
});

describe('the three time anchors (§21, §33.12.1)', () => {
  it('are dedicated columns, null until their defining event, despite created_at existing', async () => {
    const id = await createCampaign();
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(row!.createdAt).toBeInstanceOf(Date);
    // Not inferred from created_at/updated_at — they simply do not exist yet.
    expect(row!.listingPaidAt).toBeNull();
    expect(row!.campaignLiveAt).toBeNull();
    expect(row!.campaignCloseAt).toBeNull();
  });

  it('are independently settable — each anchor moves alone', async () => {
    const id = await createCampaign();
    const listingPaidAt = new Date('2026-03-02T10:00:00Z');
    const campaignLiveAt = new Date('2026-03-06T09:00:00Z');
    const campaignCloseAt = new Date('2026-03-20T21:00:00Z');

    await db.update(campaigns).set({ listingPaidAt }).where(eq(campaigns.id, id));
    let [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(row!.listingPaidAt).toEqual(listingPaidAt);
    expect(row!.campaignLiveAt).toBeNull();
    expect(row!.campaignCloseAt).toBeNull();

    await db.update(campaigns).set({ campaignLiveAt }).where(eq(campaigns.id, id));
    await db.update(campaigns).set({ campaignCloseAt }).where(eq(campaigns.id, id));
    [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(row!.listingPaidAt).toEqual(listingPaidAt);
    expect(row!.campaignLiveAt).toEqual(campaignLiveAt);
    expect(row!.campaignCloseAt).toEqual(campaignCloseAt);
    // close is what the Founder configured, not created_at + 14 days.
    expect(row!.campaignCloseAt!.getTime()).not.toBe(
      row!.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('lifecycle vs payment flags (§23.1, §23.3, §33.12.3)', () => {
  it('payment flags are independent rows and never touch campaigns.status', async () => {
    const id = await createCampaign();
    await db.update(campaigns).set({ status: 'closed_reconciling' }).where(eq(campaigns.id, id));

    await db.insert(campaignPaymentFlags).values({
      campaignId: id,
      flag: 'results_ready',
      actor: 'admin:test',
      amountCents: null,
      evidence: { note: 'reconciliation sheet' },
      providerObjectIds: null,
    });
    await db.insert(campaignPaymentFlags).values({
      campaignId: id,
      flag: 'founder_payment_eligible',
      actor: 'admin:test',
      amountCents: 123_400n,
      evidence: { w9: 'verified' },
      providerObjectIds: { charge: 'ch_test_1' },
    });

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(campaign!.status).toBe('closed_reconciling');

    const flags = await db
      .select()
      .from(campaignPaymentFlags)
      .where(eq(campaignPaymentFlags.campaignId, id));
    expect(flags).toHaveLength(2);
    // Independently auditable: each row carries timestamp, amount, actor,
    // evidence, provider IDs (§23.3).
    const eligible = flags.find((f) => f.flag === 'founder_payment_eligible')!;
    expect(eligible.setAt).toBeInstanceOf(Date);
    expect(eligible.amountCents).toBe(123_400n);
    expect(eligible.actor).toBe('admin:test');
    expect(eligible.evidence).toEqual({ w9: 'verified' });
    expect(eligible.providerObjectIds).toEqual({ charge: 'ch_test_1' });
  });
});

describe('audit_events immutability (§25.6)', () => {
  it('the app role can insert but UPDATE and DELETE fail at the database', async () => {
    await asAppRole(async (client) => {
      const inserted = await client.query(
        `INSERT INTO audit_events (actor, target_type, target_id, action, internal_reason, customer_explanation)
         VALUES ('admin:test', 'campaign', 'c-1', 'test_action', 'internal wording', 'customer wording')
         RETURNING id`,
      );
      expect(inserted.rowCount).toBe(1);
      const id = inserted.rows[0].id;

      await expect(
        client.query(`UPDATE audit_events SET internal_reason = 'rewritten' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(`DELETE FROM audit_events WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('history tables are append-only (§23)', () => {
  it('app role inserts history but cannot rewrite or delete it', async () => {
    const campaignId = await createCampaign();
    await asAppRole(async (client) => {
      const inserted = await client.query(
        `INSERT INTO campaign_status_history (campaign_id, from_status, to_status, actor)
         VALUES ($1, NULL, 'invited_draft', 'system:test') RETURNING id`,
        [campaignId],
      );
      const id = inserted.rows[0].id;
      await expect(
        client.query(`UPDATE campaign_status_history SET to_status = 'live' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(`DELETE FROM campaign_status_history WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('a no-op "transition" row is rejected by CHECK', async () => {
    const campaignId = await createCampaign();
    await expect(
      pool.query(
        `INSERT INTO campaign_status_history (campaign_id, from_status, to_status, actor)
         VALUES ($1, 'live', 'live', 'system:test')`,
        [campaignId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('forbidden reversals are impossible at the database (§23.5)', () => {
  it('a canceled reservation can never become captured — even for a superuser', async () => {
    const campaignId = await createCampaign();
    const [res] = await db
      .insert(reservations)
      .values({ campaignId, backerIdentityId: crypto.randomUUID() })
      .returning({ id: reservations.id });

    // Legal: active → canceled.
    await pool.query(`UPDATE reservations SET status = 'reserved_canceled' WHERE id = $1`, [
      res!.id,
    ]);
    // Impossible: canceled → captured (charge after valid cancellation, §24.9).
    await expect(
      pool.query(`UPDATE reservations SET status = 'captured' WHERE id = $1`, [res!.id]),
    ).rejects.toMatchObject({ code: '23514' });
    // The SetupIntent's history stays: the row itself is untouched, terminal.
    const check = await pool.query(`SELECT status FROM reservations WHERE id = $1`, [res!.id]);
    expect(check.rows[0].status).toBe('reserved_canceled');
  });

  it('a terminal campaign cannot silently reactivate (§14.6)', async () => {
    const id = await createCampaign();
    await pool.query(`UPDATE campaigns SET status = 'ended_no_charge' WHERE id = $1`, [id]);
    await expect(
      pool.query(`UPDATE campaigns SET status = 'live' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a declined association cannot reactivate (§14.6)', async () => {
    const campaignId = await createCampaign();
    const [assoc] = await db
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId,
        affiliateId: crypto.randomUUID(),
        status: 'declined',
        rosterMembership: 'initial_roster',
      })
      .returning({ id: campaignAffiliateAssociations.id });
    await expect(
      pool.query(`UPDATE campaign_affiliate_associations SET status = 'active' WHERE id = $1`, [
        assoc!.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('integrity tables under concurrent insert (§28.3, §33.7.7)', () => {
  const CONCURRENCY = 8;

  async function race(statement: string, params: unknown[]): Promise<number> {
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => pool.query(statement, params)),
    );
    const failures = results.filter((r) => r.status === 'rejected');
    for (const f of failures) {
      expect((f as PromiseRejectedResult).reason).toMatchObject({ code: '23505' });
    }
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  it('provider_events: one row per provider event ID, duplicates conflict', async () => {
    const eventId = `evt_concurrent_${crypto.randomUUID()}`;
    const successes = await race(
      `INSERT INTO provider_events (provider, provider_event_id, event_type)
       VALUES ('stripe', $1, 'payment_intent.succeeded')`,
      [eventId],
    );
    expect(successes).toBe(1);
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM provider_events WHERE provider_event_id = $1`,
      [eventId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('provider_events: a duplicate may update audit fields, never a second row (§28.3)', async () => {
    const eventId = `evt_dup_audit_${crypto.randomUUID()}`;
    const upsert = `INSERT INTO provider_events (provider, provider_event_id) VALUES ('stripe', $1)
       ON CONFLICT (provider, provider_event_id)
       DO UPDATE SET seen_count = provider_events.seen_count + 1, last_seen_at = now()`;
    await pool.query(upsert, [eventId]);
    await pool.query(upsert, [eventId]);
    const rows = await pool.query(
      `SELECT count(*)::int AS n, max(seen_count) AS seen FROM provider_events WHERE provider_event_id = $1`,
      [eventId],
    );
    expect(rows.rows[0].n).toBe(1);
    expect(rows.rows[0].seen).toBe(2);
  });

  it('idempotency_keys: one row per domain key', async () => {
    const successes = await race(
      `INSERT INTO idempotency_keys (key, purpose) VALUES ($1, 'close_batch')`,
      [`close_batch:${crypto.randomUUID()}:attempt`],
    );
    expect(successes).toBe(1);
  });

  it('notification_deliveries: one delivery per (event, target, entity)', async () => {
    const entityId = `res-${crypto.randomUUID()}`;
    const successes = await race(
      `INSERT INTO notification_deliveries (event_key, target, entity_type, entity_id)
       VALUES ('backer_charge_receipt', 'backer@example.com', 'reservation', $1)`,
      [entityId],
    );
    expect(successes).toBe(1);
    // A different entity is a different delivery — dedup, not suppression.
    const other = await pool.query(
      `INSERT INTO notification_deliveries (event_key, target, entity_type, entity_id)
       VALUES ('backer_charge_receipt', 'backer@example.com', 'reservation', $1)`,
      [`res-${crypto.randomUUID()}`],
    );
    expect(other.rowCount).toBe(1);
  });
});
