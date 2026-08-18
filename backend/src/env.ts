import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_BASE_URL: z.string().url('APP_BASE_URL must be a valid URL'),

  /**
   * tech-stack §10: proovd.co (the landing repository) is the marketing home,
   * app.proovd.co is the platform — and "decide the canonical redirect and
   * record it once." This is that record: when set, a request for exactly `/`
   * on the platform origin 301s to the marketing home. Everything else —
   * §18's policy routes, campaign pages, sign-in — stays on the platform
   * origin, where consent records cite it and the attribution cookie is
   * first-party. Unset (dev, tests), the platform home renders as itself.
   */
  MARKETING_HOME_URL: z.string().url().optional(),

  // ── Stripe (§6 / §32.2) — all required; mode-mismatch exits non-zero ──────
  /**
   * A declaration, not a credential. Stays required: it costs nothing to
   * state, and `prerequisiteFacts` has to report which mode a deployment
   * believes it is in even when no keys are configured.
   */
  STRIPE_MODE: z.enum(['test', 'live']),

  /**
   * ── The four platform credentials, and why they are optional to boot ──────
   *
   * §32.2 requires all four before any money moves, and `checkStripeMode`
   * still refuses a set that disagrees with the declared mode. What they no
   * longer do is stop the process from starting — the reason `RESEND_API_KEY`
   * and the R2 block already give: the app has to run before an Admin can open
   * the §6 prerequisites panel and read that Stripe is missing. A deployment
   * that cannot boot reports nothing at all.
   *
   * All four or none (`checkStripeCredentials`). A partial set would build a
   * half-configured client and fail at the first provider call instead of
   * here, which is the failure shape `checkGoogleOAuth` exists to prevent.
   *
   * Unset, `unconfiguredStripeGateway` refuses every operation by name, the
   * prerequisites panel reports the item unsatisfied, and §34 condition 5
   * stays unproven — `stripeKeysMatchMode` is false when there are no keys to
   * match. Nothing records a separation that was never demonstrated.
   *
   * In LIVE mode they are required, because a live deployment with no gateway
   * is not a configuration anyone meant.
   */
  STRIPE_PLATFORM_SECRET_KEY: z.string().optional(),
  STRIPE_PLATFORM_PUBLISHABLE_KEY: z.string().optional(),

  /**
   * §32.2: "Locked API version." Deliberately not defaulted to the SDK's own
   * pinned version — an SDK upgrade would then silently change the shape of
   * every provider object the ledger reads. The operator states the version;
   * `payments/stripe-client.ts` passes it to every call.
   */
  STRIPE_API_VERSION: z.string().optional(),

  /** §32.2: "Platform account ID." The account the listing fee is charged on. */
  STRIPE_PLATFORM_ACCOUNT_ID: z.string().optional(),

  // Required for webhook verification (Phases 10+), optional to boot
  STRIPE_WEBHOOK_SECRET_PLATFORM: z.string().optional(),
  STRIPE_WEBHOOK_SECRET_CONNECT: z.string().optional(),

  // §32.2: "Connect return/refresh URLs and OAuth client ID if used."
  // Optional to boot: onboarding is Phase 10b, and an app that refused to start
  // without them could not serve the §6 prerequisites panel that reports them.
  STRIPE_CONNECT_RETURN_URL: z.string().url().optional(),
  STRIPE_CONNECT_REFRESH_URL: z.string().url().optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

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

  // ── How many reverse proxies sit in front of this process (§28.1) ─────────
  //
  // Decides what `req.ip` is, and therefore what every rate limiter keys on —
  // including §28.1's limit on the credential endpoints.
  //
  // Defaults to 0, which means "nothing is in front of me; use the socket
  // address". That is wrong behind a TLS terminator, and wrong in the safe
  // direction: every request keys to the proxy and the per-address limits
  // collapse into one global bucket, which throttles too much rather than not
  // at all. The alternative default — trusting the header — lets any caller
  // mint a fresh bucket per request and removes the limit entirely.
  //
  // Set this to the number of proxies actually in the chain (Dokploy's single
  // ingress is 1). Never express it as a boolean: `trust proxy: true` takes
  // the left-most forwarded address whoever wrote it.
  TRUST_PROXY_HOPS: z.coerce
    .number()
    .int()
    .min(0, 'TRUST_PROXY_HOPS must be 0 or a positive number of proxy hops')
    .default(0),

  // ── Transactional email (§27.2) ──────────────────────────────────────────
  // Optional to boot, because the app has to start before an Admin can look at
  // the §6 prerequisites panel and see that it is missing. Absent, the panel's
  // transactional-email prerequisite is unsatisfied and blocks — which is the
  // honest state until a provider is configured.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // §27.6's staffed inbox — where the internal queue notices go. Deliberately
  // NOT the §27.8 published support address: an internal notice may name a
  // decline code or a table, and §3.1/§25.6 keep that out of anything a
  // customer can reach. Optional, and unset means the §27.6 notices do not
  // send while the Admin queues stay the place the work is visible (§1.4) —
  // the same posture every other unconfigured port takes here.
  INTERNAL_NOTIFICATION_EMAIL: z.string().email().optional(),

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

  // ── Scheduling — Cal.com Cloud (tech-stack §12, Spec §12) ────────────────
  // The Founder books a human Proovd interview without leaving the product,
  // and our database is the source of truth for the booking — Cal.com is a
  // source of events. Optional to boot for the same reason Resend and R2 are:
  // the app has to start before an Admin can see it is missing.
  //
  // All three or none. A webhook secret without an API key cannot reconcile a
  // missed delivery, and an event link without a secret would mount an embed
  // whose bookings we could never verify.
  CALCOM_API_KEY: z.string().optional(),
  CALCOM_WEBHOOK_SECRET: z.string().optional(),
  // The public embed identifier, e.g. `proovd/founder-interview`. Not a secret:
  // it is in the page a Founder loads.
  CALCOM_EVENT_TYPE_LINK: z.string().optional(),

  // ── Dictation — the transcription port (Founder Flow v2 deviation 2) ────
  // "Say it instead" on §9's Positioning step and §12's Story. Optional to
  // boot for the same reason Resend, R2 and Cal.com are: the app has to start
  // before anyone can see it is missing. Absent, `unconfiguredTranscription`
  // refuses every recording loudly and the screen renders the absence rather
  // than a dead microphone (§1.4).
  //
  // Both or neither. A URL with no key would fail at the first recording, in
  // production, mid-sentence — the failure shape `checkObjectStorage` and
  // `checkScheduler` both exist to prevent.
  TRANSCRIPTION_API_URL: z.string().url().optional(),
  TRANSCRIPTION_API_KEY: z.string().optional(),

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

  // Absent credentials are `checkStripeCredentials`' business (all four or
  // none) and the prerequisites panel's to report. What this decides is
  // whether the values that ARE present agree with the declared mode.
  if (STRIPE_PLATFORM_SECRET_KEY && STRIPE_PLATFORM_PUBLISHABLE_KEY) {
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

  // §32.2: every account reference is an account reference. A publishable key,
  // a secret, or a copied-and-truncated value in one of these fields would
  // otherwise be discovered on the first API call, in production.
  for (const [name, value] of [
    ['STRIPE_PLATFORM_ACCOUNT_ID', data.STRIPE_PLATFORM_ACCOUNT_ID],
    ['STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID', data.STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID],
    ['STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID', data.STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID],
  ] as const) {
    if (value && !value.startsWith('acct_')) {
      throw new Error(`${name} must be a Stripe account id starting with acct_ (got ${value.slice(0, 8)}...)`);
    }
  }

  if (data.STRIPE_CONNECT_CLIENT_ID && !data.STRIPE_CONNECT_CLIENT_ID.startsWith('ca_')) {
    throw new Error('STRIPE_CONNECT_CLIENT_ID must start with ca_');
  }

  // §32.2 asks for a locked API version. Stripe's are dated, and a value that is
  // not one is a typo that would be sent on every request.
  if (
    data.STRIPE_API_VERSION &&
    !/^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/.test(data.STRIPE_API_VERSION)
  ) {
    throw new Error(
      `STRIPE_API_VERSION must be a locked Stripe API version such as 2026-07-29.dahlia (got ${data.STRIPE_API_VERSION})`,
    );
  }
}

/**
 * The Stripe platform credentials are configured or they are not (§32.2).
 *
 * Three of the four build a client that authenticates and then charges on the
 * wrong account, or one that cannot verify a webhook it has already accepted —
 * failures that surface at the first provider call rather than at boot. Same
 * reasoning as `checkGoogleOAuth`, `checkObjectStorage`, and `checkScheduler`.
 *
 * In live mode the set is mandatory: §34's gate governs whether live money may
 * MOVE, and a live deployment with no gateway at all is not a state anyone
 * chose. Refusing here keeps that from being discovered by a Backer.
 */
function checkStripeCredentials(data: Env): void {
  const parts = [
    data.STRIPE_PLATFORM_SECRET_KEY,
    data.STRIPE_PLATFORM_PUBLISHABLE_KEY,
    data.STRIPE_PLATFORM_ACCOUNT_ID,
    data.STRIPE_API_VERSION,
  ];
  const present = parts.filter(Boolean).length;

  if (present !== 0 && present !== parts.length) {
    throw new Error(
      'Stripe is half-configured: set STRIPE_PLATFORM_SECRET_KEY, ' +
        'STRIPE_PLATFORM_PUBLISHABLE_KEY, STRIPE_PLATFORM_ACCOUNT_ID, and ' +
        'STRIPE_API_VERSION, or none of them.',
    );
  }

  if (present === 0 && data.STRIPE_MODE === 'live') {
    throw new Error(
      'STRIPE_MODE=live with no Stripe credentials configured. Live mode ' +
        'requires the full platform credential set; use STRIPE_MODE=test ' +
        'while Stripe is not yet set up.',
    );
  }
}

/** True only when all four platform credentials are present. Read by `createApp`. */
export function stripeConfigured(env: Env): boolean {
  return Boolean(
    env.STRIPE_PLATFORM_SECRET_KEY &&
      env.STRIPE_PLATFORM_PUBLISHABLE_KEY &&
      env.STRIPE_PLATFORM_ACCOUNT_ID &&
      env.STRIPE_API_VERSION,
  );
}

/**
 * The two webhook secrets (§6, §32.2, §28.3).
 *
 * ── What can be checked, and what deliberately is not ───────────────────────
 * §6 asks the environment to refuse "a webhook secret/mode mismatch". A Stripe
 * signing secret carries no mode marker — a test secret and a live secret are
 * both `whsec_...` — so no string check here can prove which mode a secret
 * belongs to, and one that pretended to would be a check that passes while
 * being wrong. What actually proves it is signature verification at the
 * endpoint, which fails closed on a secret from the wrong mode.
 *
 * So this enforces the two things that ARE decidable from the values:
 *
 *  1. Each looks like a signing secret rather than an API key. A `sk_live_`
 *     pasted into a webhook-secret field is the kind of mistake that otherwise
 *     surfaces as "signature verification failed" and gets debugged as a Stripe
 *     problem.
 *  2. The two differ. §32.3 gives the platform and Connect endpoints separate
 *     secrets precisely so each verifies only its own traffic; one secret used
 *     for both makes either endpoint accept the other's events, and the
 *     separation §24.1 draws between Proovd-as-MoR and Founder-as-MoR money
 *     stops being enforced by anything.
 */
function checkWebhookSecrets(data: Env): void {
  const secrets = [
    ['STRIPE_WEBHOOK_SECRET_PLATFORM', data.STRIPE_WEBHOOK_SECRET_PLATFORM],
    ['STRIPE_WEBHOOK_SECRET_CONNECT', data.STRIPE_WEBHOOK_SECRET_CONNECT],
  ] as const;

  for (const [name, value] of secrets) {
    if (value && !value.startsWith('whsec_')) {
      throw new Error(
        `${name} must be a Stripe signing secret starting with whsec_. A signing secret is not ` +
          'an API key; verification would fail in a way that looks like a Stripe configuration problem.',
      );
    }
  }

  if (
    data.STRIPE_WEBHOOK_SECRET_PLATFORM &&
    data.STRIPE_WEBHOOK_SECRET_PLATFORM === data.STRIPE_WEBHOOK_SECRET_CONNECT
  ) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET_PLATFORM and STRIPE_WEBHOOK_SECRET_CONNECT are the same value. ' +
        '§32.3 gives the two endpoints separate secrets so each verifies only its own traffic.',
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

/**
 * The scheduling provider is configured or it is not (tech-stack §12).
 *
 * Two of the three would mount an embed whose bookings cannot be verified, or
 * leave a verified booking that cannot be reconciled. Fail at boot, like Google
 * OAuth and object storage.
 */
function checkScheduler(data: Env): void {
  const parts = [data.CALCOM_API_KEY, data.CALCOM_WEBHOOK_SECRET, data.CALCOM_EVENT_TYPE_LINK];
  const present = parts.filter(Boolean).length;
  if (present !== 0 && present !== parts.length) {
    throw new Error(
      'The scheduling provider is half-configured: set CALCOM_API_KEY, ' +
        'CALCOM_WEBHOOK_SECRET, and CALCOM_EVENT_TYPE_LINK, or none of them.',
    );
  }
}

/**
 * Dictation is configured or it is not (Founder Flow v2 deviation 2).
 *
 * A URL with no key presigns nothing and authenticates nothing; it fails at
 * the first recording. Fail at boot instead, like the other three ports.
 */
function checkTranscription(data: Env): void {
  const parts = [data.TRANSCRIPTION_API_URL, data.TRANSCRIPTION_API_KEY];
  const present = parts.filter(Boolean).length;
  if (present !== 0 && present !== parts.length) {
    throw new Error(
      'Dictation is half-configured: set TRANSCRIPTION_API_URL and ' +
        'TRANSCRIPTION_API_KEY, or neither of them.',
    );
  }
}

/** True only when both dictation values are present. Read by `createApp`. */
export function transcriptionConfigured(env: Env): boolean {
  return Boolean(env.TRANSCRIPTION_API_URL && env.TRANSCRIPTION_API_KEY);
}
/** True only when all three Cal.com values are present. Read by `createApp`. */
export function schedulerConfigured(env: Env): boolean {
  return Boolean(env.CALCOM_API_KEY && env.CALCOM_WEBHOOK_SECRET && env.CALCOM_EVENT_TYPE_LINK);
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
  /**
   * False when no credentials are configured at all. Kept separate from
   * `stripeKeysMatchMode` because "Stripe is not set up" and "the keys
   * contradict the mode" are two different things to go and fix — the §26
   * distinction between an unpopulated fact and a failing one (§1.4).
   */
  stripeConfigured: boolean;
  stripeKeysMatchMode: boolean;
  platformWebhookSecretPresent: boolean;
  connectWebhookSecretPresent: boolean;
  webhookSecretsDiffer: boolean;
  transactionalEmailConfigured: boolean;
} {
  const expectedSecret = env.STRIPE_MODE === 'test' ? 'sk_test_' : 'sk_live_';
  const expectedPublishable = env.STRIPE_MODE === 'test' ? 'pk_test_' : 'pk_live_';

  // §34 condition 5 is "test/live key separation and webhook signatures pass".
  // Separation is only real if the two endpoints hold different secrets —
  // `checkWebhookSecrets` refuses to boot otherwise, and this records that it
  // held rather than assuming it.
  //
  // Reported as its own fact as well as folded into `stripeKeysMatchMode`,
  // because Phase 24's gate names the specific failure and "at least one key
  // has the wrong prefix" and "both endpoints share a secret" are two
  // different things to go and fix. The §6 prerequisites panel keeps reading
  // the combined answer it has read since Phase 06a.
  const webhookSecretsDiffer =
    env.STRIPE_WEBHOOK_SECRET_PLATFORM !== env.STRIPE_WEBHOOK_SECRET_CONNECT;

  const configured = stripeConfigured(env);

  return {
    stripeMode: env.STRIPE_MODE,
    stripeConfigured: configured,
    // With nothing configured this is false, and that is the honest answer:
    // §34 condition 5 asks that test/live separation be demonstrated, and
    // there is no separation to demonstrate between two absent keys. An
    // unconfigured deployment must never record the condition as met.
    stripeKeysMatchMode:
      configured &&
      env.STRIPE_PLATFORM_SECRET_KEY!.startsWith(expectedSecret) &&
      env.STRIPE_PLATFORM_PUBLISHABLE_KEY!.startsWith(expectedPublishable) &&
      webhookSecretsDiffer,
    platformWebhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET_PLATFORM),
    connectWebhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET_CONNECT),
    webhookSecretsDiffer,
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
  checkStripeCredentials(result.data);
  checkStripeMode(result.data);
  checkGoogleOAuth(result.data);
  checkWebhookSecrets(result.data);
  checkObjectStorage(result.data);
  checkScheduler(result.data);
  checkTranscription(result.data);
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
