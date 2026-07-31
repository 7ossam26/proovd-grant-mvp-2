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
          {finished && done ? (
            <>
              <p className="step-title">{done.title}</p>
              {done.body ? <p className="lede">{done.body}</p> : null}
            </>
          ) : onReview ? (
            <>
              <p className="step-title">{reviewTitle}</p>
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
                  Back
                </Button>
                <Button tier="primary" onClick={confirm}>
                  {confirmLabel}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="step-title">{current?.title}</p>
              {current?.content}
              <div className="flow__nav">
                <Button
                  tier="tertiary"
                  onClick={back}
                  disabled={index === 0 && !onExit}
                >
                  Back
                </Button>
                <Button
                  tier="primary"
                  onClick={next}
                  disabled={current?.canAdvance === false}
                >
                  Continue
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
