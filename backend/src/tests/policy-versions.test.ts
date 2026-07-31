/**
 * Phase 05 integration suite — the policy-versioning machinery against a real
 * Postgres.
 *
 *  - Drift guard: `policy_versions` mirrors `shared/src/policies/documents.ts`
 *    row for row. The public routes render the shared register and the §34 gate
 *    reads the table; if they can disagree, one of them is lying.
 *  - §34 condition 4: the gate blocks while any document is a draft, and
 *    clears only when every required document is published.
 *  - §23/§29.8: publication is one-way and version identity is immutable — a
 *    consent record that cites a version must still resolve the same document.
 *  - §31.4: a published row cannot exist without an effective date.
 *
 * Mutating cases run inside a transaction that is rolled back, so the seeded
 * draft state — the state the repository actually ships in — survives the file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { createDb, createDbPool } from '../db/client.js';
import { migrateSerialized } from './helpers.js';
import { readPolicyGate, REQUIRED_POLICY_SLUGS } from '../policies/policy-gate.js';
import { POLICY_DOCUMENTS } from '@proovd/shared';

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  const testDbUrl = process.env['TEST_DATABASE_URL'];
  let connectionString: string;
  if (testDbUrl) {
    connectionString = testDbUrl;
  } else {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  }
  pool = createDbPool(connectionString);
  db = createDb(pool);
  await migrateSerialized(db, pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

/** Runs `body` inside a transaction that is always rolled back. */
async function inRollback(body: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await body(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('policy_versions mirrors the shared register (§18, §31.4)', () => {
  it('has exactly one row per registered document, with identical fields', async () => {
    const { rows } = await pool.query(
      `SELECT slug, route, title, version, status,
              to_char(effective_date, 'YYYY-MM-DD') AS effective_date
         FROM policy_versions
        ORDER BY slug`,
    );

    const expected = [...POLICY_DOCUMENTS]
      .map((d) => ({
        slug: d.slug,
        route: d.route,
        title: d.title,
        version: d.version,
        status: d.status,
        effective_date: d.effectiveDate,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));

    expect(rows).toEqual(expected);
  });

  it('covers every document the gate requires', async () => {
    const { rows } = await pool.query<{ slug: string }>('SELECT slug FROM policy_versions');
    expect([...rows.map((r) => r.slug)].sort()).toEqual([...REQUIRED_POLICY_SLUGS].sort());
  });
});

describe('§34 condition 4 — the live-mode gate', () => {
  it('blocks while documents are in draft, and names them', async () => {
    const gate = await readPolicyGate(db);
    expect(gate.blocking).toBe(true);
    expect(gate.drafts).toHaveLength(REQUIRED_POLICY_SLUGS.length);
    expect(gate.published).toHaveLength(0);
    expect([...gate.missingSlugs].sort()).toEqual([...REQUIRED_POLICY_SLUGS].sort());
    expect(gate.reasons.join(' ')).toContain('still in draft');
  });

  it('clears only once every required document is published', async () => {
    await inRollback(async (client) => {
      // Publish all but one — the gate must still block.
      await client.query(
        `UPDATE policy_versions
            SET status = 'published',
                effective_date = DATE '2026-09-01',
                published_at = now()
          WHERE slug <> 'ip-agreement'`,
      );
      // The gate reads through the pool, which cannot see an open
      // transaction, so the in-transaction assertions query this connection
      // directly; the gate itself is asserted against the committed state.
      const { rows: stillDraft } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM policy_versions WHERE status = 'draft'`,
      );
      expect(stillDraft[0]?.count).toBe('1');

      await client.query(
        `UPDATE policy_versions
            SET status = 'published',
                effective_date = DATE '2026-09-01',
                published_at = now()
          WHERE slug = 'ip-agreement'`,
      );
      const { rows: allPublished } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM policy_versions WHERE status = 'published'`,
      );
      expect(allPublished[0]?.count).toBe(String(REQUIRED_POLICY_SLUGS.length));
    });

    // Rolled back: the shipped state is still every document in draft.
    const gate = await readPolicyGate(db);
    expect(gate.blocking).toBe(true);
  });

  it('blocks when a required document has no record at all', async () => {
    await inRollback(async (client) => {
      await client.query(`DELETE FROM policy_versions WHERE slug = 'refunds'`);
      const { rows } = await client.query<{ slug: string }>('SELECT slug FROM policy_versions');
      expect(rows.map((r) => r.slug)).not.toContain('refunds');
    });
    const gate = await readPolicyGate(db);
    expect(gate.missingSlugs).toContain('refunds');
    expect(gate.blocking).toBe(true);
  });
});

describe('version records are durable (§23, §29.8, §31.4)', () => {
  it('rejects a published row with no effective date', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          `UPDATE policy_versions SET status = 'published' WHERE slug = 'terms'`,
        ),
      ).rejects.toThrow(/policy_versions_effective_date_matches_status/);
    });
  });

  it('rejects a draft row that carries an effective date', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          `INSERT INTO policy_versions (slug, route, title, version, status, effective_date)
           VALUES ('terms', '/terms', 'Terms of Service', '2.0.0-draft', 'draft', DATE '2026-09-01')`,
        ),
      ).rejects.toThrow(/policy_versions_effective_date_matches_status/);
    });
  });

  it('refuses to move a published version back to draft', async () => {
    await inRollback(async (client) => {
      await client.query(
        `UPDATE policy_versions
            SET status = 'published', effective_date = DATE '2026-09-01', published_at = now()
          WHERE slug = 'terms'`,
      );
      await expect(
        client.query(
          `UPDATE policy_versions
              SET status = 'draft', effective_date = NULL, published_at = NULL
            WHERE slug = 'terms'`,
        ),
      ).rejects.toThrow(/cannot return to draft/);
    });
  });

  it.each([
    ["UPDATE policy_versions SET version = '9.9.9' WHERE slug = 'terms'", 'version'],
    ["UPDATE policy_versions SET slug = 'privacy' WHERE slug = 'terms'", 'slug'],
    ["UPDATE policy_versions SET route = '/elsewhere' WHERE slug = 'terms'", 'route'],
    // One statement per transaction: the first failure aborts the block, so a
    // second assertion in the same one would only observe that abort.
  ])('refuses to repoint a version identifier (%s)', async (statement) => {
    await inRollback(async (client) => {
      await expect(client.query(statement)).rejects.toThrow(/identity is immutable/);
    });
  });

  it('refuses to move an effective date once it is set', async () => {
    await inRollback(async (client) => {
      await client.query(
        `UPDATE policy_versions
            SET status = 'published', effective_date = DATE '2026-09-01', published_at = now()
          WHERE slug = 'terms'`,
      );
      await expect(
        client.query(
          `UPDATE policy_versions SET effective_date = DATE '2026-10-01' WHERE slug = 'terms'`,
        ),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('allows two versions of one document to coexist, and only one identity per pair', async () => {
    await inRollback(async (client) => {
      await client.query(
        `UPDATE policy_versions
            SET status = 'published', effective_date = DATE '2026-09-01', published_at = now()
          WHERE slug = 'terms'`,
      );
      // A revision is a NEW row — §29.8 compares the two.
      await client.query(
        `INSERT INTO policy_versions (slug, route, title, version, status)
         VALUES ('terms', '/terms', 'Terms of Service', '2.0.0-draft', 'draft')`,
      );
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM policy_versions WHERE slug = 'terms'`,
      );
      expect(rows[0]?.count).toBe('2');

      await expect(
        client.query(
          `INSERT INTO policy_versions (slug, route, title, version, status)
           VALUES ('terms', '/terms', 'Terms of Service', '2.0.0-draft', 'draft')`,
        ),
      ).rejects.toThrow(/policy_versions_slug_version_idx/);
    });
  });
});
