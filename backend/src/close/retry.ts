/**
 * The 48-hour recovery window — Spec §21, §24.2, §28.1, §33.7.9, §33.7.10
 * (Phase 18b).
 *
 * Two services on the one window 18a opened:
 *
 *  - `updateCardAndRetry` — the Backer's B.5 `Update card` action. A new card
 *    is saved through a fresh SetupIntent (§28.1's "special short-lived
 *    provider session … must preserve underlying identity/scope" — the magic
 *    link is the identity, and nothing else on the reservation is written), and
 *    the retry is one off-session PaymentIntent under the NEXT stable attempt
 *    key (`reservation-capture:<id>:2`), claimed before the provider call
 *    exactly as the close batch claims attempt 1 (§33.7.7). `requires_action`
 *    returns the client secret for the customer-action surface rather than
 *    silently succeeding or silently failing (§21); the Connect webhook then
 *    applies the completed capture through the same applier as everything else.
 *
 *  - `endRetryWindow` / `sweepRetryWindowEnds` — the window's end. Successful
 *    recoveries already count as captured (the applier moved them); every
 *    reservation still `capture_failed_retrying` becomes
 *    `capture_failed_dropped`, and dropped is zero EVERYWHERE (§33.7.10) —
 *    structurally, because the ledger columns are written only at capture and a
 *    dropped row never reaches that write. B.5 promised "this pre-order will be
 *    canceled after the retry window", so the drop reference-safely detaches
 *    the saved card the way a cancellation does (§33.7.1's rule), sends the
 *    US$0 closure, and flips the operational record to do-not-fulfill.
 *
 * The deadline is the BATCH's `retry_deadline_at` — the one window, anchored at
 * the first failure, CHECK-pinned and trigger-fixed in 0028. Nothing here
 * computes a second deadline; the anchor gates and the sweep only notices.
 */

import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignStatusHistory,
  reservations,
  reservationStatusHistory,
  type Reservation,
} from '../db/schema/domain.js';
import { campaignCloseBatches, reservationCaptureAttempts } from '../db/schema/close.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import { findCampaignFounderUserId } from '../reservations/context.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import { classifyCaptureFailure, type CaptureFailureKind } from './logic.js';
import { applyCaptureSuccess } from './capture.js';
import { captureAttemptKey, type CloseBatchDeps } from './close-batch.js';
import {
  notifyRetrySuccess,
  notifyRetryWindowDropped,
  notifyCreatorsCampaignClosed,
  notifyRetryReconciliationComplete,
  type CloseNotificationDeps,
} from './notifications.js';

export type RetryDeps = CloseBatchDeps;

function notificationDeps(deps: RetryDeps): CloseNotificationDeps | null {
  if (!deps.notifier || !deps.context) return null;
  return { db: deps.db, notifier: deps.notifier, context: deps.context, tokens: deps.tokens };
}

/* ── The update-card retry (§33.7.9) ───────────────────────────────────────── */

export type UpdateCardOutcome =
  | { status: 'captured'; reservation: Reservation }
  | { status: 'already_captured' }
  | { status: 'failed_again'; kind: CaptureFailureKind }
  | { status: 'requires_action'; paymentIntentId: string; clientSecret: string | null }
  | { status: 'not_recoverable'; current: string }
  | { status: 'retry_window_closed'; deadline: Date }
  | { status: 'setup_failed' }
  | { status: 'provider_error' }
  | { status: 'not_found' };

export async function updateCardAndRetry(
  deps: RetryDeps,
  input: {
    reservationId: string;
    backerIdentityId: string;
    paymentMethodId: string;
    /** Client idempotency for the SetupIntent, like the pre-order's (§19). */
    requestId?: string | undefined;
    actor: string;
    now?: Date;
  },
): Promise<UpdateCardOutcome> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();

  // Scoped inside the query: someone else's reservation answers `not_found`,
  // the same answer a non-existent one gets (§5.5's posture, applied here).
  const [reservation] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.id, input.reservationId),
        eq(reservations.backerIdentityId, input.backerIdentityId),
      ),
    )
    .limit(1);
  if (!reservation) return { status: 'not_found' };

  // A duplicate submission after success is a person double-clicking, not an
  // error — the stale failure is already cleared (§33.7.9).
  if (reservation.status === 'captured') return { status: 'already_captured' };
  if (reservation.status !== 'capture_failed_retrying') {
    return { status: 'not_recoverable', current: reservation.status };
  }

  // The one window (§21 step 8). The anchor gates, not the sweep tick: a
  // request after the stored deadline is refused even before the end sweep has
  // run — the same shape as `campaign_close_at` ending cancellation.
  const [batch] = await db
    .select({ retryDeadlineAt: campaignCloseBatches.retryDeadlineAt })
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, reservation.campaignId))
    .limit(1);
  if (!batch?.retryDeadlineAt) {
    // A retrying reservation with no window is a state 18a cannot produce;
    // refuse rather than invent a deadline (§1 rule 6).
    return { status: 'not_recoverable', current: 'no_retry_window' };
  }
  if (batch.retryDeadlineAt.getTime() <= now.getTime()) {
    return { status: 'retry_window_closed', deadline: batch.retryDeadlineAt };
  }

  const founderUserId = await findCampaignFounderUserId(db, reservation.campaignId);
  const account = founderUserId
    ? await findAccountForOwner(db, {
        ownerUserId: founderUserId,
        role: 'founder_seller',
        mode: deps.gateway.mode,
      })
    : null;
  if (!account) return { status: 'provider_error' };

  /* ── Save the new card: a fresh SetupIntent on the same Customer ────────── */

  if (!reservation.stripeCustomerId) return { status: 'not_recoverable', current: 'no_customer' };

  let setup;
  try {
    setup = await deps.gateway.confirmSetupIntent({
      connectedAccountId: account.stripeAccountId,
      customerId: reservation.stripeCustomerId,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `card-update:${reservation.id}:${input.requestId ?? input.paymentMethodId}`,
      metadata: {
        proovd_reservation_id: reservation.id,
        proovd_campaign_id: reservation.campaignId,
        proovd_purpose: 'card_update',
      },
    });
  } catch (error) {
    await audit({
      action: 'close.card_update_setup_errored',
      targetType: 'reservation',
      targetId: reservation.id,
      internalReason: `the card-update SetupIntent errored at the transport: ${
        error instanceof Error ? error.message : String(error)
      }. Nothing changed; the Backer can try again.`,
      actorId: input.actor,
    });
    return { status: 'provider_error' };
  }
  if (setup.status !== 'succeeded' || !setup.paymentMethodId) {
    return { status: 'setup_failed' };
  }

  // §32.4: the new SetupIntent is recorded and bound to the reservation. The
  // ORIGINAL setup_intent_id stays — it is historical (§23.5) and the 0023
  // trigger refuses to change it; only the payment-method reference moves.
  await recordProviderObject(db, {
    mode: deps.gateway.mode,
    objectType: 'setup_intent',
    providerObjectId: setup.id,
    accountContext: 'connected',
    stripeAccountId: account.stripeAccountId,
    campaignId: reservation.campaignId,
    reservationId: reservation.id,
    status: 'succeeded',
    providerCreatedAt: now,
  });

  const priorCard = {
    paymentMethodId: reservation.paymentMethodId,
    brand: reservation.paymentMethodBrand,
    last4: reservation.paymentMethodLast4,
  };
  await db
    .update(reservations)
    .set({
      paymentMethodId: setup.paymentMethodId,
      paymentMethodFingerprint: setup.fingerprint,
      paymentMethodBrand: setup.brand,
      paymentMethodLast4: setup.last4,
      updatedAt: now,
    })
    .where(eq(reservations.id, reservation.id));

  // §33.12.4's rule: the "before" is read from the row, never supplied.
  await audit({
    action: 'close.card_updated',
    targetType: 'reservation',
    targetId: reservation.id,
    internalReason:
      'the Backer saved a new card through the B.5 update-card path; the original SetupIntent stays ' +
      'historical (§23.5) and the reservation, reward, survey, and consent context are untouched (§21)',
    priorValue: priorCard,
    newValue: { paymentMethodId: setup.paymentMethodId, brand: setup.brand, last4: setup.last4 },
    actorId: input.actor,
  });

  /* ── One retry, under the next stable attempt key (§33.7.7) ─────────────── */

  const [latest] = await db
    .select()
    .from(reservationCaptureAttempts)
    .where(eq(reservationCaptureAttempts.reservationId, reservation.id))
    .orderBy(desc(reservationCaptureAttempts.attemptNumber))
    .limit(1);

  // A crash between an earlier claim and its record left an attempt in flight:
  // re-drive the SAME key so Stripe answers with the same intent, never a new
  // charge (§33.7.7). Otherwise mint the next attempt.
  const reuseInFlight = latest && (latest.outcome === null || latest.outcome === 'provider_error');
  const attemptNumber = reuseInFlight ? latest.attemptNumber : (latest?.attemptNumber ?? 1) + 1;
  const amountCents = reservation.totalAuthorizedCents!;

  await db
    .insert(reservationCaptureAttempts)
    .values({
      reservationId: reservation.id,
      campaignId: reservation.campaignId,
      attemptNumber,
      idempotencyKey: captureAttemptKey(reservation.id, attemptNumber),
      amountCents,
      requestedAt: now,
    })
    .onConflictDoNothing();
  const [attempt] = await db
    .select()
    .from(reservationCaptureAttempts)
    .where(
      and(
        eq(reservationCaptureAttempts.reservationId, reservation.id),
        eq(reservationCaptureAttempts.attemptNumber, attemptNumber),
      ),
    )
    .limit(1);
  if (!attempt) return { status: 'provider_error' };

  return driveClaimedAttempt(deps, {
    reservation: { ...reservation, paymentMethodId: setup.paymentMethodId },
    attempt: { id: attempt.id, idempotencyKey: attempt.idempotencyKey, amountCents },
    connectedAccountId: account.stripeAccountId,
    actor: input.actor,
    now,
  });
}

/**
 * Creates (or re-creates under the same key) the off-session PaymentIntent for
 * one claimed attempt and applies the outcome. Shared by the update-card path
 * and the window-end sweep's in-flight resolution.
 */
async function driveClaimedAttempt(
  deps: RetryDeps,
  input: {
    reservation: Reservation;
    attempt: { id: string; idempotencyKey: string; amountCents: bigint };
    connectedAccountId: string;
    actor: string;
    now: Date;
  },
): Promise<UpdateCardOutcome> {
  const { db, audit } = deps;
  const { reservation, attempt, now } = input;
  const notify = notificationDeps(deps);

  let result;
  try {
    result = await deps.gateway.createOffSessionPaymentIntent({
      connectedAccountId: input.connectedAccountId,
      customerId: reservation.stripeCustomerId!,
      paymentMethodId: reservation.paymentMethodId!,
      amountCents: attempt.amountCents,
      idempotencyKey: attempt.idempotencyKey,
      statementDescriptorSuffix: reservation.statementDescriptor ?? undefined,
      metadata: {
        proovd_reservation_id: reservation.id,
        proovd_campaign_id: reservation.campaignId,
      },
    });
  } catch (error) {
    await db
      .update(reservationCaptureAttempts)
      .set({
        outcome: 'provider_error',
        failureMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(reservationCaptureAttempts.id, attempt.id));
    await audit({
      action: 'close.retry_attempt_errored',
      targetType: 'reservation',
      targetId: reservation.id,
      internalReason: `the retry PaymentIntent call errored at the transport: ${
        error instanceof Error ? error.message : String(error)
      }. The attempt stays claimed under ${attempt.idempotencyKey}; a repeat retries the SAME intent.`,
      actorId: input.actor,
    });
    return { status: 'provider_error' };
  }

  await recordProviderObject(db, {
    mode: deps.gateway.mode,
    objectType: 'payment_intent',
    providerObjectId: result.id,
    accountContext: 'connected',
    stripeAccountId: input.connectedAccountId,
    campaignId: reservation.campaignId,
    reservationId: reservation.id,
    amountCents: attempt.amountCents,
    status:
      result.status === 'succeeded'
        ? 'succeeded'
        : result.status === 'requires_action'
          ? 'requires_action'
          : 'requires_payment_method',
    idempotencyKey: attempt.idempotencyKey,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
    providerCreatedAt: now,
  });
  if (result.chargeId) {
    await recordProviderObject(db, {
      mode: deps.gateway.mode,
      objectType: 'charge',
      providerObjectId: result.chargeId,
      accountContext: 'connected',
      stripeAccountId: input.connectedAccountId,
      campaignId: reservation.campaignId,
      reservationId: reservation.id,
      amountCents: attempt.amountCents,
      amountFeeCents: result.stripeFeeCents,
      status: result.status === 'succeeded' ? 'succeeded' : 'failed',
      providerCreatedAt: now,
    });
  }

  if (result.status === 'succeeded') {
    await db
      .update(reservationCaptureAttempts)
      .set({ paymentIntentId: result.id, resolvedAt: now })
      .where(eq(reservationCaptureAttempts.id, attempt.id));
    // The one applier (§33.7.7): capture_failed_retrying → captured, the
    // ledger written once — the stale failure is cleared by the state itself
    // (§33.7.9), and a racing webhook for the same intent no-ops.
    const applied = await applyCaptureSuccess(
      { db, audit },
      {
        reservationId: reservation.id,
        paymentIntentId: result.id,
        chargeId: result.chargeId,
        stripeFeeCents: result.stripeFeeCents,
        actor: input.actor,
        now,
      },
    );
    if (applied.applied) {
      if (notify) await notifyRetrySuccess(notify, applied.reservation);
      return { status: 'captured', reservation: applied.reservation };
    }
    return { status: 'already_captured' };
  }

  const kind = classifyCaptureFailure({
    status: result.status === 'requires_action' ? 'requires_action' : null,
    declineCode: result.declineCode,
  });
  await db
    .update(reservationCaptureAttempts)
    .set({
      paymentIntentId: result.id,
      outcome: kind,
      failureCode: result.declineCode ?? result.failureCode,
      failureMessage: result.failureMessage,
      resolvedAt: now,
    })
    .where(eq(reservationCaptureAttempts.id, attempt.id));

  // The reservation is ALREADY capture_failed_retrying and the window is
  // already anchored — a repeat failure moves no state and re-opens nothing
  // (§21 step 8: one window). Only the current-failure facts are refreshed.
  await db
    .update(reservations)
    .set({ captureFailedAt: now, captureReason: kind, updatedAt: now })
    .where(and(eq(reservations.id, reservation.id), eq(reservations.status, 'capture_failed_retrying')));

  await audit({
    action: 'close.retry_attempt_failed',
    targetType: 'reservation',
    targetId: reservation.id,
    internalReason:
      `retry attempt under ${attempt.idempotencyKey} did not complete (${kind}` +
      `${result.declineCode ? `; provider code ${result.declineCode}` : ''}); ` +
      'the reservation stays in the one recovery window',
    actorId: input.actor,
  });

  if (kind === 'requires_action') {
    // §21: routed to a customer-action recovery surface — the webhook applies
    // the completed capture through the same applier once the Backer acts.
    return { status: 'requires_action', paymentIntentId: result.id, clientSecret: result.clientSecret };
  }
  return { status: 'failed_again', kind };
}

/* ── The window's end (§21, §33.7.10) ──────────────────────────────────────── */

export interface RetryWindowEndSummary {
  campaignId: string;
  status: 'ended' | 'incomplete' | 'not_due' | 'not_found';
  recovered: number;
  dropped: number;
  /** In-flight attempts that could not be resolved this run. */
  unresolved: number;
}

/**
 * Ends one campaign's retry window once `retry_deadline_at` has passed:
 * resolves any in-flight attempt under its own key, drops every reservation
 * still failing, and moves the campaign to `closed_reconciling` — after which
 * reconciliation begins, and not before (§21). Safe to run twice: every drop
 * is a conditional UPDATE, every message dedups, and a second run finds
 * nothing left to move.
 */
export async function endRetryWindow(
  deps: RetryDeps,
  input: { campaignId: string; actor: string; now?: Date },
): Promise<RetryWindowEndSummary> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();
  const { campaignId } = input;
  const notify = notificationDeps(deps);

  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { campaignId, status: 'not_found', recovered: 0, dropped: 0, unresolved: 0 };
  if (campaign.status !== 'capture_retry_window') {
    return { campaignId, status: 'not_due', recovered: 0, dropped: 0, unresolved: 0 };
  }

  const [batch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);
  if (!batch?.retryDeadlineAt || batch.retryDeadlineAt.getTime() > now.getTime()) {
    return { campaignId, status: 'not_due', recovered: 0, dropped: 0, unresolved: 0 };
  }

  const founderUserId = await findCampaignFounderUserId(db, campaignId);
  const account = founderUserId
    ? await findAccountForOwner(db, {
        ownerUserId: founderUserId,
        role: 'founder_seller',
        mode: deps.gateway.mode,
      })
    : null;

  const retrying = await db
    .select()
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'capture_failed_retrying')),
    )
    .orderBy(reservations.createdAt, reservations.id);

  let unresolved = 0;
  let droppedNow = 0;

  for (const reservation of retrying) {
    // An attempt claimed but never resolved (a crash between claim and record)
    // is resolved FIRST, under its own key — dropping it blind could drop a
    // charge that actually succeeded at the provider (§33.7.7).
    const [latest] = await db
      .select()
      .from(reservationCaptureAttempts)
      .where(eq(reservationCaptureAttempts.reservationId, reservation.id))
      .orderBy(desc(reservationCaptureAttempts.attemptNumber))
      .limit(1);
    if (latest && (latest.outcome === null || latest.outcome === 'provider_error') && account) {
      const outcome = await driveClaimedAttempt(deps, {
        reservation,
        attempt: {
          id: latest.id,
          idempotencyKey: latest.idempotencyKey,
          amountCents: latest.amountCents,
        },
        connectedAccountId: account.stripeAccountId,
        actor: input.actor,
        now,
      });
      if (outcome.status === 'provider_error') {
        // Still unknown at the provider: the reservation stays locked and the
        // window stays open-but-overdue, visibly, for the next sweep tick
        // (§33.7.12's honesty rule — never guess a charge's fate).
        unresolved += 1;
        continue;
      }
      if (outcome.status === 'captured' || outcome.status === 'already_captured') continue;
      // A resolved failure falls through to the drop below.
    }

    // §33.7.2's comparison, at the drop: the saved card survives when any
    // other transaction may still need it — active elsewhere, or still inside
    // this or another campaign's capture path.
    let safeToDetach = false;
    if (reservation.paymentMethodId) {
      const [other] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.backerIdentityId, reservation.backerIdentityId),
            eq(reservations.paymentMethodId, reservation.paymentMethodId),
            inArray(reservations.status, [
              'reserved_active',
              'pending_capture',
              'capture_failed_retrying',
            ]),
            sql`${reservations.id} <> ${reservation.id}`,
          ),
        )
        .limit(1);
      safeToDetach = !other;
    }

    const moved = await db.transaction(async (tx) => {
      const rows = await tx
        .update(reservations)
        .set({ status: 'capture_failed_dropped', updatedAt: now })
        .where(
          and(eq(reservations.id, reservation.id), eq(reservations.status, 'capture_failed_retrying')),
        )
        .returning();
      if (rows.length !== 1) return null;

      await tx.insert(reservationStatusHistory).values({
        reservationId: reservation.id,
        fromStatus: 'capture_failed_retrying',
        toStatus: 'capture_failed_dropped',
        actor: input.actor,
      });
      await tx
        .update(founderOperationalShares)
        .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: now, deliveryStatus: 'do_not_fulfill' })
        .where(eq(founderOperationalShares.reservationId, reservation.id));
      return rows[0]!;
    });
    if (!moved) continue; // a concurrent run already dropped it.
    droppedNow += 1;

    // B.5: "If you do nothing, this pre-order will be canceled after the retry
    // window." The detach is the cancellation rule's (§33.7.1), decided above.
    if (safeToDetach && reservation.paymentMethodId && account) {
      try {
        await deps.gateway.detachPaymentMethod({
          paymentMethodId: reservation.paymentMethodId,
          connectedAccountId: account.stripeAccountId,
        });
      } catch (error) {
        await audit({
          action: 'close.detach_failed',
          targetType: 'reservation',
          targetId: reservation.id,
          internalReason: `PaymentMethod detach failed after the retry-window drop: ${
            error instanceof Error ? error.message : String(error)
          }. The reservation is dropped; the method can be detached on retry.`,
        });
      }
    }

    // §33.7.10: dropped is zero everywhere — stated in the audit as a fact
    // about what was NOT written, because the ledger write only exists at
    // capture and this row never reached it.
    await audit({
      action: 'close.retry_window_dropped',
      targetType: 'reservation',
      targetId: reservation.id,
      internalReason:
        'the retry window ended with no completed charge; the reservation dropped at US$0 — no revenue, ' +
        'no Creator commission, no Founder share was recorded (§21, §33.7.10)',
      actorId: input.actor,
    });

    if (notify) await notifyRetryWindowDropped(notify, moved);
  }

  if (unresolved > 0) {
    await audit({
      action: 'close.retry_window_incomplete',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason:
        `${unresolved} in-flight capture attempt(s) could not be resolved at the retry window's end; ` +
        'the campaign stays in capture_retry_window, visibly, and the sweep retries under the same keys',
      actorId: input.actor,
    });
    return { campaignId, status: 'incomplete', recovered: 0, dropped: droppedNow, unresolved };
  }

  /* ── Every failure resolved: the window is over (§21) ───────────────────── */

  // Recovered = entered the window and now captured; the history rows carry it.
  const [counts] = await db
    .select({
      recovered: sql<number>`count(distinct ${reservationStatusHistory.reservationId}) filter (where ${reservationStatusHistory.fromStatus} = 'capture_failed_retrying' and ${reservationStatusHistory.toStatus} = 'captured')::int`,
    })
    .from(reservationStatusHistory)
    .innerJoin(reservations, eq(reservations.id, reservationStatusHistory.reservationId))
    .where(eq(reservations.campaignId, campaignId));
  const [statusCounts] = await db
    .select({
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      dropped: sql<number>`count(*) filter (where ${reservations.status} = 'capture_failed_dropped')::int`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId));

  await db.transaction(async (tx) => {
    const moved = await tx
      .update(campaigns)
      .set({ status: 'closed_reconciling', updatedAt: now })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'capture_retry_window')))
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId,
        fromStatus: 'capture_retry_window',
        toStatus: 'closed_reconciling',
        actor: input.actor,
      });
    }
  });

  await audit({
    action: 'close.retry_window_ended',
    targetType: 'campaign',
    targetId: campaignId,
    internalReason:
      `the one 48-hour retry window ended: ${counts?.recovered ?? 0} recovered (counted as captured), ` +
      `${droppedNow} dropped this run. Reconciliation begins now and not before (§21).`,
    newValue: {
      recovered: Number(counts?.recovered ?? 0),
      dropped: Number(statusCounts?.dropped ?? 0),
      captured: Number(statusCounts?.captured ?? 0),
    },
    actorId: input.actor,
  });

  if (notify) {
    await notifyRetryReconciliationComplete(notify, {
      campaignId,
      recovered: Number(counts?.recovered ?? 0),
      dropped: Number(statusCounts?.dropped ?? 0),
      captured: Number(statusCounts?.captured ?? 0),
    });
    // The Creator's factual close notice — outcomes are final now (§27.4).
    await notifyCreatorsCampaignClosed(notify, { campaignId });
  }

  return {
    campaignId,
    status: 'ended',
    recovered: Number(counts?.recovered ?? 0),
    dropped: droppedNow,
    unresolved: 0,
  };
}

/**
 * Ends every retry window whose stored deadline has passed. Runs on the same
 * scheduler tick as the close sweep; independently idempotent per campaign.
 */
export async function sweepRetryWindowEnds(
  deps: RetryDeps,
  now: Date = new Date(),
): Promise<RetryWindowEndSummary[]> {
  const due = await deps.db
    .select({ campaignId: campaigns.id })
    .from(campaigns)
    .innerJoin(campaignCloseBatches, eq(campaignCloseBatches.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.status, 'capture_retry_window'),
        lte(campaignCloseBatches.retryDeadlineAt, now),
      ),
    );

  const results: RetryWindowEndSummary[] = [];
  for (const row of due) {
    results.push(
      await endRetryWindow(deps, {
        campaignId: row.campaignId,
        actor: 'system:retry-window',
        now,
      }),
    );
  }
  return results;
}
