/**
 * Stepper — the value IS the container (DNA §7.1): a display-scale number
 * flanked by square dark-green −/+ buttons, no outer box. Controlled; the
 * number bumps in from the push direction on change (§6.5).
 *
 * Accessible as a labelled group: each button carries an explicit action name,
 * the value is announced on change (aria-live), and buttons disable at the
 * bounds so the limit is conveyed, not just enforced.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from './cn.js';
import { bumpStepperIn } from './anim.js';
import { useGuardedRef } from './guard.js';
import { MinusIcon, PlusIcon } from './icons.js';

interface StepperProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Accessible name for the group and the −/+ actions (e.g. "quantity"). */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered after the number (e.g. a unit). Not part of the value. */
  suffix?: ReactNode;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function Stepper({
  value,
  onValueChange,
  label,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  suffix,
}: StepperProps) {
  const [, setRootRef] = useGuardedRef<HTMLDivElement>('__pvStep');
  const numRef = useRef<HTMLSpanElement>(null);
  const dir = useRef(0);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (numRef.current) bumpStepperIn(numRef.current, dir.current);
    dir.current = 0;
  }, [value]);

  function change(d: number) {
    const next = clamp(value + d * step, min, max);
    if (next === value) return;
    dir.current = d;
    onValueChange(next);
  }

  return (
    <div className="stepper" role="group" aria-label={label} ref={setRootRef}>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => change(-1)}
      >
        <MinusIcon />
      </button>
      <span className="stepper__value" aria-live="polite" aria-atomic="true">
        <span className="stepper__num" ref={numRef}>
          {value}
          {suffix}
        </span>
      </span>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => change(1)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
