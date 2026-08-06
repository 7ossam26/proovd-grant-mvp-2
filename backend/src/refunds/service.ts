/**
 * Refunds of campaign charges and §24.8 cause-based allocation — Spec §24.8,
 * §24.9, §26.6, Appendix B.6, §33.9.2–§33.9.6 (Phase 20a).
 *
 * ── The case comes first, the money second ──────────────────────────────────
 * `recordRefundCase` records §24.8's whole answer — cause, Proovd fee
 * treatment, Affiliate treatment, Founder liability, recovery, evidence, the
 * Admin, and the timestamps — as an insert-only allocation, and claims the
 * refund row `requested` in the same transaction. The refund cannot exist
 * without its classification (§33.9.2): `allocation_id` is NOT NULL, and the
 * cause/treatment matrix is a CHECK the service refuses by name in front of.
 *
 * ── The provider call is the capture-attempt pattern rerun ──────────────────
 * The refund row IS the claim, written before the call, and the provider key
 * `reservation-refund:<allocationId>` is stable — a crash between claim, call,
 * and record retries as the SAME refund at Stripe (§28.3, §33.7.7's rule).
 * §24.1: campaign charges are direct charges on the Founder's connected
 * account, so the Refund is created there — refunded where it was charged.
 *
 * ── Who bears it is a recorded judgement, never a computed score ────────────
 * `founder_liability_cents` is what 19b's `causeBasedAdjustmentsCents` sums
 * into the §22.3 eligible share. The product presents the case's facts and the
 * Admin records the number with evidence (§31.7's posture, §1 rule 6).
 *
 * ── §26.6's four high-impact requirements ───────────────────────────────────
 * Reauthentication is the route's freshness gate; the customer-consequence
 * preview is 16a's `high_impact_action_previews` row consumed exactly once
 * here; idempotency is the stable key; the audit rows are insert-only.
 */

import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations, reservationStatusHistory } from '../db/schema/domain.js';
import { founderOperationalShares } from '../db/schema/reservations.js';
import {
  refundCauseAllocations,
  reservationRefunds,
  reservationRefundEvents,
  type RefundCauseAllocation,
  type ReservationRefund,
} from '../db/schema/refunds.js';
import { creatorEarnings } from '../db/schema/earnings.js';
import { listingFeeRefunds } from '../db/schema/listing.js';
import { providerObjects } from '../db/schema/payments.js';
import { highImpactActionPreviews } from '../db/schema/admin-operations.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import { findCampaignFounderUserId } from '../reservations/context.js';
import { applyCauseBasedAffiliateAdjustment } from '../close/earnings.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { notifyRefundState } from './notifications.js';
import {
  allocationInconsistency,
  findRefundCause,
  IDEA_REFUND_EXCEPTION_KEYS,
  BEST_EFFORT_RECOVERY_SENTENCE,
  type AffiliateEarningsPhase,
  type AffiliateRefundTreatment,
  type IdeaRefundException,
  type ProovdFeeTreatment,
  type RefundCauseKey,
} from './logic.js';

export interface RefundDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** Absent (some tests) → records still move, nothing sends. */
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

/** The stable provider key — a retried refund is the same refund (§28.3). */
export function refundProviderKey(allocationId: string): string {
  return `reservation-refund:${allocationId}`;
}

/** The 16b reference alphabet: no O/0 or I/1 confusion, random, quotable. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function referenceChunk(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return out;
}

export function generateRefundReference(): string {
  return `RF-${referenceChunk(5)}-${referenceChunk(5)}`;
}

/** The §26.6 preview hash — the consequences read must be THIS refund's. */
export function refundPayloadHash(refundId: string, amountCents: bigint): string {
  return createHash('sha256')
    .update(`refund:execute ${refundId} ${amountCents.toString()}`)
    .digest('hex');
}

export const REFUND_EXECUTE_ACTION_KEY = 'refund:execute';

/* ── Where the attributed Creator's money stands ───────────────────────────── */

const EVER_CAPTURED = ['captured', 'refunded', 'reversed', 'disputed'] as const;

/**
 * §24.8's treatments are phase-dependent: canceling "unfinalized" earnings
 * that finalized last week would be §33.9.3's clawback wearing a different
 * word, so the phase is derived from the earnings record, never supplied.
 */
export async function deriveEarningsPhase(
  db: Database,
  reservation: { attributionAssociationId: string | null },
): Promise<AffiliateEarningsPhase> {
  if (!reservation.attributionAssociationId) return 'not_attributed';
  const [earnings] = await db
    .select({ state: creatorEarnings.state })
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, reservation.attributionAssociationId))
    .limit(1);
  if (!earnings) return 'unfinalized';
  if (earnings.state === 'finalized' || earnings.state === 'approved_for_transfer') {
    return 'finalized_untransferred';
  }
  return 'transferred_or_later';
}

/* ── Recording the case (§24.8, §24.9) ─────────────────────────────────────── */

export interface RecordRefundCaseInput {
  reservationId: string;
  cause: RefundCauseKey;
  affiliateTreatment: AffiliateRefundTreatment;
  proovdFeeTreatment: ProovdFeeTreatment;
  affiliateInvalidCents?: bigint | null;
  founderLiabilityCents: bigint;
  evidence: string;
  recoveryNote?: string | null;
  mandate?: string | null;
  amountCents: bigint;
  ideaExceptionReason?: IdeaRefundException | null;
  /**
   * §24.10: the Founder as MoR may have issued the refund at the provider
   * already. Passing the provider refund id records the case against it —
   * record-only, no provider call, the lifecycle walked to `succeeded`.
   */
  providerRefundId?: string | null;
  actor: string;
  now?: Date;
}

export type RecordRefundCaseOutcome =
  | { status: 'recorded'; refund: ReservationRefund; allocation: RefundCauseAllocation }
  | { status: 'refused'; reason: string };

export async function recordRefundCase(
  deps: RefundDeps,
  input: RecordRefundCaseInput,
): Promise<RecordRefundCaseOutcome> {
  const now = input.now ?? new Date();

  const [row] = await deps.db
    .select({
      id: reservations.id,
      campaignId: reservations.campaignId,
      status: sql<string>`${reservations.status}::text`,
      totalCapturedCents: reservations.totalCapturedCents,
      paymentIntentId: reservations.paymentIntentId,
      attributionAssociationId: reservations.attributionAssociationId,
      campaignType: sql<string>`${campaigns.type}::text`,
    })
    .from(reservations)
    .innerJoin(campaigns, eq(campaigns.id, reservations.campaignId))
    .where(eq(reservations.id, input.reservationId))
    .limit(1);
  if (!row) return { status: 'refused', reason: 'not_found' };

  // §24.8: before charge there is nothing to refund — cancellation, threshold
  // miss, and pre-charge kill prevent the PaymentIntent instead (§33.7.4).
  if (!(EVER_CAPTURED as readonly string[]).includes(row.status)) {
    return { status: 'refused', reason: 'nothing_captured' };
  }
  if (!row.paymentIntentId) return { status: 'refused', reason: 'nothing_captured' };

  if (input.amountCents <= 0n) return { status: 'refused', reason: 'amount_not_positive' };
  const [already] = await deps.db
    .select({
      total: sql<string>`COALESCE(SUM(${reservationRefunds.amountCents}), 0)`,
    })
    .from(reservationRefunds)
    .where(
      and(
        eq(reservationRefunds.reservationId, input.reservationId),
        ne(reservationRefunds.status, 'failed'),
      ),
    );
  const remaining = (row.totalCapturedCents ?? 0n) - BigInt(already?.total ?? '0');
  if (input.amountCents > remaining) {
    return { status: 'refused', reason: 'amount_exceeds_captured' };
  }

  // §24.9: after a valid Idea capture, only the eight exceptions are routable.
  // There is no voluntary/change-of-mind member to name, which is the rule.
  if (row.campaignType === 'pre_build') {
    if (!input.ideaExceptionReason) {
      return { status: 'refused', reason: 'idea_exception_required' };
    }
    if (!IDEA_REFUND_EXCEPTION_KEYS.includes(input.ideaExceptionReason)) {
      return { status: 'refused', reason: 'idea_exception_unknown' };
    }
  } else if (input.ideaExceptionReason) {
    return { status: 'refused', reason: 'product_takes_no_idea_exception' };
  }

  if (!input.evidence.trim()) return { status: 'refused', reason: 'evidence_required' };
  if (!findRefundCause(input.cause)) return { status: 'refused', reason: 'unknown_cause' };

  const phase = await deriveEarningsPhase(deps.db, row);
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

  // The Founder's connected account — where the direct charge lives (§24.1).
  const founderUserId = await findCampaignFounderUserId(deps.db, row.campaignId);
  const account = founderUserId
    ? await findAccountForOwner(deps.db, {
        ownerUserId: founderUserId,
        role: 'founder_seller',
        mode: deps.gateway.mode,
      })
    : null;

  const recordOnly = Boolean(input.providerRefundId);

  const inserted = await deps.db.transaction(async (tx) => {
    const [allocation] = await tx
      .insert(refundCauseAllocations)
      .values({
        campaignId: row.campaignId,
        reservationId: input.reservationId,
        caseKind: 'refund',
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
        createdAt: now,
      })
      .returning();

    const [refund] = await tx
      .insert(reservationRefunds)
      .values({
        reference: generateRefundReference(),
        reservationId: input.reservationId,
        campaignId: row.campaignId,
        allocationId: allocation!.id,
        status: 'requested',
        amountCents: input.amountCents,
        ideaExceptionReason: input.ideaExceptionReason ?? null,
        paymentIntentId: row.paymentIntentId!,
        stripeAccountId: account?.stripeAccountId ?? null,
        idempotencyKey: refundProviderKey(allocation!.id),
        requestedBy: input.actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(reservationRefundEvents).values({
      refundId: refund!.id,
      reservationId: input.reservationId,
      fromStatus: null,
      toStatus: 'requested',
      actor: input.actor,
      note: `§24.8 case recorded: ${input.cause}, affiliate ${input.affiliateTreatment}, fee ${input.proovdFeeTreatment}`,
      occurredAt: now,
    });

    return { refund: refund!, allocation: allocation! };
  });

  await deps.audit({
    action: 'refund.case_recorded',
    targetType: 'reservation',
    targetId: input.reservationId,
    internalReason:
      `§24.8 refund case ${inserted.refund.reference}: cause ${input.cause}, ` +
      `US$${(Number(input.amountCents) / 100).toFixed(2)}, affiliate ${input.affiliateTreatment}` +
      `${input.affiliateInvalidCents ? ` (invalid US$${(Number(input.affiliateInvalidCents) / 100).toFixed(2)})` : ''}, ` +
      `Proovd fee ${input.proovdFeeTreatment}, Founder liability ` +
      `US$${(Number(input.founderLiabilityCents) / 100).toFixed(2)}` +
      (row.campaignType === 'pre_build' ? `, §24.9 exception ${input.ideaExceptionReason}` : '') +
      (recordOnly ? `; recorded against provider refund ${input.providerRefundId}` : ''),
    newValue: {
      refundId: inserted.refund.id,
      allocationId: inserted.allocation.id,
      earningsPhase: phase,
    },
    actorId: input.actor,
  });

  if (!recordOnly) return { status: 'recorded', ...inserted };

  // §24.10's record-only path: the Founder already moved the money at the
  // provider; the lifecycle is walked, no provider call is made, and only the
  // completed notice sends — the provider told the Backer nothing started.
  const submitted = await applyRefundSubmission(deps, inserted.refund, {
    providerRefundId: input.providerRefundId!,
    providerStatus: 'succeeded',
    actor: input.actor,
    now,
    notifyStarted: false,
  });
  await applyRefundSuccess(deps, submitted?.id ?? inserted.refund.id, {
    actor: input.actor,
    now,
  });

  const [fresh] = await deps.db
    .select()
    .from(reservationRefunds)
    .where(eq(reservationRefunds.id, inserted.refund.id))
    .limit(1);
  return { status: 'recorded', refund: fresh ?? inserted.refund, allocation: inserted.allocation };
}

/* ── The §26.6 customer-consequence preview ────────────────────────────────── */

export interface RefundPreviewLine {
  audience: 'backer' | 'founder' | 'creator' | 'nobody';
  text: string;
}

export type RefundPreviewOutcome =
  | { ok: true; previewId: string; consequences: RefundPreviewLine[]; expiresAt: string }
  | { ok: false; reason: string };

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export async function previewRefundExecution(
  db: Database,
  input: { refundId: string; issuedBy: string; now?: Date },
): Promise<RefundPreviewOutcome> {
  const now = input.now ?? new Date();
  const [found] = await db
    .select({
      refund: reservationRefunds,
      allocation: refundCauseAllocations,
    })
    .from(reservationRefunds)
    .innerJoin(
      refundCauseAllocations,
      eq(refundCauseAllocations.id, reservationRefunds.allocationId),
    )
    .where(eq(reservationRefunds.id, input.refundId))
    .limit(1);
  if (!found) return { ok: false, reason: 'not_found' };
  if (found.refund.status === 'succeeded') return { ok: false, reason: 'already_succeeded' };

  const amount = (Number(found.refund.amountCents) / 100).toFixed(2);
  const consequences: RefundPreviewLine[] = [
    {
      audience: 'backer',
      text:
        `US$${amount} returns to the Backer's original payment method, with the Appendix B.6 ` +
        'notice (amount, start date, typical bank timing as a range — never a promised date).',
    },
    {
      audience: 'founder',
      text:
        `The recorded Founder liability for this case is US$${(
          Number(found.allocation.founderLiabilityCents) / 100
        ).toFixed(2)}; it reduces the §22.3 eligible share the payment schedule reads.`,
    },
    {
      audience: 'creator',
      text:
        found.allocation.affiliateTreatment === 'earnings_remain'
          ? 'Finalized valid Creator earnings remain untouched (§24.8).'
          : found.allocation.affiliateTreatment === 'not_attributed'
            ? 'No Creator is attributed to this charge; no Creator money is affected.'
            : found.allocation.affiliateTreatment === 'cancel_unfinalized'
              ? 'The refunded transaction’s unfinalized earnings will cancel at finalization; other transactions are untouched.'
              : `Invalid Creator earnings of US$${(
                  Number(found.allocation.affiliateInvalidCents ?? 0n) / 100
                ).toFixed(2)} are canceled or recovered — only the invalid amount (§33.9.4).`,
    },
    {
      audience: 'nobody',
      text: `Recorded change: refund ${found.refund.reference} executes for US$${amount} under cause ${found.allocation.cause}.`,
    },
  ];

  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  const [preview] = await db
    .insert(highImpactActionPreviews)
    .values({
      actionKey: REFUND_EXECUTE_ACTION_KEY,
      targetType: 'reservation_refund',
      targetId: found.refund.id,
      consequences,
      payloadHash: refundPayloadHash(found.refund.id, found.refund.amountCents),
      issuedBy: input.issuedBy,
      issuedAt: now,
      expiresAt,
    })
    .returning({ id: highImpactActionPreviews.id });

  return {
    ok: true,
    previewId: preview!.id,
    consequences,
    expiresAt: expiresAt.toISOString(),
  };
}

/* ── Executing the refund ──────────────────────────────────────────────────── */

export type ExecuteRefundOutcome =
  | { status: 'succeeded'; refund: ReservationRefund }
  | { status: 'submitted'; refund: ReservationRefund }
  | { status: 'failed'; message: string }
  | { status: 'already_succeeded' }
  | { status: 'refused'; reason: string };

export async function executeRefund(
  deps: RefundDeps,
  input: { refundId: string; previewId: string | null; actor: string; now?: Date },
): Promise<ExecuteRefundOutcome> {
  const now = input.now ?? new Date();

  const [refund] = await deps.db
    .select()
    .from(reservationRefunds)
    .where(eq(reservationRefunds.id, input.refundId))
    .limit(1);
  if (!refund) return { status: 'refused', reason: 'not_found' };
  // A replay after success changes nothing and needs no fresh preview (§28.3).
  if (refund.status === 'succeeded') return { status: 'already_succeeded' };

  // No live-mode guard here, and that is the decision rather than an omission.
  // §34's blocked list is six things that create exposure and a refund is not
  // among them; a refund is only reachable from a charge that already
  // happened, which is the state a rollback leaves behind. Refusing here would
  // mean a closed gate stranding the Backer who is owed money back — see the
  // partition in `shared/src/live-mode`.

  // §26.6: the consequences the Admin read must be THIS execution's, read
  // before it runs, consumed exactly once — 16a's machine, same table.
  if (!input.previewId) return { status: 'refused', reason: 'preview_required' };
  const previewProblem = await deps.db.transaction(async (tx) => {
    const [preview] = await tx
      .select()
      .from(highImpactActionPreviews)
      .where(eq(highImpactActionPreviews.id, input.previewId!))
      .for('update')
      .limit(1);
    if (!preview) return 'preview_required';
    if (preview.consumedAt) return 'preview_consumed';
    if (preview.expiresAt.getTime() <= now.getTime()) return 'preview_expired';
    if (
      preview.actionKey !== REFUND_EXECUTE_ACTION_KEY ||
      preview.targetId !== refund.id ||
      preview.payloadHash !== refundPayloadHash(refund.id, refund.amountCents)
    ) {
      return 'preview_mismatch';
    }
    // The 0024 CHECK requires the consumer's name with the consumption.
    await tx
      .update(highImpactActionPreviews)
      .set({ consumedAt: now, consumedBy: input.actor })
      .where(eq(highImpactActionPreviews.id, preview.id));
    return null;
  });
  if (previewProblem) return { status: 'refused', reason: previewProblem };

  // The row was claimed at recording; the key is stable; the call is the same
  // refund at Stripe however many times a crash retries it (§28.3).
  let providerResult: { id: string; status: string };
  try {
    providerResult = await deps.gateway.createRefund({
      paymentIntentId: refund.paymentIntentId,
      amountCents: refund.amountCents,
      idempotencyKey: refund.idempotencyKey,
      connectedAccountId: refund.stripeAccountId ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await applyRefundFailure(deps, refund, { message, actor: input.actor, now });
    return { status: 'failed', message };
  }

  const submitted = await applyRefundSubmission(deps, refund, {
    providerRefundId: providerResult.id,
    providerStatus: providerResult.status,
    actor: input.actor,
    now,
    notifyStarted: true,
  });

  if (providerResult.status === 'succeeded') {
    await applyRefundSuccess(deps, refund.id, { actor: input.actor, now });
    const [fresh] = await deps.db
      .select()
      .from(reservationRefunds)
      .where(eq(reservationRefunds.id, refund.id))
      .limit(1);
    return { status: 'succeeded', refund: fresh! };
  }

  return { status: 'submitted', refund: submitted ?? refund };
}

/* ── The appliers — the webhook and the execute path share them ────────────── */

async function applyRefundSubmission(
  deps: RefundDeps,
  refund: ReservationRefund,
  input: {
    providerRefundId: string;
    providerStatus: string;
    actor: string;
    now: Date;
    notifyStarted: boolean;
  },
): Promise<ReservationRefund | null> {
  const moved = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(reservationRefunds)
      .set({
        status: 'submitted',
        providerRefundId: input.providerRefundId,
        submittedAt: input.now,
        executedBy: input.actor,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(reservationRefunds.id, refund.id),
          inArray(reservationRefunds.status, ['requested', 'failed']),
        ),
      )
      .returning();
    if (rows.length !== 1) return null;
    await tx.insert(reservationRefundEvents).values({
      refundId: refund.id,
      reservationId: refund.reservationId,
      fromStatus: refund.status,
      toStatus: 'submitted',
      actor: input.actor,
      note: `provider refund ${input.providerRefundId} created (${input.providerStatus})`,
      occurredAt: input.now,
    });
    return rows[0]!;
  });
  if (!moved) return null;

  // §32.4: the Refund object, recorded with its account context.
  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'refund',
    providerObjectId: input.providerRefundId,
    accountContext: refund.stripeAccountId ? 'connected' : 'platform',
    stripeAccountId: refund.stripeAccountId,
    campaignId: refund.campaignId,
    reservationId: refund.reservationId,
    amountCents: refund.amountCents,
    status: input.providerStatus,
    idempotencyKey: refund.idempotencyKey,
  });

  if (input.notifyStarted && deps.notifier && deps.context) {
    await notifyRefundState(
      { db: deps.db, notifier: deps.notifier, context: deps.context, tokens: deps.tokens },
      { refund: moved, status: 'submitted' },
    );
  }
  return moved;
}

async function applyRefundFailure(
  deps: RefundDeps,
  refund: ReservationRefund,
  input: { message: string; actor: string; now: Date },
): Promise<void> {
  const wasSubmitted = refund.status === 'submitted';
  await deps.db.transaction(async (tx) => {
    if (refund.status === 'failed') {
      // A retried failure updates the message; the state already says failed.
      await tx
        .update(reservationRefunds)
        .set({ failureMessage: input.message, failedAt: input.now, updatedAt: input.now })
        .where(eq(reservationRefunds.id, refund.id));
      return;
    }
    const rows = await tx
      .update(reservationRefunds)
      .set({
        status: 'failed',
        failureMessage: input.message,
        failedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(reservationRefunds.id, refund.id),
          inArray(reservationRefunds.status, ['requested', 'submitted']),
        ),
      )
      .returning();
    if (rows.length !== 1) return;
    await tx.insert(reservationRefundEvents).values({
      refundId: refund.id,
      reservationId: refund.reservationId,
      fromStatus: refund.status,
      toStatus: 'failed',
      actor: input.actor,
      note: input.message,
      occurredAt: input.now,
    });
  });

  await deps.audit({
    action: 'refund.failed',
    targetType: 'reservation',
    targetId: refund.reservationId,
    // §25.6/§33.9.11: the provider's words stay in the internal record.
    internalReason: `refund ${refund.reference} failed at the provider: ${input.message}`,
    actorId: input.actor,
  });

  // §27.5: a failure is announced only when a start was (submitted → failed).
  if (wasSubmitted && deps.notifier && deps.context) {
    const [fresh] = await deps.db
      .select()
      .from(reservationRefunds)
      .where(eq(reservationRefunds.id, refund.id))
      .limit(1);
    if (fresh?.status === 'failed') {
      await notifyRefundState(
        { db: deps.db, notifier: deps.notifier, context: deps.context, tokens: deps.tokens },
        { refund: fresh, status: 'failed' },
      );
    }
  }
}

export interface ApplyRefundSuccessOutcome {
  applied: boolean;
  reservationFullyRefunded: boolean;
}

/**
 * Confirms a refund succeeded — from the synchronous provider answer or from a
 * `charge.refunded` delivery, whichever arrives first; the other finds the
 * conditional UPDATE matched nothing and changes nothing (§33.7.7's shape).
 *
 * A fully-refunded reservation moves `captured → refunded` (§23.5) with its
 * history row, and the Founder's operational record flips to do-not-fulfill.
 * The cause's post-finalization Affiliate treatment executes here, where the
 * money fact exists — through the ONE earnings state machine (§24.8, §33.9.4).
 */
export async function applyRefundSuccess(
  deps: RefundDeps,
  refundId: string,
  input: { actor: string; now: Date; providerEventId?: string | null },
): Promise<ApplyRefundSuccessOutcome> {
  const result = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(reservationRefunds)
      .set({ status: 'succeeded', succeededAt: input.now, updatedAt: input.now })
      .where(and(eq(reservationRefunds.id, refundId), eq(reservationRefunds.status, 'submitted')))
      .returning();
    if (rows.length !== 1) return null;
    const refund = rows[0]!;

    await tx.insert(reservationRefundEvents).values({
      refundId: refund.id,
      reservationId: refund.reservationId,
      fromStatus: 'submitted',
      toStatus: 'succeeded',
      actor: input.actor,
      note: input.providerEventId
        ? `confirmed by provider event ${input.providerEventId}`
        : 'confirmed synchronously by the provider',
      occurredAt: input.now,
    });

    // Fully refunded? The reservation's own state answers §26.5's
    // refund/dispute dimension, so it moves only on the whole amount.
    const [reservation] = await tx
      .select({
        id: reservations.id,
        status: sql<string>`${reservations.status}::text`,
        totalCapturedCents: reservations.totalCapturedCents,
      })
      .from(reservations)
      .where(eq(reservations.id, refund.reservationId))
      .limit(1);
    const [succeededTotal] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${reservationRefunds.amountCents}), 0)` })
      .from(reservationRefunds)
      .where(
        and(
          eq(reservationRefunds.reservationId, refund.reservationId),
          eq(reservationRefunds.status, 'succeeded'),
        ),
      );
    const fullyRefunded =
      reservation !== undefined &&
      (reservation.totalCapturedCents ?? 0n) > 0n &&
      BigInt(succeededTotal?.total ?? '0') >= (reservation.totalCapturedCents ?? 0n);

    if (fullyRefunded && reservation.status === 'captured') {
      await tx
        .update(reservations)
        .set({ status: 'refunded', updatedAt: input.now })
        .where(and(eq(reservations.id, reservation.id), eq(sql`${reservations.status}::text`, 'captured')));
      await tx.insert(reservationStatusHistory).values({
        reservationId: reservation.id,
        fromStatus: 'captured',
        toStatus: 'refunded',
        actor: input.actor,
      });
      // A fully-refunded pre-order is not fulfilled (§20's cancellation shape).
      await tx
        .update(founderOperationalShares)
        .set({
          fulfillmentState: 'do_not_fulfill',
          doNotFulfillAt: input.now,
          deliveryStatus: 'do_not_fulfill',
        })
        .where(eq(founderOperationalShares.reservationId, reservation.id));
    }

    return { refund, fullyRefunded };
  });

  if (!result) return { applied: false, reservationFullyRefunded: false };

  // The cause's post-finalization Affiliate consequence — idempotent, through
  // the one earnings machine, only ever the INVALID amount (§33.9.4).
  const [allocation] = await deps.db
    .select()
    .from(refundCauseAllocations)
    .where(eq(refundCauseAllocations.id, result.refund.allocationId))
    .limit(1);
  if (
    allocation &&
    (allocation.affiliateTreatment === 'cancel_unpaid_invalid' ||
      allocation.affiliateTreatment === 'contractual_recovery')
  ) {
    const [reservation] = await deps.db
      .select({ attributionAssociationId: reservations.attributionAssociationId })
      .from(reservations)
      .where(eq(reservations.id, result.refund.reservationId))
      .limit(1);
    if (reservation?.attributionAssociationId) {
      await applyCauseBasedAffiliateAdjustment(
        { db: deps.db, gateway: deps.gateway, audit: deps.audit },
        {
          associationId: reservation.attributionAssociationId,
          campaignId: result.refund.campaignId,
          treatment: allocation.affiliateTreatment,
          invalidCents: allocation.affiliateInvalidCents ?? 0n,
          allocationId: allocation.id,
          reason: `refund ${result.refund.reference}: ${allocation.cause}`,
          actor: input.actor,
          now: input.now,
        },
      );
    }
  }

  await deps.audit({
    action: 'refund.succeeded',
    targetType: 'reservation',
    targetId: result.refund.reservationId,
    internalReason:
      `refund ${result.refund.reference} succeeded for US$${(
        Number(result.refund.amountCents) / 100
      ).toFixed(2)}${result.fullyRefunded ? '; reservation fully refunded (§23.5)' : ' (partial)'}`,
    newValue: { refundId: result.refund.id, providerRefundId: result.refund.providerRefundId },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyRefundState(
      { db: deps.db, notifier: deps.notifier, context: deps.context, tokens: deps.tokens },
      { refund: result.refund, status: 'succeeded' },
    );
  }

  return { applied: true, reservationFullyRefunded: result.fullyRefunded };
}

/* ── The `charge.refunded` deliveries (§32.3) ──────────────────────────────── */

/**
 * A Connect `charge.refunded` either confirms a refund Proovd recorded — by
 * its provider refund id — or reports one the Founder issued at the provider
 * (§24.10: the Founder as MoR can). The latter is recorded under §32.4 and
 * routed to Admin for classification; nothing is guessed into place
 * (§1 rule 6). The refund queue surfaces it until an Admin records its case.
 */
export async function applyConnectChargeRefunded(
  deps: RefundDeps,
  event: {
    id: string;
    object: Record<string, unknown>;
    account: string | null;
  },
): Promise<void> {
  const object = event.object;
  const chargeId = typeof object['id'] === 'string' ? object['id'] : null;
  const paymentIntentId =
    typeof object['payment_intent'] === 'string' ? object['payment_intent'] : null;
  const refundsBlock = object['refunds'] as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  const providerRefunds = (refundsBlock?.data ?? []).filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  );

  let confirmed = 0;
  const unmatched: string[] = [];

  for (const providerRefund of providerRefunds) {
    const refundId = typeof providerRefund['id'] === 'string' ? providerRefund['id'] : null;
    if (!refundId) continue;
    const status = typeof providerRefund['status'] === 'string' ? providerRefund['status'] : null;

    const [known] = await deps.db
      .select()
      .from(reservationRefunds)
      .where(eq(reservationRefunds.providerRefundId, refundId))
      .limit(1);

    if (known) {
      if (status === 'succeeded' || status === null) {
        const applied = await applyRefundSuccess(deps, known.id, {
          actor: 'system:stripe-webhook',
          now: new Date(),
          providerEventId: event.id,
        });
        if (applied.applied) confirmed += 1;
      } else if (status === 'failed') {
        await applyRefundFailure(deps, known, {
          message: `provider refund ${refundId} reported failed`,
          actor: 'system:stripe-webhook',
          now: new Date(),
        });
      }
      continue;
    }

    unmatched.push(refundId);
    // §32.4: record the object; §1 rule 6: route to Admin, never guess.
    const [reservation] = paymentIntentId
      ? await deps.db
          .select({ id: reservations.id, campaignId: reservations.campaignId })
          .from(reservations)
          .where(eq(reservations.paymentIntentId, paymentIntentId))
          .limit(1)
      : [undefined];
    await recordProviderObject(deps.db, {
      mode: deps.gateway.mode,
      objectType: 'refund',
      providerObjectId: refundId,
      accountContext: 'connected',
      stripeAccountId: event.account,
      campaignId: reservation?.campaignId ?? null,
      reservationId: reservation?.id ?? null,
      amountCents:
        typeof providerRefund['amount'] === 'number' ? BigInt(providerRefund['amount']) : null,
      status: status ?? 'unknown',
    });
    await deps.audit({
      action: 'refund.unreconciled',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason:
        `charge.refunded for ${chargeId ?? 'unknown charge'} carries refund ${refundId} that ` +
        'Proovd did not create — recorded under §32.4 and routed to Admin for a §24.8 ' +
        'classification; nothing was applied (§1 rule 6).',
    });
  }

  if (confirmed === 0 && unmatched.length === 0 && providerRefunds.length === 0) {
    await deps.audit({
      action: 'refund.delivery_empty',
      targetType: 'provider_event',
      targetId: event.id,
      internalReason: `charge.refunded for ${chargeId ?? 'unknown charge'} carried no refund objects; recorded, applied to nothing`,
    });
  }
}

/**
 * A platform `charge.refunded` belongs to the listing stream — Phase 11
 * confirms its refund synchronously, so this delivery reconciles rather than
 * applies. An unknown platform refund is recorded and routed to Admin.
 */
export async function applyPlatformChargeRefunded(
  deps: RefundDeps,
  event: { id: string; object: Record<string, unknown> },
): Promise<void> {
  const object = event.object;
  const refundsBlock = object['refunds'] as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  const ids = (refundsBlock?.data ?? [])
    .map((r) => (typeof r?.['id'] === 'string' ? (r['id'] as string) : null))
    .filter((id): id is string => Boolean(id));

  for (const refundId of ids) {
    const [known] = await deps.db
      .select({ id: listingFeeRefunds.id, status: listingFeeRefunds.status })
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.refundObjectId, refundId))
      .limit(1);
    if (known) {
      await deps.audit({
        action: 'refund.listing_reconciled',
        targetType: 'provider_event',
        targetId: event.id,
        internalReason: `charge.refunded reconciles to listing refund ${known.id} (${known.status}); no domain work — Phase 11 confirmed it synchronously`,
      });
    } else {
      await deps.audit({
        action: 'refund.unreconciled',
        targetType: 'provider_event',
        targetId: event.id,
        internalReason: `platform charge.refunded carries refund ${refundId} with no listing refund row — recorded and routed to Admin (§1 rule 6)`,
      });
    }
  }
}

/* ── The Admin queue read (§26.7) ──────────────────────────────────────────── */

export interface RefundQueueCase {
  refundId: string;
  reference: string;
  reservationId: string;
  campaignId: string;
  status: string;
  amountCents: string;
  ideaExceptionReason: string | null;
  cause: string;
  affiliateTreatment: string;
  proovdFeeTreatment: string;
  affiliateInvalidCents: string | null;
  founderLiabilityCents: string;
  evidence: string;
  mandate: string | null;
  recoveryNote: string | null;
  decidedBy: string;
  failureMessage: string | null;
  providerRefundId: string | null;
  createdAt: string;
}

export interface UnreconciledProviderRefund {
  providerRefundId: string;
  reservationId: string | null;
  campaignId: string | null;
  amountCents: string | null;
  status: string | null;
  recordedAt: string;
}

export interface RefundQueue {
  cases: RefundQueueCase[];
  /** Founder-issued provider refunds awaiting a §24.8 classification. */
  unreconciled: UnreconciledProviderRefund[];
  /** §24.9's honesty, rendered wherever recovery is discussed. */
  bestEffortRecovery: string;
}

export async function readRefundQueue(
  db: Database,
  input: { campaignId?: string | undefined } = {},
): Promise<RefundQueue> {
  const caseRows = await db
    .select({
      refund: reservationRefunds,
      allocation: refundCauseAllocations,
    })
    .from(reservationRefunds)
    .innerJoin(
      refundCauseAllocations,
      eq(refundCauseAllocations.id, reservationRefunds.allocationId),
    )
    .where(
      input.campaignId ? eq(reservationRefunds.campaignId, input.campaignId) : undefined,
    )
    .orderBy(desc(reservationRefunds.createdAt))
    .limit(200);

  const knownProviderIds = caseRows
    .map((r) => r.refund.providerRefundId)
    .filter((id): id is string => Boolean(id));

  const unreconciledRows = await db
    .select({
      providerObjectId: providerObjects.providerObjectId,
      reservationId: providerObjects.reservationId,
      campaignId: providerObjects.campaignId,
      amountCents: providerObjects.amountCents,
      status: providerObjects.status,
      createdAt: providerObjects.createdAt,
    })
    .from(providerObjects)
    .where(
      and(
        eq(sql`${providerObjects.objectType}::text`, 'refund'),
        eq(providerObjects.accountContext, 'connected'),
        knownProviderIds.length > 0
          ? notInArray(providerObjects.providerObjectId, knownProviderIds)
          : undefined,
        input.campaignId ? eq(providerObjects.campaignId, input.campaignId) : undefined,
      ),
    )
    .orderBy(desc(providerObjects.createdAt))
    .limit(100);

  // A record-only case created after the delivery reconciles it; re-check.
  const stillUnreconciled: UnreconciledProviderRefund[] = [];
  for (const row of unreconciledRows) {
    const [matched] = await db
      .select({ id: reservationRefunds.id })
      .from(reservationRefunds)
      .where(eq(reservationRefunds.providerRefundId, row.providerObjectId))
      .limit(1);
    if (matched) continue;
    stillUnreconciled.push({
      providerRefundId: row.providerObjectId,
      reservationId: row.reservationId,
      campaignId: row.campaignId,
      amountCents: row.amountCents?.toString() ?? null,
      status: row.status,
      recordedAt: row.createdAt.toISOString(),
    });
  }

  return {
    cases: caseRows.map(({ refund, allocation }) => ({
      refundId: refund.id,
      reference: refund.reference,
      reservationId: refund.reservationId,
      campaignId: refund.campaignId,
      status: refund.status,
      amountCents: refund.amountCents.toString(),
      ideaExceptionReason: refund.ideaExceptionReason,
      cause: allocation.cause,
      affiliateTreatment: allocation.affiliateTreatment,
      proovdFeeTreatment: allocation.proovdFeeTreatment,
      affiliateInvalidCents: allocation.affiliateInvalidCents?.toString() ?? null,
      founderLiabilityCents: allocation.founderLiabilityCents.toString(),
      evidence: allocation.evidence,
      mandate: allocation.mandate,
      recoveryNote: allocation.recoveryNote,
      decidedBy: allocation.decidedBy,
      failureMessage: refund.failureMessage,
      providerRefundId: refund.providerRefundId,
      createdAt: refund.createdAt.toISOString(),
    })),
    unreconciled: stillUnreconciled,
    bestEffortRecovery: BEST_EFFORT_RECOVERY_SENTENCE,
  };
}
