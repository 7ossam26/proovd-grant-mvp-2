import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Sentry must be initialised before any other import that might throw.
// We import it first so its auto-instrumentation wraps the Express setup.
let sentryInitialised = false;

async function main() {
  // ── Environment ────────────────────────────────────────────────────────────
  // loadEnv() exits non-zero on any schema failure or Stripe mode mismatch.
  const { loadEnv } = await import('./env.js');
  const env = loadEnv();

  // ── Sentry ─────────────────────────────────────────────────────────────────
  if (env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    sentryInitialised = true;
  }

  // ── Logger ─────────────────────────────────────────────────────────────────
  const { default: logger } = await import('./lib/logger.js');

  // ── Database ───────────────────────────────────────────────────────────────
  const { createDbPool, createDb } = await import('./db/client.js');
  const pool = createDbPool(env.DATABASE_URL);
  const db = createDb(pool);

  // Run migrations before the server accepts requests.
  // The migrations folder is at dist/db/migrations/ in production (copied
  // by the Dockerfile) and src/db/migrations/ in development.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(__dirname, 'db', 'migrations');

  logger.info({ migrationsFolder }, 'Running database migrations');
  await migrate(db, { migrationsFolder });
  logger.info('Migrations complete');

  // ── Express app ────────────────────────────────────────────────────────────
  const { createApp } = await import('./app.js');
  const publicDir = path.join(__dirname, '..', 'public');
  const app = createApp(db, {
    appBaseUrl: env.APP_BASE_URL,
    nodeEnv: env.NODE_ENV,
    publicDir,
  });

  // ── Start ──────────────────────────────────────────────────────────────────
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, stripeMode: env.STRIPE_MODE },
      'Proovd backend listening',
    );
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await pool.end();
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  process.stderr.write(`[proovd] Unhandled startup error: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
