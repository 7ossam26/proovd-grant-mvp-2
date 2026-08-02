/**
 * The two §6 clocks, watched — Spec §14.6, §31.6, §29.6, §33.3.7.
 *
 * Both deadlines were computed at payment and stored on the payment row; this
 * job only *notices* them. §29.6's rule is why nothing here recomputes: a
 * settings edit after payment changes later payments, never a promise already
 * made.
 *
 * ── What firing means since Phase 12a ───────────────────────────────────────
 * The reached 72-hour deadline is still recorded exactly once for Admin's
 * clock view, and now the §14.6 evaluation runs: count locked mutual
 * acceptances, expire unfinished proposals, and — when the roster failed —
 * refund the entire Checkout total through Phase 11's one refund path and
 * notify everyone. The evaluation lives in `affiliates/deadline.ts` and is
 * independently exactly-once, so a sweep that runs twice evaluates once. The
 * 48-hour mark closes the free-cancellation window; eligibility is derived
 * from the stored deadline at decision time, so this records the closure for
 * Admin's clock view and changes nothing.
 *
 * ── Exactly once, per §28.3 ─────────────────────────────────────────────────
 * `idempotency_keys` pivots each firing on the campaign, so a sweep that runs
 * twice, overlaps itself, or crashes mid-run records each deadline once. The
 * same table the payment and the reveal use; no fourth mechanism.
 */

import { and, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from './stripe-client.js';
import type { Notifier } from '../notifications/send.js';
import {
  evaluateResponseDeadline,
  retryUnconfirmedDeadlineRefunds,
  type DeadlineEvaluationResult,
} from '../affiliates/deadline.js';
import { notifyProposalsExpired } from '../affiliates/decision-notifications.js';
import { notifyListingRefund, type ListingNotificationContext } from './listing-notifications.js';

export interface ListingClockSweepResult {
  responseDeadlinesReached: string[];
  freeWindowsClosed: string[];
  /** The §14.6 evaluations this pass performed (Phase 12a). */
  evaluations: Array<{ campaignId: string; result: DeadlineEvaluationResult }>;
}

/**
 * What the §14.6 evaluation needs beyond the clock itself. Optional so the
 * clock view keeps working in a deployment where the gateway is not wired
 * (tests of the notice path); when absent the reached deadline is recorded and
 * the evaluation waits for a caller that can refund.
 */
export interface DeadlineEvaluationDeps {
  gateway: StripeGateway;
  notifier?: Notifier;
  notificationContext?: ListingNotificationContext;
}

export async function sweepListingDeadlines(
  db: Database,
  audit: AuditWriter,
  now: Date = new Date(),
  evaluation?: DeadlineEvaluationDeps,
): Promise<ListingClockSweepResult> {
  const responseDeadlinesReached: string[] = [];
  const freeWindowsClosed: string[] = [];
  const evaluations: ListingClockSweepResult['evaluations'] = [];

  const due = await db
    .select({
      campaignId: listingFeePayments.campaignId,
      responseDeadlineAt: listingFeePayments.responseDeadlineAt,
      freeCancellationDeadlineAt: listingFeePayments.freeCancellationDeadlineAt,
      campaignStatus: campaigns.status,
    })
    .from(listingFeePayments)
    .innerJoin(campaigns, eq(campaigns.id, listingFeePayments.campaignId))
    .where(lte(listingFeePayments.freeCancellationDeadlineAt, now));

  for (const row of due) {
    // The 48-hour window closing. Recorded once; §31.6 eligibility is derived
    // from the stored deadline wherever it is decided, never from this row.
    if (row.freeCancellationDeadlineAt.getTime() <= now.getTime()) {
      const claimed = await claimOnce(db, `listing_free_window_closed:${row.campaignId}`, {
        campaignId: row.campaignId,
        closedAt: row.freeCancellationDeadlineAt.toISOString(),
      });
      if (claimed) {
        freeWindowsClosed.push(row.campaignId);
        await audit({
          action: 'listing.free_cancellation_window_closed',
          targetType: 'campaign',
          targetId: row.campaignId,
          internalReason: `the §31.6 free-cancellation window closed at ${row.freeCancellationDeadlineAt.toISOString()}; cancellation now requires Admin approval`,
        });
      }
    }

    // The 72-hour response deadline. Only meaningful while the campaign still
    // sits in the window's state — a canceled or refunded campaign has nothing
    // left for the deadline to decide.
    if (
      row.responseDeadlineAt.getTime() <= now.getTime() &&
      row.campaignStatus === 'affiliate_response_and_build'
    ) {
      const claimed = await claimOnce(db, `listing_response_deadline_reached:${row.campaignId}`, {
        campaignId: row.campaignId,
        deadlineAt: row.responseDeadlineAt.toISOString(),
      });
      if (claimed) {
        responseDeadlinesReached.push(row.campaignId);
        await audit({
          action: 'listing.response_deadline_reached',
          targetType: 'campaign',
          targetId: row.campaignId,
          internalReason:
            `the 72-hour response deadline (${row.responseDeadlineAt.toISOString()}) has passed; ` +
            'the §14.6 evaluation decides what it means (Phase 12a).',
        });
      }

      /* The §14.6 evaluation itself (Phase 12a). Independently exactly-once,
         so running it on a deadline recorded by an earlier pass is safe — and
         necessary, because a crash between the notice and the evaluation must
         cost a retry, never the refund promise. */
      if (evaluation) {
        const result = await evaluateResponseDeadline(
          { db, gateway: evaluation.gateway, audit },
          row.campaignId,
          now,
        );
        evaluations.push({ campaignId: row.campaignId, result });

        if (
          result.status === 'evaluated' &&
          result.outcome !== 'continues' &&
          evaluation.notifier &&
          evaluation.notificationContext
        ) {
          await notifyProposalsExpired(db, evaluation.notifier, evaluation.notificationContext, {
            expiredAssociationIds: result.expiredAssociationIds,
          });
          // The Founder's refund message rides the recorded refund; dedup on
          // the refund row makes a second pass a duplicate, not a second email.
          await notifyListingRefund(db, evaluation.notifier, evaluation.notificationContext, {
            campaignId: row.campaignId,
          });
        }
      }
    }
  }

  // A failed evaluation whose refund never confirmed is retried on every pass;
  // the stable provider idempotency key makes each retry the same refund.
  if (evaluation) {
    await retryUnconfirmedDeadlineRefunds({ db, gateway: evaluation.gateway, audit });
  }

  return { responseDeadlinesReached, freeWindowsClosed, evaluations };
}

/** Insert-or-skip on the shared idempotency table. True when this run claimed it. */
async function claimOnce(
  db: Database,
  key: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const claimed = await db
    .insert(idempotencyKeys)
    .values({ key, purpose: 'listing_clock', completedAt: new Date(), result })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  return claimed.length === 1;
}

/** Has a given clock already fired? Admin's reconciliation read. */
export async function clockFired(db: Database, key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: idempotencyKeys.id })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key)))
    .limit(1);
  return Boolean(row);
}
