/**
 * History — everything that happened to this person, in plain language.
 *
 * ── The chips are counts the server sent, not a scan ────────────────────────
 * `historyCounts` arrives per category so a filter with nothing behind it can
 * be hidden without walking the feed, and so the `All activity` chip states a
 * number rather than implying one. A chip that shows zero is a chip somebody
 * presses to find an empty page.
 *
 * ── The plain line and the audit record are two different things ────────────
 * §25.6 keeps actor, before, after, reason, evidence, and time for every
 * sensitive act, and §26.8 asks the reader-facing record to be plain language.
 * Both are true here: the sentence is what happened, and the audit block sits
 * one gesture below it for the events that have one. Nothing is summarised
 * away — the disclosure holds the stored values, unedited.
 *
 * ── Filtering is announced ──────────────────────────────────────────────────
 * Pressing a chip changes the page under somebody without moving focus, which
 * a screen-reader user has no way to notice. The count line is a live region,
 * so the result of the press is spoken (§28.5).
 */

import { useMemo, useState } from 'react';
import { FOUNDER_HISTORY_CATEGORIES, HISTORY_AUDIT_NOTE } from '@proovd/shared';
import { cn } from '../../../../components/cn.js';
import type { FounderWorkspaceDetail } from '../../api.js';
import { Expandable, Group, Note, Row, SecTitle, Timeline, TimelineRow } from '../shared.js';

interface HistoryProps {
  detail: FounderWorkspaceDetail;
}

export function History({ detail }: HistoryProps) {
  const [filter, setFilter] = useState<string>('all');
  const entries = detail.history;

  const chips = useMemo(
    () =>
      FOUNDER_HISTORY_CATEGORIES.map((category) => ({
        key: category.key,
        label: category.label,
        count:
          category.key === 'all' ? entries.length : (detail.historyCounts[category.key] ?? 0),
      })).filter((chip) => chip.key === 'all' || chip.count > 0),
    [entries.length, detail.historyCounts],
  );

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)),
    [entries, filter],
  );

  return (
    <>
      <SecTitle>Activity</SecTitle>

      <div className="filters">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={cn('filter-tag', filter === chip.key && 'is-active')}
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
            {chip.key === 'all' ? ` · ${chip.count}` : ''}
          </button>
        ))}
      </div>

      <p className="helper" role="status">
        Showing {shown.length} of {entries.length} recorded events.
      </p>

      {shown.length === 0 ? (
        <p className="grey">Nothing recorded under this filter yet.</p>
      ) : (
        <Timeline>
          {shown.map((entry) => (
            <TimelineRow
              key={`${entry.occurredAt}-${entry.title}-${entry.source}`}
              at={entry.at}
              title={entry.title}
              body={entry.body}
            >
              {entry.reason ? <p className="helper">Reason — {entry.reason}</p> : null}
              {entry.audit ? (
                <Expandable label="Technical details" small>
                  <Group>
                    <Row label="Changed by">{entry.audit.by}</Row>
                    <Row label="Field">{entry.audit.field}</Row>
                    <Row label="Previous value">{entry.audit.priorValue}</Row>
                    <Row label="New value">{entry.audit.newValue}</Row>
                    <Row label="Reason">{entry.audit.reason}</Row>
                    <Row label="Evidence">{entry.audit.evidence}</Row>
                    <Row label="Time">{entry.audit.at}</Row>
                    <Row label="Read from">{entry.source}</Row>
                  </Group>
                </Expandable>
              ) : null}
            </TimelineRow>
          ))}
        </Timeline>
      )}

      <Note>{HISTORY_AUDIT_NOTE}</Note>
    </>
  );
}
