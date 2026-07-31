/**
 * Checkbox / selectable option — Radix Checkbox for behaviour/ARIA
 * (role="checkbox", aria-checked, keyboard), proovd.css for the Selection
 * treatment (DNA §1, §7.1): off = grey border + icon; on = brand border + 5%
 * fill + a drawn brand check. The border/fill snap with the `.is-selected`
 * class (runtime parity); only the checkmark animates, via the runtime's
 * `checkDraw`.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Checkbox } from 'radix-ui';
import { cn } from './cn.js';
import { useGuardedRef } from './guard.js';
import { useProovdRuntime } from '../motion/MotionProvider.js';

interface OptionProps {
  label: ReactNode;
  /** Optional leading icon (grey at rest, brand when selected). */
  icon?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Option({
  label,
  icon,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
}: OptionProps) {
  const [on, setOn] = useState(checked ?? defaultChecked ?? false);
  const [rootRef, setRootRef] = useGuardedRef<HTMLButtonElement>('__pvOption');
  const pathRef = useRef<SVGPathElement>(null);
  const runtime = useProovdRuntime();
  const first = useRef(true);

  useEffect(() => {
    if (checked !== undefined) setOn(checked);
  }, [checked]);

  useLayoutEffect(() => {
    if (on && !first.current && pathRef.current) {
      runtime?.checkDraw(pathRef.current);
    }
    first.current = false;
  }, [on, runtime]);

  function handleChange(next: boolean) {
    if (checked === undefined) setOn(next);
    onCheckedChange?.(next);
  }

  return (
    <Checkbox.Root
      asChild
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleChange}
      disabled={disabled}
    >
      <button
        ref={setRootRef}
        type="button"
        className={cn('option', on && 'is-selected')}
      >
        <span className="option__box" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path ref={pathRef} d="M4 12.5 9.5 18 20 6.5" />
          </svg>
        </span>
        {icon ? (
          <span className="icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </button>
    </Checkbox.Root>
  );
}
