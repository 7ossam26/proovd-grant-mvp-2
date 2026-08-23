import { useState, type FormEvent } from 'react';
import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  founderEmail: string;
  busy?: boolean;
  onConfirm: (confirmationEmail: string, reason: string) => void;
  onClose: () => void;
  onRefuse: (message: string) => void;
}

export function founderDeletionIsConfirmed(
  confirmationEmail: string,
  founderEmail: string,
  reason: string,
): boolean {
  return (
    confirmationEmail.trim().toLowerCase() === founderEmail.trim().toLowerCase() &&
    reason.trim().length > 0
  );
}

export function DeleteFounderDialog({
  founderName,
  founderEmail,
  busy = false,
  onConfirm,
  onClose,
  onRefuse,
}: Props) {
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (confirmationEmail.trim().toLowerCase() !== founderEmail.trim().toLowerCase()) {
      onRefuse('Type the Founder email exactly to confirm deletion');
      return;
    }
    if (!reason.trim()) {
      onRefuse('A deletion reason is required');
      return;
    }
    onConfirm(confirmationEmail.trim(), reason.trim());
  }

  return (
    <Overlay label="Permanently delete Founder" onClose={onClose}>
      <form className="decision-form hard-delete-form" onSubmit={submit}>
        <p className="dialog-kicker">Permanent deletion</p>
        <h2>Delete {founderName}</h2>
        <p className="dialog-lead">
          This permanently deletes the Founder record, every linked campaign and draft, and the
          Founder account and sessions. This cannot be undone.
        </p>
        <label>
          <span>Type {founderEmail} to confirm</span>
          <input
            autoFocus
            type="email"
            autoComplete="off"
            value={confirmationEmail}
            onChange={(event) => setConfirmationEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Required deletion reason</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this record must be permanently removed"
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary hard-delete-button"
            type="submit"
            disabled={busy || !founderDeletionIsConfirmed(confirmationEmail, founderEmail, reason)}
          >
            Delete Founder permanently
          </button>
        </div>
      </form>
    </Overlay>
  );
}
