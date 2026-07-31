/**
 * Test-harness migration helper. Vitest runs test files in separate forks;
 * when several suites share one TEST_DATABASE_URL, concurrent migrate()
 * calls race (CREATE EXTENSION / CREATE TABLE hit duplicate-key errors even
 * with IF NOT EXISTS). A Postgres advisory lock serializes the migrators
 * across processes.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'db', 'migrations');

const MIGRATION_LOCK_KEY = 720_301;

export async function migrateSerialized(db: Database, pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
