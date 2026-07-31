/**
 * Shared integration harness: a real Postgres, the real migrations, and the
 * real `createApp` wiring.
 *
 * Phase 03's suite proved database-level guarantees against a live server;
 * Phase 04's has to prove request-level ones, so it builds the app the same way
 * `index.ts` does rather than assembling middleware by hand. A guard that only
 * works when a test wires it is a guard that is not actually mounted.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createDbPool, type Database } from '../db/client.js';
import { createApp, type AppConfig, type ProovdApp } from '../app.js';
import { migrateSerialized } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deterministic, obviously fake, and long enough to pass the §6 length floor. */
export const TEST_AUTH_SECRET = 'test-only-better-auth-secret-not-a-real-one';

/**
 * The §6 "Admin reauthentication window" for tests. The Spec fixes no value, so
 * the app has no default — a test must state one, exactly as an operator must.
 */
export const TEST_REAUTH_WINDOW_SECONDS = 300;

export interface Harness extends ProovdApp {
  db: Database;
  pool: Pool;
  /** Reset-password deliveries, captured instead of sent. */
  resetLinks: Array<{ email: string; url: string }>;
  stop: () => Promise<void>;
}

export async function startHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  let container: StartedPostgreSqlContainer | null = null;
  let connectionString: string;

  const testDbUrl = process.env['TEST_DATABASE_URL'];
  if (testDbUrl) {
    connectionString = testDbUrl;
  } else {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  }

  const pool = createDbPool(connectionString);
  const db = createDb(pool);
  await migrateSerialized(db, pool);

  const resetLinks: Array<{ email: string; url: string }> = [];

  const built = createApp(db, {
    appBaseUrl: 'http://localhost:3000',
    nodeEnv: 'test',
    publicDir: path.resolve(__dirname, '../../public'),
    authSecret: TEST_AUTH_SECRET,
    adminReauthWindowSeconds: TEST_REAUTH_WINDOW_SECONDS,
    sendResetPassword: async ({ user, url }) => {
      resetLinks.push({ email: user.email, url });
    },
    ...overrides,
  });

  return {
    ...built,
    db,
    pool,
    resetLinks,
    stop: async () => {
      await pool.end();
      await container?.stop();
    },
  };
}
