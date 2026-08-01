import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_BASE_URL: z.string().url('APP_BASE_URL must be a valid URL'),

  // ── Stripe (§6 / §32.2) — all required; mode-mismatch exits non-zero ──────
  STRIPE_MODE: z.enum(['test', 'live']),
  STRIPE_PLATFORM_SECRET_KEY: z.string().min(1),
  STRIPE_PLATFORM_PUBLISHABLE_KEY: z.string().min(1),

  // Required for webhook verification (Phases 10+), optional to boot
  STRIPE_WEBHOOK_SECRET_PLATFORM: z.string().optional(),
  STRIPE_WEBHOOK_SECRET_CONNECT: z.string().optional(),

  // Test-mode connected accounts (Phase 10+)
  STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID: z.string().optional(),
  STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID: z.string().optional(),

  STRIPE_TEST_BACKUP_MODE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  STRIPE_TAX_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Auth (§5, §28.1, §28.2) ──────────────────────────────────────────────
  // Signs Better Auth sessions and reset links. Same length floor as
  // CRON_SECRET: a short one is a forgeable session.
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  // Founder-only Google sign-in (§5.2). Optional, but all-or-nothing —
  // half-configured OAuth fails at the redirect, in production, on a Founder.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // §6 Admin setting: "Admin MFA and reauthentication window." The Spec names
  // the setting and fixes no number, so there is deliberately NO default — the
  // operator states it and the app refuses to boot without it. Phase 06 moves
  // this into the Admin settings surface that §6 describes.
  ADMIN_REAUTH_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive('ADMIN_REAUTH_WINDOW_SECONDS must be a positive number of seconds'),

  // ── Transactional email (§27.2) ──────────────────────────────────────────
  // Optional to boot, because the app has to start before an Admin can look at
  // the §6 prerequisites panel and see that it is missing. Absent, the panel's
  // transactional-email prerequisite is unsatisfied and blocks — which is the
  // honest state until a provider is configured.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // ── Object storage (tech-stack §9, Spec §12) ─────────────────────────────
  // Cloudflare R2. Optional to boot for the same reason Resend is: the app has
  // to start before an Admin can see in the §6 prerequisites panel that it is
  // missing. Absent, `unconfiguredStorage` refuses every upload loudly and the
  // workspace says uploads are unavailable rather than pretending (§1.4).
  //
  // All four or none — a half-configured bucket fails at the first presign, in
  // production, on a Founder mid-upload, which is the same failure shape
  // `checkGoogleOAuth` exists to prevent.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // tech-stack §9: "W-9s and dispute packets are sensitive. Keep them in a
  // separate bucket or prefix with its own lifecycle policy." Nothing in this
  // phase writes to it; it is declared here so the separation is configured
  // before the phase that needs it, not during it.
  R2_BUCKET_SENSITIVE: z.string().optional(),

  // ── Jobs ─────────────────────────────────────────────────────────────────
  // Must be present and ≥32 chars. Protects close-batch and cron endpoints.
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),

  // ── Observability (optional — skipped if absent) ──────────────────────────
  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function checkStripeMode(data: Env): void {
  const { STRIPE_MODE, STRIPE_PLATFORM_SECRET_KEY, STRIPE_PLATFORM_PUBLISHABLE_KEY } = data;

  if (STRIPE_MODE === 'test') {
    if (!STRIPE_PLATFORM_SECRET_KEY.startsWith('sk_test_')) {
      throw new Error(
        `STRIPE_MODE=test but STRIPE_PLATFORM_SECRET_KEY does not start with sk_test_ (got ${STRIPE_PLATFORM_SECRET_KEY.slice(0, 8)}...)`,
      );
    }
    if (!STRIPE_PLATFORM_PUBLISHABLE_KEY.startsWith('pk_test_')) {
      throw new Error(
        `STRIPE_MODE=test but STRIPE_PLATFORM_PUBLISHABLE_KEY does not start with pk_test_ (got ${STRIPE_PLATFORM_PUBLISHABLE_KEY.slice(0, 8)}...)`,
      );
    }
  } else {
    if (!STRIPE_PLATFORM_SECRET_KEY.startsWith('sk_live_')) {
      throw new Error(
        `STRIPE_MODE=live but STRIPE_PLATFORM_SECRET_KEY does not start with sk_live_ (got ${STRIPE_PLATFORM_SECRET_KEY.slice(0, 8)}...)`,
      );
    }
    if (!STRIPE_PLATFORM_PUBLISHABLE_KEY.startsWith('pk_live_')) {
      throw new Error(
        `STRIPE_MODE=live but STRIPE_PLATFORM_PUBLISHABLE_KEY does not start with pk_live_ (got ${STRIPE_PLATFORM_PUBLISHABLE_KEY.slice(0, 8)}...)`,
      );
    }
  }

  // In live mode, disallow test-only connected-account variables.
  // These are always set in test mode; their presence in live mode signals
  // that the operator used the wrong env block.
  if (
    STRIPE_MODE === 'live' &&
    (data.STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID ||
      data.STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID)
  ) {
    throw new Error(
      'STRIPE_MODE=live but STRIPE_TEST_*_CONNECTED_ACCOUNT_ID variables are set. ' +
        'These are test-mode identifiers. Remove them for live mode.',
    );
  }
}

/**
 * Google OAuth is configured or it is not. A client ID without its secret
 * survives validation and then fails at the redirect — in production, on a
 * Founder mid-signin (§5.2). Fail at boot instead.
 */
function checkGoogleOAuth(data: Env): void {
  const hasId = Boolean(data.GOOGLE_CLIENT_ID);
  const hasSecret = Boolean(data.GOOGLE_CLIENT_SECRET);
  if (hasId !== hasSecret) {
    throw new Error(
      'Google OAuth is half-configured: set both GOOGLE_CLIENT_ID and ' +
        'GOOGLE_CLIENT_SECRET, or neither.',
    );
  }
}

/**
 * Object storage is configured or it is not (tech-stack §9).
 *
 * Three of the four values will presign a URL that R2 rejects, and the rejection
 * arrives at the browser as an opaque failure mid-upload. Fail at boot instead,
 * for the same reason `checkGoogleOAuth` does.
 */
function checkObjectStorage(data: Env): void {
  const parts = [
    data.R2_ACCOUNT_ID,
    data.R2_ACCESS_KEY_ID,
    data.R2_SECRET_ACCESS_KEY,
    data.R2_BUCKET,
  ];
  const present = parts.filter(Boolean).length;
  if (present !== 0 && present !== parts.length) {
    throw new Error(
      'Object storage is half-configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY, and R2_BUCKET, or none of them.',
    );
  }
}

/** True only when all four R2 values are present. Read by `createApp`. */
export function objectStorageConfigured(env: Env): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}

/**
 * The environment facts the §6 prerequisites panel reads.
 *
 * Derived from the same predicates `checkStripeMode` enforces, so the panel
 * cannot report separation that the boot guard would have rejected. In practice
 * `stripeKeysMatchMode` is always true in a running process — the app exits
 * non-zero otherwise — and the panel records that it held rather than assuming
 * it (§34: the gate is about recorded facts, not assumed ones).
 */
export function prerequisiteFacts(env: Env): {
  stripeMode: 'test' | 'live';
  stripeKeysMatchMode: boolean;
  platformWebhookSecretPresent: boolean;
  connectWebhookSecretPresent: boolean;
  transactionalEmailConfigured: boolean;
} {
  const expectedSecret = env.STRIPE_MODE === 'test' ? 'sk_test_' : 'sk_live_';
  const expectedPublishable = env.STRIPE_MODE === 'test' ? 'pk_test_' : 'pk_live_';

  return {
    stripeMode: env.STRIPE_MODE,
    stripeKeysMatchMode:
      env.STRIPE_PLATFORM_SECRET_KEY.startsWith(expectedSecret) &&
      env.STRIPE_PLATFORM_PUBLISHABLE_KEY.startsWith(expectedPublishable),
    platformWebhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET_PLATFORM),
    connectWebhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET_CONNECT),
    transactionalEmailConfigured: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  };
}

/**
 * Validates raw environment variables and returns the typed result.
 * Throws on schema failure or Stripe mode mismatch.
 * Tests import this directly; `loadEnv` is what triggers process.exit.
 */
export function validateEnv(raw: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`);
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }
  checkStripeMode(result.data);
  checkGoogleOAuth(result.data);
  checkObjectStorage(result.data);
  return result.data;
}

/**
 * Call once at startup. Exits non-zero if the environment is invalid.
 * Never call this from test files — import validateEnv instead.
 */
export function loadEnv(): Env {
  try {
    return validateEnv();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[proovd] Fatal: ${msg}\n`);
    process.exit(1);
  }
}
