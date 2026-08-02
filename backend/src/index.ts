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

  // ── First-boot settings seed (§6) ──────────────────────────────────────────
  // `requireFreshSession` reads the Admin reauthentication window from
  // `app_settings`, but an Admin cannot reach the settings surface until the
  // app is running and guarded. ADMIN_REAUTH_WINDOW_SECONDS — which env.ts
  // already refuses to boot without — provides the first value, recorded with
  // an honest actor and reason. It runs only while the setting is still unset;
  // once an Admin states a value the setting is authoritative and this is a
  // no-op.
  const { seedAdminReauthWindow } = await import('./settings/service.js');
  const seedResult = await seedAdminReauthWindow(db, env.ADMIN_REAUTH_WINDOW_SECONDS);
  logger.info({ adminReauthWindow: seedResult }, 'Settings bootstrap');

  // ── Express app ────────────────────────────────────────────────────────────
  const { createApp } = await import('./app.js');
  const { prerequisiteFacts } = await import('./env.js');
  const { createResendTransport, unconfiguredTransport } = await import(
    './notifications/resend-transport.js'
  );

  // §27.2 / §1.4. With no provider configured the transport refuses loudly
  // rather than silently swallowing a message — an Admin must never see an
  // invitation reported as sent when nothing left the building. The §6
  // prerequisites panel is already blocking on the same fact.
  const emailTransport = env.RESEND_API_KEY
    ? createResendTransport(env.RESEND_API_KEY)
    : unconfiguredTransport;

  // §12 uploads (tech-stack §9). Same shape, same reasoning: R2 is Track A4 and
  // an unconfigured deployment refuses uploads loudly rather than reporting a
  // file as stored when no bucket exists.
  const { createR2Storage, unconfiguredStorage } = await import('./storage/object-storage.js');
  const { objectStorageConfigured, schedulerConfigured } = await import('./env.js');
  const objectStorage = objectStorageConfigured(env)
    ? createR2Storage({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET!,
      })
    : unconfiguredStorage;

  // §12's booking provider (tech-stack §12). Same shape again: an unconfigured
  // deployment renders no embed and accepts no webhook, rather than an empty
  // frame and anything that arrives.
  const { createCalcomScheduler, unconfiguredScheduler } = await import(
    './interviews/calcom.js'
  );
  const interviewScheduler = schedulerConfigured(env)
    ? createCalcomScheduler({
        apiKey: env.CALCOM_API_KEY!,
        webhookSecret: env.CALCOM_WEBHOOK_SECRET!,
        eventTypeLink: env.CALCOM_EVENT_TYPE_LINK!,
      })
    : unconfiguredScheduler;

  // §32.2's Stripe client, with the locked API version. `env.ts` requires the
  // keys and fails closed on any mode mismatch, so this always constructs — the
  // separation §34 condition 5 asks about was already proven at boot.
  const { createStripeGateway } = await import('./payments/stripe-client.js');
  const stripeGateway = createStripeGateway({
    mode: env.STRIPE_MODE,
    apiVersion: env.STRIPE_API_VERSION,
    secretKey: env.STRIPE_PLATFORM_SECRET_KEY,
    platformAccountId: env.STRIPE_PLATFORM_ACCOUNT_ID,
    platformWebhookSecret: env.STRIPE_WEBHOOK_SECRET_PLATFORM,
    connectWebhookSecret: env.STRIPE_WEBHOOK_SECRET_CONNECT,
    // §12 puts Stripe Tax on the listing Checkout; while this is false the
    // payment surface refuses loudly rather than charging an untaxed total.
    taxEnabled: env.STRIPE_TAX_ENABLED,
  });

  const publicDir = path.join(__dirname, '..', 'public');
  const { app, tokens, notifier } = createApp(db, {
    appBaseUrl: env.APP_BASE_URL,
    nodeEnv: env.NODE_ENV,
    publicDir,
    authSecret: env.BETTER_AUTH_SECRET,
    adminReauthWindowSeconds: env.ADMIN_REAUTH_WINDOW_SECONDS,
    prerequisiteEnvironment: prerequisiteFacts(env),
    emailTransport,
    objectStorage,
    interviewScheduler,
    stripeGateway,
    ...(env.STRIPE_CONNECT_RETURN_URL && env.STRIPE_CONNECT_REFRESH_URL
      ? {
          stripeConnectUrls: {
            returnUrl: env.STRIPE_CONNECT_RETURN_URL,
            refreshUrl: env.STRIPE_CONNECT_REFRESH_URL,
          },
        }
      : {}),
    invitationContext: {
      appBaseUrl: env.APP_BASE_URL,
      // §27.8's published address, and the one the footer already renders.
      supportEmail: 'support@proovd.co',
      // Falls back to the support address so a half-configured deployment
      // still sends from somewhere real if a key is present without a From.
      fromAddress: env.EMAIL_FROM ?? 'support@proovd.co',
    },
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

  // ── Scheduled work (§25.8) ─────────────────────────────────────────────────
  // Throws if it will not start. A deployment whose retention sweep never runs
  // keeps personal data past the window §25.8 sets, and should fail at boot
  // rather than serve traffic while quietly doing so.
  const { startScheduler } = await import('./jobs/scheduler.js');
  const scheduler = await startScheduler({
    db,
    tokens,
    connectionString: env.DATABASE_URL,
    log: (message, detail) => logger.info(detail ?? {}, message),
    // §12's interview reminder and reconciliation (Phase 09b). Both are no-ops
    // while §6's lead time is unset or the provider is unconfigured, and both
    // say so in the log rather than passing silently (§1.4).
    interviews: {
      scheduler: interviewScheduler,
      notifier,
      context: {
        supportEmail: 'support@proovd.co',
        fromAddress: env.EMAIL_FROM ?? 'support@proovd.co',
      },
    },
    // Phase 12a: the §14.6 evaluation runs inside the deadline sweep and needs
    // the gateway (for the refund) and the notifier (for the messages).
    listing: {
      gateway: stripeGateway,
      notifier,
      notificationContext: {
        appBaseUrl: env.APP_BASE_URL,
        supportEmail: 'support@proovd.co',
        fromAddress: env.EMAIL_FROM ?? 'support@proovd.co',
      },
    },
  });
  logger.info('Job scheduler started');

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
      await scheduler.stop();
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
