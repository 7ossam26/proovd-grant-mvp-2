/**
 * The History tab — §26.8.
 *
 * Every recorded event on the case, oldest first.
 *
 * ── It is composed, and it says which table each entry came from ────────────
 * There is no `support_case_events` table. §26.8's trap is that a second event
 * store which drifts from the first is worse than no timeline, so the history
 * is a read across the records that already own each fact — the case row, the
 * thread, the assignments, the handoffs, the evidence, the contacts, the
 * reopens, `notification_deliveries`, and `audit_events`. Naming the source on
 * every line is what makes that claim checkable by the person reading it rather
 * than a promise in a comment.
 *
 * ── An internal note's body is not here ─────────────────────────────────────
 * The history records that a note exists; what it says stays on the thread. A
 * timeline is exactly the kind of view that gets pasted into a customer
 * message, and §33.9.11's whole point is that a provider code useful to support
 * is forbidden in customer copy.
 *
 * ── Nothing on this tab is editable, and there is no control that implies it ─
 * §26.8 makes the record immutable. The absence of any action here is the
 * enforcement.
 */

import { CaseSection, formatInstant } from '../shared.js';
import type { PaneProps } from '../SupportCase.js';

export function CaseHistory({ detail }: Pick<PaneProps, 'detail'>) {
  return (
    <CaseSection
      title="Case history"
      lede="Every recorded event on this case, oldest first. Nothing here is editable or removable."
    >
      {detail.history.length === 0 ? (
        <p className="grey">Nothing has been recorded on this case yet.</p>
      ) : (
        <ol className="sup-timeline">
          {detail.history.map((entry, index) => (
            <li key={`${entry.source}-${entry.occurredAt}-${index}`}>
              <time dateTime={entry.occurredAt}>{formatInstant(entry.occurredAt)}</time>
              <div>
                <b>{entry.title}</b>
                {entry.detail ? <p>{entry.detail}</p> : null}
                <p className="helper">
                  {entry.actor ? `${entry.actor} · ` : ''}
                  read from <code>{entry.source}</code>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </CaseSection>
  );
}
