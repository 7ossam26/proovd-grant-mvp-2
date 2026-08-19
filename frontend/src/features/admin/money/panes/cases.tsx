/**
 * §24.8 refunds, §24.11 disputes, and §22.4–§22.7 fulfillment.
 *
 * ── The cause narrows the form, because the register says which it may ──────
 * `permittedAffiliateTreatments` is on the cause, so choosing one decides what
 * the treatment control may offer. A Founder-caused case cannot even PRESENT
 * `cancel_unpaid_invalid` — §33.9.3's "most tempting wrong simplification" is
 * unreachable in the form as well as refused by the service and by a CHECK.
 * Three layers, and the one on this screen is the one that stops an Admin from
 * trying.
 *
 * ── Preview, then execute — and the preview is a record ─────────────────────
 * §26.6 asks for reauthentication, a preview of the customer-visible
 * consequences, idempotency, and immutable audit. The first is the route's
 * freshness gate, the third is the stable `reservation-refund:<allocationId>`
 * key, the fourth is insert-only rows. The second is the only one a surface can
 * get wrong: a preview merely RENDERED is one nothing enforces, so this posts
 * for it, shows exactly what came back, and sends its id with the execution.
 *
 * ── The dispute task is overdue-first and the packet names its gaps ─────────
 * §24.11's 24-hour task is CHECK-pinned to `opened_at + 24 hours`, so an
 * overdue one is a fact rather than a judgement. The packet renders each of the
 * ten items as present with its value or absent with the reason — an item that
 * rendered blank would read as complete inside evidence going to an issuer.
 */

import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  DAY_14_IS_ONE_CHECKLIST,
  MONEY_OPERATIONS_ABSENCES,
  PREVIEW_BEFORE_EXECUTE,
  REFUND_CAUSE_DECIDES_THE_TREATMENT,
} from '@proovd/shared';
import { Button, useToast } from '../../../../components/index.js';
import {
  ConfirmDialog,
  type DialogSpec,
  type DialogValues,
} from '../../founders/dialogs/ConfirmDialog.js';
import {
  AdminRequestError,
  assembleDisputeEvidence,
  classifyDispute,
  decideDay14,
  decideDeliveryChange,
  executeRefund,
  fetchDisputePacket,
  openDay14,
  previewRefund,
  recordRefundCase,
  requestDay14Clarification,
  type DisputePacketView,
} from '../api.js';
import type { PaneProps } from '../MoneyRecord.js';
import {
  Absence,
  Amount,
  Fact,
  Facts,
  MoneySection,
  Nothing,
  Pill,
  Pinned,
  day,
  instant,
} from '../shared.js';

const absencesFor = (tab: string) => MONEY_OPERATIONS_ABSENCES.filter((a) => a.tab === tab);

function useDecision(reload: () => void) {
  const [dialog, setDialog] = useState<{
    spec: DialogSpec;
    submit: (values: DialogValues) => Promise<void>;
  } | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const toast = useToast();

  const open = (
    event: MouseEvent<HTMLElement>,
    spec: DialogSpec,
    submit: (values: DialogValues) => Promise<void>,
  ) => {
    setTrigger(event.currentTarget);
    setDialog({ spec, submit });
  };

  const act = async (work: () => Promise<unknown>, done: string, sub?: string) => {
    try {
      await work();
      toast(done, sub ? { sub } : undefined);
      reload();
    } catch (error) {
      toast(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'Nothing was changed, and it is not certain why. Reload before trying again.',
      );
    }
  };

  const panel: ReactNode = dialog ? (
    <ConfirmDialog
      spec={dialog.spec}
      trigger={trigger}
      onSubmit={dialog.submit}
      onClose={() => setDialog(null)}
    />
  ) : null;

  return { open, act, panel, toast };
}

/* ── §24.8 and §24.11 ───────────────────────────────────────────────────────*/

export function CasesPane({ record, reload }: PaneProps) {
  const { refunds, disputes } = record;
  const { open, act, panel, toast } = useDecision(reload);
  const [preview, setPreview] = useState<{ refundId: string; previewId: string; lines: string[] } | null>(null);
  const [packet, setPacket] = useState<DisputePacketView | null>(null);

  /*
    The chosen cause, held OUTSIDE the dialog so the treatment control inside it
    is already narrowed when it opens. `ConfirmDialog` renders a static spec, so
    a picker inside it could not re-narrow its own sibling — and offering every
    treatment "and letting the server refuse" would put §33.9.3's tempting wrong
    answer back on the screen. Refunds and disputes hold their own, because
    classifying a dispute and recording a refund are two decisions.
  */
  const [cause, setCause] = useState<string>(refunds.causes[0]?.key ?? '');
  const chosen = refunds.causes.find((c) => c.key === cause) ?? refunds.causes[0];
  const [disputeCause, setDisputeCause] = useState<string>(disputes.causes[0]?.key ?? '');
  const disputeChosen =
    disputes.causes.find((c) => c.key === disputeCause) ?? disputes.causes[0];

  return (
    <>
      <MoneySection
        title="Refund cases"
        lede="Every refund is classified before it exists. The cause decides what may happen to the Creator's earnings and to Proovd's fee."
        aside={
          <Button
            tier="secondary"
            small
            onClick={(event) =>
              open(
                event,
                {
                  kicker: 'Refund',
                  title: 'Record a refund case',
                  body: (
                    <>
                      <p>{REFUND_CAUSE_DECIDES_THE_TREATMENT}</p>
                      <p>{chosen?.allocation}</p>
                    </>
                  ),
                  fields: [
                    { id: 'reservationId', label: 'Pre-order id', required: true },
                    { id: 'amountCents', label: 'Amount, in cents', required: true },
                    {
                      id: 'cause',
                      label: 'Cause',
                      required: true,
                      select: true,
                      value: cause,
                      options: refunds.causes.map((c) => ({ value: c.key, label: c.label })),
                    },
                    {
                      id: 'affiliateTreatment',
                      label: 'Creator earnings treatment',
                      required: true,
                      select: true,
                      /* Only what THIS cause permits. The service refuses the
                         rest by name and a CHECK refuses them regardless — this
                         is the layer that stops an Admin trying. */
                      options: (chosen?.permittedAffiliateTreatments ?? []).map((t) => ({
                        value: t,
                        label: t,
                      })),
                    },
                    {
                      id: 'proovdFeeTreatment',
                      label: 'Proovd fee treatment',
                      required: true,
                      select: true,
                      options: refunds.proovdFeeTreatments.map((t) => ({
                        value: t,
                        label: t,
                      })),
                    },
                    { id: 'founderLiabilityCents', label: 'Founder liability, in cents', required: true },
                    { id: 'affiliateInvalidCents', label: 'Invalid Creator amount, in cents' },
                    { id: 'evidence', label: 'Evidence', required: true, textarea: true },
                    { id: 'recoveryNote', label: 'Recovery note', textarea: true },
                    { id: 'mandate', label: 'Mandate' },
                    {
                      id: 'ideaExceptionReason',
                      label: 'Idea campaign exception',
                      select: true,
                      hint: 'Required on an Idea campaign, and refused on a Product one. There is no change-of-mind value.',
                      options: [
                        { value: '', label: 'Not an Idea campaign' },
                        ...refunds.ideaExceptions.map((e) => ({ value: e.key, label: e.label })),
                      ],
                    },
                  ],
                  primary: 'Record the case',
                },
                async (values) => {
                  await recordRefundCase({
                    reservationId: values['reservationId'],
                    amountCents: values['amountCents'],
                    cause: values['cause'],
                    affiliateTreatment: values['affiliateTreatment'],
                    proovdFeeTreatment: values['proovdFeeTreatment'],
                    founderLiabilityCents: values['founderLiabilityCents'],
                    affiliateInvalidCents: values['affiliateInvalidCents'] || null,
                    evidence: values['evidence'],
                    recoveryNote: values['recoveryNote'] || null,
                    mandate: values['mandate'] || null,
                    ideaExceptionReason: values['ideaExceptionReason'] || null,
                  });
                  toast('Case recorded');
                  reload();
                },
              )
            }
          >
            Record a case
          </Button>
        }
      >
        <Pinned>{REFUND_CAUSE_DECIDES_THE_TREATMENT}</Pinned>
        <Pinned>{PREVIEW_BEFORE_EXECUTE}</Pinned>
        <Pinned>{refunds.bestEffortRecovery}</Pinned>

        {/* The cause picker outside the dialog, so the form's own options are
            already narrowed when it opens. */}
        <label className="mny-cause">
          <span>Cause for the next case</span>
          <select value={cause} onChange={(event) => setCause(event.target.value)}>
            {refunds.causes.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {chosen ? <p className="helper">{chosen.allocation}</p> : null}

        {refunds.cases.length === 0 ? (
          <Nothing>No refund has been recorded on this campaign.</Nothing>
        ) : (
          <ul className="mny-rows mny-rows--flat">
            {refunds.cases.map((entry) => (
              <li key={entry.refundId} className="mny-case">
                <span className="mny-row__lead">
                  <Pill
                    label={entry.status}
                    tone={
                      entry.status === 'succeeded'
                        ? 'ok'
                        : entry.status === 'failed'
                          ? 'risk'
                          : 'wait'
                    }
                    small
                  />
                  <strong>{entry.reference}</strong>
                </span>
                <Facts wide>
                  <Fact label="Amount">
                    <Amount cents={entry.amountCents} waitingOn="—" />
                  </Fact>
                  <Fact label="Cause">{entry.cause}</Fact>
                  <Fact label="Creator earnings">{entry.affiliateTreatment}</Fact>
                  <Fact label="Proovd fee">{entry.proovdFeeTreatment}</Fact>
                  <Fact label="Founder liability">
                    <Amount cents={entry.founderLiabilityCents} waitingOn="—" />
                  </Fact>
                  {entry.ideaExceptionReason ? (
                    <Fact label="Idea exception">{entry.ideaExceptionReason}</Fact>
                  ) : null}
                  <Fact label="Recorded by">{entry.decidedBy}</Fact>
                  <Fact label="Recorded">{instant(entry.createdAt)}</Fact>
                </Facts>
                <p className="helper">{entry.evidence}</p>

                {preview?.refundId === entry.refundId ? (
                  <div className="mny-preview">
                    <p className="kicker">What the Backer will see</p>
                    <ul>
                      {preview.lines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                    <Button
                      tier="primary"
                      small
                      onClick={() =>
                        void act(async () => {
                          await executeRefund(entry.refundId, preview.previewId);
                          setPreview(null);
                        }, 'Refund submitted')
                      }
                    >
                      Execute this refund
                    </Button>
                  </div>
                ) : (
                  <Button
                    tier="secondary"
                    small
                    onClick={() =>
                      void act(async () => {
                        const result = await previewRefund(entry.refundId);
                        setPreview({
                          refundId: entry.refundId,
                          previewId: result.previewId,
                          lines: result.consequences,
                        });
                      }, 'Preview recorded')
                    }
                  >
                    Preview the consequences
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {refunds.unreconciled.length > 0 ? (
          <>
            <h3 className="mny-sub">Awaiting classification</h3>
            <p className="helper">
              A refund the Founder issued from their own dashboard. It is recorded and routed here
              rather than guessed into a cause.
            </p>
            <ul className="mny-rows mny-rows--flat">
              {refunds.unreconciled.map((entry) => (
                <li key={entry.providerRefundId} className="mny-case">
                  <Facts>
                    <Fact label="Provider refund">
                      <code>{entry.providerRefundId}</code>
                    </Fact>
                    <Fact label="Amount">
                      <Amount cents={entry.amountCents} waitingOn="Not reported" />
                    </Fact>
                    <Fact label="Seen">{instant(entry.recordedAt)}</Fact>
                  </Facts>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </MoneySection>

      <MoneySection
        title="Disputes"
        lede="Overdue 24-hour tasks first. A dispute touches no Creator earnings until it is classified through the same cause register a refund uses."
      >
        <label className="mny-cause">
          <span>Cause for the next classification</span>
          <select value={disputeCause} onChange={(event) => setDisputeCause(event.target.value)}>
            {disputes.causes.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {disputeChosen ? <p className="helper">{disputeChosen.allocation}</p> : null}

        {disputes.disputes.length === 0 ? (
          <Nothing>No dispute has been opened on this campaign.</Nothing>
        ) : (
          <ul className="mny-rows mny-rows--flat">
            {[...disputes.disputes]
              .sort((a, b) => Number(b.taskOverdue) - Number(a.taskOverdue))
              .map((entry) => (
                <li key={entry.disputeId} className="mny-case">
                  <span className="mny-row__lead">
                    <Pill
                      label={entry.taskOverdue ? 'Task overdue' : entry.status}
                      tone={entry.taskOverdue ? 'risk' : entry.closedAt ? 'ok' : 'wait'}
                      small
                    />
                    <strong>{entry.providerDisputeId}</strong>
                  </span>
                  <Facts wide>
                    <Fact label="Amount">
                      <Amount cents={entry.amountCents} waitingOn="—" />
                    </Fact>
                    <Fact label="Opened">{instant(entry.openedAt)}</Fact>
                    <Fact label="24-hour task due">{instant(entry.taskDueAt)}</Fact>
                    <Fact label="Provider evidence due">
                      {instant(entry.providerEvidenceDueBy)}
                    </Fact>
                    <Fact label="Classified">{entry.classified ? 'Yes' : 'Not yet'}</Fact>
                    <Fact label="Evidence assembled">
                      {instant(entry.evidenceAssembledAt)}
                    </Fact>
                    {/* §26.8 permits the raw code as secondary Admin detail. It
                        reaches no customer message (§33.9.11). */}
                    {entry.reasonCode ? (
                      <Fact label="Provider reason">
                        <code>{entry.reasonCode}</code>
                      </Fact>
                    ) : null}
                  </Facts>

                  <div className="mny-acts">
                    <Button
                      tier="secondary"
                      small
                      onClick={() =>
                        void act(async () => {
                          setPacket(await fetchDisputePacket(entry.disputeId));
                        }, 'Packet read')
                      }
                    >
                      Read the evidence packet
                    </Button>
                    <Button
                      tier="secondary"
                      small
                      onClick={(event) =>
                        open(
                          event,
                          {
                            kicker: entry.providerDisputeId,
                            title: 'Record the assembly',
                            body: (
                              <p>
                                Recording what was assembled, by whom, and when. An incomplete
                                packet is refused with the missing items named.
                              </p>
                            ),
                            fields: [{ id: 'note', label: 'Note', required: true, textarea: true }],
                            primary: 'Record it',
                          },
                          async (values) => {
                            await assembleDisputeEvidence(entry.disputeId, values['note'] ?? '');
                            toast('Assembly recorded');
                            reload();
                          },
                        )
                      }
                    >
                      Record the assembly
                    </Button>
                    <Button
                      tier="secondary"
                      small
                      onClick={(event) =>
                        open(
                          event,
                          {
                            kicker: entry.providerDisputeId,
                            title: 'Classify the dispute',
                            body: <p>{REFUND_CAUSE_DECIDES_THE_TREATMENT}</p>,
                            fields: [
                              {
                                id: 'cause',
                                label: 'Cause',
                                required: true,
                                select: true,
                                value: disputeCause,
                                options: disputes.causes.map((c) => ({
                                  value: c.key,
                                  label: c.label,
                                })),
                              },
                              {
                                id: 'affiliateTreatment',
                                label: 'Creator earnings treatment',
                                required: true,
                                select: true,
                                /* Only what the cause chosen above the list
                                   permits — the same narrowing the refund form
                                   does, against the same register. */
                                options: (disputeChosen?.permittedAffiliateTreatments ?? []).map(
                                  (t) => ({ value: t, label: t }),
                                ),
                              },
                              {
                                id: 'proovdFeeTreatment',
                                label: 'Proovd fee treatment',
                                required: true,
                                select: true,
                                options: disputes.proovdFeeTreatments.map((t) => ({
                                  value: t,
                                  label: t,
                                })),
                              },
                              {
                                id: 'founderLiabilityCents',
                                label: 'Founder liability, in cents',
                                required: true,
                              },
                              { id: 'evidence', label: 'Evidence', required: true, textarea: true },
                            ],
                            primary: 'Classify',
                          },
                          async (values) => {
                            await classifyDispute(entry.disputeId, {
                              cause: values['cause'],
                              affiliateTreatment: values['affiliateTreatment'],
                              proovdFeeTreatment: values['proovdFeeTreatment'],
                              founderLiabilityCents: values['founderLiabilityCents'],
                              evidence: values['evidence'],
                            });
                            toast('Classified');
                            reload();
                          },
                        )
                      }
                    >
                      Classify
                    </Button>
                  </div>

                  {packet && packet.disputeId === entry.disputeId ? (
                    <div className="mny-packet">
                      <p className="kicker">
                        {packet.complete
                          ? 'Every item is present'
                          : `${packet.missing.length} item(s) missing`}
                      </p>
                      <ul>
                        {packet.items.map((item) => (
                          <li key={item.key}>
                            <strong>{item.label}</strong>{' '}
                            {item.present ? (
                              (item.detail ?? '')
                            ) : (
                              <span className="grey">{item.absentBecause}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </MoneySection>

      <MoneySection title="Not on this screen">
        {absencesFor('refunds').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>

      {panel}
    </>
  );
}

/* ── §22.4–§22.7 ────────────────────────────────────────────────────────────*/

export function FulfillmentPane({ campaignId, record, reload }: PaneProps) {
  const view = record.fulfillment;
  const { open, act, panel, toast } = useDecision(reload);

  if (!view) {
    return (
      <MoneySection title="No fulfillment record">
        <Nothing>
          Nothing has been captured on this campaign, so there is nothing to deliver and no Day 14
          review to open.
        </Nothing>
      </MoneySection>
    );
  }

  const { fulfillment, day14, ghostBan } = view;

  return (
    <>
      <MoneySection
        title="What the Founder owes"
        lede="Four obligations, each with the record that satisfies it."
      >
        <ul className="mny-rows mny-rows--flat">
          {fulfillment.obligations.map((obligation) => (
            <li key={obligation.key} className="mny-obligation">
              <span className="mny-row__lead">
                <Pill
                  label={obligation.state}
                  tone={
                    obligation.state === 'met'
                      ? 'ok'
                      : obligation.state === 'overdue'
                        ? 'risk'
                        : 'wait'
                  }
                  small
                />
                <strong>{obligation.label}</strong>
              </span>
              <p className="helper">{obligation.detail}</p>
              <Facts>
                <Fact label="Evidence">{obligation.evidence}</Fact>
                <Fact label="Due">{instant(obligation.dueAt)}</Fact>
              </Facts>
            </li>
          ))}
        </ul>
        <Facts>
          <Fact label="Delivery mechanism">
            {fulfillment.mechanismLabel ?? <span className="grey">Not set</span>}
          </Fact>
          <Fact label="Delivered">{instant(fulfillment.deliveredAt)}</Fact>
          <Fact label="Days since last communication">
            {fulfillment.cadence.daysSinceLastCommunication ?? (
              <span className="grey">No communication recorded</span>
            )}
          </Fact>
          <Fact label="Next update due">{instant(fulfillment.cadence.nextDueAt)}</Fact>
        </Facts>
      </MoneySection>

      <MoneySection
        title="The delivery promise"
        lede="Insert-only. The first row is the original promise and is what the delivery notice and a dispute packet both read."
      >
        <ul className="mny-rows mny-rows--flat">
          {fulfillment.commitments.map((commitment) => (
            <li key={commitment.sequence} className="mny-commitment">
              <span className="mny-row__lead">
                {commitment.isOriginal ? <Pill label="Original" tone="ok" small /> : null}
                <strong>{commitment.deliveryMonth}</strong>
              </span>
              <p className="helper">{commitment.commitmentText}</p>
              <Facts>
                <Fact label="Date">{day(commitment.deliveryDate)}</Fact>
                <Fact label="Reason">
                  {commitment.reason ?? <span className="grey">The original promise</span>}
                </Fact>
                <Fact label="Path">
                  {commitment.path ?? <span className="grey">—</span>}
                </Fact>
                <Fact label="Backers told">{instant(commitment.notifiedBackersAt)}</Fact>
              </Facts>
            </li>
          ))}
        </ul>
        <p className="helper">
          A change would take the <strong>{fulfillment.changePath}</strong> path, derived from the
          campaign type and whether the remaining payment has released.
        </p>
        {fulfillment.pendingChangeRequest ? (
          <div className="mny-acts">
            <Button
              tier="secondary"
              small
              onClick={(event) =>
                open(
                  event,
                  {
                    kicker: 'Delivery change',
                    title: 'Decide the change request',
                    body: (
                      <p>
                        Proposed month {fulfillment.pendingChangeRequest?.proposedDeliveryMonth}.
                        Review due {instant(fulfillment.pendingChangeRequest?.reviewDueAt ?? null)}.
                      </p>
                    ),
                    fields: [
                      {
                        id: 'decision',
                        label: 'Decision',
                        required: true,
                        select: true,
                        options: [
                          { value: 'approved', label: 'Approve' },
                          { value: 'declined', label: 'Decline' },
                        ],
                      },
                      { id: 'reason', label: 'Reason', required: true, textarea: true },
                    ],
                    primary: 'Record the decision',
                  },
                  async (values) => {
                    await decideDeliveryChange(fulfillment.pendingChangeRequest?.id ?? '', {
                      decision: values['decision'] ?? '',
                      reason: values['reason'] ?? '',
                    });
                    toast('Decision recorded');
                    reload();
                  },
                )
              }
            >
              Decide the change request
            </Button>
          </div>
        ) : null}
      </MoneySection>

      <MoneySection
        title="Day 14 progress check"
        lede={
          day14.enforcementOnly
            ? 'This campaign has no remaining payment, so the review is enforcement-only.'
            : 'A failure blocks the unreleased remaining payment.'
        }
      >
        <Pinned>{DAY_14_IS_ONE_CHECKLIST}</Pinned>
        <Facts>
          <Fact label="Outcome">
            <Pill
              label={day14.outcome}
              tone={day14.outcome === 'pass' ? 'ok' : day14.outcome === 'fail' ? 'risk' : 'wait'}
              small
            />
          </Fact>
          <Fact label="Decision due">{instant(day14.decisionDueAt)}</Fact>
          <Fact label="Blocks a payment">{day14.blocksAPayment ? 'Yes' : 'No'}</Fact>
        </Facts>

        <h3 className="mny-sub">The checklist</h3>
        <ul className="mny-checklist">
          {day14.items.map((item) => (
            <li key={item.key}>
              <strong>{item.label}</strong>
              {item.required ? null : <span className="mny-optional"> (optional)</span>}
              <span className="helper">e.g. {item.example}</span>
            </li>
          ))}
        </ul>

        {day14.submissions.length > 0 ? (
          <>
            <h3 className="mny-sub">Evidence received</h3>
            <ul className="mny-rows mny-rows--flat">
              {day14.submissions.map((submission) => (
                <li key={submission.id}>
                  <Facts>
                    <Fact label="Receipt">{submission.reference}</Fact>
                    <Fact label="Submitted">{instant(submission.submittedAt)}</Fact>
                    <Fact label="Decision due">{instant(submission.decisionDueAt)}</Fact>
                  </Facts>
                  <ul>
                    {submission.items.map((item) => (
                      <li key={item.itemKey}>
                        <strong>{item.label}</strong> {item.detail}
                        {item.url ? ` · ${item.url}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Nothing>Nothing has been submitted yet.</Nothing>
        )}

        {day14.clarifications.length > 0 ? (
          <>
            <h3 className="mny-sub">Clarifications</h3>
            <ul className="mny-rows mny-rows--flat">
              {day14.clarifications.map((entry) => (
                <li key={entry.id}>
                  <span className="mny-row__lead">
                    <Pill
                      label={entry.respondedAt ? 'Answered' : entry.overdue ? 'Overdue' : 'Open'}
                      tone={entry.respondedAt ? 'ok' : entry.overdue ? 'risk' : 'wait'}
                      small
                    />
                  </span>
                  <p className="helper">{entry.question}</p>
                  <Facts>
                    <Fact label="Due">{instant(entry.dueAt)}</Fact>
                    <Fact label="Answered">{instant(entry.respondedAt)}</Fact>
                  </Facts>
                  {entry.responseNote ? <p className="helper">{entry.responseNote}</p> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mny-acts">
          <Button
            tier="secondary"
            small
            onClick={() => void act(() => openDay14(campaignId), 'Review opened')}
          >
            Open the review
          </Button>
          <Button
            tier="secondary"
            small
            onClick={(event) =>
              open(
                event,
                {
                  kicker: 'Day 14',
                  title: 'Ask for a clarification',
                  body: <p>The Founder has five business days to answer.</p>,
                  fields: [{ id: 'note', label: 'What you need', required: true, textarea: true }],
                  primary: 'Ask',
                },
                async (values) => {
                  await requestDay14Clarification(campaignId, values['note'] ?? '');
                  toast('Clarification requested');
                  reload();
                },
              )
            }
          >
            Request a clarification
          </Button>
          <Button
            tier="primary"
            small
            onClick={(event) =>
              open(
                event,
                {
                  kicker: 'Day 14',
                  title: 'Decide the review',
                  body: (
                    <p>
                      Written once. A pass cannot carry failure reasons and a fail cannot carry
                      none — the service and a CHECK both refuse the combination.
                    </p>
                  ),
                  fields: [
                    {
                      id: 'outcome',
                      label: 'Outcome',
                      required: true,
                      select: true,
                      options: [
                        { value: 'pass', label: 'Pass' },
                        { value: 'fail', label: 'Fail' },
                      ],
                    },
                    {
                      id: 'findings',
                      label: 'Findings',
                      required: true,
                      textarea: true,
                      hint: 'One per line.',
                    },
                    {
                      id: 'failureReasons',
                      label: 'Failure reasons',
                      textarea: true,
                      hint: 'One key per line, on a fail only.',
                    },
                    {
                      id: 'customerExplanation',
                      label: 'What the Founder reads',
                      required: true,
                      textarea: true,
                      hint: 'A provider or fraud code here is refused.',
                    },
                  ],
                  primary: 'Record the decision',
                },
                async (values) => {
                  await decideDay14(campaignId, {
                    outcome: values['outcome'] ?? '',
                    findings: (values['findings'] ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
                    failureReasons: (values['failureReasons'] ?? '')
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean),
                    customerExplanation: values['customerExplanation'] ?? '',
                  });
                  toast('Decision recorded');
                  reload();
                },
              )
            }
          >
            Decide
          </Button>
        </div>
      </MoneySection>

      {ghostBan ? (
        <MoneySection
          title="Ghost ban"
          lede="One strike, and only against a trigger the record already meets."
        >
          <Pinned>{ghostBan.permanentSentence}</Pinned>
          <ul className="mny-checklist">
            {ghostBan.triggers.map((trigger) => (
              <li key={trigger.key}>
                <Pill label={trigger.met ? 'Met' : 'Not met'} tone={trigger.met ? 'risk' : 'ok'} small />{' '}
                {trigger.label}
              </li>
            ))}
          </ul>
          {ghostBan.alreadyBanned ? (
            <Nothing>This Founder is already banned. There is no path that lifts it.</Nothing>
          ) : null}
        </MoneySection>
      ) : null}

      <MoneySection title="Not on this screen">
        {absencesFor('fulfillment').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>

      {panel}
    </>
  );
}
