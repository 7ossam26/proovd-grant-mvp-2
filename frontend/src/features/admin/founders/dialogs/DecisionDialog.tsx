/**
 * The Admin decision sheet — Spec §25.6, §26.2.
 *
 * One shape for every consequential act in the panel: what is being decided, why
 * it matters, and the reason, which is REQUIRED. The reason is not a formality —
 * §25.6 stores it as two separate columns (internal reason and the
 * customer-facing explanation), and the placeholder says so in the reference's
 * own words rather than leaving a person to guess who reads it.
 *
 * ── The empty-reason refusal is a toast, not a form error ───────────────────
 * The reference refuses with `A reason is required` and leaves the sheet open
 * with what was typed intact. That is the right behaviour and not just the
 * reference's: replacing the sheet with an error state would discard a
 * half-written reason, and this is the one field in the panel most expensive to
 * lose.
 *
 * ── The client check is not the gate ────────────────────────────────────────
 * The server refuses a blank reason by name (`recordAccessAction`: "Say why").
 * This check exists so a person is told before a round trip, never instead of
 * one — §1.1's rule that the frontend is not the boundary.
 */

import { useState, type FormEvent } from 'react';
import { Overlay } from './Overlay.js';

interface Props {
  title: string;
  prompt: string;
  confirmLabel: string;
  /** Whatever the caller does with the reason. Refusals surface as a toast. */
  onConfirm: (reason: string) => void;
  onClose: () => void;
  /** The reference's `$("A reason is required")`. */
  onRefuse: (message: string) => void;
  busy?: boolean;
}

export function DecisionDialog({
  title,
  prompt,
  confirmLabel,
  onConfirm,
  onClose,
  onRefuse,
  busy = false,
}: Props) {
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      onRefuse('A reason is required');
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Overlay label={title} onClose={onClose}>
      <form className="decision-form" onSubmit={submit}>
        <p className="dialog-kicker">Admin decision</p>
        <h2>{title}</h2>
        <p className="dialog-lead">{prompt}</p>
        <label>
          <span>Required reason</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="This reason is shown to the Founder when applicable and saved to History"
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
