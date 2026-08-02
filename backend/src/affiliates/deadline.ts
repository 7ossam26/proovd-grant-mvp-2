/**
 * The §14.6 no-acceptance evaluation — Spec §14.6, §23.1, §23.2, §29.6,
 * §33.2.5, §33.2.11, §33.3.8.
 *
 * At exactly 72 hours after `listing_paid_at` — the deadline STORED on the
 * payment row at payment, never recomputed (§29.6):
 *
 *   ≥1 locked mutual acceptance  → the campaign continues; every unfinished
 *                                  proposal still becomes `expired_no_acceptance`
 *                                  and closes (§14.2's last bullet).
 *   zero eligible recruits, or   → `affiliate_roster_status = failed`, pending
 *   no locked mutual acceptance    proposals closed, review readiness prevented
 *                                  (a failed roster can never satisfy §15),
 *                                  the ENTIRE listing Checkout total refunded
 *                                  once including tax reversal (Phase 11's one
 *                                  refund path, `refundListingFee`), everyone
 *                                  notified, and the campaign moved to §23.1's
 *                                  `refunded_no_creator`.
 *
 * ── Exactly once ────────────────────────────────────────────────────────────
 * The idempotency key `response_deadline_evaluated:<campaignId>` is claimed
 * FIRST inside the transaction, so every effect shares its fate; the unique
 * `response_deadline_evaluations` row is the backstop behind it. The refund
 * runs after commit and carries its own three §33.3.8 mechanisms, so a crash
 * between the two leaves a recorded failed evaluation whose refund the next
 * sweep completes — visible, honest, retryable.
 *
 * ── A late response cannot reactivate ───────────────────────────────────────
 * Not enforced here but made true here: every association still open moves to
 * `expired_no_acceptance`, which is terminal in the §23.4 machine, so every
 * later decision's conditional UPDATE matches nothing; and every decision
 * service refuses when the campaign has left `affiliate_response_and_build`.
 */

import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { proposalVersions, responseDeadlineEvaluations, type ResponseDeadlineEvaluation } from '../db/schema/decisions.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { refundListingFee, type RefundOutcome } from '../payments/listing-refund.js';
import { transitionAssociation } from './recruitment.js';
import { countLockedAcceptances } from './decisions.js';

const OPEN_STATUSES = ['formal_decision_open', 'reviewing', 'proposal_pending'] as const;

export type DeadlineEvaluationResult =
  | {
      status: 'evaluated';
      outcome: 'continues' | 'failed_zero_eligible_recruits' | 'failed_no_mutual_acceptance';
      evaluation: ResponseDeadlineEvaluation;
      expiredAssociationIds: string[];
      refund: RefundOutcome | null;
    }
  | { status: 'already_evaluated' }
  | { status: 'not_due' }
  | { status: 'not_applicable' };

export interface DeadlineDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
}

export function deadlineEvaluationKey(campaignId: string): string {
  return `response_deadline_evaluated:${campaignId}`;
}

export async function evaluateResponseDeadline(
  deps: DeadlineDeps,
  campaignId: string,
  now: Date = new Date(),
): Promise<DeadlineEvaluationResult> {
  const { db, audit } = deps;

  const [payment] = await db
    .select({
      id: listingFeePayments.id,
      responseDeadlineAt: listingFeePayments.responseDeadlineAt,
    })
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, campaignId))
    .limit(1);
  if (!payment) return { status: 'not_applicable' };
  if (now.getTime() < payment.responseDeadlineAt.getTime()) return { status: 'not_due' };

  let evaluated: Exclude<DeadlineEvaluationResult, { status: 'already_evaluated' | 'not_due' | 'not_applicable' }> | null = null;

  try {
    evaluated = await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select({ id: campaigns.id, status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .for('update')
        .limit(1);

      // A campaign already canceled, refunded, or moved on has nothing left
      // for the deadline to decide. No claim, no record — the sweep's status
      // filter stops asking once the campaign leaves the window's state.
      if (!campaign || campaign.status !== 'affiliate_response_and_build') {
        return null;
      }

      // The exactly-once pivot, claimed first so every effect shares its fate.
      await tx.insert(idempotencyKeys).values({
        key: deadlineEvaluationKey(campaignId),
        purpose: 'response_deadline_evaluation',
        completedAt: new Date(),
        result: { campaignId, deadlineAt: payment.responseDeadlineAt.toISOString() },
      });

      /* §14.2's last bullet, both outcomes: unfinished proposals become
         `expired_no_acceptance` and close. Versions first, then associations. */
      await tx
        .update(proposalVersions)
        .set({ state: 'expired_no_acceptance' })
        .where(
          and(
            eq(proposalVersions.campaignId, campaignId),
            inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
          ),
        );

      const open = await tx
        .select({
          id: campaignAffiliateAssociations.id,
          status: campaignAffiliateAssociations.status,
        })
        .from(campaignAffiliateAssociations)
        .where(
          and(
            eq(campaignAffiliateAssociations.campaignId, campaignId),
            inArray(campaignAffiliateAssociations.status, [...OPEN_STATUSES]),
          ),
        )
        .for('update');

      const expiredAssociationIds: string[] = [];
      for (const association of open) {
        const moved = await transitionAssociation(
          association.id,
          association.status as (typeof OPEN_STATUSES)[number],
          'expired_no_acceptance',
          'system:response_deadline',
          tx,
        );
        if (moved) expiredAssociationIds.push(association.id);
      }

      /* §14.6's question, answered from the agreement table — the only record
         a mutual acceptance produces, and the only record this may read
         (§14.2: nothing may use a version that was not mutually accepted). */
      const lockedCount = await countLockedAcceptances(tx, campaignId);

      // "Zero eligible recruits" vs "no locked mutual acceptance": eligible
      // means the formal opportunity actually opened for someone — the
      // `formal_opened_at` stamp effect 4 writes (§14.6, §25.4).
      const [anyEligible] = await tx
        .select({ id: campaignAffiliateAssociations.id })
        .from(campaignAffiliateAssociations)
        .where(
          and(
            eq(campaignAffiliateAssociations.campaignId, campaignId),
            isNotNull(campaignAffiliateAssociations.formalOpenedAt),
          ),
        )
        .limit(1);

      const outcome =
        lockedCount > 0
          ? ('continues' as const)
          : anyEligible
            ? ('failed_no_mutual_acceptance' as const)
            : ('failed_zero_eligible_recruits' as const);

      if (outcome !== 'continues') {
        /* §23.2: the roster failed; §15 can never mark a failed roster ready,
           which is what "prevent review readiness" means structurally. */
        await tx
          .update(campaigns)
          .set({ affiliateRosterStatus: 'failed', updatedAt: now })
          .where(eq(campaigns.id, campaignId));

        /* §23.1: the lifecycle's own word for this ending. */
        const moved = await tx
          .update(campaigns)
          .set({ status: 'refunded_no_creator', updatedAt: now })
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'affiliate_response_and_build')))
          .returning({ id: campaigns.id });
        if (moved.length === 1) {
          await tx.insert(campaignStatusHistory).values({
            campaignId,
            fromStatus: 'affiliate_response_and_build',
            toStatus: 'refunded_no_creator',
            actor: 'system:response_deadline',
          });
        }
      }

      const [evaluation] = await tx
        .insert(responseDeadlineEvaluations)
        .values({
          campaignId,
          deadlineAt: payment.responseDeadlineAt,
          evaluatedAt: now,
          outcome,
          lockedAcceptanceCount: lockedCount,
          expiredAssociationCount: expiredAssociationIds.length,
        })
        .returning();

      await audit({
        action: 'decision.response_deadline_evaluated',
        targetType: 'campaign',
        targetId: campaignId,
        internalReason:
          `§14.6 evaluation at stored deadline ${payment.responseDeadlineAt.toISOString()}: ` +
          `${lockedCount} locked mutual acceptance(s), ${expiredAssociationIds.length} open decision(s) expired — ${outcome}`,
        newValue: {
          outcome,
          lockedAcceptanceCount: lockedCount,
          expiredAssociationIds,
        },
      });

      return {
        status: 'evaluated' as const,
        outcome,
        evaluation: evaluation!,
        expiredAssociationIds,
        refund: null,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'already_evaluated' };
    throw error;
  }

  if (!evaluated) return { status: 'not_applicable' };

  /* The refund, after the decision committed (§13's promise, Phase 11's one
     path). Its own idempotency makes a crash-and-retry the same refund. */
  if (evaluated.outcome !== 'continues') {
    const refund = await refundListingFee(deps, {
      campaignId,
      trigger:
        evaluated.outcome === 'failed_zero_eligible_recruits'
          ? 'zero_eligible_recruits'
          : 'no_mutual_acceptance',
      actor: 'system:response_deadline',
      internalReason: `§14.6: ${evaluated.outcome} at the stored 72-hour deadline`,
      customerExplanation:
        'No Creator partnership was agreed within the response window, so your entire listing ' +
        'Checkout charge — including its sales tax — is refunded to your original payment method.',
    });
    evaluated = { ...evaluated, refund };

    if (refund.status === 'refunded' || refund.status === 'initiated_unconfirmed') {
      await db
        .update(responseDeadlineEvaluations)
        .set({ refundId: refund.refund.id })
        .where(eq(responseDeadlineEvaluations.id, evaluated.evaluation.id));
    }
  }

  return evaluated;
}

/**
 * Completes the refund for a failed evaluation whose provider call did not
 * confirm — the sweep calls this on every pass, and `refundListingFee`'s
 * stable idempotency key makes each retry the same refund at Stripe.
 */
export async function retryUnconfirmedDeadlineRefunds(deps: DeadlineDeps): Promise<string[]> {
  const { db } = deps;
  const failed = await db
    .select({ campaignId: responseDeadlineEvaluations.campaignId, outcome: responseDeadlineEvaluations.outcome })
    .from(responseDeadlineEvaluations)
    .where(isNull(responseDeadlineEvaluations.refundId));

  const retried: string[] = [];
  for (const row of failed) {
    if (row.outcome === 'continues') continue;
    const refund = await refundListingFee(deps, {
      campaignId: row.campaignId,
      trigger:
        row.outcome === 'failed_zero_eligible_recruits'
          ? 'zero_eligible_recruits'
          : 'no_mutual_acceptance',
      actor: 'system:response_deadline',
      internalReason: 'retrying the §14.6 refund whose provider confirmation is missing',
      customerExplanation:
        'No Creator partnership was agreed within the response window, so your entire listing ' +
        'Checkout charge — including its sales tax — is refunded to your original payment method.',
    });
    if (refund.status === 'refunded' || refund.status === 'initiated_unconfirmed') {
      await db
        .update(responseDeadlineEvaluations)
        .set({ refundId: refund.refund.id })
        .where(
          and(
            eq(responseDeadlineEvaluations.campaignId, row.campaignId),
            isNull(responseDeadlineEvaluations.refundId),
          ),
        );
      retried.push(row.campaignId);
    }
  }
  return retried;
}

/** Campaigns whose stored deadline has passed while still in the window. */
export async function findDueDeadlines(db: Database, now: Date): Promise<string[]> {
  const rows = await db
    .select({ campaignId: listingFeePayments.campaignId })
    .from(listingFeePayments)
    .innerJoin(campaigns, eq(campaigns.id, listingFeePayments.campaignId))
    .where(
      and(
        lte(listingFeePayments.responseDeadlineAt, now),
        eq(campaigns.status, 'affiliate_response_and_build'),
      ),
    );
  return rows.map((r) => r.campaignId);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
