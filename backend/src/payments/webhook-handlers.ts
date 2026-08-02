/**
 * The Stripe event ingest — Spec §32.3, §28.3, §33.7.7.
 *
 * ── Idempotency is insert-first ────────────────────────────────────────────
 * §28.3: "Store provider event ID and process idempotently. Duplicate event can
 * update audit but cannot duplicate domain state, money, or notification."
 * Phase 10's own trap says it more sharply: "Checking whether an event was
 * processed *after* doing the work is not idempotency."
 *
 * So `provider_events` is claimed before any handler runs, on the Stripe event
 * id, in the same table Cal.com already uses with a different `provider`. A
 * redelivery increments the counter, writes an audit row, and returns.
 *
 * ── A registry, not a switch ───────────────────────────────────────────────
 * Phase 10's brief: "register the handler shape now so later phases add cases
 * rather than rebuild the router." §32.3 lists roughly twenty event types
 * across two endpoints, and all but `account.updated` belong to objects that do
 * not exist yet — Checkout sessions in Phase 11, SetupIntents in 15,
 * PaymentIntents in 18, Transfers in 19, disputes in 20.
 *
 * An unregistered type is recorded and ignored, deliberately. Guessing at an
 * event whose object Proovd does not yet create would be inventing behaviour
 * (§1 rule 6), and an event that arrives before its phase is not an error — it
 * is a Stripe account with a broader webhook subscription than this build uses.
 *
 * ── The two endpoints stay separate all the way down ───────────────────────
 * §32.3 splits the event sets between platform and Connect, and §24.1 splits
 * the money the same way: the listing fee is Proovd's, campaign charges are the
 * Founder's. A handler registered for one endpoint is not reachable from the
 * other, so a Connect delivery cannot drive a platform-side effect even if
 * Stripe were configured to send it.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { providerEvents } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { StripeGateway, VerifiedStripeEvent, WebhookEndpoint } from './stripe-client.js';
import {
  findAccountByStripeId,
  readAccountFacts,
  upsertConnectedAccount,
} from './connected-accounts.js';
import {
  applyListingPayment,
  recordCheckoutExpired,
  findStoredSession,
} from './listing-checkout.js';
import {
  notifyListingPayment,
  type ListingNotificationContext,
} from './listing-notifications.js';

export const STRIPE_PROVIDER = 'stripe';

export interface HandlerContext {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /**
   * §13's effect 7. Optional in the type because Phase 10's account handlers
   * never send; the app always supplies both, and the payment handler records
   * honestly when a context without them cannot send (§1.4).
   */
  notifier?: Notifier | undefined;
  notificationContext?: ListingNotificationContext | undefined;
}

export type EventHandler = (
  context: HandlerContext,
  event: VerifiedStripeEvent,
) => Promise<void>;

/**
 * §32.3's platform/listing set.
 *
 * Phase 11 registered the two Checkout events — the only objects Proovd's own
 * account creates so far. The rest belong to later phases and stay
 * recorded-and-ignored until a sender exists:
 *
 *   Phase 18 — payment_intent.succeeded, payment_intent.payment_failed
 *   Phase 20 — charge.refunded, charge.dispute.created/updated/closed
 */
export const PLATFORM_HANDLERS: Record<string, EventHandler> = {
  'checkout.session.completed': handleCheckoutCompleted,
  'checkout.session.expired': handleCheckoutExpired,
};

/**
 * §32.3's connected-account/campaign set.
 *
 * `account.updated` is the one this phase owns — it is what makes §13's four
 * onboarding states move without a person refreshing anything.
 *
 *   Phase 15 — setup_intent.*, payment_method.detached
 *   Phase 18 — payment_intent.*
 *   Phase 19 — transfer.created/updated/reversed, payout.paid/failed
 *   Phase 20 — charge.refunded, charge.dispute.*
 *
 * `account.application.deauthorized` is registered because it is not a future
 * phase's: it means the account is gone *now*, and silently continuing to treat
 * a deauthorized account as a seller is the §1.4 failure with money attached.
 */
export const CONNECT_HANDLERS: Record<string, EventHandler> = {
  'account.updated': handleAccountUpdated,
  'account.application.deauthorized': handleAccountDeauthorized,
};

export function handlersFor(endpoint: WebhookEndpoint): Record<string, EventHandler> {
  return endpoint === 'platform' ? PLATFORM_HANDLERS : CONNECT_HANDLERS;
}

/* ── The ingest ───────────────────────────────────────────────────────────── */

export type IngestOutcome =
  | { status: 'duplicate' }
  | { status: 'unhandled'; type: string }
  | { status: 'handled'; type: string }
  | { status: 'failed'; type: string; reason: string };

/**
 * Claims the event, then runs its handler.
 *
 * The claim lands before the handler and is *not* rolled back if the handler
 * throws — `processed_at` stays null instead. That is the honest state: the
 * event was received and its work did not finish, which is visible, and a
 * retry from Stripe finds the claim and skips. Rolling the claim back would
 * make a handler that fails halfway through re-runnable, which is exactly what
 * §28.3 forbids for anything that moved money.
 */
export async function ingestStripeEvent(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<IngestOutcome> {
  const { db, audit } = context;

  const claimed = await db
    .insert(providerEvents)
    .values({
      provider: STRIPE_PROVIDER,
      providerEventId: event.id,
      eventType: event.type,
      subjectId: typeof event.object['id'] === 'string' ? event.object['id'] : null,
    })
    .onConflictDoNothing()
    .returning({ id: providerEvents.id });

  if (claimed.length === 0) {
    const [seen] = await db
      .select({ seenCount: providerEvents.seenCount })
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.provider, STRIPE_PROVIDER),
          eq(providerEvents.providerEventId, event.id),
        ),
      )
      .limit(1);

    await db
      .update(providerEvents)
      .set({ seenCount: (seen?.seenCount ?? 1) + 1, lastSeenAt: new Date() })
      .where(
        and(
          eq(providerEvents.provider, STRIPE_PROVIDER),
          eq(providerEvents.providerEventId, event.id),
        ),
      );

    await audit({
      action: 'stripe.webhook_duplicate',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `${event.type} redelivered on the ${event.endpoint} endpoint; no domain work performed`,
    });

    return { status: 'duplicate' };
  }

  const handler = handlersFor(event.endpoint)[event.type];

  if (!handler) {
    await audit({
      action: 'stripe.webhook_unhandled',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `${event.type} has no handler registered for the ${event.endpoint} endpoint`,
    });
    await markProcessed(db, event.id);
    return { status: 'unhandled', type: event.type };
  }

  try {
    await handler(context, event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await audit({
      action: 'stripe.webhook_failed',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `${event.type} was claimed and its handler threw: ${reason}`,
    });
    // The claim stays, unprocessed. See the note above.
    return { status: 'failed', type: event.type, reason };
  }

  await markProcessed(db, event.id);
  return { status: 'handled', type: event.type };
}

async function markProcessed(db: Database, eventId: string): Promise<void> {
  await db
    .update(providerEvents)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(providerEvents.provider, STRIPE_PROVIDER),
        eq(providerEvents.providerEventId, eventId),
      ),
    );
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

/**
 * §32.3's `account.updated`, and what makes §13's states move on their own.
 *
 * An account Proovd has no record of is ignored rather than created. A Connect
 * platform receives `account.updated` for every account connected to it, and
 * inventing an owner for one Proovd never onboarded would put a row in the
 * ledger attributed to nobody. Phase 10b creates the record when onboarding
 * starts; this only ever updates one.
 */
async function handleAccountUpdated(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const stripeAccountId =
    typeof event.object['id'] === 'string' ? event.object['id'] : event.account;

  if (!stripeAccountId) return;

  const known = await findAccountByStripeId(context.db, stripeAccountId);
  if (!known) {
    await context.audit({
      action: 'stripe.account_updated_unknown',
      targetType: 'connected_account',
      targetId: stripeAccountId,
      internalReason:
        'account.updated arrived for an account Proovd has no onboarding record of; not created',
    });
    return;
  }

  const facts = readAccountFacts(event.object);
  const result = await upsertConnectedAccount(context.db, {
    stripeAccountId,
    mode: known.mode,
    role: known.role,
    ownerUserId: known.ownerUserId,
    facts,
    source: 'provider:stripe',
    actor: 'system:stripe-webhook',
    event: 'account_updated',
    providerEventId: event.id,
  });

  if (result.changed) {
    await context.audit({
      action: 'stripe.account_state_changed',
      targetType: 'connected_account',
      targetId: stripeAccountId,
      internalReason: `${result.priorState ?? 'unknown'} → ${result.state}`,
      priorValue: { state: result.priorState },
      newValue: { state: result.state, disabledReason: facts.disabledReason },
    });
  }
}

/**
 * The account is gone. §32.3 lists it "if OAuth is used", and Proovd registers
 * it either way: a deauthorized account that still reads as a seller is a
 * campaign that will fail at charge time with nobody having been told.
 */
async function handleAccountDeauthorized(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const stripeAccountId = event.account ?? null;
  if (!stripeAccountId) return;

  const known = await findAccountByStripeId(context.db, stripeAccountId);
  if (!known) return;

  await upsertConnectedAccount(context.db, {
    stripeAccountId,
    mode: known.mode,
    role: known.role,
    ownerUserId: known.ownerUserId,
    // Everything off, and a disabled reason Stripe itself uses. Deriving
    // `restricted` from these facts rather than setting the state directly
    // keeps one definition of what each state means.
    facts: {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: known.detailsSubmitted,
      currentlyDue: [],
      pastDue: [],
      eventuallyDue: [],
      pendingVerification: [],
      disabledReason: 'platform_paused',
      capabilities: {},
      agreementType: known.agreementType,
      agreementAcceptedAt: known.agreementAcceptedAt,
    },
    source: 'provider:stripe',
    actor: 'system:stripe-webhook',
    event: 'deauthorized',
    providerEventId: event.id,
  });

  await context.audit({
    action: 'stripe.account_deauthorized',
    targetType: 'connected_account',
    targetId: stripeAccountId,
    internalReason: 'the connected account was deauthorized; it can no longer act as seller or recipient',
  });
}

/* ── Phase 11: the listing Checkout (§13, §33.3.5–8) ──────────────────────── */

/**
 * Reads the session facts a delivery carries and binds them to a campaign.
 *
 * The metadata was written by Proovd's own API call at session creation — the
 * payer never holds it — but it is still cross-checked against the stored
 * §32.4 session row, and a delivery that does not reconcile is recorded and
 * routed to Admin rather than guessed into place (§1 rule 6). Returns null
 * when the delivery cannot be bound.
 */
async function bindCheckoutDelivery(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<{
  sessionId: string;
  campaignId: string;
  calculationId: string;
  subtotalCents: bigint;
  taxCents: bigint;
  taxCalculationId: string | null;
  newsletterOptIn: boolean;
} | null> {
  const object = event.object;
  const sessionId = typeof object['id'] === 'string' ? object['id'] : '';
  const metadata = (object['metadata'] as Record<string, string> | undefined) ?? {};
  const campaignId = metadata['proovd_campaign_id'] ?? '';
  const calculationId = metadata['proovd_calculation_id'] ?? '';

  const stored = sessionId
    ? await findStoredSession(context.db, context.gateway, sessionId)
    : null;

  if (!sessionId || !campaignId || !calculationId || !stored || stored.campaignId !== campaignId) {
    await context.audit({
      action: 'listing.checkout_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason:
        `a signed ${event.type} for session "${sessionId || 'unknown'}" could not be bound: ` +
        (stored
          ? `stored session belongs to campaign ${stored.campaignId ?? 'none'}, delivery names "${campaignId || 'none'}"`
          : 'no stored session row exists for it') +
        '. Recorded and routed to Admin; nothing was applied.',
    });
    return null;
  }

  let subtotalCents: bigint;
  let taxCents: bigint;
  try {
    subtotalCents = BigInt(metadata['proovd_subtotal_cents'] ?? '');
    taxCents = BigInt(metadata['proovd_tax_cents'] ?? '');
  } catch {
    await context.audit({
      action: 'listing.checkout_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `session ${sessionId} carries unreadable amount metadata; routed to Admin`,
    });
    return null;
  }

  return {
    sessionId,
    campaignId,
    calculationId,
    subtotalCents,
    taxCents,
    taxCalculationId: metadata['proovd_tax_calculation_id'] || null,
    newsletterOptIn: metadata['proovd_newsletter_opt_in'] === '1',
  };
}

/**
 * `checkout.session.completed` — §13's seven atomic effects, then effect 7's
 * messages after the transaction has committed. A throw from the atomic block
 * leaves the event claim unprocessed and answers 500, so Stripe retries a
 * payment that did not fully apply; an unbindable or duplicate delivery is
 * recorded and answers 200, because retrying it would produce a queue of
 * identical failures instead of the one audit row an Admin needs.
 */
async function handleCheckoutCompleted(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const bound = await bindCheckoutDelivery(context, event);
  if (!bound) return;

  const object = event.object;
  const amountTotal = object['amount_total'];
  const paymentIntentId =
    typeof object['payment_intent'] === 'string' ? object['payment_intent'] : null;

  const outcome = await applyListingPayment(
    context.db,
    { gateway: context.gateway, audit: context.audit },
    {
      campaignId: bound.campaignId,
      calculationId: bound.calculationId,
      checkoutSessionId: bound.sessionId,
      paymentIntentId,
      amountTotalCents: typeof amountTotal === 'number' ? BigInt(amountTotal) : -1n,
      subtotalCents: bound.subtotalCents,
      taxCents: bound.taxCents,
      taxCalculationId: bound.taxCalculationId,
      newsletterOptIn: bound.newsletterOptIn,
      // §33.3.7: the clock starts at successful payment — the completion
      // event's own moment, not receipt time and not any earlier act.
      paidAt: event.created,
      providerEventId: event.id,
      actor: 'system:stripe-webhook',
    },
  );

  if (outcome.status !== 'applied') return;

  // Effect 7, after the commit. A refusal is recorded by the notifier and the
  // claim stays visible; money never rolls back because an email bounced.
  if (context.notifier && context.notificationContext) {
    await notifyListingPayment(context.db, context.notifier, context.notificationContext, {
      campaignId: bound.campaignId,
      paymentId: outcome.paymentId,
      responseDeadlineAt: outcome.responseDeadlineAt,
      openedAssociationIds: outcome.openedAssociationIds,
    });
  } else {
    await context.audit({
      action: 'listing.notifications_unavailable',
      targetType: 'campaign',
      targetId: bound.campaignId,
      internalReason:
        'the payment applied but this process has no notifier configured; the §13 messages were not sent',
    });
  }
}

/**
 * `checkout.session.expired` — §13's abandonment path. The campaign stays
 * `listing_fee_pending`, no clock starts, every Founder input survives, and a
 * fresh attempt duplicates neither a charge nor an association.
 */
async function handleCheckoutExpired(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const object = event.object;
  const sessionId = typeof object['id'] === 'string' ? object['id'] : '';
  if (!sessionId) return;

  const metadata = (object['metadata'] as Record<string, string> | undefined) ?? {};
  const stored = await findStoredSession(context.db, context.gateway, sessionId);

  await recordCheckoutExpired(
    context.db,
    { gateway: context.gateway, audit: context.audit },
    {
      checkoutSessionId: sessionId,
      campaignId: stored?.campaignId ?? metadata['proovd_campaign_id'] ?? null,
      providerEventId: event.id,
    },
  );
}
