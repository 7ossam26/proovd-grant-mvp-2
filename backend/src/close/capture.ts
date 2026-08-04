/**
 * Applying one capture outcome — Spec §21, §24.3, §24.4, §33.7.7 (Phase 18a).
 *
 * ── One applier, two callers ────────────────────────────────────────────────
 * The close batch applies the synchronous PaymentIntent result; the
 * `payment_intent.*` webhooks apply the asynchronous one. Both call this
 * module, so a duplicate delivery and a re-run batch are the same no-op: the
 * conditional status UPDATE matches nothing the second time, the
 * `reservation_captured:<id>` idempotency key refuses a second ledger write,
 * and the caller sends a message only when the transition actually happened.
 *
 * ── The ledger is written at capture, both levels, in the same transaction ──
 * §21: subtotal, tax, total captured, Proovd fee, provisional Creator
 * liability, Founder gross share, Stripe fee are separate ledger fields — the
 * Phase 03 columns on the reservation, aggregated onto the campaign in the
 * same transaction (16a's money controls read those aggregates and mark them
 * populated once the close lifecycle is reached).
 *
 * ── §24.4: provision the maximum, never keep it ─────────────────────────────
 * For an attributed charge the provisional slot holds the MAXIMUM locked
 * percentage that could be owed — the locked total plus the conditional
 * Creator-specific bonus, bounded by the bonus's own combined cap and the §6
 * ceiling. It is a liability, never Proovd revenue; Phase 19 computes the
 * earned percentage and returns every unearned difference to the Founder once.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  reservations,
  reservationStatusHistory,
  type Reservation,
} from '../db/schema/domain.js';
import { campaignCloseBatches, reservationCaptureAttempts } from '../db/schema/close.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import {
  associationCompensationAgreements,
  creatorBonuses,
} from '../db/schema/decisions.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import type { AuditWriter } from '../auth/audit.js';
import { readSettingValue } from '../settings/service.js';
import {
  captureLedger,
  provisionalPercent,
  type CaptureFailureKind,
} from './logic.js';

export function reservationCapturedKey(reservationId: string): string {
  return `reservation_captured:${reservationId}`;
}

export interface CaptureOutcomeDeps {
  db: Database;
  audit: AuditWriter;
}

/**
 * §24.4's provisional percentage for one reservation's attribution, read from
 * the locked agreement and the recorded bonus. 0 for organic/house/unattributed
 * — and 0 when no locked agreement exists, because a percentage nobody agreed
 * to is not a liability, it is an invention (§1 rule 6).
 */
export async function provisionalPercentFor(
  db: Database,
  attributionAssociationId: string | null,
): Promise<number> {
  if (!attributionAssociationId) return 0;

  const [agreement] = await db
    .select({ totalPercent: associationCompensationAgreements.totalPercent })
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, attributionAssociationId))
    .limit(1);
  if (!agreement) return 0;

  const bonuses = await db
    .select({
      additionalPercent: creatorBonuses.additionalPercent,
      maxCombinedPercent: creatorBonuses.maxCombinedPercent,
    })
    .from(creatorBonuses)
    .where(eq(creatorBonuses.associationId, attributionAssociationId));

  const ceiling = await readSettingValue(db, 'affiliate_percentage_ceiling');

  return provisionalPercent({
    lockedTotalPercent: agreement.totalPercent,
    bonuses,
    ceilingPercent: typeof ceiling === 'number' ? ceiling : 50,
  });
}

export type ApplySuccessResult =
  | {
      applied: true;
      reservation: Reservation;
      /** The state the capture applied FROM — `capture_failed_retrying` means
          this was a §21 recovery, and §27.5 gives that its own message
          ("Retry success"), never a second receipt. */
      from: 'pending_capture' | 'capture_failed_retrying';
    }
  | { applied: false; reason: 'already_captured' | 'not_capturable'; current: string }
  | { applied: false; reason: 'not_found' };

/**
 * Marks one reservation captured and writes the §24.3 ledger, exactly once.
 *
 * Idempotent three ways (§33.7.7): the row is locked FOR UPDATE, the status
 * UPDATE is conditional on the current state, and the ledger write claims
 * `reservation_captured:<id>` in the same transaction — a duplicate webhook, a
 * re-run batch, and a concurrent worker all find one of the three and change
 * nothing.
 */
export async function applyCaptureSuccess(
  deps: CaptureOutcomeDeps,
  input: {
    reservationId: string;
    paymentIntentId: string;
    chargeId: string | null;
    stripeFeeCents: bigint | null;
    actor: string;
    now?: Date;
  },
): Promise<ApplySuccessResult> {
  const now = input.now ?? new Date();

  // The §24.4 percentage is read before the transaction — it depends on rows
  // (agreement, bonus) that are immutable once locked (§14.2), so there is no
  // race, and holding the reservation lock across settings reads would be a
  // longer lock for no more safety.
  const [existing] = await deps.db
    .select()
    .from(reservations)
    .where(eq(reservations.id, input.reservationId))
    .limit(1);
  if (!existing) return { applied: false, reason: 'not_found' };

  const provisionalPct = await provisionalPercentFor(deps.db, existing.attributionAssociationId);
  const feeSetting = await readSettingValue(deps.db, 'platform_fee_percent');
  const platformFeePercent = typeof feeSetting === 'number' ? feeSetting : 5;

  const result = await deps.db.transaction(async (tx): Promise<ApplySuccessResult> => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .for('update')
      .limit(1);
    if (!row) return { applied: false, reason: 'not_found' };
    if (row.status === 'captured') {
      return { applied: false, reason: 'already_captured', current: row.status };
    }
    if (row.status !== 'pending_capture' && row.status !== 'capture_failed_retrying') {
      // A succeeded delivery for a reservation that is canceled, dropped, or
      // killed — recorded for Admin, never guessed into a transition the
      // machine forbids (§23.5).
      return { applied: false, reason: 'not_capturable', current: row.status };
    }
    const from = row.status;

    // The exactly-once pivot for the ledger write (§33.7.7).
    try {
      await tx.insert(idempotencyKeys).values({
        key: reservationCapturedKey(row.id),
        purpose: 'reservation_capture',
        completedAt: now,
        result: { paymentIntentId: input.paymentIntentId },
      });
    } catch {
      return { applied: false, reason: 'already_captured', current: row.status };
    }

    const ledger = captureLedger({
      rewardSubtotalCents: row.rewardSubtotalCents,
      platformFeePercent,
      provisionalAffiliatePercent: provisionalPct,
    });
    const totalCaptured = row.totalAuthorizedCents ?? row.rewardSubtotalCents + row.salesTaxCents;
    const stripeFee = input.stripeFeeCents ?? 0n;

    const moved = await tx
      .update(reservations)
      .set({
        status: 'captured',
        capturedAt: now,
        paymentIntentId: input.paymentIntentId,
        chargeId: input.chargeId,
        totalCapturedCents: totalCaptured,
        proovdFeeCents: ledger.proovdFeeCents,
        affiliateProvisionalCents: ledger.affiliateProvisionalCents,
        founderGrossShareCents: ledger.founderGrossShareCents,
        stripeFeeCents: stripeFee,
        updatedAt: now,
      })
      .where(
        and(
          eq(reservations.id, row.id),
          inArray(reservations.status, ['pending_capture', 'capture_failed_retrying']),
        ),
      )
      .returning();
    if (moved.length !== 1) {
      throw new Error('the reservation left its capturable state during the ledger write');
    }

    await tx.insert(reservationStatusHistory).values({
      reservationId: row.id,
      fromStatus: row.status,
      toStatus: 'captured',
      actor: input.actor,
    });

    // The campaign aggregates, same transaction — "captured money, not saved
    // reservations, drives final revenue/commission" (§21), and 16a's money
    // controls read exactly these columns.
    await tx
      .update(campaigns)
      .set({
        rewardSubtotalCapturedCents: sql`${campaigns.rewardSubtotalCapturedCents} + ${row.rewardSubtotalCents.toString()}`,
        salesTaxCapturedCents: sql`${campaigns.salesTaxCapturedCents} + ${row.salesTaxCents.toString()}`,
        totalCapturedCents: sql`${campaigns.totalCapturedCents} + ${totalCaptured.toString()}`,
        proovdFeeCents: sql`${campaigns.proovdFeeCents} + ${ledger.proovdFeeCents.toString()}`,
        affiliateProvisionalCents: sql`${campaigns.affiliateProvisionalCents} + ${ledger.affiliateProvisionalCents.toString()}`,
        founderGrossShareCents: sql`${campaigns.founderGrossShareCents} + ${ledger.founderGrossShareCents.toString()}`,
        stripeFeeCents: sql`${campaigns.stripeFeeCents} + ${stripeFee.toString()}`,
        updatedAt: now,
      })
      .where(eq(campaigns.id, row.campaignId));

    // Resolve the attempt that produced this PaymentIntent, when one exists —
    // the webhook path may arrive before or after the batch recorded it.
    await tx
      .update(reservationCaptureAttempts)
      .set({ outcome: 'succeeded', chargeId: input.chargeId, resolvedAt: now })
      .where(
        and(
          eq(reservationCaptureAttempts.reservationId, row.id),
          eq(reservationCaptureAttempts.paymentIntentId, input.paymentIntentId),
        ),
      );

    return { applied: true, reservation: moved[0]!, from };
  });

  if (result.applied) {
    await deps.audit({
      action: 'close.reservation_captured',
      targetType: 'reservation',
      targetId: input.reservationId,
      internalReason:
        `off-session PaymentIntent ${input.paymentIntentId} captured the exact authorized total; ` +
        `provisional Creator percentage ${provisionalPct}%, platform fee ${platformFeePercent}% (§24.3, §24.4)`,
      newValue: { paymentIntentId: input.paymentIntentId, chargeId: input.chargeId },
      actorId: input.actor,
    });
  }

  return result;
}

export type ApplyFailureResult =
  | { applied: true; reservation: Reservation; retryDeadlineAt: Date }
  | { applied: false; reason: 'already_failed' | 'not_capturable' | 'not_found'; current?: string };

/**
 * Marks one reservation `capture_failed_retrying` and anchors the ONE retry
 * window at the first close-batch failure (§21 step 8). The window write is a
 * conditional UPDATE (`WHERE first_failure_at IS NULL`), so a hundred failures
 * anchor one window, and the batch trigger refuses to move it afterwards.
 */
export async function applyCaptureFailure(
  deps: CaptureOutcomeDeps,
  input: {
    reservationId: string;
    kind: CaptureFailureKind;
    paymentIntentId: string | null;
    failureCode: string | null;
    actor: string;
    now?: Date;
  },
): Promise<ApplyFailureResult> {
  const now = input.now ?? new Date();

  const result = await deps.db.transaction(async (tx): Promise<ApplyFailureResult> => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .for('update')
      .limit(1);
    if (!row) return { applied: false, reason: 'not_found' };
    if (row.status === 'capture_failed_retrying') {
      return { applied: false, reason: 'already_failed', current: row.status };
    }
    if (row.status !== 'pending_capture') {
      return { applied: false, reason: 'not_capturable', current: row.status };
    }

    const moved = await tx
      .update(reservations)
      .set({
        status: 'capture_failed_retrying',
        captureFailedAt: now,
        captureReason: input.kind,
        ...(input.paymentIntentId ? { paymentIntentId: input.paymentIntentId } : {}),
        updatedAt: now,
      })
      .where(and(eq(reservations.id, row.id), eq(reservations.status, 'pending_capture')))
      .returning();
    if (moved.length !== 1) {
      return { applied: false, reason: 'already_failed', current: row.status };
    }

    await tx.insert(reservationStatusHistory).values({
      reservationId: row.id,
      fromStatus: 'pending_capture',
      toStatus: 'capture_failed_retrying',
      actor: input.actor,
    });

    // §21 step 8: ONE window, anchored at the FIRST failure. The conditional
    // UPDATE is the anchor; the CHECK pins the arithmetic; the trigger makes it
    // immutable. Every later failure reads the window the first one opened.
    // One SQL parameter feeds both columns so the CHECK's exact equality holds.
    const anchor = now.toISOString();
    await tx
      .update(campaignCloseBatches)
      .set({
        firstFailureAt: sql`${anchor}::timestamptz`,
        retryDeadlineAt: sql`${anchor}::timestamptz + make_interval(hours => ${campaignCloseBatches.retryWindowHours})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(campaignCloseBatches.campaignId, row.campaignId),
          sql`${campaignCloseBatches.firstFailureAt} IS NULL`,
        ),
      );

    const [batch] = await tx
      .select({ retryDeadlineAt: campaignCloseBatches.retryDeadlineAt })
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.campaignId, row.campaignId))
      .limit(1);
    if (!batch?.retryDeadlineAt) {
      throw new Error('a capture failure exists with no close batch to anchor its window');
    }

    return { applied: true, reservation: moved[0]!, retryDeadlineAt: batch.retryDeadlineAt };
  });

  if (result.applied) {
    await deps.audit({
      action: 'close.capture_failed',
      targetType: 'reservation',
      targetId: input.reservationId,
      // The raw provider code is internal detail (§25.6, §33.9.11) — it lives
      // here and on the attempt row, never in the customer message.
      internalReason:
        `off-session capture failed (${input.kind}${input.failureCode ? `; provider code ${input.failureCode}` : ''}); ` +
        `the reservation entered the 48-hour recovery window ending ${result.retryDeadlineAt.toISOString()}`,
      newValue: { kind: input.kind, paymentIntentId: input.paymentIntentId },
      actorId: input.actor,
    });
  }

  return result;
}

/**
 * §21 step 6's no-PaymentIntent drop: the stored tax calculation is unusable,
 * so the reservation drops with the reason recorded and the Founder's
 * operational record flips to do-not-fulfill — no money was collected, so
 * nothing may ship (§1.4). Never a substituted total, never a retry.
 */
export async function applyCaptureDrop(
  deps: CaptureOutcomeDeps,
  input: { reservationId: string; reason: string; detail: string; actor: string; now?: Date },
): Promise<{ applied: boolean; reservation?: Reservation }> {
  const now = input.now ?? new Date();

  const result = await deps.db.transaction(async (tx) => {
    const moved = await tx
      .update(reservations)
      .set({
        status: 'capture_failed_dropped',
        captureFailedAt: now,
        captureReason: input.reason,
        taxCloseUsable: false,
        updatedAt: now,
      })
      .where(
        and(eq(reservations.id, input.reservationId), eq(reservations.status, 'pending_capture')),
      )
      .returning();
    if (moved.length !== 1) return null;

    await tx.insert(reservationStatusHistory).values({
      reservationId: input.reservationId,
      fromStatus: 'pending_capture',
      toStatus: 'capture_failed_dropped',
      actor: input.actor,
    });

    await tx
      .update(founderOperationalShares)
      .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: now, deliveryStatus: 'do_not_fulfill' })
      .where(eq(founderOperationalShares.reservationId, input.reservationId));

    return moved[0]!;
  });

  if (result) {
    await deps.audit({
      action: 'close.capture_dropped',
      targetType: 'reservation',
      targetId: input.reservationId,
      internalReason: `${input.reason}: ${input.detail}. No PaymentIntent was created and no total was substituted (§21).`,
      newValue: { reason: input.reason },
      actorId: input.actor,
    });
    return { applied: true, reservation: result };
  }
  return { applied: false };
}
