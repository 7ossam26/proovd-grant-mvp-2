/**
 * Screen 12 — the Founder interview — Founder Flow v2, Session D.
 *
 * ── The reference's own picker is refused, and it is not a close call ───────
 * The prototype draws platform tiles (Meet / Zoom / Teams) and time-slot chips
 * of its own. tech-stack §12 is explicit: "The booking record in our database
 * is the source of truth, populated from Cal.com webhooks." A second picker is
 * a second scheduler — it would hold a slot the provider never issued, or the
 * reverse — and Phase 09's own trap was the mirror of it: don't leave
 * `confirmed` reachable only by webhook. What renders here is the provider's
 * embed, and the booking record beside it.
 *
 * ── §12's rule is confirmation, and the screen says which state it is in ────
 * "A selected-but-unconfirmed, canceled, or abandoned slot does not count."
 * Those are four different facts and a Founder who picked a time is entitled to
 * know their US$2 is not earned yet, so the booking card names the state rather
 * than showing a date and leaving it at that.
 *
 * ── Two independent absences, and the screen says which ─────────────────────
 * §6 names the interview providers, availability, interviewers and reminder
 * lead time as settings and fixes none of them; Cal.com is Track A4. Either
 * missing means nothing to book, and they are different problems for different
 * people — the server folds them into `bookable` and `embed.available` and
 * names the missing settings, so this screen reports which rather than a
 * general "unavailable" (§1.4, §27.1).
 */

import { useParams } from 'react-router';
import { Button, Card, StatePanel, Tag, NO_ACTION } from '../../components/index.js';
import { cancelInterview } from '../founder/api.js';
import { InterviewEmbed } from '../founder/InterviewBooking.js';
import { AnswerPage } from './AnswerPage.js';

/** §12's four booking states, in the words a Founder needs (§3.1). */
const BOOKING_STATE: Record<string, { tag: string; line: string }> = {
  selected: {
    tag: 'Not confirmed',
    line: 'You picked this time and it has not been confirmed yet, so it does not count towards your listing fee.',
  },
  confirmed: {
    tag: 'Confirmed',
    line: 'This is booked. It counts towards your listing fee.',
  },
  rescheduled: {
    tag: 'Moved',
    line: 'This booking was moved. It counts once the new time is confirmed.',
  },
  canceled: {
    tag: 'Canceled',
    line: 'This booking was canceled, so it does not count towards your listing fee. You can book another time.',
  },
  abandoned: {
    tag: 'Never confirmed',
    line: 'This time came and went without being confirmed, so it does not count. You can book another.',
  },
};

export function InterviewStep() {
  const { campaignId = '' } = useParams();

  return (
    <AnswerPage pageId="interview" itemKey="interview">
      {({ state, refresh }) => {
        const booking = state.interview.booking;
        const described = booking ? BOOKING_STATE[booking.status] : undefined;

        return (
          <>
            {booking ? (
              <Card className="ff-booking">
                <p className="ff-booking__state">
                  <Tag variant={booking.status === 'confirmed' ? 'moss' : 'default'}>
                    {described?.tag ?? booking.status}
                  </Tag>{' '}
                  {described?.line ?? 'We are waiting on the booking provider for this one.'}
                </p>
                <p className="ff-booking__when">
                  {booking.scheduledAt
                    ? new Date(booking.scheduledAt).toLocaleString()
                    : 'No time set yet'}
                  {booking.provider ? ` · ${booking.provider}` : ''}
                </p>
                {booking.status === 'selected' || booking.status === 'confirmed' ? (
                  <Button
                    tier="tertiary"
                    small
                    disabled={state.listingPaid}
                    onClick={() =>
                      void refresh(
                        cancelInterview(
                          campaignId,
                          booking.id,
                          'Canceled by the Founder from the setup flow',
                        ),
                      )
                    }
                  >
                    Cancel this interview
                  </Button>
                ) : null}
              </Card>
            ) : null}

            {state.interview.embed.available &&
            state.interview.embed.eventTypeLink &&
            state.interview.embed.reference &&
            !booking ? (
              <InterviewEmbed
                eventTypeLink={state.interview.embed.eventTypeLink}
                reference={state.interview.embed.reference}
              />
            ) : null}

            {!state.interview.bookable ? (
              <StatePanel
                state="Booking an interview is not open yet"
                whatHappened={
                  state.interview.missingSettings.length > 0
                    ? `Proovd has not published interview times for this deployment yet (${state.interview.missingSettings.join(', ')}).`
                    : 'Proovd has not published interview times for this deployment yet.'
                }
                next="We will email you when it opens. Every other answer here still lowers your listing fee, and skipping this one costs you nothing else."
                owner="Proovd"
                nextUpdate="When interview times are published"
                action={NO_ACTION}
                reference={campaignId}
                getHelp={{ href: '/support' }}
              />
            ) : !state.interview.embed.available ? (
              <StatePanel
                state="The booking calendar is not connected yet"
                whatHappened="Interview times exist, but the calendar we book them through is not set up on this deployment, so there is nothing to show you here."
                next="We will email you when it opens. Nothing you have done on this campaign is affected."
                owner="Proovd"
                nextUpdate="When the calendar is connected"
                action={NO_ACTION}
                reference={campaignId}
                getHelp={{ href: '/support' }}
              />
            ) : (
              <p className="ff-answer__note">
                Interview times: {state.interview.availability}. We meet on{' '}
                {state.interview.providers.join(', ')}.
              </p>
            )}
          </>
        );
      }}
    </AnswerPage>
  );
}
