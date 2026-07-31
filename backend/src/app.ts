import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './db/client.js';
import { createHealthRouter } from './routes/health.js';

export interface AppConfig {
  appBaseUrl: string;
  nodeEnv: string;
  /** Absolute path to the directory that holds the SPA build. */
  publicDir: string;
}

export function createApp(db: Database, config: AppConfig): express.Express {
  const app = express();

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  const corsOrigins: string[] =
    config.nodeEnv === 'development'
      ? [config.appBaseUrl, 'http://localhost:5173']
      : [config.appBaseUrl];

  app.use(cors({ origin: corsOrigins, credentials: true }));

  // ── Routes (per-router body parsing — no global express.json()) ────────────
  //
  // DO NOT add app.use(express.json()) here. Phase 10 mounts Stripe webhook
  // routes that need the raw body for signature verification. A global JSON
  // parser consumes the raw body first and causes signature failures that
  // look like a Stripe configuration problem. Each router adds its own body
  // parsing at the correct scope.

  app.use(createHealthRouter(db));

  // ── SPA fallback ──────────────────────────────────────────────────────────
  // /api/* routes go above. Everything else returns index.html so the SPA
  // router handles it. In development the Vite dev server serves instead;
  // in production the built frontend is at backend/public/.
  app.use(express.static(config.publicDir));

  app.use((_req, res) => {
    const indexPath = path.join(config.publicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  return app;
}
