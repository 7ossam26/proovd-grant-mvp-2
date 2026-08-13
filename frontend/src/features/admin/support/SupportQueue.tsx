/**
 * Admin → Support — Spec §26.7, §26.8, §27.8, DNA §5.2, §5.14.
 *
 * Every support case, one row each, and one gesture into the case that holds
 * the rest.
 *
 * ── The hero is the queue's Act, and the server composed it ─────────────────
 * §20's ranking applied to support: an overdue promise outranks an unowned
 * case, which outranks work waiting on Proovd, which outranks a queue where
 * everything is waiting on somebody else. The sentence names cases rather than
 * counting them where the number is small, and the caught-up ending offers no
 * manufactured next step — because there is none.
 *
 * ── The filter is in the URL ────────────────────────────────────────────────
 * A filtered queue is a position, and a position that vanishes on reload is one
 * an Admin cannot send to a colleague (DNA §5.12). `?filter=` carries it.
 *
 * ── Every count came from the server ────────────────────────────────────────
 * Including `blockedOnProovd`, which decides two of the five filters. Two
 * derivations of "waiting on someone else" are two answers waiting to disagree,
 * and the definition each filter counts by ships beside it for §20's reason:
 * two people reading a metric differently is the ordinary failure of an
 * operations screen.
 *
 * ── This is not the SLA queue ───────────────────────────────────────────────
 * `/support/queue` is Phase 16b's §27.8 due/overdue read, which the
 * `support-promises` sweep also drives. This surface reads
 * `/support/workspace`, which includes finished cases — a workspace that hid
 * them could not answer "what did we tell this person last month".
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  SUPPORT_FILTER_DEFINITIONS,
  SUPPORT_QUEUE_FILTERS,
  type SupportQueueFilter,
} from '@proovd/shared';
import { Button, Input, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { supportMailto } from '../../public/states.js';
import { fetchSupportQueue, AdminRequestError, type SupportQueueView } from './api.js';
import { CaseChip, Deadline, TriageFlag } from './shared.js';
import { CreateCaseDialog } from './dialogs/index.js';

function isFilter(value: string): value is SupportQueueFilter {
  return (SUPPORT_QUEUE_FILTERS as readonly string[]).includes(value);
}

export function SupportQueue() {
  const navigate = useNavigate();
  const [view, setView] = useState<SupportQueueView | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const [createTrigger, setCreateTrigger] = useState<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const raw = params.get('filter') ?? 'all';
  const filter: SupportQueueFilter = isFilter(raw) ? raw : 'all';

  const load = useCallback(() => {
    setLoadError(null);
    fetchSupportQueue()
      .then(setView)
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The support queue could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, []);

  useEffect(load, [load]);

  // Re-bound when the list arrives: the runtime attaches to the nodes that
  // existed when it last ran, and React has replaced them by then.
  useProovdMotion(surface, [view, filter]);

  const shown = useMemo(() => {
    if (!view) return null;
    const needle = query.trim().toLowerCase();
    return view.rows.filter((row) => {
      if (needle && !row.searchText.includes(needle)) return false;
      if (filter === 'waiting_on_proovd') return row.blockedOnProovd;
      if (filter === 'waiting_on_someone_else') return row.open && !row.blockedOnProovd;
      if (filter === 'unassigned') return row.open && !row.assigneeName;
      if (filter === 'resolved_closed') return !row.open;
      return true;
    });
  }, [view, query, filter]);

  function chooseFilter(next: SupportQueueFilter) {
    const updated = new URLSearchParams(params);
    if (next === 'all') updated.delete('filter');
    else updated.set('filter', next);
    setParams(updated, { replace: true });
  }

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened}
        next={loadError.detail.next}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try again
          </Button>
        }
        reference="Support queue"
        getHelp={{ href: supportMailto('The support queue will not load') }}
        ring
      />
    );
  }

  if (!view || !shown) {
    return (
      <StatePanel
        state="Opening the support queue"
        whatHappened="Proovd is reading every case and working out what is due."
        next="The queue appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Support queue"
      />
    );
  }

  return (
    <div ref={surface}>
      <div className="sup-hero">
        <div>
          <p className="kicker">Support queue</p>
          <h1 className="sup-hero__title">{view.hero.title}</h1>
          <p className="grey">{view.hero.detail}</p>
        </div>
      </div>

      <div className="sup-tools">
        <label className="sup-search">
          <span className="sr-only">Search cases</span>
          <Input
            type="search"
            placeholder="Search by case, requester, campaign, or topic"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          tier="primary"
          onClick={(event: MouseEvent<HTMLButtonElement>) =>
            setCreateTrigger(event.currentTarget)
          }
        >
          Create case
        </Button>
      </div>

      {/*
        The definitions ride the filters as `title`, so what each one counts is
        one hover or one screen-reader announcement away rather than being a
        number two people can read differently.
      */}
      <div className="filters" role="group" aria-label="Filter the queue">
        {SUPPORT_FILTER_DEFINITIONS.map((definition) => (
          <button
            key={definition.key}
            type="button"
            className={cn('filter-tag', filter === definition.key && 'on')}
            aria-pressed={filter === definition.key}
            title={definition.counts}
            onClick={() => chooseFilter(definition.key)}
          >
            {definition.label} · {view.counts[definition.key]}
          </button>
        ))}
      </div>

      <p className="helper sup-filter-note">
        {SUPPORT_FILTER_DEFINITIONS.find((d) => d.key === filter)?.counts}
      </p>

      <div className="sup-list">
        {shown.length === 0 ? (
          <p className="sup-empty">
            {query.trim()
              ? 'No case matches this filter and search. Clear the search to see the whole queue.'
              : 'No case matches this filter.'}
          </p>
        ) : null}

        {shown.map((row) => (
          <article
            key={row.caseId}
            className={cn('sup-row', row.responseDue?.overdue && 'sup-row--late')}
            onClick={(event: MouseEvent<HTMLElement>) => {
              // Mouse convenience on top of the real link inside. A press that
              // landed on a control is left to that control.
              if ((event.target as HTMLElement).closest('a,button')) return;
              navigate(`/admin/support/${row.caseId}`);
            }}
          >
            <div className="sup-cell sup-cell--id">
              <span className="sup-row__ref">
                <span className="mono">{row.reference}</span>
                <CaseChip chip={row.chip} small />
                {row.triage === 'urgent' || row.triage === 'high' ? (
                  <TriageFlag level={row.triage} label={row.triage === 'urgent' ? 'Urgent' : 'High'} />
                ) : null}
              </span>
              <RouterLink className="sup-row__subject" to={`/admin/support/${row.caseId}`}>
                {row.subject}
              </RouterLink>
              <span className="grey">
                {row.requesterName} · {row.requesterKindLabel}
                {row.campaignName ? ` · ${row.campaignName}` : ''}
              </span>
            </div>

            <div className="sup-cell sup-cell--next">
              <span className="sup-row__next">
                {row.nextAction ?? 'Resolved — nothing outstanding.'}
              </span>
              <span className="grey">
                {row.assigneeName ? `Owner: ${row.assigneeName}` : 'No owner yet'}
                {row.open ? ' · response ' : ''}
                {row.open ? <Deadline deadline={row.responseDue} /> : null}
              </span>
            </div>

            <span className="sup-row__go" aria-hidden="true">
              →
            </span>
          </article>
        ))}
      </div>

      {createTrigger ? (
        <CreateCaseDialog
          trigger={createTrigger}
          onClose={() => setCreateTrigger(null)}
          onDone={(caseId) => {
            setCreateTrigger(null);
            navigate(`/admin/support/${caseId}`);
          }}
        />
      ) : null}
    </div>
  );
}
