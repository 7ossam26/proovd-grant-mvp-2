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
import {
  FUNDING_PURPOSE,
  applyAllocationFunding,
  recordFundingFailed,
} from '../creator-payment/allocations.js';
import { evaluateCreatorReadiness } from '../creator-payment/readiness.js';
import type { TokenService } from '../auth/token-service.js';
import { readProviderObject, recordProviderObject } from './provider-objects.js';
import { applyCaptureSuccess, applyCaptureFailure } from '../close/capture.js';
import { applyPayoutEvent } from '../close/earnings.js';
import { classifyCaptureFailure } from '../close/logic.js';
import {
  notifyChargeReceipt,
  notifyCaptureFailed,
  notifyRetrySuccess,
  type CloseNotificationDeps,
} from '../close/notifications.js';
import {
  applyConnectChargeRefunded,
  applyPlatformChargeRefunded,
  type RefundDeps,
} from '../refunds/service.js';

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
  /** Phase 18a: mints the Backer magic link for the receipt/recovery messages.
      Absent → the messages still send with the support-route fallback. */
  tokens?: TokenService | undefined;
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
 *   Phase 20b — charge.dispute.created/updated/closed
 *
 * Phase 20a registered `charge.refunded`: on the platform endpoint it belongs
 * to the listing stream, whose refund Phase 11 confirms synchronously — so the
 * handler reconciles rather than applies, and an unknown refund is recorded
 * and routed to Admin (§1 rule 6).
 */
export const PLATFORM_HANDLERS: Record<string, EventHandler> = {
  'checkout.session.completed': handleCheckoutCompleted,
  'checkout.session.expired': handleCheckoutExpired,
  'charge.refunded': handlePlatformChargeRefunded,
};

/**
 * §32.3's connected-account/campaign set.
 *
 * `account.updated` is the one this phase owns — it is what makes §13's four
 * onboarding states move without a person refreshing anything.
 *
 *   Phase 15 — setup_intent.*, payment_method.detached
 *   Phase 18 — payment_intent.*
 *   Phase 20b — charge.dispute.*, transfer.reversed
 *
 * Phase 19a registered `payout.paid`/`payout.failed` — Appendix B.7's tail.
 * `transfer.created`/`transfer.updated` stay recorded-and-ignored: the §22.1
 * Transfer is created by Proovd's own synchronous API call and stored under
 * §32.4 at creation, a creation failure is a synchronous error with NO
 * `transfer.failed` webhook (§32.3), and the reversal is Phase 20b's — it
 * pairs with the dispute/enforcement recovery operations, and 20a's
 * contractual recovery RECORD needs no provider leg (§24.9: best-effort).
 *
 * Phase 20a registered `charge.refunded` — §24.1's direct charges mean a
 * campaign refund lives on the Founder's account, so its confirmations arrive
 * HERE. The handler either confirms a refund Proovd recorded (by provider
 * refund id, through the same applier the execute path uses — a duplicate
 * delivery matches nothing, §33.7.7) or records a Founder-issued refund
 * (§24.10 lets the MoR issue one) and routes it to Admin for its §24.8
 * classification, never guessing one into place (§1 rule 6).
 *
 * `account.application.deauthorized` is registered because it is not a future
 * phase's: it means the account is gone *now*, and silently continuing to treat
 * a deauthorized account as a seller is the §1.4 failure with money attached.
 *
 * Phase 18a registered the `payment_intent.*` set — §24.1's direct charges
 * live on the Founder's connected account, so the campaign-money deliveries
 * arrive HERE, never at the platform endpoint. Each one applies through the
 * same `applyCaptureOutcome` path the close batch uses, which is what makes a
 * duplicate delivery a no-op rather than a second charge/email (§33.7.7).
 */
export const CONNECT_HANDLERS: Record<string, EventHandler> = {
  'account.updated': handleAccountUpdated,
  'account.application.deauthorized': handleAccountDeauthorized,
  'payment_intent.succeeded': handlePaymentIntentSucceeded,
  'payment_intent.payment_failed': handlePaymentIntentFailed,
  'payment_intent.requires_action': handlePaymentIntentRequiresAction,
  'payment_intent.canceled': handlePaymentIntentCanceled,
  'payout.paid': handlePayoutPaid,
  'payout.failed': handlePayoutFailed,
  'charge.refunded': handleConnectChargeRefunded,
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
  // Phase 13 (§16, §24.7). The fixed-Creator-payment funding rides the same
  // platform Checkout as the listing fee; the purpose discriminator in the
  // metadata Proovd's own API wrote decides which stream this is.
  const metadata = (event.object['metadata'] as Record<string, string> | undefined) ?? {};
  if (metadata['proovd_purpose'] === FUNDING_PURPOSE) {
    await handleFundingCompleted(context, event);
    return;
  }

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
 * The fixed-Creator-payment funding completed (§16, §24.7, §33.4.3). The exact
 * full amount marks the allocation `funded`; a partial or wrong amount leaves it
 * `payment_failed`, never funded. A successful funding re-evaluates the
 * Creator's readiness, so a `readiness_blocked` Creator whose only gap was the
 * allocation can move to `ready` (§16 item 12).
 */
async function handleFundingCompleted(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const object = event.object;
  const sessionId = typeof object['id'] === 'string' ? object['id'] : '';
  const metadata = (object['metadata'] as Record<string, string> | undefined) ?? {};
  const allocationId = metadata['proovd_allocation_id'] ?? '';
  const campaignId = metadata['proovd_campaign_id'] ?? '';
  const associationId = metadata['proovd_association_id'] ?? '';

  const stored = sessionId ? await findStoredSession(context.db, context.gateway, sessionId) : null;
  if (!sessionId || !allocationId || !campaignId || !associationId || !stored) {
    await context.audit({
      action: 'creator_payment.funding_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason:
        `a signed funding ${event.type} for session "${sessionId || 'unknown'}" could not be bound; ` +
        'recorded and routed to Admin, nothing applied',
    });
    return;
  }

  const amountTotal = object['amount_total'];
  const paymentIntentId =
    typeof object['payment_intent'] === 'string' ? object['payment_intent'] : null;

  const outcome = await applyAllocationFunding(
    context.db,
    { gateway: context.gateway, audit: context.audit },
    {
      allocationId,
      campaignId,
      associationId,
      checkoutSessionId: sessionId,
      paymentIntentId,
      amountTotalCents: typeof amountTotal === 'number' ? BigInt(amountTotal) : -1n,
      paidAt: event.created,
      providerEventId: event.id,
      actor: 'system:stripe-webhook',
    },
  );

  if (outcome.status === 'funded') {
    // §16 item 12 is now complete; a Creator blocked only on funding can move to
    // ready. Idempotent by the conditional transition.
    await evaluateCreatorReadiness(
      context.db,
      { audit: context.audit, mode: context.gateway.mode },
      { associationId: outcome.associationId, actor: 'system:stripe-webhook' },
    );
  }
}

/* ── Phase 18a: the off-session campaign charges (§21, §32.3, §33.7.7) ─────── */

/**
 * Binds a `payment_intent.*` delivery to its reservation.
 *
 * The anchor is the §32.4 provider object the close batch stored at creation —
 * the delivery's metadata was written by Proovd's own API call, but it is
 * still cross-checked against that stored row, and a delivery that does not
 * reconcile is recorded and routed to Admin rather than guessed into place
 * (§1 rule 6, the 09b/11 binding rule). Returns null when unbindable.
 */
async function bindPaymentIntentDelivery(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<{ paymentIntentId: string; reservationId: string } | null> {
  const object = event.object;
  const paymentIntentId = typeof object['id'] === 'string' ? object['id'] : '';
  const metadata = (object['metadata'] as Record<string, string> | undefined) ?? {};
  const claimedReservationId = metadata['proovd_reservation_id'] ?? '';

  const stored = paymentIntentId
    ? await readProviderObject(context.db, {
        mode: context.gateway.mode,
        providerObjectId: paymentIntentId,
      })
    : null;

  if (!stored?.reservationId || (claimedReservationId && stored.reservationId !== claimedReservationId)) {
    await context.audit({
      action: 'close.payment_intent_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason:
        `a signed ${event.type} for PaymentIntent "${paymentIntentId || 'unknown'}" could not be bound: ` +
        (stored
          ? `the stored object names reservation ${stored.reservationId ?? 'none'}, the delivery names "${claimedReservationId || 'none'}"`
          : 'no stored §32.4 object exists for it') +
        '. Recorded and routed to Admin; nothing was applied.',
    });
    return null;
  }

  return { paymentIntentId, reservationId: stored.reservationId };
}

function closeNotificationDeps(context: HandlerContext): CloseNotificationDeps | null {
  if (!context.notifier || !context.notificationContext) return null;
  return {
    db: context.db,
    notifier: context.notifier,
    context: context.notificationContext,
    tokens: context.tokens,
  };
}

/**
 * `payment_intent.succeeded` — the asynchronous confirmation of a close-batch
 * capture. The same applier the batch calls: a delivery for a reservation the
 * batch already captured is a no-op with no second ledger write and no second
 * receipt (§33.7.7).
 */
async function handlePaymentIntentSucceeded(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const bound = await bindPaymentIntentDelivery(context, event);
  if (!bound) return;

  const chargeId =
    typeof event.object['latest_charge'] === 'string' ? event.object['latest_charge'] : null;

  const applied = await applyCaptureSuccess(
    { db: context.db, audit: context.audit },
    {
      reservationId: bound.reservationId,
      paymentIntentId: bound.paymentIntentId,
      chargeId,
      stripeFeeCents: null,
      actor: 'system:stripe-webhook',
    },
  );

  if (applied.applied) {
    const notify = closeNotificationDeps(context);
    if (notify) {
      // §27.5 names "Charge receipt" and "Retry success" as separate events: a
      // capture that applied FROM the recovery window — the requires-action
      // completion, or a retry whose confirmation arrived asynchronously — is
      // the retry-success message, never a second receipt (Phase 18b).
      if (applied.from === 'capture_failed_retrying') {
        await notifyRetrySuccess(notify, applied.reservation);
      } else {
        await notifyChargeReceipt(notify, applied.reservation);
      }
    }
  }
}

/**
 * `payment_intent.payment_failed` / `payment_intent.requires_action` — the
 * §33.7.8 recovery entry, through the same applier as the batch. A duplicate
 * delivery matches nothing and sends nothing.
 */
async function applyPaymentIntentFailure(
  context: HandlerContext,
  event: VerifiedStripeEvent,
  status: string | null,
): Promise<void> {
  const bound = await bindPaymentIntentDelivery(context, event);
  if (!bound) return;

  const lastError =
    (event.object['last_payment_error'] as { code?: string; decline_code?: string } | undefined) ??
    {};
  const kind = classifyCaptureFailure({
    status,
    declineCode: lastError.decline_code ?? null,
  });

  const applied = await applyCaptureFailure(
    { db: context.db, audit: context.audit },
    {
      reservationId: bound.reservationId,
      kind,
      paymentIntentId: bound.paymentIntentId,
      failureCode: lastError.decline_code ?? lastError.code ?? null,
      actor: 'system:stripe-webhook',
    },
  );

  if (applied.applied) {
    const notify = closeNotificationDeps(context);
    if (notify) {
      await notifyCaptureFailed(notify, applied.reservation, {
        retryDeadlineAt: applied.retryDeadlineAt,
      });
    }
  }
}

async function handlePaymentIntentFailed(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyPaymentIntentFailure(context, event, null);
}

async function handlePaymentIntentRequiresAction(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyPaymentIntentFailure(context, event, 'requires_action');
}

/**
 * `payment_intent.canceled` — recorded, applied to nothing. §32.3 lists it;
 * the close batch never cancels an intent it created, so a cancellation is a
 * provider-side fact for Admin reconciliation, not a reservation transition.
 */
async function handlePaymentIntentCanceled(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const paymentIntentId = typeof event.object['id'] === 'string' ? event.object['id'] : 'unknown';
  await context.audit({
    action: 'close.payment_intent_canceled',
    targetType: 'provider_event',
    targetId: event.id,
    internalReason: `payment_intent.canceled received for ${paymentIntentId}; recorded for reconciliation, no reservation transition applied`,
  });
}

/**
 * `payout.paid` / `payout.failed` — Appendix B.7's tail (§22.1, Phase 19a).
 *
 * A payout is balance-level on the Creator's connected account, so it applies
 * to every `transferred` earnings row whose Transfer landed there. The §32.4
 * store records the payout either way; `payout.failed` routes the fix to the
 * Stripe-managed update path — the code stays internal (§25.6, §33.9.11).
 */
async function applyPayoutDelivery(
  context: HandlerContext,
  event: VerifiedStripeEvent,
  kind: 'paid' | 'failed',
): Promise<void> {
  const payoutId = typeof event.object['id'] === 'string' ? event.object['id'] : null;
  if (!payoutId || !event.account) {
    await context.audit({
      action: 'earnings.payout_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `payout.${kind} delivery could not be bound to a connected account; recorded for Admin reconciliation, applied to nothing (§1 rule 6)`,
    });
    return;
  }

  await recordProviderObject(context.db, {
    mode: context.gateway.mode,
    objectType: 'payout',
    providerObjectId: payoutId,
    accountContext: 'connected',
    stripeAccountId: event.account,
    amountCents:
      typeof event.object['amount'] === 'number' ? BigInt(event.object['amount']) : null,
    status: typeof event.object['status'] === 'string' ? event.object['status'] : kind,
    failureCode:
      typeof event.object['failure_code'] === 'string' ? event.object['failure_code'] : null,
    failureMessage:
      typeof event.object['failure_message'] === 'string' ? event.object['failure_message'] : null,
  });

  const applied = await applyPayoutEvent(
    {
      db: context.db,
      gateway: context.gateway,
      audit: context.audit,
      notifier: context.notifier,
      context: context.notificationContext,
    },
    {
      kind,
      stripeAccountId: event.account,
      payoutId,
      actor: 'system:stripe-webhook',
    },
  );

  await context.audit({
    action: `earnings.payout_${kind}`,
    targetType: 'provider_event',
    targetId: event.id,
    internalReason: `payout.${kind} for ${event.account} moved ${applied.moved} earnings record(s) (Appendix B.7)`,
  });
}

async function handlePayoutPaid(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyPayoutDelivery(context, event, 'paid');
}

async function handlePayoutFailed(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyPayoutDelivery(context, event, 'failed');
}

/* ── Phase 20a: the refund confirmations (§24.8, §32.3) ────────────────────── */

function refundDeps(context: HandlerContext): RefundDeps {
  return {
    db: context.db,
    gateway: context.gateway,
    audit: context.audit,
    notifier: context.notifier,
    context: context.notificationContext,
    tokens: context.tokens,
  };
}

async function handleConnectChargeRefunded(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyConnectChargeRefunded(refundDeps(context), {
    id: event.id,
    object: event.object,
    account: event.account ?? null,
  });
}

async function handlePlatformChargeRefunded(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  await applyPlatformChargeRefunded(refundDeps(context), {
    id: event.id,
    object: event.object,
  });
}

/**
 * `checkout.session.expired` — §13's/§16's abandonment path. A listing session
 * keeps the campaign `listing_fee_pending`; a funding session leaves the
 * allocation `payment_failed`, preserving the accepted amount and blocking work.
 * Either way a fresh attempt duplicates nothing.
 */
async function handleCheckoutExpired(
  context: HandlerContext,
  event: VerifiedStripeEvent,
): Promise<void> {
  const object = event.object;
  const sessionId = typeof object['id'] === 'string' ? object['id'] : '';
  if (!sessionId) return;

  const metadata = (object['metadata'] as Record<string, string> | undefined) ?? {};

  if (metadata['proovd_purpose'] === FUNDING_PURPOSE) {
    const allocationId = metadata['proovd_allocation_id'] ?? '';
    if (allocationId) {
      await recordFundingFailed(
        context.db,
        { gateway: context.gateway, audit: context.audit },
        { allocationId, checkoutSessionId: sessionId, providerEventId: event.id },
      );
    }
    return;
  }

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
