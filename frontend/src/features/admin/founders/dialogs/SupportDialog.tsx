import { useState, type FormEvent } from 'react';
import {
  SUPPORT_OWNERS,
  SUPPORT_OWNER_LABELS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
} from '@proovd/shared';
import type { FounderOperationsView } from '../api.js';
import { Overlay } from './Overlay.js';

type SupportCase = FounderOperationsView['supportCases'][number];

export function openCaseCount(cases: readonly SupportCase[] | undefined): number {
  return (cases ?? []).filter((supportCase) => supportCase.status !== 'Resolved').length;
}

interface Props {
  cases: readonly SupportCase[];
  canCreate: boolean;
  onCreate: (input: { topic: string; owner: string; message: string }) => Promise<void>;
  onOpenDetail: (title: string, body: string) => void;
  onClose: () => void;
}

export function SupportDialog({ cases, canCreate, onCreate, onOpenDetail, onClose }: Props) {
  const [topic, setTopic] = useState<string>('account_access');
  const [owner, setOwner] = useState<string>('proovd_support');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = openCaseCount(cases);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || busy || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ topic, owner, message: message.trim() });
      setMessage('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The case could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Support" onClose={onClose}>
      <p className="dialog-kicker">Support</p>
      <h2>{open} open case{open === 1 ? '' : 's'}</h2>
      <p className="dialog-lead">Cases remain visible regardless of the campaign stage.</p>

      <div className="support-list">
        {cases.map((supportCase) => (
          <button
            key={supportCase.caseId}
            type="button"
            onClick={() =>
              onOpenDetail(
                `${supportCase.reference} · ${supportCase.subject ?? 'No subject recorded'}`,
                [
                  `Status: ${supportCase.status}`,
                  `Owner: ${supportCase.owner}`,
                  `Human response due: ${supportCase.due ?? 'Not recorded'}`,
                ].join('\n'),
              )
            }
          >
            <span>{supportCase.reference}</span>
            <strong>{supportCase.subject ?? 'No subject recorded'}</strong>
            <small>{supportCase.status} · {supportCase.owner}</small>
          </button>
        ))}
        {cases.length === 0 ? <p className="empty">No cases on this record.</p> : null}
      </div>

      <form className="support-case-form" onSubmit={submit}>
        <h3>Open a case</h3>
        <label>
          <span>Topic</span>
          <select value={topic} onChange={(event) => setTopic(event.currentTarget.value)}>
            {SUPPORT_TOPICS.map((key) => (
              <option key={key} value={key}>{SUPPORT_TOPIC_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Owner</span>
          <select value={owner} onChange={(event) => setOwner(event.currentTarget.value)}>
            {SUPPORT_OWNERS.map((key) => (
              <option key={key} value={key}>{SUPPORT_OWNER_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>What happened</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            required
          />
        </label>
        {!canCreate ? (
          <small>This Founder must claim the invitation before an account support case can be opened.</small>
        ) : null}
        {error ? <small role="alert">{error}</small> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!canCreate || busy || !message.trim()}>
            {busy ? 'Opening…' : 'Open case'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
