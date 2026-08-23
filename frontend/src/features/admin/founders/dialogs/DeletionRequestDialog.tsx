import { useState, type FormEvent } from 'react';
import type { FounderDeletionRequestInput } from '../api.js';
import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  busy?: boolean;
  onConfirm: (input: FounderDeletionRequestInput) => void;
  onClose: () => void;
  onRefuse: (message: string) => void;
}

export function DeletionRequestDialog({
  founderName,
  busy = false,
  onConfirm,
  onClose,
  onRefuse,
}: Props) {
  const [detail, setDetail] = useState('');
  const [receivedVia, setReceivedVia] = useState('');
  const [requestedAt, setRequestedAt] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!detail.trim() || !receivedVia.trim() || !requestedAt) {
      onRefuse('The request, how it was received, and when the Founder asked are required');
      return;
    }
    onConfirm({
      detail: detail.trim(),
      receivedVia: receivedVia.trim(),
      requestedAt: new Date(requestedAt).toISOString(),
    });
  }

  return (
    <Overlay label="Record account-closure request" onClose={onClose}>
      <form className="decision-form deletion-request-form" onSubmit={submit}>
        <p className="dialog-kicker">Account closure</p>
        <h2>Record {founderName}’s request</h2>
        <p className="dialog-lead">
          This records the Founder’s request and closes no records automatically. Campaign,
          payment, tax, support and audit data remain subject to retention requirements.
        </p>
        <label>
          <span>What the Founder asked</span>
          <textarea
            autoFocus
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Use the Founder’s own words where available"
          />
        </label>
        <label>
          <span>How the request was received</span>
          <input
            value={receivedVia}
            onInput={(event) => setReceivedVia(event.currentTarget.value)}
            placeholder="Email, call, or support case reference"
          />
        </label>
        <label>
          <span>When the Founder asked</span>
          <input
            type="datetime-local"
            value={requestedAt}
            onInput={(event) => setRequestedAt(event.currentTarget.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Record request</button>
        </div>
      </form>
    </Overlay>
  );
}
