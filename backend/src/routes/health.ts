import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export function createHealthRouter(db: Database): Router {
  const router = Router();

  router.get('/healthz', async (_req, res) => {
    // Real database round-trip — what UptimeRobot polls.
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return router;
}
