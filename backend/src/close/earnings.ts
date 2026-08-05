/**
 * Creator completion, earnings finalization, the one Transfer, and the
 * discretionary thank-you — Spec §22.1, §22.2, §24.4, §33.8 (Phase 19a).
 *
 * ── The order of operations is §22.1's own ──────────────────────────────────
 * After the retry window: Admin records the completion decision (the four-case
 * register plus the recorded waiver); finalization computes the earned
 * percentage from the ledger and resolves the §24.4 provisional liability into
 * earned + returned, once, at both ledger levels; a named Admin approves; the
 * ONE Transfer — finalized commission + earned bonus + eligible fixed amount —
 * is created on or after Day 3 under a stable idempotency key claimed BEFORE
 * the provider call. Every gate refuses by name.
 *
 * ── §24.4: the provisional amount was never Proovd revenue ──────────────────
 * Under the approved direct-charge configuration the campaign charge lands
 * whole on the Founder's connected account and no platform-side fee was
 * debited at capture (§24.1's "where supported" is not yet enabled) — so the
 * unearned remainder is already WITH the Founder, and the return is the ledger
 * resolution of the liability: `affiliate_unearned_returned_cents` written
 * once at both levels, with no provider debit to reverse. The identity
 * `earned + returned = provisional` is a CHECK on the finalization row and the
 * comparison the §26.6 panel performs. If the approved production model later
 * collects the platform-side fee, the return gains a provider leg through the
 * application-fee refund path — the ledger contract here does not change.
 *
 * ── §33.8.4: a Transfer creation failure is synchronous ─────────────────────
 * There is no `transfer.failed` webhook (§32.3). The transfer row is claimed
 * `initiated` before the call; a synchronous error records `failed` and the
 * sweep retries under the SAME provider key, so the retry is the same Transfer
 * at Stripe. A `created` row is immutable by trigger.
 */

import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  reservations,
} from '../db/schema/domain.js';
import {
  creatorCompletionDecisions,
  creatorEarnings,
  creatorEarningsStateHistory,
  affiliateTransfers,
  contractualRecoveryRecords,
  thankYouRecords,
  type CreatorCompletionDecision,
  type CreatorEarnings,
  type AffiliateTransfer,
  type ThankYouRecord,
} from '../db/schema/earnings.js';
import { creatorPaymentAllocations, creatorPaymentFundingAttempts } from '../db/schema/creator-payment.js';
import { refundCauseAllocations } from '../db/schema/refunds.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { associationCompensationAgreements, creatorBonuses } from '../db/schema/decisions.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { listingFeePayments, listingFeeRefunds, campaignCancellations } from '../db/schema/listing.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { readTransferGate } from '../payments/tax-accountability.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import { campaignEnforcementHold } from '../support/enforcement-hold.js';
import { readSettingValue } from '../settings/service.js';
import { creatorPaymentKeys } from '../creator-payment/allocations.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { dayAfterClose } from './creator-close.js';
import {
  completionConsequence,
  bonusTriggered,
  earnedPercentFor,
  finalizeEarningsRows,
  transferTotalCents,
  canMoveEarningsState,
  findCompletionOutcome,
  TRANSFER_EARLIEST_DAY,
  THANK_YOU_FUNDING_SOURCE,
  type CompletionOutcomeKey,
  type ThankYouKind,
} from './earnings-logic.js';
import type { EarningsState } from '../campaign/editing-logic.js';
import {
  notifyCompletionDecision,
  notifyCommissionFinalized,
  notifyTransferCreated,
  notifyTransferFailure,
  notifyPayout,
} from './earnings-notifications.js';

/* ── Keys ──────────────────────────────────────────────────────────────────── */

/** The stable per-association Transfer key (§33.8.4). One association, one
    Transfer, one key — a retry is the same Transfer at Stripe. */
export function earningsTransferKey(associationId: string): string {
  return `affiliate-transfer:${associationId}`;
}

/** The §22.2 thank-you payment's stable key — same posture, separate stream. */
export function thankYouPaymentKey(associationId: string): string {
  return `thank-you-payment:${associationId}`;
}

/**
 * §22.1 runs "after the retry window": these are the campaign states in which
 * completion, finalization, and the Transfer may proceed. `ended_no_charge`
 * belongs here because §22.1's third case owes the full fixed amount even when
 * sales were zero — a threshold miss does not erase completed work (§33.8.7).
 */
export const CLOSED_FOR_EARNINGS = [
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
] as const;

export interface EarningsDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** Absent (some tests) → state still moves, nothing sends. */
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

interface AssociationContext {
  associationId: string;
  campaignId: string;
  /** The Creator's ACCOUNT id — `affiliate_signup_profiles.claimed_user_id`,
      the identity the recipient connected account is keyed to (§11). The
      association's own `affiliate_id` column holds the §8 prospect id. */
  affiliateId: string | null;
  associationStatus: string;
  campaignStatus: string;
  closeAt: Date | null;
}

async function loadAssociationContext(
  db: Database,
  associationId: string,
): Promise<AssociationContext | null> {
  const [row] = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      affiliateId: affiliateSignupProfiles.claimedUserId,
      associationStatus: sql<string>`${campaignAffiliateAssociations.status}::text`,
      campaignStatus: sql<string>`${campaigns.status}::text`,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  return row ?? null;
}

async function moveEarningsState(
  tx: Pick<Database, 'update' | 'insert' | 'select'>,
  earnings: { id: string; associationId: string; state: string },
  to: EarningsState,
  actor: string,
  reason: string | null,
  now: Date,
  extra: Partial<typeof creatorEarnings.$inferInsert> = {},
): Promise<boolean> {
  const from = earnings.state as EarningsState;
  if (!canMoveEarningsState(from, to)) return false;
  const moved = await tx
    .update(creatorEarnings)
    .set({ state: to, updatedAt: now, ...extra })
    .where(and(eq(creatorEarnings.id, earnings.id), eq(creatorEarnings.state, from)))
    .returning({ id: creatorEarnings.id });
  if (moved.length !== 1) return false;
  await tx.insert(creatorEarningsStateHistory).values({
    earningsId: earnings.id,
    associationId: earnings.associationId,
    fromState: from,
    toState: to,
    actor,
    reason,
    occurredAt: now,
  });
  return true;
}

/* ── §22.1: the completion decision ────────────────────────────────────────── */

export type CompletionDecisionOutcome =
  | { status: 'recorded'; decision: CreatorCompletionDecision; fixedAction: string }
  | { status: 'already_decided'; decision: CreatorCompletionDecision }
  | { status: 'not_closed'; current: string }
  | { status: 'waiver_incomplete' }
  | { status: 'not_found' };

/**
 * Records one §22.1 deliverable verification and applies its fixed-payment
 * consequence. Append-only: a NEW outcome is a new row and the earlier answer
 * survives; the SAME outcome again is refused, which is what makes a
 * double-submitted form safe without making history rewritable.
 */
export async function recordCompletionDecision(
  deps: EarningsDeps,
  input: {
    associationId: string;
    outcome: CompletionOutcomeKey;
    deliverablesNote: string;
    waiver?: string | undefined;
    waiverAgreedByFounder?: boolean | undefined;
    waiverAgreedByAdmin?: boolean | undefined;
    evidence?: Record<string, unknown> | undefined;
    actor: string;
    now?: Date;
  },
): Promise<CompletionDecisionOutcome> {
  const now = input.now ?? new Date();
  findCompletionOutcome(input.outcome);

  const context = await loadAssociationContext(deps.db, input.associationId);
  if (!context) return { status: 'not_found' };
  if (!(CLOSED_FOR_EARNINGS as readonly string[]).includes(context.campaignStatus)) {
    // §22.1: "After the retry window" — a decision recorded while charges can
    // still move would verify deliverables against a moving ledger.
    return { status: 'not_closed', current: context.campaignStatus };
  }

  // §22.1: a waiver is valid only when Founder AND Admin agreed. The CHECK
  // refuses the row anyway; refusing here names the missing half (§27.1).
  if (input.waiver && !(input.waiverAgreedByFounder && input.waiverAgreedByAdmin)) {
    return { status: 'waiver_incomplete' };
  }

  const [latest] = await deps.db
    .select()
    .from(creatorCompletionDecisions)
    .where(eq(creatorCompletionDecisions.associationId, input.associationId))
    .orderBy(sql`${creatorCompletionDecisions.decidedAt} DESC`)
    .limit(1);
  if (latest && latest.outcome === input.outcome) {
    return { status: 'already_decided', decision: latest };
  }

  const [decision] = await deps.db
    .insert(creatorCompletionDecisions)
    .values({
      associationId: input.associationId,
      campaignId: context.campaignId,
      outcome: input.outcome,
      deliverablesNote: input.deliverablesNote,
      waiver: input.waiver ?? null,
      waiverAgreedByFounder: Boolean(input.waiver && input.waiverAgreedByFounder),
      waiverAgreedByAdmin: Boolean(input.waiver && input.waiverAgreedByAdmin),
      evidence: input.evidence ?? null,
      decidedBy: input.actor,
      decidedAt: now,
    })
    .returning();

  // The fixed-payment consequence (§22.1's table, §33.8.5–7).
  const [allocation] = await deps.db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.associationId, input.associationId))
    .limit(1);
  const consequence = completionConsequence(
    input.outcome,
    Boolean(allocation && allocation.status !== 'not_requested' && !allocation.canceledAt),
  );

  let fixedAction = 'none';
  if (allocation && allocation.status === 'funded') {
    if (consequence.fixed === 'return_full' || consequence.fixed === 'cancel_or_recover') {
      // §22.1: return 100% of the allocation to the Founder — the funding
      // charge refunds whole, exactly as it was collected (§24.7's stream).
      const returned = await returnFixedAllocation(deps, {
        allocationId: allocation.id,
        reason: input.outcome,
        actor: input.actor,
        now,
      });
      fixedAction = returned.status === 'returned' || returned.status === 'already_returned'
        ? 'returned_full'
        : `return_${returned.status}`;
    } else if (consequence.fixed === 'eligible_full') {
      fixedAction = 'eligible_full';
    }
  } else if (allocation && allocation.status === 'paid' && input.outcome === 'disqualified') {
    fixedAction = 'recovery_recorded';
  }

  // §22.1's fraud case discovered after finalization or after money moved:
  // the earnings adjust, and a transferred amount gains its recovery record.
  if (input.outcome === 'disqualified') {
    await applyDisqualificationAdjustment(deps, {
      associationId: input.associationId,
      campaignId: context.campaignId,
      reason: input.deliverablesNote,
      actor: input.actor,
      now,
    });
  }

  await deps.audit({
    action: 'earnings.completion_decided',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.1 completion decision ${input.outcome}: ${input.deliverablesNote}${input.waiver ? `; waiver recorded with both agreements` : ''}`,
    newValue: { outcome: input.outcome, fixedAction, decisionId: decision!.id },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyCompletionDecision(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { decision: decision!, fixedAction },
    );
  }

  return { status: 'recorded', decision: decision!, fixedAction };
}

/* ── §22.1: returning the fixed allocation (§33.8.5, §33.8.6, §33.8.8) ─────── */

export type FixedReturnOutcome =
  | { status: 'returned'; refundId: string }
  | { status: 'already_returned' }
  | { status: 'not_returnable'; current: string }
  | { status: 'not_found' };

/**
 * Returns 100% of a funded fixed allocation to the Founder — a full refund of
 * the §24.7 funding charge, claimed under Phase 13's own
 * `creator-payment-return:<allocationId>` key BEFORE the provider call. A
 * crash between claim and confirmation resumes as the SAME refund at Stripe;
 * a `returned` allocation is terminal by trigger, so §33.8.8's "cannot repeat"
 * is the database's answer, not this function's care.
 */
export async function returnFixedAllocation(
  deps: EarningsDeps,
  input: { allocationId: string; reason: string; actor: string; now?: Date },
): Promise<FixedReturnOutcome> {
  const now = input.now ?? new Date();
  const key = creatorPaymentKeys.return(input.allocationId);

  const [allocation] = await deps.db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.id, input.allocationId))
    .limit(1);
  if (!allocation) return { status: 'not_found' };
  if (allocation.status === 'returned') return { status: 'already_returned' };
  if (allocation.status !== 'funded') {
    // A never-funded allocation has nothing to return; a paid one is terminal.
    return { status: 'not_returnable', current: allocation.status };
  }

  // The claim, before the provider call (§33.7.7's shape).
  const claimed = await deps.db
    .insert(idempotencyKeys)
    .values({ key, purpose: 'creator_payment_return' })
    .onConflictDoNothing({ target: idempotencyKeys.key })
    .returning({ id: idempotencyKeys.id });
  if (claimed.length === 0) {
    const [existing] = await deps.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);
    if (existing?.completedAt) return { status: 'already_returned' };
    // An unconfirmed claim: a crash between claim and confirmation. Fall
    // through and re-run under the same provider key — the same refund.
  }

  const [attempt] = await deps.db
    .select()
    .from(creatorPaymentFundingAttempts)
    .where(
      and(
        eq(creatorPaymentFundingAttempts.allocationId, input.allocationId),
        eq(creatorPaymentFundingAttempts.status, 'succeeded'),
      ),
    )
    .limit(1);
  if (!attempt?.paymentIntentId) {
    return { status: 'not_returnable', current: 'no_succeeded_funding_attempt' };
  }

  const refund = await deps.gateway.createRefund({
    paymentIntentId: attempt.paymentIntentId,
    amountCents: allocation.amountCents,
    idempotencyKey: key,
  });

  await deps.db.transaction(async (tx) => {
    const moved = await tx
      .update(creatorPaymentAllocations)
      .set({
        status: 'returned',
        returnEligible: true,
        returnAmountCents: allocation.amountCents,
        returnReason: input.reason,
        returnObjectId: refund.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(creatorPaymentAllocations.id, input.allocationId),
          eq(creatorPaymentAllocations.status, 'funded'),
        ),
      )
      .returning({ id: creatorPaymentAllocations.id });
    if (moved.length === 1) {
      await tx
        .update(idempotencyKeys)
        .set({ completedAt: now, result: { refundId: refund.id } })
        .where(eq(idempotencyKeys.key, key));
    }
  });

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'refund',
    providerObjectId: refund.id,
    accountContext: 'platform',
    campaignId: allocation.campaignId,
    associationId: allocation.associationId,
    amountCents: allocation.amountCents,
    status: refund.status,
    idempotencyKey: key,
  });

  await deps.audit({
    action: 'earnings.fixed_allocation_returned',
    targetType: 'creator_payment_allocation',
    targetId: input.allocationId,
    internalReason: `§22.1 (${input.reason}): 100% of the fixed allocation returned to the Founder as refund ${refund.id} of the funding charge`,
    newValue: { refundId: refund.id, amountCents: allocation.amountCents.toString() },
    actorId: input.actor,
  });

  return { status: 'returned', refundId: refund.id };
}

/* ── §22.1's fraud case after money was recorded or moved ──────────────────── */

async function applyDisqualificationAdjustment(
  deps: EarningsDeps,
  input: { associationId: string; campaignId: string; reason: string; actor: string; now: Date },
): Promise<void> {
  const [earnings] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, input.associationId))
    .limit(1);
  if (!earnings) return; // Nothing finalized yet: finalization will read the decision.

  const [transfer] = await deps.db
    .select()
    .from(affiliateTransfers)
    .where(
      and(
        eq(affiliateTransfers.associationId, input.associationId),
        eq(affiliateTransfers.status, 'created'),
      ),
    )
    .limit(1);

  await deps.db.transaction(async (tx) => {
    const moved = await moveEarningsState(
      tx,
      earnings,
      'adjusted',
      input.actor,
      `§22.1 disqualification: ${input.reason}`,
      input.now,
      { adjustedReason: input.reason, adjustedBy: input.actor, adjustedAt: input.now },
    );
    if (!moved) return;

    if (transfer) {
      // §22.1: "If already transferred, create a negative balance and
      // contractual recovery record." The record IS the negative balance —
      // executing the recovery is a Phase 20 cause-based act.
      await tx
        .insert(contractualRecoveryRecords)
        .values({
          associationId: input.associationId,
          campaignId: input.campaignId,
          earningsId: earnings.id,
          transferId: transfer.id,
          amountCents: transfer.totalCents,
          reason: `§22.1 disqualification after Transfer ${transfer.providerTransferId ?? transfer.id}: ${input.reason}`,
          createdBy: input.actor,
          createdAt: input.now,
        })
        .onConflictDoNothing();
    }
  });

  await deps.audit({
    action: 'earnings.adjusted',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.1 disqualification adjusted finalized earnings${transfer ? `; contractual recovery recorded for transferred US$${(Number(transfer.totalCents) / 100).toFixed(2)}` : '; unpaid amounts canceled'}`,
    newValue: { transferId: transfer?.id ?? null },
    actorId: input.actor,
  });
}

/* ── §24.8's post-finalization Affiliate treatments (Phase 20a) ────────────── */

export type CauseAdjustmentOutcome =
  | { status: 'adjusted'; recoveryRecordId: string | null }
  | { status: 'already_adjusted' }
  | { status: 'not_finalized' };

/**
 * §24.8's two post-finalization Affiliate treatments, applied through the ONE
 * earnings state machine rather than a second writer: `cancel_unpaid_invalid`
 * (finalized, not yet transferred) moves the earnings to `adjusted` with the
 * invalid amount named; `contractual_recovery` (already transferred)
 * additionally records the negative balance — the recovery record IS the
 * negative balance (19a's rule) — carrying ONLY the invalid amount, never the
 * whole Transfer (§33.9.4). The finalized amounts themselves stay immutable by
 * trigger; the adjustment is its own recorded act (§22.1).
 *
 * Idempotent through the conditional state move: `adjusted` is terminal, so a
 * second call finds it and changes nothing.
 */
export async function applyCauseBasedAffiliateAdjustment(
  deps: EarningsDeps,
  input: {
    associationId: string;
    campaignId: string;
    treatment: 'cancel_unpaid_invalid' | 'contractual_recovery';
    invalidCents: bigint;
    /** The §24.8 allocation record this adjustment executes. */
    allocationId: string;
    reason: string;
    actor: string;
    now?: Date;
  },
): Promise<CauseAdjustmentOutcome> {
  const now = input.now ?? new Date();

  const [earnings] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, input.associationId))
    .limit(1);
  if (!earnings) return { status: 'not_finalized' };
  if (earnings.state === 'adjusted') return { status: 'already_adjusted' };

  const [transfer] =
    input.treatment === 'contractual_recovery'
      ? await deps.db
          .select()
          .from(affiliateTransfers)
          .where(
            and(
              eq(affiliateTransfers.associationId, input.associationId),
              eq(affiliateTransfers.status, 'created'),
            ),
          )
          .limit(1)
      : [undefined];

  let recoveryRecordId: string | null = null;
  const moved = await deps.db.transaction(async (tx) => {
    const ok = await moveEarningsState(
      tx,
      earnings,
      'adjusted',
      input.actor,
      `§24.8 ${input.treatment}: ${input.reason}`,
      now,
      { adjustedReason: input.reason, adjustedBy: input.actor, adjustedAt: now },
    );
    if (!ok) return false;

    if (input.treatment === 'contractual_recovery') {
      const [record] = await tx
        .insert(contractualRecoveryRecords)
        .values({
          associationId: input.associationId,
          campaignId: input.campaignId,
          earningsId: earnings.id,
          transferId: transfer?.id ?? null,
          amountCents: input.invalidCents,
          reason: `§24.8 contractual recovery (allocation ${input.allocationId}): ${input.reason}`,
          createdBy: input.actor,
          createdAt: now,
        })
        .returning({ id: contractualRecoveryRecords.id });
      recoveryRecordId = record?.id ?? null;
    }
    return true;
  });
  if (!moved) return { status: 'already_adjusted' };

  await deps.audit({
    action: 'earnings.cause_adjusted',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason:
      `§24.8 ${input.treatment} under allocation ${input.allocationId}: invalid ` +
      `US$${(Number(input.invalidCents) / 100).toFixed(2)}${
        input.treatment === 'contractual_recovery'
          ? ' — negative balance and contractual recovery recorded; execution is best-effort (§24.9)'
          : ' — unpaid invalid amount canceled'
      }`,
    newValue: { allocationId: input.allocationId, recoveryRecordId },
    actorId: input.actor,
  });

  return { status: 'adjusted', recoveryRecordId };
}

/* ── §22.1/§24.4: finalization (§33.8.1, §33.8.2, §33.8.5–7) ───────────────── */

export type FinalizeEarningsOutcome =
  | { status: 'finalized'; earnings: CreatorEarnings }
  | { status: 'already_finalized'; earnings: CreatorEarnings }
  | { status: 'no_completion_decision' }
  | { status: 'no_locked_agreement' }
  | { status: 'not_closed'; current: string }
  | { status: 'not_found' };

/**
 * Finalizes one Creator's earnings from the ledger, exactly once.
 *
 * The one transaction writes: the finalization row (unique per association —
 * §33.8.2's "once" is the index), the bonus's earned result (set-once by
 * trigger), the per-reservation `affiliate_earned_cents` and
 * `affiliate_unearned_returned_cents`, and the same two campaign aggregates —
 * so the §24.4 identity holds at every level the §26.6 panel reads, and a
 * second call finds the row and changes nothing.
 */
export async function finalizeCreatorEarnings(
  deps: EarningsDeps,
  input: { associationId: string; actor: string; now?: Date },
): Promise<FinalizeEarningsOutcome> {
  const now = input.now ?? new Date();

  const context = await loadAssociationContext(deps.db, input.associationId);
  if (!context) return { status: 'not_found' };
  if (!(CLOSED_FOR_EARNINGS as readonly string[]).includes(context.campaignStatus)) {
    return { status: 'not_closed', current: context.campaignStatus };
  }

  const [existing] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, input.associationId))
    .limit(1);
  if (existing) return { status: 'already_finalized', earnings: existing };

  const [decision] = await deps.db
    .select()
    .from(creatorCompletionDecisions)
    .where(eq(creatorCompletionDecisions.associationId, input.associationId))
    .orderBy(sql`${creatorCompletionDecisions.decidedAt} DESC`)
    .limit(1);
  if (!decision) {
    // §22.1's order: Admin verifies deliverables FIRST. Finalizing without the
    // decision would guess the §22.1 outcome (§1 rule 6).
    return { status: 'no_completion_decision' };
  }

  const [agreement] = await deps.db
    .select({
      totalPercent: associationCompensationAgreements.totalPercent,
      fixedPaymentCents: associationCompensationAgreements.fixedPaymentCents,
    })
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, input.associationId))
    .limit(1);
  if (!agreement) return { status: 'no_locked_agreement' };

  const ceilingSetting = await readSettingValue(deps.db, 'affiliate_percentage_ceiling');
  const ceilingPercent = typeof ceilingSetting === 'number' ? ceilingSetting : 50;

  // The ledger rows this Creator's percentages apply to: ever-captured charges
  // attributed to this association — `refunded`/`reversed`/`disputed` are only
  // reachable FROM `captured` (§23.5), and their provisional amounts were
  // written at capture, so dropping them here would leave the campaign's
  // §24.4 identity unresolvable. `validlyAttributed` is the §18 verification
  // result — an unverified or blocked attribution earns nothing and its whole
  // provisional amount returns (§22.1 "validly attributed").
  const rows = await deps.db
    .select({
      id: reservations.id,
      rewardSubtotalCents: reservations.rewardSubtotalCents,
      provisionalCents: reservations.affiliateProvisionalCents,
      attributionStatus: reservations.attributionStatus,
      backerIdentityId: reservations.backerIdentityId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, context.campaignId),
        eq(reservations.attributionAssociationId, input.associationId),
        inArray(sql`${reservations.status}::text`, [
          'captured',
          'refunded',
          'reversed',
          'disputed',
        ]),
      ),
    );

  // §24.8: "unfinalized earnings on the refunded transaction may cancel" — MAY,
  // an Admin decision recorded as the case's allocation, applied here where the
  // money resolves. A canceled row still resolves (earned 0, returned =
  // provisional) so the §24.4 identity holds at every level; an
  // `earnings_remain` decision leaves the row finalizing normally, refund
  // notwithstanding — that cost sits where the cause put it, never with the
  // Creator (§33.9.3).
  const canceledByAllocation = new Set<string>(
    rows.length > 0
      ? (
          await deps.db
            .select({ reservationId: refundCauseAllocations.reservationId })
            .from(refundCauseAllocations)
            .where(
              and(
                inArray(
                  refundCauseAllocations.reservationId,
                  rows.map((r) => r.id),
                ),
                eq(refundCauseAllocations.affiliateTreatment, 'cancel_unfinalized'),
              ),
            )
        ).map((r) => r.reservationId)
      : [],
  );

  const captureRows = rows.map((row) => ({
    reservationId: row.id,
    rewardSubtotalCents: row.rewardSubtotalCents,
    provisionalCents: row.provisionalCents,
    validlyAttributed: row.attributionStatus === 'verified' && !canceledByAllocation.has(row.id),
  }));

  const validBackers = new Set(
    rows
      .filter((r) => r.attributionStatus === 'verified' && !canceledByAllocation.has(r.id))
      .map((r) => r.backerIdentityId),
  );

  const [bonus] = await deps.db
    .select()
    .from(creatorBonuses)
    .where(eq(creatorBonuses.associationId, input.associationId))
    .limit(1);

  const consequence = completionConsequence(decision.outcome as CompletionOutcomeKey, true);

  // §14.3/§22.1: the bonus triggers on THIS Creator's captured, validly
  // attributed results — measured before the percentage is derived, and only
  // when the decision leaves genuine commission standing.
  const validSubtotalCents = captureRows
    .filter((r) => r.validlyAttributed)
    .reduce((sum, r) => sum + r.rewardSubtotalCents, 0n);
  const bonusTerms = bonus
    ? {
        triggerUnit: bonus.triggerUnit,
        threshold: bonus.threshold,
        additionalPercent: bonus.additionalPercent,
        maxCombinedPercent: bonus.maxCombinedPercent,
      }
    : null;
  const triggered =
    consequence.commission === 'genuine' && bonusTerms
      ? bonusTriggered(bonusTerms, {
          validSubtotalCents,
          uniqueBackers: validBackers.size,
        })
      : false;
  const { earnedBonusPercent, earnedPercent } = earnedPercentFor({
    lockedTotalPercent: agreement.totalPercent,
    bonus: bonusTerms,
    bonusTriggered: triggered,
    ceilingPercent,
  });

  const finalization = finalizeEarningsRows({
    commission: consequence.commission,
    earnedPercent,
    lockedTotalPercent: agreement.totalPercent,
    ceilingPercent,
    rows: captureRows,
  });

  // §22.1's fixed component: the full amount is eligible only on
  // `complete_verified` with a FUNDED allocation (§33.8.7); every other
  // outcome either returned it or never had one (§33.8.5, §33.8.6).
  const [allocation] = await deps.db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.associationId, input.associationId))
    .limit(1);
  const eligibleFixedCents =
    consequence.fixed === 'eligible_full' && allocation?.status === 'funded'
      ? allocation.amountCents
      : 0n;

  const inserted = await deps.db.transaction(async (tx) => {
    const [earnings] = await tx
      .insert(creatorEarnings)
      .values({
        associationId: input.associationId,
        campaignId: context.campaignId,
        completionDecisionId: decision.id,
        state: 'finalized',
        validSubtotalCents: finalization.validSubtotalCents,
        attributedUniqueBackers: validBackers.size,
        lockedTotalPercent: agreement.totalPercent,
        earnedBonusPercent,
        earnedPercent,
        commissionCents: finalization.commissionCents,
        bonusCents: finalization.bonusCents,
        eligibleFixedCents,
        provisionalTotalCents: finalization.provisionalTotalCents,
        earnedTotalCents: finalization.earnedTotalCents,
        unearnedReturnedCents: finalization.unearnedReturnedTotalCents,
        finalizedBy: input.actor,
        finalizedAt: now,
      })
      .onConflictDoNothing({ target: creatorEarnings.associationId })
      .returning();
    if (!earnings) return null;

    await tx.insert(creatorEarningsStateHistory).values({
      earningsId: earnings.id,
      associationId: input.associationId,
      fromState: null,
      toState: 'finalized',
      actor: input.actor,
      reason: `§22.1 finalization under completion decision ${decision.outcome}`,
      occurredAt: now,
    });

    // §14.3's earned result, recorded once (the 0017 trigger refuses a second).
    if (bonus && bonus.earnedRecordedAt === null) {
      const measured =
        bonus.triggerUnit === 'attributed_subtotal_cents'
          ? finalization.validSubtotalCents
          : BigInt(validBackers.size);
      await tx
        .update(creatorBonuses)
        .set({
          earnedMeasuredValue: measured,
          earnedPercent: triggered ? bonus.additionalPercent : 0,
          earnedRecordedAt: now,
        })
        .where(and(eq(creatorBonuses.id, bonus.id), isNull(creatorBonuses.earnedRecordedAt)));
    }

    // §24.4 at the reservation level: earned + returned = provisional per row.
    for (const row of finalization.perRow) {
      await tx
        .update(reservations)
        .set({
          affiliateEarnedCents: row.earnedCents,
          affiliateUnearnedReturnedCents: row.unearnedReturnedCents,
          updatedAt: now,
        })
        .where(eq(reservations.id, row.reservationId));
    }

    // The campaign aggregates, same transaction — what §26.6 compares.
    await tx
      .update(campaigns)
      .set({
        affiliateEarnedCents: sql`${campaigns.affiliateEarnedCents} + ${finalization.earnedTotalCents.toString()}`,
        affiliateUnearnedReturnedCents: sql`${campaigns.affiliateUnearnedReturnedCents} + ${finalization.unearnedReturnedTotalCents.toString()}`,
        updatedAt: now,
      })
      .where(eq(campaigns.id, context.campaignId));

    return earnings;
  });

  if (!inserted) {
    const [row] = await deps.db
      .select()
      .from(creatorEarnings)
      .where(eq(creatorEarnings.associationId, input.associationId))
      .limit(1);
    return { status: 'already_finalized', earnings: row! };
  }

  await deps.audit({
    action: 'earnings.finalized',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason:
      `§22.1 finalization: earned ${earnedPercent}% (locked ${agreement.totalPercent}%, bonus ${earnedBonusPercent}%) ` +
      `of validly attributed captured subtotal; commission ${finalization.commissionCents}, bonus ${finalization.bonusCents}, ` +
      `eligible fixed ${eligibleFixedCents}; provisional ${finalization.provisionalTotalCents} resolved as earned ` +
      `${finalization.earnedTotalCents} + returned ${finalization.unearnedReturnedTotalCents} (§24.4, once)`,
    newValue: { earningsId: inserted.id, decisionId: decision.id },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyCommissionFinalized(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { earnings: inserted, closeAt: context.closeAt },
    );
  }

  return { status: 'finalized', earnings: inserted };
}

/* ── §22.1: approval (a named Admin signs the number off) ──────────────────── */

export type ApproveEarningsOutcome =
  | { status: 'approved'; earnings: CreatorEarnings }
  | { status: 'already_approved' }
  | { status: 'nothing_to_transfer' }
  | { status: 'not_finalized'; current: string }
  | { status: 'not_found' };

export async function approveEarningsForTransfer(
  deps: EarningsDeps,
  input: { associationId: string; actor: string; now?: Date },
): Promise<ApproveEarningsOutcome> {
  const now = input.now ?? new Date();
  const [earnings] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, input.associationId))
    .limit(1);
  if (!earnings) return { status: 'not_found' };
  if (earnings.state === 'approved_for_transfer') return { status: 'already_approved' };
  if (earnings.state !== 'finalized') return { status: 'not_finalized', current: earnings.state };

  const total = transferTotalCents({
    commissionCents: earnings.commissionCents,
    bonusCents: earnings.bonusCents,
    eligibleFixedCents: earnings.eligibleFixedCents,
  });
  if (total === 0n) {
    // US$0.00 finalized is a complete, honest terminal — approving a Transfer
    // of nothing would put a promise in the record nothing will honour (§1.4).
    return { status: 'nothing_to_transfer' };
  }

  const applied = await deps.db.transaction(async (tx) =>
    moveEarningsState(tx, earnings, 'approved_for_transfer', input.actor, null, now, {
      approvedBy: input.actor,
      approvedAt: now,
    }),
  );
  if (!applied) return { status: 'not_finalized', current: earnings.state };

  await deps.audit({
    action: 'earnings.approved_for_transfer',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.1: earnings approved for the one Transfer (US$${(Number(total) / 100).toFixed(2)})`,
    newValue: { earningsId: earnings.id },
    actorId: input.actor,
  });

  const [row] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.id, earnings.id))
    .limit(1);
  return { status: 'approved', earnings: row! };
}

/* ── §22.1: the one Transfer (§33.8.3, §33.8.4) ────────────────────────────── */

export type CreateTransferOutcome =
  | { status: 'created'; transfer: AffiliateTransfer }
  | { status: 'already_created'; transfer: AffiliateTransfer }
  | { status: 'transfer_failed'; message: string }
  | { status: 'before_day_3'; earliestAt: Date }
  | { status: 'tax_gate_blocked'; reason: string }
  | { status: 'recipient_account_not_ready' }
  | { status: 'not_approved'; current: string }
  | { status: 'enforcement_hold'; campaignStatus: string }
  | { status: 'not_found' };

export async function createAffiliateTransfer(
  deps: EarningsDeps,
  input: { associationId: string; actor: string; now?: Date },
): Promise<CreateTransferOutcome> {
  const now = input.now ?? new Date();

  const context = await loadAssociationContext(deps.db, input.associationId);
  if (!context) return { status: 'not_found' };

  const [earnings] = await deps.db
    .select()
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, input.associationId))
    .limit(1);
  if (!earnings) return { status: 'not_found' };
  if (earnings.state === 'transferred' || earnings.state === 'paid_out') {
    const [existing] = await deps.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, input.associationId))
      .limit(1);
    if (existing) return { status: 'already_created', transfer: existing };
  }
  if (earnings.state !== 'approved_for_transfer') {
    return { status: 'not_approved', current: earnings.state };
  }

  // §26.7 (Phase 20b): while the campaign stands suspended/killed, unreleased
  // funds hold — the Transfer is the one Creator-money edge Proovd operates.
  // An already-created Transfer is never rewritten (§29.7); this refuses only
  // a NEW movement of money.
  const hold = await campaignEnforcementHold(deps.db, context.campaignId);
  if (hold.restricted) {
    return { status: 'enforcement_hold', campaignStatus: hold.campaignStatus ?? 'suspended' };
  }

  // §22.1: "on or after Day 3", anchored on campaign_close_at (§21's anchor).
  if (context.closeAt) {
    const earliestAt = dayAfterClose(context.closeAt, TRANSFER_EARLIEST_DAY);
    if (now < earliestAt) return { status: 'before_day_3', earliestAt };
  }

  // §11's tax-accountability gate — every Transfer, no exception. Built in
  // Phase 10b precisely so this phase satisfies it rather than invents it.
  const gate = await readTransferGate(deps.db, deps.gateway.mode);
  if (gate.blocked) {
    return { status: 'tax_gate_blocked', reason: gate.reason ?? 'tax accountability unconfigured' };
  }

  // §24.1: the destination is the Creator's recipient account, and only a
  // payouts-capable one — routing money at an account Stripe will refuse to
  // pay out is not a Transfer, it is a support case.
  const [account] = context.affiliateId
    ? await deps.db
        .select()
        .from(stripeConnectedAccounts)
        .where(
          and(
            eq(stripeConnectedAccounts.ownerUserId, context.affiliateId),
            eq(stripeConnectedAccounts.role, 'affiliate_recipient'),
            eq(stripeConnectedAccounts.mode, deps.gateway.mode),
          ),
        )
        .limit(1)
    : [];
  if (!account || !account.payoutsEnabled) {
    return { status: 'recipient_account_not_ready' };
  }

  const total = transferTotalCents({
    commissionCents: earnings.commissionCents,
    bonusCents: earnings.bonusCents,
    eligibleFixedCents: earnings.eligibleFixedCents,
  });
  const key = earningsTransferKey(input.associationId);

  // Claim the row BEFORE the provider call (§33.8.4). A prior failed attempt
  // resumes under the SAME key; a prior created row answers idempotently.
  let claimed: AffiliateTransfer | undefined;
  const insertedRows = await deps.db
    .insert(affiliateTransfers)
    .values({
      associationId: input.associationId,
      campaignId: context.campaignId,
      earningsId: earnings.id,
      mode: deps.gateway.mode,
      destinationAccountId: account.stripeAccountId,
      commissionCents: earnings.commissionCents,
      bonusCents: earnings.bonusCents,
      fixedCents: earnings.eligibleFixedCents,
      totalCents: total,
      idempotencyKey: key,
      status: 'initiated',
      createdBy: input.actor,
      requestedAt: now,
    })
    .onConflictDoNothing({ target: affiliateTransfers.associationId })
    .returning();
  claimed = insertedRows[0];
  if (!claimed) {
    const [existing] = await deps.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, input.associationId))
      .limit(1);
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'created') return { status: 'already_created', transfer: existing };
    // failed → initiated for the retry; an in-flight `initiated` row proceeds
    // as the resumed attempt under the same key.
    if (existing.status === 'failed') {
      const [reopened] = await deps.db
        .update(affiliateTransfers)
        .set({
          status: 'initiated',
          attemptCount: sql`${affiliateTransfers.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(and(eq(affiliateTransfers.id, existing.id), eq(affiliateTransfers.status, 'failed')))
        .returning();
      claimed = reopened ?? existing;
    } else {
      claimed = existing;
    }
  }

  let providerTransferId: string;
  try {
    const result = await deps.gateway.createTransfer({
      destinationAccountId: account.stripeAccountId,
      amountCents: total,
      idempotencyKey: key,
      metadata: {
        campaignId: context.campaignId,
        associationId: input.associationId,
        earningsId: earnings.id,
      },
    });
    providerTransferId = result.id;
  } catch (error) {
    // §32.3: a synchronous API error, recorded — the sweep retries under the
    // same key. The earnings stay `approved_for_transfer`: a retry-job case is
    // not a payout failure, and B.7 names the retry as the reason.
    const message = error instanceof Error ? error.message : String(error);
    await deps.db
      .update(affiliateTransfers)
      .set({ status: 'failed', failureMessage: message, lastFailedAt: now, updatedAt: now })
      .where(and(eq(affiliateTransfers.id, claimed.id), eq(affiliateTransfers.status, 'initiated')));
    await deps.audit({
      action: 'earnings.transfer_failed',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason: `Transfer creation failed synchronously (§32.3): ${message}. Retried by the sweep under the same key ${key}.`,
      newValue: { transferId: claimed.id },
      actorId: input.actor,
    });
    if (deps.notifier && deps.context) {
      await notifyTransferFailure(
        { db: deps.db, notifier: deps.notifier, context: deps.context },
        {
          transferId: claimed.id,
          associationId: input.associationId,
          campaignId: context.campaignId,
          totalCents: claimed.totalCents,
        },
      );
    }
    return { status: 'transfer_failed', message };
  }

  const confirmed = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(affiliateTransfers)
      .set({
        status: 'created',
        providerTransferId,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(affiliateTransfers.id, claimed!.id), eq(affiliateTransfers.status, 'initiated')),
      )
      .returning();
    if (!row) return null;

    await moveEarningsState(tx, earnings, 'transferred', input.actor, null, now);

    // The fixed component moves the §16 allocation to its terminal `paid`
    // (label: "Fixed Creator payment paid") in the same transaction.
    if (earnings.eligibleFixedCents > 0n) {
      await tx
        .update(creatorPaymentAllocations)
        .set({ status: 'paid', transferObjectId: providerTransferId, updatedAt: now })
        .where(
          and(
            eq(creatorPaymentAllocations.associationId, input.associationId),
            eq(creatorPaymentAllocations.status, 'funded'),
          ),
        );
    }
    return row;
  });

  if (!confirmed) {
    const [existing] = await deps.db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.id, claimed.id))
      .limit(1);
    return { status: 'already_created', transfer: existing! };
  }

  // A Transfer is the PLATFORM's object (§24.1); the destination account
  // lives on the affiliate_transfers row, and the 0014 CHECK ties a platform
  // context to carrying no connected-account id.
  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'transfer',
    providerObjectId: providerTransferId,
    accountContext: 'platform',
    campaignId: context.campaignId,
    associationId: input.associationId,
    ownerUserId: context.affiliateId,
    amountCents: total,
    status: 'created',
    idempotencyKey: key,
  });

  await deps.audit({
    action: 'earnings.transfer_created',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason:
      `§22.1: the one campaign Transfer ${providerTransferId} created for finalized commission ` +
      `${earnings.commissionCents} + earned bonus ${earnings.bonusCents} + eligible fixed ${earnings.eligibleFixedCents} ` +
      `= ${total} (§33.8.3), on or after Day ${TRANSFER_EARLIEST_DAY}, tax gate satisfied (§11)`,
    newValue: { transferId: confirmed.id, providerTransferId },
    actorId: input.actor,
  });

  if (deps.notifier && deps.context) {
    await notifyTransferCreated(
      { db: deps.db, notifier: deps.notifier, context: deps.context },
      { transfer: confirmed },
    );
  }

  return { status: 'created', transfer: confirmed };
}

/**
 * The §33.8.4 retry sweep: every `failed` Transfer, and every `initiated` one
 * older than five minutes (a crash between claim and confirmation), re-driven
 * through the same service under the same stable key. Safe to run twice.
 */
export async function sweepTransferRetries(
  deps: EarningsDeps,
  now = new Date(),
): Promise<{ retried: number; created: number }> {
  const stale = new Date(now.getTime() - 5 * 60 * 1000);
  const due = await deps.db
    .select({ associationId: affiliateTransfers.associationId })
    .from(affiliateTransfers)
    .where(
      sql`${affiliateTransfers.status} = 'failed' OR (${affiliateTransfers.status} = 'initiated' AND ${affiliateTransfers.requestedAt} < ${stale.toISOString()}::timestamptz)`,
    );

  let created = 0;
  for (const row of due) {
    const outcome = await createAffiliateTransfer(deps, {
      associationId: row.associationId,
      actor: 'system:affiliate-transfer-retry',
      now,
    });
    if (outcome.status === 'created') created += 1;
  }
  return { retried: due.length, created };
}

/* ── Appendix B.7's payout tail (§22.1, §32.3) ─────────────────────────────── */

export type PayoutEventOutcome = { moved: number };

/**
 * `payout.paid` / `payout.failed` from the Creator's connected account move
 * `transferred` earnings to `paid_out` / `payout_failed` (and a failed one
 * back to `paid_out` when a later payout lands). A payout is balance-level at
 * the provider, so it applies to every transferred earnings row destined for
 * that account — §22.1 routes the fix through the Stripe-managed update path,
 * and the message says exactly that.
 */
export async function applyPayoutEvent(
  deps: EarningsDeps,
  input: {
    kind: 'paid' | 'failed';
    stripeAccountId: string;
    payoutId: string;
    actor: string;
    now?: Date;
  },
): Promise<PayoutEventOutcome> {
  const now = input.now ?? new Date();
  const fromStates: EarningsState[] =
    input.kind === 'paid' ? ['transferred', 'payout_failed'] : ['transferred'];
  const to: EarningsState = input.kind === 'paid' ? 'paid_out' : 'payout_failed';

  const rows = await deps.db
    .select({ earnings: creatorEarnings })
    .from(creatorEarnings)
    .innerJoin(affiliateTransfers, eq(affiliateTransfers.earningsId, creatorEarnings.id))
    .where(
      and(
        eq(affiliateTransfers.destinationAccountId, input.stripeAccountId),
        eq(affiliateTransfers.status, 'created'),
        inArray(creatorEarnings.state, fromStates),
      ),
    );

  let moved = 0;
  for (const { earnings } of rows) {
    const applied = await deps.db.transaction(async (tx) =>
      moveEarningsState(
        tx,
        earnings,
        to,
        input.actor,
        `provider payout ${input.payoutId} ${input.kind}`,
        now,
      ),
    );
    if (applied) {
      moved += 1;
      if (deps.notifier && deps.context) {
        await notifyPayout(
          { db: deps.db, notifier: deps.notifier, context: deps.context },
          { kind: input.kind, earnings, payoutId: input.payoutId },
        );
      }
    }
  }
  return { moved };
}

/* ── The Admin earnings queue (§22.1, §26.6) ───────────────────────────────── */

export interface CampaignEarningsRow {
  associationId: string;
  associationStatus: string;
  publicHandle: string | null;
  email: string | null;
  attributedCaptured: number;
  validSubtotalCents: string;
  latestDecision: CreatorCompletionDecision | null;
  earnings: CreatorEarnings | null;
  transfer: AffiliateTransfer | null;
  allocation: { status: string; amountCents: string } | null;
  thankYou: Array<{ kind: string; amountCents: string | null; createdAt: Date }>;
  /** §22.1's Day 3 anchor for the one Transfer, when the campaign has closed. */
  transferEarliestAt: Date | null;
}

/**
 * The per-campaign §22.1 queue the Admin close surface renders: every Creator
 * with locked terms, their decision, finalization, Transfer, allocation, and
 * thank-you records, with the captured-attributed basis computed live from the
 * ledger — one source, many renderers (§33.8.13).
 */
export async function readCampaignEarnings(
  db: Database,
  campaignId: string,
): Promise<CampaignEarningsRow[] | null> {
  const [campaign] = await db
    .select({ id: campaigns.id, closeAt: campaigns.campaignCloseAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      associationStatus: sql<string>`${campaignAffiliateAssociations.status}::text`,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      associationCompensationAgreements,
      eq(associationCompensationAgreements.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const rows: CampaignEarningsRow[] = [];
  for (const association of associations) {
    const [profile] = await db
      .select({
        publicHandle: affiliateSignupProfiles.publicHandle,
        email: affiliateSignupProfiles.email,
      })
      .from(affiliateSignupProfiles)
      .where(eq(affiliateSignupProfiles.associationId, association.associationId))
      .limit(1);

    const [basis] = await db
      .select({
        captured: sql<number>`count(*) filter (where ${reservations.status}::text = 'captured')::int`,
        validSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status}::text = 'captured' and ${reservations.attributionStatus} = 'verified'), 0)::text`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.campaignId, campaignId),
          eq(reservations.attributionAssociationId, association.associationId),
        ),
      );

    const [latestDecision] = await db
      .select()
      .from(creatorCompletionDecisions)
      .where(eq(creatorCompletionDecisions.associationId, association.associationId))
      .orderBy(sql`${creatorCompletionDecisions.decidedAt} DESC`)
      .limit(1);
    const [earnings] = await db
      .select()
      .from(creatorEarnings)
      .where(eq(creatorEarnings.associationId, association.associationId))
      .limit(1);
    const [transfer] = await db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, association.associationId))
      .limit(1);
    const [allocation] = await db
      .select({
        status: sql<string>`${creatorPaymentAllocations.status}::text`,
        amountCents: sql<string>`${creatorPaymentAllocations.amountCents}::text`,
      })
      .from(creatorPaymentAllocations)
      .where(eq(creatorPaymentAllocations.associationId, association.associationId))
      .limit(1);
    const thankYou = await db
      .select({
        kind: thankYouRecords.kind,
        amountCents: sql<string | null>`${thankYouRecords.amountCents}::text`,
        createdAt: thankYouRecords.createdAt,
      })
      .from(thankYouRecords)
      .where(eq(thankYouRecords.associationId, association.associationId));

    rows.push({
      associationId: association.associationId,
      associationStatus: association.associationStatus,
      publicHandle: profile?.publicHandle ?? null,
      email: profile?.email ?? null,
      attributedCaptured: basis?.captured ?? 0,
      validSubtotalCents: basis?.validSubtotal ?? '0',
      latestDecision: latestDecision ?? null,
      earnings: earnings ?? null,
      transfer: transfer ?? null,
      allocation: allocation ?? null,
      thankYou,
      transferEarliestAt: campaign.closeAt
        ? dayAfterClose(campaign.closeAt, TRANSFER_EARLIEST_DAY)
        : null,
    });
  }
  return rows;
}

/* ── §22.2: the discretionary thank-you (§33.8.14) ─────────────────────────── */

export type ThankYouOutcome =
  | { status: 'recorded'; record: ThankYouRecord }
  | { status: 'duplicate_payment' }
  | { status: 'listing_revenue_unresolved'; reason: string }
  | { status: 'amount_exceeds_funding_source' }
  | { status: 'tax_gate_blocked'; reason: string }
  | { status: 'recipient_account_not_ready' }
  | { status: 'approval_missing' }
  | { status: 'eligibility_not_confirmed' }
  | { status: 'not_found' };

/**
 * Records §22.2's recognition, or sends its payment.
 *
 * No branch of this computes an amount, and no function anywhere estimates
 * one — the amount is typed by an Admin or there is no amount (§22.2: "Never
 * guaranteed, estimated, or calculated by the product"). The payment's
 * Transfer draws on the platform balance with NO campaign reference: the row
 * carries no reservation or ledger column, and the funding-source gate checks
 * that the retained listing fee actually exists, is unrefunded, and has no
 * §31.6 cancellation pending against it — "after all refund rights resolve".
 */
export async function recordThankYou(
  deps: EarningsDeps,
  input: {
    associationId: string;
    kind: ThankYouKind;
    amountCents?: bigint | undefined;
    reason: string;
    minimumWorkCompleted: boolean;
    clickThresholdMet: boolean;
    brandAupCompliant: boolean;
    approvalReference?: string | undefined;
    approvedBy?: string | undefined;
    taxTreatment?: string | undefined;
    actor: string;
    now?: Date;
  },
): Promise<ThankYouOutcome> {
  const now = input.now ?? new Date();

  const context = await loadAssociationContext(deps.db, input.associationId);
  if (!context) return { status: 'not_found' };

  if (input.kind === 'recognition') {
    const [record] = await deps.db
      .insert(thankYouRecords)
      .values({
        associationId: input.associationId,
        campaignId: context.campaignId,
        kind: 'recognition',
        reason: input.reason,
        fundingSource: THANK_YOU_FUNDING_SOURCE,
        minimumWorkCompleted: input.minimumWorkCompleted,
        clickThresholdMet: input.clickThresholdMet,
        brandAupCompliant: input.brandAupCompliant,
        createdBy: input.actor,
        createdAt: now,
      })
      .returning();
    await deps.audit({
      action: 'earnings.thank_you_recognition',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason: `§22.2 recognition recorded without money: ${input.reason}`,
      newValue: { recordId: record!.id },
      actorId: input.actor,
    });
    return { status: 'recorded', record: record! };
  }

  /* kind === 'payment' */

  if (!input.minimumWorkCompleted || !input.clickThresholdMet || !input.brandAupCompliant) {
    return { status: 'eligibility_not_confirmed' };
  }
  if (!input.amountCents || input.amountCents <= 0n) return { status: 'approval_missing' };
  if (!input.approvalReference?.trim() || !input.approvedBy?.trim() || !input.taxTreatment?.trim()) {
    // §22.2: "If the approval or path is absent, Admin may record recognition
    // but cannot promise or send money."
    return { status: 'approval_missing' };
  }

  const [existing] = await deps.db
    .select({ id: thankYouRecords.id })
    .from(thankYouRecords)
    .where(
      and(eq(thankYouRecords.associationId, input.associationId), eq(thankYouRecords.kind, 'payment')),
    )
    .limit(1);
  if (existing) return { status: 'duplicate_payment' };

  // §22.2: "funded only from Proovd's retained listing-fee revenue after all
  // refund rights resolve" — the payment exists, was never refunded, and no
  // §31.6 cancellation is pending against it.
  const [listing] = await deps.db
    .select({ id: listingFeePayments.id, subtotalCents: listingFeePayments.subtotalCents })
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, context.campaignId))
    .limit(1);
  if (!listing) {
    return { status: 'listing_revenue_unresolved', reason: 'no listing-fee payment exists for this campaign' };
  }
  const [refund] = await deps.db
    .select({ id: listingFeeRefunds.id })
    .from(listingFeeRefunds)
    .where(eq(listingFeeRefunds.campaignId, context.campaignId))
    .limit(1);
  if (refund) {
    return { status: 'listing_revenue_unresolved', reason: 'the listing fee was refunded — there is no retained revenue to fund this' };
  }
  const [pendingCancellation] = await deps.db
    .select({ id: campaignCancellations.id })
    .from(campaignCancellations)
    .where(
      and(
        eq(campaignCancellations.campaignId, context.campaignId),
        eq(sql`${campaignCancellations.status}::text`, 'pending'),
      ),
    )
    .limit(1);
  if (pendingCancellation) {
    return { status: 'listing_revenue_unresolved', reason: 'a cancellation request is pending — refund rights have not resolved' };
  }
  // The named funding source is finite: a thank-you larger than the retained
  // listing subtotal cannot be funded "only from" it.
  if (input.amountCents > listing.subtotalCents) {
    return { status: 'amount_exceeds_funding_source' };
  }

  const gate = await readTransferGate(deps.db, deps.gateway.mode);
  if (gate.blocked) {
    return { status: 'tax_gate_blocked', reason: gate.reason ?? 'tax accountability unconfigured' };
  }

  const [account] = context.affiliateId
    ? await deps.db
        .select()
        .from(stripeConnectedAccounts)
        .where(
          and(
            eq(stripeConnectedAccounts.ownerUserId, context.affiliateId),
            eq(stripeConnectedAccounts.role, 'affiliate_recipient'),
            eq(stripeConnectedAccounts.mode, deps.gateway.mode),
          ),
        )
        .limit(1)
    : [];
  if (!account || !account.payoutsEnabled) return { status: 'recipient_account_not_ready' };

  // Claim before the provider call; the partial unique index makes the insert
  // below the "once", and the claim makes a crash resumable as the SAME
  // Transfer (§33.8.14's "cannot duplicate", the §33.7.7 shape).
  const key = thankYouPaymentKey(input.associationId);
  await deps.db
    .insert(idempotencyKeys)
    .values({ key, purpose: 'thank_you_payment' })
    .onConflictDoNothing({ target: idempotencyKeys.key });

  const transfer = await deps.gateway.createTransfer({
    destinationAccountId: account.stripeAccountId,
    amountCents: input.amountCents,
    idempotencyKey: key,
    // No campaignId in the metadata's money path and no source_transaction:
    // the §22.2 payment cannot draw on a campaign balance.
    metadata: { purpose: 'discretionary_thank_you', associationId: input.associationId },
  });

  const [record] = await deps.db
    .insert(thankYouRecords)
    .values({
      associationId: input.associationId,
      campaignId: context.campaignId,
      kind: 'payment',
      amountCents: input.amountCents,
      reason: input.reason,
      fundingSource: THANK_YOU_FUNDING_SOURCE,
      minimumWorkCompleted: true,
      clickThresholdMet: true,
      brandAupCompliant: true,
      recipientAccountId: account.stripeAccountId,
      approvalReference: input.approvalReference,
      approvedBy: input.approvedBy,
      taxTreatment: input.taxTreatment,
      mode: deps.gateway.mode,
      providerTransferId: transfer.id,
      providerStatus: 'created',
      createdBy: input.actor,
      createdAt: now,
    })
    .returning();
  await deps.db
    .update(idempotencyKeys)
    .set({ completedAt: now, result: { transferId: transfer.id } })
    .where(eq(idempotencyKeys.key, key));

  await recordProviderObject(deps.db, {
    mode: deps.gateway.mode,
    objectType: 'transfer',
    providerObjectId: transfer.id,
    accountContext: 'platform',
    associationId: input.associationId,
    ownerUserId: context.affiliateId,
    amountCents: input.amountCents,
    status: 'created',
    idempotencyKey: key,
  });

  await deps.audit({
    action: 'earnings.thank_you_paid',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason:
      `§22.2 discretionary thank-you ${transfer.id}: US$${(Number(input.amountCents) / 100).toFixed(2)} ` +
      `from retained listing-fee revenue, approved by ${input.approvedBy} (${input.approvalReference}); ` +
      `eligibility facts confirmed by ${input.actor}`,
    newValue: { recordId: record!.id, providerTransferId: transfer.id },
    actorId: input.actor,
  });

  return { status: 'recorded', record: record! };
}
