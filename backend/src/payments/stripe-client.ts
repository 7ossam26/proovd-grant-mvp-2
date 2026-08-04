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

/* ── The listing Checkout (§13, §24.6 — Phase 11) ─────────────────────────── */

export interface TaxAddress {
  line1?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode: string;
  country: string;
}

/**
 * A Stripe Tax calculation for the listing fee, made BEFORE Checkout so
 * Appendix A.5's `US$[TOTAL]` is a number the Founder was actually shown and
 * the session then charges exactly that (§19/§21's never-substitute rule,
 * applied to Proovd's own fee). Stored under §32.4 with its ID and expiry.
 */
export interface TaxCalculationResult {
  /** Stripe's calculation id — `taxcalc_…` — or null if the provider returned none. */
  id: string | null;
  taxCents: bigint;
  expiresAt: Date | null;
  /** §25.2: the reservation stores jurisdiction, rate, and taxability reason. */
  jurisdiction: string | null;
  rate: string | null;
  taxabilityReason: string | null;
}

export interface ListingCheckoutInput {
  customerEmail?: string | undefined;
  /** The one product line. §24.6's stream has exactly one product. */
  subtotalCents: bigint;
  /** From the stored tax calculation. Charged as its own line, labeled. */
  taxCents: bigint;
  successUrl: string;
  cancelUrl: string;
  /** Stripe-side idempotency, so a retried creation returns the same session. */
  idempotencyKey: string;
  /** Carries the campaign id back on the webhook. Never trusted alone. */
  metadata: Record<string, string>;
}

export interface ListingCheckoutSession {
  id: string;
  url: string;
  paymentIntentId: string | null;
  expiresAt: Date | null;
}

/**
 * The Founder-funding Checkout for the optional fixed Creator payment (§16,
 * §24.7). Collected on the platform account, exactly like the listing fee, but a
 * distinct stream with descriptor `PROOVD CREATOR PAY` and NO tax line — §24.7
 * excludes sales tax from it. The amount is the exact accepted allocation.
 */
export interface FundingCheckoutInput {
  customerEmail?: string | undefined;
  amountCents: bigint;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface RefundInput {
  paymentIntentId: string;
  /** Always the full Checkout total (§13). The caller states it explicitly. */
  amountCents: bigint;
  /** Stripe-side idempotency: a retried refund is the same refund, not a second. */
  idempotencyKey: string;
}

export interface RefundResult {
  id: string;
  status: string;
}

/* ── The reservation SetupIntent (§19, §24.2 — Phase 15) ───────────────────── */

/**
 * §24.1's direct-charge model puts the Backer's Customer and saved card on the
 * Founder's connected account, not the platform: the Founder is merchant of
 * record for every campaign charge, so the payment method that a later
 * off-session PaymentIntent uses must live where that charge is made.
 */
export interface CreateCustomerInput {
  email?: string | undefined;
  connectedAccountId: string;
  metadata?: Record<string, string> | undefined;
}

export interface ConfirmSetupIntentInput {
  customerId: string;
  connectedAccountId: string;
  /** A PaymentMethod created client-side via Stripe Elements. */
  paymentMethodId: string;
  /** Stripe-side idempotency, so a double-submit confirms one SetupIntent. */
  idempotencyKey: string;
  metadata?: Record<string, string> | undefined;
}

export interface SetupIntentResult {
  id: string;
  /** Stripe's SetupIntent status. Only `succeeded` may create a reservation. */
  status:
    | 'succeeded'
    | 'requires_action'
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'processing'
    | 'canceled';
  paymentMethodId: string | null;
  /** The card fingerprint — a §4.1 deduplication signal when available. */
  fingerprint: string | null;
  brand: string | null;
  last4: string | null;
  /** For a `requires_action` result the client must complete. */
  clientSecret: string | null;
}

export interface DetachPaymentMethodInput {
  paymentMethodId: string;
  connectedAccountId: string;
}

/* ── The close-batch off-session PaymentIntent (§21, §24.2 — Phase 18) ─────── */

export interface OffSessionPaymentIntentInput {
  /** The Founder's seller account — §24.1's direct-charge model. The saved
      Customer and PaymentMethod live there, so the charge is made there. */
  connectedAccountId: string;
  customerId: string;
  paymentMethodId: string;
  /** The exact authorized total. Never recalculated, never substituted (§19). */
  amountCents: bigint;
  /** The stable reservation/attempt key (§21 step 6, §33.7.7). A retried call
      under the same key is the SAME PaymentIntent at Stripe, not a second. */
  idempotencyKey: string;
  /** §24.12: the validated descriptor stored on the reservation. */
  statementDescriptorSuffix?: string | undefined;
  metadata?: Record<string, string> | undefined;
}

/**
 * The provider's answer, normalized. A card decline is a *result* here, not an
 * exception — the batch records every outcome the same way, and only a
 * transport/API error (where whether the intent exists is unknown) throws.
 */
export interface OffSessionPaymentIntentResult {
  id: string;
  status: 'succeeded' | 'requires_action' | 'failed';
  chargeId: string | null;
  /** The connected account's processing fee, when the provider reports it. */
  stripeFeeCents: bigint | null;
  /** Raw provider codes — internal detail only, never the message (§25.6). */
  failureCode: string | null;
  declineCode: string | null;
  failureMessage: string | null;
  /**
   * Present on `requires_action`: what the customer-action recovery surface
   * needs to complete authentication in the Backer's browser (§21 — routed to
   * a customer action, never silently succeeded or silently failed). Not a
   * secret in the credential sense: it is scoped to this one intent and is how
   * Stripe designs the hand-off.
   */
  clientSecret: string | null;
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

  /* ── The listing Checkout (§13, §24.6 — Phase 11) ──────────────────────── */

  /**
   * §12 puts Stripe Tax on the listing Checkout, and the env gates it
   * explicitly. False means the payment surface refuses loudly rather than
   * charging a total whose tax nobody calculated — §31.7: a zero caused by
   * missing configuration is not proof that no tax is due.
   */
  readonly taxEnabled: boolean;

  /**
   * A Stripe Tax calculation for one subtotal at one billing address.
   *
   * `connectedAccountId` routes the calculation to the Founder's seller account
   * (§19: reservation tax is calculated "using Founder seller/account"); omit it
   * for the platform-account listing fee (§13).
   */
  createTaxCalculation(input: {
    amountCents: bigint;
    address: TaxAddress;
    reference: string;
    connectedAccountId?: string | undefined;
  }): Promise<TaxCalculationResult>;

  /* ── The reservation SetupIntent (§19, §24.2 — Phase 15) ─────────────────── */

  /** A Customer on the Founder's connected account, for the saved card (§24.1). */
  createCustomer(input: CreateCustomerInput): Promise<string>;

  /**
   * Creates and confirms an off-session SetupIntent on the Founder's connected
   * account. Only a `succeeded` result may create a reservation (§33.5.4). No
   * card data is ever returned to Proovd beyond the safe fingerprint/brand/last4
   * (§28.3, §5.3).
   */
  confirmSetupIntent(input: ConfirmSetupIntentInput): Promise<SetupIntentResult>;

  /**
   * Detaches a saved PaymentMethod on cancellation (§20). Reference-safety —
   * not detaching a method another active transaction still uses — is the
   * caller's decision (§33.7.2); this performs the detach it is told to.
   */
  detachPaymentMethod(input: DetachPaymentMethodInput): Promise<void>;

  /**
   * One off-session PaymentIntent on the Founder's connected account for the
   * exact authorized total, confirmed immediately (§21 step 6, §24.2 step 8).
   * A decline or a pending customer action is a normalized *result*; only a
   * transport error — where the intent's existence is unknown — throws, and
   * the caller retries under the SAME idempotency key (§33.7.7).
   */
  createOffSessionPaymentIntent(
    input: OffSessionPaymentIntentInput,
  ): Promise<OffSessionPaymentIntentResult>;

  /**
   * Stripe Checkout on Proovd's platform account — never a Connect charge
   * (§24.6, §33.3.6). Descriptor `PROOVD LISTING`; the amounts are the exact
   * ones the A.5 consent named.
   */
  createListingCheckoutSession(input: ListingCheckoutInput): Promise<ListingCheckoutSession>;

  /**
   * Stripe Checkout on the platform account for the fixed Creator payment
   * (§16, §24.7). Descriptor `PROOVD CREATOR PAY`; one product line, no tax
   * line. Never a Connect charge — the Transfer to the Creator's recipient
   * account is Phase 19.
   */
  createFundingCheckoutSession(input: FundingCheckoutInput): Promise<ListingCheckoutSession>;

  /** Reads a session back — Admin reconciliation for a missed delivery. */
  retrieveCheckoutSession(sessionId: string): Promise<Record<string, unknown> | null>;

  /** A full refund to the original payment method (§13, §33.3.8). */
  createRefund(input: RefundInput): Promise<RefundResult>;

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
  /** `STRIPE_TAX_ENABLED`. Defaults false — unconfigured tax refuses loudly. */
  taxEnabled?: boolean | undefined;
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
    taxEnabled: config.taxEnabled ?? false,
    client,

    hasSecretFor(endpoint) {
      return Boolean(secretFor(endpoint));
    },

    verifyEvent(endpoint, rawBody, signature) {
      return verifyWithSecret(secretFor(endpoint), rawBody, signature, endpoint);
    },

    async createTaxCalculation(input) {
      // No product tax code is stated here on purpose: which code applies is a
      // tax decision the operator records in the Stripe dashboard's preset, not
      // something this code invents (§1 rule 6, §31.7's "active provider tax
      // settings"). `stripeAccount` routes a reservation calculation to the
      // Founder's seller account (§19); the listing fee omits it (platform).
      const calculation = await client.tax.calculations.create(
        {
          currency: 'usd',
          line_items: [{ amount: Number(input.amountCents), reference: input.reference }],
          customer_details: {
            address: {
              country: input.address.country,
              postal_code: input.address.postalCode,
              ...(input.address.state ? { state: input.address.state } : {}),
              ...(input.address.city ? { city: input.address.city } : {}),
              ...(input.address.line1 ? { line1: input.address.line1 } : {}),
            },
            address_source: 'billing',
          },
        },
        input.connectedAccountId ? { stripeAccount: input.connectedAccountId } : undefined,
      );
      // The SDK types tax_breakdown loosely across versions; read defensively.
      const breakdown = (calculation.tax_breakdown?.[0] ?? {}) as {
        jurisdiction?: { display_name?: string };
        tax_rate_details?: { percentage_decimal?: string };
        taxability_reason?: string;
      };
      return {
        id: calculation.id ?? null,
        taxCents: BigInt(calculation.tax_amount_exclusive ?? 0),
        expiresAt: calculation.expires_at ? new Date(calculation.expires_at * 1000) : null,
        jurisdiction: breakdown.jurisdiction?.display_name ?? null,
        rate: breakdown.tax_rate_details?.percentage_decimal ?? null,
        taxabilityReason: breakdown.taxability_reason ?? null,
      };
    },

    async createCustomer(input) {
      const customer = await client.customers.create(
        {
          ...(input.email ? { email: input.email } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        { stripeAccount: input.connectedAccountId },
      );
      return customer.id;
    },

    async confirmSetupIntent(input) {
      const intent = await client.setupIntents.create(
        {
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          confirm: true,
          usage: 'off_session',
          // The Backer is present now; the future charge is off-session. Cards
          // only — no redirect flows a later off-session charge could not use.
          payment_method_types: ['card'],
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        { stripeAccount: input.connectedAccountId, idempotencyKey: input.idempotencyKey },
      );

      const paymentMethodId =
        typeof intent.payment_method === 'string'
          ? intent.payment_method
          : (intent.payment_method?.id ?? input.paymentMethodId);

      let fingerprint: string | null = null;
      let brand: string | null = null;
      let last4: string | null = null;
      if (paymentMethodId) {
        try {
          const pm = await client.paymentMethods.retrieve(
            paymentMethodId,
            {},
            { stripeAccount: input.connectedAccountId },
          );
          fingerprint = pm.card?.fingerprint ?? null;
          brand = pm.card?.brand ?? null;
          last4 = pm.card?.last4 ?? null;
        } catch {
          // The SetupIntent stands; the safe display fields are best-effort.
        }
      }

      return {
        id: intent.id,
        status: intent.status as SetupIntentResult['status'],
        paymentMethodId,
        fingerprint,
        brand,
        last4,
        clientSecret: intent.client_secret ?? null,
      };
    },

    async detachPaymentMethod(input) {
      await client.paymentMethods.detach(
        input.paymentMethodId,
        {},
        { stripeAccount: input.connectedAccountId },
      );
    },

    async createOffSessionPaymentIntent(input) {
      try {
        const intent = await client.paymentIntents.create(
          {
            amount: Number(input.amountCents),
            currency: 'usd',
            customer: input.customerId,
            payment_method: input.paymentMethodId,
            // The Backer is not present (§24.2). `confirm: true` makes the
            // one call the one charge attempt; `error_on_requires_action` is
            // deliberately NOT set — §21 routes `requires_action` to a
            // customer-action recovery rather than converting it to a failure.
            off_session: true,
            confirm: true,
            payment_method_types: ['card'],
            ...(input.statementDescriptorSuffix
              ? { statement_descriptor_suffix: input.statementDescriptorSuffix.slice(0, 22) }
              : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
            expand: ['latest_charge.balance_transaction'],
          },
          { stripeAccount: input.connectedAccountId, idempotencyKey: input.idempotencyKey },
        );
        return normalizePaymentIntent(intent);
      } catch (error) {
        // A card error carries the PaymentIntent it created — that is a
        // *result* (the attempt happened, the card said no), not a transport
        // failure, and the batch records it as one (§33.7.8).
        const stripeError = error as {
          type?: string;
          code?: string;
          decline_code?: string;
          message?: string;
          payment_intent?: Stripe.PaymentIntent;
        };
        if (stripeError.type === 'StripeCardError' && stripeError.payment_intent) {
          const normalized = normalizePaymentIntent(stripeError.payment_intent);
          return {
            ...normalized,
            status: 'failed',
            failureCode: stripeError.code ?? normalized.failureCode,
            declineCode: stripeError.decline_code ?? normalized.declineCode,
            failureMessage: stripeError.message ?? normalized.failureMessage,
          };
        }
        throw error;
      }
    },

    async createListingCheckoutSession(input) {
      const session = await client.checkout.sessions.create(
        {
          mode: 'payment',
          ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: Number(input.subtotalCents),
                product_data: { name: 'Proovd listing fee' },
              },
            },
            // The tax the stored calculation produced, as its own labeled line.
            // `automatic_tax` stays off: the consented A.5 total is charged
            // exactly, never a substituted one (§19/§21's rule).
            ...(input.taxCents > 0n
              ? [
                  {
                    quantity: 1,
                    price_data: {
                      currency: 'usd',
                      unit_amount: Number(input.taxCents),
                      product_data: { name: 'Sales tax' },
                    },
                  },
                ]
              : []),
          ],
          payment_intent_data: {
            statement_descriptor: 'PROOVD LISTING',
            metadata: input.metadata,
          },
          metadata: input.metadata,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        id: session.id,
        url: session.url ?? '',
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      };
    },

    async createFundingCheckoutSession(input) {
      const session = await client.checkout.sessions.create(
        {
          mode: 'payment',
          ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
          // One product line, the exact accepted amount. §24.7 excludes sales
          // tax from this stream, so there is no tax line and `automatic_tax`
          // stays off.
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: Number(input.amountCents),
                product_data: { name: 'Secured Creator payment' },
              },
            },
          ],
          payment_intent_data: {
            statement_descriptor: 'PROOVD CREATOR PAY',
            metadata: input.metadata,
          },
          metadata: input.metadata,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        id: session.id,
        url: session.url ?? '',
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      };
    },

    async retrieveCheckoutSession(sessionId) {
      try {
        const session = await client.checkout.sessions.retrieve(sessionId);
        return session as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },

    async createRefund(input) {
      const refund = await client.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: Number(input.amountCents),
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: refund.id, status: refund.status ?? 'pending' };
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

/** Reduces a provider PaymentIntent to the §21 result the batch records. */
function normalizePaymentIntent(intent: Stripe.PaymentIntent): OffSessionPaymentIntentResult {
  const charge =
    typeof intent.latest_charge === 'object' && intent.latest_charge !== null
      ? intent.latest_charge
      : null;
  const balance =
    charge && typeof charge.balance_transaction === 'object' && charge.balance_transaction !== null
      ? charge.balance_transaction
      : null;
  const lastError = intent.last_payment_error ?? null;

  return {
    id: intent.id,
    status:
      intent.status === 'succeeded'
        ? 'succeeded'
        : intent.status === 'requires_action'
          ? 'requires_action'
          : 'failed',
    chargeId: charge?.id ?? (typeof intent.latest_charge === 'string' ? intent.latest_charge : null),
    stripeFeeCents: balance ? BigInt(balance.fee) : null,
    failureCode: lastError?.code ?? null,
    declineCode: lastError?.decline_code ?? null,
    failureMessage: lastError?.message ?? null,
    clientSecret: intent.status === 'requires_action' ? (intent.client_secret ?? null) : null,
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
  /** The flat rate the fake tax calculation applies. Set by tests. */
  setTaxRate(rate: number): void;
  /** Every session this gateway created, newest last. */
  readonly sessions: Array<{
    id: string;
    paymentIntentId: string;
    subtotalCents: bigint;
    taxCents: bigint;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }>;
  /** Every refund call, so a test can assert exactly one reached the provider. */
  readonly refunds: Array<{ id: string; paymentIntentId: string; amountCents: bigint }>;
  /** Makes the next `createRefund` throw once — the crash-between test. */
  failNextRefund(message: string): void;

  /* ── Phase 18 controls ─────────────────────────────────────────────────── */
  /** Every off-session PaymentIntent this gateway created, newest last. A
      replayed idempotency key returns the cached result and adds NO entry —
      which is exactly what §33.7.7's assertions count. */
  readonly paymentIntents: Array<{
    id: string;
    connectedAccountId: string;
    customerId: string;
    paymentMethodId: string;
    amountCents: bigint;
    idempotencyKey: string;
    status: 'succeeded' | 'requires_action' | 'failed';
  }>;
  /** Pins the outcome of a capture on this PaymentMethod (default succeeded). */
  setCaptureOutcome(
    paymentMethodId: string,
    outcome: 'succeeded' | 'card_declined' | 'insufficient_funds' | 'requires_action',
  ): void;
  /** Makes the next `createOffSessionPaymentIntent` throw once — the crash test. */
  failNextPaymentIntent(message: string): void;

  /* ── Phase 15 controls ─────────────────────────────────────────────────── */
  readonly customers: Array<{ id: string; connectedAccountId: string; email?: string }>;
  readonly setupIntents: Array<{
    id: string;
    connectedAccountId: string;
    customerId: string;
    paymentMethodId: string;
    status: SetupIntentResult['status'];
  }>;
  readonly detachedPaymentMethods: Array<{ paymentMethodId: string; connectedAccountId: string }>;
  /** Forces the next `confirmSetupIntent` to return this status (default succeeded). */
  setNextSetupOutcome(status: SetupIntentResult['status']): void;
  /** Makes the next `confirmSetupIntent` throw once — the provider-error path. */
  failNextSetup(message: string): void;
  /** Pins a payment method's card fingerprint, for §4.1 dedup tests. */
  setCardFingerprint(paymentMethodId: string, fingerprint: string): void;
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
  taxEnabled?: boolean;
}): MemoryStripeGateway {
  const accounts = new Map<string, Record<string, unknown>>();
  const links: Array<{ accountId: string; returnUrl: string; refreshUrl: string }> = [];
  const created: Array<{ id: string; role: string; country: string }> = [];
  const sessions: MemoryStripeGateway['sessions'] = [];
  const sessionsByKey = new Map<string, number>();
  const refunds: MemoryStripeGateway['refunds'] = [];
  const refundsByKey = new Map<string, RefundResult>();
  const customers: MemoryStripeGateway['customers'] = [];
  const setupIntents: MemoryStripeGateway['setupIntents'] = [];
  const setupIntentsByKey = new Map<string, SetupIntentResult>();
  const detachedPaymentMethods: MemoryStripeGateway['detachedPaymentMethods'] = [];
  const cardFingerprints = new Map<string, string>();
  const paymentIntents: MemoryStripeGateway['paymentIntents'] = [];
  const paymentIntentsByKey = new Map<string, OffSessionPaymentIntentResult>();
  const captureOutcomes = new Map<
    string,
    'succeeded' | 'card_declined' | 'insufficient_funds' | 'requires_action'
  >();
  let nextPaymentIntentFailure: string | null = null;
  let counter = 0;
  // A flat 8% unless a test says otherwise. Test infrastructure only — the
  // number is never customer-facing and never leaves the suite.
  let taxRate = 0.08;
  let nextRefundFailure: string | null = null;
  let nextSetupOutcome: SetupIntentResult['status'] = 'succeeded';
  let nextSetupFailure: string | null = null;

  return {
    mode: config.mode ?? 'test',
    apiVersion: config.apiVersion ?? '2026-07-29.dahlia',
    platformAccountId: config.platformAccountId ?? 'acct_platformtestaccount',
    taxEnabled: config.taxEnabled ?? true,
    client: null,
    links,
    created,
    sessions,
    refunds,
    customers,
    setupIntents,
    detachedPaymentMethods,
    paymentIntents,

    setTaxRate(rate) {
      taxRate = rate;
    },

    setCaptureOutcome(paymentMethodId, outcome) {
      captureOutcomes.set(paymentMethodId, outcome);
    },

    failNextPaymentIntent(message) {
      nextPaymentIntentFailure = message;
    },

    failNextRefund(message) {
      nextRefundFailure = message;
    },

    setNextSetupOutcome(status) {
      nextSetupOutcome = status;
    },

    failNextSetup(message) {
      nextSetupFailure = message;
    },

    setCardFingerprint(paymentMethodId, fingerprint) {
      cardFingerprints.set(paymentMethodId, fingerprint);
    },

    async createCustomer(input) {
      counter += 1;
      const id = `cus_memory${String(counter).padStart(10, '0')}`;
      customers.push({
        id,
        connectedAccountId: input.connectedAccountId,
        ...(input.email ? { email: input.email } : {}),
      });
      return id;
    },

    async confirmSetupIntent(input) {
      if (nextSetupFailure) {
        const message = nextSetupFailure;
        nextSetupFailure = null;
        throw new Error(message);
      }
      // Stripe-side idempotency: the same key confirms one SetupIntent.
      const cached = setupIntentsByKey.get(input.idempotencyKey);
      if (cached) return cached;

      const status = nextSetupOutcome;
      nextSetupOutcome = 'succeeded';
      counter += 1;
      const id = `seti_memory${String(counter).padStart(10, '0')}`;
      setupIntents.push({
        id,
        connectedAccountId: input.connectedAccountId,
        customerId: input.customerId,
        paymentMethodId: input.paymentMethodId,
        status,
      });
      const fingerprint =
        cardFingerprints.get(input.paymentMethodId) ?? `fp_${input.paymentMethodId}`;
      const result: SetupIntentResult = {
        id,
        status,
        paymentMethodId: status === 'succeeded' ? input.paymentMethodId : null,
        fingerprint: status === 'succeeded' ? fingerprint : null,
        brand: status === 'succeeded' ? 'visa' : null,
        last4: status === 'succeeded' ? '4242' : null,
        clientSecret: status === 'succeeded' ? null : `${id}_secret`,
      };
      setupIntentsByKey.set(input.idempotencyKey, result);
      return result;
    },

    async detachPaymentMethod(input) {
      detachedPaymentMethods.push({
        paymentMethodId: input.paymentMethodId,
        connectedAccountId: input.connectedAccountId,
      });
    },

    async createOffSessionPaymentIntent(input) {
      if (nextPaymentIntentFailure) {
        // A transport error: whether the intent exists is unknown. The caller
        // retries under the SAME key — which is what the cache below proves.
        const message = nextPaymentIntentFailure;
        nextPaymentIntentFailure = null;
        throw new Error(message);
      }
      // Stripe-side idempotency: the same key answers with the same intent and
      // records no second attempt (§33.7.7).
      const cached = paymentIntentsByKey.get(input.idempotencyKey);
      if (cached) return cached;

      const outcome = captureOutcomes.get(input.paymentMethodId) ?? 'succeeded';
      counter += 1;
      const id = `pi_capture${String(counter).padStart(10, '0')}`;
      const status =
        outcome === 'succeeded'
          ? 'succeeded'
          : outcome === 'requires_action'
            ? 'requires_action'
            : 'failed';

      paymentIntents.push({
        id,
        connectedAccountId: input.connectedAccountId,
        customerId: input.customerId,
        paymentMethodId: input.paymentMethodId,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        status,
      });

      // Test-infrastructure numbers only (2.9% + 30¢): never customer-facing,
      // never leaves the suite — the taxRate constant's reasoning.
      const fee =
        status === 'succeeded'
          ? BigInt(Math.round(Number(input.amountCents) * 0.029)) + 30n
          : null;

      const result: OffSessionPaymentIntentResult = {
        id,
        status,
        chargeId: status === 'succeeded' ? `ch_capture${String(counter).padStart(10, '0')}` : null,
        stripeFeeCents: fee,
        failureCode: status === 'failed' ? 'card_declined' : null,
        declineCode:
          outcome === 'insufficient_funds'
            ? 'insufficient_funds'
            : outcome === 'card_declined'
              ? 'generic_decline'
              : null,
        failureMessage: status === 'failed' ? 'Your card was declined.' : null,
        clientSecret: status === 'requires_action' ? `${id}_secret` : null,
      };
      paymentIntentsByKey.set(input.idempotencyKey, result);
      return result;
    },

    async createTaxCalculation(input) {
      counter += 1;
      const taxCents = BigInt(Math.round(Number(input.amountCents) * taxRate));
      return {
        id: `taxcalc_memory${String(counter).padStart(10, '0')}`,
        taxCents,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        jurisdiction: input.address.state ?? input.address.country,
        rate: (taxRate * 100).toFixed(4),
        taxabilityReason: taxCents > 0n ? 'standard_rated' : 'not_collecting',
      };
    },

    async createListingCheckoutSession(input) {
      // Stripe-side idempotency: the same key answers with the same session.
      const existing = sessionsByKey.get(input.idempotencyKey);
      if (existing !== undefined) {
        const found = sessions[existing]!;
        return {
          id: found.id,
          url: `https://checkout.stripe.test/pay/${found.id}`,
          paymentIntentId: found.paymentIntentId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        };
      }
      counter += 1;
      const id = `cs_memory${String(counter).padStart(10, '0')}`;
      const paymentIntentId = `pi_memory${String(counter).padStart(10, '0')}`;
      sessionsByKey.set(input.idempotencyKey, sessions.length);
      sessions.push({
        id,
        paymentIntentId,
        subtotalCents: input.subtotalCents,
        taxCents: input.taxCents,
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        id,
        url: `https://checkout.stripe.test/pay/${id}`,
        paymentIntentId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },

    async createFundingCheckoutSession(input) {
      // The same platform-Checkout machinery as the listing fee, minus tax:
      // one product line for the exact amount.
      const existing = sessionsByKey.get(input.idempotencyKey);
      if (existing !== undefined) {
        const found = sessions[existing]!;
        return {
          id: found.id,
          url: `https://checkout.stripe.test/pay/${found.id}`,
          paymentIntentId: found.paymentIntentId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        };
      }
      counter += 1;
      const id = `cs_fundmemory${String(counter).padStart(10, '0')}`;
      const paymentIntentId = `pi_fundmemory${String(counter).padStart(10, '0')}`;
      sessionsByKey.set(input.idempotencyKey, sessions.length);
      sessions.push({
        id,
        paymentIntentId,
        subtotalCents: input.amountCents,
        taxCents: 0n,
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        id,
        url: `https://checkout.stripe.test/pay/${id}`,
        paymentIntentId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },

    async retrieveCheckoutSession(sessionId) {
      const found = sessions.find((s) => s.id === sessionId);
      if (!found) return null;
      return {
        id: found.id,
        object: 'checkout.session',
        payment_intent: found.paymentIntentId,
        amount_subtotal: Number(found.subtotalCents + found.taxCents),
        amount_total: Number(found.subtotalCents + found.taxCents),
        metadata: found.metadata,
        status: 'open',
      };
    },

    async createRefund(input) {
      if (nextRefundFailure) {
        const message = nextRefundFailure;
        nextRefundFailure = null;
        throw new Error(message);
      }
      const existing = refundsByKey.get(input.idempotencyKey);
      if (existing) return existing;
      counter += 1;
      const result: RefundResult = {
        id: `re_memory${String(counter).padStart(10, '0')}`,
        status: 'succeeded',
      };
      refundsByKey.set(input.idempotencyKey, result);
      refunds.push({
        id: result.id,
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
      });
      return result;
    },

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
