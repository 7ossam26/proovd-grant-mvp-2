/**
 * §31.8's Backer status progression and satisfaction — Spec §31.8, §30,
 * §33.10.10 (Phase 21b).
 *
 * ── The progression is derived and never predicts ───────────────────────────
 * §31.8: "derived from real state and never predicts an unconfirmed outcome."
 * `backerProgression` reads the reservation's stored status and the campaign's
 * fulfillment record, and every step it returns is one a record already
 * supports. There is no branch that shows "Delivery due" because a charge
 * succeeded and delivery therefore *ought* to follow — `delivery_due` appears
 * only while the campaign owes a delivery it has not made, and `delivered`
 * only once 21a recorded one.
 *
 * ── One click, and the database is what makes it one ────────────────────────
 * §31.8: "starts with one click … takes under 30 seconds". The answer is
 * written by a single call with no prerequisite, the reason is a separate
 * optional call afterwards, and the unique index makes a second ask
 * impossible. §33.10.10's "under 30 seconds" is not timed — it is the absence
 * of anything to do first.
 *
 * ── And there is nowhere to put a newsletter ────────────────────────────────
 * §31.8: "does not coerce newsletter consent." This module writes no consent,
 * reads no preference, and the table has no consent column — the suite asserts
 * that in `information_schema`. The strongest form of a promise not to ask is
 * having nowhere to record an answer.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations } from '../db/schema/domain.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { campaignFulfillment } from '../db/schema/fulfillment.js';
import { backerSatisfactionResponses } from '../db/schema/completion.js';
import { supportCases } from '../db/schema/support.js';
import { openSupportCase } from '../support/cases.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  BACKER_PROGRESSION,
  satisfactionIsNegative,
  type BackerProgressionKey,
  type SatisfactionScale,
} from './logic.js';

export interface SatisfactionDeps {
  db: Database;
  audit: AuditWriter;
}

export interface ProgressionStep {
  key: BackerProgressionKey;
  label: string;
  /** `done` | `current` | `upcoming`. Never `upcoming` for an outcome. */
  state: 'done' | 'current' | 'upcoming';
}

/**
 * The step a pre-order is actually at, from its stored status and whether the
 * campaign has recorded a delivery.
 *
 * Pure, and exported, because Session F's Backers page needs the same answer
 * for a whole campaign at once and a per-row `backerProgression` call would be
 * an N+1. Two implementations of "where is this pre-order" is two answers, and
 * the one nobody updated is the one a Founder acts on — so there is one rule
 * with two callers rather than a batched copy of it.
 */
export function backerProgressionStep(
  status: string,
  delivered: boolean,
): BackerProgressionKey {
  if (status === 'reserved_active') return 'reserved';
  if (status === 'pending_capture') return 'charge_due';
  if (
    status === 'threshold_not_met_no_charge' ||
    status === 'killed_no_charge' ||
    status === 'reserved_canceled'
  ) {
    return 'no_charge';
  }
  if (status === 'capture_failed_retrying' || status === 'capture_failed_dropped') return 'failed';
  if (status === 'refunded' || status === 'reversed' || status === 'disputed') return 'refunded';
  // Captured. Whether that reads as captured, delivery due, or delivered is
  // a fact about the campaign's fulfillment record, not about the money.
  if (delivered) return 'delivered';
  return 'delivery_due';
}

/**
 * §31.8's progression for one reservation.
 *
 * Outcome steps — `no_charge`, `failed`, `refunded` — are returned ONLY when
 * they have happened. §31.8's "never predicts an unconfirmed outcome" means a
 * Backer whose charge is due must not see "Failed" greyed out ahead of them,
 * because a greyed-out step is still a step the product has put in front of
 * someone (§30).
 */
export async function backerProgression(
  db: Database,
  reservationId: string,
): Promise<ProgressionStep[]> {
  const [row] = await db
    .select({
      status: reservations.status,
      campaignId: reservations.campaignId,
      deliveredAt: campaignFulfillment.deliveryNotifiedAt,
    })
    .from(reservations)
    .leftJoin(campaignFulfillment, eq(campaignFulfillment.campaignId, reservations.campaignId))
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!row) return [];

  const current = backerProgressionStep(row.status as string, row.deliveredAt != null);
  const order = BACKER_PROGRESSION.map((s) => s.key);
  const currentIndex = order.indexOf(current);

  /*
   * Which steps this reservation's path includes at all. A path that ended in
   * `no_charge` never had a `captured` step to grey out, and one still running
   * has no outcome step yet — showing either would be the prediction §31.8
   * forbids.
   */
  const terminalOutcomes: BackerProgressionKey[] = ['no_charge', 'failed', 'refunded'];

  return BACKER_PROGRESSION.filter((step) => {
    if (terminalOutcomes.includes(step.key)) return step.key === current;
    return order.indexOf(step.key) <= Math.max(currentIndex, 0);
  }).map((step) => ({
    key: step.key,
    label: step.label,
    state: step.key === current ? ('current' as const) : ('done' as const),
  }));
}

export type SatisfactionRefusal =
  | 'not_found'
  | 'not_delivered'
  | 'already_answered'
  | 'invalid_answer';

export type SatisfactionOutcome =
  | { ok: true; responseId: string; negative: boolean; followupCaseId: string | null }
  | { ok: false; code: SatisfactionRefusal; message: string };

/**
 * The one click. §31.8: "After delivery, satisfaction starts with one click."
 *
 * Refuses before delivery, because a satisfaction question about something
 * that has not arrived is not a question anyone can answer — and asking it
 * would be the engagement prompt §30 forbids wearing a survey's clothes.
 */
export async function recordSatisfaction(
  deps: SatisfactionDeps,
  input: {
    reservationId: string;
    scale: SatisfactionScale;
    satisfied?: boolean | undefined;
    rating?: number | undefined;
    actor: string;
  },
): Promise<SatisfactionOutcome> {
  const { db } = deps;

  const [row] = await db
    .select({
      id: reservations.id,
      status: reservations.status,
      campaignId: reservations.campaignId,
      backerIdentityId: reservations.backerIdentityId,
      email: backerIdentities.email,
      deliveredAt: campaignFulfillment.deliveryNotifiedAt,
    })
    .from(reservations)
    .innerJoin(backerIdentities, eq(backerIdentities.id, reservations.backerIdentityId))
    .leftJoin(campaignFulfillment, eq(campaignFulfillment.campaignId, reservations.campaignId))
    .where(eq(reservations.id, input.reservationId))
    .limit(1);
  if (!row) return { ok: false, code: 'not_found', message: 'No such pre-order.' };

  if (row.deliveredAt == null) {
    return {
      ok: false,
      code: 'not_delivered',
      message: 'Nothing has been delivered on this campaign yet, so there is nothing to rate.',
    };
  }

  // The answer must match the scale. The CHECK refuses it too; this names it.
  const validBinary = input.scale === 'binary' && typeof input.satisfied === 'boolean';
  const validRating =
    input.scale === 'rating_1_5' &&
    typeof input.rating === 'number' &&
    Number.isInteger(input.rating) &&
    input.rating >= 1 &&
    input.rating <= 5;
  if (!validBinary && !validRating) {
    return {
      ok: false,
      code: 'invalid_answer',
      message: 'Answer either satisfied / not satisfied, or a rating from 1 to 5.',
    };
  }

  const [existing] = await db
    .select({ id: backerSatisfactionResponses.id })
    .from(backerSatisfactionResponses)
    .where(eq(backerSatisfactionResponses.reservationId, input.reservationId))
    .limit(1);
  if (existing) {
    // §30's "no second ask", answered rather than refused silently. Someone who
    // already told us is told we have it, not asked again.
    return {
      ok: false,
      code: 'already_answered',
      message: 'You have already told us how this went. Thank you — we have it.',
    };
  }

  const negative = satisfactionIsNegative({
    scale: input.scale,
    satisfied: input.satisfied,
    rating: input.rating,
  });

  /*
   * §31.8: "a negative response creates an owned Admin follow-up task." One
   * case, opened through 16b's `openSupportCase` so it is born with a stable
   * reference, an owner, a §27.8 due time, and the campaign context — the same
   * machinery every other case uses, rather than a second kind of task.
   *
   * Proovd owns it, not the Founder: the Backer has not asked for anything and
   * routing an unsolicited follow-up to the Founder would hand a Founder a
   * complaint the Backer never chose to make (§29.10 routes what the BACKER
   * raises; this is what WE noticed).
   */
  let followupCaseId: string | null = null;
  if (negative) {
    const opened = await openSupportCase(db, {
      topic: 'dissatisfaction_followup',
      owner: 'proovd_support',
      requesterKind: 'backer',
      backerIdentityId: row.backerIdentityId,
      requesterEmail: row.email,
      campaignId: row.campaignId,
      reservationId: row.id,
      message:
        input.scale === 'binary'
          ? 'The Backer told us they were not satisfied with what was delivered.'
          : `The Backer rated the delivery ${String(input.rating)} out of 5.`,
      createdBy: 'system:satisfaction',
    });
    if (opened.ok) followupCaseId = opened.result.caseId;
  }

  const [response] = await db
    .insert(backerSatisfactionResponses)
    .values({
      reservationId: input.reservationId,
      campaignId: row.campaignId,
      backerIdentityId: row.backerIdentityId,
      scale: input.scale,
      satisfied: input.scale === 'binary' ? (input.satisfied ?? null) : null,
      rating: input.scale === 'rating_1_5' ? (input.rating ?? null) : null,
      isNegative: negative,
      followupCaseId,
    })
    .returning({ id: backerSatisfactionResponses.id });

  await deps.audit({
    action: 'satisfaction.recorded',
    targetType: 'reservation',
    targetId: input.reservationId,
    internalReason: `§31.8 satisfaction recorded (${input.scale}); negative=${String(negative)}`,
    newValue: { responseId: response!.id, followupCaseId },
    actorId: input.actor,
  });

  return { ok: true, responseId: response!.id, negative, followupCaseId };
}

/**
 * §31.8: "then optional reason." A separate call, after the answer, and never
 * a precondition for it. Nothing refuses a person who never comes back to it.
 */
export async function addSatisfactionReason(
  deps: SatisfactionDeps,
  input: { reservationId: string; reason: string; actor: string },
): Promise<{ ok: boolean }> {
  const trimmed = input.reason.trim();
  if (!trimmed) return { ok: false };

  const moved = await deps.db
    .update(backerSatisfactionResponses)
    .set({ reason: trimmed })
    .where(eq(backerSatisfactionResponses.reservationId, input.reservationId))
    .returning({ id: backerSatisfactionResponses.id });

  if (moved.length !== 1) return { ok: false };

  await deps.audit({
    action: 'satisfaction.reason_added',
    targetType: 'reservation',
    targetId: input.reservationId,
    internalReason: '§31.8 optional reason supplied after the answer.',
    actorId: input.actor,
  });
  return { ok: true };
}

/** Whether this reservation still owes an answer, for the surface to decide. */
export async function satisfactionState(
  db: Database,
  reservationId: string,
): Promise<{ askable: boolean; answered: boolean; reason: string | null }> {
  const [row] = await db
    .select({
      deliveredAt: campaignFulfillment.deliveryNotifiedAt,
      status: reservations.status,
    })
    .from(reservations)
    .leftJoin(campaignFulfillment, eq(campaignFulfillment.campaignId, reservations.campaignId))
    .where(eq(reservations.id, reservationId))
    .limit(1);

  const [answer] = await db
    .select({ id: backerSatisfactionResponses.id, reason: backerSatisfactionResponses.reason })
    .from(backerSatisfactionResponses)
    .where(eq(backerSatisfactionResponses.reservationId, reservationId))
    .limit(1);

  return {
    askable: row?.deliveredAt != null && answer === undefined,
    answered: answer !== undefined,
    reason: answer?.reason ?? null,
  };
}

/** Every negative response on a campaign, with its owned case. For Admin. */
export async function listNegativeResponses(db: Database, campaignId: string) {
  return db
    .select({
      responseId: backerSatisfactionResponses.id,
      reservationId: backerSatisfactionResponses.reservationId,
      scale: backerSatisfactionResponses.scale,
      rating: backerSatisfactionResponses.rating,
      reason: backerSatisfactionResponses.reason,
      answeredAt: backerSatisfactionResponses.answeredAt,
      caseReference: supportCases.reference,
      caseOwner: supportCases.owner,
      caseStatus: supportCases.status,
    })
    .from(backerSatisfactionResponses)
    .leftJoin(supportCases, eq(supportCases.id, backerSatisfactionResponses.followupCaseId))
    .where(
      and(
        eq(backerSatisfactionResponses.campaignId, campaignId),
        eq(backerSatisfactionResponses.isNegative, true),
      ),
    )
    .orderBy(desc(backerSatisfactionResponses.answeredAt));
}

