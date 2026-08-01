/**
 * Turning a Cal.com delivery into a booking transition — Spec §12, §28.3,
 * tech-stack §12.
 *
 * ── The vendor is an input, not the truth ──────────────────────────────────
 * Every transition below goes through the same 09a services a person calls:
 * `recordBooking`, `confirmBooking`, `rescheduleBooking`, `cancelBooking`. The
 * webhook supplies `source: 'provider:calcom'` and nothing else is different.
 * That is what makes the reconciliation path real rather than aspirational —
 * Phase 09's trap is that `confirmed` must not be reachable only by webhook, and
 * it is not, because the webhook has no privileged route of its own.
 *
 * ── A duplicate delivery may update audit and nothing else ─────────────────
 * §28.3, and §33.7.7's rule about duplicate events. `provider_events` is unique
 * on (provider, event id) and is claimed *before* any domain work, so a
 * redelivery increments a counter and returns. The 09a services are
 * independently idempotent — `confirmBooking` on an already-confirmed booking
 * re-evaluates and returns without a second history row — so even a defeated
 * pivot cannot produce a second transition or a second email.
 *
 * ── Two facts must agree before a booking binds ────────────────────────────
 * The signed reference says which campaign; the attendee's email must be that
 * campaign's Founder. Either alone is not enough: the reference travels through
 * metadata the booker can edit, and an email address is not a secret. A payload
 * that satisfies one and not the other is recorded and routed to Admin rather
 * than bound — §1 rule 6 forbids guessing, and a misbound interview moves a
 * commercial term.
 *
 * ── Nothing here sends email ───────────────────────────────────────────────
 * The route sends, after this returns and after the transaction has committed.
 * Holding a database transaction open across a provider call is how a slow mail
 * server becomes a lock-wait timeout, and the 08b/08c precedent is the same.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderInterviewBookings } from '../db/schema/workspace.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { providerEvents } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  recordBooking,
  confirmBooking,
  rescheduleBooking,
  cancelBooking,
} from '../workspace/interview.js';
import { verifyInterviewReference } from './reference.js';
import type { VendorEvent } from './calcom.js';

export const CALCOM_PROVIDER = 'calcom';

/** What the route needs to know to decide which email to send, if any. */
export type IngestOutcome =
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string }
  | { status: 'unmatched'; reason: string }
  | {
      status: 'applied';
      campaignId: string;
      bookingId: string;
      /** Which §27.3 notification this transition owes, if any. */
      notify: 'confirmed' | 'rescheduled' | 'canceled' | null;
    };

export interface IngestDeps {
  db: Database;
  audit: AuditWriter;
  /** Keys the reference HMAC. `BETTER_AUTH_SECRET`, domain-separated. */
  referenceSecret: string;
}

/* ── Resolving the campaign ───────────────────────────────────────────────── */

interface ResolvedCampaign {
  campaignId: string;
  founderEmail: string | null;
}

/**
 * The Founder's address for a campaign.
 *
 * The claim profile first — it is what the Founder actually entered when they
 * created their account — falling back to the address the invitation went to.
 * Both are the same person; the first is the one they chose.
 */
async function readCampaignFounder(
  db: Database,
  campaignId: string,
): Promise<ResolvedCampaign | null> {
  const [row] = await db
    .select({
      campaignId: campaigns.id,
      claimEmail: founderClaimProfiles.email,
      prospectEmail: founderProspects.email,
    })
    .from(campaigns)
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!row) return null;
  const email = (row.claimEmail ?? row.prospectEmail ?? '').trim().toLowerCase();
  return { campaignId: row.campaignId, founderEmail: email || null };
}

/* ── The ingest ───────────────────────────────────────────────────────────── */

export async function ingestVendorEvent(
  deps: IngestDeps,
  event: VendorEvent,
): Promise<IngestOutcome> {
  const { db, audit } = deps;

  // §28.3: insert-or-skip on the provider's event id, BEFORE any domain work.
  const claimed = await db
    .insert(providerEvents)
    .values({
      provider: CALCOM_PROVIDER,
      providerEventId: event.eventId,
      eventType: event.trigger,
      subjectId: event.booking.uid,
    })
    .onConflictDoNothing()
    .returning({ id: providerEvents.id });

  if (claimed.length === 0) {
    // A duplicate may update audit. It may never duplicate domain state, money,
    // or a message.
    await db
      .update(providerEvents)
      .set({ seenCount: (await countSeen(db, event.eventId)) + 1, lastSeenAt: new Date() })
      .where(
        and(
          eq(providerEvents.provider, CALCOM_PROVIDER),
          eq(providerEvents.providerEventId, event.eventId),
        ),
      );

    await audit({
      action: 'interview.webhook_duplicate',
      targetType: 'interview_booking',
      targetId: event.booking.uid,
      internalReason: `${event.trigger} redelivered; no domain work performed`,
    });
    return { status: 'duplicate' };
  }

  if (!event.handled) {
    // Recorded as seen, then left alone. Guessing at a trigger whose contract we
    // have not read is how a booking silently changes state (§1 rule 6).
    await audit({
      action: 'interview.webhook_ignored',
      targetType: 'interview_booking',
      targetId: event.booking.uid,
      internalReason: `${event.trigger} is not a trigger this ingest handles`,
    });
    return { status: 'ignored', reason: event.trigger };
  }

  /* ── Fact one: the signed reference ─────────────────────────────────────── */

  const campaignId = verifyInterviewReference(event.booking.bookingReference, deps.referenceSecret);
  if (!campaignId) {
    return unmatched(audit, event, 'the booking carried no valid Proovd reference');
  }

  const campaign = await readCampaignFounder(db, campaignId);
  if (!campaign) {
    return unmatched(audit, event, 'the reference named a campaign that does not exist');
  }

  /* ── Fact two: the attendee is that campaign's Founder ──────────────────── */

  if (
    !campaign.founderEmail ||
    !event.booking.attendeeEmail ||
    campaign.founderEmail !== event.booking.attendeeEmail
  ) {
    // Deliberately not bound. §1.3 makes the manual route valid only when the
    // app records it, so the refusal is recorded with enough for an Admin to
    // finish it by hand — and no more.
    return unmatched(
      audit,
      event,
      'the person who booked is not the Founder of the campaign the reference named',
    );
  }

  /* ── Apply, through the same services a person calls ────────────────────── */

  const existing = await findBooking(db, campaignId, event.booking.uid);
  const source = `provider:${CALCOM_PROVIDER}`;
  const actor = `system:${CALCOM_PROVIDER}`;

  switch (event.trigger) {
    case 'BOOKING_REQUESTED':
    case 'BOOKING_CREATED': {
      const accepted = (event.booking.vendorStatus ?? '').toUpperCase() === 'ACCEPTED';

      if (!existing) {
        if (!event.booking.startTime) {
          return unmatched(audit, event, 'the booking carried no start time');
        }
        if (!event.booking.meetingProvider) {
          // §12 names exactly three conferencing providers and the CHECK on the
          // booking row enforces it. An unrecognised location is routed to
          // Admin rather than defaulted onto one of the three.
          return unmatched(audit, event, 'the booking is on a conferencing provider §12 does not name');
        }

        const created = await recordBooking(db, {
          campaignId,
          scheduledAt: event.booking.startTime,
          founderTimezone: event.booking.attendeeTimezone ?? 'UTC',
          meetingProvider: event.booking.meetingProvider,
          meetingLink: event.booking.meetingLink,
          interviewer: event.booking.interviewer,
          externalSource: CALCOM_PROVIDER,
          externalBookingId: event.booking.uid,
          proovdReference: event.booking.bookingReference,
          actor,
          source,
        });

        if (!created.ok) {
          return unmatched(audit, event, created.message);
        }

        if (!accepted) {
          // §12: a selected-but-unconfirmed slot does not count. The booking
          // exists and earns nothing until the provider says it is accepted.
          return {
            status: 'applied',
            campaignId,
            bookingId: created.bookingId,
            notify: null,
          };
        }

        const confirmed = await confirmBooking(db, {
          bookingId: created.bookingId,
          campaignId,
          ...(event.booking.meetingLink ? { meetingLink: event.booking.meetingLink } : {}),
          ...(event.booking.interviewer ? { interviewer: event.booking.interviewer } : {}),
          actor,
          source,
        });

        return confirmed.ok
          ? { status: 'applied', campaignId, bookingId: created.bookingId, notify: 'confirmed' }
          : unmatched(audit, event, confirmed.message);
      }

      if (!accepted) {
        return { status: 'applied', campaignId, bookingId: existing.id, notify: null };
      }

      const confirmed = await confirmBooking(db, {
        bookingId: existing.id,
        campaignId,
        ...(event.booking.meetingLink ? { meetingLink: event.booking.meetingLink } : {}),
        ...(event.booking.interviewer ? { interviewer: event.booking.interviewer } : {}),
        actor,
        source,
      });

      return confirmed.ok
        ? {
            status: 'applied',
            campaignId,
            bookingId: existing.id,
            // Already confirmed before this delivery: the transition is a
            // no-op, so the email would be a second copy of one already sent.
            // `notification_deliveries` would swallow it anyway; not asking is
            // cheaper and clearer.
            notify: existing.status === 'confirmed' ? null : 'confirmed',
          }
        : unmatched(audit, event, confirmed.message);
    }

    case 'BOOKING_RESCHEDULED': {
      if (!existing) {
        return unmatched(audit, event, 'a reschedule arrived for a booking we have never seen');
      }
      if (!event.booking.startTime) {
        return unmatched(audit, event, 'the reschedule carried no new start time');
      }

      const moved = await rescheduleBooking(db, {
        bookingId: existing.id,
        campaignId,
        scheduledAt: event.booking.startTime,
        ...(event.booking.attendeeTimezone
          ? { founderTimezone: event.booking.attendeeTimezone }
          : {}),
        ...(event.booking.meetingLink ? { meetingLink: event.booking.meetingLink } : {}),
        actor,
        source,
        reason: 'Rescheduled in the booking provider',
      });

      return moved.ok
        ? { status: 'applied', campaignId, bookingId: existing.id, notify: 'rescheduled' }
        : unmatched(audit, event, moved.message);
    }

    case 'BOOKING_CANCELLED':
    case 'BOOKING_REJECTED': {
      if (!existing) {
        return unmatched(audit, event, 'a cancellation arrived for a booking we have never seen');
      }

      const wasCanceled = existing.status === 'canceled';
      const canceled = await cancelBooking(db, {
        bookingId: existing.id,
        campaignId,
        actor,
        source,
        reason:
          event.booking.cancellationReason?.trim() ||
          (event.trigger === 'BOOKING_REJECTED'
            ? 'Declined in the booking provider'
            : 'Canceled in the booking provider'),
      });

      // §12 / §33.3.3: the cancellation always recalculates. Before payment that
      // moves the item, the classification, and the fee; after payment §12's
      // lock means it moves nothing. There is no branch here for either.
      return canceled.ok
        ? {
            status: 'applied',
            campaignId,
            bookingId: existing.id,
            notify: wasCanceled ? null : 'canceled',
          }
        : unmatched(audit, event, canceled.message);
    }

    default:
      return { status: 'ignored', reason: event.trigger };
  }
}

async function countSeen(db: Database, eventId: string): Promise<number> {
  const [row] = await db
    .select({ seenCount: providerEvents.seenCount })
    .from(providerEvents)
    .where(
      and(
        eq(providerEvents.provider, CALCOM_PROVIDER),
        eq(providerEvents.providerEventId, eventId),
      ),
    )
    .limit(1);
  return row?.seenCount ?? 1;
}

async function findBooking(db: Database, campaignId: string, uid: string) {
  // By the vendor's uid first — a reschedule or cancellation names the booking
  // it is about. Falling back to the campaign's live booking covers the case
  // where the create was missed and a later event is the first we hear of it.
  const [byUid] = await db
    .select()
    .from(founderInterviewBookings)
    .where(
      and(
        eq(founderInterviewBookings.campaignId, campaignId),
        eq(founderInterviewBookings.externalBookingId, uid),
      ),
    )
    .limit(1);

  if (byUid) return byUid;

  const [live] = await db
    .select()
    .from(founderInterviewBookings)
    .where(eq(founderInterviewBookings.campaignId, campaignId))
    .orderBy(desc(founderInterviewBookings.createdAt))
    .limit(1);

  return live && (live.status === 'selected' || live.status === 'confirmed') ? live : null;
}

/**
 * Records a delivery that could not be bound, and stops.
 *
 * §1.4 forbids implying an automated outcome that did not happen, so an
 * unbindable booking is never guessed into place. §1.3 makes the manual route
 * valid only when the app records it, so the audit row carries the vendor's id
 * and the reason — enough for an Admin to finish it by hand from the Admin
 * interview panel, and no personal data beyond the address that failed to match.
 */
async function unmatched(
  audit: AuditWriter,
  event: VendorEvent,
  reason: string,
): Promise<IngestOutcome> {
  await audit({
    action: 'interview.webhook_unmatched',
    targetType: 'interview_booking',
    targetId: event.booking.uid,
    internalReason: `${event.trigger} could not be bound: ${reason}`,
    newValue: { trigger: event.trigger, uid: event.booking.uid, reason },
  });
  return { status: 'unmatched', reason };
}
