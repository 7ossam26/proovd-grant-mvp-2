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
  fetchDisputeQueue,
  fetchDisputeEvidence,
  recordDisputeEvidence,
  classifyDispute,
  AdminRequestError,
  type RefundQueueState,
  type RefundCaseState,
  type DisputeQueueState,
  type DisputeEvidencePacketState,
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

      {/* §24.11 (Phase 20b): disputes lead — their Admin task is due within
          24 hours of notice, and an overdue task sorts first. */}
      <DisputesPanel campaignId={campaignId || undefined} />

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

/**
 * The Â§24.11 dispute queue (Phase 20b). Overdue 24-hour tasks first; the
 * packet is ASSEMBLED from stored records (never re-derived) and its recorded
 * assembly refuses while a required item is missing, naming it. Classification
 * reuses the exact Â§24.8 register the refund-case form reads â€” a dispute is
 * never a second cause vocabulary. The provider's reason code renders only as
 * secondary Admin detail (Â§26.8), never as anything a customer reads.
 */
function DisputesPanel({ campaignId }: { campaignId?: string | undefined }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; queue: DisputeQueueState }
  >({ status: 'loading' });
  const [evidence, setEvidence] = useState<DisputeEvidencePacketState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [form, setForm] = useState({
    cause: '',
    affiliateTreatment: '',
    proovdFeeTreatment: 'retained',
    affiliateInvalidCents: '',
    founderLiabilityCents: '',
    evidence: '',
    recoveryNote: '',
    mandate: '',
  });

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', queue: await fetchDisputeQueue(campaignId) });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The dispute queue could not be read.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') return <p className="admin-page__note">Reading disputesâ€¦</p>;
  if (state.status === 'error') {
    return (
      <p className="admin-page__note" role="alert">
        {state.message}
      </p>
    );
  }
  const queue = state.queue;
  if (queue.disputes.length === 0) return null;

  const selectedCause = queue.causes.find((c) => c.key === form.cause);
  const treatments = selectedCause?.permittedAffiliateTreatments ?? [];
  const invalidNeeded =
    form.affiliateTreatment === 'cancel_unpaid_invalid' ||
    form.affiliateTreatment === 'contractual_recovery';

  const showEvidence = async (disputeId: string) => {
    setNote(null);
    setEvidence(await fetchDisputeEvidence(disputeId));
  };

  const recordAssembly = async (disputeId: string) => {
    setNote(null);
    try {
      await recordDisputeEvidence(disputeId);
      setNote('Evidence packet assembly recorded.');
      setEvidence(null);
      await load();
    } catch (error) {
      setNote(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The assembly was not recorded.',
      );
    }
  };

  const submitClassification = async (disputeId: string) => {
    setNote(null);
    try {
      await classifyDispute(disputeId, {
        cause: form.cause,
        affiliateTreatment: form.affiliateTreatment,
        proovdFeeTreatment: form.proovdFeeTreatment,
        affiliateInvalidCents: form.affiliateInvalidCents.trim() || null,
        founderLiabilityCents: form.founderLiabilityCents.trim() || '0',
        evidence: form.evidence,
        recoveryNote: form.recoveryNote.trim() || null,
        mandate: form.mandate.trim() || null,
      });
      setNote('Dispute classified through the Â§24.8 register.');
      setClassifying(null);
      await load();
    } catch (error) {
      setNote(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The classification was not recorded.',
      );
    }
  };

  return (
    <section aria-labelledby="disputes-heading">
      <h2 id="disputes-heading">Disputes</h2>
      <p className="admin-page__note">
        The evidence packet is due within 24 hours of notice (Â§24.11). {queue.bestEffortRecovery}
      </p>
      {note ? (
        <p className="admin-page__note" role="status">
          {note}
        </p>
      ) : null}
      <ul className="backer__support-cases">
        {queue.disputes.map((d) => (
          <li key={d.disputeId} className="backer__support-case">
            <p>
              <code>{d.providerDisputeId}</code> â€” {usd(d.amountCents)} Â· {d.status}{' '}
              {d.taskOverdue ? <Tag variant="live">Task overdue</Tag> : null}{' '}
              {d.classified ? (
                <Tag variant="mint">Classified</Tag>
              ) : (
                <Tag>Awaiting classification</Tag>
              )}
            </p>
            <p className="admin-page__note">
              Task due {d.taskDueAt.slice(0, 16).replace('T', ' ')} UTC
              {d.evidenceAssembledAt
                ? ` Â· packet recorded ${d.evidenceAssembledAt.slice(0, 16).replace('T', ' ')} UTC`
                : ' Â· packet not yet recorded'}
              {d.reasonCode ? ` Â· provider reason (internal): ${d.reasonCode}` : ''}
            </p>
            <div className="ops-check">
              <Button tier="secondary" onClick={() => showEvidence(d.disputeId)}>
                View evidence packet
              </Button>
              <Button tier="secondary" onClick={() => recordAssembly(d.disputeId)}>
                Record assembly
              </Button>
              {!d.classified ? (
                <Button
                  tier="secondary"
                  onClick={() => setClassifying(classifying === d.disputeId ? null : d.disputeId)}
                >
                  Classify (Â§24.8)
                </Button>
              ) : null}
            </div>
            {evidence && evidence.disputeId === d.disputeId ? (
              <ul>
                {evidence.items.map((item) => (
                  <li key={item.key}>
                    {item.present ? 'Present' : `Absent (${item.absentReason ?? 'not recorded'})`}
                    {' â€” '}
                    {item.label}
                    {item.required ? '' : ' (conditional)'}
                  </li>
                ))}
              </ul>
            ) : null}
            {classifying === d.disputeId ? (
              <div>
                <Field label="Cause (Â§24.8)">
                  <select
                    className="input"
                    value={form.cause}
                    onChange={(e) =>
                      setForm({ ...form, cause: e.target.value, affiliateTreatment: '' })
                    }
                  >
                    <option value="">Choose the causeâ€¦</option>
                    {queue.causes.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedCause ? (
                  <p className="admin-page__note">{selectedCause.allocation}</p>
                ) : null}
                <Field label="Affiliate treatment">
                  <select
                    className="input"
                    value={form.affiliateTreatment}
                    disabled={!selectedCause}
                    onChange={(e) => setForm({ ...form, affiliateTreatment: e.target.value })}
                  >
                    <option value="">Chooseâ€¦</option>
                    {treatments.map((t) => (
                      <option key={t} value={t}>
                        {t}
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
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                {invalidNeeded ? (
                  <Field label="Invalid earnings (cents)">
                    <Input
                      value={form.affiliateInvalidCents}
                      onChange={(e) => setForm({ ...form, affiliateInvalidCents: e.target.value })}
                    />
                  </Field>
                ) : null}
                <Field label="Founder liability (cents)">
                  <Input
                    value={form.founderLiabilityCents}
                    onChange={(e) => setForm({ ...form, founderLiabilityCents: e.target.value })}
                  />
                </Field>
                {selectedCause?.requiresMandate ? (
                  <Field label="Mandate (who required this outcome)">
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
                <Field label="Recovery note (optional)">
                  <Input
                    value={form.recoveryNote}
                    onChange={(e) => setForm({ ...form, recoveryNote: e.target.value })}
                  />
                </Field>
                <Button tier="secondary" onClick={() => submitClassification(d.disputeId)}>
                  Record classification
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

