/**
 * Parked controls — §1.4.
 *
 * The Admin shell has six sections — Founders, Creators, Campaigns, Support,
 * Backers, and Today — and Today is the only one still parked (2026-08-16).
 * A parked destination is shown, marked `aria-disabled`, and names what it IS
 * when pressed, because hiding it would make the shell describe a smaller
 * product than the one being built.
 *
 * `PARKED_MESSAGES` lives in `@proovd/shared` so the sentence an Admin reads
 * here is the same sentence the workspace's own parked controls read; there is
 * one register and this file does not restate it. What LEFT the register —
 * the campaign link (real since the Campaigns workspace, 2026-08-15), the
 * support link (real since the Support workspace, 2026-08-13), and the
 * double-duty `tabs` key — is recorded on the register itself.
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
