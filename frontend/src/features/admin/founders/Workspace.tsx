/**
 * One Founder's record — Spec §26.1, §26.2.
 *
 * The reference's own three bands: `.recordbar` (identity, position, tools),
 * `.founder-glance` (six facts), and the stage screen below them.
 *
 * ── Person-scoped, exactly as the payload is ────────────────────────────────
 * The address is `founder_prospects.id` — the PERSON. A Founder whose campaign
 * was archived-and-restarted (§9's wrong-type path) has more than one draft and
 * more than one campaign, and the prospect is what survives a restart. Keying
 * this screen on the draft is the mistake the backend workspace was rewritten
 * to correct, and it would show the same person twice with no relationship.
 *
 * ── Two different questions about "which stage" ─────────────────────────────
 * `stageNow` is where the record IS, derived from `campaigns.status` through
 * the shared register. `reached` is the furthest stage it has EVER been at —
 * `campaigns.workflow_stage_reached`, a ratchet with a trigger refusing a lower
 * index. They are not interchangeable: status moves backward, so a menu unlocked
 * from `stageNow` would re-lock a screen the moment a campaign was sent back for
 * changes. `shown` is a third thing again — what an Admin chose to open — and it
 * is never allowed past `reached`.
 *
 * Four lifecycle states (`refunded_no_creator`, `suspended`, `killed`,
 * `banned_founder`) map to no stage at all. They are exits from the workflow
 * rather than positions in it, so `stageForStatus` returns null and the record
 * bar renders the §23.1 lifecycle label instead of folding them into Complete.
 *
 * ── Nothing here composes a fact ────────────────────────────────────────────
 * Every label, state and action cell arrives resolved from the server. This
 * file decides layout, which stage screen renders, and which sheet is open.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  FOUNDER_WORKFLOW_LABELS,
  isFounderWorkflowStage,
  stageForStatus,
  workflowStageIndex,
  type FounderWorkflowStageId,
} from '@proovd/shared';
import {
  AdminRequestError,
  addFounderNote,
  addFounderWarning,
  fetchFounder,
  fetchFounderPanel,
  listFounders,
  openFounderSupportCase,
  recordAccessDecision,
  revokeFounderSessions,
  sendFounderPasswordRecovery,
  stopFounderCampaign,
  setApplicationReviewRequirement,
  updateProspect,
  type FounderListRow,
  type FounderWorkspaceDetail,
} from './api.js';
import { relativeTime } from './format.js';
import { StageMenu } from './StageMenu.js';
import { DecisionDialog } from './dialogs/DecisionDialog.js';
import { DetailDialog } from './dialogs/DetailDialog.js';
import { HistoryDialog } from './dialogs/HistoryDialog.js';
import { ManualEditDialog } from './dialogs/ManualEditDialog.js';
import { MessageDialog } from './dialogs/MessageDialog.js';
import { NotesDialog } from './dialogs/NotesDialog.js';
import { useOverlayShortcuts } from './dialogs/Overlay.js';
import { buildSearchCorpus, SearchDialog, type SearchItem } from './dialogs/SearchDialog.js';
import { SettingsDialog, type SettingsTool } from './dialogs/SettingsDialog.js';
import { openCaseCount, SupportDialog } from './dialogs/SupportDialog.js';
import { Toast, useToast } from './dialogs/Toast.js';
import { readPanel } from './stages/recordGroup.js';

/* ── The stage screens, resolved by convention rather than by a second list ── */

/**
 * Every module in `stages/`, collected by the bundler.
 *
 * This is deliberately not eleven `import` statements. The stage screens are
 * built one at a time and by a different hand; a static import list would make
 * this file fail to compile for every screen that has not landed yet, and the
 * panel would be un-runnable until all eleven existed. Collecting the directory
 * instead means a stage whose screen exists renders it, and a stage whose screen
 * does not yet exist falls through to the placeholder — which §1.4 requires to
 * exist at all, because an empty screen is indistinguishable from a broken one.
 *
 * The trade is that the modules arrive untyped, so `StageProps` is asserted once
 * here rather than checked eleven times. That assertion is the ONE place this
 * arrangement costs anything, and it is why the props are three obvious values
 * and not a wide surface.
 */
const STAGE_MODULES = import.meta.glob('./stages/*.tsx', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

export interface StageProps {
  detail: FounderWorkspaceDetail;
  /**
   * The `GET /api/admin/founder-panel/:prospectId` supplement — the workflow
   * position, the application review, the Admin offers, the notes, the invite
   * prefills. `undefined` while in flight, `null` once it has failed.
   *
   * Deliberately `unknown`: the server owns this payload's shape and it grows
   * stage by stage. `readPanel` in `stages/recordGroup.tsx` narrows it once, and
   * every stage reads through that — a second interface here would be a second
   * declaration of one payload, which is how two copies start disagreeing.
   */
  panel?: unknown;
  stageId: FounderWorkflowStageId;
  onSaved: () => void;
  /**
   * A stage's action bar moving to another stage — `Open Matching`,
   * `Open Campaign Setup`. It refuses anything past the ratchet, so a screen
   * cannot navigate somewhere the menu would have locked.
   */
  onOpenStage?: (stageId: string) => void;
}

const STAGE_SCREENS = new Map<string, ComponentType<StageProps>>();
for (const [path, module] of Object.entries(STAGE_MODULES)) {
  const name = (path.split('/').pop() ?? '').replace(/\.tsx$/, '');
  // The export named for the file, else a default export. Never "the first
  // exported function", which would happily pick up a helper.
  const exported = module[name] ?? module['default'];
  if (typeof exported === 'function') {
    STAGE_SCREENS.set(name, exported as ComponentType<StageProps>);
  }
}

function screenFor(id: FounderWorkflowStageId): ComponentType<StageProps> | null {
  const expected = `${id.charAt(0).toUpperCase()}${id.slice(1)}Stage`;
  const exact = STAGE_SCREENS.get(expected);
  if (exact) return exact;
  // A screen named for its heading rather than its id — `ApplicationReviewStage`
  // answering for `review` — is still that stage's screen.
  const suffix = expected.toLowerCase();
  for (const [name, component] of STAGE_SCREENS) {
    if (name.toLowerCase().endsWith(suffix)) return component;
  }
  return null;
}

const STAGE_PLACEHOLDER = STAGE_SCREENS.get('StagePlaceholder') ?? null;

/* ── Overlays ─────────────────────────────────────────────────────────────── */

type WorkspaceOverlay =
  | { kind: 'search' }
  | { kind: 'message' }
  | { kind: 'support' }
  | { kind: 'notes' }
  | { kind: 'history' }
  | { kind: 'stages' }
  | { kind: 'settings' }
  | { kind: 'detail'; title: string; body: string }
  | {
      kind: 'decision';
      title: string;
      prompt: string;
      confirmLabel: string;
      run: (reason: string) => Promise<void>;
    }
  | {
      kind: 'manual-edit';
      title: string;
      value: string;
      multiline: boolean;
      run: (value: string) => Promise<void>;
    };

interface Props {
  prospectId: string;
  onBack: () => void;
}

export function Workspace({ prospectId, onBack }: Props) {
  const [detail, setDetail] = useState<FounderWorkspaceDetail | null>(null);
  /* The panel supplement: `undefined` while the request is in flight, `null`
     once it has failed. The stages tell those two apart — one is "not yet",
     the other is "this section has no data and here is why". */
  const [panel, setPanel] = useState<unknown>(undefined);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [picked, setPicked] = useState<FounderWorkflowStageId | null>(null);
  const [overlay, setOverlay] = useState<WorkspaceOverlay | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [directory, setDirectory] = useState<FounderListRow[]>([]);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    fetchFounder(prospectId)
      .then(setDetail)
      .catch((caught: unknown) => {
        if (caught instanceof AdminRequestError) setError(caught);
      });

    /*
     * The panel supplement, fetched beside the workspace rather than inside it.
     *
     * Two requests because they are two subjects: `readFounderWorkspace` is the
     * §26.1 record every Admin surface reads, and this is what the eleven stages
     * additionally need — the workflow position, the application review, the
     * Admin offers, the notes, the invite prefills.
     *
     * Its failure is deliberately NOT a workspace error. The record still
     * renders from the payload above, and each stage says which of its own
     * sections it is missing — which is the honest state, and better than one
     * refusal blanking a screen that mostly worked.
     */
    fetchFounderPanel(prospectId)
      .then(setPanel)
      .catch(() => setPanel(null));
  }, [prospectId]);

  useEffect(load, [load]);

  // ⌘K's `Founder` and `Campaign` types come from the directory, which this
  // screen does not otherwise need. A failure here costs those two types and
  // nothing else, so it is not surfaced as a workspace error.
  useEffect(() => {
    listFounders()
      .then((response) => setDirectory(response.founders))
      .catch(() => setDirectory([]));
  }, []);

  const openSearch = useCallback(() => setOverlay({ kind: 'search' }), []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useOverlayShortcuts({ onSearch: openSearch, onEscape: closeOverlay });

  const corpus = useMemo(() => buildSearchCorpus(directory, detail), [directory, detail]);

  if (error) {
    return (
      <section className="workspace" id="main">
        <div className="workspace-grid">
          <div className="workspace-inner">
            <div className="stage-heading">
              <p className="stage-name">Founders</p>
              <h1>{error.detail.title}</h1>
              <p>{error.detail.whatHappened ?? ''}</p>
            </div>
            <div className="actionbar">
              <div>
                <small>{error.detail.next ?? ''}</small>
              </div>
              <div className="action-buttons">
                <button type="button" onClick={onBack}>
                  Back to Founders
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="workspace" id="main">
        <div className="workspace-grid">
          <div className="workspace-inner">
            <div className="stage-heading">
              <p className="stage-name">Founders</p>
              <h1>Loading the record…</h1>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const { header, overview, campaigns } = detail;
  const campaign = campaigns.current;
  const applicationReviewRequirement = readPanel(panel)?.applicationReviewRequirement;
  const internalNotes = readPanel(panel).notes ?? [];
  const accountWarnings = readPanel(panel).warnings ?? [];
  const reviewRequirement = campaign
    ? {
        required: applicationReviewRequirement?.required === true,
        locked: applicationReviewRequirement?.locked === true,
        lockedReason: applicationReviewRequirement?.lockedReason ?? null,
      }
    : null;

  const panelWorkflow = readPanel(panel)?.workflow;
  const panelStage = panelWorkflow?.stage;
  const stageNow =
    panelStage && isFounderWorkflowStage(panelStage)
      ? panelStage
      : stageForStatus(campaign?.rawStatus);
  const recorded = panelWorkflow?.stageReached ?? campaign?.workflowStageReached;
  const recordedStage = recorded && isFounderWorkflowStage(recorded) ? recorded : null;
  // The high-water mark, and never lower than where the record actually is:
  // until the route composes the ratchet column, the current stage IS the
  // furthest known one, which under-unlocks rather than over-unlocks.
  const reached: FounderWorkflowStageId =
    recordedStage === null
      ? (stageNow ?? 'invite')
      : stageNow !== null && workflowStageIndex(stageNow) > workflowStageIndex(recordedStage)
        ? stageNow
        : recordedStage;
  const shown: FounderWorkflowStageId = picked ?? stageNow ?? reached;

  const owner = overview.invitation.owner ?? 'Unassigned';
  const supportCases = detail.operations?.supportCases ?? [];
  const openCases = openCaseCount(supportCases);
  const draftId = overview.vetting.draftId;

  const Screen = screenFor(shown) ?? STAGE_PLACEHOLDER;

  /**
   * A stage's own navigation — `Open Matching`, `Open Campaign Setup`.
   *
   * It goes through the same ratchet the menu does, so a stage screen cannot
   * open somewhere the menu would have locked. A refused move says which stage
   * to finish first, in the menu's own words, rather than doing nothing.
   */
  function openStage(id: string) {
    if (!isFounderWorkflowStage(id)) return;
    if (workflowStageIndex(id) > workflowStageIndex(reached)) {
      toast.show(
        `${FOUNDER_WORKFLOW_LABELS[id]} is inactive. Go to ${FOUNDER_WORKFLOW_LABELS[reached]} first.`,
      );
      return;
    }
    setPicked(id);
  }

  /** Runs a write, keeps the sheet open on refusal, and reloads on success. */
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      setOverlay(null);
    } catch (caught: unknown) {
      if (caught instanceof AdminRequestError) {
        toast.show(
          [caught.detail.title, caught.detail.whatHappened].filter(Boolean).join(' — '),
        );
      } else {
        throw caught;
      }
    } finally {
      setBusy(false);
    }
  }

  function askAccessDecision(action: 'suspend' | 'restore') {
    setOverlay({
      kind: 'decision',
      title: action === 'suspend' ? 'Restrict account' : 'Restore account',
      prompt:
        action === 'suspend'
          ? 'Record why this account must be restricted. Access stops on the Founder’s next request and every record is preserved.'
          : 'Record why access is being returned. The restoration ends the review and is saved to History.',
      confirmLabel: action === 'suspend' ? 'Restrict account' : 'Restore account',
      run: async (reason: string) => {
        const next = await recordAccessDecision(prospectId, action, reason);
        setDetail(next);
        toast.show(action === 'suspend' ? 'Account restricted' : 'Account restored');
      },
    });
  }

  function askOwnerChange() {
    setOverlay({
      kind: 'manual-edit',
      title: 'Change campaign owner',
      value: overview.invitation.owner ?? '',
      multiline: false,
      run: async (value: string) => {
        await updateProspect(draftId, { internalOwner: value.trim() || null });
        load();
        toast.show(value.trim() ? `Owner changed to ${value.trim()}` : 'Owner cleared');
      },
    });
  }

  function askApplicationReviewRequirement(required: boolean) {
    if (!campaign) return;
    setOverlay({
      kind: 'decision',
      title: required ? 'Require Application Review' : 'Skip Application Review',
      prompt: required
        ? 'Record why this Founder must receive Application Review approval before listing-fee payment.'
        : 'Record why this Founder may skip Application Review and continue directly to listing-fee payment.',
      confirmLabel: required ? 'Turn on review' : 'Turn off review',
      run: async (reason: string) => {
        await setApplicationReviewRequirement(campaign.campaignId, required, reason);
        load();
        toast.show(required ? 'Application Review is now required' : 'Application Review will be skipped');
      },
    });
  }

  function exportJson(filename: string, value: unknown) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function askSessionRevocation() {
    setOverlay({
      kind: 'decision',
      title: 'Revoke active sessions',
      prompt: 'Record why every active Founder session must be revoked. The Founder will need to sign in again on every device.',
      confirmLabel: 'Revoke sessions',
      run: async (reason: string) => {
        const result = await revokeFounderSessions(prospectId, reason);
        load();
        toast.show(`${result.revoked} active session${result.revoked === 1 ? '' : 's'} revoked`);
      },
    });
  }

  function askCampaignStop() {
    if (!campaign) return;
    setOverlay({
      kind: 'decision',
      title: 'Stop campaign',
      prompt: 'Write the customer-facing explanation for stopping this campaign. This immediately suspends campaign actions, preserves the record, and notifies affected roles.',
      confirmLabel: 'Stop campaign',
      run: async (reason: string) => {
        await stopFounderCampaign(campaign.campaignId, reason);
        load();
        toast.show('Campaign stopped');
      },
    });
  }

  function askAccountWarning() {
    setOverlay({
      kind: 'decision',
      title: 'Add account warning',
      prompt: 'Record the evidence or behaviour that caused this persistent account warning. Warnings are append-only and remain in the audit record.',
      confirmLabel: 'Add warning',
      run: async (reason: string) => {
        await addFounderWarning(prospectId, reason);
        const updated = await fetchFounderPanel(prospectId);
        setPanel(updated);
        toast.show('Account warning added');
      },
    });
  }

  return (
    <>
      <section className="recordbar">
        <div className="founder-identity">
          <button className="back-button" type="button" onClick={onBack}>
            Back to Founders
          </button>
          <strong>{header.legalName}</strong>
          <p>
            {[header.businessName, campaign?.name].filter(Boolean).join(' · ') ||
              header.recordReference}
          </p>
        </div>
        <div className="record-status">
          {/* Where the record IS. A lifecycle state that is an exit from the
              workflow rather than a position in it keeps its §23.1 label. */}
          <span>{stageNow ? FOUNDER_WORKFLOW_LABELS[stageNow] : header.lifecycle}</span>
          <small>
            {campaign?.status ?? header.setup.stage} · Owner: {owner}
          </small>
        </div>
        <nav className="record-tools">
          <button type="button" onClick={() => setOverlay({ kind: 'message' })}>
            Message
          </button>
          <button type="button" onClick={() => setOverlay({ kind: 'support' })}>
            Support{openCases ? ` (${openCases})` : ''}
          </button>
          <button type="button" onClick={() => setOverlay({ kind: 'notes' })}>
            Notes
          </button>
          <button type="button" onClick={() => setOverlay({ kind: 'history' })}>
            History
          </button>
          <button
            className="menu-icon"
            type="button"
            aria-label="Open campaign workflow menu"
            title="Campaign workflow"
            onClick={() => setOverlay({ kind: 'stages' })}
          >
            ☰
          </button>
          <button
            className="settings-icon"
            type="button"
            aria-label="Founder and campaign settings"
            title="Founder and campaign settings"
            onClick={() => setOverlay({ kind: 'settings' })}
          >
            ⚙
          </button>
        </nav>
      </section>

      <section className="founder-glance">
        <div>
          <span>Email</span>
          <strong>{header.email}</strong>
        </div>
        <div>
          <span>Phone</span>
          {/* §33.1.8 pins `phone_verified` false at the database, so this is a
              number somebody wrote down and never a verified one. */}
          <strong>{header.phone || 'Missing'}</strong>
        </div>
        <div>
          <span>Location</span>
          <strong>{[header.state, header.country].filter(Boolean).join(', ') || 'Missing'}</strong>
        </div>
        <div>
          <span>Account</span>
          {/* The record's own vocabulary, not the reference's. `Access
              suspended` is the word the server, the audit row and the Founder's
              own refusal all use. */}
          <strong>{header.account}</strong>
        </div>
        <div>
          <span>Campaign</span>
          <strong>
            {campaign
              ? campaign.buildVersion
                ? `${campaign.name} · v${campaign.buildVersion}`
                : campaign.name
              : 'No campaign'}
          </strong>
        </div>
        <div>
          <span>Last active</span>
          <strong>
            {header.lastActiveAt ? relativeTime(header.lastActiveAt) : 'Not recorded'}
          </strong>
        </div>
      </section>

      {Screen ? (
        <Screen
          detail={detail}
          panel={panel}
          stageId={shown}
          onSaved={load}
          onOpenStage={openStage}
        />
      ) : (
        /* No screen and no placeholder on disk. §1.4: an empty `.workspace`
           would be indistinguishable from a broken one, so it says which. */
        <section className="workspace" id="main">
          <div className="workspace-grid">
            <div className="workspace-inner">
              <div className="stage-heading">
                <p className="stage-name">{FOUNDER_WORKFLOW_LABELS[shown]}</p>
                <h1>This stage has no screen yet</h1>
                <p>
                  The record behind it is complete — the server composes every fact this stage
                  needs. What is missing is the screen.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {overlay?.kind === 'stages' ? (
        <StageMenu
          shown={shown}
          reached={reached}
          onPick={(id) => {
            setPicked(id);
            setOverlay(null);
          }}
          onClose={closeOverlay}
          onRefuse={(message) => toast.show(message)}
        />
      ) : null}

      {overlay?.kind === 'message' ? (
        <MessageDialog
          founderName={header.legalName}
          onOpenSupport={() => setOverlay({ kind: 'support' })}
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.kind === 'support' ? (
        <SupportDialog
          cases={supportCases}
          canCreate={header.account !== 'Not created yet'}
          onCreate={async (input) => {
            const opened = await openFounderSupportCase({
              prospectId,
              requesterEmail: header.email,
              ...(campaign ? { campaignId: campaign.campaignId } : {}),
              ...input,
            });
            const updated = await fetchFounder(prospectId);
            setDetail(updated);
            toast.show(`Support case ${opened.reference} opened`);
          }}
          onOpenDetail={(title, body) => setOverlay({ kind: 'detail', title, body })}
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.kind === 'notes' ? (
        <NotesDialog
          founderName={header.legalName}
          notes={internalNotes}
          onAdd={async (body) => {
            await addFounderNote(prospectId, body);
            const updated = await fetchFounderPanel(prospectId);
            setPanel(updated);
            toast.show('Internal note added');
          }}
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.kind === 'history' ? (
        <HistoryDialog
          founderName={header.legalName}
          entries={detail.history}
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.kind === 'settings' ? (
        <SettingsDialog
          detail={detail}
          applicationReviewRequirement={reviewRequirement}
          onTool={(tool: SettingsTool) => setOverlay({ kind: tool })}
          onAccessDecision={askAccessDecision}
          onApplicationReviewRequirement={askApplicationReviewRequirement}
          onPasswordRecovery={() => {
            void run(async () => {
              await sendFounderPasswordRecovery(prospectId);
              toast.show('Password reset email requested');
            });
          }}
          onRevokeSessions={askSessionRevocation}
          warningCount={accountWarnings.length}
          onAddWarning={askAccountWarning}
          onExportAccount={() => {
            exportJson(`founder-${header.recordReference}.json`, {
              exportedAt: new Date().toISOString(),
              header: detail.header,
              overview: detail.overview,
              operations: detail.operations,
              history: detail.history,
              notes: internalNotes,
            });
            toast.show('Founder account export downloaded');
          }}
          onExportCampaign={() => {
            if (!campaign) return;
            exportJson(`campaign-${campaign.campaignId}.json`, {
              exportedAt: new Date().toISOString(),
              campaign,
              panel,
              workspace: detail,
            });
            toast.show('Complete campaign export downloaded');
          }}
          onStopCampaign={askCampaignStop}
          onChangeOwner={askOwnerChange}
          onClose={closeOverlay}
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

      {overlay?.kind === 'decision' ? (
        <DecisionDialog
          title={overlay.title}
          prompt={overlay.prompt}
          confirmLabel={overlay.confirmLabel}
          busy={busy}
          onConfirm={(reason) => {
            const { run: work } = overlay;
            void run(() => work(reason));
          }}
          onClose={closeOverlay}
          onRefuse={(message) => toast.show(message)}
        />
      ) : null}

      {overlay?.kind === 'manual-edit' ? (
        <ManualEditDialog
          title={overlay.title}
          value={overlay.value}
          multiline={overlay.multiline}
          busy={busy}
          onSave={(value) => {
            const { run: work } = overlay;
            void run(() => work(value));
          }}
          onClose={closeOverlay}
        />
      ) : null}

      <Toast message={toast.message} />
    </>
  );
}
