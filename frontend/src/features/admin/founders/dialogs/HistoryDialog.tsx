/**
 * The immutable activity record — Spec §25.6, §26.8.
 *
 * Every entry is composed across the tables that already record each event, and
 * each one names the table it came from — §26.8's trap is a second event store
 * that drifts from the first, so there isn't one.
 *
 * ── The internal reason is not the customer explanation ─────────────────────
 * §25.6 stores them as two columns for a reason. What renders here is the
 * record's own `reason`, labelled as a reason so nobody pastes it into a
 * customer message believing it is the sentence the Founder was given.
 *
 * A `<time>` without a machine-readable `dateTime` is a decorative element to a
 * screen reader; the sortable instant the server already sends fills it, while
 * the visible text stays the server's own rendering (§27.1 — a bare ISO string
 * spells nothing out to a reader).
 */

import type { FounderHistoryEntry } from '../api.js';
import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  entries: readonly FounderHistoryEntry[];
  onClose: () => void;
}

export function HistoryDialog({ founderName, entries, onClose }: Props) {
  return (
    <Overlay label={`Activity history for ${founderName}`} onClose={onClose}>
      <p className="dialog-kicker">Immutable activity</p>
      <h2>{founderName}</h2>
      {entries.length === 0 ? (
        <p className="empty">No recorded activity yet.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry, index) => (
            <li key={`${entry.occurredAt}-${entry.title}-${index}`}>
              <time dateTime={entry.occurredAt}>{entry.at}</time>
              <strong>{entry.title}</strong>
              <span>
                {[entry.body, entry.reason ? `Reason: ${entry.reason}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Overlay>
  );
}
