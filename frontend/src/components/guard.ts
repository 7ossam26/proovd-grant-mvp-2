/**
 * Some proovd.css component classes (`.toggle`, `.option`, `.stepper`) are also
 * *behavioural* selectors the motion runtime binds in `init()` — it toggles
 * `.is-on` / `.is-selected` and mutates the stepper number itself. When Radix
 * (or React) owns that state, the runtime's binder would fight it. The runtime
 * guards each binder with a private `__pv*` flag; setting the flag before
 * `init()` runs makes the binder skip the node, leaving proovd.css's *styling*
 * intact and the press-compress (a separate, harmless binder) in place.
 *
 * The flag is set from a callback ref so it re-applies if React swaps the DOM
 * node, and — because child refs attach before an ancestor's layout effect —
 * it lands before MotionProvider re-runs `init()` on navigation.
 */
import { useCallback, useRef, type RefObject } from 'react';

export function useGuardedRef<T extends HTMLElement>(
  ...flags: string[]
): [RefObject<T | null>, (node: T | null) => void] {
  const ref = useRef<T | null>(null);
  const flagsKey = flags.join(',');
  const set = useCallback(
    (node: T | null) => {
      ref.current = node;
      if (node) {
        for (const f of flagsKey.split(',')) {
          if (f) (node as unknown as Record<string, boolean>)[f] = true;
        }
      }
    },
    [flagsKey],
  );
  return [ref, set];
}
