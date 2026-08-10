/**
 * Test-harness migration helper. Vitest runs test files in separate forks;
 * when several suites share one TEST_DATABASE_URL, concurrent migrate()
 * calls race (CREATE EXTENSION / CREATE TABLE hit duplicate-key errors even
 * with IF NOT EXISTS). A Postgres advisory lock serializes the migrators
 * across processes.
 */

import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'db', 'migrations');

/**
 * Production and the harness now share ONE migration runner — per-file
 * transactions, drizzle-kit's semantics (see `db/migrate.ts` for why the
 * built-in one-transaction migrator fails a fresh database at 0009). The
 * runner takes the advisory lock itself, same key as always.
 */
export async function migrateSerialized(_db: Database, pool: Pool): Promise<void> {
  await runMigrations(pool, MIGRATIONS_FOLDER);
}

/**
 * A private database for one test file, on a shared server.
 *
 * Testcontainers already gives each file its own server. `TEST_DATABASE_URL`
 * does not, and a shared database means one file's rows are another file's
 * surprise: §33.1.1 asserts that opening a draft link creates *no* user row,
 * which is only checkable if nothing else is creating user rows at the same
 * time. Rather than making every assertion defensive — which would quietly
 * weaken the ones that matter — each file gets its own database.
 *
 * The advisory lock is taken on the maintenance database, which every file
 * shares, and is held across `CREATE DATABASE` *and* the migration. Postgres
 * advisory locks are per-database, so a lock inside the new database could not
 * serialise anything; and migration 0001 does a cluster-wide `CREATE ROLE
 * proovd_app`, which two concurrent migrators would race on even though they
 * are working in different databases.
 */
const PROVISION_LOCK_KEY = 720_302;

export interface IsolatedDatabase {
  connectionString: string;
  /** Drops the database. Safe to call after the owning pool has ended. */
  drop: () => Promise<void>;
}

export async function provisionIsolatedDatabase(
  maintenanceUrl: string,
  label: string,
): Promise<IsolatedDatabase> {
  const name = `proovd_t_${label.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}_${randomBytes(
    6,
  ).toString('hex')}`;

  const maintenance = new Pool({ connectionString: maintenanceUrl, max: 1 });

  const url = new URL(maintenanceUrl);
  url.pathname = `/${name}`;
  const connectionString = url.toString();

  const client = await maintenance.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [PROVISION_LOCK_KEY]);
    // CREATE DATABASE cannot run inside a transaction block, so this is a bare
    // statement on a dedicated connection.
    await client.query(`CREATE DATABASE "${name}"`);

    const owned = new Pool({ connectionString });
    try {
      await runMigrations(owned, MIGRATIONS_FOLDER);
    } finally {
      await owned.end();
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [PROVISION_LOCK_KEY]).catch(() => {});
    client.release();
  }

  return {
    connectionString,
    drop: async () => {
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await maintenance.end();
      }
    },
  };
}
