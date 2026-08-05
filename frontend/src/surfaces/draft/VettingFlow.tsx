/**
 * Pre-account vetting — Spec §9, DNA §5.9, §5.12, §33.1.4, §33.1.5, §33.1.7.
 *
 * Four questions, one per screen, in a fixed order, with everything saved as it
 * is typed. The fifth §9 item is a result rather than a question and lives on
 * its own surface (`CreatorResult.tsx`), which is where §10 puts it — after
 * valid vetting, before the account.
 *
 * ── This is a flow, not a wizard ────────────────────────────────────────────
 * §9: "Returning to an earlier item preserves later valid answers." So every
 * answer is held in one object and each step reads its own key out of it; going
 * back to step 2 cannot touch step 4, because step 2's control never writes to
 * step 4's key. A wizard that rebuilds forward state from the current step is
 * how that requirement is usually broken, and §33.1.4 tests it directly.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `answers` is loaded once from the restored draft and is the only copy from
 * then on. A save reports whether it landed; it never replaces what is in the
 * box. §9: "A failed save never clears valid fields" — and the obvious
 * implementation, clear-on-error-and-refetch, is the single most common
 * autosave bug.
 *
 * ── Competition ────────────────────────────────────────────────────────────
 * Its box starts empty and there is no code path in this file that could put
 * anything in it. §9 says so twice; §33.1.5 tests it. The copy beside it says
 * plainly that we do not draft it, rather than leaving a Founder to wonder why
 * this one is blank when the others were not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  VETTING_STEPS,
  CAMPAIGN_PATH_CHOICES,
  CAMPAIGN_TYPE_LOCK_WARNING,
  type VettingStepCopy,
} from '@proovd/shared';
import {
  Button,
  Card,
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
  type CampaignTypeValue,
  type VettingPatch,
  type VettingState,
} from './api.js';

type Answers = {
  selectedType: CampaignTypeValue | null;
  problem: string;
  solution: string;
  competition: string;
};

type Screen = 'campaign_path' | 'problem' | 'solution' | 'competition' | 'review';

const SCREENS: Screen[] = ['campaign_path', 'problem', 'solution', 'competition', 'review'];

const copyFor = (id: string): VettingStepCopy =>
  VETTING_STEPS.find((step) => step.id === id)!;

/** One sentence, shown to the eye and announced to a screen reader. */
const stepLabel = (screen: Screen, index: number): string =>
  screen === 'review' ? 'Review and submit' : `Step ${index + 1} of ${SCREENS.length}`;

export function VettingFlow() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [screen, setScreen] = useState<Screen>('campaign_path');
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
          selectedType: state.selectedType,
          problem: state.problem ?? '',
          solution: state.solution ?? '',
          competition: state.competition ?? '',
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

  // Already submitted: §9 makes the answers read-only and §10 puts the result
  // next. Sending them backwards into a form they cannot change would be a
  // dead end dressed as a step.
  useEffect(() => {
    if (loaded?.submittedAt) {
      void navigate(`/draft/${encodeURIComponent(token)}/result`, { replace: true });
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
      autosave.queue({ resumeStep: to === 'review' ? 'competition' : to });
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
    campaign_path: answers.selectedType !== null,
    problem: answers.problem.trim() !== '',
    solution: answers.solution.trim() !== '',
    competition: answers.competition.trim() !== '',
  };

  const index = SCREENS.indexOf(screen);
  const remaining = SCREENS.length - 1 - index;
  const statusLine = describeSaveState(autosave.state);

  async function advance(to: Screen) {
    // Land what is typed before moving. The step that follows may be the review,
    // and a review of unsaved answers is a review of the wrong thing.
    await autosave.flush();
    go(to);
  }

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await autosave.flush();
      await submitVetting(token);
      void navigate(`/draft/${encodeURIComponent(token)}/result`);
    } catch (error) {
      const detail =
        error instanceof DraftRequestError
          ? error.detail
          : { title: 'Proovd could not be reached', whatHappened: undefined, next: undefined };
      setSubmitError({
        title: detail.title,
        what:
          detail.whatHappened ??
          'The request did not complete, so nothing was submitted and your campaign path is not locked.',
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
              valueText={stepLabel(screen, index)}
            />
          </div>
          <span className="vetting__count">{stepLabel(screen, index)}</span>
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
          {screen === 'campaign_path' ? (
            <CampaignPathStep
              selected={answers.selectedType}
              onSelect={(type) => update({ selectedType: type })}
            />
          ) : null}

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

          {screen === 'competition' ? (
            <WrittenStep
              copy={copyFor('competition')}
              value={answers.competition}
              supplier={loaded.provenance.competition.supplier}
              /* No prefill, ever. §9, §33.1.5. */
              prefilled={null}
              onChange={(value) => update({ competition: value })}
            />
          ) : null}

          {screen === 'review' ? (
            <ReviewStep
              answers={answers}
              onEdit={(to) => void advance(to)}
              submitting={submitting}
              onSubmit={() => void submit()}
              error={submitError}
              incomplete={SCREENS.slice(0, 4).filter(
                (s) => !complete[s as keyof typeof complete],
              )}
            />
          ) : null}
        </div>

        {screen !== 'review' ? (
          <div className="vetting__nav">
            {/* §33.11.4: a CTA names the action, so both of these name where
                they go. `Continue` and `Back` alone are the same two words on
                every flow in the product, which tells a screen-reader user
                moving through a form nothing about what happens next. */}
            {/* Nothing precedes the first step, so there is no control here
                rather than a permanently disabled one — a dead button is a
                promise of somewhere to go (§1.4). */}
            {index > 0 ? (
              <Button tier="tertiary" onClick={() => void advance(SCREENS[index - 1]!)}>
                {`Back to ${copyFor(SCREENS[index - 1]!).label}`}
              </Button>
            ) : null}
            <Button
              tier="primary"
              disabled={!complete[screen as keyof typeof complete]}
              onClick={() => void advance(SCREENS[index + 1]!)}
            >
              {/* Not "Review": the overview below already offers a control by
                  that name, and two buttons with one name is ambiguous to a
                  screen reader before it is ambiguous to anyone else. */}
              {remaining === 1
                ? 'Review my answers'
                : `Continue to ${copyFor(SCREENS[index + 1]!).label}`}
            </Button>
          </div>
        ) : null}

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
                  {s === 'review' ? 'Review' : copyFor(s).label}
                </Button>
                {s !== 'review' && complete[s as keyof typeof complete] ? (
                  <Tag variant="sage">Answered</Tag>
                ) : null}
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

/* ── Step 1 (§9, §4.1, §4.2) ──────────────────────────────────────────────── */

/**
 * §9: "the step must explain what is being chosen in plain language before it
 * is chosen", because everything downstream branches on it and the choice is
 * permanent. So both options are shown in full, side by side, with what each
 * one commits the Founder to — not a pair of buttons and a tooltip.
 */
function CampaignPathStep({
  selected,
  onSelect,
}: {
  selected: CampaignTypeValue | null;
  onSelect: (type: CampaignTypeValue) => void;
}) {
  const copy = copyFor('campaign_path');
  return (
    <>
      <h2 className="step-title">{copy.title}</h2>
      <p className="lede">{copy.why}</p>

      <div className="path-choices" role="radiogroup" aria-label={copy.title}>
        {CAMPAIGN_PATH_CHOICES.map((choice) => (
          <Card
            key={choice.type}
            className={selected === choice.type ? 'path-choice is-selected' : 'path-choice'}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected === choice.type}
              className="path-choice__control"
              onClick={() => onSelect(choice.type)}
            >
              <span className="path-choice__prompt">{choice.prompt}</span>
              {/* §3: only the customer-facing name ever renders. */}
              <span className="path-choice__name">{choice.name}</span>
            </button>
            <p className="path-choice__summary">{choice.summary}</p>
            <p className="path-choice__commit-head">What this commits you to</p>
            <ul className="path-choice__commitments">
              {choice.commitments.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="vetting__warning">
        <p>{CAMPAIGN_TYPE_LOCK_WARNING}</p>
      </Card>
      <p className="field-hint">{copy.next}</p>
    </>
  );
}

/* ── Steps 2–4 (§9) ───────────────────────────────────────────────────────── */

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

/* ── The review moment (DNA §5.9) ─────────────────────────────────────────── */

function ReviewStep({
  answers,
  onEdit,
  onSubmit,
  submitting,
  error,
  incomplete,
}: {
  answers: Answers;
  onEdit: (to: Screen) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: { title: string; what: string; next: string } | null;
  incomplete: Screen[];
}) {
  const chosen = useMemo(
    () => CAMPAIGN_PATH_CHOICES.find((c) => c.type === answers.selectedType) ?? null,
    [answers.selectedType],
  );

  const rows: Array<{ screen: Screen; label: string; value: string }> = [
    { screen: 'campaign_path', label: 'Campaign path', value: chosen?.name ?? 'Not chosen' },
    { screen: 'problem', label: 'Problem', value: answers.problem },
    { screen: 'solution', label: 'Solution', value: answers.solution },
    { screen: 'competition', label: 'Competition', value: answers.competition },
  ];

  return (
    <>
      <h2 className="step-title">Everything you have told us</h2>

      <dl className="vetting__summary">
        {rows.map((row) => (
          <div className="vetting__summary-row" key={row.screen}>
            <dt>{row.label}</dt>
            <dd>{row.value || <span className="vetting__empty">Nothing written yet</span>}</dd>
            <Button tier="tertiary" small onClick={() => onEdit(row.screen)}>
              Edit
            </Button>
          </div>
        ))}
      </dl>

      {/* Shown again here, immediately above the control that makes it true.
          §9 locks the type at submission and there is no way back. */}
      <Card className="vetting__warning">
        <p>{CAMPAIGN_TYPE_LOCK_WARNING}</p>
      </Card>

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

      <div className="vetting__nav">
        <Button tier="tertiary" onClick={() => onEdit('competition')}>
          Back
        </Button>
        <Button
          tier="primary"
          disabled={incomplete.length > 0 || submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Submitting…' : 'Submit and lock my campaign path'}
        </Button>
      </div>

      {incomplete.length > 0 ? (
        <p className="field-error" role="alert">
          Still to answer: {incomplete.map((s) => copyFor(s).label).join(', ')}.
        </p>
      ) : null}
    </>
  );
}
