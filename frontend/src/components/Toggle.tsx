/**
 * Toggle — Radix Switch for behaviour/ARIA (role="switch", aria-checked,
 * Space/Enter, focus), proovd.css for looks, GSAP for the knob travel (§7.1).
 *
 * Sits bare on the page with its label and optional sub-line — never wrapped in
 * a bordered card (DNA §4.2, §7.1). The square knob travels and the track
 * colour tweens; when motion is unavailable the `.is-on` class + proovd.css's
 * `html.no-motion` rules jump-cut the same end state.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Switch } from 'radix-ui';
import { cn } from './cn.js';
import { animateToggle, motionLive } from './anim.js';
import { useGuardedRef } from './guard.js';

interface ToggleProps {
  label: ReactNode;
  /** A quiet second line under the label. Only if it changes what the user does. */
  sub?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Toggle({
  label,
  sub,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
}: ToggleProps) {
  const auto = useId();
  const switchId = id ?? auto;
  const [on, setOn] = useState(checked ?? defaultChecked ?? false);
  const [trackRef, setTrackRef] = useGuardedRef<HTMLButtonElement>('__pvToggle');
  const knobRef = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  // Mirror a controlled `checked` so the class/motion track it.
  useEffect(() => {
    if (checked !== undefined) setOn(checked);
  }, [checked]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (track && knob) animateToggle(track, knob, on, !first.current);
    first.current = false;
  }, [on, trackRef]);

  function handleChange(next: boolean) {
    if (checked === undefined) setOn(next);
    onCheckedChange?.(next);
  }

  return (
    <div className="toggle-row">
      <span className="toggle-row__label">
        <label className="field-label" htmlFor={switchId}>
          {label}
        </label>
        {sub ? <span className="field-hint">{sub}</span> : null}
      </span>
      <Switch.Root
        asChild
        id={switchId}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={handleChange}
        disabled={disabled}
      >
        <button
          ref={setTrackRef}
          type="button"
          className={cn('toggle', on && !motionLive() && 'is-on')}
        >
          <span ref={knobRef} className="toggle__knob" />
        </button>
      </Switch.Root>
    </div>
  );
}
