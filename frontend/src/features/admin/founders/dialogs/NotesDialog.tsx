import { useState, type FormEvent } from 'react';
import type { FounderInternalNote } from '../api.js';
import { absoluteTime } from '../format.js';
import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  notes: readonly FounderInternalNote[];
  onAdd: (body: string) => Promise<void>;
  onClose: () => void;
}

export function NotesDialog({ founderName, notes, onAdd, onClose }: Props) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = body.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(value);
      setBody('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The note could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label={`Internal notes for ${founderName}`} onClose={onClose}>
      <p className="dialog-kicker">Internal notes</p>
      <h2>{founderName}</h2>
      <p className="dialog-lead">
        Notes are Founder-scoped, append-only, and visible only to Admins. A correction is a new
        note; an existing note is never silently rewritten.
      </p>

      <div className="note-list">
        {notes.map((note) => (
          <article key={note.id}>
            <p>{note.body}</p>
            <small>
              {note.author} · {absoluteTime(note.createdAt)}
            </small>
          </article>
        ))}
        {notes.length === 0 ? <p className="empty">No internal notes yet.</p> : null}
      </div>

      <form className="note-form" onSubmit={submit}>
        <label>
          <span>Add a Founder-scoped note</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            maxLength={20000}
            required
          />
        </label>
        {error ? <small role="alert">{error}</small> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
