/**
 * The History tab — Timeline · Communications. Spec §25.6, §26.8, §27,
 * Phase 22c. Session C of the Affiliate rebuild — absorbs the old `/history`
 * address.
 *
 * The timeline is `readCreatorHistory`'s composed feed — fifteen tables, no
 * history store, the audit read through the allowlist. Communications is the
 * REAL delivery record (`notification_deliveries`): the reference derives its
 * list by regex over event titles, which is a mock, and the pinned sentence
 * says what this one is instead. The §27 key resolves to a label from the
 * shared registry in the browser — the backend returns the key, never a
 * fourth copy of the descriptions (Phase 22c's rule).
 */

import { useState } from 'react';
import {
  COMMUNICATIONS_ARE_THE_RECORD,
  CREATOR_HISTORY_AUDIT_NOTE,
  CREATOR_HISTORY_CATEGORIES,
  NOTIFICATION_EVENTS,
  type CreatorHistoryFilterKey,
  type NotificationEventKey,
} from '@proovd/shared';
import { cn } from '../../../../components/cn.js';
import type { CreatorWorkspaceDetail } from '../api.js';
import { Note, Section } from '../shared.js';

function eventLabel(eventKey: string): string {
  const definition = NOTIFICATION_EVENTS[eventKey as NotificationEventKey];
  return definition?.description ?? eventKey;
}

export interface HistorySectionProps {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
}

export function HistoryTabSection(props: HistorySectionProps) {
  return props.sectionKey === 'communications' ? (
    <CommunicationsSection {...props} />
  ) : (
    <TimelineSection {...props} />
  );
}

/* ── Timeline — the composed feed, absorbed from the old address ────────────*/

function TimelineSection({ detail }: HistorySectionProps) {
  const [filter, setFilter] = useState<CreatorHistoryFilterKey>('all');
  const entries =
    filter === 'all'
      ? detail.history
      : detail.history.filter((entry) => entry.category === filter);
  const counts = detail.historyCounts;

  return (
    <div className="cr-stack">
      <div className="cr-history">
        <section className="cr-history__gist">
          <p className="kicker">Audit record</p>
          <h2>
            {detail.history.length} event{detail.history.length === 1 ? '' : 's'}
          </h2>
          <div className="filters" role="group" aria-label="History filters">
            {CREATOR_HISTORY_CATEGORIES.map((category) => {
              const count =
                category.key === 'all' ? detail.history.length : (counts[category.key] ?? 0);
              if (category.key !== 'all' && count === 0) return null;
              return (
                <button
                  key={category.key}
                  type="button"
                  className={cn('filter-tag', filter === category.key && 'is-active')}
                  aria-pressed={filter === category.key}
                  onClick={() => setFilter(category.key)}
                >
                  {category.label}
                  {category.key === 'all' ? ` · ${count}` : ''}
                </button>
              );
            })}
          </div>
          <p className="helper" role="status">
            Showing {entries.length} of {detail.history.length} recorded events.
          </p>
        </section>

        {entries.length === 0 ? (
          <p className="grey">Nothing recorded under this filter yet.</p>
        ) : (
          <ol className="cr-timeline">
            {entries.map((entry) => (
              <li key={entry.reference}>
                <time>{entry.at}</time>
                <div>
                  <span className="cr-timeline__cat">
                    {CREATOR_HISTORY_CATEGORIES.find((c) => c.key === entry.category)?.label ??
                      entry.category}
                  </span>
                  <strong>{entry.title}</strong>
                  <p>{entry.detail}</p>
                  <small>
                    Actor · {entry.actor} · recorded in {entry.source}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        )}
        <Note>{CREATOR_HISTORY_AUDIT_NOTE}</Note>
      </div>
    </div>
  );
}

/* ── Communications — the delivery record itself ────────────────────────────*/

function CommunicationsSection({ detail }: HistorySectionProps) {
  const { communications } = detail;

  return (
    <div className="cr-stack">
      <Section
        eyebrow="Delivery &amp; idempotency"
        title={`${communications.length} communication${communications.length === 1 ? '' : 's'}`}
      >
        <p className="grey">{COMMUNICATIONS_ARE_THE_RECORD}</p>
        {communications.length === 0 ? (
          <section className="cr-task cr-task--waiting">
            <div>
              <h2>No communication records</h2>
              <p>No transactional message has been recorded for this Affiliate&rsquo;s address yet.</p>
            </div>
          </section>
        ) : (
          <div className="cr-versions">
            {communications.map((delivery) => (
              <article
                className="cr-version"
                key={`${delivery.eventKey}-${delivery.entityType}-${delivery.entityId}`}
              >
                <span className="cr-version__main">
                  <strong>{eventLabel(delivery.eventKey)}</strong>
                  <small>
                    Recipient {delivery.target} · dedupe {delivery.entityType}:
                    {delivery.entityId}
                    {delivery.at ? ` · ${delivery.at}` : ''}
                  </small>
                </span>
                <span className="cr-version__state">
                  {/* §1.4's two states: confirmed at the provider, or recorded
                      with the claim still unconfirmed — never presented as one. */}
                  <strong>{delivery.confirmed ? 'Delivered' : 'Recorded · not confirmed'}</strong>
                </span>
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
