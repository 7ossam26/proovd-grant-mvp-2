/**
 * Admin — the §21 close operations: the visibly recoverable batch queue,
 * the retry windows, §21 reconciliation, and results preparation (Phase 18b,
 * §33.7.11, §33.7.12).
 *
 * ── The incomplete batches come first, always ───────────────────────────────
 * §33.7.12: "An incomplete batch must be visibly recoverable in Admin." The
 * queue leads with them — locked reservation counts, unresolved attempts, open
 * duplicate cases — and the one recovery action is Resume, which runs the SAME
 * idempotent machine the sweep runs. The surface promises what the mechanism
 * guarantees: retried attempts reuse their stable keys, so resuming can never
 * double-charge or duplicate a receipt.
 *
 * ── Reconciliation is derived facts plus a recorded judgement ───────────────
 * Each §21 item shows what the app's own records can prove; the Admin records
 * the verification with a note (§1.3). Items that cannot complete until Phase
 * 19/20 name what they wait on rather than reading as done (§1.4). The
 * narrative form has five required fields — including what the result does
 * NOT prove — and preparing results is what sends `Results ready`, separately
 * from `Campaign ended` (§33.7.11).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatUsd } from '@proovd/shared';
import { Button, Card, Field, Input, Tag, Textarea } from '../../components/index.js';
import {
  fetchCloseOperations,
  fetchCloseDetail,
  resumeCloseBatch,
  recordCloseReconciliation,
  prepareCloseResults,
  fetchCampaignEarnings,
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveCreatorEarnings,
  createCreatorTransfer,
  recordCreatorThankYou,
  AdminRequestError,
  type CloseOperationsState,
  type CloseBatchDetailState,
  type CampaignEarningsState,
  type EarningsCreatorRow,
} from './api.js';

const usd = (cents: string) => formatUsd(BigInt(cents));

const when = (iso: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');

function errorText(err: unknown, fallback: string): string {
  if (err instanceof AdminRequestError) {
    const detail = err.detail as { whatHappened?: string; title?: string; error?: unknown };
    const nested = detail.error as { message?: string; missing?: string[] } | undefined;
    const missing = nested?.missing?.length ? ` Missing: ${nested.missing.join(', ')}.` : '';
    return `${nested?.message ?? detail.whatHappened ?? detail.title ?? fallback}${missing}`;
  }
  return fallback;
}

export function CloseOperationsPage() {
  const [params, setParams] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';

  const [state, setState] = useState<CloseOperationsState | null>(null);
  const [detail, setDetail] = useState<CloseBatchDetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await fetchCloseOperations());
      setDetail(campaignId ? await fetchCloseDetail(campaignId) : null);
    } catch (err) {
      setError(errorText(err, 'Close operations could not be read.'));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resume(id: string) {
    setNotice(null);
    setError(null);
    try {
      const result = await resumeCloseBatch(id);
      setNotice(
        `Batch ${result.batch.status}` +
          (result.windowEnd.status !== 'not_due' && result.windowEnd.status !== 'not_found'
            ? `; retry window ${result.windowEnd.status}`
            : '') +
          '. Retried attempts reused their stable keys — nothing was charged twice.',
      );
      await load();
    } catch (err) {
      setError(errorText(err, 'The batch could not be resumed.'));
    }
  }

  if (!state) {
    return (
      <section className="admin-workspace">
        <h1>Close operations</h1>
        {error ? <p role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const { incomplete, retryWindow, reconciling } = state.operations;

  return (
    <section className="admin-workspace">
      <h1>Close operations</h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      {/* ── §33.7.12: the recoverable batches, first ─────────────────────── */}
      <Card>
        <h2>Incomplete batches</h2>
        {incomplete.length === 0 ? (
          <p>No batch is incomplete. Every close has either finished or not started.</p>
        ) : (
          <ul className="ops-thread">
            {incomplete.map((b) => (
              <li key={b.campaignId}>
                <div className="ops-head">
                  <strong>Campaign {b.campaignId}</strong>
                  <span className="ops-tags">
                    <Tag>{b.batchStatus}</Tag>
                    <Tag>{b.campaignStatus}</Tag>
                  </span>
                </div>
                <p className="ops-thread__body">
                  Started {when(b.startedAt)}. {b.lockedReservations} reservation
                  {b.lockedReservations === 1 ? '' : 's'} still locked awaiting capture;{' '}
                  {b.unresolvedAttempts} unresolved attempt
                  {b.unresolvedAttempts === 1 ? '' : 's'}
                  {b.openDedupCases > 0
                    ? `; ${b.openDedupCases} open duplicate case(s) parking the threshold decision`
                    : ''}
                  .
                </p>
                <p className="ops-thread__body">{b.recovery}</p>
                <Button onClick={() => void resume(b.campaignId)}>Resume this batch</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── The one 48-hour window, per campaign ─────────────────────────── */}
      <Card>
        <h2>Retry windows open</h2>
        {retryWindow.length === 0 ? (
          <p>No campaign is inside its 48-hour update window.</p>
        ) : (
          <ul className="ops-thread">
            {retryWindow.map((w) => (
              <li key={w.campaignId}>
                <strong>Campaign {w.campaignId}</strong>
                <p className="ops-thread__body">
                  {w.retrying} payment{w.retrying === 1 ? '' : 's'} still failing. Window opened at
                  the first failure ({when(w.firstFailureAt)}) and closes {when(w.retryDeadlineAt)}.
                  Reconciliation begins only after it closes (§21).
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Reconciliation and results ───────────────────────────────────── */}
      <Card>
        <h2>Reconciling</h2>
        {reconciling.length === 0 ? (
          <p>No campaign is awaiting reconciliation.</p>
        ) : (
          <ul className="ops-thread">
            {reconciling.map((r) => (
              <li key={r.campaignId}>
                <div className="ops-head">
                  <strong>Campaign {r.campaignId}</strong>
                  <span className="ops-tags">
                    <Tag>{r.campaignStatus}</Tag>
                    <Tag>
                      {r.requiredItemsVerified}/{r.requiredItemsTotal} required items verified
                    </Tag>
                    {r.resultsPrepared ? <Tag>Results ready sent</Tag> : null}
                  </span>
                </div>
                <Button
                  tier="secondary"
                  onClick={() => setParams({ campaign: r.campaignId })}
                >
                  Open reconciliation
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail ? <CloseDetail detail={detail} onChanged={load} onError={setError} /> : null}
    </section>
  );
}

function CloseDetail({
  detail,
  onChanged,
  onError,
}: {
  detail: CloseBatchDetailState;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const d = detail.detail;
  const recon = detail.reconciliation;

  return (
    <>
      <Card>
        <h2>Campaign {d.campaignId}</h2>
        {d.batch ? (
          <p>
            Batch {d.batch.status}, started {when(d.batch.startedAt)}, completed{' '}
            {when(d.batch.completedAt)}.{' '}
            {d.batch.thresholdDecision
              ? `Threshold ${d.batch.thresholdDecision.met ? 'met' : 'missed'} at ${d.batch.thresholdDecision.unique}/${d.batch.thresholdDecision.required} unique backers — fixed at close. `
              : ''}
            {d.batch.retryDeadlineAt
              ? `Retry window: first failure ${when(d.batch.firstFailureAt)}, deadline ${when(d.batch.retryDeadlineAt)}.`
              : 'No retry window was opened.'}
          </p>
        ) : (
          <p>No close batch exists for this campaign yet.</p>
        )}
        <div className="ops-stats">
          {Object.entries(d.reservationsByStatus).map(([status, count]) => (
            <div key={status}>
              <span className="ops-stat__label">{status}</span>
              <span className="ops-stat__value">{count}</span>
            </div>
          ))}
        </div>
        <details>
          <summary>Capture attempts ({d.attempts.length})</summary>
          <ul className="ops-thread">
            {d.attempts.map((a) => (
              <li key={a.idempotencyKey}>
                <code>{a.idempotencyKey}</code> — attempt {a.attemptNumber},{' '}
                {a.outcome ?? 'in flight'}, requested {when(a.requestedAt)}, resolved{' '}
                {when(a.resolvedAt)}
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <EarningsPanel campaignId={d.campaignId} onError={onError} />

      {recon ? (
        <ReconciliationPanel
          campaignId={d.campaignId}
          reconciliation={recon}
          onChanged={onChanged}
          onError={onError}
        />
      ) : null}
    </>
  );
}

/**
 * The §22.1 Creator money queue: decide → finalize → approve → transfer, in
 * the Spec's own order, one Creator at a time. Every number here is the stored
 * record the Creator's own view and emails render — one source, many
 * renderers (§33.8.13). The §22.2 thank-you form computes nothing: the amount
 * is typed or there is no amount.
 */
function EarningsPanel({
  campaignId,
  onError,
}: {
  campaignId: string;
  onError: (message: string | null) => void;
}) {
  const [state, setState] = useState<CampaignEarningsState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await fetchCampaignEarnings(campaignId));
    } catch (err) {
      onError(errorText(err, 'Creator earnings could not be read.'));
    }
  }, [campaignId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await work();
      await load();
    } catch (err) {
      onError(errorText(err, 'The earnings action could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2>Creator earnings (§22.1)</h2>
      {state.creators.length === 0 ? (
        <p>No Creator on this campaign has locked compensation terms.</p>
      ) : (
        <ul className="ops-thread">
          {state.creators.map((row) => (
            <EarningsCreator key={row.associationId} row={row} state={state} busy={busy} act={act} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EarningsCreator({
  row,
  state,
  busy,
  act,
}: {
  row: EarningsCreatorRow;
  state: CampaignEarningsState;
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [waiver, setWaiver] = useState('');
  const [waiverFounder, setWaiverFounder] = useState(false);
  const [waiverAdmin, setWaiverAdmin] = useState(false);
  const [tyKind, setTyKind] = useState<'recognition' | 'payment'>('recognition');
  const [tyReason, setTyReason] = useState('');
  const [tyAmount, setTyAmount] = useState('');
  const [tyFacts, setTyFacts] = useState<Record<string, boolean>>({});
  const [tyApprovalRef, setTyApprovalRef] = useState('');
  const [tyApprovedBy, setTyApprovedBy] = useState('');
  const [tyTax, setTyTax] = useState('');

  const e = row.earnings;
  const earliest = row.transferEarliestAt ? when(row.transferEarliestAt) : null;

  return (
    <li>
      <div className="ops-head">
        <strong>{row.publicHandle ?? row.email ?? row.associationId}</strong>
        <span className="ops-tags">
          <Tag>{row.associationStatus}</Tag>
          <Tag>{e ? e.state.replace(/_/g, ' ') : 'not finalized'}</Tag>
          {row.transfer ? <Tag>transfer {row.transfer.status}</Tag> : null}
        </span>
      </div>
      <p className="ops-thread__body">
        {row.attributedCaptured} captured attributed charge
        {row.attributedCaptured === 1 ? '' : 's'}; validly attributed pre-tax subtotal{' '}
        {usd(row.validSubtotalCents)}.
        {row.allocation
          ? ` Fixed allocation ${usd(row.allocation.amountCents)} — ${row.allocation.status.replace(/_/g, ' ')}.`
          : ' No fixed Creator payment.'}
        {earliest ? ` The one Transfer may be created on or after ${earliest} (Day 3).` : ''}
      </p>

      {row.latestDecision ? (
        <p className="ops-thread__body">
          Completion decision: <strong>{row.latestDecision.outcome.replace(/_/g, ' ')}</strong> —{' '}
          {row.latestDecision.deliverablesNote} ({row.latestDecision.decidedBy},{' '}
          {when(row.latestDecision.decidedAt)})
          {row.latestDecision.waiver ? ` Waiver: ${row.latestDecision.waiver}` : ''}
        </p>
      ) : (
        <p className="ops-thread__body">
          No completion decision is recorded yet — §22.1 verifies every agreed deliverable before
          earnings finalize.
        </p>
      )}

      <details>
        <summary>Record a completion decision</summary>
        <Field label="Outcome (§22.1)" id={`outcome-${row.associationId}`}>
          <select
            id={`outcome-${row.associationId}`}
            className="input"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="">Choose the verified outcome…</option>
            {state.completionOutcomes.map((o) => (
              <option key={o.key} value={o.key} title={o.spec}>
                {o.key.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deliverables verified — what and how (§1.3)" id={`note-${row.associationId}`}>
          <Textarea
            id={`note-${row.associationId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field
          label="Waiver (only if Founder AND Admin agreed one)"
          id={`waiver-${row.associationId}`}
        >
          <Input
            id={`waiver-${row.associationId}`}
            value={waiver}
            onChange={(event) => setWaiver(event.target.value)}
          />
        </Field>
        {waiver.trim() ? (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={waiverFounder}
                onChange={(event) => setWaiverFounder(event.target.checked)}
              />{' '}
              The Founder agreed this waiver
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={waiverAdmin}
                onChange={(event) => setWaiverAdmin(event.target.checked)}
              />{' '}
              Admin agreed this waiver
            </label>
          </>
        ) : null}
        <Button
          disabled={busy || !outcome || !note.trim()}
          onClick={() =>
            void act(() =>
              recordCompletionDecision(row.associationId, {
                outcome,
                deliverablesNote: note,
                ...(waiver.trim()
                  ? {
                      waiver,
                      waiverAgreedByFounder: waiverFounder,
                      waiverAgreedByAdmin: waiverAdmin,
                    }
                  : {}),
              }),
            )
          }
        >
          Record decision
        </Button>
      </details>

      {e ? (
        <p className="ops-thread__body">
          Finalized at {e.earnedPercent}% (bonus {e.earnedBonusPercent}%): commission{' '}
          {usd(e.commissionCents)} + bonus {usd(e.bonusCents)} + eligible fixed{' '}
          {usd(e.eligibleFixedCents)}. Provisional {usd(e.provisionalTotalCents)} resolved as earned{' '}
          {usd(e.earnedTotalCents)} + returned to Founder {usd(e.unearnedReturnedCents)} (§24.4,
          once).
        </p>
      ) : null}

      <div className="ops-tags">
        {!e ? (
          <Button
            tier="secondary"
            disabled={busy || !row.latestDecision}
            onClick={() => void act(() => finalizeCreatorEarnings(row.associationId))}
          >
            Finalize earnings
          </Button>
        ) : null}
        {e && e.state === 'finalized' ? (
          <Button
            tier="secondary"
            disabled={busy}
            onClick={() => void act(() => approveCreatorEarnings(row.associationId))}
          >
            Approve for transfer
          </Button>
        ) : null}
        {e && e.state === 'approved_for_transfer' ? (
          <Button
            disabled={busy}
            onClick={() => void act(() => createCreatorTransfer(row.associationId))}
          >
            Create the one Transfer
          </Button>
        ) : null}
      </div>
      {row.transfer ? (
        <p className="ops-thread__body">
          Transfer {row.transfer.status} — {usd(row.transfer.totalCents)}
          {row.transfer.providerTransferId ? ` (${row.transfer.providerTransferId})` : ''}, attempt{' '}
          {row.transfer.attemptCount}.
          {row.transfer.status === 'failed'
            ? ' The retry sweep re-drives it under the same key — it cannot become a second Transfer.'
            : ''}
        </p>
      ) : null}

      {/* §22.2 — no estimate anywhere: the amount is typed or absent. */}
      <details>
        <summary>Discretionary thank-you (§22.2)</summary>
        {row.thankYou.length > 0 ? (
          <p className="ops-thread__body">
            Recorded:{' '}
            {row.thankYou
              .map((t) => `${t.kind}${t.amountCents ? ` ${usd(t.amountCents)}` : ''}`)
              .join('; ')}
          </p>
        ) : null}
        <Field label="Kind" id={`ty-kind-${row.associationId}`}>
          <select
            id={`ty-kind-${row.associationId}`}
            className="input"
            value={tyKind}
            onChange={(event) => setTyKind(event.target.value === 'payment' ? 'payment' : 'recognition')}
          >
            <option value="recognition">Recognition only — no money is promised or sent</option>
            <option value="payment">Payment — needs recorded tax/accounting approval</option>
          </select>
        </Field>
        <Field label="Reason" id={`ty-reason-${row.associationId}`}>
          <Textarea
            id={`ty-reason-${row.associationId}`}
            value={tyReason}
            onChange={(event) => setTyReason(event.target.value)}
          />
        </Field>
        {state.thankYouEligibilityFacts.map((fact) => (
          <label className="checkbox" key={fact.key}>
            <input
              type="checkbox"
              checked={tyFacts[fact.key] ?? false}
              onChange={(event) =>
                setTyFacts((prev) => ({ ...prev, [fact.key]: event.target.checked }))
              }
            />{' '}
            {fact.label}
          </label>
        ))}
        {tyKind === 'payment' ? (
          <>
            <Field
              label="Amount in cents — typed, never calculated (§22.2)"
              id={`ty-amount-${row.associationId}`}
            >
              <Input
                id={`ty-amount-${row.associationId}`}
                inputMode="numeric"
                value={tyAmount}
                onChange={(event) => setTyAmount(event.target.value)}
              />
            </Field>
            <Field label="Tax/accounting approval reference" id={`ty-ref-${row.associationId}`}>
              <Input
                id={`ty-ref-${row.associationId}`}
                value={tyApprovalRef}
                onChange={(event) => setTyApprovalRef(event.target.value)}
              />
            </Field>
            <Field label="Approved by" id={`ty-by-${row.associationId}`}>
              <Input
                id={`ty-by-${row.associationId}`}
                value={tyApprovedBy}
                onChange={(event) => setTyApprovedBy(event.target.value)}
              />
            </Field>
            <Field label="Tax treatment" id={`ty-tax-${row.associationId}`}>
              <Input
                id={`ty-tax-${row.associationId}`}
                value={tyTax}
                onChange={(event) => setTyTax(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Button
          tier="secondary"
          disabled={busy || !tyReason.trim()}
          onClick={() =>
            void act(() =>
              recordCreatorThankYou(row.associationId, {
                kind: tyKind,
                reason: tyReason,
                minimumWorkCompleted: tyFacts['minimum_work_completed'] ?? false,
                clickThresholdMet: tyFacts['click_threshold_met'] ?? false,
                brandAupCompliant: tyFacts['brand_aup_compliant'] ?? false,
                ...(tyKind === 'payment'
                  ? {
                      amountCents: tyAmount.trim(),
                      approvalReference: tyApprovalRef,
                      approvedBy: tyApprovedBy,
                      taxTreatment: tyTax,
                    }
                  : {}),
              }),
            )
          }
        >
          {tyKind === 'payment' ? 'Record and send the thank-you payment' : 'Record recognition'}
        </Button>
      </details>
    </li>
  );
}

function ReconciliationPanel({
  campaignId,
  reconciliation,
  onChanged,
  onError,
}: {
  campaignId: string;
  reconciliation: NonNullable<CloseBatchDetailState['reconciliation']>;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resultsByItem, setResultsByItem] = useState<Record<string, 'verified' | 'discrepancy'>>({});
  const [narrative, setNarrative] = useState({
    strongestSignal: '',
    weakestSignal: '',
    leadingSurveyReason: '',
    whatThisProves: '',
    whatThisDoesNotProve: '',
  });
  const [busy, setBusy] = useState(false);

  async function record(itemKey: string) {
    onError(null);
    setBusy(true);
    try {
      await recordCloseReconciliation(campaignId, {
        itemKey,
        result: resultsByItem[itemKey] ?? 'verified',
        note: notes[itemKey] ?? '',
      });
      await onChanged();
    } catch (err) {
      onError(errorText(err, 'The verification was not recorded.'));
    }
    setBusy(false);
  }

  async function prepare() {
    onError(null);
    setBusy(true);
    try {
      await prepareCloseResults(campaignId, narrative);
      await onChanged();
    } catch (err) {
      onError(errorText(err, 'Results were not prepared.'));
    }
    setBusy(false);
  }

  return (
    <>
      <Card>
        <h2>§21 reconciliation</h2>
        {!reconciliation.open ? <p role="status">{reconciliation.openReason}</p> : null}
        <ul className="ops-thread">
          {reconciliation.items.map((item) => (
            <li key={item.key}>
              <div className="ops-head">
                <strong>{item.key.replace(/_/g, ' ')}</strong>
                <span className="ops-tags">
                  {item.requiredForResults ? <Tag>required for results</Tag> : null}
                  {item.latest ? <Tag>{item.latest.result}</Tag> : <Tag>unverified</Tag>}
                </span>
              </div>
              <p className="ops-thread__body">{item.spec}</p>
              {item.derived ? (
                <p className="ops-thread__body">
                  <code>{JSON.stringify(item.derived)}</code>
                </p>
              ) : null}
              {item.waitsOn ? (
                <p className="ops-thread__body">
                  Completes later: waits on {item.waitsOn}. Recording now is optional.
                </p>
              ) : null}
              {item.latest ? (
                <p className="ops-thread__body">
                  Latest: {item.latest.result} by {item.latest.actor} at {when(item.latest.recordedAt)} —{' '}
                  {item.latest.note}
                </p>
              ) : null}
              {reconciliation.open ? (
                <>
                  <Field label="Result" id={`result-${item.key}`}>
                    <select
                      id={`result-${item.key}`}
                      className="input"
                      value={resultsByItem[item.key] ?? 'verified'}
                      onChange={(e) =>
                        setResultsByItem((prev) => ({
                          ...prev,
                          [item.key]: e.target.value as 'verified' | 'discrepancy',
                        }))
                      }
                    >
                      <option value="verified">Verified</option>
                      <option value="discrepancy">Discrepancy</option>
                    </select>
                  </Field>
                  <Field label="Note (what you checked)" id={`note-${item.key}`}>
                    <Input
                      id={`note-${item.key}`}
                      value={notes[item.key] ?? ''}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [item.key]: e.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    tier="secondary"
                    disabled={busy || !(notes[item.key] ?? '').trim()}
                    onClick={() => void record(item.key)}
                  >
                    Record verification
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Prepare results</h2>
        {reconciliation.resultsPrepared ? (
          <p>
            Results are prepared and `Results ready` has been sent. The record is immutable — a
            correction routes through support.
          </p>
        ) : (
          <>
            <p>
              The five plain-language fields below are the §21 narrative the Founder reads. You are
              the review that keeps it from over-claiming — what it does not prove is as important
              as what it does.
            </p>
            <Field label="Strongest signal" id="narrative-strongest">
              <Textarea
                id="narrative-strongest"
                value={narrative.strongestSignal}
                onChange={(e) => setNarrative((p) => ({ ...p, strongestSignal: e.target.value }))}
              />
            </Field>
            <Field label="Weakest signal" id="narrative-weakest">
              <Textarea
                id="narrative-weakest"
                value={narrative.weakestSignal}
                onChange={(e) => setNarrative((p) => ({ ...p, weakestSignal: e.target.value }))}
              />
            </Field>
            <Field label="Leading survey reason" id="narrative-survey">
              <Textarea
                id="narrative-survey"
                value={narrative.leadingSurveyReason}
                onChange={(e) =>
                  setNarrative((p) => ({ ...p, leadingSurveyReason: e.target.value }))
                }
              />
            </Field>
            <Field label="What this result proves" id="narrative-proves">
              <Textarea
                id="narrative-proves"
                value={narrative.whatThisProves}
                onChange={(e) => setNarrative((p) => ({ ...p, whatThisProves: e.target.value }))}
              />
            </Field>
            <Field label="What this result does not prove" id="narrative-does-not">
              <Textarea
                id="narrative-does-not"
                value={narrative.whatThisDoesNotProve}
                onChange={(e) =>
                  setNarrative((p) => ({ ...p, whatThisDoesNotProve: e.target.value }))
                }
              />
            </Field>
            <Button
              disabled={
                busy ||
                !reconciliation.open ||
                Object.values(narrative).some((value) => !value.trim())
              }
              onClick={() => void prepare()}
            >
              Prepare results and send `Results ready`
            </Button>
          </>
        )}
      </Card>
    </>
  );
}

