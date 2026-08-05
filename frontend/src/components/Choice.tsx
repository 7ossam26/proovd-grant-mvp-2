/**
 * An exclusive choice — Radix RadioGroup for behaviour and ARIA, `proovd.css`
 * for the Selection treatment (DNA §1, §7.1).
 *
 * `Option` is a checkbox and reads as one to a screen reader: each is
 * independently on or off. §27.7's digest cadence is three mutually exclusive
 * answers, and three checkboxes where picking one silently clears the others is
 * the classic accessibility failure — the control announces one thing and
 * behaves as another, and keyboard users get tab-per-option instead of the
 * arrow-key navigation a radio group gives them (§33.11).
 *
 * Visually identical to `Option` on purpose: the dot rather than the check is
 * the only difference, and it is the difference that carries the meaning.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { cn } from './cn.js';

export interface ChoiceEntry<T extends string> {
  value: T;
  label: ReactNode;
  /** A quiet second line. Only where it changes what the person picks. */
  sub?: ReactNode;
}

export interface ChoiceProps<T extends string> {
  /** Names the group for a screen reader. Required — an unlabelled group of
      radios announces three unrelated buttons. */
  label: string;
  entries: readonly ChoiceEntry<T>[];
  value?: T | undefined;
  onValueChange?: (value: T) => void;
  disabled?: boolean;
  name?: string;
}

export function Choice<T extends string>({
  label,
  entries,
  value,
  onValueChange,
  disabled,
  name,
}: ChoiceProps<T>) {
  const [current, setCurrent] = useState<T | undefined>(value);

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  function handle(next: string) {
    if (value === undefined) setCurrent(next as T);
    onValueChange?.(next as T);
  }

  return (
    <RadioGroup.Root
      className="choice"
      aria-label={label}
      /*
       * Always controlled, with the empty string standing for "nothing chosen".
       * Passing `value` only once something is selected would flip the group
       * from uncontrolled to controlled mid-life, which React warns about and
       * which loses the selection on the render it happens.
       */
      value={current ?? ''}
      onValueChange={handle}
      disabled={disabled}
      {...(name ? { name } : {})}
    >
      {entries.map((entry) => (
        <RadioGroup.Item key={entry.value} value={entry.value} asChild>
          <button
            type="button"
            className={cn('option', 'choice__item', current === entry.value && 'is-selected')}
          >
            <span className="choice__dot" aria-hidden="true" />
            <span className="choice__text">
              <span>{entry.label}</span>
              {entry.sub ? <span className="choice__sub">{entry.sub}</span> : null}
            </span>
          </button>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
