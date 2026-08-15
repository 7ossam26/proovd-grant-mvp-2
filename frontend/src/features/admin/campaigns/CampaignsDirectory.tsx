/**
 * Admin → Campaigns — Spec §26.1, §23.1, DNA §5.2, §5.14.
 *
 * Every campaign, one row each, and one gesture into the record that holds the
 * rest.
 *
 * ── This is a hub, not a fourth workspace ───────────────────────────────────
 * There is no create, edit, approve, launch, pause, or close control on this
 * page and there is nowhere to add one: the API behind it is two GETs. Every
 * campaign decision already has a router another workspace owns, and a
 * duplicate control here would be a second door into rules those encode — a
 * second way to decide a threshold, or a second path into the one Transfer per
 * association. The reference says so five times in its own copy and its
 * prototype contains no mutation at all.
 *
 * ── The hero count is derived, and its caption is what it counts ────────────
 * "Campaigns waiting for someone to finish a job" — so it counts rows a NAMED
 * party owes, never the ones the system is simply running. The server decides
 * it, once, on the same pass that decides each row's blocker; a browser-side
 * recount would be a second answer to the number the page leads with.
 *
 * ── The filter is in the URL ────────────────────────────────────────────────
 * A filtered directory is a position, and a position that vanishes on reload is
 * one an Admin cannot send to a colleague (DNA §5.12). `?filter=` carries it,
 * exactly as the Support queue and the Creators directory do.
 *
 * ── The filters are NOT exclusive, and that is the reference's own model ────
 * A campaign can be blocked, waiting, and an Idea Campaign at once — the bar
 * mixes lifecycle with type because "blocked" and "Idea" answer different
 * questions. Membership arrives as a server-derived `groups` array; nothing is
 * stored, because a `group` column would be a second campaign-state store that
 * drifts from `campaigns.status`.
 *
 * ── The row is clickable; the NAME is the control ───────────────────────────
 * A `<tr>` carrying `role="button"` breaks the table's required children and
 * fails axe, and a bare `tabindex` on a row is focusable without being
 * announced as anything. So the campaign's name is a real link and the row's
 * click handler is mouse convenience layered on top, which ignores presses that
 * landed on a control of their own. The Founders list settled this in Phase 25.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  BLOCKED_COUNT_CAPTION,
  BLOCKED_COUNT_LABEL,
  CAMPAIGNS_IS_READ_ONLY,
  CAMPAIGN_COPY,
  CAMPAIGN_FILTERS,
  CAMPAIGN_FILTER_DEFINITIONS,
  FRESHNESS_PREFIX,
  NO_PERSON_NEEDED_LABEL,
  type CampaignFilter,
} from '@proovd/shared';
import { Button, Input, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCampaigns, AdminRequestError, type CampaignDirectoryView } from './api.js';
import { Monogram, StatePill, localStamp } from './shared.js';

function isFilter(value: string): value is CampaignFilter {
  return (CAMPAIGN_FILTERS as readonly string[]).includes(value);
}

export function CampaignsDirectory() {
  const [view, setView] = useState<CampaignDirectoryView | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const surface = useRef<HTMLDivElement>(null);

  const raw = params.get('filter') ?? 'all';
  const filter: CampaignFilter = isFilter(raw) ? raw : 'all';

  const load = useCallback(() => {
    setLoadError(null);
    fetchCampaigns()
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
                  'The campaigns list could not be read, and the failure carried no explanation.',
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
      if (filter === 'all') return true;
      return (row.groups as readonly string[]).includes(filter);
    });
  }, [view, query, filter]);

  function chooseFilter(next: CampaignFilter) {
    const updated = new URLSearchParams(params);
    if (next === 'all') updated.delete('filter');
    else updated.set('filter', next);
    setParams(updated, { replace: true });
  }

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'The campaigns list could not be read, so nothing on this page is current.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try the read again
          </Button>
        }
        reference="Admin · Campaigns"
        ring
      />
    );
  }

  if (!view || !shown) {
    return (
      <StatePanel
        state="Reading the campaigns list"
        whatHappened="Proovd is reading every campaign, where it stands, and who owns the next step."
        next="The list appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Campaigns"
      />
    );
  }

  const definition = CAMPAIGN_FILTER_DEFINITIONS.find((entry) => entry.key === filter);

  return (
    <div ref={surface}>
      <header className="cmp-hero">
        <div>
          {/* §30: a refresh stamp, never a "real time" claim. The instant the
              server ran the read, rendered in the reader's own zone. */}
          <p className="cmp-hero__checked">
            {FRESHNESS_PREFIX} {localStamp(view.checkedAt)}
          </p>
          <p className="kicker">{CAMPAIGN_COPY.directoryEyebrow}</p>
          <h1 className="h2" data-reveal="headline">
            {CAMPAIGN_COPY.directoryTitle}
          </h1>
          <p className="grey cmp-hero__lede">{CAMPAIGN_COPY.directoryLede}</p>
          <p className="helper cmp-hero__posture">{CAMPAIGNS_IS_READ_ONLY}</p>
        </div>
        <div className="cmp-count">
          <span>{BLOCKED_COUNT_CAPTION}</span>
          <div>
            <strong>{view.blockedCount}</strong>
            <b>{BLOCKED_COUNT_LABEL}</b>
          </div>
        </div>
      </header>

      <div className="cmp-tools">
        <div className="filters" role="group" aria-label="Filter campaigns">
          {CAMPAIGN_FILTER_DEFINITIONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={cn('filter-tag', filter === entry.key && 'is-active')}
              aria-pressed={filter === entry.key}
              onClick={() => chooseFilter(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="cmp-search">
          <label className="sr-only" htmlFor="campaign-search">
            Search campaigns
          </label>
          <Input
            id="campaign-search"
            type="search"
            placeholder="Search campaigns"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {/* The definition ships beside the filter for §20's reason: two people
          reading "blocked" differently is the ordinary failure of an operations
          screen, and a count with no definition is the number they argue
          about. */}
      {definition ? <p className="helper cmp-filter-note">{definition.counts}</p> : null}

      {shown.length === 0 ? (
        <StatePanel
          state={CAMPAIGN_COPY.emptyTitle}
          whatHappened={
            view.rows.length === 0
              ? 'No campaign has been created yet. A campaign record is created with the Founder invitation.'
              : `${view.rows.length} campaigns are on the record and none of them match this filter and search.`
          }
          next={CAMPAIGN_COPY.emptyBody}
          owner="You"
          nextUpdate="No update is pending"
          action={
            view.rows.length === 0 ? (
              'No action needed'
            ) : (
              <Button
                tier="secondary"
                onClick={() => {
                  setQuery('');
                  chooseFilter('all');
                }}
              >
                Show all campaigns
              </Button>
            )
          }
          reference="Admin · Campaigns"
        />
      ) : (
        <CampaignsTable rows={shown} />
      )}
    </div>
  );
}

/* ── The table ─────────────────────────────────────────────────────────────*/

function CampaignsTable({ rows }: { rows: CampaignDirectoryView['rows'] }) {
  const navigate = useNavigate();

  /**
   * Mouse convenience only. A press that landed on the name link or on the
   * Founder link has already been answered — opening the record on top of it
   * would be two answers to one click.
   */
  function openRow(event: MouseEvent<HTMLTableRowElement>, campaignId: string) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void navigate(`/admin/campaigns/${campaignId}`);
  }

  return (
    <div className="tablewrap">
      <table className="table cmp-table">
        <caption className="admin-table__caption">
          Campaign type, lifecycle state, the current blocker and who owns it, and the launch or
          close date. Open a campaign for its full record.
        </caption>
        <thead>
          <tr>
            <th scope="col">Campaign</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Current blocker</th>
            <th scope="col">Launch or close</th>
            {/* The arrow column. Empty header rather than a labelled one: it
                announces nothing, because the campaign name beside it is the
                real link and a second announced control per row is noise. */}
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.campaignId}
              className="cmp-row"
              data-scroll="rise"
              onClick={(event) => openRow(event, row.campaignId)}
            >
              <td>
                <span className="cmp-name">
                  <Monogram initials={row.initials} />
                  <span className="cmp-name__what">
                    <RouterLink className="cmp-name__link" to={`/admin/campaigns/${row.campaignId}`}>
                      <b>{row.name}</b>
                    </RouterLink>
                    <small>
                      {[row.company, row.founderName].filter(Boolean).join(' · ') ||
                        row.displayId}
                    </small>
                  </span>
                </span>
              </td>
              <td className="grey">{row.typeLabel ?? 'Not set'}</td>
              <td>
                <StatePill label={row.stateLabel} kind={row.stateKind} small />
              </td>
              <td>
                <span className="cmp-blocker">
                  <strong>{row.blocker.text}</strong>
                  <small>
                    {row.blocker.blocked
                      ? `Owned by ${row.blocker.ownerLabel}`
                      : NO_PERSON_NEEDED_LABEL}
                  </small>
                </span>
              </td>
              <td>
                <span className="cmp-when">
                  <strong>{row.dateLabel}</strong>
                  <small>{row.blocker.due}</small>
                </span>
              </td>
              <td>
                <span className="cmp-row__go" aria-hidden="true">
                  →
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
