/**
 * Backer cancellation — Spec §20, §33.7.1, §33.7.2.
 *
 * One clear action, no retention obstacle, no cost. Atomically it sets the
 * reservation `reserved_canceled`, removes it from the cap/threshold (releases
 * its held capacity), and flips the Founder's operational record to
 * `do_not_fulfill`. Two things it deliberately does NOT do:
 *
 *  - It never touches the successful SetupIntent's provider object (§23.5: "a
 *    successful SetupIntent remains historical even when the internal
 *    reservation is later canceled/no-charge"). The saved card is history, not a
 *    canceled thing.
 *  - It detaches the PaymentMethod only where reference-safe. If the same method
 *    still supports another active Product transaction for this Backer, it is
 *    left attached (§33.7.2) — canceling one pre-order must not break another.
 *
 * "Prevent any PaymentIntent for it" is structural: `reserved_canceled` is a
 * terminal state with no edge to `pending_capture`, and the terminal-state
 * trigger (migration 0001) makes the reversal impossible for every writer. The
 * close batch (Phase 18) only captures `reserved_active`.
 *
 * A duplicate cancellation is harmless: the conditional UPDATE matches nothing
 * the second time, and the notification dedups on the reservation.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations, reservationStatusHistory, type Reservation } from '../db/schema/domain.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { releaseCapacity } from './capacity.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import { sendCancellationConfirmation } from '../notifications/backer.js';
import { formatUtcInstant } from './consent.js';

export interface CancelReservationDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  fromAddress?: string | undefined;
  connectedAccountId?: string | undefined;
}

export type CancelOutcome =
  | { status: 'canceled'; reservation: Reservation; detached: boolean }
  /** Already canceled — a duplicate submission, treated as success (§33.7.3). */
  | { status: 'already_canceled' }
  /** Not a state a Backer may cancel (captured, killed, etc.). */
  | { status: 'not_cancelable'; current: string }
  | { status: 'not_found' };

/**
 * Cancels one reservation. `backerIdentityId` scopes it to the magic-link
 * holder — a Backer cancels only their own pre-order, and someone else's answers
 * the same `not_found` a non-existent one gets.
 */
export async function cancelReservation(
  deps: CancelReservationDeps,
  input: {
    reservationId: string;
    backerIdentityId: string;
    actor: string;
    /** For the B.4 email; the route reads it from the campaign build. */
    campaignTitle?: string | undefined;
  },
): Promise<CancelOutcome> {
  const { db } = deps;

  const [existing] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.id, input.reservationId),
        eq(reservations.backerIdentityId, input.backerIdentityId),
      ),
    )
    .limit(1);

  if (!existing) return { status: 'not_found' };
  if (existing.status === 'reserved_canceled') return { status: 'already_canceled' };
  if (existing.status !== 'reserved_active') {
    return { status: 'not_cancelable', current: existing.status };
  }

  const now = new Date();

  // Reference-safe detach decision (§33.7.2): is this PaymentMethod still used by
  // ANOTHER active reservation for this Backer? Decided before the cancel so the
  // just-canceled row is still `reserved_active`; we exclude it explicitly.
  let safeToDetach = false;
  if (existing.paymentMethodId) {
    const [other] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.backerIdentityId, input.backerIdentityId),
          eq(reservations.paymentMethodId, existing.paymentMethodId),
          eq(reservations.status, 'reserved_active'),
          ne(reservations.id, existing.id),
        ),
      )
      .limit(1);
    safeToDetach = !other;
  }

  const canceled = await db.transaction(async (tx) => {
    const moved = await tx
      .update(reservations)
      .set({ status: 'reserved_canceled', canceledAt: now, updatedAt: now })
      .where(and(eq(reservations.id, input.reservationId), eq(reservations.status, 'reserved_active')))
      .returning();

    if (moved.length !== 1) return null; // a concurrent cancel won the race.

    await tx.insert(reservationStatusHistory).values({
      reservationId: input.reservationId,
      fromStatus: 'reserved_active',
      toStatus: 'reserved_canceled',
      actor: input.actor,
    });

    // Remove it from the cap/threshold (§20). Its pre-tax subtotal returns.
    await releaseCapacity(tx, existing.campaignId, existing.rewardSubtotalCents);

    // §19: the Founder record becomes `do not fulfill`. Info already shared is
    // not retracted (the trigger permits only this state flip).
    await tx
      .update(founderOperationalShares)
      .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: now, deliveryStatus: 'do_not_fulfill' })
      .where(eq(founderOperationalShares.reservationId, input.reservationId));

    return moved[0]!;
  });

  if (!canceled) return { status: 'already_canceled' };

  // Detach the saved card only where reference-safe, and only after the cancel
  // committed. A provider refusal is recorded, never rolled back onto the
  // cancellation — the reservation is canceled either way.
  let detached = false;
  if (safeToDetach && existing.paymentMethodId && deps.connectedAccountId) {
    try {
      await deps.gateway.detachPaymentMethod({
        paymentMethodId: existing.paymentMethodId,
        connectedAccountId: deps.connectedAccountId,
      });
      detached = true;
    } catch (error) {
      await deps.audit({
        action: 'reservation.detach_failed',
        targetType: 'reservation',
        targetId: input.reservationId,
        internalReason: `PaymentMethod detach failed after cancellation: ${
          error instanceof Error ? error.message : String(error)
        }. The reservation is canceled; the method can be detached on retry.`,
      });
    }
  }

  await deps.audit({
    action: 'reservation.canceled',
    targetType: 'reservation',
    targetId: input.reservationId,
    internalReason:
      `pre-order canceled by ${input.actor}; capacity released; Founder record set do_not_fulfill; ` +
      (existing.paymentMethodId
        ? safeToDetach
          ? `PaymentMethod ${detached ? 'detached' : 'detach pending'}`
          : 'PaymentMethod left attached (still supports another active transaction)'
        : 'no PaymentMethod on file') +
      `. SetupIntent ${existing.setupIntentId ?? 'n/a'} preserved as history.`,
    actorId: input.actor,
    newValue: { referenceSafeDetach: safeToDetach, detached },
  });

  // §27.5 / Appendix B.4: `Canceled — you were not charged`. Keyed on the
  // reservation, so a duplicate submission sends no second email.
  if (deps.notifier && deps.fromAddress && existing.backerEmail) {
    await sendCancellationConfirmation(
      { notifier: deps.notifier, from: deps.fromAddress },
      {
        to: existing.backerEmail,
        reservationId: input.reservationId,
        campaignTitle: input.campaignTitle ?? '',
        rewardTitle: existing.rewardTitle ?? '',
        canceledAtUtc: formatUtcInstant(now),
      },
    );
  }

  return { status: 'canceled', reservation: canceled, detached };
}

/** Whether a reservation's PaymentMethod is still referenced by an active one. */
export async function paymentMethodStillActive(
  db: Pick<Database, 'select'>,
  input: { backerIdentityId: string; paymentMethodId: string; excludeReservationId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.backerIdentityId, input.backerIdentityId),
        eq(reservations.paymentMethodId, input.paymentMethodId),
        eq(reservations.status, 'reserved_active'),
        ne(reservations.id, input.excludeReservationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
