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
  // §28.1: a raw token exists only in the delivered URL and never in a log or
  // an error. Sentry's default behaviour is to attach the request URL to every
  // event and every navigation breadcrumb, which would put draft and magic-link
  // tokens in a third-party system the moment anything threw on one of those
  // routes. The redaction rule lives beside the route definitions in
  // `auth/token-routes.ts` so the two cannot drift apart.
  if (env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    const { redactTokenUrl } = await import('./auth/token-routes.js');

    const scrub = (value: unknown): string | undefined =>
      typeof value === 'string' ? redactTokenUrl(value) : undefined;

    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // sendDefaultPii stays off: these routes have no account behind them and
      // the Spec's privacy contract (§28.4) is narrower than Sentry's default.
      sendDefaultPii: false,
      beforeSend(event) {
        const url = scrub(event.request?.url);
        if (url && event.request) event.request.url = url;
        if (event.request?.query_string) delete event.request.query_string;
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        const url = scrub(breadcrumb.data?.['url']);
        if (url && breadcrumb.data) breadcrumb.data['url'] = url;
        return breadcrumb;
      },
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
  const { app } = createApp(db, {
    appBaseUrl: env.APP_BASE_URL,
    nodeEnv: env.NODE_ENV,
    publicDir,
    authSecret: env.BETTER_AUTH_SECRET,
    adminReauthWindowSeconds: env.ADMIN_REAUTH_WINDOW_SECONDS,
    // §5.5 password reset for Founder, Affiliate, and Admin. Resend arrives in
    // a later phase; until it does this refuses loudly rather than pretending
    // to have sent mail (§1.4: never imply automation that does not exist).
    sendResetPassword: async () => {
      throw new Error(
        'Password-reset delivery is not wired yet: no transactional email provider is configured.',
      );
    },
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
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
