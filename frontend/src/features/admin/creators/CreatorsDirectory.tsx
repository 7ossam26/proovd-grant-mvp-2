/**
 * Admin → Creators — Spec §26.1, §8, DNA §5.2, §5.14.
 *
 * Every Affiliate Proovd has ever recruited, one row each, and one gesture into
 * the record that holds the rest.
 *
 * ── A row is a PERSON, not a campaign relationship ──────────────────────────
 * The deleted Creators screen was campaign-scoped — `?campaignId=` — so a
 * Creator recruited to two campaigns appeared twice with no relationship
 * between the rows, and "what else are they running" was not a question the
 * product could answer. `affiliate_prospects` is the person, so the row is the
 * prospect and the address is `/admin/creators/:prospectId`.
 *
 * ── The filter is in the URL ────────────────────────────────────────────────
 * The reference's H1 IS the filter label, so the filter is the identity of the
 * page — and a page identity that vanishes on reload is one an Admin cannot
 * send to somebody. `?filter=` carries it (DNA §5.12: position survives
 * interruption, and a URL is the cheapest durable position there is).
 *
 * ── The server resolved every cell, and this file resolves none ─────────────
 * `verification`, `payout`, `account`, `attention`, and the three filter
 * booleans arrive as the words and answers they render. §26.2's override
 * machinery needs a `prior_value` to compare against, and a value the browser
 * derived has none — so nothing here maps a status to a label or decides
 * whether an Affiliate needs Admin work.
 *
 * ── The row is clickable; the NAME is the control ───────────────────────────
 * The reference builds its rows as a CSS grid of `<article>`s. That is the
 * layout kept here, and the name inside each row is a real link — keyboard
 * reachable, announced, Enter opens it — with the row's own click handler as
 * mouse convenience on top, ignoring presses that landed on a control.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  CREATOR_DIRECTORY_FILTERS,
  CREATOR_NO_ATTENTION_LABEL,
  isCreatorDirectoryFilter,
  type CreatorDirectoryFilter,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCreators, AdminRequestError, type CreatorDirectoryRow } from './api.js';
import { Monogram, OwnerPill, StateChip, payoutTone, verificationTone } from './shared.js';
import { AddCreatorDialog } from './dialogs/AddCreatorDialog.js';
import { CreatorSearch } from './CreatorSearch.js';

export function CreatorsDirectory() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CreatorDirectoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [params, setParams] = useSearchParams();
  const [addTrigger, setAddTrigger] = useState<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const raw = params.get('filter') ?? 'all';
  const filter: CreatorDirectoryFilter = isCreatorDirectoryFilter(raw) ? raw : 'all';

  /**
   * The search term is in the URL, exactly as the filter is (2026-08-15).
   *
   * It was local state until the Campaigns hub needed to link a campaign's
   * roster here. That workspace is keyed on the PERSON and a campaign has a
   * roster rather than one Creator, so the honest destination is this directory
   * with the campaign name already searched — and `searchText` carries every
   * campaign a Creator is on, which is why searching it works.
   *
   * `?q=` was ignored before this, so that link promised a pre-search and
   * delivered an unfiltered list. A parameter a surface accepts and drops is
   * worse than one it never offered.
   *
   * It is also the same DNA §5.12 point this file already records for the
   * filter: a searched directory is a position, and a position that vanishes on
   * reload is one an Admin cannot send to a colleague.
   */
  const query = params.get('q') ?? '';
  const setQuery = useCallback(
    (next: string) => {
      const updated = new URLSearchParams(params);
      if (next.trim() === '') updated.delete('q');
      else updated.set('q', next);
      // `replace`, so typing does not fill the back stack with keystrokes.
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(() => {
    setLoadError(null);
    fetchCreators()
      .then(({ creators }) => setRows(creators))
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The Affiliate directory could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, []);

  useEffect(load, [load]);

  // The headline reveal and the row rise are declarative recipes; this re-binds
  // them when the list arrives, because the runtime attaches to the nodes that
  // existed when it last ran and React has replaced them by then.
  useProovdMotion(surface, [rows, filter]);

  const label = CREATOR_DIRECTORY_FILTERS.find((f) => f.key === filter)!.label;

  /**
   * Search and filter, in that order.
   *
   * `searchText` is composed server-side across the name, handle, email,
   * platform, niche, channel reference, subtype, and every campaign the person
   * is on — so what the box matches is a fact the server decided, not a set of
   * fields this component happened to concatenate.
   */
  const shown = useMemo(() => {
    if (!rows) return null;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !row.searchText.includes(needle)) return false;
      if (filter === 'admin') return row.filters.adminWork;
      if (filter === 'verification') return row.filters.verification;
      if (filter === 'payout') return row.filters.payout;
      return true;
    });
  }, [rows, query, filter]);

  function chooseFilter(next: CreatorDirectoryFilter) {
    const updated = new URLSearchParams(params);
    if (next === 'all') updated.delete('filter');
    else updated.set('filter', next);
    setParams(updated, { replace: true });
  }

  return (
    <div ref={surface}>
      <div className="cr-hero">
        <div>
          <p className="kicker">Affiliate workspace</p>
          <h1 className="cr-hero__title" data-reveal="headline">
            {label}
          </h1>
          {shown && rows ? (
            <p className="grey">
              {shown.length} of {rows.length}{' '}
              {rows.length === 1 ? 'Affiliate' : 'Affiliates'}
            </p>
          ) : null}
        </div>
        <div className="cr-hero__actions">
          {/*
            The `/` palette. It finds a person from anywhere in the section,
            which is the move the box below cannot make — that one narrows a
            list you are already looking at.
          */}
          <CreatorSearch />
          <Button onClick={(event) => setAddTrigger(event.currentTarget)}>Add Affiliate</Button>
        </div>
      </div>

      {addTrigger ? (
        <AddCreatorDialog
          trigger={addTrigger}
          onClose={() => setAddTrigger(null)}
          onCreated={(prospectId) => {
            // The done-moment is their record, not a row appearing in a list
            // (DNA §5.4): the next thing an Admin does is compose the
            // invitation. The directory is refreshed behind it so a Back lands
            // on a current page.
            load();
            setAddTrigger(null);
            void navigate(`/admin/creators/${prospectId}`);
          }}
        />
      ) : null}

      <div className="cr-tools">
        <label className="cr-search">
          <span className="sr-only">Search Affiliates</span>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, handle, email, channel…"
          />
        </label>
        <div className="filters" role="group" aria-label="Affiliate directory filters">
          {CREATOR_DIRECTORY_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn('filter-tag', filter === item.key && 'is-active')}
              aria-pressed={filter === item.key}
              onClick={() => chooseFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <StatePanel
          state={loadError.detail.title}
          whatHappened={
            loadError.detail.whatHappened ??
            'The Affiliate directory could not be read, so nothing on this page is current.'
          }
          next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
          owner="Proovd"
          nextUpdate="When you try again"
          action={
            <Button tier="secondary" onClick={load}>
              Try the read again
            </Button>
          }
          reference="Admin · Creators"
          ring
        />
      ) : !shown ? (
        <StatePanel
          state="Reading the Affiliate directory"
          whatHappened="Proovd is reading every Affiliate, their verification and payout state, and what needs attention."
          next="The directory appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Creators"
        />
      ) : shown.length === 0 ? (
        <EmptyDirectory
          filtered={Boolean(query.trim()) || filter !== 'all'}
          /*
            One write, not two. Now that both the search and the filter live in
            the URL, calling `setQuery('')` and `chooseFilter('all')` in sequence
            would have each build its `URLSearchParams` from the SAME closed-over
            `params` — so the second would land on top of the first and restore
            the term it had just cleared. Clearing both in one call is the fix.
          */
          onClear={() => setParams(new URLSearchParams(), { replace: true })}
          onAdd={(event) => setAddTrigger(event.currentTarget)}
        />
      ) : (
        <DirectoryList rows={shown} />
      )}
    </div>
  );
}

/* ── The list ───────────────────────────────────────────────────────────────*/

function DirectoryList({ rows }: { rows: CreatorDirectoryRow[] }) {
  const navigate = useNavigate();

  /**
   * Mouse convenience only. A press that landed on the name link has already
   * been answered — opening the record on top of it would be two answers to
   * one click.
   */
  function openRow(event: MouseEvent<HTMLElement>, prospectId: string) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void navigate(`/admin/creators/${prospectId}`);
  }

  return (
    <div className="cr-list" aria-label="Affiliate directory">
      <div className="cr-list__head" aria-hidden="true">
        <span>Affiliate</span>
        <span>Verification</span>
        <span>Campaigns</span>
        <span>Current state</span>
        <span />
      </div>
      {rows.map((row) => (
        <article
          key={row.prospectId}
          className="cr-row"
          data-scroll="rise"
          onClick={(event) => openRow(event, row.prospectId)}
        >
          <div className="cr-cell cr-cell--identity">
            <Monogram>{row.initials}</Monogram>
            <span>
              <RouterLink className="cr-row__name" to={`/admin/creators/${row.prospectId}`}>
                <b>{row.name}</b>
              </RouterLink>
              <small>
                {[row.handle, row.platform].filter(Boolean).join(' · ') || 'No channel recorded'}
              </small>
            </span>
          </div>

          <div className="cr-cell">
            <StateChip tone={verificationTone(row.verification.state)}>
              {row.verification.label}
            </StateChip>
            <small>
              {row.verification.at ??
                (row.verification.missing > 0
                  ? `${row.verification.missing} evidence ${row.verification.missing === 1 ? 'input' : 'inputs'} outstanding`
                  : 'Decision pending')}
            </small>
          </div>

          <div className="cr-cell">
            <strong>
              {row.campaigns.activeSlots} of {row.campaigns.slotLimit} active
            </strong>
            <small>
              {row.campaigns.total} total
              {row.campaigns.leadLabel ? ` · ${row.campaigns.leadLabel}` : ''}
            </small>
          </div>

          <div className="cr-cell cr-cell--attention">
            {row.attention.needed ? (
              <>
                <OwnerPill owner={row.attention.owner} />
                <strong>{row.attention.label}</strong>
                <small>{row.attention.detail}</small>
              </>
            ) : (
              <>
                <strong className="grey">{CREATOR_NO_ATTENTION_LABEL}</strong>
                <small>
                  {row.account} · {row.payout.label}
                </small>
              </>
            )}
          </div>

          <div className="cr-cell cr-cell--action">
            <Button
              tier="secondary"
              small
              onClick={() => void navigate(`/admin/creators/${row.prospectId}`)}
            >
              View Affiliate record
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ── Empty ──────────────────────────────────────────────────────────────────*/

/**
 * Two empty states, not one.
 *
 * "Nobody has been recruited" and "your filter matched nobody" are different
 * facts with different next actions, and answering both with one sentence is
 * how a filter that is quietly on reads as an empty product (§27.1).
 */
function EmptyDirectory({
  filtered,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: (event: MouseEvent<HTMLElement>) => void;
}) {
  if (filtered) {
    return (
      <StatePanel
        state="No Affiliates match"
        whatHappened="Every Affiliate is still recorded — this search and filter combination matched none of them."
        next="Clear the filters to see the whole directory again."
        owner="You"
        nextUpdate="No update is pending"
        action={
          <Button tier="secondary" onClick={onClear}>
            Clear Affiliate filters
          </Button>
        }
        reference="Admin · Creators"
      />
    );
  }
  return (
    <StatePanel
      state="No Affiliates yet"
      whatHappened="Nobody has been recruited from off-platform research, so there is nobody to invite."
      next="Add an Affiliate when you have found one. Recording a prospect creates no account and sends nothing."
      owner="You"
      nextUpdate="No update is pending"
      action={
        <Button tier="secondary" onClick={onAdd}>
          Add Affiliate
        </Button>
      }
      reference="Admin · Creators"
    />
  );
}
