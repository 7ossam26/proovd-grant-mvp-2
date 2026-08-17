/**
 * Admin → Founders — the directory (Spec §26.1, §7, DNA §5.2, §5.12, §5.14;
 * rebuilt 2026-08-16 to the supplied reference).
 *
 * Find any Founder, see what needs attention, and open the complete lifecycle
 * record: six filter cards, search, Type and Owner filters, and the
 * five-column table with its two action columns.
 *
 * ── Every filter lives in the URL ───────────────────────────────────────────
 * `?filter=`, `?q=`, `?type=`, `?owner=` — DNA §5.12, and the Campaigns hub's
 * `?q=` lesson: a search in component state breaks every link that promises a
 * pre-filtered list. The reset clears all four in ONE `setParams` call — two
 * sequential writes each rebuild from the same closed-over snapshot and the
 * second restores what the first removed.
 *
 * ── The server matched; this file only compares ─────────────────────────────
 * Card membership (`row.filters`), the action cells, the type label, and the
 * search text all arrive resolved. What happens here is equality against a
 * register key and substring against the server's own `searchText` — layout,
 * not derivation, so §26.2's `prior_value` stays meaningful.
 *
 * ── The row is clickable; the NAME is the control ───────────────────────────
 * A `<tr>` carrying `role="button"` breaks the table's required children and
 * fails axe. The Founder's name is a real link — keyboard reachable,
 * announced, Enter opens it — and the row's click handler is mouse convenience
 * that ignores presses landing on a control of its own.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  FOUNDER_DIRECTORY_FILTERS,
  FOUNDER_TYPE_FILTERS,
  type FounderDirectoryFilterKey,
  type FounderTypeFilterKey,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchFounders, AdminRequestError, type FounderListRow } from '../api.js';

const FILTER_KEYS = FOUNDER_DIRECTORY_FILTERS.map((f) => f.key) as readonly string[];
const TYPE_KEYS = FOUNDER_TYPE_FILTERS.map((f) => f.key) as readonly string[];

export function FoundersList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FounderListRow[] | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('filter') ?? 'all';
  const filter: FounderDirectoryFilterKey = FILTER_KEYS.includes(rawFilter)
    ? (rawFilter as FounderDirectoryFilterKey)
    : 'all';
  const query = params.get('q') ?? '';
  const rawType = params.get('type') ?? 'all';
  const typeFilter: FounderTypeFilterKey = TYPE_KEYS.includes(rawType)
    ? (rawType as FounderTypeFilterKey)
    : 'all';
  const owner = params.get('owner') ?? 'all';

  /** One write per change; absent means default, so links stay short. */
  const setParam = useCallback(
    (key: string, value: string, defaultValue: string) => {
      const next = new URLSearchParams(params);
      if (value === defaultValue) next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(() => {
    setLoadError(null);
    fetchFounders()
      .then(({ founders }) => setRows(founders))
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The Founders directory could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, []);

  useEffect(load, [load]);
  useProovdMotion(surface, [rows]);

  /** Counts are aggregation of the server's own membership answer. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const key of FILTER_KEYS) map.set(key, 0);
    for (const row of rows ?? []) {
      for (const key of row.filters) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows ?? []) if (row.owner) set.add(row.owner);
    return [...set].sort();
  }, [rows]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!row.filters.includes(filter)) return false;
      if (q && !row.searchText.includes(q)) return false;
      if (typeFilter !== 'all') {
        const wanted =
          typeFilter === 'idea' ? 'Idea' : typeFilter === 'product' ? 'Product' : 'Proposed';
        if (row.typeLabel !== wanted) return false;
      }
      if (owner !== 'all' && row.owner !== owner) return false;
      return true;
    });
  }, [rows, filter, query, typeFilter, owner]);

  return (
    <div ref={surface} className="fdir">
      <div className="fdir-hero">
        <div>
          <p className="kicker">Founder operations</p>
          <h1 className="h2" data-reveal="headline">
            All Founders
          </h1>
          <p className="grey">
            Find any Founder, see what needs attention, and open the complete lifecycle record.
          </p>
        </div>
        {/* The five-step compose page (Session B) replaced the intake dialog. */}
        <RouterLink className="btn btn--primary" to="/admin/founders/new">
          <span className="btn__label">Create Founder</span>
        </RouterLink>
      </div>

      {loadError ? (
        <StatePanel
          state={loadError.detail.title}
          whatHappened={
            loadError.detail.whatHappened ??
            'The Founders directory could not be read, so nothing on this page is current.'
          }
          next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
          owner="Proovd"
          nextUpdate="When you try again"
          action={
            <Button tier="secondary" onClick={load}>
              Try the read again
            </Button>
          }
          reference="Admin · Founders"
          ring
        />
      ) : !rows ? (
        <StatePanel
          state="Reading the Founders directory"
          whatHappened="Proovd is reading every Founder, their lifecycle, and both action columns."
          next="The directory appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Founders"
        />
      ) : rows.length === 0 ? (
        <StatePanel
          state="No Founders yet"
          whatHappened="Nobody has been recorded from off-platform discovery, so there is nobody to invite."
          next="Create a Founder when you have met one. Nothing is sent until you compose the invitation and send it."
          owner="You"
          nextUpdate="No update is pending"
          action={
            <RouterLink className="btn btn--secondary" to="/admin/founders/new">
              <span className="btn__label">Create Founder</span>
            </RouterLink>
          }
          reference="Admin · Founders"
        />
      ) : (
        <>
          <div className="fdir-cards" role="group" aria-label="Directory filters">
            {FOUNDER_DIRECTORY_FILTERS.map((card) => (
              <button
                key={card.key}
                type="button"
                className={filter === card.key ? 'fdir-card is-active' : 'fdir-card'}
                aria-pressed={filter === card.key}
                onClick={() => setParam('filter', card.key, 'all')}
              >
                <strong>{counts.get(card.key) ?? 0}</strong>
                <span>{card.title}</span>
                <small>{card.subtitle}</small>
              </button>
            ))}
          </div>

          <div className="fdir-tools">
            <label className="fdir-tool fdir-tool--search">
              <span>Search</span>
              <input
                className="input"
                type="search"
                placeholder="Founder, email, business, or campaign"
                value={query}
                onChange={(event) => setParam('q', event.target.value, '')}
              />
            </label>
            <label className="fdir-tool">
              <span>Type</span>
              <select
                className="input"
                value={typeFilter}
                onChange={(event) => setParam('type', event.target.value, 'all')}
              >
                {FOUNDER_TYPE_FILTERS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fdir-tool">
              <span>Owner</span>
              {/*
                The values in use, not a closed list of people: the owner is
                free text on the record (the 2026-08-16 decision), so this
                filter matches the stored string and cannot answer "whose
                Founders are these" beyond what was typed.
              */}
              <select
                className="input"
                value={owner}
                onChange={(event) => setParam('owner', event.target.value, 'all')}
              >
                <option value="all">All owners</option>
                {owners.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p className="fdir-shown grey" aria-live="polite">
              {shown.length} shown
            </p>
          </div>

          {shown.length === 0 ? (
            <StatePanel
              state="Nothing matches these filters"
              whatHappened="Every Founder was read; none of them matches the current card, search, type, and owner together."
              next="Clear the filters to see the complete directory again."
              owner="You"
              nextUpdate="No update is pending"
              action={
                <Button
                  tier="secondary"
                  onClick={() => {
                    // One write clears everything (the ?q= lesson).
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  Clear all filters
                </Button>
              }
              reference="Admin · Founders"
            />
          ) : (
            <FoundersTable rows={shown} />
          )}
        </>
      )}
    </div>
  );
}

/* ── The table ─────────────────────────────────────────────────────────────── */

/** Initials for the avatar square. Presentation of a name the server sent. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toUpperCase() || '·';
}

function FoundersTable({ rows }: { rows: FounderListRow[] }) {
  const navigate = useNavigate();

  function openRow(event: MouseEvent<HTMLTableRowElement>, prospectId: string) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void navigate(`/admin/founders/${prospectId}`);
  }

  return (
    <div className="tablewrap">
      <table className="table fdir-table">
        <caption className="admin-table__caption">
          Type and lifecycle, the Admin and Founder action columns, and the internal owner.
        </caption>
        <thead>
          <tr>
            <th scope="col">Founder</th>
            <th scope="col">Type / Lifecycle</th>
            <th scope="col">Admin action</th>
            <th scope="col">Founder action</th>
            <th scope="col">Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.prospectId}
              className="fdr-row"
              data-scroll="rise"
              onClick={(event) => openRow(event, row.prospectId)}
            >
              <td>
                <span className="fdir-who">
                  <span className="fdir-avatar" aria-hidden="true">
                    {initialsOf(row.legalName || row.preferredName)}
                  </span>
                  <span>
                    <RouterLink className="fdr-name" to={`/admin/founders/${row.prospectId}`}>
                      <b>{row.legalName || row.preferredName}</b>
                    </RouterLink>
                    <span className="fdr-sub">
                      {[row.businessName ?? row.productName, row.email]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
              </td>
              <td>
                <span className="fdir-type">{row.typeLabel}</span>
                <span className="fdr-sub">{row.lifecycle}</span>
              </td>
              <td>
                <span className={row.adminAction.kind === 'due' ? 'fdir-due' : 'fdir-none'}>
                  {row.adminAction.label}
                </span>
              </td>
              <td>
                <span
                  className={
                    row.founderAction.kind === 'due' ? 'fdir-due fdir-due--founder' : 'fdir-none'
                  }
                >
                  {row.founderAction.label}
                </span>
              </td>
              <td className="grey">{row.owner ?? 'Not recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
