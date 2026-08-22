/**
 * Stage 10 — Delivery and payments. Spec §22, §24, §25.6, §25.7, §27.1, §29.
 *
 * The gated payout sequence: the map at the top, the gate-by-gate evidence
 * record under it, the proof decision, the enforcement note, and the release
 * bar. This is the only one of the three closing stages that carries an
 * attention line, and it is conditional on the W-9.
 *
 * ── Where each control actually goes ───────────────────────────────────────
 * Request more   → POST /api/admin/fulfillment/campaigns/:id/day-14/clarification
 * Reject         → POST /api/admin/fulfillment/campaigns/:id/day-14/decide,
 *                  outcome `fail`
 * Accept proof   → the same decide route, outcome `pass`
 *   The reference gives Reject and Request more ONE action id, so submitting
 *   Reject silently records a more-proof request and rejection is unreachable.
 *   Here they are three handlers across two routes.
 * Release …      → POST /api/admin/close/:id/founder-payments/:kind/release,
 *                  kind `remaining_payment` for a Product Campaign and
 *                  `single_payment` for an Idea one. The server owns the gate:
 *                  it composes the blockers and its refusal is what renders.
 *                  Recomputing that gate in the browser would be a second
 *                  answer waiting to disagree with the money surface (§33.8.13).
 * View ledger    → a Blob of the founder-payment record already on the page.
 * View (per row) → a local dialog over text the record already sent.
 *
 * ── One control that is drawn and inert ────────────────────────────────────
 * `Message Founder`. The §27 registry has no Admin→Founder message key, and a
 * key with no sender claims a message that does not exist (§1.4). The record
 * bar's own Message tool is where that conversation lives.
 *
 * ── Two sentences carried verbatim by explicit product direction ────────────
 * The release-gate sentence and the Product enforcement note both keep the
 * reference's `held balance` wording. §3.2's custody family and the direct-
 * charge model (the money settles on the Founder's own connected account)
 * argue against it, so this is a recorded departure rather than an oversight —
 * reversing it needs the same kind of instruction that created it.
 *
 * ── The path draws a sequence and claims no per-step state ─────────────────
 * `.path-steps > div` is emitted identically for every step, so the CSS cannot
 * mark a current step or fill a progress track — and deliberately does not fake
 * one (§4.11 forbids a decorative indicator standing in for a real process).
 * The status word lives at the tail of each step's `<p>`, which is why that `p`
 * is readable body copy rather than a caption. The per-gate state cues live one
 * section down, on the record rows, which already carry them.
 *
 * ── Three reference states that do not exist here ──────────────────────────
 * `Correction requested · legal name mismatch` and `Accepted` are not W-9
 * states in this product: `founder_w9_records.status` is `requested` /
 * `submitted` / `verified`, and a return is a `return_reason` with the status
 * back to `requested`. `More proof requested` has no equivalent either —
 * `day_14_reviews.outcome` is pending / pass / fail. The route composes the
 * label; this file does not invent a fourth state to hold it.
 */

import { useEffect, useRef, useState } from 'react';
import { call } from '../../api.js';
import {
  DecisionDialog,
  RecordGroup,
  StageFrame,
  StateStrip,
  ValueDialog,
  action,
  asRequestError,
  downloadFile,
  inert,
  refusalLine,
  usd,
  type RecordRowProps,
  type RecordTone,
  type StageProps,
} from './recordGroup.js';
import { absoluteTime } from '../format.js';

/* ── The routes this stage calls ──────────────────────────────────────────── */

/**
 * `GET /api/admin/close/:campaignId/founder-payments`.
 *
 * The whole `/api/admin/close/*` surface is mounted behind a configured Stripe
 * gateway, so on a deployment without one this read fails — and every gate then
 * says what it is waiting on rather than showing a zero.
 */
interface FounderPaymentsRead {
  status?: { blockers?: readonly string[] | null } | null;
  requests?: unknown;
  evidenceFacts?: unknown;
  statusFacts?: unknown;
}

const readFounderPayments = (campaignId: string): Promise<FounderPaymentsRead> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/founder-payments`);

/** §22.3's release. `kind` is one of three; anything else is refused there. */
const releaseFounderPayment = (campaignId: string, kind: string): Promise<unknown> =>
  call(
    `/api/admin/close/${encodeURIComponent(campaignId)}/founder-payments/${encodeURIComponent(
      kind,
    )}/release`,
    { method: 'POST', body: JSON.stringify({}) },
  );

/** A Day 14 clarification — the record behind "Request more". */
const requestClarification = (campaignId: string, question: string): Promise<unknown> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}/day-14/clarification`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });

/**
 * The Day 14 decision. §25.6 keeps the two reasons in separate columns, so they
 * are separate parameters — one field carrying both is how an internal note
 * ends up pasted into a customer message.
 */
const decideDay14 = (
  campaignId: string,
  body: {
    outcome: 'pass' | 'fail';
    adequateProgressEvidence: boolean;
    requiredCommunication: boolean;
    failureReasons: string[];
    internalReason: string;
    customerExplanation: string;
  },
): Promise<unknown> =>
  call(`/api/admin/fulfillment/campaigns/${encodeURIComponent(campaignId)}/day-14/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── The panel supplement, read optimistically ────────────────────────────── */

interface DeliverySlice {
  statusLabel?: string | null;
  lastChange?: string | null;
  next?: string | null;
  /** The one attention line these three stages allow, conditional on the W-9. */
  attention?: string | null;
  w9?: {
    /** The composed label over `requested` / `submitted` / `verified`. */
    status?: string | null;
    /** What the gate says: it blocks payment, or it does not. */
    gate?: string | null;
    tone?: RecordTone | null;
    /** Lines an Admin may read. Raw tax data stays permission-gated. */
    detail?: readonly string[] | null;
  } | null;
  /** Product: 40% at Day 3. */
  firstPaymentCents?: string | number | null;
  firstPaymentStatus?: string | null;
  /** Product: 60% at Day 14. */
  remainingPaymentCents?: string | number | null;
  remainingPaymentStatus?: string | null;
  /** Idea: one payment, 100% at Day 3. */
  singlePaymentCents?: string | number | null;
  singlePaymentStatus?: string | null;
  proof?: {
    /** `day_14_evidence_items.url` is the nearest record; there is no file column. */
    file?: string | null;
    url?: string | null;
    status?: string | null;
    dueAt?: string | null;
    tone?: RecordTone | null;
  } | null;
  day14?: { status?: string | null; dueAt?: string | null; tone?: RecordTone | null } | null;
  /** The separate per-Creator ledger's own line. */
  creatorPayments?: string | null;
  /** The server's release gate when the panel carries it. Rendered, not re-derived. */
  blockers?: readonly string[] | null;
}

function deliverySliceOf(panel: unknown): DeliverySlice {
  return (panel as { delivery?: DeliverySlice | null } | null | undefined)?.delivery ?? {};
}

/* ── Why the drawn-and-inert control is inert ─────────────────────────────── */

const WHY = {
  message:
    'Message Founder — the §27 registry has no Admin→Founder message key, and a key with no sender claims a message that does not exist (§1.4). The record bar’s Message tool is where that conversation lives.',
  proofDownload:
    'no route serves a Founder-uploaded file, §25.7 keeps export behind one, and no bucket is configured',
} as const;

type Sheet =
  | { kind: 'view'; label: string; lines: string[] }
  | { kind: 'request_more' }
  | { kind: 'reject' }
  | { kind: 'accept' };

/* ── The screen ───────────────────────────────────────────────────────────── */

export function DeliveryStage({ detail, panel, onSaved }: StageProps) {
  const { header, campaigns } = detail;
  const d = deliverySliceOf(panel);
  const campaignId = campaigns.current?.campaignId ?? '';

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [payments, setPayments] = useState<FounderPaymentsRead | null>(null);

  /* "Open below" has to actually go below. The proof decision is what the
     attention line is about on a Product Campaign; on an Idea Campaign the
     enforcement note is the nearest thing that is. */
  const decision = useRef<HTMLElement>(null);
  const enforcement = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    readFounderPayments(campaignId)
      .then((r) => {
        if (!cancelled) setPayments(r);
      })
      .catch(() => {
        /* Gateway-gated. The release still renders, and the server's refusal is
           what an Admin reads if they press it. */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const type = campaigns.current?.type ?? header.typeChip;
  const isProduct = /product/i.test(type);

  const first = usd(d.firstPaymentCents);
  const remaining = usd(d.remainingPaymentCents);
  const single = usd(d.singlePaymentCents);
  const proofDue = d.proof?.dueAt ? absoluteTime(d.proof.dueAt) : null;
  const day14Due = d.day14?.dueAt ? absoluteTime(d.day14.dueAt) : null;
  const creatorPayments = d.creatorPayments ?? 'Separate transfers not composed';
  const w9Status = d.w9?.status ?? 'W-9 state not composed';

  /* The server composes the gate. Rendered as composed and never re-derived. */
  const blockers = payments?.status?.blockers ?? d.blockers ?? [];

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

  const view = (label: string, lines: string[]) => setSheet({ kind: 'view', label, lines });

  /* The reference's own two paths, five gates and four. `.path-steps` detaches
     its last child whatever the count, and the last child is always the Creator
     ledger — a parallel track, never a step money flows into. */
  const steps: [label: string, fact: string][] = isProduct
    ? [
        ['Common gates', `Retries complete · ${w9Status}`],
        [
          'First 40%',
          `${first ?? 'Amount not composed'} · ${d.firstPaymentStatus ?? 'State not composed'}`,
        ],
        [
          'Delivery proof',
          `${d.proof?.file ?? 'Missing'} · ${d.proof?.status ?? 'State not composed'}`,
        ],
        [
          'Remaining 60%',
          `${remaining ?? 'Amount not composed'} · ${
            d.remainingPaymentStatus ?? 'State not composed'
          }`,
        ],
        ['Creator transfers', creatorPayments],
      ]
    : [
        ['Common gates', `Retries complete · ${w9Status}`],
        [
          'Founder payout',
          `${single ?? 'Amount not composed'} · ${d.singlePaymentStatus ?? 'State not composed'}`,
        ],
        [
          '14-day update',
          `${d.day14?.status ?? 'State not composed'} · Due ${day14Due ?? 'not recorded'}`,
        ],
        ['Creator transfers', creatorPayments],
      ];

  const w9Row: RecordRowProps = {
    label: 'W-9',
    value: d.w9?.status ?? null,
    absence: 'No W-9 record is composed on this campaign',
    source: 'Founder file + identity check',
    status: d.w9?.gate ?? 'Blocks payment',
    tone: d.w9?.tone ?? 'action',
    actions: [
      action('View', () =>
        view('W-9', [
          `Founder: ${header.legalName}`,
          `Status: ${w9Status}`,
          ...(d.w9?.detail ?? []),
          'Raw tax data remains permission-gated and is not rendered on this panel.',
        ]),
      ),
    ],
  };

  const creatorRow: RecordRowProps = {
    label: 'Creator payments',
    value: d.creatorPayments ?? null,
    absence: 'The per-Creator ledger has not stated a transfer state',
    source: 'Separate per-Creator ledger',
    status: 'Never bundled with Founder release',
    tone: 'waiting',
  };

  const rows: RecordRowProps[] = isProduct
    ? [
        w9Row,
        {
          label: 'First 40%',
          value: first,
          absence: 'The ledger has not stated the first payment',
          source: 'Founder request + Admin decision',
          status: d.firstPaymentStatus ?? 'Not composed',
          tone: d.firstPaymentStatus === 'Paid' ? 'done' : 'waiting',
        },
        {
          label: 'Delivery proof',
          value: d.proof?.file ?? null,
          absence: 'Not submitted — and no column stores a delivery-proof file',
          source: 'Founder upload',
          status: d.proof?.status ?? 'Not composed',
          tone: d.proof?.tone ?? 'action',
          actions: [
            action('View', () =>
              view('Delivery proof', [
                `File: ${d.proof?.file ?? 'none recorded'}`,
                `Due: ${proofDue ?? 'not recorded'}`,
                `Status: ${d.proof?.status ?? 'not composed'}`,
                d.proof?.url ?? 'No evidence URL is recorded.',
              ]),
            ),
            d.proof?.url
              ? action('Download', () => {
                  window.open(d.proof?.url ?? '', '_blank', 'noopener,noreferrer');
                })
              : inert('Download', WHY.proofDownload),
          ],
        },
        {
          label: 'Proof deadline',
          value: proofDue,
          absence: 'No proof deadline is recorded against this campaign',
          note: 'A stored deadline is trigger-immutable, so a retry or an edit cannot reset it (§29.6).',
          source: '14-day rule',
          status: 'Reminder and enforcement tracked',
          tone: 'waiting',
        },
        {
          label: 'Remaining 60%',
          value: remaining,
          absence: 'The ledger has not stated the remaining payment',
          source: 'Founder request + final review',
          status: d.remainingPaymentStatus ?? 'Not composed',
          tone: d.remainingPaymentStatus === 'Paid' ? 'done' : 'waiting',
        },
        creatorRow,
      ]
    : [
        w9Row,
        {
          label: 'Founder payout',
          value: single,
          absence: 'The ledger has not stated the single Founder payment',
          source: 'Founder request + Admin decision',
          status: d.singlePaymentStatus ?? 'Not composed',
          tone: d.singlePaymentStatus === 'Paid' ? 'done' : 'waiting',
        },
        {
          label: '14-day update',
          value: d.day14?.status ?? null,
          absence: 'No Day 14 review is composed on this campaign',
          source: 'Founder submission',
          status: day14Due ? `Due ${day14Due}` : 'Due date not recorded',
          tone: d.day14?.tone ?? 'action',
        },
        creatorRow,
      ];

  return (
    <>
      <StageFrame
        stage="Delivery and payments"
        heading={
          isProduct ? 'Product payout · 40%, proof, then 60%' : 'Idea payout and 14-day update'
        }
        lead="Founder and Creator transfers are separate. Every payout gate is visible and auditable."
      >
        <StateStrip
          status={d.statusLabel ?? campaigns.current?.status ?? header.lifecycle}
          lastChange={d.lastChange ?? 'No payout event is recorded yet'}
          next={d.next ?? (isProduct ? 'Review delivery proof' : 'Review the 14-day update')}
        />

        {d.attention ? (
          <button
            className="attention-line"
            type="button"
            onClick={() =>
              (decision.current ?? enforcement.current)?.scrollIntoView({ block: 'start' })
            }
          >
            <span>
              <strong>Needs attention</strong>
              {d.attention}
            </span>
            {/* The downward arrow after this word is a ::after mark. */}
            <span>Open below</span>
          </button>
        ) : null}

        <div className="record-groups">
          {/* ── the map ─────────────────────────────────────────────────── */}
          <section className="payout-path">
            <header>
              <h2>{isProduct ? 'Product campaign payout path' : 'Idea campaign payout path'}</h2>
              <span>{isProduct ? '40% → proof → 60%' : 'Payout → 14-day update'}</span>
            </header>
            <div className="path-steps">
              {steps.map(([label, fact], index) => (
                <div key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  <p>{fact}</p>
                </div>
              ))}
            </div>
          </section>

          <RecordGroup title="Payment gates and evidence" rows={rows} />

          {isProduct ? (
            <section className="inline-decision-panel" ref={decision}>
              <div>
                <span>Delivery proof decision</span>
                <strong>{d.proof?.status ?? 'State not composed'}</strong>
                <p>
                  Acceptance, more-proof request and rejection preserve every prior file and reason.
                </p>
              </div>
              <div className="inline-actions">
                {/* Three controls, three handlers, two routes. The reference
                    gives Reject and Request more one action id, so submitting
                    Reject silently records a more-proof request there. */}
                <button type="button" onClick={() => setSheet({ kind: 'request_more' })}>
                  Request more
                </button>
                <button type="button" onClick={() => setSheet({ kind: 'reject' })}>
                  Reject
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() => setSheet({ kind: 'accept' })}
                >
                  Accept proof
                </button>
              </div>
            </section>
          ) : null}

          <section className="policy-note action" ref={enforcement}>
            <strong>Enforcement remains visible.</strong>
            <p>
              {isProduct
                ? 'If proof is ghosted after the recorded deadline, restrict the account, freeze the held balance and start the policy-defined Backer return workflow.'
                : 'If the mandatory 14-day update is ghosted, record warnings and the policy-defined account restriction or ban.'}
            </p>
          </section>

          <div className="actionbar">
            <div>
              <small>
                Release actions validate W-9, request, evidence, held balance and open support
                before proceeding
              </small>
              {blockers.length ? (
                <small>{`Blocking the release: ${blockers.join(' · ')}`}</small>
              ) : null}
              <small>{[WHY.message, refusal].filter(Boolean).join(' ')}</small>
            </div>
            <div className="action-buttons">
              <button type="button" disabled>
                Message Founder
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    `${campaignId || header.prospectId}-payment-ledger.json`,
                    JSON.stringify({ founderPayments: payments ?? null, gates: d }, null, 2),
                    'application/json',
                  )
                }
              >
                View ledger
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || blockers.length > 0}
                onClick={() =>
                  void submit(() =>
                    releaseFounderPayment(
                      campaignId,
                      isProduct ? 'remaining_payment' : 'single_payment',
                    ),
                  )
                }
              >
                {isProduct ? 'Release remaining 60%' : 'Release Founder payout'}
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {sheet?.kind === 'view' ? (
        <ValueDialog label={sheet.label} lines={sheet.lines} onClose={dismiss} />
      ) : null}

      {sheet?.kind === 'request_more' ? (
        <DecisionDialog
          kicker="Delivery proof"
          heading="Request more delivery proof"
          lead="Describe the exact missing evidence and set the new Founder-visible deadline."
          submitLabel="Request more proof"
          busy={busy}
          refusal={refusal}
          onDecide={(question) => void submit(() => requestClarification(campaignId, question))}
          onClose={dismiss}
        />
      ) : null}

      {sheet?.kind === 'reject' ? (
        <DecisionDialog
          kicker="Delivery proof"
          heading="Reject delivery proof"
          lead="Record why the evidence cannot qualify and what enforcement follows."
          submitLabel="Reject proof"
          withCustomerExplanation
          busy={busy}
          refusal={refusal}
          onDecide={(internalReason, customerExplanation) =>
            void submit(() =>
              decideDay14(campaignId, {
                outcome: 'fail',
                adequateProgressEvidence: false,
                requiredCommunication: false,
                /* Left empty on purpose: the failure reasons are a register the
                   server owns, and picking one here would be this surface
                   deciding a finding nobody recorded (§1 rule 6). */
                failureReasons: [],
                internalReason,
                customerExplanation,
              }),
            )
          }
          onClose={dismiss}
        />
      ) : null}

      {sheet?.kind === 'accept' ? (
        <DecisionDialog
          kicker="Delivery proof"
          heading="Accept delivery proof"
          lead="Acceptance records the evidence and communication findings against this campaign. It does not skip the Day 14 review."
          submitLabel="Accept proof"
          withCustomerExplanation
          busy={busy}
          refusal={refusal}
          onDecide={(internalReason, customerExplanation) =>
            void submit(() =>
              decideDay14(campaignId, {
                outcome: 'pass',
                adequateProgressEvidence: true,
                requiredCommunication: true,
                failureReasons: [],
                internalReason,
                customerExplanation,
              }),
            )
          }
          onClose={dismiss}
        />
      ) : null}
    </>
  );
}
