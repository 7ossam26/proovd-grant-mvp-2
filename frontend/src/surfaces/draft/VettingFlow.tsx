/**
 * Positioning, and the submission that locks the campaign type — Spec §9.
 *
 * ── This surface is INTERIM, and it is now smaller than it was ──────────────
 * Founder Flow v2 (2026-08-18) replaces the Founder's onboarding with
 * twenty-six full-bleed pages. **Session B built the first four** — the invite,
 * Problem, Solution and the campaign path — each at its own address under
 * `FOUNDER_FLOW_PAGES`. So this page no longer asks those three; asking them
 * again here would be the same two records collected twice, one screen apart.
 *
 * What is left is §9's third answer and the submission. Session C rebuilds both
 * — Positioning becomes screen 9 of the sequence, after the email and the code
 * — and this presentation does not survive it. It deliberately does NOT render
 * inside `FlowPage`: that would mean declaring a page id in the flow register
 * for a screen Session C moves, and the register holds only pages that exist
 * where they are (§1.4).
 *
 * ── Positioning is the one field Proovd never writes ────────────────────────
 * §9 says it twice — "Always blank. Written by the Founder. Must never be
 * prefilled or represented as AI-generated." There are no `competition_prefilled_*`
 * columns to read a draft from, a CHECK pins the supplier to `founder`, and
 * §33.1.5 tests the absence. Nothing here could prefill it if it tried.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `answer` is loaded once and is the only copy from then on. A save reports
 * whether it landed; it never replaces what is in the box. §9: "A failed save
 * never clears valid fields" — and the obvious implementation,
 * clear-on-error-and-refetch, is the single most common autosave bug.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  CAMPAIGN_TYPE_LOCK_WARNING,
  VETTING_STEPS,
  founderFlowPage,
  founderFlowPath,
  type VettingStepCopy,
} from '@proovd/shared';
import {
  Button,
  Field,
  Measure,
  Section,
  StatePanel,
  Tag,
  Textarea,
  useProovdMotion,
} from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { supportMailto } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { useAutosave } from '../../lib/useAutosave.js';
import {
  fetchVetting,
  saveVetting,
  submitVetting,
  DraftRequestError,
  type VettingPatch,
  type VettingState,
} from './api.js';

const COPY: VettingStepCopy = VETTING_STEPS.find((step) => step.id === 'competition')!;

/** The three answers Session B's own pages own, and where each is answered. */
const EARLIER: readonly { key: 'problem' | 'solution' | 'campaign-type'; pageId: string }[] = [
  { key: 'problem', pageId: 'problem' },
  { key: 'solution', pageId: 'solution' },
  { key: 'campaign-type', pageId: 'campaign-type' },
];

export function VettingFlow() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{
    title: string;
    what: string;
    next: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useProovdMotion(stageRef, [loaded?.campaignId]);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  useEffect(() => {
    let cancelled = false;
    fetchVetting(token)
      .then((state) => {
        if (cancelled) return;
        setLoaded(state);
        setAnswer(state.competition ?? '');
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Already submitted: the answers are read-only and the account claim is the
  // next step. Sending them backwards into a form they cannot change would be a
  // dead end dressed as a step.
  useEffect(() => {
    if (loaded?.submittedAt) {
      void navigate(`/draft/${encodeURIComponent(token)}/claim`, { replace: true });
    }
  }, [loaded?.submittedAt, navigate, token]);

  if (unavailable) return <LinkUnavailable />;

  if (!loaded || answer === null) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your saved answers"
            whatHappened="We're finding anything you've already written. Nothing has been submitted."
            next="Your form appears in a moment."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  const done: Record<'problem' | 'solution' | 'campaign-type', boolean> = {
    problem: (loaded.problem ?? '').trim() !== '',
    solution: (loaded.solution ?? '').trim() !== '',
    'campaign-type': loaded.selectedType !== null,
  };
  const missing = EARLIER.filter((entry) => !done[entry.key]);
  const answered = answer.trim() !== '';
  const statusLine = describeSaveState(autosave.state);

  function update(next: string) {
    setAnswer(next);
    autosave.queue({ competition: next });
  }

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await autosave.flush();
      await submitVetting(token);
      void navigate(`/draft/${encodeURIComponent(token)}/claim`);
    } catch (error) {
      const detail =
        error instanceof DraftRequestError
          ? error.detail
          : { title: 'Proovd could not be reached', whatHappened: undefined, next: undefined };
      setSubmitError({
        title: detail.title,
        what: detail.whatHappened ?? 'The request did not complete, so nothing was submitted.',
        next: detail.next ?? 'Everything you have written is still here. Try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section>
      <Measure>
        <header className="vetting__head">
          <h1>One last question</h1>
          {/* §9: "always provides… restored-draft information". */}
          {loaded.lastSavedAt ? (
            <p className="vetting__restored">
              We restored what you wrote last time. Last saved{' '}
              <time dateTime={loaded.lastSavedAt}>
                {new Date(loaded.lastSavedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              .
            </p>
          ) : (
            <p className="vetting__restored">
              Everything you type is saved as you go. You can close this and come back to the
              same link.
            </p>
          )}
        </header>

        <div className="vetting__meta">
          <span
            className="vetting__status"
            role="status"
            aria-live="polite"
            data-state={autosave.state.status}
          >
            {statusLine || (autosave.dirty ? '' : 'Saved')}
          </span>
        </div>

        <div className="vetting__stage" ref={stageRef}>
          <h2 className="step-title">{COPY.title}</h2>
          <p className="lede">{COPY.why}</p>

          <Field label={COPY.title} hint={COPY.expected} id="vetting-competition">
            <Textarea
              rows={8}
              value={answer}
              onChange={(event) => update(event.target.value)}
            />
          </Field>

          {/* Structurally the Founder's: there are no `competition_prefilled_*`
              columns to read a draft from, and §9 states twice there never will
              be. Nothing else in the product renders this tag from a stored
              supplier — here it is a fact about the schema. */}
          <p className="vetting__provenance">
            <Tag variant="moss">Your words</Tag> This one is yours from a blank page. We do
            not draft it, and we never will.
          </p>

          <p className="field-hint">{COPY.next}</p>

          {submitError ? (
            <StatePanel
              state={submitError.title}
              whatHappened={submitError.what}
              next={submitError.next}
              owner="You"
              nextUpdate="When you try again"
              action="No action needed"
              reference="Your answers are saved"
              ring
            />
          ) : null}

          {/* An earlier answer is missing — reached by a deep link, or left
              blank on the way through. It is not re-asked here: it has its own
              page, and collecting one record on two screens is how the two come
              to disagree. */}
          {missing.length > 0 ? (
            <div className="vetting__missing" role="alert">
              <p className="field-error">
                Still to answer before you can submit:{' '}
                {missing.map((entry) => founderFlowPage(entry.pageId)?.title).join(', ')}.
              </p>
              <ul className="doc-list">
                {missing.map((entry) => (
                  <li key={entry.key}>
                    <a href={founderFlowPath(entry.pageId, token)}>
                      {`Go back to ${founderFlowPage(entry.pageId)?.title}`}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* §9, §33.1.7: the same warning the campaign-path page carried, at
              the moment it actually becomes true. */}
          <p className="field-hint">{CAMPAIGN_TYPE_LOCK_WARNING}</p>
        </div>

        <div className="vetting__nav">
          <Button
            tier="tertiary"
            href={founderFlowPath('campaign-type', token)}
          >
            Back to Campaign type
          </Button>
          <Button
            tier="primary"
            disabled={!answered || missing.length > 0 || submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Submitting…' : 'Submit and set up my account'}
          </Button>
        </div>

        <p className="vetting__note">
          Nothing here creates an account or asks for a card.{' '}
          <a href={supportMailto(`Question about my Proovd form (${loaded.campaignId})`)}>
            Ask us a question
          </a>{' '}
          without losing your place.
        </p>
      </Measure>
    </Section>
  );
}
