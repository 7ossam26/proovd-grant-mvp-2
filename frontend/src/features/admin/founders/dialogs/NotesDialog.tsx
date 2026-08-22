/**
 * Founder-scoped internal notes — rendered, and honestly inert.
 *
 * ── Why the field cannot be written ─────────────────────────────────────────
 * Migration 0059 creates `founder_internal_notes` as an insert-only table with
 * `UPDATE` and `DELETE` revoked, which is exactly what a note that persists
 * across campaigns has to be. No route reaches it yet.
 *
 * What the record DOES hold today is `admin_notes` — one mutable column on the
 * prospect. Rendering that here as the first row of a list would say something
 * false about it: a mutable column has no history, no author and no time, and
 * a note that can be silently rewritten is not an internal note. So it is named
 * rather than shown.
 *
 * The input stays on screen and read-only, and the reason stands where `Add`
 * would be.
 */

import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  onClose: () => void;
}

export function NotesDialog({ founderName, onClose }: Props) {
  return (
    <Overlay label={`Internal notes for ${founderName}`} onClose={onClose}>
      <p className="dialog-kicker">Internal notes</p>
      <h2>{founderName}</h2>
      <p className="dialog-lead">
        Founder-scoped notes are not stored yet. The record keeps one editable Admin note, which has
        no author, time or history, so it is not shown as an entry here.
      </p>
      <div className="note-form">
        <input readOnly placeholder="Add a Founder-scoped note" aria-describedby="notes-inert" />
        <small id="notes-inert">Adding a note is not built.</small>
      </div>
    </Overlay>
  );
}
