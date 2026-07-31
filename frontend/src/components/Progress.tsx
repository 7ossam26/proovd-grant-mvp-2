/**
 * Progress (DNA §1 hard rule, §7.1) — always the bordered treatment: brand
 * border + 5% fill + brand fill. Nothing else, ever. Determinate; `value` is
 * 0–1. The fill lands with the runtime's bounce recipe; `--p` is set for the
 * `html.no-motion` jump-cut fallback.
 *
 * Exposed as an ARIA progressbar with a real accessible name and value text so
 * a screen reader hears both the label and the amount.
 */
import { useLayoutEffect, useRef } from 'react';
import { cn } from './cn.js';
import { useProovdRuntime } from '../motion/MotionProvider.js';

interface ProgressProps {
  /** 0–1, clamped. */
  value: number;
  /** Accessible name — what is progressing. */
  label: string;
  /** Overrides the announced value text (defaults to a percentage). */
  valueText?: string;
  className?: string;
}

export function Progress({ value, label, valueText, className }: ProgressProps) {
  const pct = Math.max(0, Math.min(1, value));
  const ref = useRef<HTMLDivElement>(null);
  const runtime = useProovdRuntime();

  useLayoutEffect(() => {
    if (ref.current) runtime?.progress(ref.current, pct);
  }, [pct, runtime]);

  return (
    <div
      ref={ref}
      className={cn('progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText ?? `${Math.round(pct * 100)}%`}
      style={{ ['--p']: pct } as React.CSSProperties}
    >
      <span className="progress__fill" />
    </div>
  );
}
