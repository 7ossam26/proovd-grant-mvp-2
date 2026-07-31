import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createDbPool } from '../db/client.js';
import { createApp } from '../app.js';
import { migrateSerialized } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  let connectionString: string;

  // If a test database URL is provided (no Docker required), use it directly.
  // Otherwise, spin up a Testcontainers instance — requires Docker.
  const testDbUrl = process.env['TEST_DATABASE_URL'];
  if (testDbUrl) {
    connectionString = testDbUrl;
  } else {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  }

  pool = createDbPool(connectionString);
  const db = createDb(pool);

  await migrateSerialized(db, pool);

  app = createApp(db, {
    appBaseUrl: 'http://localhost:3000',
    nodeEnv: 'test',
    publicDir: path.resolve(__dirname, '../../public'),
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('GET /healthz (Spec §32.2)', () => {
  it('returns 200 with status ok and a database round-trip', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });
});
