/**
 * Cal.com — Spec §12, tech-stack §12.
 *
 * The scheduling vendor, kept behind a port for the same reason the email
 * transport and the object storage are: Cal.com is Track A4 and is not
 * provisioned, so an unconfigured deployment must refuse loudly rather than
 * appear to offer a booking. `unconfiguredScheduler` throws; the workspace reads
 * `configured` and renders no embed at all (§1.4).
 *
 * ── This module parses and verifies. It decides nothing ────────────────────
 * tech-stack §12: "The booking record in our database is the source of truth,
 * populated from Cal.com webhooks. `interview_confirmed` is a domain state that
 * gates a US$2 listing-fee discount and one third of the high-effort
 * classification — it cannot live in a vendor's system."
 *
 * So everything here turns bytes into a typed, verified description of *what
 * the vendor says happened*. `interviews/webhook.ts` decides what that means for
 * the booking record, and `workspace/interview.ts` — written in 09a, before any
 * vendor existed — owns the transitions. A payload that cannot be verified or
 * cannot be understood is refused here and never reaches either.
 *
 * ── The signature is checked against the RAW body ──────────────────────────
 * Cal.com signs the exact bytes it sent. Verifying a re-serialised object would
 * pass for a body whose key order or number formatting differed, which is the
 * same class of bug as verifying a Stripe signature after `express.json()` has
 * been through it. The route mounts a raw-body parser before any JSON parser
 * for exactly this reason.
 *
 * Comparison is constant-time. A byte-at-a-time `===` on a signature is a
 * timing oracle for forging one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MEETING_PROVIDERS, type MeetingProvider } from '../workspace/registry.js';

/** Cal.com's header. Hex HMAC-SHA256 of the raw body under the webhook secret. */
export const CALCOM_SIGNATURE_HEADER = 'x-cal-signature-256';

export interface SchedulerConfig {
  /** Read-only API access, for reconciling a delivery we never received. */
  apiKey: string;
  webhookSecret: string;
  /** Public embed identifier, e.g. `proovd/founder-interview`. Not a secret. */
  eventTypeLink: string;
  baseUrl?: string;
}

export interface Scheduler {
  /** False while Track A4 has not landed. The workspace reads it. */
  readonly configured: boolean;
  /** The public link the embed opens. Empty when unconfigured. */
  readonly eventTypeLink: string;
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Reads one booking back, for the reconciliation path. */
  fetchBooking(uid: string): Promise<VendorBooking | null>;
}

/**
 * Refuses rather than pretending — the `unconfiguredTransport` decision.
 *
 * `verifySignature` returns false rather than throwing: an unconfigured
 * deployment that receives a webhook should reject it, not crash on it, and
 * "no secret configured" and "wrong signature" must be the same answer to the
 * caller.
 */
export const unconfiguredScheduler: Scheduler = {
  configured: false,
  eventTypeLink: '',
  verifySignature() {
    return false;
  },
  async fetchBooking() {
    throw new Error(
      'No scheduling provider is configured, so a booking cannot be read back. Set ' +
        'CALCOM_API_KEY, CALCOM_WEBHOOK_SECRET, and CALCOM_EVENT_TYPE_LINK. This refusal is ' +
        'deliberate: reconciling against a provider that does not exist would report a ' +
        'confirmed interview that nobody is attending (§1.4).',
    );
  },
};

/* ── The payload ──────────────────────────────────────────────────────────── */

/**
 * The trigger events this ingest understands.
 *
 * Cal.com sends others — `MEETING_ENDED`, `FORM_SUBMITTED`, and more. Anything
 * not listed here is recorded as seen and then ignored, rather than guessed at:
 * §1 rule 6 applies to a vendor's vocabulary as much as to a commercial rule,
 * and inventing a meaning for an event we have not read the contract for is how
 * a booking silently changes state.
 */
export const HANDLED_TRIGGERS = [
  'BOOKING_REQUESTED',
  'BOOKING_CREATED',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLED',
  'BOOKING_REJECTED',
] as const;

export type HandledTrigger = (typeof HANDLED_TRIGGERS)[number];

export interface VendorBooking {
  /** Cal.com's own id for the booking. Stored, never authoritative. */
  uid: string;
  /** Proovd's reference, round-tripped through the embed's metadata. */
  bookingReference: string | null;
  startTime: Date | null;
  /** The IANA zone the Founder booked in (§12 stores it separately). */
  attendeeTimezone: string | null;
  attendeeEmail: string | null;
  /** §12: Google Meet, Zoom, or Microsoft Teams. Null when unrecognised. */
  meetingProvider: MeetingProvider | null;
  meetingLink: string | null;
  /** §12: "Interviewer." The Cal.com organiser. */
  interviewer: string | null;
  /** ACCEPTED / PENDING / CANCELLED, as the vendor reports it. */
  vendorStatus: string | null;
  cancellationReason: string | null;
}

export interface VendorEvent {
  /** Stable per delivery. The `provider_events` idempotency pivot. */
  eventId: string;
  trigger: string;
  handled: boolean;
  booking: VendorBooking;
}

/** Cal.com's location strings, mapped onto §12's three named providers. */
function readMeetingProvider(payload: Record<string, unknown>): MeetingProvider | null {
  const location = typeof payload['location'] === 'string' ? payload['location'].toLowerCase() : '';
  const videoType =
    typeof (payload['videoCallData'] as Record<string, unknown> | undefined)?.['type'] === 'string'
      ? String((payload['videoCallData'] as Record<string, unknown>)['type']).toLowerCase()
      : '';
  const haystack = `${location} ${videoType}`;

  if (haystack.includes('zoom')) return 'zoom';
  if (haystack.includes('teams') || haystack.includes('msteams')) return 'microsoft_teams';
  if (haystack.includes('meet') || haystack.includes('google')) return 'google_meet';

  // §12 names exactly three. An unrecognised location is reported as unknown
  // rather than defaulted — a booking confirmed onto a provider nobody named is
  // one the CHECK constraint on `founder_interview_bookings` will refuse, which
  // is the honest outcome.
  return null;
}

function readMeetingLink(payload: Record<string, unknown>): string | null {
  const metadata = payload['metadata'] as Record<string, unknown> | undefined;
  const fromMetadata = metadata && typeof metadata['videoCallUrl'] === 'string'
    ? metadata['videoCallUrl']
    : null;
  const videoCallData = payload['videoCallData'] as Record<string, unknown> | undefined;
  const fromVideo = videoCallData && typeof videoCallData['url'] === 'string'
    ? videoCallData['url']
    : null;
  const link = fromMetadata ?? fromVideo;
  // A link that is not an https URL is not a joining link (§12 stores one so a
  // Founder can attend); storing whatever arrived would put arbitrary vendor
  // text into an anchor on a Founder surface.
  return link && /^https:\/\//i.test(link) ? link : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Turns a verified body into a typed event, or null if it is not one.
 *
 * Deliberately tolerant about *shape* and strict about *meaning*: a missing
 * optional field becomes null and the ingest decides whether it can proceed
 * without it, but an unparseable body, a missing trigger, or a missing booking
 * uid is refused outright. There is no partial event.
 */
export function parseVendorEvent(rawBody: Buffer): VendorEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const trigger = typeof body['triggerEvent'] === 'string' ? body['triggerEvent'] : null;
  const payload = body['payload'] as Record<string, unknown> | undefined;
  if (!trigger || !payload || typeof payload !== 'object') return null;

  const uid = typeof payload['uid'] === 'string' ? payload['uid'] : null;
  if (!uid) return null;

  const metadata = payload['metadata'] as Record<string, unknown> | undefined;
  const reference =
    metadata && typeof metadata['proovdReference'] === 'string'
      ? metadata['proovdReference'].trim()
      : null;

  const attendees = Array.isArray(payload['attendees'])
    ? (payload['attendees'] as Array<Record<string, unknown>>)
    : [];
  const attendee = attendees[0];
  const organizer = payload['organizer'] as Record<string, unknown> | undefined;

  const provider = readMeetingProvider(payload);

  return {
    // Cal.com does not send a delivery id, so the pivot is built from the two
    // things that do identify a delivery: which booking, and what happened to
    // it. A redelivery of the same trigger for the same booking is the
    // duplicate `provider_events` is there to swallow; a genuine second
    // reschedule carries a different start time and is handled by the booking
    // history rather than by this key.
    eventId: `${trigger}:${uid}:${String(payload['startTime'] ?? '')}`,
    trigger,
    handled: (HANDLED_TRIGGERS as readonly string[]).includes(trigger),
    booking: {
      uid,
      bookingReference: reference && reference.length > 0 ? reference : null,
      startTime: readDate(payload['startTime']),
      attendeeTimezone:
        attendee && typeof attendee['timeZone'] === 'string' ? attendee['timeZone'] : null,
      attendeeEmail:
        attendee && typeof attendee['email'] === 'string'
          ? attendee['email'].trim().toLowerCase()
          : null,
      meetingProvider: provider && (MEETING_PROVIDERS as readonly string[]).includes(provider)
        ? provider
        : null,
      meetingLink: readMeetingLink(payload),
      interviewer:
        organizer && typeof organizer['name'] === 'string' ? organizer['name'].trim() : null,
      vendorStatus: typeof payload['status'] === 'string' ? payload['status'] : null,
      cancellationReason:
        typeof payload['cancellationReason'] === 'string' ? payload['cancellationReason'] : null,
    },
  };
}

/* ── The configured client ────────────────────────────────────────────────── */

export function createCalcomScheduler(config: SchedulerConfig): Scheduler {
  const base = config.baseUrl ?? 'https://api.cal.com/v1';

  return {
    configured: true,
    eventTypeLink: config.eventTypeLink,

    verifySignature(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
      const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
      const computed = Buffer.from(expected, 'utf8');
      // Length must match before `timingSafeEqual`, which throws otherwise —
      // and a length check is not a leak: the length of a hex SHA-256 is fixed
      // and public.
      if (provided.length !== computed.length) return false;
      return timingSafeEqual(provided, computed);
    },

    async fetchBooking(uid) {
      const response = await fetch(
        `${base}/bookings/${encodeURIComponent(uid)}?apiKey=${encodeURIComponent(config.apiKey)}`,
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`the scheduling provider answered ${response.status} reading ${uid}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      const booking = (body['booking'] ?? body) as Record<string, unknown>;

      // Reconciliation reads the same shape the webhook carries, so one parser
      // decides both. A second reader would be a second opinion about what
      // `confirmed` means.
      const event = parseVendorEvent(
        Buffer.from(JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: booking })),
      );
      return event?.booking ?? null;
    },
  };
}
