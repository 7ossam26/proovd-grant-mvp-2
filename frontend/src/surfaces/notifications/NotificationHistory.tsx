/**
 * Notification history — §27.7, §1.4, DNA §5.2 (Phase 22c).
 *
 * §27.7 gives it to authenticated Founder, Creator, and Admin surfaces, and in
 * the same breath says it "does not turn Founder home into a widget dashboard
 * or override the one ranked Act item". So this is deliberately the plainest
 * thing in the product: one column, newest first, a label and a time.
 *
 * ── The four ways this would have become a dashboard, and why none is here ──
 *  - **an unread count.** There is no count in the payload, no read-state
 *    write anywhere in the router, and no `.notification-history__unread`
 *    class to style one with. DNA §5.5 replaces notification pressure with
 *    anticipation; a badge is that pressure.
 *  - **living on the campaign home.** It has its own address. §20's Glance,
 *    Act, and Explore are untouched, and nothing here contributes an Act
 *    candidate — the Act's five sources are records, and a delivered email is
 *    not one.
 *  - **rendering the message body.** `notification_deliveries` stores none,
 *    on purpose: the reader already holds the text in their inbox, and a
 *    second copy would be personal data §25.8 then has to sweep.
 *  - **hiding the failures.** A claimed delivery the provider never confirmed
 *    renders as exactly that (§1.4). Showing it as "Sent" would be the
 *    friendlier lie.
 *
 * The label comes from the shared registry, which the frontend imports
 * directly — the backend returns the key and never a restated description, so
 * there is no fourth copy to drift.
 */

import { NOTIFICATION_EVENTS, type NotificationEventKey } from '@proovd/shared';
import { Button } from '../../components/index.js';

export interface HistoryEntry {
  id: string;
  eventKey: string;
  occurredAt: string;
  state: 'delivered' | 'unconfirmed';
  entityType: string;
  entityId: string;
  target?: string;
}

export interface NotificationHistoryProps {
  entries: HistoryEntry[];
  /** Admin sees the recipient; nobody else does. */
  showTarget?: boolean;
  onLoadMore?: (() => void) | undefined;
}

/** §1.4: "sent" and "sent, not confirmed" are different facts, said as such. */
const STATE_LABEL: Record<HistoryEntry['state'], string> = {
  delivered: 'Sent',
  unconfirmed: 'Sent — delivery not confirmed',
};

function describe(eventKey: string): string {
  const definition = NOTIFICATION_EVENTS[eventKey as NotificationEventKey];
  // An unknown key is shown as it came. A key with no registry entry means the
  // register and the sender disagree, and swallowing that would hide it.
  return definition?.description ?? eventKey;
}

/** §27.1: local-primary, canonical UTC secondary. The browser knows the zone. */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toLocaleString()} (${at.toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
}

export function NotificationHistory({
  entries,
  showTarget,
  onLoadMore,
}: NotificationHistoryProps) {
  if (entries.length === 0) {
    return (
      <div className="notification-history">
        <p>Nothing has been sent to you yet.</p>
      </div>
    );
  }

  return (
    <div className="notification-history">
      <ul className="notification-history__list">
        {entries.map((entry) => (
          <li key={entry.id} className="notification-history__item">
            <span>{describe(entry.eventKey)}</span>
            <span className="notification-history__when">
              {when(entry.occurredAt)} · {STATE_LABEL[entry.state]}
            </span>
            {showTarget && entry.target ? (
              <span className="notification-history__when">To: {entry.target}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Tertiary, and the only control on the surface. A history with a
          primary action would be asking for something. */}
      {onLoadMore ? (
        <Button tier="tertiary" onClick={onLoadMore}>
          Show older
        </Button>
      ) : null}
    </div>
  );
}
