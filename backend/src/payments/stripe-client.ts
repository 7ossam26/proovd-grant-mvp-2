/**
 * The Stripe client — Spec §32.2, §24.1, tech-stack §6.
 *
 * ── A port, like the other three ───────────────────────────────────────────
 * Email, object storage, and the scheduler all sit behind an interface with an
 * implementation that refuses loudly when unconfigured. Stripe is different in
 * one way — `env.ts` has always *required* the keys, so a process is never
 * without a client — and the same in every other: the acceptance suite has to
 * drive webhook signatures, mode separation, and idempotent replay without a
 * network, and a port is what makes that possible.
 *
 * ── The API version is locked, and not to the SDK's own ────────────────────
 * §32.2: "Locked API version." `STRIPE_API_VERSION` is required and is passed
 * on construction. Defaulting to the version the SDK happens to ship would mean
 * an `npm update` silently changed the shape of every object the ledger reads —
 * the shape §32.4 stores and §24.3 reconciles against.
 *
 * ── Signature verification is the SDK's, and it is used on raw bytes ───────
 * `constructEvent` does the HMAC, the timestamp tolerance, and the constant-time
 * comparison. Hand-rolling it would mean re-deriving the replay window, which is
 * the part that is easy to get subtly wrong. The route hands it the raw body —
 * see `routes/stripe-webhooks.ts`, and the reason `app.ts` still mounts no
 * global JSON parser.
 *
 * ── Two secrets, two endpoints, never crossed ──────────────────────────────
 * §32.3 gives the platform and Connect endpoints separate signing secrets so
 * each verifies only its own traffic. `verifyEvent` takes which endpoint it is
 * verifying for and reads that secret; there is no call shape that lets one
 * endpoint fall back to the other's secret, because that fallback is how the
 * §24.1 boundary between Proovd-as-MoR and Founder-as-MoR money stops being
 * enforced by anything.
 */

import Stripe from 'stripe';

export type StripeModeValue = 'test' | 'live';
export type WebhookEndpoint = 'platform' | 'connect';

/** A verified provider event, reduced to what the ingest needs. */
export interface VerifiedStripeEvent {
  id: string;
  type: string;
  /** Present on Connect deliveries; absent on platform ones. */
  account: string | null;
  created: Date;
  /** The `data.object`, typed loosely — handlers narrow by `type`. */
  object: Record<string, unknown>;
  /** Which endpoint verified it. Stored, so a mis-routed event is visible. */
  endpoint: WebhookEndpoint;
}

/** What Stripe's hosted onboarding needs, and what it gives back (§13, §11). */
export interface AccountLink {
  url: string;
  expiresAt: Date;
}

export interface CreateAccountInput {
  /** §24.1's two roles. Decides which capabilities are requested. */
  role: 'founder_seller' | 'affiliate_recipient';
  email?: string | undefined;
  /** §2.2 launches US-only; the caller states it rather than this assuming. */
  country: string;
}

export interface StripeGateway {
  readonly mode: StripeModeValue;
  readonly apiVersion: string;
  readonly platformAccountId: string;
  /** False when the endpoint has no signing secret configured. */
  hasSecretFor(endpoint: WebhookEndpoint): boolean;
  /**
   * Verifies and parses. Returns null on any failure — a bad signature, a
   * missing secret, an unparseable body, or a replay outside the tolerance are
   * one answer to the caller, and the real reason goes to the audit log.
   */
  verifyEvent(
    endpoint: WebhookEndpoint,
    rawBody: Buffer,
    signature: string | undefined,
  ): VerifiedStripeEvent | null;

  /* ── Hosted onboarding (§13, §11) ──────────────────────────────────────── */

  /** Creates the connected account. Returns its `acct_…` id. */
  createConnectedAccount(input: CreateAccountInput): Promise<string>;
  /**
   * A single-use, short-lived link into Stripe's own onboarding.
   *
   * §13 and §11 both require the collection to be Stripe-hosted: §11 forbids
   * "reproducing provider-controlled fields" and §5.3 says Proovd stores
   * statuses and IDs and "never full bank details". A link is the whole
   * integration — there is no form on Proovd's side to bypass it.
   */
  createAccountLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<AccountLink>;
  /**
   * Reads the account back. The reconciliation path for a missed
   * `account.updated`, and what the return route uses so a Founder who lands
   * back sees the truth rather than the last webhook.
   */
  retrieveAccount(accountId: string): Promise<Record<string, unknown> | null>;

  /** The underlying SDK, for the phases that create payment objects. */
  readonly client: Stripe | null;
}

export interface StripeGatewayConfig {
  mode: StripeModeValue;
  apiVersion: string;
  secretKey: string;
  platformAccountId: string;
  platformWebhookSecret?: string | undefined;
  connectWebhookSecret?: string | undefined;
}

export function createStripeGateway(config: StripeGatewayConfig): StripeGateway {
  const client = new Stripe(config.secretKey, {
    // §32.2's locked version. Cast because the SDK types this as its own
    // literal union, and the whole point is that the operator pins it rather
    // than inheriting whatever the package was published against.
    apiVersion: config.apiVersion as Stripe.LatestApiVersion,
  });

  const secretFor = (endpoint: WebhookEndpoint) =>
    endpoint === 'platform' ? config.platformWebhookSecret : config.connectWebhookSecret;

  return {
    mode: config.mode,
    apiVersion: config.apiVersion,
    platformAccountId: config.platformAccountId,
    client,

    hasSecretFor(endpoint) {
      return Boolean(secretFor(endpoint));
    },

    verifyEvent(endpoint, rawBody, signature) {
      return verifyWithSecret(secretFor(endpoint), rawBody, signature, endpoint);
    },

    async createConnectedAccount(input) {
      const account = await client.accounts.create({
        country: input.country,
        ...(input.email ? { email: input.email } : {}),
        // §24.1: the Founder account is the seller and needs to take charges;
        // the Affiliate account "is a recipient only… never processes the
        // Backer charge and is never MoR" and needs only to be paid. Asking for
        // `card_payments` on a recipient would request a capability §24.1 says
        // it must never use.
        capabilities:
          input.role === 'founder_seller'
            ? { card_payments: { requested: true }, transfers: { requested: true } }
            : { transfers: { requested: true } },
      });
      return account.id;
    },

    async createAccountLink({ accountId, returnUrl, refreshUrl }) {
      const link = await client.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });
      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    },

    async retrieveAccount(accountId) {
      try {
        const account = await client.accounts.retrieve(accountId);
        return account as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Verification, shared by the real gateway and the suite's.
 *
 * `Stripe.webhooks.constructEvent` is a static, so an in-memory gateway can run
 * the real verifier over the real bytes. That matters: what the acceptance suite
 * has to exercise is Stripe's signature check, not a second implementation of
 * it written to pass its own tests.
 */
function verifyWithSecret(
  secret: string | undefined,
  rawBody: Buffer,
  signature: string | undefined,
  endpoint: WebhookEndpoint,
): VerifiedStripeEvent | null {
  // No secret and a wrong signature are the same answer. A deployment that has
  // not been given a secret must not be one that accepts anything — the
  // `unconfiguredScheduler` decision, applied to money.
  if (!secret || !signature) return null;

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }

  return toVerifiedEvent(event, endpoint);
}

/* ── An in-memory gateway, for tests ──────────────────────────────────────── */

export interface MemoryStripeGateway extends StripeGateway {
  /** Sets what `retrieveAccount` will answer, and what a webhook would carry. */
  setAccount(accountId: string, account: Record<string, unknown>): void;
  /** Every account-link request, so a test can assert one was issued. */
  readonly links: Array<{ accountId: string; returnUrl: string; refreshUrl: string }>;
  readonly created: Array<{ id: string; role: string; country: string }>;
}

/**
 * Real signature verification, fake account API.
 *
 * Not a mock of Stripe — the half that decides whether a request is authentic
 * runs Stripe's own code, and only the half that would require a network is
 * replaced. A suite that stubbed verification would prove its stub worked.
 */
export function createMemoryStripeGateway(config: {
  mode?: StripeModeValue;
  apiVersion?: string;
  platformAccountId?: string;
  platformWebhookSecret?: string;
  connectWebhookSecret?: string;
}): MemoryStripeGateway {
  const accounts = new Map<string, Record<string, unknown>>();
  const links: Array<{ accountId: string; returnUrl: string; refreshUrl: string }> = [];
  const created: Array<{ id: string; role: string; country: string }> = [];
  let counter = 0;

  return {
    mode: config.mode ?? 'test',
    apiVersion: config.apiVersion ?? '2026-07-29.dahlia',
    platformAccountId: config.platformAccountId ?? 'acct_platformtestaccount',
    client: null,
    links,
    created,

    hasSecretFor(endpoint) {
      return Boolean(
        endpoint === 'platform' ? config.platformWebhookSecret : config.connectWebhookSecret,
      );
    },

    verifyEvent(endpoint, rawBody, signature) {
      const secret =
        endpoint === 'platform' ? config.platformWebhookSecret : config.connectWebhookSecret;
      return verifyWithSecret(secret, rawBody, signature, endpoint);
    },

    setAccount(accountId, account) {
      accounts.set(accountId, account);
    },

    async createConnectedAccount(input) {
      counter += 1;
      const id = `acct_memory${String(counter).padStart(10, '0')}`;
      created.push({ id, role: input.role, country: input.country });
      accounts.set(id, {
        id,
        object: 'account',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        capabilities: {},
        requirements: {
          currently_due: ['external_account'],
          past_due: [],
          eventually_due: [],
          pending_verification: [],
          disabled_reason: null,
        },
      });
      return id;
    },

    async createAccountLink(input) {
      links.push(input);
      return {
        url: `https://connect.stripe.test/setup/${encodeURIComponent(input.accountId)}`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      };
    },

    async retrieveAccount(accountId) {
      return accounts.get(accountId) ?? null;
    },
  };
}

/** Shared by the real gateway and the suite's, so both produce one shape. */
export function toVerifiedEvent(
  event: Stripe.Event | Record<string, unknown>,
  endpoint: WebhookEndpoint,
): VerifiedStripeEvent {
  const raw = event as Record<string, unknown>;
  const data = (raw['data'] as Record<string, unknown> | undefined)?.['object'];

  return {
    id: String(raw['id'] ?? ''),
    type: String(raw['type'] ?? ''),
    account: typeof raw['account'] === 'string' ? raw['account'] : null,
    // Stripe sends seconds; §27.1 stores UTC instants.
    created: new Date(Number(raw['created'] ?? 0) * 1000),
    object: (data as Record<string, unknown> | undefined) ?? {},
    endpoint,
  };
}
