/**
 * Flow — the one-thing-per-screen sequence controller (DNA §5.9). Not a form:
 * a sequence controller. Each step is one input/decision/action and the hero;
 * the controller owns navigation, the visible-and-shrinking progress, the
 * animated directional transition (forward left, back right), the always-
 * reachable overview, the summary moment, and position that survives
 * interruption.
 *
 * The caller owns each step's content and its own entered values; the Flow only
 * sequences them and reports completion.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button.js';
import { Progress } from './Progress.js';
import { Menu } from './Menu.js';
import { slideStep } from './anim.js';

export interface FlowStep {
  id: string;
  /** The step's hero title. */
  title: ReactNode;
  /** The single input/decision/action for this step. */
  content: ReactNode;
  /** Blocks Continue until true. Default: always allowed. */
  canAdvance?: boolean;
  /** One-glance summary shown on the review step. Defaults to the title. */
  summary?: ReactNode;
  /** Short label for the overview menu. Defaults to "Step N". */
  label?: string;
}

interface FlowProps {
  steps: FlowStep[];
  onComplete?: () => void;
  /** Back from the first step. When absent, Back is disabled there. */
  onExit?: () => void;
  /** Persist position across interruption (DNA §5.12). */
  persistKey?: string;
  reviewTitle?: ReactNode;
  confirmLabel?: string;
  /** The closure moment shown after Confirm. */
  done?: { title: ReactNode; body?: ReactNode };
}

/**
 * What a nav control names as its destination.
 *
 * `label` is the step's own short name and is what the overview menu already
 * shows, so a Founder meets the same word in both places (DNA §5.13's one
 * vocabulary). Without one there is still something specific to say — which
 * numbered step — and that is better than a bare `Continue`.
 */
function stepName(steps: FlowStep[], index: number): string {
  return steps[index]?.label ?? `step ${index + 1}`;
}

/** The review stop's name, lowercased mid-sentence unless it is a proper noun. */
function reviewName(reviewTitle: ReactNode): string {
  return typeof reviewTitle === 'string' && reviewTitle.trim() ? reviewTitle : 'the review';
}

export function Flow({
  steps,
  onComplete,
  onExit,
  persistKey,
  reviewTitle = 'Review everything',
  confirmLabel = 'Confirm',
  done,
}: FlowProps) {
  const total = steps.length; // review lives at index === total
  const storageKey = persistKey ? `pv-flow:${persistKey}` : null;

  const [index, setIndex] = useState<number>(() => {
    if (!storageKey) return 0;
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      return Number.isInteger(saved) ? Math.min(saved, total) : 0;
    } catch {
      return 0;
    }
  });
  const [maxReached, setMaxReached] = useState(index);
  const [finished, setFinished] = useState(false);
  const dir = useRef<'forward' | 'back'>('forward');
  const stepRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, String(index));
    } catch {
      /* storage may be unavailable — position just won't persist */
    }
  }, [index, storageKey]);

  useLayoutEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    if (stepRef.current) slideStep(stepRef.current, dir.current);
  }, [index, finished]);

  const go = useCallback(
    (to: number) => {
      dir.current = to > index ? 'forward' : 'back';
      setIndex(to);
      setMaxReached((m) => Math.max(m, to));
    },
    [index],
  );

  function next() {
    if (index < total) go(index + 1);
  }
  function back() {
    if (index > 0) go(index - 1);
    else onExit?.();
  }
  function confirm() {
    dir.current = 'forward';
    setFinished(true);
    onComplete?.();
  }

  const onReview = index === total;
  const stop = onReview ? total + 1 : index + 1;
  const stops = total + 1; // content steps + review
  const remaining = Math.max(0, total - index);
  const countLabel = finished
    ? 'Done'
    : onReview
      ? 'Review'
      : remaining === 1
        ? '1 step left'
        : `${remaining} steps left`;

  const overviewItems = steps.map((s, i) => ({
    label: s.label ?? `Step ${i + 1}`,
    onSelect: () => go(i),
    disabled: i > maxReached,
  }));

  const current = steps[Math.min(index, total - 1)];

  return (
    <div className="flow">
      {!finished ? (
        <div className="flow__meta">
          <div className="flow__progress">
            <Progress
              value={stop / stops}
              label="Flow progress"
              valueText={onReview ? 'Review step' : `Step ${stop} of ${stops}`}
            />
          </div>
          <div className="flow__meta-right">
            <span className="flow__count" aria-live="polite">
              {countLabel}
            </span>
            <Menu
              label="All steps"
              trigger={
                <Button tier="tertiary" small>
                  All steps
                </Button>
              }
              items={overviewItems}
            />
          </div>
        </div>
      ) : null}

      <div className="flow__stage">
        <div className="flow__step" ref={stepRef} key={finished ? 'done' : index}>
          {/* §33.11.2: the step title is the heading of what a person is
              looking at, so it is a heading. As a `p` the whole flow — four
              screens of the Founder's own campaign — had no structure between
              the page title and whatever a step's content rendered, which is
              also what put an accordion's `h3` directly under the `h1`. */}
          {finished && done ? (
            <>
              <h2 className="step-title">{done.title}</h2>
              {done.body ? <p className="lede">{done.body}</p> : null}
            </>
          ) : onReview ? (
            <>
              <h2 className="step-title">{reviewTitle}</h2>
              <dl className="flow__summary">
                {steps.map((s, i) => (
                  <div className="flow__summary-row" key={s.id}>
                    <dt className="state-panel__key">{s.label ?? `Step ${i + 1}`}</dt>
                    <dd className="state-panel__val">{s.summary ?? s.title}</dd>
                    <Button tier="tertiary" small onClick={() => go(i)}>
                      Edit
                    </Button>
                  </div>
                ))}
              </dl>
              <div className="flow__nav">
                <Button tier="tertiary" onClick={back}>
                  {`Back to ${stepName(steps, total - 1)}`}
                </Button>
                <Button tier="primary" onClick={confirm}>
                  {confirmLabel}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="step-title">{current?.title}</h2>
              {current?.content}
              <div className="flow__nav">
                {/* §33.11.4: both controls name where they go. `Back` and
                    `Continue` are the same two words on every flow in the
                    product; a person moving by keyboard hears the label and
                    nothing else, and the destination is the useful half. */}
                {index > 0 || onExit ? (
                  <Button tier="tertiary" onClick={back}>
                    {index > 0 ? `Back to ${stepName(steps, index - 1)}` : 'Back out of this'}
                  </Button>
                ) : null}
                <Button
                  tier="primary"
                  onClick={next}
                  disabled={current?.canAdvance === false}
                >
                  {index + 1 >= total
                    ? `Continue to ${reviewName(reviewTitle)}`
                    : `Continue to ${stepName(steps, index + 1)}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
