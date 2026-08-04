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
import { Button, Card, Field, Input, Tag, Textarea } from '../../components/index.js';
import {
  fetchCloseOperations,
  fetchCloseDetail,
  resumeCloseBatch,
  recordCloseReconciliation,
  prepareCloseResults,
  AdminRequestError,
  type CloseOperationsState,
  type CloseBatchDetailState,
} from './api.js';

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
