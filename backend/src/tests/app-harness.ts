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
import type { OutgoingEmail } from '../notifications/send.js';
import type { LiveModeEnvironment } from '../live-mode/gate.js';
import {
  migrateSerialized,
  provisionIsolatedDatabase,
  type IsolatedDatabase,
} from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deterministic, obviously fake, and long enough to pass the §6 length floor. */
export const TEST_AUTH_SECRET = 'test-only-better-auth-secret-not-a-real-one';

/**
 * The §6 "Admin reauthentication window" for tests. The Spec fixes no value, so
 * the app has no default — a test must state one, exactly as an operator must.
 */
export const TEST_REAUTH_WINDOW_SECONDS = 300;

/**
 * The §6 prerequisite facts a test environment can honestly report.
 *
 * Every one is false or absent except the Stripe mode agreement, because a test
 * process has no webhook secrets and no email provider. That is the correct
 * starting state: the panel must block, and a suite that started from a
 * satisfied panel would never notice if `blocking` stopped meaning anything.
 */
export const TEST_PREREQUISITE_ENVIRONMENT: LiveModeEnvironment = {
  stripeMode: 'test',
  stripeKeysMatchMode: true,
  platformWebhookSecretPresent: false,
  connectWebhookSecretPresent: false,
  // Two absent secrets are not the same secret, and the §34 gate reports the
  // absence rather than a false sharing.
  webhookSecretsDiffer: true,
};

export interface CapturedEmail extends OutgoingEmail {
  providerId: string;
}

/** Captured transactional email, plus a switch to make the next send fail. */
export interface SentEmails {
  messages: CapturedEmail[];
  failNext: boolean;
}

export interface Harness extends ProovdApp {
  db: Database;
  pool: Pool;
  /** Reset-password deliveries, captured instead of sent. */
  resetLinks: Array<{ email: string; url: string }>;
  /** Transactional email, captured instead of sent. */
  sentEmails: SentEmails;
  stop: () => Promise<void>;
}

export async function startHarness(
  overrides: Partial<AppConfig> = {},
  /** Names the private database, so a failure points at the file that made it. */
  label = 'harness',
): Promise<Harness> {
  let container: StartedPostgreSqlContainer | null = null;
  let owned: IsolatedDatabase | null = null;
  let connectionString: string;

  const testDbUrl = process.env['TEST_DATABASE_URL'];
  if (testDbUrl) {
    // A shared server needs a private database per file — see
    // `provisionIsolatedDatabase`. Testcontainers already gives each file its
    // own server, so it needs nothing further.
    owned = await provisionIsolatedDatabase(testDbUrl, label);
    connectionString = owned.connectionString;
  } else {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  }

  const pool = createDbPool(connectionString);
  const db = createDb(pool);
  if (!owned) await migrateSerialized(db, pool);

  const resetLinks: Array<{ email: string; url: string }> = [];
  const sentEmails: SentEmails = { messages: [], failNext: false };

  const built = createApp(db, {
    appBaseUrl: 'http://localhost:3000',
    nodeEnv: 'test',
    publicDir: path.resolve(__dirname, '../../public'),
    authSecret: TEST_AUTH_SECRET,
    adminReauthWindowSeconds: TEST_REAUTH_WINDOW_SECONDS,
    // Nothing is in front of supertest, so the socket address is the real one
    // — the same value production uses when it sits on the network directly.
    trustProxyHops: 0,
    liveModeEnvironment: TEST_PREREQUISITE_ENVIRONMENT,
    invitationContext: {
      appBaseUrl: 'http://localhost:3000',
      supportEmail: 'support@proovd.co',
      fromAddress: 'hello@proovd.co',
    },
    // Every request in the suite arrives from one loopback address, so the
    // production §28.1 limit would trip partway through and turn unrelated
    // assertions into limiter tests. The limiter's own behaviour is covered by
    // `auth-tokens.test.ts`, which mounts it with a deliberately tiny limit.
    draftVerifyLimit: 100_000,
    // The email code route sends mail, so it carries the tight resend limit
    // in production (five an hour, per address). A suite that shares one
    // client address would exhaust it after five requests and every later
    // test would silently receive no code — which is exactly the failure the
    // limiter's own test drives on purpose, with its own harness.
    emailCodeLimit: 100_000,
    // Same reasoning for the blanket limiter: one loopback address drives every
    // request in the suite, and a whole Founder journey is dozens of autosaves.
    globalRateLimit: 1_000_000,
    // Captured, never sent. The real Resend transport is not exercised by the
    // suite — what has to be proved is that a duplicate cannot produce a second
    // message (§27.2), and that is a property of `createNotifier`, not of the
    // provider.
    emailTransport: {
      async send(message) {
        if (sentEmails.failNext) {
          sentEmails.failNext = false;
          throw new Error('test transport refused the message');
        }
        const providerId = `test-msg-${sentEmails.messages.length + 1}`;
        sentEmails.messages.push({ ...message, providerId });
        return { providerId };
      },
    },
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
    sentEmails,
    stop: async () => {
      await pool.end();
      await owned?.drop();
      await container?.stop();
    },
  };
}
