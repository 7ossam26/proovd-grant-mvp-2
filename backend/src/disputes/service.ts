/**
 * Payment disputes — Spec §24.11, §24.8, §33.9.6/§33.9.7 (Phase 20b).
 *
 * A dispute arrives from the provider; Proovd controls exactly two things
 * about it, and this module owns both:
 *
 *   1. The 24-hour Admin task (§24.11) — the dispute row is created with
 *      `task_due_at` CHECK-pinned to `opened_at + 24 hours`, the queue leads
 *      with overdue tasks, and `internal_dispute_opened` (§27.6, a key that
 *      existed unsent since Phase 03) finally has its sender.
 *
 *   2. The §24.8 classification — `classifyDispute` records a
 *      `refund_cause_allocations` row with `case_kind = 'dispute'` through the
 *      SAME validation the refund case uses (cause register, earnings-phase
 *      consistency, invalid-amount rules). §33.9.6's dispute half is the
 *      absence of any earnings write on the ingest path: a
 *      `charge.dispute.created` delivery moves the reservation's status and
 *      nothing else, and an unrelated-Backer-dispute classification has the
 *      same ceiling the Founder-caused row has — the stronger treatments are
 *      reachable only by classifying the case `affiliate_fraud_or_breach`
 *      with the evidence that justifies it.
 *
 * The evidence packet (§24.11) is ASSEMBLED, never re-derived: every item is
 * a read of a record an earlier phase stored — the reservation's own consent
 * text and policy snapshot, its amounts and billing state, the §32.4 provider
 * ids, the campaign updates and support history. `recordDisputeEvidenceAssembly`
 * stores what was assembled, by whom, when (§1.3: manual work is valid only
 * when the app records it) and refuses an incomplete packet by naming what is
 * missing.
 *
 * A delivery that cannot be bound to a reservation is recorded under §32.4 and
 * routed to Admin — never guessed into place (§1 rule 6) — exactly as the 20a
 * `charge.refunded` handler does.
 */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations, reservationStatusHistory } from '../db/schema/domain.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  paymentDisputes,
  paymentDisputeEvents,
  paymentDisputeEvidence,
  type PaymentDispute,
} from '../db/schema/disputes.js';
import { refundCauseAllocations } from '../db/schema/refunds.js';
import { affiliateTransfers, contractualRecoveryRecords } from '../db/schema/earnings.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { supportCases, supportCaseMessages } from '../db/schema/support.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { providerObjects } from '../db/schema/payments.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import { applyCauseBasedAffiliateAdjustment } from '../close/earnings.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import {
  allocationInconsistency,
  findRefundCause,
  type AffiliateRefundTreatment,
  type ProovdFeeTreatment,
  type RefundCauseKey,
} from '../refunds/logic.js';
import {
  DISPUTE_EVIDENCE_ITEMS,
  DISPUTE_TASK_HOURS,
  PAYMENT_DISPUTE_STATUSES,
} from './logic.js';
import { deriveEarningsPhase } from '../refunds/service.js';
import { notifyDisputeOpened, notifyTransferReversal, notifyTransferUpdate } from './notifications.js';

export interface DisputeDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/** §24.11: the Admin task is due 24 hours after the dispute opened. */
export function disputeTaskDueAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + DISPUTE_TASK_HOURS * 3_600_000);
}

/* ── Webhook ingest ───────────────────────────────────────────────────────── */

interface DisputeObjectFacts {
  providerDisputeId: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  amountCents: bigint;
  currency: string;
  reasonCode: string | null;
  status: string | null;
  providerEvidenceDueBy: Date | null;
  openedAt: Date;
}

function readDisputeObject(object: Record<string, unknown>, now: Date): DisputeObjectFacts | null {
  const id = typeof object['id'] === 'string' ? object['id'] : null;
  if (!id) return null;
  const status = typeof object['status'] === 'string' ? object['status'] : null;
  const evidenceDetails =
    object['evidence_details'] && typeof object['evidence_details'] === 'object'
      ? (object['evidence_details'] as Record<string, unknown>)
      : null;
  const dueBy =
    evidenceDetails && typeof evidenceDetails['due_by'] === 'number'
      ? new Date(evidenceDetails['due_by'] * 1000)
      : null;
  return {
    providerDisputeId: id,
    chargeId: typeof object['charge'] === 'string' ? object['charge'] : null,
    paymentIntentId:
      typeof object['payment_intent'] === 'string' ? object['payment_intent'] : null,
    amountCents:
      typeof object['amount'] === 'number' ? BigInt(Math.trunc(object['amount'])) : 0n,
    currency: typeof object['currency'] === 'string' ? object['currency'] : 'usd',
    reasonCode: typeof object['reason'] === 'string' ? object['reason'] : null,
    // Stored only when it is a status the register knows; an unknown provider
    // status is routed to Admin rather than guessed into the enum (§1 rule 6).
    status: status && (PAYMENT_DISPUTE_STATUSES as readonly string[]).includes(status) ? status : null,
    providerEvidenceDueBy: dueBy,
    openedAt:
      typeof object['created'] === 'number' ? new Date(object['created'] * 1000) : now,
  };
}

/**
 * `charge.dispute.created|updated|closed` on the CONNECT endpoint — campaign
 * charges are direct charges on the Founder's account (§24.1).
 */
export async function applyConnectDisputeEvent(
  deps: DisputeDeps,
  event: { id: string; type: string; object: Record<string, unknown>; account: string | null },
): Promise<void> {
  const now = new Date();
  const facts = readDisputeObject(event.object, now);
  if (!facts) {
    await deps.audit({
      action: 'dispute.unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `${event.type} delivery carried no dispute id; nothing was applied`,
    });
    return;
  }

  // Bind to the reservation by its own stored charge, then PaymentIntent.
  const [reservation] = facts.chargeId
    ? await deps.db
        .select()
        .from(reservations)
        .where(eq(reservations.chargeId, facts.chargeId))
        .limit(1)
    : [];
  const [byIntent] =
    !reservation && facts.paymentIntentId
      ? await deps.db
          .select()
          .from(reservations)
          .where(eq(reservations.paymentIntentId, facts.paymentIntentId))
          .limit(1)
      : [];
  const bound = reservation ?? byIntent;

  if (!bound || !facts.status) {
    // Recorded under §32.4 and routed to Admin — never guessed (§1 rule 6).
    if (event.account) {
      await recordProviderObject(deps.db, {
        mode: deps.gateway.mode,
        objectType: 'dispute',
        providerObjectId: facts.providerDisputeId,
        accountContext: 'connected',
        stripeAccountId: event.account,
        campaignId: bound?.campaignId ?? null,
        reservationId: bound?.id ?? null,
        amountCents: facts.amountCents,
        status: facts.status ?? 'unknown',
        failureCode: facts.reasonCode,
      });
    }
    await deps.audit({
      action: 'dispute.unreconciled',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: bound
        ? `dispute ${facts.providerDisputeId} carried unrecognised status; recorded under §32.4 and routed to Admin`
        : `dispute ${facts.providerDisputeId} matches no reservation charge; recorded under §32.4 and routed to Admin`,
    });
    return;
  }

  const [existing] = await deps.db
    .select()
    .from(paymentDisputes)
    .where(
      and(
        eq(paymentDisputes.mode, deps.gateway.mode),
        eq(paymentDisputes.providerDisputeId, facts.providerDisputeId),
      ),
    )
    .limit(1);

  if (!existing) {
    await openDispute(deps, { facts, reservation: bound, event, now });
    return;
  }

  await advanceDispute(deps, { dispute: existing, facts, event, now });
}

/**
 * The platform endpoint's `charge.dispute.*` belongs to the LISTING stream
 * (§24.6): Proovd is the merchant of record there, the dispute lives on
 * Proovd's own account, and there is no reservation to bind or §24.11 packet
 * to assemble from campaign records. It is recorded under §32.4 and routed to
 * Admin (§1.3), nothing more.
 */
export async function applyPlatformDisputeEvent(
  deps: DisputeDeps,
  event: { id: string; type: string; object: Record<string, unknown> },
): Promise<void> {
  const now = new Date();
  const facts = readDisputeObject(event.object, now);
  if (facts) {
    await recordProviderObject(deps.db, {
      mode: deps.gateway.mode,
      objectType: 'dispute',
      providerObjectId: facts.providerDisputeId,
      accountContext: 'platform',
      amountCents: facts.amountCents,
      status: facts.status ?? 'unknown',
      failureCode: facts.reasonCode,
    });
  }
  await deps.audit({
    action: 'dispute.listing_stream',
    targetType: 'provider_event',
    targetId: event.id,
    internalReason: `${event.type} on the platform endpoint belongs to the listing stream; recorded under §32.4 and routed to Admin`,
  });
}

async function openDispute(
  deps: DisputeDeps,
  input: {
    facts: DisputeObjectFacts;
    reservation: typeof reservations.$inferSelect;
    event: { id: string; account: string | null };
    now: Date;
  },
): Promise<void> {
  const { facts, reservation, event, now } = input;

  const inserted = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .insert(paymentDisputes)
      .values({
        campaignId: reservation.campaignId,
        reservationId: reservation.id,
        mode: deps.gateway.mode,
        providerDisputeId: facts.providerDisputeId,
        chargeId: facts.chargeId,
        paymentIntentId: facts.paymentIntentId,
        amountCents: facts.amountCents,
        currency: facts.currency,
        reasonCode: facts.reasonCode,
        status: facts.status!,
        providerEvidenceDueBy: facts.providerEvidenceDueBy,
        openedAt: facts.openedAt,
        taskDueAt: disputeTaskDueAt(facts.openedAt),
      })
      .onConflictDoNothing()
      .returning();
    const dispute = rows[0];
    // A concurrent delivery claimed it first: this delivery applies nothing.
    if (!dispute) return null;

    await tx.insert(paymentDisputeEvents).values({
      disputeId: dispute.id,
      providerEventId: event.id,
      fromStatus: null,
      toStatus: dispute.status,
      note: 'dispute opened at the provider (reason recorded internally, §25.6)',
      occurredAt: now,
    });

    // §23.5: captured → disputed, conditional — a reservation already refunded
    // or reversed keeps its state; the dispute record still exists beside it.
    const moved = await tx
      .update(reservations)
      .set({ status: 'disputed', updatedAt: now })
      .where(and(eq(reservations.id, reservation.id), eq(reservations.status, 'captured')))
      .returning({ id: reservations.id });
    if (moved.length > 0) {
      await tx.insert(reservationStatusHistory).values({
        reservationId: reservation.id,
        fromStatus: 'captured',
        toStatus: 'disputed',
        actor: 'system:stripe-webhook',
      });
    }
    return dispute;
  });

  if (!inserted) return;

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'dispute',
    providerObjectId: facts.providerDisputeId,
    accountContext: event.account ? 'connected' : 'platform',
    ...(event.account ? { stripeAccountId: event.account } : {}),
    campaignId: reservation.campaignId,
    reservationId: reservation.id,
    amountCents: facts.amountCents,
    status: inserted.status,
    failureCode: facts.reasonCode,
  });

  await deps.audit({
    action: 'dispute.opened',
    targetType: 'reservation',
    targetId: reservation.id,
    internalReason: `dispute ${facts.providerDisputeId} opened (${facts.reasonCode ?? 'no reason code'}); §24.11 task due ${disputeTaskDueAt(facts.openedAt).toISOString()}`,
    newValue: { disputeId: inserted.id, providerDisputeId: facts.providerDisputeId },
  });

  // §33.9.6's rule, stated where it is easiest to break: the ingest touches no
  // earnings record. Classification is an Admin act (§24.8).
  await notifyDisputeOpened(deps, { dispute: inserted });
}

async function advanceDispute(
  deps: DisputeDeps,
  input: {
    dispute: PaymentDispute;
    facts: DisputeObjectFacts;
    event: { id: string; account: string | null };
    now: Date;
  },
): Promise<void> {
  const { dispute, facts, event, now } = input;
  if (!facts.status || facts.status === dispute.status) {
    // A redelivery under a fresh event id, or an update that changes nothing:
    // recorded by the provider-event pivot; no domain work.
    return;
  }

  const closed = facts.status === 'won' || facts.status === 'lost' || facts.status === 'warning_closed';

  await deps.db.transaction(async (tx) => {
    const moved = await tx
      .update(paymentDisputes)
      .set({
        status: facts.status!,
        ...(closed ? { closedAt: now } : {}),
        providerEvidenceDueBy: facts.providerEvidenceDueBy ?? dispute.providerEvidenceDueBy,
        updatedAt: now,
      })
      .where(and(eq(paymentDisputes.id, dispute.id), eq(paymentDisputes.status, dispute.status)))
      .returning({ id: paymentDisputes.id });
    if (moved.length === 0) return;

    await tx.insert(paymentDisputeEvents).values({
      disputeId: dispute.id,
      providerEventId: event.id,
      fromStatus: dispute.status,
      toStatus: facts.status!,
      occurredAt: now,
    });

    if (facts.status === 'won') {
      // §23.5: "when won on evidence, the charge stands again."
      const back = await tx
        .update(reservations)
        .set({ status: 'captured', updatedAt: now })
        .where(
          and(eq(reservations.id, dispute.reservationId), eq(reservations.status, 'disputed')),
        )
        .returning({ id: reservations.id });
      if (back.length > 0) {
        await tx.insert(reservationStatusHistory).values({
          reservationId: dispute.reservationId,
          fromStatus: 'disputed',
          toStatus: 'captured',
          actor: 'system:stripe-webhook',
        });
      }
    }

    if (facts.status === 'lost') {
      // The issuer took the money back: `reversed` is the §23.5 money-returned
      // state, and the operational share flips to do-not-fulfill.
      const out = await tx
        .update(reservations)
        .set({ status: 'reversed', updatedAt: now })
        .where(
          and(eq(reservations.id, dispute.reservationId), eq(reservations.status, 'disputed')),
        )
        .returning({ id: reservations.id });
      if (out.length > 0) {
        await tx.insert(reservationStatusHistory).values({
          reservationId: dispute.reservationId,
          fromStatus: 'disputed',
          toStatus: 'reversed',
          actor: 'system:stripe-webhook',
        });
        await tx
          .update(founderOperationalShares)
          .set({
            fulfillmentState: 'do_not_fulfill',
            doNotFulfillAt: now,
            deliveryStatus: 'do_not_fulfill',
          })
          .where(eq(founderOperationalShares.reservationId, dispute.reservationId));
      }
    }
  });

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'dispute',
    providerObjectId: dispute.providerDisputeId,
    accountContext: event.account ? 'connected' : 'platform',
    ...(event.account ? { stripeAccountId: event.account } : {}),
    campaignId: dispute.campaignId,
    reservationId: dispute.reservationId,
    amountCents: facts.amountCents,
    status: facts.status,
    failureCode: facts.reasonCode ?? dispute.reasonCode,
  });

  await deps.audit({
    action: 'dispute.updated',
    targetType: 'reservation',
    targetId: dispute.reservationId,
    internalReason: `dispute ${dispute.providerDisputeId}: ${dispute.status} → ${facts.status}`,
    priorValue: { status: dispute.status },
    newValue: { status: facts.status },
  });
}

/* ── transfer.reversed (Connect) ──────────────────────────────────────────── */

/**
 * A Transfer reversal arrives when Proovd recovers an already-transferred
 * amount at the provider (§24.8: "already transferred amount creates negative
 * balance/contractual recovery"). The handler confirms a reversal a §24.8
 * recovery record expects, or routes an unexpected one to Admin — it never
 * moves an earnings state itself: 20a's `applyCauseBasedAffiliateAdjustment`
 * is the one door, and it ran when the case was classified.
 */
export async function applyTransferReversed(
  deps: DisputeDeps,
  event: { id: string; object: Record<string, unknown>; account: string | null },
): Promise<void> {
  const transferId = typeof event.object['id'] === 'string' ? event.object['id'] : null;
  const amountReversed =
    typeof event.object['amount_reversed'] === 'number'
      ? BigInt(Math.trunc(event.object['amount_reversed']))
      : null;
  if (!transferId) {
    await deps.audit({
      action: 'transfer.reversal_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: 'transfer.reversed delivery carried no transfer id; nothing was applied',
    });
    return;
  }

  const [transfer] = await deps.db
    .select()
    .from(affiliateTransfers)
    .where(eq(affiliateTransfers.providerTransferId, transferId))
    .limit(1);

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'transfer_reversal',
    providerObjectId: `${transferId}:reversal`,
    accountContext: event.account ? 'connected' : 'platform',
    ...(event.account ? { stripeAccountId: event.account } : {}),
    campaignId: transfer?.campaignId ?? null,
    associationId: transfer?.associationId ?? null,
    ...(amountReversed !== null ? { amountCents: amountReversed } : {}),
    status: 'reversed',
  });

  if (!transfer) {
    await deps.audit({
      action: 'transfer.reversal_unreconciled',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `transfer.reversed for ${transferId} matches no affiliate_transfers row; recorded under §32.4 and routed to Admin (§1 rule 6)`,
    });
    return;
  }

  // Does a recorded §24.8/§22.1 recovery expect money back from this Creator?
  const [recovery] = await deps.db
    .select()
    .from(contractualRecoveryRecords)
    .where(eq(contractualRecoveryRecords.associationId, transfer.associationId))
    .orderBy(desc(contractualRecoveryRecords.createdAt))
    .limit(1);

  await deps.audit({
    action: recovery ? 'transfer.reversal_reconciled' : 'transfer.reversal_unreconciled',
    targetType: 'campaign_affiliate_association',
    targetId: transfer.associationId,
    internalReason: recovery
      ? `transfer.reversed for ${transferId} reconciles against contractual recovery ${recovery.id}`
      : `transfer.reversed for ${transferId} has no recorded §24.8 recovery behind it; routed to Admin for a classification`,
    newValue: {
      transferId: transfer.id,
      amountReversedCents: amountReversed?.toString() ?? null,
    },
  });

  await notifyTransferReversal(deps, {
    transfer,
    amountReversedCents: amountReversed,
  });
}

/**
 * `transfer.updated` — §32.3's Connect set, registered in Phase 22b.
 *
 * ── Most of these deliveries are ours, and carry nothing a Creator needs ────
 * Stripe fires `transfer.updated` for any change to the Transfer object,
 * including a metadata or description edit Proovd itself made. §27's own rule
 * — no notification without a real action or consequence behind it — means the
 * default here is to record and say nothing.
 *
 * The exception is a change to the money: an amount or a reversed amount that
 * disagrees with what Proovd recorded is a fact the Creator is owed, because it
 * changes what they are being paid. So the message is gated on that comparison
 * rather than on the delivery arriving, and the audit row is written either way
 * — an unreconciled amount is routed to Admin, never guessed into place
 * (§1 rule 6).
 */
export async function applyTransferUpdated(
  deps: DisputeDeps,
  event: { id: string; object: Record<string, unknown>; account: string | null },
): Promise<void> {
  const transferId = typeof event.object['id'] === 'string' ? event.object['id'] : null;
  if (!transferId) {
    await deps.audit({
      action: 'transfer.update_unbindable',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: 'transfer.updated delivery carried no transfer id; nothing was applied',
    });
    return;
  }

  const amount =
    typeof event.object['amount'] === 'number'
      ? BigInt(Math.trunc(event.object['amount']))
      : null;
  const amountReversed =
    typeof event.object['amount_reversed'] === 'number'
      ? BigInt(Math.trunc(event.object['amount_reversed']))
      : null;

  const [transfer] = await deps.db
    .select()
    .from(affiliateTransfers)
    .where(eq(affiliateTransfers.providerTransferId, transferId))
    .limit(1);

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'transfer',
    providerObjectId: transferId,
    accountContext: event.account ? 'connected' : 'platform',
    ...(event.account ? { stripeAccountId: event.account } : {}),
    campaignId: transfer?.campaignId ?? null,
    associationId: transfer?.associationId ?? null,
    ...(amount !== null ? { amountCents: amount } : {}),
    status: 'updated',
  });

  if (!transfer) {
    await deps.audit({
      action: 'transfer.update_unreconciled',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `transfer.updated for ${transferId} matches no affiliate_transfers row; recorded under §32.4 and routed to Admin (§1 rule 6)`,
    });
    return;
  }

  // The comparison that decides whether anyone is told. `total_cents` is
  // CHECK-pinned to commission + bonus + fixed and a `created` row is
  // trigger-immutable, so a provider amount that disagrees with it is a real
  // discrepancy rather than a rounding artefact.
  const amountMoved = amount !== null && amount !== transfer.totalCents;
  const reversalMoved = amountReversed !== null && amountReversed > 0n;

  await deps.audit({
    action: amountMoved ? 'transfer.update_amount_discrepancy' : 'transfer.update_recorded',
    targetType: 'campaign_affiliate_association',
    targetId: transfer.associationId,
    internalReason: amountMoved
      ? `transfer.updated for ${transferId} reports ${amount} against a recorded total of ${transfer.totalCents}; routed to Admin`
      : `transfer.updated for ${transferId} changed nothing about the amount`,
    newValue: {
      transferId: transfer.id,
      providerAmountCents: amount?.toString() ?? null,
      amountReversedCents: amountReversed?.toString() ?? null,
    },
  });

  // A reversal has its own §27.4 message and its own handler; announcing it
  // again from here would be two messages for one fact.
  if (!amountMoved || reversalMoved) return;

  await notifyTransferUpdate(deps, {
    transfer,
    providerAmountCents: amount,
  });
}

/* ── §24.8 classification of a dispute ────────────────────────────────────── */

export interface ClassifyDisputeInput {
  disputeId: string;
  cause: RefundCauseKey;
  affiliateTreatment: AffiliateRefundTreatment;
  proovdFeeTreatment: ProovdFeeTreatment;
  affiliateInvalidCents?: bigint | null;
  founderLiabilityCents: bigint;
  evidence: string;
  recoveryNote?: string | null;
  mandate?: string | null;
  actor: string;
  now?: Date;
}

export type ClassifyDisputeOutcome =
  | { status: 'classified'; allocationId: string }
  | { status: 'refused'; reason: string };

export async function classifyDispute(
  deps: DisputeDeps,
  input: ClassifyDisputeInput,
): Promise<ClassifyDisputeOutcome> {
  const now = input.now ?? new Date();

  const [dispute] = await deps.db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.id, input.disputeId))
    .limit(1);
  if (!dispute) return { status: 'refused', reason: 'not_found' };
  if (dispute.allocationId) return { status: 'refused', reason: 'already_classified' };

  const [reservation] = await deps.db
    .select()
    .from(reservations)
    .where(eq(reservations.id, dispute.reservationId))
    .limit(1);
  if (!reservation) return { status: 'refused', reason: 'not_found' };

  if (!input.evidence || input.evidence.trim().length === 0) {
    return { status: 'refused', reason: 'evidence_required' };
  }
  const cause = findRefundCause(input.cause);
  if (!cause) return { status: 'refused', reason: 'unknown_cause' };

  // The same two validations the refund case runs (20a): the cause's own
  // permitted-treatment ceiling, and where the money actually stands.
  const phase = await deriveEarningsPhase(deps.db, {
    attributionAssociationId: reservation.attributionAssociationId,
  });
  const inconsistency = allocationInconsistency(
    {
      cause: input.cause,
      affiliateTreatment: input.affiliateTreatment,
      proovdFeeTreatment: input.proovdFeeTreatment,
      affiliateInvalidCents: input.affiliateInvalidCents ?? null,
      founderLiabilityCents: input.founderLiabilityCents,
      mandate: input.mandate ?? null,
    },
    phase,
  );
  if (inconsistency) return { status: 'refused', reason: inconsistency };

  const allocationId = await deps.db.transaction(async (tx) => {
    const [allocation] = await tx
      .insert(refundCauseAllocations)
      .values({
        campaignId: dispute.campaignId,
        reservationId: dispute.reservationId,
        caseKind: 'dispute',
        cause: input.cause,
        proovdFeeTreatment: input.proovdFeeTreatment,
        affiliateTreatment: input.affiliateTreatment,
        affiliateInvalidCents: input.affiliateInvalidCents ?? null,
        founderLiabilityCents: input.founderLiabilityCents,
        recoveryNote: input.recoveryNote ?? null,
        evidence: input.evidence,
        mandate: input.mandate ?? null,
        decidedBy: input.actor,
        decidedAt: now,
      })
      .returning({ id: refundCauseAllocations.id });

    // Write-once, race-safe: a concurrent classification loses the conditional
    // UPDATE and the whole transaction rolls its allocation back.
    const linked = await tx
      .update(paymentDisputes)
      .set({ allocationId: allocation!.id, updatedAt: now })
      .where(
        and(eq(paymentDisputes.id, dispute.id), isNull(paymentDisputes.allocationId)),
      )
      .returning({ id: paymentDisputes.id });
    if (linked.length === 0) {
      throw new ClassificationRace();
    }
    return allocation!.id;
  }).catch((error: unknown) => {
    if (error instanceof ClassificationRace) return null;
    throw error;
  });

  if (!allocationId) return { status: 'refused', reason: 'already_classified' };

  await deps.audit({
    action: 'dispute.classified',
    targetType: 'reservation',
    targetId: dispute.reservationId,
    internalReason: `dispute ${dispute.providerDisputeId} classified ${input.cause}, affiliate ${input.affiliateTreatment}, fee ${input.proovdFeeTreatment} (earnings phase: ${phase})`,
    newValue: { disputeId: dispute.id, allocationId },
  });

  // The two post-transfer treatments execute through the ONE door 20a built.
  // `cancel_unfinalized` needs no call: finalization's kernel folds every
  // recorded cancel allocation regardless of case kind. `earnings_remain` and
  // `not_attributed` execute by doing nothing — §33.9.6.
  if (
    (input.affiliateTreatment === 'cancel_unpaid_invalid' ||
      input.affiliateTreatment === 'contractual_recovery') &&
    reservation.attributionAssociationId
  ) {
    await applyCauseBasedAffiliateAdjustment(
      {
        db: deps.db,
        gateway: deps.gateway,
        audit: deps.audit,
        notifier: deps.notifier,
        context: deps.context,
      },
      {
        associationId: reservation.attributionAssociationId,
        campaignId: dispute.campaignId,
        treatment: input.affiliateTreatment,
        invalidCents: input.affiliateInvalidCents ?? 0n,
        allocationId,
        reason: `§24.11 dispute ${dispute.providerDisputeId}: ${input.evidence}`,
        actor: input.actor,
        now,
      },
    );
  }

  return { status: 'classified', allocationId };
}

class ClassificationRace extends Error {}

/* ── The §24.11 evidence packet ───────────────────────────────────────────── */

export interface EvidencePacketItem {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  data?: Record<string, unknown> | undefined;
  absentReason?: string | undefined;
}

export interface DisputeEvidencePacket {
  disputeId: string;
  providerDisputeId: string;
  items: EvidencePacketItem[];
  complete: boolean;
  missing: string[];
}

/**
 * Assemble — never re-derive. Every value below is a stored record: the
 * reservation's own consent snapshot (15a + §24.10's 20a hardening), its
 * amounts, tax, and billing state, the §32.4 provider ids, the campaign's
 * updates, and the support history.
 */
export async function readDisputeEvidencePacket(
  db: Database,
  disputeId: string,
): Promise<DisputeEvidencePacket | null> {
  const [dispute] = await db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.id, disputeId))
    .limit(1);
  if (!dispute) return null;

  const [reservation] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, dispute.reservationId))
    .limit(1);
  if (!reservation) return null;

  const [build] = await db
    .select({
      title: campaignBuild.title,
      founderDisplayName: campaignBuild.founderDisplayName,
      founderEntityDisplay: campaignBuild.founderEntityDisplay,
      founderCountry: campaignBuild.founderCountry,
    })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, dispute.campaignId))
    .limit(1);
  const [claim] = await db
    .select({
      legalName: founderClaimProfiles.legalName,
      businessName: founderClaimProfiles.businessName,
      soleProprietor: founderClaimProfiles.soleProprietor,
    })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, dispute.campaignId))
    .limit(1);
  const [campaign] = await db
    .select({ type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, dispute.campaignId))
    .limit(1);

  const updates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      publishedAt: campaignUpdates.publishedAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, dispute.campaignId))
    .orderBy(desc(campaignUpdates.publishedAt));

  const cases = await db
    .select({
      id: supportCases.id,
      reference: supportCases.reference,
      topic: supportCases.topic,
      status: supportCases.status,
      createdAt: supportCases.createdAt,
    })
    .from(supportCases)
    .where(eq(supportCases.reservationId, dispute.reservationId));
  const caseIds = cases.map((c) => c.id);
  const messages =
    caseIds.length > 0
      ? await db
          .select({
            caseId: supportCaseMessages.caseId,
            direction: supportCaseMessages.direction,
            customerFacing: supportCaseMessages.customerFacing,
            occurredAt: supportCaseMessages.occurredAt,
          })
          .from(supportCaseMessages)
          .where(inArray(supportCaseMessages.caseId, caseIds))
      : [];
  const deliveries = await db
    .select({
      eventKey: notificationDeliveries.eventKey,
      deliveredAt: notificationDeliveries.deliveredAt,
      createdAt: notificationDeliveries.createdAt,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.entityType, 'reservation'),
        eq(notificationDeliveries.entityId, dispute.reservationId),
      ),
    );

  const providerRows = await db
    .select({
      objectType: providerObjects.objectType,
      providerObjectId: providerObjects.providerObjectId,
      status: providerObjects.status,
    })
    .from(providerObjects)
    .where(eq(providerObjects.reservationId, dispute.reservationId));

  const policyVersionsSnapshot =
    reservation.policyVersions && typeof reservation.policyVersions === 'object'
      ? (reservation.policyVersions as Record<string, unknown>)
      : null;

  const items: EvidencePacketItem[] = [];
  const push = (
    key: string,
    present: boolean,
    data?: Record<string, unknown>,
    absentReason?: string,
  ) => {
    const registered = DISPUTE_EVIDENCE_ITEMS.find((i) => i.key === key)!;
    items.push({
      key,
      label: registered.label,
      required: registered.required,
      present,
      ...(present ? { data } : { absentReason: absentReason ?? 'not_recorded' }),
    });
  };

  // 1. Consent text/version and timestamp — stored verbatim at pre-order.
  push(
    'consent',
    Boolean(reservation.consentText && reservation.consentVersion),
    {
      appendix: reservation.consentAppendix,
      version: reservation.consentVersion,
      hash: reservation.consentHash,
      text: reservation.consentText,
      consentedAt: reservation.reservedAt?.toISOString() ?? null,
    },
  );

  // 2. Campaign disclosure/version at reservation — the transaction's own
  // `policy_versions` snapshot (15a stored the identity; 20a added the text
  // and hash) is the at-reservation record §24.11 asks for.
  push(
    'campaign_disclosure',
    Boolean(reservation.campaignDisclosureVersion ?? policyVersionsSnapshot),
    {
      disclosureVersion: reservation.campaignDisclosureVersion,
      policyVersions: policyVersionsSnapshot,
    },
  );

  // 3. Founder identity / MoR disclosure (§18's A.2 facts).
  push('founder_identity', Boolean(build || claim), {
    legalName: build?.founderDisplayName ?? claim?.legalName ?? null,
    entity:
      claim?.soleProprietor === true
        ? 'sole proprietor'
        : (build?.founderEntityDisplay ?? claim?.businessName ?? null),
    country: build?.founderCountry ?? null,
    merchantOfRecord: 'founder',
  });

  // 4. Reward, subtotal, tax, total, location evidence, and descriptor.
  push(
    'transaction_amounts',
    reservation.totalAuthorizedCents !== null,
    {
      rewardSku: reservation.rewardSku,
      rewardTitle: reservation.rewardTitle,
      rewardSubtotalCents: reservation.rewardSubtotalCents.toString(),
      salesTaxCents: reservation.salesTaxCents.toString(),
      totalAuthorizedCents: reservation.totalAuthorizedCents?.toString() ?? null,
      totalCapturedCents: reservation.totalCapturedCents.toString(),
      taxJurisdiction: reservation.taxJurisdiction,
      billing: {
        country: reservation.billingCountry,
        postalCode: reservation.billingPostalCode,
        city: reservation.billingCity,
        state: reservation.billingState,
      },
      statementDescriptor: reservation.statementDescriptor,
    },
  );

  // 5. Delivery date/promise — the reward snapshot the Backer accepted.
  push('delivery_promise', Boolean(reservation.rewardDelivery), {
    delivery: reservation.rewardDelivery,
  });

  // 6. SetupIntent and PaymentIntent/charge (§32.4).
  push(
    'payment_objects',
    Boolean(reservation.setupIntentId),
    {
      setupIntentId: reservation.setupIntentId,
      paymentIntentId: reservation.paymentIntentId,
      chargeId: reservation.chargeId,
      capturedAt: reservation.capturedAt?.toISOString() ?? null,
      storedProviderObjects: providerRows,
    },
  );

  // 7. Survey responses — only where the Backer consented to sharing (§11).
  if (reservation.founderMarketingConsent && reservation.surveyWhy) {
    push('survey_responses', true, {
      surveyWhy: reservation.surveyWhy,
      surveyRecommend: reservation.surveyRecommend,
    });
  } else {
    push(
      'survey_responses',
      false,
      undefined,
      reservation.surveyWhy ? 'backer_did_not_consent_to_sharing' : 'no_survey_recorded',
    );
  }

  // 8. Immutable refund-policy version — the transaction's own §24.10 snapshot
  // for a Product campaign; an Idea campaign has no Founder policy and the
  // §24.9 exception register governs instead.
  if (campaign?.type === 'pre_launch') {
    const policy =
      policyVersionsSnapshot && typeof policyVersionsSnapshot['founderRefundPolicy'] === 'object'
        ? (policyVersionsSnapshot['founderRefundPolicy'] as Record<string, unknown>)
        : policyVersionsSnapshot;
    push('refund_policy', Boolean(policy), { snapshot: policy });
  } else {
    push('refund_policy', true, {
      model: 'idea',
      basis: '§24.9 exception register — no voluntary refund path; Proovd Refund Policy applies',
    });
  }

  // 9. Fulfillment evidence — Phase 21's records; named absent until they exist.
  push(
    'fulfillment_evidence',
    false,
    undefined,
    'fulfillment records are Phase 21’s; none recorded yet',
  );

  // 10. Updates and support/communication history.
  push('communication_history', true, {
    updates: updates.map((u) => ({
      id: u.id,
      title: u.title,
      publishedAt: u.publishedAt?.toISOString() ?? null,
    })),
    supportCases: cases.map((c) => ({
      reference: c.reference,
      topic: c.topic,
      status: c.status,
      openedAt: c.createdAt.toISOString(),
      messages: messages.filter((m) => m.caseId === c.id).length,
    })),
    notifications: deliveries.map((d) => ({
      eventKey: d.eventKey,
      deliveredAt: (d.deliveredAt ?? d.createdAt).toISOString(),
      confirmed: d.deliveredAt !== null,
    })),
  });

  const missing = items.filter((i) => i.required && !i.present).map((i) => i.key);
  return {
    disputeId: dispute.id,
    providerDisputeId: dispute.providerDisputeId,
    items,
    complete: missing.length === 0,
    missing,
  };
}

export type RecordEvidenceOutcome =
  | { status: 'recorded'; evidenceId: string; complete: boolean }
  | { status: 'refused'; reason: string; missing?: string[] };

/** §26.7 "Assemble dispute evidence", recorded (§1.3). */
export async function recordDisputeEvidenceAssembly(
  deps: DisputeDeps,
  input: { disputeId: string; actor: string; now?: Date },
): Promise<RecordEvidenceOutcome> {
  const packet = await readDisputeEvidencePacket(deps.db, input.disputeId);
  if (!packet) return { status: 'refused', reason: 'not_found' };
  if (!packet.complete) {
    // An incomplete packet submitted to an issuer loses; refuse by naming the
    // missing items rather than storing a packet that reads as done (§1.4).
    return { status: 'refused', reason: 'packet_incomplete', missing: packet.missing };
  }

  const [row] = await deps.db
    .insert(paymentDisputeEvidence)
    .values({
      disputeId: input.disputeId,
      packet: JSON.parse(JSON.stringify(packet)) as Record<string, unknown>,
      complete: packet.complete,
      missing: packet.missing,
      assembledBy: input.actor,
      assembledAt: input.now ?? new Date(),
    })
    .returning({ id: paymentDisputeEvidence.id });

  await deps.audit({
    action: 'dispute.evidence_assembled',
    targetType: 'payment_dispute',
    targetId: input.disputeId,
    internalReason: `§24.11 evidence packet assembled (${packet.items.filter((i) => i.present).length}/${packet.items.length} items present)`,
    newValue: { evidenceId: row!.id },
  });

  return { status: 'recorded', evidenceId: row!.id, complete: packet.complete };
}

/* ── The Admin dispute queue ──────────────────────────────────────────────── */

export interface DisputeQueueEntry {
  disputeId: string;
  providerDisputeId: string;
  campaignId: string;
  reservationId: string;
  status: string;
  amountCents: string;
  /** Internal only — the Admin view may show it as secondary detail (§26.8). */
  reasonCode: string | null;
  openedAt: string;
  taskDueAt: string;
  taskOverdue: boolean;
  providerEvidenceDueBy: string | null;
  classified: boolean;
  allocationId: string | null;
  evidenceAssembledAt: string | null;
  closedAt: string | null;
}

export interface DisputeQueue {
  disputes: DisputeQueueEntry[];
}

export async function readDisputeQueue(
  db: Database,
  input: { campaignId?: string | undefined; now?: Date } = {},
): Promise<DisputeQueue> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(paymentDisputes)
    .where(input.campaignId ? eq(paymentDisputes.campaignId, input.campaignId) : undefined)
    .orderBy(desc(paymentDisputes.openedAt));

  const evidenceRows =
    rows.length > 0
      ? await db
          .select({
            disputeId: paymentDisputeEvidence.disputeId,
            assembledAt: paymentDisputeEvidence.assembledAt,
          })
          .from(paymentDisputeEvidence)
          .where(
            inArray(
              paymentDisputeEvidence.disputeId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(desc(paymentDisputeEvidence.assembledAt))
      : [];
  const latestEvidence = new Map<string, Date>();
  for (const row of evidenceRows) {
    if (!latestEvidence.has(row.disputeId)) latestEvidence.set(row.disputeId, row.assembledAt);
  }

  const entries = rows.map((r) => ({
    disputeId: r.id,
    providerDisputeId: r.providerDisputeId,
    campaignId: r.campaignId,
    reservationId: r.reservationId,
    status: r.status,
    amountCents: r.amountCents.toString(),
    reasonCode: r.reasonCode,
    openedAt: r.openedAt.toISOString(),
    taskDueAt: r.taskDueAt.toISOString(),
    // Overdue only while the §24.11 work is actually open: no packet recorded
    // and the dispute not yet closed. The queue shows breach, not history.
    taskOverdue:
      r.closedAt === null &&
      !latestEvidence.has(r.id) &&
      r.taskDueAt.getTime() < now.getTime(),
    providerEvidenceDueBy: r.providerEvidenceDueBy?.toISOString() ?? null,
    classified: r.allocationId !== null,
    allocationId: r.allocationId,
    evidenceAssembledAt: latestEvidence.get(r.id)?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  }));

  // Overdue first, then soonest task due — the 16b queue rule.
  entries.sort((a, b) => {
    if (a.taskOverdue !== b.taskOverdue) return a.taskOverdue ? -1 : 1;
    return a.taskDueAt.localeCompare(b.taskDueAt);
  });

  return { disputes: entries };
}
