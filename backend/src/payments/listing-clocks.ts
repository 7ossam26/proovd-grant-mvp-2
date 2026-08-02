/**
 * The two §6 clocks, watched — Spec §14.6, §31.6, §29.6, §33.3.7.
 *
 * Both deadlines were computed at payment and stored on the payment row; this
 * job only *notices* them. §29.6's rule is why nothing here recomputes: a
 * settings edit after payment changes later payments, never a promise already
 * made.
 *
 * ── What firing means in Phase 11 ───────────────────────────────────────────
 * The §14.6 evaluation at the 72-hour mark — count acceptances, fail the
 * roster, refund — is Phase 12's, by the phase brief's own scope line. Until
 * that exists, §1 rule 6's default applies: the reached deadline is recorded,
 * exactly once, and routed to Admin review with the refund path standing ready
 * (`refundListingFee` — built this phase so Phase 12 calls it rather than
 * inventing a second one). The 48-hour mark closes the free-cancellation
 * window; eligibility is derived from the stored deadline at decision time, so
 * this records the closure for Admin's clock view and changes nothing.
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

export interface ListingClockSweepResult {
  responseDeadlinesReached: string[];
  freeWindowsClosed: string[];
}

export async function sweepListingDeadlines(
  db: Database,
  audit: AuditWriter,
  now: Date = new Date(),
): Promise<ListingClockSweepResult> {
  const responseDeadlinesReached: string[] = [];
  const freeWindowsClosed: string[] = [];

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
            `the 72-hour response deadline (${row.responseDeadlineAt.toISOString()}) has passed. ` +
            'The §14.6 evaluation is not yet automated (Phase 12); this is recorded and routed to ' +
            'Admin review, and the refund path stands ready if the promise applies (§1 rule 6, §1.3).',
        });
      }
    }
  }

  return { responseDeadlinesReached, freeWindowsClosed };
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
