/**
 * Stage 3 — Application review. Spec §9, §12, §25.6, §27.
 *
 * The exact submitted values, and one decision: approve, reject, or send a
 * specific field back. The action bar states the difference the whole screen
 * turns on — `Edit` changes the saved value directly, `Request change` sends
 * that exact field back to the Founder — because the two look identical in a
 * row and are opposite acts.
 *
 * Structure, copy, classes, order and enabled states are the reference's. Only
 * the DATA differs, and one thing more: every control calls a real route.
 *
 * ── Which route each `Edit` calls ──────────────────────────────────────────
 * · the campaign choice   → `PUT …/campaign-path`
 * · the identity fields   → `PUT …/fields/:key` (§25.6, with its reason)
 * · the Admin prefills    → `PUT …/prefills`  (migration 0059's columns)
 * · Problem and Solution  → `PUT …/vetting-prefill`
 * · everything else       → `PUT …/fields/:key` under the row's own key
 *
 * The last line is the important one. `enforce_vetting_write()` refuses a
 * submitted answer at the database, and the §25.6 register does not carry a key
 * for a password or an optional-item body. Those edits are still offered, they
 * still call the route that owns the record, and the SERVER'S refusal is what
 * the Admin reads. Nothing here predicts a refusal and nothing reports a save
 * that did not happen (§1.4).
 *
 * ── The decision has its own record, not a lifecycle state ─────────────────
 * §9 defines no application-review state and `campaigns.status` cannot carry
 * one: `pending_review` / `changes_required` / `approved` already belong to the
 * §15 BUILD review, a different decision later in the flow. So the outcome and
 * the round come from `campaign_application_reviews` by way of the panel route,
 * and `Application version` reads that round — never a status.
 *
 * Reject opens the reference's own decision dialog and records its reason.
 * Approve is a direct action, as the reference builds it; the reason recorded
 * against it is the sentence the reference itself writes to history.
 */

import { useRef, useState } from 'react';
import { PREFILL_AFFILIATE_TYPES, applicationReviewLabel } from '@proovd/shared';
import {
  AdminRequestError,
  decideApplicationReview,
  prefillVetting,
  requestApplicationChange,
  saveFounderPrefills,
  setCampaignPath,
  updateFounderField,
  type FounderPrefillPatch,
} from '../api.js';
import { relativeTime } from '../format.js';
import {
  DecisionDialog,
  ManualEditDialog,
  RecordGroup,
  RequestChangeDialog,
  StageFrame,
  StateStrip,
  ValueDialog,
  accountRows,
  action,
  asRequestError,
  campaignAnswerRows,
  downloadFile,
  downloadNameFor,
  firstName,
  minusUsd,
  optionalItemRows,
  readPanel,
  refusalLine,
  withActions,
  type RecordRowProps,
  type RowAction,
  type SharedRow,
  type StageProps,
} from './recordGroup.js';

/* ── Where a row's `Edit` writes ───────────────────────────────────────────── */

type EditSpec =
  | { kind: 'field'; fieldKey: string }
  | { kind: 'path' }
  | { kind: 'vetting'; answer: 'problem' | 'solution' }
  | {
      kind: 'prefill';
      patch: (value: string) => FounderPrefillPatch;
      options?: readonly { id: string; label: string }[];
    };

/** The two campaign paths, in the customer-facing words (§3). */
const CAMPAIGN_PATHS = [
  { id: 'pre_launch', label: 'Product Campaign' },
  { id: 'pre_build', label: 'Idea Campaign' },
] as const;

const EDITS: Record<string, EditSpec> = {
  campaign_choice: { kind: 'path' },
  email_verification: { kind: 'field', fieldKey: 'email' },
  phone: { kind: 'field', fieldKey: 'phone' },
  dob: { kind: 'field', fieldKey: 'dob' },
  display_name: { kind: 'field', fieldKey: 'preferred' },
  legal_name: { kind: 'field', fieldKey: 'legal' },
  username: { kind: 'prefill', patch: (v) => ({ username: v.trim() || null }) },
  problem: { kind: 'vetting', answer: 'problem' },
  solution: { kind: 'vetting', answer: 'solution' },
  views_count: { kind: 'prefill', patch: (v) => ({ viewsCount: countOrNull(v) }) },
  affiliate_matches: { kind: 'prefill', patch: (v) => ({ affiliateMatches: countOrNull(v) }) },
  affiliate_type: {
    kind: 'prefill',
    patch: (v) => ({ affiliateType: v || null }),
    options: PREFILL_AFFILIATE_TYPES,
  },
};

/** The chooser a row's edit dialog offers, where the value is chosen not typed. */
function editOptions(key: string): readonly { id: string; label: string }[] | undefined {
  const spec: EditSpec | undefined = EDITS[key];
  if (spec?.kind === 'path') return CAMPAIGN_PATHS;
  return spec?.kind === 'prefill' ? spec.options : undefined;
}

/** An empty field is "nobody recorded one", never `0` (§1.4). */
function countOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

type OpenDialog =
  | { kind: 'edit'; row: SharedRow }
  | { kind: 'request'; row: SharedRow }
  | { kind: 'view'; label: string; lines: string[] }
  | { kind: 'reject' };

export function ApplicationReviewStage({ detail, panel, onSaved }: StageProps) {
  const { header, overview, campaigns } = detail;
  const p = readPanel(panel);
  const review = p.applicationReview;
  const campaignId = campaigns.current?.campaignId ?? null;
  const draftId = overview.vetting.draftId;

  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const groupsRef = useRef<HTMLDivElement>(null);

  /* §25.6 requires a reason once the Founder owns the account — which, on a
     submitted application, is always. The server decides; this only asks. */
  const reasonRequired = overview.accountCreatedAt !== null;

  async function run(work: () => Promise<unknown>, closed: string, closeDialog = true) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
      setDone(closed);
      if (closeDialog) setOpen(null);
      onSaved();
    } catch (e: unknown) {
      setError(asRequestError(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Every row's edit goes to the route that owns its record, and a row with no
   * dedicated route goes to §25.6's field route under its own key — which is
   * the closest real write, and which refuses a key it does not carry.
   */
  const saveEdit = (row: SharedRow, value: string, reason: string) => {
    const spec: EditSpec | undefined = EDITS[row.key];
    void run(() => {
      if (spec?.kind === 'path') {
        return setCampaignPath(draftId, value === '' ? null : (value as 'pre_build' | 'pre_launch'));
      }
      if (spec?.kind === 'vetting') {
        return spec.answer === 'problem'
          ? prefillVetting(draftId, { problem: value })
          : prefillVetting(draftId, { solution: value });
      }
      if (spec?.kind === 'prefill') {
        return saveFounderPrefills(draftId, spec.patch(value));
      }
      const fieldKey = spec?.kind === 'field' ? spec.fieldKey : row.key;
      return updateFounderField(header.prospectId, fieldKey, value, reason || undefined);
    }, `${row.label} saved.`);
  };

  const requestChange = (row: SharedRow, reason: string) => {
    if (!campaignId) return;
    void run(
      () => requestApplicationChange(campaignId, { fieldKey: row.key, reason }),
      `Change requested against ${row.label}.`,
    );
  };

  const reject = (internalReason: string, customerExplanation: string) => {
    if (!campaignId) return;
    void run(
      () =>
        decideApplicationReview(campaignId, {
          outcome: 'rejected',
          internalReason,
          ...(customerExplanation ? { customerExplanation } : {}),
        }),
      'Application rejected.',
    );
  };

  /**
   * The reference approves straight from the action bar with no dialog, and
   * writes `Onboarding submission N approved by Admin.` to its history. That
   * sentence is what goes in §25.6's internal reason — the reference's own
   * words for the act, rather than a blank the route would have to refuse or a
   * reason invented here.
   */
  const approve = () => {
    if (!campaignId) return;
    const round = review?.round ?? 1;
    void run(
      () =>
        decideApplicationReview(campaignId, {
          outcome: 'approved',
          internalReason: `Onboarding submission ${round} approved by Admin.`,
        }),
      'Application approved.',
      false,
    );
  };

  /* ── The controls every reviewable row carries ─────────────────────────── */

  const editAction = (row: SharedRow): RowAction =>
    action('Edit', () => setOpen({ kind: 'edit', row }));

  const requestAction = (row: SharedRow): RowAction =>
    action('Request change', () => setOpen({ kind: 'request', row }));

  const viewAction = (row: SharedRow): RowAction =>
    action('View', () =>
      setOpen({ kind: 'view', label: row.label, lines: row.value ? [row.value] : [] }),
    );

  const downloadAction = (row: SharedRow): RowAction =>
    action('Download', () => downloadFile(downloadNameFor(row.label), row.value ?? ''));

  const isProse = (key: string) =>
    key === 'problem' || key === 'solution' || key === 'competition';

  const group1 = accountRows(detail, p).map((row) =>
    withActions(row, [editAction(row), requestAction(row)]),
  );

  const answerRows = campaignAnswerRows(detail, p);
  const group2 = answerRows.map((row) =>
    withActions(
      row,
      isProse(row.key)
        ? [editAction(row), requestAction(row), viewAction(row), downloadAction(row)]
        : [editAction(row), requestAction(row)],
    ),
  );

  const optionalRows = optionalItemRows(p);
  const group3 = optionalRows.map((row) => {
    const base = [editAction(row), requestAction(row)];
    if (row.key === 'optional.visuals') return withActions(row, [...base, downloadAction(row)]);
    if (row.key === 'optional.story')
      return withActions(row, [...base, viewAction(row), downloadAction(row)]);
    return withActions(row, base);
  });

  /* ── Review totals ─────────────────────────────────────────────────────── */

  /*
   * The one amount on this group, and it is the server's. The reference works
   * `−$${n*2}` out in the browser; that is the second answer §24.3 exists to
   * prevent, so an absent `discountCents` renders as absent.
   */
  const required = review?.requiredAnswers;
  const optional = review?.optionalQualifications;
  const optionalSaving = minusUsd(optional?.discountCents);

  /*
   * Where the review record does not carry the two lists, they are restated
   * from the rows already on this screen — the same facts in one line instead
   * of nine, which keeps the totals from disagreeing with the group they
   * summarise. `Branding · logos` is excluded because it is a display row over
   * the branding record, not a sixth §12 item. Nothing about money is ever
   * restated this way.
   */
  const requiredRows = answerRows.filter((r) => isProse(r.key));
  const requiredLabels = required?.labels?.length
    ? required.labels
    : requiredRows.map((r) => r.label);
  const requiredConfirmed =
    required?.confirmed ?? requiredRows.filter((r) => r.value !== null).length;
  const requiredTotal = required?.total ?? requiredLabels.length;

  const qualifyingRows = optionalRows.filter(
    (r) => r.tone === 'done' && r.key !== 'optional.branding.logos',
  );
  const optionalLabels = optional?.labels?.length
    ? optional.labels
    : qualifyingRows.map((r) => r.label);
  const optionalQualified = optional?.qualified ?? qualifyingRows.length;
  const optionalTotal = optional?.total ?? null;

  const outcomeLabel = review?.outcome ? applicationReviewLabel(review.outcome) : null;

  const totalsActions = (row: SharedRow) => [editAction(row), requestAction(row)];

  const totals: SharedRow[] = [
    {
      key: 'review_required',
      label: 'Required answers',
      value: requiredLabels.length ? requiredLabels.join(' · ') : null,
      absence: 'The record does not state which answers were required',
      source: 'Founder submitted',
      status: `${requiredConfirmed} of ${requiredTotal} confirmed`,
      tone: requiredConfirmed === requiredTotal ? 'done' : 'waiting',
    },
    {
      key: 'review_optional',
      label: 'Optional qualifications',
      value: optionalLabels.length ? optionalLabels.join(' · ') : null,
      absence: 'No optional item qualified',
      source: 'Derived from Founder values',
      status: [
        optionalTotal === null
          ? `${optionalQualified} qualified`
          : `${optionalQualified} of ${optionalTotal}`,
        optionalSaving,
      ]
        .filter(Boolean)
        .join(' · '),
      tone: 'done',
    },
    {
      key: 'review_version',
      label: 'Application version',
      value:
        review?.round === undefined || review?.round === null
          ? null
          : `Submission ${review.round}`,
      absence: 'No application review round is open on this campaign',
      source: 'Immutable snapshot',
      status: outcomeLabel ?? 'Not stated by this record',
      /* The reference's own rule: only a changes-requested round is a task. */
      tone: outcomeLabel === 'Changes requested' ? 'action' : 'plain',
    },
  ];

  const group4: RecordRowProps[] = totals.map((row) => withActions(row, totalsActions(row)));

  const waiting = review?.outcome === 'waiting';
  const statusLine =
    done ??
    refusalLine(error) ??
    'Edit changes the saved value directly. Request change sends that exact field back to the Founder.';

  return (
    <>
      <StageFrame
        stage="Application review"
        heading="Application decision"
        lead="Review the exact submitted values and request changes against specific fields."
      >
        <StateStrip
          status={outcomeLabel ?? 'Not stated by this record'}
          lastChange={
            review?.submittedAt
              ? `Submitted ${relativeTime(review.submittedAt)}`
              : 'No submission recorded against this campaign'
          }
          next="Approve, reject, or request changes"
        />

        {/* Only while the decision is genuinely outstanding — an attention line
            over a decided application is a task that does not exist (§1.4). */}
        {waiting ? (
          <button
            className="attention-line"
            type="button"
            onClick={() => groupsRef.current?.scrollIntoView({ block: 'start' })}
          >
            <span>
              <strong>Needs attention</strong>The application needs an Admin decision.
            </span>
            <span>Open below</span>
          </button>
        ) : null}

        <div className="record-groups" ref={groupsRef}>
          <RecordGroup title="Founder and account" rows={group1} />
          <RecordGroup title="Campaign answers" rows={group2} />
          <RecordGroup title="Optional items" rows={group3} />
          <RecordGroup title="Review totals" rows={group4} />

          <div className="actionbar">
            <div>
              <small>{statusLine}</small>
            </div>
            <div className="action-buttons">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen({ kind: 'reject' })}
              >
                Reject
              </button>
              <button className="primary" type="button" disabled={busy} onClick={approve}>
                Approve application
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {open?.kind === 'edit' ? (
        <ManualEditDialog
          label={open.row.label}
          /* A chooser's value is its register id, not the label the row shows —
             otherwise the select opens on nothing and a save writes a blank. */
          initialValue={
            open.row.key === 'campaign_choice'
              ? (overview.vetting.campaignTypeSelectedRaw ?? '')
              : open.row.key === 'affiliate_type'
                ? (p.prefills?.affiliateType ?? '')
                : (open.row.value ?? '')
          }
          options={editOptions(open.row.key)}
          reasonRequired={reasonRequired}
          busy={busy}
          refusal={refusalLine(error)}
          onSave={(value, reason) => saveEdit(open.row, value, reason)}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === 'request' ? (
        <RequestChangeDialog
          label={open.row.label}
          founderName={firstName(header.preferredName)}
          busy={busy}
          refusal={refusalLine(error)}
          onRequest={(reason) => requestChange(open.row, reason)}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === 'reject' ? (
        <DecisionDialog
          kicker="Admin decision"
          heading="Reject application"
          lead="Record the rejection reason and reapplication rule."
          submitLabel="Reject"
          busy={busy}
          refusal={refusalLine(error)}
          onDecide={reject}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === 'view' ? (
        <ValueDialog label={open.label} lines={open.lines} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
