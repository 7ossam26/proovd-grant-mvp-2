/**
 * Parked controls — §1.4.
 *
 * The Admin shell shows four sections and the Founder workspace is the only one
 * that exists. §1.1 would have the other three answer for themselves; they
 * cannot, because they have not been built. The two honest options were to hide
 * them or to show them and say so, and hiding them makes the shell describe a
 * product with one section — which is not what is being built and not what the
 * next session needs to see.
 *
 * So they are shown, marked `aria-disabled`, and each one names what it IS when
 * pressed. `PARKED_MESSAGES` lives in `@proovd/shared` so the sentence an Admin
 * reads here is the same sentence the workspace's own parked controls read;
 * there is one register and this file does not restate it.
 *
 * ── `aria-disabled`, never `disabled` ───────────────────────────────────────
 * A `disabled` button is removed from the tab order, so a keyboard user meets
 * nothing at all where a sighted user sees three greyed sections and can find
 * out why. `aria-disabled` keeps the control reachable and announced as
 * unavailable, and the press still explains itself (§28.5, §33.11.2).
 */

import { useCallback, type MouseEvent } from 'react';
import { PARKED_MESSAGES, type ParkedKey } from '@proovd/shared';
import { useToast } from '../../../motion/MotionProvider.js';

export { PARKED_MESSAGES, type ParkedKey };

/** The attributes a parked control carries, so no caller assembles its own. */
export interface ParkedControlProps {
  'aria-disabled': true;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Returns the props for a parked control.
 *
 * The click is swallowed rather than allowed to fall through: these sit inside
 * rows and cards that navigate, and a press that both explained itself and
 * opened something else would be the worst of the two behaviours.
 */
export function useParkedControl(): (key: ParkedKey) => ParkedControlProps {
  const toast = useToast();

  return useCallback(
    (key: ParkedKey) => ({
      'aria-disabled': true as const,
      onClick: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        toast(PARKED_MESSAGES[key]);
      },
    }),
    [toast],
  );
}
