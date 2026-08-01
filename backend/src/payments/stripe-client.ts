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
  /** The underlying SDK, for the phases that create objects. */
  readonly client: Stripe;
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
      const secret = secretFor(endpoint);
      // No secret and a wrong signature are the same answer. A deployment that
      // has not been given a secret must not be one that accepts anything —
      // the `unconfiguredScheduler` decision, applied to money.
      if (!secret || !signature) return null;

      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch {
        return null;
      }

      return toVerifiedEvent(event, endpoint);
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
