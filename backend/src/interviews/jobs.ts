/**
 * Scheduled interview work — Spec §12, §6, §28.3.
 *
 * Two jobs, and neither invents a number.
 *
 * ── The reminder ───────────────────────────────────────────────────────────
 * §12 requires a reminder; §6 names "interview reminder lead times" as a
 * setting and fixes no value. So `sendDueReminders` reads the setting and, while
 * it is unset, sends nothing and says so. A default of "24 hours" would be a
 * commercial rule invented in code (§1 rule 6), and a reminder that arrives at
 * the wrong distance is worse than none.
 *
 * Dedup is `notification_deliveries`, keyed on the booking AND its scheduled
 * time — so a Founder who reschedules gets a reminder for the new time, and a
 * job that runs every ten minutes sends one reminder rather than one per run.
 * That is the same reasoning §7 applies to a resent invitation: key on the thing
 * that may legitimately happen twice.
 *
 * ── Abandonment ────────────────────────────────────────────────────────────
 * §12 lists "abandoned" among the states that do not count and does not define
 * when a booking becomes one. So this defines it by the only fact available
 * rather than by a window: a booking that was never confirmed and whose slot has
 * now passed was not attended. No grace period is invented, because a grace
 * period is a rule and §1 rule 6 forbids inventing one.
 *
 * The transition matters because `selected` counts toward high-effort (§12 uses
 * "scheduled/confirmed" for that input). A slot nobody confirmed and nobody
 * attended must stop counting, or a Founder who abandoned a booking a month ago
 * is still classified as having engaged.
 *
 * Both jobs are safe to run twice: the reminder's dedup swallows a repeat, and
 * the abandonment sweep's conditional UPDATE matches nothing on a second pass.
 */

import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { founderInterviewBookings } from '../db/schema/workspace.js';
import { readSettingValue, SettingNotConfigured } from '../settings/service.js';
import { cancelBooking, confirmBooking } from '../workspace/interview.js';
import type { Scheduler as SchedulerPort } from './calcom.js';
import { evaluateWorkspace } from '../workspace/service.js';
import { interviewBookingEvents } from '../db/schema/workspace.js';
import type { Notifier } from '../notifications/send.js';
import { notifyInterview, type InterviewNotificationContext } from './notifications.js';

export const REMINDER_SETTING_KEY = 'interview_reminder_lead_hours';

export interface ReminderResult {
  /** Null when §6's lead time has no value. Nothing was sent. */
  leadHours: number | null;
  considered: number;
  sent: number;
  duplicates: number;
  skipped: number;
}

/**
 * Sends the reminder for every confirmed booking now inside the §6 lead window.
 *
 * The window is "between now and now + lead", so a booking further out is left
 * for a later run and one already in the past is not reminded about at all —
 * a reminder for a meeting that has started is noise, and §27.2's rule against
 * useless mail applies as much as its rule against duplicates.
 */
export async function sendDueReminders(
  db: Database,
  notifier: Notifier,
  context: InterviewNotificationContext,
): Promise<ReminderResult> {
  let leadHours: number;
  try {
    const value = await readSettingValue(db, REMINDER_SETTING_KEY);
    if (typeof value !== 'number') {
      return { leadHours: null, considered: 0, sent: 0, duplicates: 0, skipped: 0 };
    }
    leadHours = value;
  } catch (error) {
    if (error instanceof SettingNotConfigured) {
      // §6 names the setting and fixes no number. Unset means no reminders,
      // visibly — not a default nobody chose.
      return { leadHours: null, considered: 0, sent: 0, duplicates: 0, skipped: 0 };
    }
    throw error;
  }

  const due = await db
    .select({ id: founderInterviewBookings.id })
    .from(founderInterviewBookings)
    .where(
      and(
        eq(founderInterviewBookings.status, 'confirmed'),
        isNotNull(founderInterviewBookings.scheduledAt),
        sql`${founderInterviewBookings.scheduledAt} > now()`,
        sql`${founderInterviewBookings.scheduledAt} <= now() + (${leadHours} * interval '1 hour')`,
      ),
    );

  const result: ReminderResult = {
    leadHours,
    considered: due.length,
    sent: 0,
    duplicates: 0,
    skipped: 0,
  };

  for (const booking of due) {
    const { outcome } = await notifyInterview(db, notifier, context, {
      bookingId: booking.id,
      kind: 'reminder',
    });
    if (outcome.status === 'sent') result.sent += 1;
    else if (outcome.status === 'duplicate') result.duplicates += 1;
    else result.skipped += 1;
  }

  return result;
}

/* ── Abandonment ──────────────────────────────────────────────────────────── */

export interface AbandonmentResult {
  abandoned: string[];
}

/**
 * Marks a never-confirmed booking whose slot has passed as `abandoned`.
 *
 * Uses `cancelBooking`'s sibling path rather than a bare UPDATE so the history
 * row, the re-evaluation, and §12's lock all apply exactly as they do to every
 * other transition — including §33.3.3's rule that after payment nothing moves.
 * A Founder is not emailed: §12 asks for a cancellation notification, and this
 * is not a cancellation, it is the recording of something that already did not
 * happen. Telling someone their expired slot expired is noise.
 */
export async function sweepAbandonedBookings(db: Database): Promise<AbandonmentResult> {
  const stale = await db
    .select({ id: founderInterviewBookings.id, campaignId: founderInterviewBookings.campaignId })
    .from(founderInterviewBookings)
    .where(
      and(
        eq(founderInterviewBookings.status, 'selected'),
        isNotNull(founderInterviewBookings.scheduledAt),
        lt(founderInterviewBookings.scheduledAt, new Date()),
      ),
    );

  const abandoned: string[] = [];

  for (const booking of stale) {
    // Each booking is its own transaction. One campaign's failure must not roll
    // back another's — the same decision §10's reveal made, for the same reason.
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(founderInterviewBookings)
        .set({ status: 'abandoned', updatedAt: new Date() })
        .where(
          and(
            eq(founderInterviewBookings.id, booking.id),
            // Conditional on the status we read, so two overlapping runs cannot
            // both transition the same row.
            eq(founderInterviewBookings.status, 'selected'),
          ),
        )
        .returning({ id: founderInterviewBookings.id });

      if (updated.length === 0) return;

      await tx.insert(interviewBookingEvents).values({
        bookingId: booking.id,
        campaignId: booking.campaignId,
        event: 'abandoned',
        priorStatus: 'selected',
        newStatus: 'abandoned',
        reason: 'the slot passed without the booking being confirmed',
        source: 'system:interview-abandonment',
        actor: 'system:interview-abandonment',
      });

      // §12: `selected` counts toward high-effort and `abandoned` does not, so
      // the classification has to move with the status.
      await evaluateWorkspace(tx, {
        campaignId: booking.campaignId,
        actor: 'system:interview-abandonment',
        trigger: 'interview_abandoned',
      });

      abandoned.push(booking.id);
    });
  }

  return { abandoned };
}

/* ── Reconciliation ───────────────────────────────────────────────────────── */

export interface ReconcileResult {
  checked: number;
  confirmed: string[];
  canceled: string[];
  unavailable: boolean;
}

/**
 * Asks the provider what it thinks, for bookings we may have missed an event
 * about.
 *
 * Phase 09's trap: "Cal.com is a source of events, not truth. If the webhook is
 * missed, the booking state must be reconcilable — don't leave `confirmed`
 * reachable only by webhook." A dropped delivery would otherwise cost the
 * Founder a US$2 discount and misclassify their high-effort status, and neither
 * is something they could see was wrong.
 *
 * Only `selected` bookings are checked: a confirmed one has nothing to gain, and
 * a canceled one is terminal. The transitions go through the same 09a services
 * the webhook uses, with `source` naming reconciliation — so an Admin reading
 * the booking history can always tell which arrived how.
 */
export async function reconcilePendingBookings(
  db: Database,
  scheduler: SchedulerPort,
  notifier: Notifier,
  context: InterviewNotificationContext,
): Promise<ReconcileResult> {
  if (!scheduler.configured) {
    return { checked: 0, confirmed: [], canceled: [], unavailable: true };
  }

  const pending = await db
    .select({
      id: founderInterviewBookings.id,
      campaignId: founderInterviewBookings.campaignId,
      uid: founderInterviewBookings.externalBookingId,
      link: founderInterviewBookings.meetingLink,
      interviewer: founderInterviewBookings.interviewer,
    })
    .from(founderInterviewBookings)
    .where(
      and(
        eq(founderInterviewBookings.status, 'selected'),
        isNotNull(founderInterviewBookings.externalBookingId),
      ),
    );

  const result: ReconcileResult = {
    checked: pending.length,
    confirmed: [],
    canceled: [],
    unavailable: false,
  };

  for (const booking of pending) {
    const vendor = await scheduler.fetchBooking(booking.uid!);
    if (!vendor) continue;

    const status = (vendor.vendorStatus ?? '').toUpperCase();
    const source = 'reconciliation:calcom';
    const actor = 'system:interview-reconciliation';

    if (status === 'ACCEPTED') {
      const confirmed = await confirmBooking(db, {
        bookingId: booking.id,
        campaignId: booking.campaignId,
        ...(vendor.meetingLink ?? booking.link ? { meetingLink: (vendor.meetingLink ?? booking.link)! } : {}),
        ...(vendor.interviewer ?? booking.interviewer
          ? { interviewer: (vendor.interviewer ?? booking.interviewer)! }
          : {}),
        actor,
        source,
      });
      if (confirmed.ok) {
        result.confirmed.push(booking.id);
        // The notification the missed webhook owed. `notification_deliveries`
        // makes it exactly one even if the delivery later turns up.
        await notifyInterview(db, notifier, context, {
          bookingId: booking.id,
          kind: 'confirmed',
        });
      }
      continue;
    }

    if (status === 'CANCELLED' || status === 'REJECTED') {
      const canceled = await cancelBooking(db, {
        bookingId: booking.id,
        campaignId: booking.campaignId,
        actor,
        source,
        reason: vendor.cancellationReason?.trim() || 'Canceled in the booking provider',
      });
      if (canceled.ok) {
        result.canceled.push(booking.id);
        await notifyInterview(db, notifier, context, {
          bookingId: booking.id,
          kind: 'canceled',
        });
      }
    }
  }

  return result;
}
