/**
 * Stage 7 — Ready to launch. Spec §16, §17, §25.6, §29.6.
 *
 * The complete pre-launch record: thirteen `.recap-group`s over 138 rows, each
 * row a `<label>` wrapping its own control, under one column rail of
 * `Field · Current value · Access`. The rows are in `setupFields.ts`, which
 * Campaign setup reads too — eleven of these values appear on both screens and
 * the two must not disagree about what a field is called or who may write it.
 *
 * ── The evidence band is built in DOM order, not visual order ───────────────
 * `.launch-recap-intro` has the copy block first and the four facts second; the
 * stylesheet flips them with `order: -1` so the proof reads before the
 * explanation. Building it in visual order would put four bare figures ahead of
 * the heading that names them for anyone reading the accessibility tree — which
 * is the exact sequence the CSS comment says it is preserving. DOM order is the
 * contract here.
 *
 * ── Every row is a `<label>` wrapping a real control ────────────────────────
 * All 138 rows are editable, exactly as the reference builds them, with the
 * reference's own input types and select vocabularies. Each row is a `<label>`
 * so clicking the field name or the access stamp focuses the control, and
 * `.recap-row:nth-of-type(even)` paints one alternating field across a single
 * sequence of elements. The controls carry their own `aria-label` because the
 * `<label>` also wraps the access stamp, and "Founder name Admin can edit" is
 * not the name of a text box.
 *
 * The Access column reads `Admin can edit` on every row, and the group header
 * counts the rows the group holds.
 *
 * ── Save all changes, without a bulk route ──────────────────────────────────
 * There is no bulk patch, and there should not be: §25.6 reads the prior value
 * under lock inside the transaction that changes it, and one transaction over
 * 138 fields would collapse 138 prior values into a single audit row. So the
 * button collects one reason and walks the changed fields through
 * `PATCH …/setup/:fieldKey`, one recorded write each. If one is refused the
 * walk stops, the fields already saved are cleared, and the action bar names
 * both halves — §30 forbids a generic error with no data status and no
 * recovery, and "four of seven saved" is exactly the status a person needs.
 *
 * ── Schedule launch and Launch now ─────────────────────────────────────────
 * `Schedule launch` opens a sheet that collects the instant and posts it to
 * `POST …/schedule-live`, which is the route that writes `campaign_live_at`.
 * `Launch now` calls `POST …/launch`, which refuses until the scheduled time
 * arrives; that refusal is rendered as it comes back rather than predicted
 * here.
 */

import { useEffect, useRef, useState } from 'react';
import { AdminRequestError, call } from '../../api.js';
import {
  DecisionDialog,
  StageFrame,
  StateStrip,
  asRequestError,
  refusalLine,
  usd,
  type StageProps,
} from './recordGroup.js';
import { buildLaunchGroups, readSupplement, type LaunchField } from './setupFields.js';

const enc = encodeURIComponent;

/** Rendered in place of a value the record does not hold. Never a blank cell. */
const NOT_RECORDED = 'Not recorded';

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

const scheduleLive = (campaignId: string, liveAt: string): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/schedule-live`, {
    method: 'POST',
    body: JSON.stringify({ liveAt }),
  });

const launchCampaign = (
  campaignId: string,
): Promise<{ launch?: { status?: string; campaignCloseAt?: string } }> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/launch`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/* ── The Schedule launch sheet ────────────────────────────────────────────── */

function ScheduleDialog({
  busy,
  refusal,
  onSchedule,
  onClose,
}: {
  busy?: boolean;
  refusal?: string | null;
  onSchedule: (liveAt: string) => void;
  onClose: () => void;
}) {
  const [liveAt, setLiveAt] = useState('');
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
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
            if (liveAt) onSchedule(new Date(liveAt).toISOString());
          }}
        >
          <p className="dialog-kicker">Admin decision</p>
          <h2>Schedule launch</h2>
          <p className="dialog-lead">
            This writes the one launch time for the campaign. Enter it in your own timezone; it is
            stored in UTC and every deadline the close path measures is anchored to it.
          </p>
          <label>
            <span>Launch time</span>
            <input
              className="manual-edit-input"
              type="datetime-local"
              value={liveAt}
              onChange={(e) => setLiveAt(e.target.value)}
            />
          </label>
          {refusal ? <p className="form-note">{refusal}</p> : null}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy || !liveAt}>
              Schedule launch
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

/* ── The stage ────────────────────────────────────────────────────────────── */

export function ReadyToLaunchStage({ detail, panel, onSaved }: StageProps) {
  const supplement = readSupplement(panel);
  const campaignId = detail.campaigns.current?.campaignId ?? null;
  const groups = buildLaunchGroups({ detail, panel: supplement });
  const launch = supplement.launch ?? null;
  const creators = launch?.creators ?? [];

  /**
   * Only what the Admin has actually changed, keyed by field key. Clearing this
   * after a save is what makes the screen show the server's answer rather than
   * the browser's.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<'save' | 'schedule' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* A different record is a different set of pending edits. */
  useEffect(() => {
    setEdits({});
    setNote(null);
    setError(null);
  }, [detail.header.prospectId]);

  const dirty = Object.keys(edits);
  const version = launch?.campaignVersion ?? detail.campaigns.current?.buildVersion;

  const valueOf = (field: LaunchField) => edits[field.key] ?? field.value;
  const change = (field: LaunchField, next: string) =>
    setEdits((prev) => ({ ...prev, [field.key]: next }));

  async function saveAll(internalReason: string) {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    const saved: string[] = [];
    for (const key of dirty) {
      try {
        await saveSetupField(campaignId, key, edits[key] ?? '', internalReason);
        saved.push(key);
      } catch (e: unknown) {
        /* Drop only what actually saved, so the rows still marked changed are
           exactly the ones that did not (§30 — status, then recovery). */
        setEdits((prev) => {
          const rest = { ...prev };
          for (const done of saved) delete rest[done];
          return rest;
        });
        setBusy(false);
        setSheet(null);
        setError(asRequestError(e));
        setNote(
          `${saved.length} of ${dirty.length} field${dirty.length === 1 ? '' : 's'} saved. “${key}” was refused, and the walk stopped there. The rows still shown as changed are the ones that did not save.`,
        );
        onSaved();
        return;
      }
    }
    setEdits({});
    setBusy(false);
    setSheet(null);
    setNote(
      `${saved.length} field${saved.length === 1 ? '' : 's'} saved, each recorded against its own prior value.`,
    );
    onSaved();
  }

  async function run(work: () => Promise<unknown>, closed: string) {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setSheet(null);
      setNote(closed);
      onSaved();
    } catch (e: unknown) {
      setError(asRequestError(e));
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  const barText =
    refusalLine(error) ??
    note ??
    (campaignId
      ? dirty.length === 0
        ? 'Changes are applied to this final recap immediately and recorded when saved.'
        : `${dirty.length} field${dirty.length === 1 ? '' : 's'} changed and not yet saved. Each is recorded separately, against its own prior value.`
      : 'This record has no campaign yet, so there is nothing to save, schedule or launch.');

  return (
    <>
      <StageFrame
        stage="Ready to launch"
        heading="Complete editable launch recap"
        lead="Review and directly edit every saved Founder, campaign, payment, Creator, page, reward, FAQ, timing and launch value."
      >
        <StateStrip
          status={launch?.status ?? 'Waiting for final checks'}
          lastChange={
            version === null || version === undefined
              ? 'No campaign version recorded'
              : `Campaign version ${version}`
          }
          next="Save the recap, schedule, or launch"
        />

        <div className="record-groups">
          {/* DOM order is the copy block then the facts. `order: -1` on the
              `dl` flips them visually; swapping them here would break the
              reading sequence the stylesheet deliberately preserves. */}
          <section className="launch-recap-intro">
            <div>
              <span>Final launch recap</span>
              <h2>Review and change anything</h2>
              <p>
                This is the complete pre-launch record. Every value below is editable by Admin
                before scheduling or launching.
              </p>
            </div>
            <dl>
              <div>
                <dt>Campaign</dt>
                <dd>{detail.campaigns.current?.name ?? 'No campaign'}</dd>
              </div>
              <div>
                <dt>Founder</dt>
                <dd>{detail.header.legalName}</dd>
              </div>
              <div>
                <dt>Checkout total</dt>
                <dd>{usd(supplement.listingFee?.totalCents) ?? NOT_RECORDED}</dd>
              </div>
              <div>
                <dt>Creators</dt>
                <dd>{creators.length}</dd>
              </div>
            </dl>
          </section>

          {groups.map((group) => (
            <section className="recap-group" key={group.id}>
              <header>
                <h2>{group.title}</h2>
                <span>{group.fields.length} editable fields</span>
              </header>
              <div className="recap-table-head" aria-hidden="true">
                <span>Field</span>
                <span>Current value</span>
                <span>Access</span>
              </div>
              {group.fields.map((field) => (
                <label className="recap-row" key={field.key}>
                  <strong>{field.label}</strong>
                  <span className="recap-editor">
                    {field.control === 'textarea' ? (
                      <textarea
                        aria-label={field.label}
                        value={valueOf(field)}
                        onChange={(e) => change(field, e.target.value)}
                      />
                    ) : field.control === 'select' ? (
                      <select
                        aria-label={field.label}
                        value={valueOf(field)}
                        onChange={(e) => change(field, e.target.value)}
                      >
                        {/* The record can hold a value the reference's own
                            vocabulary does not name, and a `select` with no
                            matching option would silently show the first one.
                            The empty option keeps the control honest about
                            what is actually stored. */}
                        <option value="">Not chosen</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={field.label}
                        type={field.control === 'number' ? 'number' : 'text'}
                        value={valueOf(field)}
                        onChange={(e) => change(field, e.target.value)}
                      />
                    )}
                    {field.note ? <small>{field.note}</small> : null}
                  </span>
                  <span className="recap-access">Admin can edit</span>
                </label>
              ))}
            </section>
          ))}

          <div className="actionbar">
            <div>
              <small>{barText}</small>
            </div>
            <div className="action-buttons">
              <button
                type="button"
                disabled={busy || dirty.length === 0 || !campaignId}
                aria-disabled={busy || dirty.length === 0 || !campaignId}
                onClick={campaignId ? () => setSheet('save') : undefined}
              >
                Save all changes
              </button>
              <button
                type="button"
                disabled={busy || !campaignId}
                aria-disabled={busy || !campaignId}
                onClick={campaignId ? () => setSheet('schedule') : undefined}
              >
                Schedule launch
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !campaignId}
                aria-disabled={busy || !campaignId}
                onClick={
                  campaignId
                    ? () =>
                        void run(async () => {
                          const result = await launchCampaign(campaignId);
                          setNote(
                            result.launch?.status === 'already_live'
                              ? 'This campaign was already live; nothing changed.'
                              : 'The campaign is live.',
                          );
                        }, 'The campaign is live.')
                    : undefined
                }
              >
                Launch now
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {sheet === 'save' && campaignId ? (
        <DecisionDialog
          kicker="Admin decision"
          heading="Save all changes"
          lead={`Record why ${dirty.length} field${dirty.length === 1 ? '' : 's'} on this launch recap ${dirty.length === 1 ? 'is' : 'are'} changing. There is no bulk write: each field is saved as its own recorded edit against its own prior value, and this reason is stored with every one of them.`}
          submitLabel="Save all changes"
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setSheet(null)}
          onDecide={(reason) => void saveAll(reason)}
        />
      ) : null}

      {sheet === 'schedule' && campaignId ? (
        <ScheduleDialog
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setSheet(null)}
          onSchedule={(liveAt) =>
            void run(
              () => scheduleLive(campaignId, liveAt),
              'Launch scheduled. The time is stored once and cannot be moved.',
            )
          }
        />
      ) : null}
    </>
  );
}
