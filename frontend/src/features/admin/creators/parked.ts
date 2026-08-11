/**
 * Parked destinations in the Creator workspace — §1.4.
 *
 * The supplied reference is a prototype that stored everything in `useState`,
 * so several of its controls have no record behind them in this product: a
 * per-deliverable evidence state, an availability verification, a payout
 * reminder message §27 does not define. §1.4 gives two honest options — hide
 * the control, or show it and say what it IS — and hiding them would make the
 * surface describe a smaller product than the one being built.
 *
 * So they are shown, marked `aria-disabled`, and each names what is missing.
 * `CREATOR_PARKED_MESSAGES` lives in `@proovd/shared` and IS the gap register:
 * a control parked here without an entry there has nothing to say when pressed.
 *
 * ── `aria-disabled`, never `disabled` ───────────────────────────────────────
 * A `disabled` button leaves the tab order, so a keyboard user meets nothing at
 * all where a sighted user sees a greyed control and can find out why
 * (§28.5, §33.11.2). The founders' `parked.ts` records the same reasoning.
 */

import { useCallback, type MouseEvent } from 'react';
import { CREATOR_PARKED_MESSAGES, type CreatorParkedKey } from '@proovd/shared';
import { useToast } from '../../../motion/MotionProvider.js';

export { CREATOR_PARKED_MESSAGES, type CreatorParkedKey };

export interface ParkedControlProps {
  'aria-disabled': true;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Returns the props for a parked control.
 *
 * The click is swallowed rather than allowed to fall through: these sit inside
 * rows and panels that navigate, and a press that both explained itself and
 * opened something else would be the worst of the two behaviours.
 */
export function useCreatorParked(): (key: CreatorParkedKey) => ParkedControlProps {
  const toast = useToast();

  return useCallback(
    (key: CreatorParkedKey) => ({
      'aria-disabled': true as const,
      onClick: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        toast(CREATOR_PARKED_MESSAGES[key]);
      },
    }),
    [toast],
  );
}
