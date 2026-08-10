import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

/**
 * ── Why this exists instead of drizzle-orm's own `migrate()` ────────────────
 *
 * drizzle-orm's runtime migrator wraps EVERY pending file in one transaction
 * (`pg-core/dialect.js`: one `session.transaction` around the whole loop).
 * drizzle-kit — the migrator every phase used in development — runs one
 * transaction per file. The repository depends on that difference in exactly
 * one place, and it is load-bearing: migration 0008 does
 * `ALTER TYPE token_scope ADD VALUE 'affiliate_invitation'` and 0009 uses the
 * new value in the `secure_tokens_scope_binding` CHECK. Postgres refuses to
 * use an enum value inside the transaction that added it (SQLSTATE 55P04), so
 * the two were deliberately split into two FILES — a split that protects
 * nothing when both files share one transaction.
 *
 * On a database migrated incrementally (each phase applying its new files in
 * its own run) the two never share a transaction and the built-in migrator
 * works. On a FRESH database — a new deployment, which is where this was
 * found — all 39 files are pending at once, 0008 and 0009 land in the same
 * transaction, and boot fails with 55P04 before the server ever listens.
 *
 * So this runner applies each migration file in its own transaction, exactly
 * as drizzle-kit does, writing the same `drizzle.__drizzle_migrations` journal
 * rows the built-in migrator writes (same schema, same hash, same
 * `created_at` = the journal's `when` millis, same newest-row comparison).
 * The two migrators are therefore interchangeable on the same database —
 * a database half-migrated by one is finished correctly by the other.
 *
 * A crash between files leaves the applied prefix committed and journaled;
 * the next boot resumes at the first unapplied file. That is strictly better
 * than the all-or-nothing wrap, whose partial work was invisible by rollback.
 *
 * The advisory lock serialises concurrent migrators — two app containers can
 * briefly coexist during a rolling deploy, and migration 0001's cluster-wide
 * `CREATE ROLE proovd_app` is exactly the statement two of them would race
 * on. Same key `helpers.ts` has always used for the test suites.
 */
export const MIGRATION_LOCK_KEY = 720_301;

export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  // Validates the folder and journal up front: a missing meta/_journal.json
  // throws here, before any lock is taken or connection state changed.
  const migrations = readMigrationFiles({ migrationsFolder });

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      // The journal table, exactly as drizzle-orm creates it.
      await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
      await client.query(
        `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );

      // drizzle's own applied-check: only the newest journal row is read, and
      // a file is pending when its folder millis are strictly newer. Kept
      // identical so this runner and the built-in migrator agree about the
      // same database.
      const { rows } = await client.query<{ created_at: string }>(
        'SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
      );
      const lastMillis = rows[0] ? Number(rows[0].created_at) : null;

      for (const migration of migrations) {
        if (lastMillis !== null && migration.folderMillis <= lastMillis) continue;

        try {
          await client.query('BEGIN');
          for (const statement of migration.sql) {
            await client.query(statement);
          }
          await client.query(
            'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
            [migration.hash, migration.folderMillis],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration failed in the file with journal timestamp ${migration.folderMillis} ` +
              `(hash ${migration.hash.slice(0, 12)}…). Earlier files are committed and ` +
              `journaled; this one rolled back whole.`,
            { cause: err },
          );
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
