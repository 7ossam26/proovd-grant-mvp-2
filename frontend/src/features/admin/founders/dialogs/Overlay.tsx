/**
 * The one overlay shell every dialog in the Founder panel renders inside.
 *
 * The reference authors this once and reuses it for all ten of its sheets, and
 * so does this: `.overlay` is the scrim, `.dialog` is the sheet, and the close
 * control is `.close-button`. Writing the pair out ten times would be ten
 * chances for one of them to lose its dismissal.
 *
 * ── mousedown, not click ────────────────────────────────────────────────────
 * The reference closes on the scrim's `onMouseDown` and stops propagation on
 * the sheet's. That is not an arbitrary choice: with `onClick`, a drag that
 * STARTS inside the sheet (selecting the text of a reason, dragging a textarea's
 * resize grip) and ENDS on the scrim fires a click whose target is the scrim —
 * and the dialog closes, discarding what was being written. Listening on
 * mousedown makes the gesture's origin decide, which is the honest reading of
 * "the person pressed outside the sheet".
 */

import { useEffect, type ReactNode } from 'react';

interface Props {
  /** The accessible name — the sheet's own h2, said again for the dialog. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

export function Overlay({ label, onClose, children }: Props) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="close-button" type="button" onClick={onClose}>
          Close
        </button>
        {children}
      </section>
    </div>
  );
}

/**
 * The two keyboard facts the whole panel shares, plus the topbar's trigger.
 *
 * ── Escape closes ANY overlay ───────────────────────────────────────────────
 * One `window` listener, not one per dialog: a per-dialog listener is a dialog
 * that can be added without one, and the first time that happens the sheet a
 * person cannot dismiss is the one with unsaved writing in it.
 *
 * ── The topbar trigger is bound here rather than in the topbar ──────────────
 * `FoundersPanel` owns `header.topbar` and renders the reference's
 * `.search-trigger` verbatim. The search corpus, however, is built from the
 * data THIS subtree has loaded — the directory list and the open record — so
 * the state that opens the sheet cannot live in the topbar without hoisting the
 * whole payload above it. Binding the existing button by its own class is the
 * narrow alternative, and it is preferable to the only other options: a topbar
 * button that does nothing (the one thing §1.4 forbids outright) or a second
 * trigger rendered next to the first.
 */
export function useOverlayShortcuts(options: {
  onSearch: () => void;
  onEscape: () => void;
}): void {
  const { onSearch, onEscape } = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onSearch();
      }
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSearch, onEscape]);

  useEffect(() => {
    const trigger = document.querySelector<HTMLButtonElement>('.search-trigger');
    if (!trigger) return;
    const open = () => onSearch();
    trigger.addEventListener('click', open);
    return () => trigger.removeEventListener('click', open);
  }, [onSearch]);
}
