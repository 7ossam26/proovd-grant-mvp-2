/**
 * The manual-edit sheet — Spec §25.6.
 *
 * Its lead is the whole point and is the reference's, verbatim: this changes the
 * saved value directly, it lands in History, and it does NOT create a Founder
 * change request. Those are three different acts on this panel and conflating
 * them is how an Admin edit gets mistaken for something the Founder asked for.
 *
 * The field is seeded with the CURRENT saved value, so an edit starts from what
 * is stored rather than from an empty box that would read as "type the new
 * value" and quietly lose everything not retyped.
 *
 * The prior value is never sent. §33.12.4: the server reads it from the row
 * under lock inside the transaction that changes it, because a caller that
 * supplies both halves can supply a flattering pair.
 */

import { useState, type FormEvent } from 'react';
import { Overlay } from './Overlay.js';

interface Props {
  title: string;
  value: string;
  multiline?: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
  busy?: boolean;
}

export function ManualEditDialog({
  title,
  value,
  multiline = false,
  onSave,
  onClose,
  busy = false,
}: Props) {
  const [draft, setDraft] = useState(value);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onSave(draft);
  }

  return (
    <Overlay label={title} onClose={onClose}>
      <form className="decision-form" onSubmit={submit}>
        <p className="dialog-kicker">Manual Admin edit</p>
        <h2>{title}</h2>
        <p className="dialog-lead">
          Change the saved value directly. The edit is recorded in History and does not create a
          Founder change request.
        </p>
        <label>
          <span>Saved value</span>
          {multiline ? (
            <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
          ) : (
            <input
              autoFocus
              className="manual-edit-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Save edit
          </button>
        </div>
      </form>
    </Overlay>
  );
}
