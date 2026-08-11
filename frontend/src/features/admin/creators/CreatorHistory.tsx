/**
 * Admin → Creators → History — Spec §25.6, §26.1, §26.8.
 *
 * Read-only, and structurally so: there is no control on this page that writes
 * anything, and the composer behind it has no `.insert(`, `.update(`, or
 * `.delete(` in it at all.
 *
 * ── Every entry names where it came from ────────────────────────────────────
 * `source` is the table the fact was read out of, rendered as part of the
 * reference line. §26.8's trap is a second event store that drifts from the
 * first, and the strongest defence against building one is that this page's
 * claim — "composed from the records that already hold each fact" — is
 * checkable from the response.
 *
 * ── A filter with no entries is hidden, not shown as a zero ─────────────────
 * The counts arrive with the payload, so a chip that would match nothing is not
 * rendered at all. §16a's rule in miniature: a `Money · 0` chip reads as "we
 * checked and there is no money", when the truth is that this Affiliate has not
 * reached a money phase.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { CREATOR_HISTORY_CATEGORIES, CREATOR_HISTORY_AUDIT_NOTE } from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCreator, AdminRequestError, type CreatorWorkspaceDetail } from './api.js';
import { Note } from './shared.js';

export function CreatorHistory() {
  const { prospectId = '' } = useParams();
  const [detail, setDetail] = useState<CreatorWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const surface = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await fetchCreator(prospectId));
    } catch (error: unknown) {
      setLoadError(
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError({
              error: 'unreachable',
              status: 0,
              title: 'Proovd could not be reached',
              whatHappened: 'The history could not be read, and the failure carried no explanation.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            }),
      );
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useProovdMotion(surface, [detail, filter]);

  const chips = useMemo(() => {
    if (!detail) return [];
    return CREATOR_HISTORY_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      count:
        category.key === 'all'
          ? detail.history.length
          : (detail.historyCounts[category.key] ?? 0),
    })).filter((chip) => chip.key === 'all' || chip.count > 0);
  }, [detail]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'The history could not be read, so nothing on this page is current.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="secondary" onClick={() => void load()}>
            Try the read again
          </Button>
        }
        reference="Admin · Creators"
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Reading the history"
        whatHappened="Proovd is composing this Affiliate's history across every record that holds one of their facts."
        next="The history appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const shown =
    filter === 'all'
      ? detail.history
      : detail.history.filter((entry) => entry.category === filter);

  return (
    <div ref={surface}>
      <header className="cr-context">
        <RouterLink className="crumb" to={`/admin/creators/${detail.header.prospectId}`}>
          ← Back to {detail.header.name}
        </RouterLink>
        <div>
          <p className="kicker">{detail.header.name} · Read only</p>
          <h1 className="cr-context__title" data-reveal="headline">
            History
          </h1>
        </div>
      </header>

      <div className="cr-history">
        <section className="cr-history__gist">
          <p className="kicker">Audit record</p>
          <h2>
            {detail.history.length} {detail.history.length === 1 ? 'event' : 'events'}
          </h2>
          <div className="filters" role="group" aria-label="History filters">
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
            Showing {shown.length} of {detail.history.length} recorded events.
          </p>
        </section>

        {shown.length === 0 ? (
          <p className="grey">Nothing recorded under this filter yet.</p>
        ) : (
          <ol className="cr-timeline">
            {shown.map((entry) => (
              <li key={entry.reference}>
                <time dateTime={entry.occurredAt}>{entry.at}</time>
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
