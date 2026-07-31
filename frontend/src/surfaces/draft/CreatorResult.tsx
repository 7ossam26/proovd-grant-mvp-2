/**
 * The possible-creator result — Spec §10, §33.1.6.
 *
 * §9's fifth item and the last thing a Founder sees before they are asked to
 * create an account. §10 fixes both what it shows and what it must not imply,
 * and the second list is longer than the first.
 *
 * ── The number is never alone ───────────────────────────────────────────────
 * §33.1.6: "Possible-creator result precedes account and cannot promise
 * acceptance." So the count and §10's six disclosures render together, from one
 * constant in `@proovd/shared`, in full. They are not collapsed behind a
 * disclosure control, not summarised, and not shortened — a Founder who reads
 * only the big number has been told something untrue, and staging this
 * particular list would be DNA §5.14 used against its own purpose.
 *
 * There is no ranking, no "X creators are interested", no names, no avatars, no
 * momentum. §30 forbids fabricated popularity and this is exactly the surface
 * where it would be tempting.
 *
 * ── Zero does not render ────────────────────────────────────────────────────
 * §10: "For the pre-screened invited cohort, the result must not be zero; a
 * zero result routes to Admin before the Founder proceeds." The server already
 * refuses to send a zero — it answers `with_admin` instead, which is the same
 * answer it gives when nothing has been recorded yet. This surface therefore
 * cannot render a zero even by accident: it has no branch for one.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { POSSIBLE_CREATOR_RESULT_DISCLOSURES, VETTING_STEPS } from '@proovd/shared';
import {
  Button,
  Card,
  Measure,
  Progress,
  Section,
  StatePanel,
  Stat,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { fetchCreatorSignal, DraftRequestError, type CreatorSignal } from './api.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'not_submitted' }
  | { status: 'ready'; signal: CreatorSignal };

export function CreatorResult() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  const copy = VETTING_STEPS.find((s) => s.id === 'possible_creator_result')!;

  useEffect(() => {
    let cancelled = false;
    fetchCreatorSignal(token)
      .then((signal) => {
        if (!cancelled) setState({ status: 'ready', signal });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 409 is the one failure here that is not about the link: the Founder
        // has not submitted yet. Everything else stays indistinguishable (§5.5).
        if (error instanceof DraftRequestError && error.detail.status === 409) {
          setState({ status: 'not_submitted' });
          return;
        }
        setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'unavailable') return <LinkUnavailable />;

  if (state.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Checking your submission"
            whatHappened="We're looking at what you submitted. Nothing has been charged and no account exists yet."
            next="This step opens in a moment."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  if (state.status === 'not_submitted') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="This step is not open yet"
            whatHappened="Your answers have not been submitted, so there is nothing to base this on."
            next="Finish the four questions first — everything you have written is saved."
            owner="You"
            nextUpdate="When you submit"
            action={
              <Button href={`/draft/${encodeURIComponent(token)}/vetting`}>
                Back to my answers
              </Button>
            }
            reference="Your invitation link"
            ring
          />
        </Measure>
      </Section>
    );
  }

  const { signal } = state;

  /* §10: a zero, and an unrecorded result, are the same state to the Founder —
     Proovd is looking at it. Telling them apart would be telling them a number
     they must not be shown. */
  if (signal.status !== 'available' || signal.count === null) {
    return (
      <Section>
        <Measure>
          <h1>Thanks — that's with us now</h1>
          <StatePanel
            state="We're reviewing your submission"
            whatHappened={
              <>
                You submitted your answers and your campaign path is locked.{' '}
                <strong>No account has been created, no card has been asked for, and
                nothing has been charged.</strong>{' '}
                Someone at Proovd is looking at your campaign before the next step opens.
              </>
            }
            next="We will email you when it does. If there is anything we need from you, that email will say so."
            owner="Proovd"
            nextUpdate="Within one business day"
            action="No action needed"
            reference={`Campaign ${signal.submittedAt.slice(0, 10)}`}
            getHelp={{ href: supportMailto('Question about my Proovd submission') }}
          />
        </Measure>
      </Section>
    );
  }

  return (
    <Section>
      <Measure>
        <div className="vetting__meta">
          <div className="vetting__progress">
            <Progress value={1} label="Vetting progress" valueText="Last step" />
          </div>
        </div>

        <h1>{copy.title}</h1>
        <p className="lede">{copy.why}</p>

        <Card className="creator-signal">
          <Stat
            variant="white"
            brandValue
            value={String(signal.count)}
            sub="Creators who may be relevant"
          />
          {signal.recordedAt ? (
            <p className="creator-signal__when">
              Assessed{' '}
              <time dateTime={signal.recordedAt}>
                {new Date(signal.recordedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              .
            </p>
          ) : null}
        </Card>

        {/* §10's six limits, in full, beside the number they qualify. */}
        <section className="creator-signal__limits" aria-labelledby="creator-signal-limits">
          <h2 id="creator-signal-limits">What this number is not</h2>
          <ul>
            {POSSIBLE_CREATOR_RESULT_DISCLOSURES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <StatePanel
          state="Ready when you are"
          whatHappened="Your answers are submitted and your campaign path is locked."
          next="The next step is your account. We already have most of it from your invitation — you check it and change anything that is wrong."
          owner="You"
          nextUpdate="Whenever you come back to this link"
          action={
            <Button href={`/draft/${encodeURIComponent(token)}/claim`}>
              Set up my account
            </Button>
          }
          reference="Your invitation link"
          getHelp={{ href: supportMailto('Question about my Proovd campaign') }}
          ring
        />
        <p className="vetting__note">{copy.next}</p>
      </Measure>
    </Section>
  );
}
