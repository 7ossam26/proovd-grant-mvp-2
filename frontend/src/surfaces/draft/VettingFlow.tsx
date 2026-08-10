/**
 * Pre-account vetting — the simplified flow (2026-08-10, product direction),
 * DNA §5.9, §5.12.
 *
 * Three questions, one per screen, in a fixed order, with everything saved as
 * it is typed: Problem and Solution arrive pre-filled from discovery for the
 * Founder to check and correct, and the amount of views is theirs to choose.
 * Finishing the last step submits and lands directly on the account claim —
 * there is no separate review screen and no result page between.
 *
 * The campaign path is no longer asked here: Admin sets it from discovery and
 * it locks at submission (the server refuses a submission until it is set).
 * Competition is no longer collected.
 *
 * ── This is a flow, not a wizard ────────────────────────────────────────────
 * "Returning to an earlier item preserves later valid answers." Every answer is
 * held in one object and each step reads its own key out of it; going back to
 * step 1 cannot touch step 3, because step 1's control never writes to step
 * 3's key. A wizard that rebuilds forward state from the current step is how
 * that requirement is usually broken.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `answers` is loaded once from the restored draft and is the only copy from
 * then on. A save reports whether it landed; it never replaces what is in the
 * box. §9: "A failed save never clears valid fields" — and the obvious
 * implementation, clear-on-error-and-refetch, is the single most common
 * autosave bug.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  VETTING_STEPS,
  VIEWS_RANGE_CHOICES,
  type ViewsRangeId,
  type VettingStepCopy,
} from '@proovd/shared';
import {
  Button,
  Choice,
  Field,
  Measure,
  Progress,
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

type Answers = {
  problem: string;
  solution: string;
  views: ViewsRangeId | null;
};

type Screen = 'problem' | 'solution' | 'views';

const SCREENS: Screen[] = ['problem', 'solution', 'views'];

const copyFor = (id: string): VettingStepCopy =>
  VETTING_STEPS.find((step) => step.id === id)!;

/** One sentence, shown to the eye and announced to a screen reader. */
const stepLabel = (index: number): string => `Step ${index + 1} of ${SCREENS.length}`;

export function VettingFlow() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [screen, setScreen] = useState<Screen>('problem');
  const [submitError, setSubmitError] = useState<{ title: string; what: string; next: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Every step swap is a content change under `data-*` motion attributes, so
  // the runtime has to be told (CLAUDE.md, DNA §6). Skipping this is how
  // animations die silently as a surface grows.
  useProovdMotion(stageRef, [screen]);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  useEffect(() => {
    let cancelled = false;
    fetchVetting(token)
      .then((state) => {
        if (cancelled) return;
        setLoaded(state);
        setAnswers({
          problem: state.problem ?? '',
          solution: state.solution ?? '',
          views: state.views,
        });
        // DNA §5.12: position survives. Coming back never means starting over.
        const resume = state.resumeStep;
        if (resume && SCREENS.includes(resume as Screen)) setScreen(resume as Screen);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Already submitted: the answers are read-only and the account claim is the
  // next step. Sending them backwards into a form they cannot change would be
  // a dead end dressed as a step.
  useEffect(() => {
    if (loaded?.submittedAt) {
      void navigate(`/draft/${encodeURIComponent(token)}/claim`, { replace: true });
    }
  }, [loaded?.submittedAt, navigate, token]);

  const update = useCallback(
    (patch: Partial<Answers>) => {
      setAnswers((current) => (current ? { ...current, ...patch } : current));
      autosave.queue(patch as VettingPatch);
    },
    [autosave],
  );

  const go = useCallback(
    (to: Screen) => {
      setScreen(to);
      autosave.queue({ resumeStep: to });
    },
    [autosave],
  );

  if (unavailable) return <LinkUnavailable />;

  if (!answers || !loaded) {
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

  const complete = {
    problem: answers.problem.trim() !== '',
    solution: answers.solution.trim() !== '',
    views: answers.views !== null,
  };
  const allComplete = SCREENS.every((s) => complete[s]);

  const index = SCREENS.indexOf(screen);
  const statusLine = describeSaveState(autosave.state);

  async function advance(to: Screen) {
    // Land what is typed before moving. The step that follows may be the last,
    // and submitting unsaved answers would submit the wrong thing.
    await autosave.flush();
    go(to);
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
        what:
          detail.whatHappened ??
          'The request did not complete, so nothing was submitted.',
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
          <h1>Tell us about your product</h1>
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
              Everything you type is saved as you go. You can close this and come back to
              the same link.
            </p>
          )}
        </header>

        {/* §9: "always provides current progress". DNA §5.4: the flow is finite
            and visible, and the count goes down. The bar carries the same
            sentence in `aria-valuetext`, so it is one fact told twice rather
            than a picture a screen reader cannot read. */}
        <div className="vetting__meta">
          <div className="vetting__progress">
            <Progress
              value={(index + 1) / SCREENS.length}
              label="Vetting progress"
              valueText={stepLabel(index)}
            />
          </div>
          <span className="vetting__count">{stepLabel(index)}</span>
          <span
            className="vetting__status"
            role="status"
            aria-live="polite"
            data-state={autosave.state.status}
          >
            {statusLine || (autosave.dirty ? '' : 'Saved')}
          </span>
        </div>

        <div className="vetting__stage" ref={stageRef} key={screen}>
          {screen === 'problem' ? (
            <WrittenStep
              copy={copyFor('problem')}
              value={answers.problem}
              supplier={loaded.provenance.problem.supplier}
              prefilled={loaded.provenance.problem.prefilledText ?? null}
              onChange={(value) => update({ problem: value })}
            />
          ) : null}

          {screen === 'solution' ? (
            <WrittenStep
              copy={copyFor('solution')}
              value={answers.solution}
              supplier={loaded.provenance.solution.supplier}
              prefilled={loaded.provenance.solution.prefilledText ?? null}
              onChange={(value) => update({ solution: value })}
            />
          ) : null}

          {screen === 'views' ? (
            <ViewsStep
              value={answers.views}
              onChange={(value) => update({ views: value })}
              error={submitError}
              /* The current step's own ask is the radio group above; the alert
                 names only the EARLIER steps still unanswered. */
              incomplete={SCREENS.filter((s) => s !== 'views' && !complete[s])}
            />
          ) : null}
        </div>

        <div className="vetting__nav">
          {/* §33.11.4: a CTA names the action, so both of these name where
              they go. Nothing precedes the first step, so there is no control
              there rather than a permanently disabled one — a dead button is a
              promise of somewhere to go (§1.4). */}
          {index > 0 ? (
            <Button tier="tertiary" onClick={() => void advance(SCREENS[index - 1]!)}>
              {`Back to ${copyFor(SCREENS[index - 1]!).label}`}
            </Button>
          ) : null}
          {screen === 'views' ? (
            <Button
              tier="primary"
              disabled={!allComplete || submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Submitting…' : 'Submit and set up my account'}
            </Button>
          ) : (
            <Button
              tier="primary"
              disabled={!complete[screen]}
              onClick={() => void advance(SCREENS[index + 1]!)}
            >
              {`Continue to ${copyFor(SCREENS[index + 1]!).label}`}
            </Button>
          )}
        </div>

        {/* DNA §5.9: an overview of every step is one gesture away, and any
            visited step can be returned to. Rendered as a list rather than a
            menu so it is reachable at 320px without opening anything. */}
        <nav className="vetting__overview" aria-label="All steps">
          <ol>
            {SCREENS.map((s) => (
              <li key={s}>
                <Button
                  tier="tertiary"
                  small
                  aria-current={s === screen ? 'step' : undefined}
                  onClick={() => void advance(s)}
                >
                  {copyFor(s).label}
                </Button>
                {complete[s] ? <Tag variant="sage">Answered</Tag> : null}
              </li>
            ))}
          </ol>
        </nav>

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

/* ── Steps 1–2: the written answers ───────────────────────────────────────── */

function WrittenStep({
  copy,
  value,
  supplier,
  prefilled,
  onChange,
}: {
  copy: VettingStepCopy;
  value: string;
  supplier: 'proovd' | 'founder' | null;
  prefilled: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <h2 className="step-title">{copy.title}</h2>
      {/* §9: the decision it supports, the evidence expected, what happens next
          — and then stop. Not legal overcopy. */}
      <p className="lede">{copy.why}</p>

      <Field
        label={copy.title}
        hint={copy.expected}
        id={`vetting-${copy.id}`}
      >
        <Textarea rows={8} value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>

      {/* §9 stores the supplier of the current value; showing it is what makes
          "we drafted this, you can change it" honest rather than a surprise. */}
      {prefilled !== null ? (
        <p className="vetting__provenance">
          {supplier === 'proovd' ? (
            <>
              <Tag variant="mint">Drafted by Proovd</Tag> We wrote this from our
              conversation. Change anything that is not right — it is your product.
            </>
          ) : (
            <>
              <Tag variant="moss">Your words</Tag> You edited what we drafted. We still
              have our original if you want it back — ask us.
            </>
          )}
        </p>
      ) : (
        <p className="vetting__provenance">
          <Tag variant="moss">Your words</Tag> This one is yours from a blank page.
        </p>
      )}

      <p className="field-hint">{copy.next}</p>
    </>
  );
}

/* ── Step 3: the amount of views, and the submit moment ───────────────────── */

/**
 * Four exclusive ranges, so `Choice` (a real radio group) rather than four
 * checkboxes that clear each other — keyboard users get arrow keys and one tab
 * stop, and a screen reader announces one question with four answers.
 */
function ViewsStep({
  value,
  onChange,
  error,
  incomplete,
}: {
  value: ViewsRangeId | null;
  onChange: (value: ViewsRangeId) => void;
  error: { title: string; what: string; next: string } | null;
  incomplete: Screen[];
}) {
  const copy = copyFor('views');
  return (
    <>
      <h2 className="step-title">{copy.title}</h2>
      <p className="lede">{copy.why}</p>

      <Choice<ViewsRangeId>
        label={copy.title}
        entries={VIEWS_RANGE_CHOICES.map((choice) => ({
          value: choice.id,
          label: choice.label,
        }))}
        value={value ?? undefined}
        onValueChange={onChange}
      />
      <p className="field-hint">{copy.expected}</p>

      {error ? (
        <StatePanel
          state={error.title}
          whatHappened={error.what}
          next={error.next}
          owner="You"
          nextUpdate="When you try again"
          action="No action needed"
          reference="Your answers are saved"
          ring
        />
      ) : null}

      {incomplete.length > 0 ? (
        <p className="field-error" role="alert">
          Still to answer: {incomplete.map((s) => copyFor(s).label).join(', ')}.
        </p>
      ) : null}

      <p className="field-hint">{copy.next}</p>
    </>
  );
}
