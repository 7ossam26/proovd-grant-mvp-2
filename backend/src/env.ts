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
