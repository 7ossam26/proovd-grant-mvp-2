/**
 * Stage 5 — Campaign setup. Spec §15, §25.6, §26.2.
 *
 * The reference's own five record groups over 23 rows: brand voice, the order
 * goal and the system limits, the Founder's FAQs, the Founder's rewards, and
 * the payout and publishing checks. Every group title, row label, source word
 * and status word is the reference's, verbatim; only the values are the
 * record's. Row action order is the shared kit's fixed
 * `Edit · Request change · View · Download`, and this screen carries no View.
 *
 * The rows themselves are in `setupFields.ts`, because Ready to launch renders
 * eleven of the same stored values and the two screens must not disagree about
 * what a field is called or where it is written.
 *
 * ── One dialog is local, and only one ───────────────────────────────────────
 * The kit's `ManualEditDialog` is a single-line `manual-edit-input`, which is
 * the right shape for a percentage or a URL and the wrong one for an FAQ
 * answer. The reference has TWO shapes: a prose edit renders a bare `textarea`
 * WITHOUT that class, which is load-bearing — `.dialog:has(.manual-edit-input)`
 * is what pins the sheet to the narrow step, so dropping the class is what
 * widens it. So prose rows open `ProseEditDialog` here and every other row
 * opens the kit's. Both carry the same kicker, heading and lead.
 *
 * Request change uses the kit's generic `DecisionDialog` rather than its
 * `RequestChangeDialog`, whose lead is worded for the application stage
 * ("linked to this application field"). The reference's Campaign setup lead
 * says "linked to this Campaign Setup field", and that is the string this
 * screen has to render.
 *
 * ── Request change has no route yet, and the refusal is rendered ────────────
 * `POST /api/admin/campaigns/:id/review/changes` is the existing control and it
 * is the wrong one: it takes an array, closes the review round, and refuses
 * without a deep link and an owner (422 `deep_link_required` — "a change with
 * nowhere to point and nobody to own it is not actionable feedback"). One field
 * and one reason is a different record, so this calls
 * `POST …/setup-change-requests`. Where that is not mounted the server's own
 * refusal is what the Admin reads — nothing here paraphrases it, and nothing
 * pretends the request was filed.
 */

import { useEffect, useRef, useState } from 'react';
import { AdminRequestError, call } from '../../api.js';
import {
  DecisionDialog,
  ManualEditDialog,
  RecordGroup,
  StageFrame,
  StateStrip,
  action,
  asRequestError,
  inert,
  refusalLine,
  type RecordRowProps,
  type RowAction,
  type StageProps,
} from './recordGroup.js';
import { buildSetupGroups, readSupplement, type SetupRow } from './setupFields.js';

const enc = encodeURIComponent;

/* ── The prose half of the reference's two-shape manual edit ──────────────── */

/**
 * Identical to the kit's `ManualEditDialog` except that the writing surface is
 * a bare `textarea`. The missing `manual-edit-input` class is the point: it is
 * what stops `.dialog:has(.manual-edit-input)` firing, and the sheet widens
 * from the one-value step to the prose one.
 */
function ProseEditDialog({
  label,
  initialValue,
  busy,
  refusal,
  onSave,
  onClose,
}: {
  label: string;
  initialValue: string;
  busy?: boolean;
  refusal?: string | null;
  onSave: (value: string, reason: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" ref={ref}>
        <button className="close-button" type="button" onClick={onClose}>
          Close
        </button>
        <form
          className="decision-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value, reason);
          }}
        >
          <p className="dialog-kicker">Manual Admin edit</p>
          <h2>{label}</h2>
          <p className="dialog-lead">
            Change the saved value directly. The edit is recorded in History and does not create a
            Founder change request.
          </p>
          <label>
            <span>Saved value</span>
            <textarea value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label>
            <span>Required reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This reason is shown to the Founder when applicable and saved to History"
            />
          </label>
          {refusal ? <p className="form-note">{refusal}</p> : null}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save edit
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

/* ── The stage ────────────────────────────────────────────────────────────── */

type OpenDialog =
  | { kind: 'edit'; row: SetupRow }
  | { kind: 'request'; row: SetupRow }
  | null;

/**
 * The panel's client lives in `founders/api.ts`, which is shared and does not
 * carry these three calls yet. They borrow the same `call` helper so a refusal
 * classifies identically, and move there when the module next changes.
 */
const saveSetupField = (
  campaignId: string,
  fieldKey: string,
  value: string,
  internalReason: string,
): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/setup/${enc(fieldKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ value, internalReason }),
  });

const requestSetupChange = (
  campaignId: string,
  fieldKey: string,
  reason: string,
): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/setup-change-requests`, {
    method: 'POST',
    body: JSON.stringify({ fieldKey, reason }),
  });

const approveSetup = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/review/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

const resendApprovalEmail = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/review/approval-email/resend`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export function CampaignSetupStage({ detail, panel, onSaved }: StageProps) {
  const supplement = readSupplement(panel);
  const campaignId = detail.campaigns.current?.campaignId ?? null;
  const groups = buildSetupGroups({ detail, panel: supplement });
  const founderName = detail.header.preferredName || detail.header.legalName;

  const [open, setOpen] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>, closed: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDone(closed);
      setOpen(null);
      onSaved();
    } catch (e: unknown) {
      setError(asRequestError(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The reference downloads the FAQ it is already showing.
   *
   * This is not an export in §25.7's sense and does not become one: no
   * restricted column is added, no column list widens, and nothing is fetched.
   * It is the same two strings already on the screen, in a file. The kit's
   * `Download` is inert on the earlier stages because those rows point at
   * uploaded evidence, which needs a presigned route and a bucket that this
   * deployment does not have.
   */
  function download(row: SetupRow) {
    const match = row.key.match(/^faq\.(\d+)\./);
    const index = match ? Number(match[1]) : 0;
    const entry = supplement.setup?.faqs?.[index];
    const body = `${entry?.question ?? ''}\n\n${entry?.answer ?? ''}`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `faq-${index + 1}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  const NO_CAMPAIGN =
    'This record has no campaign yet, so there is nothing to write against.';

  function actionsFor(row: SetupRow): RowAction[] {
    const out: RowAction[] = [];
    if (row.actions.includes('edit')) {
      out.push(
        campaignId
          ? action('Edit', () => setOpen({ kind: 'edit', row }))
          : inert('Edit', NO_CAMPAIGN),
      );
    }
    if (row.actions.includes('requestChange')) {
      out.push(
        campaignId
          ? action('Request change', () => setOpen({ kind: 'request', row }))
          : inert('Request change', NO_CAMPAIGN),
      );
    }
    if (row.actions.includes('download')) {
      out.push(action('Download', () => download(row)));
    }
    return out;
  }

  const rowProps = (row: SetupRow): RecordRowProps => ({
    label: row.label,
    value: row.value,
    ...(row.absence ? { absence: row.absence } : {}),
    source: row.source,
    status: row.status,
    tone: row.tone,
    actions: actionsFor(row),
  });

  const draftVersion = supplement.setup?.draftVersion ?? detail.campaigns.current?.buildVersion;

  const barText =
    refusalLine(error) ??
    done ??
    (campaignId
      ? 'Edit changes the saved value directly. Request change sends that exact Campaign Setup field back to the Founder.'
      : `${NO_CAMPAIGN} Every control on this screen is inactive until one exists.`);

  return (
    <>
      <StageFrame
        stage="Campaign setup"
        heading="Exact campaign inputs"
        lead="Founder-authored content, system policies and Admin decisions remain clearly separated."
      >
        <StateStrip
          status={supplement.setup?.status ?? 'In progress'}
          lastChange={
            draftVersion === null || draftVersion === undefined
              ? 'No draft version recorded'
              : `Draft version ${draftVersion}`
          }
          next="Resolve payout and content blockers"
        />

        <div className="record-groups">
          {groups.map((group) => (
            <RecordGroup key={group.title} title={group.title} rows={group.rows.map(rowProps)} />
          ))}

          <div className="actionbar">
            <div>
              <small>{barText}</small>
            </div>
            <div className="action-buttons">
              <button
                type="button"
                disabled={busy || !campaignId}
                aria-disabled={busy || !campaignId}
                onClick={
                  campaignId
                    ? () =>
                        void run(
                          () => resendApprovalEmail(campaignId),
                          'Approval email resent.',
                        )
                    : undefined
                }
              >
                Resend approval email
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !campaignId}
                aria-disabled={busy || !campaignId}
                onClick={
                  campaignId
                    ? () => void run(() => approveSetup(campaignId), 'Campaign approved.')
                    : undefined
                }
              >
                Approve campaign
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {open?.kind === 'edit' && campaignId ? (
        open.row.multiline ? (
          <ProseEditDialog
            label={open.row.label}
            initialValue={open.row.value ?? ''}
            busy={busy}
            refusal={refusalLine(error)}
            onClose={() => setOpen(null)}
            onSave={(value, reason) =>
              void run(
                () => saveSetupField(campaignId, open.row.key, value, reason),
                `${open.row.label} saved.`,
              )
            }
          />
        ) : (
          <ManualEditDialog
            label={open.row.label}
            initialValue={open.row.value ?? ''}
            reasonRequired
            busy={busy}
            refusal={refusalLine(error)}
            onClose={() => setOpen(null)}
            onSave={(value, reason) =>
              void run(
                () => saveSetupField(campaignId, open.row.key, value, reason),
                `${open.row.label} saved.`,
              )
            }
          />
        )
      ) : null}

      {open?.kind === 'request' && campaignId ? (
        <DecisionDialog
          kicker="Admin decision"
          heading={`Request change · ${open.row.label}`}
          lead={`Explain exactly what is wrong with “${open.row.label}” and what ${founderName} must change. This request will be linked to this Campaign Setup field and shown to the Founder.`}
          submitLabel="Request this change"
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setOpen(null)}
          onDecide={(reason) =>
            void run(
              () => requestSetupChange(campaignId, open.row.key, reason),
              `Change requested against ${open.row.label}.`,
            )
          }
        />
      ) : null}
    </>
  );
}
