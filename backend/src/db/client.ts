import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export function createDbPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
