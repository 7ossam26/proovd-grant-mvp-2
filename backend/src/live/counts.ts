/**
 * New, canceled, and net pre-order counts — Spec §20, §33.6.9 (Phase 17a).
 *
 * §20: "Store new pre-orders, cancellations, and net change separately."
 *
 * ── Why there is no counters table ──────────────────────────────────────────
 * They are already stored separately, and more strongly than a counter could:
 * `reservation_status_history` is append-only and holds one row per transition,
 * written by the pre-order (`reservations/preorder.ts`), the cancellation
 * (`reservations/cancellation.ts`), and the kill (`support/enforcement.ts`). A
 * second set of counters would be Phase 16b's timeline mistake in a different
 * phase — a summary that can drift from the record it summarises — except worse,
 * because a Founder reads this one and acts on it. Every increment site is a
 * place someone can forget; a composition has no increment sites.
 *
 * ── The identity holds by construction ──────────────────────────────────────
 * The four numbers partition one set. `new` is every reservation that ever became
 * active; the other three count that same set by *current* status, so
 * active + canceled + otherExits = new always, and `reconcileCounts` throwing is
 * a genuine impossibility rather than a routine risk. §33.6.9 asserts it anyway,
 * because the value of the arrangement is that the assertion is cheap.
 *
 * `otherExits` exists because a reservation can leave the active set without a
 * Backer cancelling it — a kill closes one `killed_no_charge` (§23.5, §26.7), and
 * a close batch will move them to `pending_capture` (Phase 18). Counting those as
 * cancellations would tell a Founder that Backers changed their minds when they
 * did not.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations, reservationStatusHistory } from '../db/schema/domain.js';
import { reconcileCounts } from './logic.js';

export interface PreorderCounts {
  /** Every pre-order ever placed on this campaign. */
  newCount: number;
  /** Of those, the ones the Backer ended. */
  canceledCount: number;
  /** Of those, the ones that left the active set some other way (§26.7 kill). */
  otherExits: number;
  activeCount: number;
  /** new − canceled. What Backers did, net. */
  netChange: number;
  /** §21's threshold measure: distinct Backers behind the active pre-orders. */
  uniqueActiveBackers: number;
  /** Whether this campaign has ever had a pre-order (§20's first milestone). */
  everHadPreorder: boolean;
}

/**
 * Composes §20's counts for one campaign.
 *
 * One query for the partition and one for the distinct Backer count — the second
 * is not derivable from the first, because a Product Backer may hold several
 * active transactions (§4.2) and the threshold counts people, not pre-orders
 * (§21).
 */
export async function readPreorderCounts(
  db: Database,
  campaignId: string,
): Promise<PreorderCounts> {
  // Every reservation on this campaign that ever reached `reserved_active`. The
  // creation row (from_status NULL) is what makes "ever placed" a fact rather
  // than an inference from the current status of a row that has since moved on.
  const everActive = db
    .select({ reservationId: reservationStatusHistory.reservationId })
    .from(reservationStatusHistory)
    .innerJoin(reservations, eq(reservations.id, reservationStatusHistory.reservationId))
    .where(
      and(
        eq(reservations.campaignId, campaignId),
        eq(reservationStatusHistory.toStatus, 'reserved_active'),
      ),
    )
    .groupBy(reservationStatusHistory.reservationId);

  const [partition] = await db
    .select({
      newCount: sql<number>`count(*)::int`,
      activeCount: sql<number>`count(*) filter (where ${reservations.status} = 'reserved_active')::int`,
      canceledCount: sql<number>`count(*) filter (where ${reservations.status} = 'reserved_canceled')::int`,
      otherExits: sql<number>`count(*) filter (where ${reservations.status} not in ('reserved_active', 'reserved_canceled'))::int`,
    })
    .from(reservations)
    .where(inArray(reservations.id, everActive));

  const [backers] = await db
    .select({
      uniqueActiveBackers: sql<number>`count(distinct ${reservations.backerIdentityId})::int`,
    })
    .from(reservations)
    .where(and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')));

  const counts = reconcileCounts({
    newCount: Number(partition?.newCount ?? 0),
    canceledCount: Number(partition?.canceledCount ?? 0),
    otherExits: Number(partition?.otherExits ?? 0),
    activeCount: Number(partition?.activeCount ?? 0),
  });

  return {
    ...counts,
    uniqueActiveBackers: Number(backers?.uniqueActiveBackers ?? 0),
    everHadPreorder: counts.newCount > 0,
  };
}
