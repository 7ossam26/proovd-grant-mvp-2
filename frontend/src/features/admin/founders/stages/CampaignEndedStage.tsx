/**
 * Stage 9 — Campaign ended. Spec §2, §21, §22.11, §24, §25.7, §27.1, §33.7.7.
 *
 * The close, the tax recheck and the charging, in the reference's own order: a
 * three-tile decision chain, then either the minimum-missed note or the close
 * totals and the per-Backer ledger, then the terminal action bar.
 *
 * ── Where each control actually goes ───────────────────────────────────────
 * Attempts                 → local. `GET /api/admin/close/:id` already returned
 *                            every `reservation_capture_attempts` row; the
 *                            dialog renders the ones for that pre-order.
 * Export ledger            → a Blob of the close detail already on the page.
 *                            §25.7's line is drawn where it already was: this
 *                            exports exactly what the panel was authorised to
 *                            render, and fetches nothing.
 * Lock settlement          → POST /api/admin/campaigns/:id/resolve — §22.11's
 *                            resolution, which is the record that actually
 *                            closes a settled campaign and takes the one note
 *                            the reference's sheet collects. NOT the write-once
 *                            `/results` route: that one wants five separate
 *                            narrative fields and is a different record.
 * Confirm no-charge close  → POST /api/admin/close/:id/resume. The no-charge
 *                            outcome is decided INSIDE `runCloseBatch` from the
 *                            state at exactly `campaign_close_at`, so the
 *                            honest thing this control can do is ask the batch
 *                            to run and report what the batch decided. It is
 *                            idempotent, so a second press is safe (§33.7.7).
 *
 * ── The success rule is a COUNT, and only an Idea Campaign has one ──────────
 * The reference renders `Configured success rule · USD $1,000` on a **Product**
 * Campaign, with a minimum-missed / no-charge branch behind it. That is seed
 * data rather than copy: §2 makes an Idea threshold a count of unique Backers
 * with active pre-orders, never a sum, and a Product Campaign keep-what-you-
 * raise with no threshold at all. So the first tile is type-conditional and the
 * minimum-missed branch can only appear on an Idea Campaign.
 *
 * ── There is no "Day 2 of 3" ────────────────────────────────────────────────
 * The reference counts card retries in days out of three. The real window is
 * `campaign_close_batches.retry_window_hours` — 48 hours — anchored by
 * `first_failure_at` and ending at `retry_deadline_at`. Rendering "Day N of 3"
 * would invent a deadline (§1 rule 6) and contradict the one the database
 * enforces, so the real window renders, local primary with UTC secondary.
 *
 * ── Every amount arrives resolved ───────────────────────────────────────────
 * The reference's own close numbers do not reconcile — its Proovd cut is not 5%
 * of its captured total and its Founder net is a residual. Nothing here adds,
 * subtracts or takes a percentage: integer cents come from the record and go
 * through the one shared `usd()` (§24.4, §33.8.13).
 */

import { useEffect, useState } from 'react';
import { call } from '../../api.js';
import {
  DecisionDialog,
  RecordGroup,
  StageFrame,
  StateStrip,
  ValueDialog,
  asRequestError,
  downloadFile,
  refusalLine,
  usd,
  type RecordRowProps,
  type RecordTone,
  type StageProps,
} from './recordGroup.js';
import { absoluteTime } from '../format.js';

/* ── The close record ─────────────────────────────────────────────────────── */

/**
 * `GET /api/admin/close/:campaignId`. Typed optimistically and read entirely
 * through optional chaining: the whole `/api/admin/close/*` surface is mounted
 * behind a configured Stripe gateway, so on a deployment without one this read
 * fails and every cell says what it is waiting on rather than showing a zero.
 */
interface CaptureAttempt {
  reservationId?: string | null;
  attemptNumber?: number | null;
  amountCents?: string | number | null;
  outcome?: string | null;
  requestedAt?: string | null;
  resolvedAt?: string | null;
}

interface CloseRead {
  detail?: {
    campaignStatus?: string | null;
    batch?: {
      retryWindowHours?: number | null;
      firstFailureAt?: string | null;
      retryDeadlineAt?: string | null;
    } | null;
    reservationsByStatus?: Record<string, number> | null;
    attempts?: readonly CaptureAttempt[] | null;
  } | null;
  reconciliation?: unknown;
}

const readClose = (campaignId: string): Promise<CloseRead> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}`);

/** Re-runs the close batch and ends the retry window. Idempotent (§33.7.7). */
const runClose = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/** §22.11's resolution — the record that closes a settled campaign. */
const resolveCampaign = (campaignId: string, note: string): Promise<unknown> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

/* ── The panel supplement, read optimistically ────────────────────────────── */

interface EndedBackerRow {
  id: string;
  name?: string | null;
  reference?: string | null;
  /** The reservation this row stands for, so its attempts can be found. */
  reservationId?: string | null;
  subtotalCents?: string | number | null;
  taxCents?: string | number | null;
  status?: string | null;
  payment?: string | null;
}

interface EndedSlice {
  statusLabel?: string | null;
  /** Idea only: the threshold as a COUNT of unique Backers. */
  successRule?: { value?: string | null; note?: string | null } | null;
  frozenResult?: string | null;
  frozenNote?: string | null;
  /** Idea only. `false` is the minimum-missed branch; absent is not `false`. */
  thresholdMet?: boolean | null;
  allowedBranch?: string | null;
  eligibleBackers?: number | null;
  /** `reservations.tax_close_usable`, aggregated by the route. */
  taxRecheck?: { value?: string | null; status?: string | null; tone?: RecordTone | null } | null;
  capturedCents?: string | number | null;
  failedCents?: string | number | null;
  founderNetCents?: string | number | null;
  creatorTotalCents?: string | number | null;
  proovdCutCents?: string | number | null;
  backers?: readonly EndedBackerRow[] | null;
}

function endedSliceOf(panel: unknown): EndedSlice {
  return (panel as { ended?: EndedSlice | null } | null | undefined)?.ended ?? {};
}

/* ── The retry window, as it is actually enforced ─────────────────────────── */

/**
 * §21's capture retry window: a stored `retry_deadline_at`, anchored on the
 * first failure, in hours — not a day counter.
 *
 * The anchor gates and the sweep only notices, so a window whose deadline has
 * passed is closed whether or not the cron has fired. The deadline itself is
 * trigger-immutable (§29.6), which is why it is read rather than recomputed.
 */
function retryLine(batch: NonNullable<CloseRead['detail']>['batch']): {
  line: string | null;
  open: boolean;
} {
  if (!batch) return { line: null, open: false };
  const hours = batch.retryWindowHours ? `${batch.retryWindowHours}-hour window` : 'Retry window';
  if (!batch.firstFailureAt) return { line: `${hours} · no capture has failed`, open: false };
  if (!batch.retryDeadlineAt) {
    return { line: `${hours} opened ${absoluteTime(batch.firstFailureAt)}`, open: true };
  }
  const open = new Date(batch.retryDeadlineAt).getTime() > Date.now();
  return {
    line: open
      ? `${hours} open until ${absoluteTime(batch.retryDeadlineAt)}`
      : `${hours} closed ${absoluteTime(batch.retryDeadlineAt)}`,
    open,
  };
}

type Sheet =
  | { kind: 'view'; label: string; lines: string[] }
  | { kind: 'lock' }
  | { kind: 'no_charge' };

/* ── The screen ───────────────────────────────────────────────────────────── */

export function CampaignEndedStage({ detail, panel, onSaved }: StageProps) {
  const { header, campaigns } = detail;
  const ended = endedSliceOf(panel);
  const campaignId = campaigns.current?.campaignId ?? '';

  const [close, setClose] = useState<CloseRead | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    readClose(campaignId)
      .then((r) => {
        if (!cancelled) setClose(r);
      })
      .catch(() => {
        /* The whole close surface is gateway-gated. Leaving this null makes the
           per-Backer attempts say what they are waiting on rather than showing
           an empty list that reads as "no attempts were made". */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const type = campaigns.current?.type ?? header.typeChip;
  const isIdea = /idea/i.test(type);
  const isProduct = /product/i.test(type);

  /* Only an Idea Campaign can miss a minimum. `thresholdMet === false` is the
     missed branch; undefined means the route did not state it, which is not the
     same as missed and must not render as one. */
  const missed = isIdea && ended.thresholdMet === false;
  const met = !missed;

  const captured = usd(ended.capturedCents);
  const failed = usd(ended.failedCents);
  const retry = retryLine(close?.detail?.batch);
  const attempts = close?.detail?.attempts ?? null;

  const dismiss = () => {
    setSheet(null);
    setRefusal(null);
  };

  async function submit(run: () => Promise<unknown>) {
    setBusy(true);
    setRefusal(null);
    try {
      await run();
      setBusy(false);
      dismiss();
      onSaved();
    } catch (e: unknown) {
      setBusy(false);
      setRefusal(refusalLine(asRequestError(e)) ?? 'The request did not complete.');
    }
  }

  const rows: RecordRowProps[] = [
    {
      label: 'Frozen eligible Backers',
      value:
        ended.eligibleBackers === null || ended.eligibleBackers === undefined
          ? null
          : `${ended.eligibleBackers} active records`,
      absence: 'The close snapshot is not composed on this record',
      source: 'Close snapshot',
      status: 'Locked',
      tone: 'done',
    },
    {
      label: 'Tax recalculation',
      value: ended.taxRecheck?.value ?? null,
      absence: 'No route aggregates the per-Backer tax recheck yet',
      note: 'An unusable tax calculation means no charge, never a substituted total.',
      source: 'Per-Backer close check',
      status: ended.taxRecheck?.status ?? 'Not composed',
      tone: ended.taxRecheck?.tone ?? 'plain',
    },
    {
      label: 'Card retries',
      value: retry.line,
      absence: 'No retry window is recorded against this close batch',
      source: 'Payment provider',
      status:
        captured || failed
          ? [captured ? `Captured ${captured}` : null, failed ? `Failed ${failed}` : null]
              .filter(Boolean)
              .join(' · ')
          : 'Totals not composed',
      tone: retry.open ? 'waiting' : 'done',
    },
    {
      label: 'Founder net',
      value: usd(ended.founderNetCents),
      absence: 'The ledger has not stated the Founder share',
      source: 'Locked ledger',
      status: 'After Creator and Proovd cuts',
      tone: 'done',
    },
    {
      label: 'Creator total',
      value: usd(ended.creatorTotalCents),
      absence: 'The per-Creator ledger has not stated a total',
      note: 'A liability until it is transferred — never Proovd revenue.',
      source: 'Per-Creator ledger',
      status: 'Separate transfers',
      tone: 'plain',
    },
    {
      label: 'Proovd cut',
      value: usd(ended.proovdCutCents),
      absence: 'The ledger has not stated the platform fee',
      source: 'Ledger',
      status: 'Locked',
      tone: 'plain',
    },
  ];

  const backers = ended.backers ?? [];

  /** The attempt lines for one pre-order, from the close read. */
  const attemptLines = (row: EndedBackerRow): string[] => {
    if (!attempts) {
      return ['No close batch is readable for this campaign, so no attempt history is available.'];
    }
    const mine = attempts.filter(
      (a) => a.reservationId && a.reservationId === (row.reservationId ?? row.id),
    );
    if (!mine.length) return ['No capture attempt is recorded against this pre-order.'];
    return mine.map(
      (a) =>
        `Attempt ${a.attemptNumber ?? '—'} · ${usd(a.amountCents) ?? 'amount not stated'} · ${
          a.outcome ?? 'outcome not stated'
        } · requested ${absoluteTime(a.requestedAt)}`,
    );
  };

  return (
    <>
      <StageFrame
        stage="Campaign ended"
        heading="Close, tax and charging"
        lead="No charge can begin until the configured success rule and a frozen eligible-Backer snapshot pass."
      >
        <StateStrip
          status={
            ended.statusLabel ??
            close?.detail?.campaignStatus ??
            campaigns.current?.status ??
            header.lifecycle
          }
          lastChange={retry.line ?? 'No capture retry window is recorded'}
          next="Settle charges and lock the ledger"
        />

        <div className="record-groups">
          {/* ── the decision chain. The arrows between tiles are ::after
              marks and are not copy. ─────────────────────────────────────── */}
          <section className="decision-branch">
            <div>
              <span>Configured success rule</span>
              {isProduct ? (
                <>
                  <strong>None · keep what you raise</strong>
                  <small>
                    A Product Campaign charges every active pre-order on its close date. Only an
                    Idea Campaign carries a threshold.
                  </small>
                </>
              ) : (
                <>
                  <strong>{ended.successRule?.value ?? 'Not composed'}</strong>
                  <small>
                    {ended.successRule?.note ??
                      'A count of unique Backers with active pre-orders, locked before launch.'}
                  </small>
                </>
              )}
            </div>
            <div>
              <span>Frozen result</span>
              <strong>{ended.frozenResult ?? 'Not composed'}</strong>
              <small>{ended.frozenNote ?? 'Decided once, from the state at exactly close.'}</small>
            </div>
            <div>
              <span>Allowed branch</span>
              <strong>{ended.allowedBranch ?? (missed ? 'No charges' : 'Tax and charging')}</strong>
              <small>No charge begins until this branch is recorded</small>
            </div>
          </section>

          {missed ? (
            <section className="policy-note action">
              <strong>Minimum missed.</strong>
              <p>
                Backers are not charged. Send the unsuccessful-close communications and reconcile
                the listing-fee policy.
              </p>
            </section>
          ) : null}

          {met ? (
            <>
              <RecordGroup title="Close and retry totals" rows={rows} />

              <section className="compact-table-section">
                <header>
                  <h2>Per-Backer chargeability</h2>
                  <span>Tax, saved payment and attempt history</span>
                </header>
                <div className="compact-table close-table">
                  <div className="compact-table-head" aria-hidden="true">
                    <span>Backer</span>
                    <span>Subtotal</span>
                    <span>Final tax</span>
                    <span>Status</span>
                    <span>Payment</span>
                    <span>Action</span>
                  </div>
                  {backers.map((row) => (
                    <div className="compact-table-row" key={row.id}>
                      <span>
                        <strong>{row.name ?? 'Backer'}</strong>
                        <small>{row.reference ?? row.id}</small>
                      </span>
                      <span>{usd(row.subtotalCents) ?? 'Not composed'}</span>
                      <span>{usd(row.taxCents) ?? 'Not composed'}</span>
                      <span>{row.status ?? 'Not composed'}</span>
                      <span>{row.payment ?? 'Not composed'}</span>
                      <span>
                        {/* Local: the close read already returned every attempt
                            row. The raw provider code never reaches a customer
                            surface, so what renders is the recorded outcome
                            word rather than a decline code (§33.9.11). */}
                        <button
                          type="button"
                          onClick={() =>
                            setSheet({
                              kind: 'view',
                              label: `${row.name ?? 'Backer'} · attempts`,
                              lines: [
                                `Eligibility: ${row.status ?? 'not composed'}`,
                                `Saved payment: ${row.payment ?? 'not composed'}`,
                                `Final tax: ${usd(row.taxCents) ?? 'not composed'}`,
                                ...attemptLines(row),
                              ],
                            })
                          }
                        >
                          Attempts
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <div className="actionbar">
            <div>
              <small>
                Minimum-missed and minimum-met are mutually exclusive terminal branches
              </small>
              {refusal ? <small>{refusal}</small> : null}
            </div>
            <div className="action-buttons">
              {met ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        `${campaignId || header.prospectId}-settlement.json`,
                        JSON.stringify(
                          { close: close ?? null, totals: ended },
                          null,
                          2,
                        ),
                        'application/json',
                      )
                    }
                  >
                    Export ledger
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={retry.open}
                    onClick={() => setSheet({ kind: 'lock' })}
                  >
                    Lock settlement
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  type="button"
                  onClick={() => setSheet({ kind: 'no_charge' })}
                >
                  Confirm no-charge close
                </button>
              )}
            </div>
          </div>
        </div>
      </StageFrame>

      {sheet?.kind === 'view' ? (
        <ValueDialog label={sheet.label} lines={sheet.lines} onClose={dismiss} />
      ) : null}

      {sheet?.kind === 'lock' ? (
        <DecisionDialog
          kicker="Settlement"
          heading="Lock settlement"
          lead="Record why this campaign is settled. The resolution is the record that closes it, and it is written once."
          submitLabel="Lock settlement"
          busy={busy}
          refusal={refusal}
          onDecide={(note) => void submit(() => resolveCampaign(campaignId, note))}
          onClose={dismiss}
        />
      ) : null}

      {/* The no-charge outcome is decided inside the close batch, from the state
          at exactly `campaign_close_at`. This asks the batch to run and reports
          what it decided; it never records the outcome on the batch's behalf. */}
      {sheet?.kind === 'no_charge' ? (
        <DecisionDialog
          kicker="Close batch"
          heading="Confirm no-charge close"
          lead="The close batch decides this outcome from the state at exactly the close time. Running it here records that decision and its notices; it does not set the result."
          submitLabel="Run the close batch"
          busy={busy}
          refusal={refusal}
          onDecide={() => void submit(() => runClose(campaignId))}
          onClose={dismiss}
        />
      ) : null}
    </>
  );
}
