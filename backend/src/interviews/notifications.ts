/**
 * The four §27.3 interview notifications — Spec §12, §27.1, §27.2, §27.3.
 *
 * §12: "Send confirmation, reminder, reschedule, and cancellation
 * notifications." One sender for all four, because they read the same booking
 * and differ only in which moment they describe.
 *
 * ── Choosing the dedup entity is the whole design ──────────────────────────
 * `notification_deliveries` is unique on (event, target, entity), and §7's rule
 * is to "key on the thing that may legitimately happen twice, at the
 * granularity at which it may happen twice". Each of these four is different:
 *
 *   confirmed    once per booking            → the booking id
 *   canceled     once per booking            → the booking id
 *   rescheduled  as often as they reschedule → the booking id AND the new time
 *   reminder     once per scheduled time     → the booking id AND that time
 *
 * Keying the reschedule on the booking alone would send the first move and
 * silently swallow every later one — §7's exact failure, in a different phase.
 * Keying the reminder on the booking alone would mean a Founder who reschedules
 * gets no reminder for the new time, which is worse than no reminder at all.
 *
 * ── The fee sentence is written here, not in the template ──────────────────
 * §12 makes a confirmed interview worth US$2 and makes cancelling *before*
 * payment recalculate. Whether that is still true is a fact only the caller's
 * side knows — after payment §12's lock means the amount does not move — so the
 * sentence is composed against the campaign's actual state. A template that
 * hardcoded "this changes your fee" would be wrong for every Founder who has
 * already paid.
 *
 * ── Sent after the transaction commits ─────────────────────────────────────
 * Every caller applies the transition first and calls this afterwards. Holding
 * a row lock across a mail provider is the 08b/08c decision, for the same
 * reason: a slow mail server would become a lock-wait timeout on a booking.
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderInterviewBookings } from '../db/schema/workspace.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import type { Notifier, SendOutcome } from '../notifications/send.js';
import {
  FOUNDER_INTERVIEW_CONFIRMED,
  FOUNDER_INTERVIEW_REMINDER,
  FOUNDER_INTERVIEW_RESCHEDULED,
  FOUNDER_INTERVIEW_CANCELED,
} from '../notifications/events.js';
import {
  renderInterviewEmail,
  type FeeNote,
  type InterviewEmailKind,
} from '../notifications/templates/founder-interview.js';
import { MEETING_PROVIDER_LABELS } from './labels.js';

export interface InterviewNotificationContext {
  supportEmail: string;
  fromAddress: string;
}

const EVENT_KEY = {
  confirmed: FOUNDER_INTERVIEW_CONFIRMED,
  reminder: FOUNDER_INTERVIEW_REMINDER,
  rescheduled: FOUNDER_INTERVIEW_RESCHEDULED,
  canceled: FOUNDER_INTERVIEW_CANCELED,
} as const;

/** §27.1: what happens next, per moment. Never a promise nobody owns. */
const NEXT_UPDATE: Record<InterviewEmailKind, string> = {
  confirmed:
    'We will send you a reminder before it starts. If you need to move it or cancel, you can do ' +
    'that from your campaign workspace.',
  reminder: 'Nothing else is needed before then. The joining link above is the same one.',
  rescheduled:
    'We will send you a reminder before the new time. Nothing else about your campaign has ' +
    'changed.',
  canceled:
    'You can book another interview from your campaign workspace whenever you are ready. It is ' +
    'optional, and everything else about your campaign is unaffected.',
};

/**
 * §27.1's timestamp rule: local time with a UTC secondary.
 *
 * The zone comes from the booking, because §12 stores it separately from the
 * instant for exactly this reason — an offset changes across a DST boundary and
 * re-deriving "what time did they think they booked" from the instant alone
 * would be a guess.
 */
function formatIn(at: Date, timeZone: string | null): string {
  try {
    return at.toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timeZone ?? 'UTC',
    });
  } catch {
    // An unusable zone is not a reason to send no email. UTC is stated beside
    // it in every message, so the Founder can still work out the time.
    return at.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' });
  }
}

/**
 * The §12 sentence about the listing fee, or none.
 *
 * Only said when it is true. Before payment a confirmed interview is a US$2
 * saving and a cancellation gives it back; after payment §12's lock means
 * neither moves the amount, and saying otherwise would be a claim about money
 * that is wrong.
 */
function feeNoteFor(kind: InterviewEmailKind, listingPaid: boolean): FeeNote | null {
  if (listingPaid) {
    return kind === 'canceled'
      ? {
          heading: 'Your listing fee',
          body:
            'You have already paid your listing fee, so cancelling does not change the amount ' +
            'you paid.',
        }
      : null;
  }

  if (kind === 'confirmed') {
    return {
      heading: 'Your listing fee',
      body:
        'A confirmed interview takes US$2 off your listing fee. You can see the current total in ' +
        'your campaign workspace.',
    };
  }

  if (kind === 'canceled') {
    return {
      heading: 'Your listing fee',
      body:
        'The US$2 saving for a confirmed interview no longer applies, so your listing fee has ' +
        'gone back up by that amount. You have not been charged anything yet, and booking again ' +
        'brings the saving back.',
    };
  }

  return null;
}

export interface NotifyResult {
  outcome: SendOutcome | { status: 'skipped'; reason: string };
}

/**
 * Sends one of the four, for one booking.
 *
 * Returns rather than throws on a missing address or a missing booking: a
 * Founder without a stored email is an Admin problem, not a reason to fail the
 * transition that already committed.
 */
export async function notifyInterview(
  db: Database,
  notifier: Notifier,
  context: InterviewNotificationContext,
  input: { bookingId: string; kind: InterviewEmailKind },
): Promise<NotifyResult> {
  const [row] = await db
    .select({
      booking: founderInterviewBookings,
      listingPaidAt: campaigns.listingPaidAt,
      claimEmail: founderClaimProfiles.email,
      claimName: founderClaimProfiles.preferredName,
      legalName: founderClaimProfiles.legalName,
      prospectEmail: founderProspects.email,
      prospectName: founderProspects.preferredName,
      productName: founderProspects.productName,
    })
    .from(founderInterviewBookings)
    .innerJoin(campaigns, eq(campaigns.id, founderInterviewBookings.campaignId))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(founderInterviewBookings.id, input.bookingId))
    .orderBy(desc(founderInterviewBookings.createdAt))
    .limit(1);

  if (!row) return { outcome: { status: 'skipped', reason: 'no such booking' } };

  const to = (row.claimEmail ?? row.prospectEmail ?? '').trim();
  if (!to) {
    return { outcome: { status: 'skipped', reason: 'the campaign has no Founder address' } };
  }

  const { booking } = row;
  const scheduledAt = booking.scheduledAt;

  const rendered = await renderInterviewEmail(
    input.kind,
    {
      founderName: row.claimName ?? row.prospectName ?? row.legalName ?? null,
      productName: row.productName ?? null,
      localTime: scheduledAt ? formatIn(scheduledAt, booking.founderTimezone) : null,
      utcTime: scheduledAt ? formatIn(scheduledAt, 'UTC') : null,
      timezone: booking.founderTimezone,
      meetingProvider: booking.meetingProvider
        ? (MEETING_PROVIDER_LABELS[booking.meetingProvider] ?? null)
        : null,
      meetingLink: booking.meetingLink,
      interviewer: booking.interviewer,
      cancellationReason: booking.cancellationReason,
      nextUpdate: NEXT_UPDATE[input.kind],
      reference: booking.campaignId,
      supportEmail: context.supportEmail,
    },
    feeNoteFor(input.kind, row.listingPaidAt !== null),
  );

  // The entity id. See the note at the top of this file — the granularity is
  // different for each of the four, and getting it wrong either sends twice or
  // silently sends nothing.
  const entityId =
    input.kind === 'rescheduled' || input.kind === 'reminder'
      ? `${booking.id}:${scheduledAt?.toISOString() ?? 'unscheduled'}`
      : booking.id;

  const outcome = await notifier.send({
    eventKey: EVENT_KEY[input.kind],
    entityType: 'interview_booking',
    entityId,
    to,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  return { outcome };
}
