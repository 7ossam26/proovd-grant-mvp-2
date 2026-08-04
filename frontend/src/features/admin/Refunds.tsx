/**
 * Admin — refunds and §24.8 cause-based allocation (Phase 20a).
 *
 * ── The cause IS the decision ───────────────────────────────────────────────
 * Recording a case asks for §24.8's whole answer at once: the cause, the
 * Affiliate treatment (constrained to what the chosen cause permits — the
 * register travels in the payload, so the form cannot offer a Founder-caused
 * clawback the CHECK would refuse), the Proovd fee treatment, the recorded
 * Founder liability, and the evidence. An Idea-campaign refund additionally
 * names its §24.9 exception; there is no "voluntary" option to pick.
 *
 * ── Execution is preview-then-run (§26.6) ───────────────────────────────────
 * The Execute control appears only after the consequences preview was read;
 * the server refuses without the consumed preview regardless — a disabled
 * button is not authorization (§1.1).
 *
 * ── Recovery honesty (§24.9) ────────────────────────────────────────────────
 * The best-effort sentence renders wherever recovery is discussed. Nothing on
 * this surface promises that released funds are recoverable.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Card, Field, Input, Tag } from '../../components/index.js';
import {
  fetchRefundQueue,
  recordRefundCase,
  previewRefund,
  executeRefund,
  AdminRequestError,
  type RefundQueueState,
  type RefundCaseState,
} from './api.js';

function usd(cents: string | null): string {
  if (cents === null) return '—';
  return `US$${(Number(cents) / 100).toFixed(2)}`;
}

const STATUS_TONE: Record<string, 'default' | 'sage' | 'mint' | 'live'> = {
  requested: 'default',
  submitted: 'sage',
  succeeded: 'mint',
  failed: 'live',
};

type PreviewState = {
  refundId: string;
  previewId: string;
  consequences: Array<{ audience: string; text: string }>;
} | null;

export function RefundsPage() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; queue: RefundQueueState }
  >({ status: 'loading' });
  const [preview, setPreview] = useState<PreviewState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const [form, setForm] = useState({
    reservationId: '',
    cause: '',
    affiliateTreatment: '',
    proovdFeeTreatment: 'retained',
    affiliateInvalidCents: '',
    founderLiabilityCents: '',
    amountCents: '',
    evidence: '',
    recoveryNote: '',
    mandate: '',
    ideaExceptionReason: '',
    providerRefundId: '',
  });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', queue: await fetchRefundQueue(campaignId || undefined) });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The refund queue could not be read.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCase = async () => {
    setActionError(null);
    setActionNote(null);
    try {
      const result = await recordRefundCase({
        reservationId: form.reservationId.trim(),
        cause: form.cause,
        affiliateTreatment: form.affiliateTreatment,
        proovdFeeTreatment: form.proovdFeeTreatment,
        affiliateInvalidCents: form.affiliateInvalidCents.trim() || null,
        founderLiabilityCents: form.founderLiabilityCents.trim() || '0',
        evidence: form.evidence,
        recoveryNote: form.recoveryNote.trim() || null,
        mandate: form.mandate.trim() || null,
        amountCents: form.amountCents.trim(),
        ideaExceptionReason: form.ideaExceptionReason || null,
        providerRefundId: form.providerRefundId.trim() || null,
      });
      setActionNote(`Case ${result.refund.reference} recorded (${result.refund.status}).`);
      await load();
    } catch (error) {
      setActionError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The case could not be recorded.',
      );
    }
  };

  const runPreview = async (refundId: string) => {
    setActionError(null);
    setActionNote(null);
    try {
      const result = await previewRefund(refundId);
      setPreview({ refundId, previewId: result.previewId, consequences: result.consequences });
    } catch (error) {
      setActionError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The consequences preview could not be issued.',
      );
    }
  };

  const runExecute = async () => {
    if (!preview) return;
    setActionError(null);
    try {
      const result = await executeRefund(preview.refundId, preview.previewId);
      setActionNote(
        result.status === 'succeeded'
          ? `Refund ${result.refund?.reference ?? ''} succeeded.`
          : result.status === 'submitted'
            ? `Refund ${result.refund?.reference ?? ''} submitted — the provider confirmation completes it.`
            : `Execution reported: ${result.status}.`,
      );
      setPreview(null);
      await load();
    } catch (error) {
      setPreview(null);
      setActionError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The refund did not execute. Its state is recorded — nothing needs to be guessed.',
      );
      await load();
    }
  };

  if (state.status === 'loading') {
    return <p className="admin-page__note">Loading the refund queue…</p>;
  }
  if (state.status === 'error') {
    return <p className="admin-page__note">{state.message}</p>;
  }

  const { queue } = state;
  const selectedCause = queue.causes.find((c) => c.key === form.cause) ?? null;
  const treatments = selectedCause?.permittedAffiliateTreatments ?? [];
  const invalidNeeded =
    form.affiliateTreatment === 'cancel_unpaid_invalid' ||
    form.affiliateTreatment === 'contractual_recovery';

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Refunds</h1>
        <p className="admin-page__note">
          §24.8: every case stores its cause, fee treatment, Affiliate treatment, Founder
          liability, recovery, evidence, and the Admin who decided it. {queue.bestEffortRecovery}
        </p>
      </header>

      {actionNote ? <p className="admin-page__note">{actionNote}</p> : null}
      {actionError ? (
        <p className="admin-page__note" role="alert">
          {actionError}
        </p>
      ) : null}

      {queue.unreconciled.length > 0 ? (
        <Card title="Provider refunds awaiting classification">
          <p className="admin-page__note">
            These refunds were issued at the provider — §24.10 lets the Founder as merchant of
            record do that — and Proovd has no case for them yet. Record a case with the provider
            refund id to classify each one; nothing is guessed into place.
          </p>
          <ul>
            {queue.unreconciled.map((u) => (
              <li key={u.providerRefundId}>
                <code>{u.providerRefundId}</code> — {usd(u.amountCents)}
                {u.reservationId ? <> · reservation <code>{u.reservationId}</code></> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Record a refund case">
        <Field label="Reservation id">
          <Input
            value={form.reservationId}
            onChange={(e) => setForm({ ...form, reservationId: e.target.value })}
          />
        </Field>
        <Field label="Cause (§24.8)">
          <select
            className="input"
            value={form.cause}
            onChange={(e) => setForm({ ...form, cause: e.target.value, affiliateTreatment: '' })}
          >
            <option value="">Choose the cause…</option>
            {queue.causes.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        {selectedCause ? <p className="admin-page__note">{selectedCause.allocation}</p> : null}
        <Field label="Affiliate treatment">
          <select
            className="input"
            value={form.affiliateTreatment}
            onChange={(e) => setForm({ ...form, affiliateTreatment: e.target.value })}
            disabled={!selectedCause}
          >
            <option value="">Choose the treatment…</option>
            {treatments.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Proovd fee treatment">
          <select
            className="input"
            value={form.proovdFeeTreatment}
            onChange={(e) => setForm({ ...form, proovdFeeTreatment: e.target.value })}
          >
            {queue.proovdFeeTreatments.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Refund amount (integer cents)">
          <Input
            value={form.amountCents}
            onChange={(e) => setForm({ ...form, amountCents: e.target.value })}
          />
        </Field>
        {invalidNeeded ? (
          <Field label="Invalid earnings amount (integer cents) — only the invalid amount, never the whole balance (§33.9.4)">
            <Input
              value={form.affiliateInvalidCents}
              onChange={(e) => setForm({ ...form, affiliateInvalidCents: e.target.value })}
            />
          </Field>
        ) : null}
        <Field label="Founder liability (integer cents) — the recorded share the Founder bears; it reduces the §22.3 eligible share">
          <Input
            value={form.founderLiabilityCents}
            onChange={(e) => setForm({ ...form, founderLiabilityCents: e.target.value })}
          />
        </Field>
        <Field label="§24.9 exception — required for an Idea campaign; there is no voluntary option">
          <select
            className="input"
            value={form.ideaExceptionReason}
            onChange={(e) => setForm({ ...form, ideaExceptionReason: e.target.value })}
          >
            <option value="">Not an Idea campaign refund</option>
            {queue.ideaExceptions.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        {selectedCause?.requiresMandate ? (
          <Field label="Mandate — the law, Stripe, or issuer requirement this follows">
            <Input
              value={form.mandate}
              onChange={(e) => setForm({ ...form, mandate: e.target.value })}
            />
          </Field>
        ) : null}
        <Field label="Evidence">
          <Input
            value={form.evidence}
            onChange={(e) => setForm({ ...form, evidence: e.target.value })}
          />
        </Field>
        <Field label="Recovery note (best-effort — never promise released funds return)">
          <Input
            value={form.recoveryNote}
            onChange={(e) => setForm({ ...form, recoveryNote: e.target.value })}
          />
        </Field>
        <Field label="Provider refund id — only when the Founder already issued it at the provider">
          <Input
            value={form.providerRefundId}
            onChange={(e) => setForm({ ...form, providerRefundId: e.target.value })}
          />
        </Field>
        <Button onClick={() => void submitCase()}>Record case</Button>
      </Card>

      <Card title={`Cases (${queue.cases.length})`}>
        {queue.cases.length === 0 ? (
          <p className="admin-page__note">No refund cases recorded.</p>
        ) : (
          <ul className="admin-page__list">
            {queue.cases.map((c: RefundCaseState) => (
              <li key={c.refundId} className="admin-page__list-item">
                <div>
                  <strong>{c.reference}</strong>{' '}
                  <Tag variant={STATUS_TONE[c.status] ?? 'default'}>{c.status}</Tag>{' '}
                  {usd(c.amountCents)} · {c.cause.replaceAll('_', ' ')} · affiliate:{' '}
                  {c.affiliateTreatment.replaceAll('_', ' ')}
                  {c.affiliateInvalidCents ? ` (invalid ${usd(c.affiliateInvalidCents)})` : ''} ·
                  fee: {c.proovdFeeTreatment.replaceAll('_', ' ')} · Founder liability:{' '}
                  {usd(c.founderLiabilityCents)}
                  {c.ideaExceptionReason ? ` · §24.9: ${c.ideaExceptionReason.replaceAll('_', ' ')}` : ''}
                </div>
                <div className="admin-page__note">
                  Evidence: {c.evidence}
                  {c.mandate ? ` · Mandate: ${c.mandate}` : ''}
                  {c.failureMessage ? ` · Last failure: ${c.failureMessage}` : ''}
                </div>
                {c.status === 'requested' || c.status === 'failed' ? (
                  preview?.refundId === c.refundId ? (
                    <div>
                      <p className="admin-page__note">What the customer will be told:</p>
                      <ul>
                        {preview.consequences.map((line, i) => (
                          <li key={i}>
                            <strong>{line.audience}:</strong> {line.text}
                          </li>
                        ))}
                      </ul>
                      <Button onClick={() => void runExecute()}>Execute refund</Button>{' '}
                      <Button tier="secondary" onClick={() => setPreview(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button tier="secondary" onClick={() => void runPreview(c.refundId)}>
                      Preview consequences
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
