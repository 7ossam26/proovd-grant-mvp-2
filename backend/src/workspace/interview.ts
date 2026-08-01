/**
 * The Founder interview booking — Spec §12, §6, tech-stack §12, §33.3.3.
 *
 * ── The record is ours; a vendor is an input to it ──────────────────────────
 * tech-stack §12: "The booking record in our database is the source of truth,
 * populated from Cal.com webhooks. `interview_confirmed` is a domain state that
 * gates a US$2 listing-fee discount and one third of the high-effort
 * classification — it cannot live in a vendor's system."
 *
 * So every transition below takes a `source` — `founder`, `admin`,
 * `provider:<name>` — and none of them is privileged. Phase 09's trap says why:
 * "Cal.com is a source of events, not truth. If the webhook is missed, the
 * booking state must be reconcilable — don't leave `confirmed` reachable only by
 * webhook." An Admin reconciling a missed delivery calls the same function the
 * webhook will, and the append-only event row records which it was.
 *
 * ── Cancellation is asymmetric, and the asymmetry is the acceptance test ────
 * §12: "Canceling before listing-fee payment recalculates both high-effort
 * status and the fee. Canceling after successful payment does not change the
 * amount already paid." §33.3.3 tests both directions.
 *
 * Both directions are the *same code path* here. `cancelBooking` always
 * cancels and always re-evaluates; what differs is that after payment the item
 * rows and the fee calculation carry §12's lock, so the evaluation finds
 * nothing it may change. Writing an `if (paid)` branch would put the rule in
 * one function that a second caller could forget; putting it in the lock puts
 * it under every caller, including the ones Phase 11 has not written yet.
 *
 * ── No slot can be offered until §6 is configured ───────────────────────────
 * §6 names interview providers, availability, interviewers, and the reminder
 * lead time as settings and fixes a value for none of them. All four ship unset
 * (`operator` provenance), so `readInterviewConfiguration` reports which are
 * missing and the surface offers no booking at all. §1.4: an offered slot no one
 * is available for is the automation-that-does-not-exist failure, and §1 rule 6
 * forbids inventing the roster.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { founderInterviewBookings, interviewBookingEvents } from '../db/schema/workspace.js';
import { readSettingValue, SettingNotConfigured } from '../settings/service.js';
import { evaluateWorkspace, type EvaluationResult } from './service.js';
import { MEETING_PROVIDERS, type InterviewStatus, type MeetingProvider } from './registry.js';

/** The four §6 keys a bookable interview needs. All ship unset. */
export const INTERVIEW_SETTING_KEYS = [
  'interview_providers',
  'interview_availability',
  'interviewers',
  'interview_reminder_lead_hours',
] as const;

export interface InterviewConfiguration {
  /** False while any of the four §6 settings has no value. */
  bookable: boolean;
  /** Which of them are unset, so Admin is told what to state. */
  missingSettings: string[];
  providers: string[];
  interviewers: string[];
  availability: string | null;
  reminderLeadHours: number | null;
}

/**
 * What §6 says about interviews right now.
 *
 * Reports rather than throws: this is read by a Founder surface that has to
 * explain why booking is unavailable, and by the Admin surface that has to say
 * what to do about it. An exception would turn "not configured yet" into "the
 * page is broken".
 */
export async function readInterviewConfiguration(db: Database): Promise<InterviewConfiguration> {
  const missing: string[] = [];

  async function read<T>(key: string): Promise<T | null> {
    try {
      return (await readSettingValue(db, key)) as T;
    } catch (error) {
      if (error instanceof SettingNotConfigured) {
        missing.push(key);
        return null;
      }
      throw error;
    }
  }

  const providers = await read<readonly string[]>('interview_providers');
  const availability = await read<string>('interview_availability');
  const interviewers = await read<readonly string[]>('interviewers');
  const reminderLeadHours = await read<number>('interview_reminder_lead_hours');

  return {
    bookable: missing.length === 0,
    missingSettings: missing,
    providers: providers ? [...providers] : [],
    interviewers: interviewers ? [...interviewers] : [],
    availability: availability ?? null,
    reminderLeadHours: reminderLeadHours ?? null,
  };
}

/* ── The lifecycle ────────────────────────────────────────────────────────── */

export interface BookingInput {
  campaignId: string;
  scheduledAt: Date;
  founderTimezone: string;
  meetingProvider: MeetingProvider;
  meetingLink?: string | null;
  interviewer?: string | null;
  externalSource?: string | null;
  externalBookingId?: string | null;
  actor: string;
  source: string;
}

export type BookingRefusal =
  | 'not_bookable'
  | 'already_live'
  | 'unknown_provider'
  | 'not_found'
  | 'incomplete';

export type BookingResult =
  | { ok: true; bookingId: string; status: InterviewStatus; evaluation: EvaluationResult }
  | { ok: false; code: BookingRefusal; message: string; next?: string };

/**
 * Records a chosen slot. The booking starts `selected` — §12 is explicit that
 * a selected-but-unconfirmed slot does not complete the item, so there is no
 * path here that creates a `confirmed` booking in one step.
 */
export async function recordBooking(db: Database, input: BookingInput): Promise<BookingResult> {
  if (!(MEETING_PROVIDERS as readonly string[]).includes(input.meetingProvider)) {
    return {
      ok: false,
      code: 'unknown_provider',
      message: 'Interviews run on Google Meet, Zoom, or Microsoft Teams.',
    };
  }

  const config = await readInterviewConfiguration(db);
  if (!config.bookable) {
    return {
      ok: false,
      code: 'not_bookable',
      message: 'Interview booking is not open on this deployment yet.',
      next: `Proovd has not stated ${config.missingSettings.join(', ')} yet. Nothing else you have done is affected.`,
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(founderInterviewBookings)
      .where(eq(founderInterviewBookings.campaignId, input.campaignId))
      .orderBy(desc(founderInterviewBookings.createdAt))
      .limit(1);

    if (existing && (existing.status === 'selected' || existing.status === 'confirmed')) {
      return {
        ok: false as const,
        code: 'already_live' as const,
        message: 'There is already an interview booked for this campaign.',
        next: 'Reschedule or cancel the existing booking first.',
      };
    }

    const [booking] = await tx
      .insert(founderInterviewBookings)
      .values({
        campaignId: input.campaignId,
        status: 'selected',
        scheduledAt: input.scheduledAt,
        founderTimezone: input.founderTimezone,
        meetingProvider: input.meetingProvider,
        meetingLink: input.meetingLink ?? null,
        interviewer: input.interviewer ?? null,
        externalSource: input.externalSource ?? null,
        externalBookingId: input.externalBookingId ?? null,
        createdBy: input.actor,
      })
      .returning();

    await tx.insert(interviewBookingEvents).values({
      bookingId: booking!.id,
      campaignId: input.campaignId,
      event: 'created',
      newStatus: 'selected',
      newScheduledAt: input.scheduledAt,
      source: input.source,
      actor: input.actor,
    });

    const evaluation = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'interview_selected',
    });

    return { ok: true as const, bookingId: booking!.id, status: 'selected' as const, evaluation };
  });
}

/**
 * Confirms a booking. This is the transition that earns the US$2.
 *
 * The database CHECK refuses a `confirmed` row missing any of §12's required
 * facts, so this fills them or refuses first with something the caller can act
 * on. A confirmed booking that carries no link, no interviewer, and no time
 * would earn a discount and clear a high-effort input on the strength of a
 * record that says nothing.
 */
export async function confirmBooking(
  db: Database,
  input: {
    bookingId: string;
    campaignId: string;
    meetingLink?: string;
    interviewer?: string;
    actor: string;
    source: string;
  },
): Promise<BookingResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(founderInterviewBookings)
      .where(
        and(
          eq(founderInterviewBookings.id, input.bookingId),
          eq(founderInterviewBookings.campaignId, input.campaignId),
        ),
      )
      .for('update')
      .limit(1);

    if (!booking) {
      return { ok: false as const, code: 'not_found' as const, message: 'No such booking.' };
    }

    if (booking.status === 'confirmed') {
      // Idempotent. §27.2's rule about duplicate events applies to a
      // reconciliation arriving after the webhook it was covering for.
      const evaluation = await evaluateWorkspace(tx, {
        campaignId: input.campaignId,
        actor: input.actor,
        trigger: 'interview_confirmed_duplicate',
      });
      return { ok: true as const, bookingId: booking.id, status: 'confirmed' as const, evaluation };
    }

    if (booking.status !== 'selected') {
      return {
        ok: false as const,
        code: 'not_found' as const,
        message: 'That booking is no longer live.',
      };
    }

    const meetingLink = input.meetingLink ?? booking.meetingLink;
    const interviewer = input.interviewer ?? booking.interviewer;

    if (!booking.scheduledAt || !booking.founderTimezone || !booking.meetingProvider || !meetingLink || !interviewer) {
      return {
        ok: false as const,
        code: 'incomplete' as const,
        message:
          'A confirmed interview needs a time, a timezone, a meeting provider, a joining link, and an interviewer.',
      };
    }

    const now = new Date();
    await tx
      .update(founderInterviewBookings)
      .set({
        status: 'confirmed',
        confirmedAt: now,
        meetingLink,
        interviewer,
        updatedAt: now,
      })
      .where(eq(founderInterviewBookings.id, booking.id));

    await tx.insert(interviewBookingEvents).values({
      bookingId: booking.id,
      campaignId: input.campaignId,
      event: 'confirmed',
      priorStatus: booking.status,
      newStatus: 'confirmed',
      newScheduledAt: booking.scheduledAt,
      source: input.source,
      actor: input.actor,
    });

    const evaluation = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'interview_confirmed',
    });

    return { ok: true as const, bookingId: booking.id, status: 'confirmed' as const, evaluation };
  });
}

/**
 * Moves a booking to a new time. §12: "Reschedule history."
 *
 * The status does not change — a rescheduled confirmed booking is still
 * confirmed, at a different time, which is why §12 asks for reschedule history
 * rather than a reschedule state. The old time survives in the event row.
 */
export async function rescheduleBooking(
  db: Database,
  input: {
    bookingId: string;
    campaignId: string;
    scheduledAt: Date;
    founderTimezone?: string;
    meetingLink?: string;
    actor: string;
    source: string;
    reason?: string;
  },
): Promise<BookingResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(founderInterviewBookings)
      .where(
        and(
          eq(founderInterviewBookings.id, input.bookingId),
          eq(founderInterviewBookings.campaignId, input.campaignId),
        ),
      )
      .for('update')
      .limit(1);

    if (!booking || (booking.status !== 'selected' && booking.status !== 'confirmed')) {
      return { ok: false as const, code: 'not_found' as const, message: 'No live booking to move.' };
    }

    const now = new Date();
    await tx
      .update(founderInterviewBookings)
      .set({
        scheduledAt: input.scheduledAt,
        ...(input.founderTimezone ? { founderTimezone: input.founderTimezone } : {}),
        ...(input.meetingLink ? { meetingLink: input.meetingLink } : {}),
        updatedAt: now,
      })
      .where(eq(founderInterviewBookings.id, booking.id));

    await tx.insert(interviewBookingEvents).values({
      bookingId: booking.id,
      campaignId: input.campaignId,
      event: 'rescheduled',
      priorStatus: booking.status,
      newStatus: booking.status,
      priorScheduledAt: booking.scheduledAt,
      newScheduledAt: input.scheduledAt,
      reason: input.reason ?? null,
      source: input.source,
      actor: input.actor,
    });

    const evaluation = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'interview_rescheduled',
    });

    return { ok: true as const, bookingId: booking.id, status: booking.status, evaluation };
  });
}

/**
 * Cancels a booking and recalculates — §33.3.3, both directions.
 *
 * There is no `if (listingPaidAt)` here on purpose. Before payment the
 * re-evaluation moves the item, the high-effort classification, and the fee.
 * After payment §12's lock is on the item rows and the charged calculation, so
 * the same re-evaluation finds nothing it may change and the amount already
 * paid stands. One code path, one rule, enforced underneath it by the database.
 */
export async function cancelBooking(
  db: Database,
  input: {
    bookingId: string;
    campaignId: string;
    actor: string;
    source: string;
    reason: string;
  },
): Promise<BookingResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(founderInterviewBookings)
      .where(
        and(
          eq(founderInterviewBookings.id, input.bookingId),
          eq(founderInterviewBookings.campaignId, input.campaignId),
        ),
      )
      .for('update')
      .limit(1);

    if (!booking) {
      return { ok: false as const, code: 'not_found' as const, message: 'No such booking.' };
    }

    if (booking.status === 'canceled') {
      const evaluation = await evaluateWorkspace(tx, {
        campaignId: input.campaignId,
        actor: input.actor,
        trigger: 'interview_canceled_duplicate',
      });
      return { ok: true as const, bookingId: booking.id, status: 'canceled' as const, evaluation };
    }

    const now = new Date();
    await tx
      .update(founderInterviewBookings)
      .set({
        status: 'canceled',
        canceledAt: now,
        canceledBy: input.actor,
        cancellationReason: input.reason,
        updatedAt: now,
      })
      .where(eq(founderInterviewBookings.id, booking.id));

    await tx.insert(interviewBookingEvents).values({
      bookingId: booking.id,
      campaignId: input.campaignId,
      event: 'canceled',
      priorStatus: booking.status,
      newStatus: 'canceled',
      priorScheduledAt: booking.scheduledAt,
      reason: input.reason,
      source: input.source,
      actor: input.actor,
    });

    const evaluation = await evaluateWorkspace(tx, {
      campaignId: input.campaignId,
      actor: input.actor,
      trigger: 'interview_canceled',
    });

    return { ok: true as const, bookingId: booking.id, status: 'canceled' as const, evaluation };
  });
}

/** §12: "Reschedule history." Every event on one campaign's bookings. */
export async function readBookingHistory(db: Database, campaignId: string) {
  return db
    .select()
    .from(interviewBookingEvents)
    .where(eq(interviewBookingEvents.campaignId, campaignId))
    .orderBy(desc(interviewBookingEvents.occurredAt));
}
