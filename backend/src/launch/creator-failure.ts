/**
 * Required launch Creator failure — Spec §29.6, §23.1, §33.4.9, §33.12.2.
 *
 * Before `campaign_live_at`, a required launch Creator can fail. §29.6:
 *
 *   - Admin records `creator_failure_recorded_at` once, sets the replacement
 *     designation, and the system computes the exact due timestamp from the
 *     committed US business calendar — three business days — and stores it with
 *     its calendar version. Retries and edits cannot reset it.
 *   - The campaign moves creator_prep → creator_replacement; a replacement must
 *     become fully ready by the due time.
 *   - A replacement that becomes ready returns the campaign to creator_prep.
 *   - A missed deadline sets `refunded_no_creator`, returns the funded
 *     allocation to the Founder, and refunds the FULL listing Checkout total
 *     including its tax — through Phase 11's one refund path, not a new one.
 *
 * ── The deadline is computed once, and the record enforces it (§33.12.2) ─────
 * `recordCreatorFailure` is idempotent by the unique `required_creator_failures`
 * row: a second recording returns the first, unchanged, so a retry cannot move
 * a deadline already promised. The database immutability trigger backs it.
 *
 * ── The miss path reuses §14.6's exact shape ────────────────────────────────
 * `failReplacement` is `evaluateResponseDeadline`'s twin: claim the idempotency
 * key first, set roster `failed`, move to `refunded_no_creator`, and refund
 * after the decision commits so a crash between the two costs a retry, not the
 * refund promise. The stable provider idempotency key makes each retry the same
 * refund at Stripe.
 */

import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import { creatorPaymentAllocations } from '../db/schema/creator-payment.js';
import { requiredCreatorFailures, type RequiredCreatorFailure } from '../db/schema/launch.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { refundListingFee, type RefundOutcome } from '../payments/listing-refund.js';
import { creatorReplacementDeadline } from './business-calendar.js';

export function creatorReplacementFailedKey(campaignId: string): string {
  return `creator_replacement_failed:${campaignId}`;
}

/* ── Record the failure (§29.6) ────────────────────────────────────────────── */

export type RecordFailureOutcome =
  | { status: 'recorded'; failure: RequiredCreatorFailure; alreadyExisted: false }
  /** The failure was already recorded — returned unchanged (§33.12.2). */
  | { status: 'recorded'; failure: RequiredCreatorFailure; alreadyExisted: true }
  | { status: 'not_found' }
  | { status: 'wrong_status'; message: string };

export async function recordCreatorFailure(
  deps: { db: Database; audit: AuditWriter },
  input: {
    campaignId: string;
    failedAssociationId: string;
    replacementDesignation: string;
    recordedBy: string;
    now?: Date;
  },
): Promise<RecordFailureOutcome> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();

  // Non-resettable: if a record exists, return it unchanged whatever this call
  // asks for. §29.6, before the transaction even opens.
  const existing = await findCreatorFailure(db, input.campaignId);
  if (existing) return { status: 'recorded', failure: existing, alreadyExisted: true };

  const deadline = creatorReplacementDeadline(now);

  try {
    const recorded = await db.transaction(async (tx): Promise<RecordFailureOutcome> => {
      const [campaign] = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .for('update')
        .limit(1);
      if (!campaign) return { status: 'not_found' };
      if (campaign.status !== 'creator_prep') {
        return {
          status: 'wrong_status',
          message:
            campaign.status === 'live'
              ? 'This campaign is already live, so a required launch Creator failure no longer applies here (§29.6).'
              : `This campaign is ${campaign.status}, not in Creator preparation, so a launch-Creator failure cannot be recorded.`,
        };
      }

      const [failure] = await tx
        .insert(requiredCreatorFailures)
        .values({
          campaignId: input.campaignId,
          failedAssociationId: input.failedAssociationId,
          creatorFailureRecordedAt: now,
          replacementDesignation: input.replacementDesignation,
          dueAt: deadline.dueAt,
          dueCalendarVersion: deadline.calendarVersion,
          recordedBy: input.recordedBy,
        })
        .returning();

      const moved = await tx
        .update(campaigns)
        .set({ status: 'creator_replacement', updatedAt: now })
        .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'creator_prep')))
        .returning({ id: campaigns.id });
      if (moved.length === 1) {
        await tx.insert(campaignStatusHistory).values({
          campaignId: input.campaignId,
          fromStatus: 'creator_prep',
          toStatus: 'creator_replacement',
          actor: input.recordedBy,
        });
      }

      await audit({
        action: 'campaign.creator_failure_recorded',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason:
          `§29.6 required launch Creator failure recorded at ${now.toISOString()}; replacement due by ` +
          `${deadline.dueAt.toISOString()} (calendar ${deadline.calendarVersion}, three business days). ` +
          'This deadline is computed once and cannot be reset.',
        newValue: {
          failedAssociationId: input.failedAssociationId,
          dueAt: deadline.dueAt.toISOString(),
          dueCalendarVersion: deadline.calendarVersion,
        },
        actorId: input.recordedBy.replace(/^admin:|^user:/, '') || null,
      });

      return { status: 'recorded', failure: failure!, alreadyExisted: false };
    });
    return recorded;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent recording won; return the stored one unchanged.
      const row = await findCreatorFailure(db, input.campaignId);
      if (row) return { status: 'recorded', failure: row, alreadyExisted: true };
    }
    throw error;
  }
}

/* ── The replacement became ready (§29.6, §23.1) ───────────────────────────── */

export type ResolveOutcome =
  | { status: 'resolved'; failure: RequiredCreatorFailure }
  | { status: 'not_found' }
  | { status: 'not_pending'; message: string };

/**
 * §23.1: `creator_replacement → creator_prep` — "Replacement ready." Records the
 * failure resolved and returns the campaign to Creator preparation, from which
 * the scheduled launch can proceed. Conditional, so a second call is a no-op.
 */
export async function resolveCreatorReplacement(
  deps: { db: Database; audit: AuditWriter },
  input: { campaignId: string; actor: string; resolutionNote?: string | undefined; now?: Date },
): Promise<ResolveOutcome> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();

  return db.transaction(async (tx): Promise<ResolveOutcome> => {
    const [failure] = await tx
      .select()
      .from(requiredCreatorFailures)
      .where(eq(requiredCreatorFailures.campaignId, input.campaignId))
      .for('update')
      .limit(1);
    if (!failure) return { status: 'not_found' };
    if (failure.status !== 'replacement_pending') {
      return {
        status: 'not_pending',
        message: `This replacement is already ${failure.status.replace('replacement_', '')}.`,
      };
    }

    const moved = await tx
      .update(campaigns)
      .set({ status: 'creator_prep', updatedAt: now })
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'creator_replacement')))
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: 'creator_replacement',
        toStatus: 'creator_prep',
        actor: input.actor,
      });
    }

    const [updated] = await tx
      .update(requiredCreatorFailures)
      .set({
        status: 'replacement_ready',
        resolvedAt: now,
        resolvedBy: input.actor,
        resolutionNote: input.resolutionNote ?? 'a replacement Creator became fully ready by the due time',
        updatedAt: now,
      })
      .where(eq(requiredCreatorFailures.id, failure.id))
      .returning();

    await audit({
      action: 'campaign.creator_replacement_ready',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `§29.6 replacement became ready before the due time ${failure.dueAt.toISOString()}; campaign returned to Creator preparation`,
      actorId: input.actor.replace(/^admin:|^user:/, '') || null,
    });

    return { status: 'resolved', failure: updated! };
  });
}

/* ── The miss path (§29.6, §33.4.9) ────────────────────────────────────────── */

export interface FailureRefundDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
}

export type FailReplacementOutcome =
  | {
      status: 'failed';
      failure: RequiredCreatorFailure;
      returnedAllocationIds: string[];
      refund: RefundOutcome | null;
    }
  | { status: 'not_due' }
  | { status: 'not_applicable' }
  | { status: 'already_failed' };

/**
 * The replacement deadline passed with no ready replacement. Sets
 * `refunded_no_creator`, returns every funded allocation to the Founder, and
 * refunds the full listing Checkout total. Exactly once, per §28.3.
 */
export async function failReplacement(
  deps: FailureRefundDeps,
  campaignId: string,
  now: Date = new Date(),
): Promise<FailReplacementOutcome> {
  const { db, audit } = deps;

  const failure = await findCreatorFailure(db, campaignId);
  if (!failure) return { status: 'not_applicable' };
  if (failure.status !== 'replacement_pending') return { status: 'already_failed' };
  if (now.getTime() < failure.dueAt.getTime()) return { status: 'not_due' };

  let evaluated:
    | { failure: RequiredCreatorFailure; returnedAllocationIds: string[] }
    | null = null;

  try {
    evaluated = await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .for('update')
        .limit(1);
      // A campaign already moved on has nothing left for the deadline to decide.
      if (!campaign || campaign.status !== 'creator_replacement') return null;

      const [current] = await tx
        .select({ id: requiredCreatorFailures.id, status: requiredCreatorFailures.status })
        .from(requiredCreatorFailures)
        .where(eq(requiredCreatorFailures.campaignId, campaignId))
        .for('update')
        .limit(1);
      if (!current || current.status !== 'replacement_pending') return null;

      // The exactly-once pivot, claimed first so every effect shares its fate.
      await tx.insert(idempotencyKeys).values({
        key: creatorReplacementFailedKey(campaignId),
        purpose: 'creator_replacement_failed',
        completedAt: new Date(),
        result: { campaignId, dueAt: failure.dueAt.toISOString() },
      });

      /* §23.2: the roster failed. */
      await tx
        .update(campaigns)
        .set({ affiliateRosterStatus: 'failed', updatedAt: now })
        .where(eq(campaigns.id, campaignId));

      /* §23.1: creator_replacement → refunded_no_creator. */
      const moved = await tx
        .update(campaigns)
        .set({ status: 'refunded_no_creator', updatedAt: now })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'creator_replacement')))
        .returning({ id: campaigns.id });
      if (moved.length === 1) {
        await tx.insert(campaignStatusHistory).values({
          campaignId,
          fromStatus: 'creator_replacement',
          toStatus: 'refunded_no_creator',
          actor: 'system:replacement_deadline',
        });
      }

      /* §29.6: "returns funded allocation." Every funded allocation on the dead
         campaign returns to the Founder; the money movement (a Transfer reversal)
         is Phase 19, so this records the return eligibility and the amount and
         leaves the Transfer object for that phase. */
      const funded = await tx
        .select()
        .from(creatorPaymentAllocations)
        .where(
          and(eq(creatorPaymentAllocations.campaignId, campaignId), eq(creatorPaymentAllocations.status, 'funded')),
        );
      const returnedAllocationIds: string[] = [];
      for (const allocation of funded) {
        await tx
          .update(creatorPaymentAllocations)
          .set({
            status: 'returned',
            returnEligible: true,
            returnAmountCents: allocation.amountCents,
            returnReason:
              'required launch Creator failure — campaign refunded_no_creator; the secured Creator payment returns to the Founder (§29.6, §31.6)',
            updatedAt: now,
          })
          .where(eq(creatorPaymentAllocations.id, allocation.id));
        returnedAllocationIds.push(allocation.id);
      }

      const [updatedFailure] = await tx
        .update(requiredCreatorFailures)
        .set({
          status: 'replacement_failed',
          resolvedAt: now,
          resolvedBy: 'system:replacement_deadline',
          resolutionNote: 'no replacement Creator became ready by the due time',
          updatedAt: now,
        })
        .where(eq(requiredCreatorFailures.id, current.id))
        .returning();

      await audit({
        action: 'campaign.creator_replacement_failed',
        targetType: 'campaign',
        targetId: campaignId,
        internalReason:
          `§29.6 replacement deadline ${failure.dueAt.toISOString()} passed with no ready replacement: ` +
          `roster failed, campaign → refunded_no_creator, ${returnedAllocationIds.length} funded allocation(s) returned. ` +
          'The full listing Checkout total is refunded next.',
        newValue: { returnedAllocationIds },
      });

      return { failure: updatedFailure!, returnedAllocationIds };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'already_failed' };
    throw error;
  }

  if (!evaluated) return { status: 'not_applicable' };

  /* The refund, after the decision committed — §29.6's full Checkout total
     including tax, through Phase 11's one path. Its own idempotency makes a
     crash-and-retry the same refund. */
  const refund = await refundListingFee(deps, {
    campaignId,
    trigger: 'creator_replacement_failed',
    actor: 'system:replacement_deadline',
    internalReason: `§29.6: no replacement Creator became ready by ${evaluated.failure.dueAt.toISOString()}`,
    customerExplanation:
      'No replacement Creator became ready within the replacement window, so your entire listing ' +
      'Checkout charge — including its sales tax — is refunded to your original payment method.',
  });

  if (refund.status === 'refunded' || refund.status === 'initiated_unconfirmed') {
    await db
      .update(requiredCreatorFailures)
      .set({ refundId: refund.refund.id })
      .where(eq(requiredCreatorFailures.id, evaluated.failure.id));
  }

  return { status: 'failed', failure: evaluated.failure, returnedAllocationIds: evaluated.returnedAllocationIds, refund };
}

/* ── The sweep (§29.6) ─────────────────────────────────────────────────────── */

export interface ReplacementSweepResult {
  failed: string[];
  refundsRetried: string[];
}

export async function sweepCreatorReplacementDeadlines(
  deps: FailureRefundDeps,
  now: Date = new Date(),
): Promise<{ result: ReplacementSweepResult; outcomes: FailReplacementOutcome[] }> {
  const { db } = deps;

  const due = await db
    .select({ campaignId: requiredCreatorFailures.campaignId })
    .from(requiredCreatorFailures)
    .innerJoin(campaigns, eq(campaigns.id, requiredCreatorFailures.campaignId))
    .where(
      and(
        eq(requiredCreatorFailures.status, 'replacement_pending'),
        lte(requiredCreatorFailures.dueAt, now),
        eq(campaigns.status, 'creator_replacement'),
      ),
    );

  const result: ReplacementSweepResult = { failed: [], refundsRetried: [] };
  const outcomes: FailReplacementOutcome[] = [];
  for (const row of due) {
    const outcome = await failReplacement(deps, row.campaignId, now);
    outcomes.push(outcome);
    if (outcome.status === 'failed') result.failed.push(row.campaignId);
  }

  // A failed evaluation whose refund never confirmed is retried on every pass.
  result.refundsRetried = await retryUnconfirmedFailureRefunds(deps);

  return { result, outcomes };
}

/** Completes the refund for a failed replacement whose provider call did not confirm. */
export async function retryUnconfirmedFailureRefunds(deps: FailureRefundDeps): Promise<string[]> {
  const { db } = deps;
  const pending = await db
    .select({ id: requiredCreatorFailures.id, campaignId: requiredCreatorFailures.campaignId, dueAt: requiredCreatorFailures.dueAt })
    .from(requiredCreatorFailures)
    .where(and(eq(requiredCreatorFailures.status, 'replacement_failed'), isNull(requiredCreatorFailures.refundId)));

  const retried: string[] = [];
  for (const row of pending) {
    const refund = await refundListingFee(deps, {
      campaignId: row.campaignId,
      trigger: 'creator_replacement_failed',
      actor: 'system:replacement_deadline',
      internalReason: 'retrying the §29.6 refund whose provider confirmation is missing',
      customerExplanation:
        'No replacement Creator became ready within the replacement window, so your entire listing ' +
        'Checkout charge — including its sales tax — is refunded to your original payment method.',
    });
    if (refund.status === 'refunded' || refund.status === 'initiated_unconfirmed') {
      await db
        .update(requiredCreatorFailures)
        .set({ refundId: refund.refund.id })
        .where(and(eq(requiredCreatorFailures.id, row.id), isNull(requiredCreatorFailures.refundId)));
      retried.push(row.campaignId);
    }
  }
  return retried;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function findCreatorFailure(
  db: Pick<Database, 'select'>,
  campaignId: string,
): Promise<RequiredCreatorFailure | null> {
  const [row] = await db
    .select()
    .from(requiredCreatorFailures)
    .where(eq(requiredCreatorFailures.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
