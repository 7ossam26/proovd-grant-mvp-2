/**
 * The Founders directory — Spec §26.1.
 *
 * The reference's own markup: `.directory-heading`, `.directory-search`, and a
 * `.founder-table` of seven columns whose head and rows share one set of grid
 * tracks, so a header can never drift off the column it names.
 *
 * ── Where each column's value comes from ────────────────────────────────────
 * Four of the seven are server-composed today (Founder, Business name, Campaign
 * type, Owner). Three depend on columns migration 0059 created but
 * `GET /api/admin/founders` does not compose yet — the workflow stage and its
 * sub-status, the campaign count, and `last_active_at`. Each of those renders
 * the server's value the moment it arrives and, until then, either the nearest
 * true fact the payload does carry (the composed lifecycle label under `Now`)
 * or a stated absence. None of them renders a zero or a guessed stage: §16a's
 * rule is that "not yet populated" is not zero, and a guessed stage on this
 * table would send somebody to the wrong screen.
 *
 * ── The search box and the server cannot disagree ───────────────────────────
 * `searchText` is composed by the same query that composes the row, and it is a
 * superset of the reference's matcher (which is name, business, product and
 * stage label). The stage label is appended because it is derived in the
 * browser and so cannot be in the server's string.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FOUNDER_WORKFLOW_LABELS,
  isFounderWorkflowStage,
  type FounderWorkflowStageId,
} from '@proovd/shared';
import {
  AdminRequestError,
  createAndInviteFounder,
  listFounders,
  type CreateAndInviteFounderInput,
  type FounderListRow,
} from './api.js';
import { CreateFounderDialog, type CreateFounderValues } from './CreateFounderDialog.js';
import { buildSearchCorpus, SearchDialog, type SearchItem } from './dialogs/SearchDialog.js';
import { DetailDialog } from './dialogs/DetailDialog.js';
import { Toast, useToast } from './dialogs/Toast.js';
import { useOverlayShortcuts } from './dialogs/Overlay.js';
import { relativeTime } from './format.js';

type DirectoryOverlay =
  | { kind: 'create' }
  | { kind: 'search' }
  | { kind: 'detail'; title: string; body: string };

/** The workflow stage the server recorded, or null while it is not composed. */
function stageOf(row: FounderListRow): FounderWorkflowStageId | null {
  const value = row.workflowStage;
  return value && isFounderWorkflowStage(value) ? value : null;
}

interface Props {
  onOpenFounder: (prospectId: string) => void;
}

export function Directory({ onOpenFounder }: Props) {
  const [rows, setRows] = useState<FounderListRow[] | null>(null);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [query, setQuery] = useState('');
  const [overlay, setOverlay] = useState<DirectoryOverlay | null>(null);
  // Held here rather than inside the sheet, so it survives closing and
  // reopening — the reference's behaviour, and the useful one when a search is
  // interrupted by the thing it found.
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    listFounders()
      .then((response) => setRows(response.founders))
      .catch((caught: unknown) => {
        if (caught instanceof AdminRequestError) setError(caught);
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  const openSearch = useCallback(() => setOverlay({ kind: 'search' }), []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useOverlayShortcuts({ onSearch: openSearch, onEscape: closeOverlay });

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const stage = stageOf(row);
      const haystack = `${row.searchText} ${stage ? FOUNDER_WORKFLOW_LABELS[stage] : ''}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [rows, query]);

  /**
   * "campaign records", never pluralised past that.
   *
   * `campaignCount` is the real answer and is used wherever the server sends
   * it. Until then each row can only report whether it has a CURRENT campaign,
   * so a person whose campaign was archived and restarted (§9's wrong-type
   * path) counts once here rather than twice. That is an undercount of a rare
   * path, not a fabricated number, and it corrects itself the moment the route
   * composes the column.
   */
  const campaignRecords = (rows ?? []).reduce(
    (total, row) => total + (row.campaignCount ?? (row.currentCampaign ? 1 : 0)),
    0,
  );

  const corpus = useMemo(() => buildSearchCorpus(rows ?? [], null), [rows]);

  async function create(values: CreateFounderValues) {
    const input: CreateAndInviteFounderInput = {
      requestKey: values.requestKey,
      legalName: values.name,
      email: values.email,
      businessName: values.company,
      invitationSource: values.invitationSource,
      internalOwner: values.owner,
      campaignType: values.campaign === 'Product Campaign' ? 'pre_launch' : 'pre_build',
      whatWeUnderstood: values.whatWeUnderstood,
      whyInvited: values.whyInvited,
      expectedSetupTime: values.expectedSetupTime,
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.location ? { location: values.location } : {}),
    };
    const created = await createAndInviteFounder(input);

    setOverlay(null);
    load();
    toast.show('Founder created and invitation sent');
    onOpenFounder(created.prospectId);
  }

  return (
    <>
      <section className="directory" id="main">
        <div className="directory-heading">
          <div>
            <p>Founders</p>
            <h1>All Founders</h1>
            <span>
              {rows === null
                ? 'Loading'
                : `${rows.length} total · ${campaignRecords} campaign records`}
            </span>
          </div>
          <button
            className="primary create-founder-button"
            type="button"
            onClick={() => setOverlay({ kind: 'create' })}
          >
            Create Founder
          </button>
        </div>

        <div className="directory-search">
          <label htmlFor="founder-search">Find a Founder</label>
          <input
            id="founder-search"
            placeholder="Name, business, product or status"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="founder-table" role="table">
          <div className="founder-table-head" role="row">
            <span>Founder</span>
            <span>Business</span>
            <span>Campaign</span>
            <span>Now</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Last active</span>
          </div>

          {error ? (
            /* The server already answers §27.1's six questions in its own
               words; paraphrasing them here is how the two start disagreeing. */
            <div className="founder-table-row" role="row">
              <span>
                <strong>{error.detail.title}</strong>
                <small>{error.detail.whatHappened ?? ''}</small>
              </span>
              <span>{error.detail.next ?? ''}</span>
            </div>
          ) : rows === null ? (
            <div className="founder-table-row" role="row">
              <span>Loading Founders…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="founder-table-row" role="row">
              <span>
                {rows.length === 0
                  ? 'No Founders yet. Create one to send the first invitation.'
                  : 'No Founder matches that search.'}
              </span>
            </div>
          ) : (
            visible.map((row) => {
              const stage = stageOf(row);
              return (
                <button
                  key={row.prospectId}
                  className="founder-table-row"
                  role="row"
                  type="button"
                  onClick={() => onOpenFounder(row.prospectId)}
                >
                  <span>
                    <strong>{row.legalName}</strong>
                    <small>{row.email}</small>
                  </span>
                  <span>
                    <strong>{row.businessName ?? 'No business recorded'}</strong>
                    <small>
                      {row.campaignCount === undefined
                        ? 'Campaigns not counted'
                        : `${row.campaignCount} campaigns`}
                    </small>
                  </span>
                  <span>{row.typeLabel.replace(' Campaign', '')}</span>
                  <span>
                    <strong>{stage ? FOUNDER_WORKFLOW_LABELS[stage] : row.lifecycle}</strong>
                  </span>
                  <span>
                    {row.workflowStatus ?? row.currentCampaign?.status ?? row.setup.stage}
                  </span>
                  <span>{row.owner ?? 'Unassigned'}</span>
                  <span>
                    {row.lastActiveAt ? relativeTime(row.lastActiveAt) : 'Not recorded'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {overlay?.kind === 'create' ? (
        <CreateFounderDialog
          onSubmit={create}
          onClose={closeOverlay}
          onRefuse={(message) => toast.show(message)}
        />
      ) : null}

      {overlay?.kind === 'search' ? (
        <SearchDialog
          corpus={corpus}
          query={searchQuery}
          onQuery={setSearchQuery}
          onOpen={(item: SearchItem) =>
            setOverlay({ kind: 'detail', title: item.title, body: `${item.type}\n${item.body}` })
          }
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.kind === 'detail' ? (
        <DetailDialog title={overlay.title} body={overlay.body} onClose={closeOverlay} />
      ) : null}

      <Toast message={toast.message} />
    </>
  );
}
