/**
 * §22.1 Creator earnings, §22.2 the thank-you, and §22.3 the Founder payment.
 *
 * ── The four acts are in §22.1's own order, and each refuses by name ────────
 * Decide → finalize → approve → transfer. The controls are rendered in that
 * order and none of them checks whether the previous one has happened: the
 * services do, and their refusal is what an Admin reads (§1.1 — a disabled
 * button is not authorization). A client-side ordering rule would be a second
 * copy of the rule, and the copy is what goes stale.
 *
 * ── No amount on this page was calculated by this page ──────────────────────
 * The earned percentage, the §24.4 identity, and §22.3's eligible share are all
 * resolved by the services that own them and rendered as they arrive. There is
 * no arithmetic in this file at all — §33.8.13's "one source, many renderers"
 * is only true while the renderers are renderers.
 *
 * ── `earnings: null` is not US$0.00 ─────────────────────────────────────────
 * Before finalization there is no earnings record, so there is no amount. A
 * zero there would read as "this Creator earned nothing" rather than "this has
 * not happened yet" (§16a), so the row says which act is next instead.
 */

import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  MONEY_OPERATIONS_ABSENCES,
  THANK_YOU_COMPUTES_NOTHING,
  TRANSFER_IS_ONE_PER_CREATOR,
  W9_REFERENCE_NEVER_HOLDS_A_TIN,
} from '@proovd/shared';
import { Button, useToast } from '../../../../components/index.js';
import {
  ConfirmDialog,
  type DialogSpec,
  type DialogValues,
} from '../../founders/dialogs/ConfirmDialog.js';
import {
  AdminRequestError,
  approveEarnings,
  createFounderPayment,
  createTransfer,
  decideEarlyRelease,
  decideW9,
  finalizeEarnings,
  recordCompletion,
  recordEarlyReleaseEvidence,
  recordThankYou,
  recordW9Submitted,
  releaseFounderPayment,
  requestW9,
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
  instant,
  usd,
} from '../shared.js';

const absencesFor = (tab: string) => MONEY_OPERATIONS_ABSENCES.filter((a) => a.tab === tab);

/** Opening a decision panel, and reporting the server's refusal if there is one. */
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

  /** A control with no form behind it — still reports the refusal it gets. */
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

/* ── §22.1 / §22.2 ──────────────────────────────────────────────────────────*/

export function CreatorsPane({ record, reload }: PaneProps) {
  const view = record.earnings;
  const { open, act, panel, toast } = useDecision(reload);

  if (!view) {
    return (
      <MoneySection title="No Creator earnings yet">
        <Nothing>
          This campaign has no Creator with a locked agreement, or it has not closed. Earnings are
          finalized after the retry window, once the deliverables have been verified.
        </Nothing>
      </MoneySection>
    );
  }

  if (view.creators.length === 0) {
    return (
      <MoneySection title="No Creators on this campaign">
        <Nothing>
          No Creator holds a locked compensation agreement here, so there is nothing to finalize
          and no Transfer to make.
        </Nothing>
      </MoneySection>
    );
  }

  return (
    <>
      <MoneySection
        title="Creators"
        lede="Deliverables verified, earnings finalized, the amount approved by a named person, and then the one Transfer."
      >
        <Pinned>{TRANSFER_IS_ONE_PER_CREATOR}</Pinned>

        <ul className="mny-rows mny-rows--flat">
          {view.creators.map((row) => {
            const earnings = row.earnings;
            return (
              <li key={row.associationId} className="mny-creator">
                <span className="mny-row__lead">
                  <Pill
                    label={earnings?.state ?? 'Not finalized'}
                    tone={
                      row.transfer?.status === 'created' || earnings?.state === 'paid_out'
                        ? 'ok'
                        : earnings
                          ? 'wait'
                          : 'off'
                    }
                    small
                  />
                  {/* §11: the Founder sees a public handle. An Admin working a
                      support case needs the address, and this is an Admin
                      surface — but the handle leads, because that is who the
                      Creator is on this campaign. */}
                  <strong>{row.publicHandle ?? row.email ?? row.associationId}</strong>
                </span>

                <Facts wide>
                  <Fact label="Attributed captured pre-orders">{row.attributedCaptured}</Fact>
                  <Fact label="Valid attributed subtotal">
                    <Amount cents={row.validSubtotalCents} waitingOn="Nothing captured" />
                  </Fact>
                  <Fact label="Completion decision">
                    {row.latestDecision ? (
                      <>
                        {row.latestDecision.outcome}
                        <span className="mny-fact__note">
                          {row.latestDecision.decidedBy} · {instant(row.latestDecision.decidedAt)}
                        </span>
                      </>
                    ) : (
                      <span className="grey">Not decided — this is the first act</span>
                    )}
                  </Fact>
                  <Fact label="Commission">
                    <Amount
                      cents={earnings?.commissionCents}
                      waitingOn="Not finalized yet"
                    />
                  </Fact>
                  <Fact label="Bonus">
                    <Amount cents={earnings?.bonusCents} waitingOn="Not finalized yet" />
                  </Fact>
                  <Fact label="Fixed payment">
                    {row.allocation ? (
                      <>
                        <Amount cents={earnings?.eligibleFixedCents ?? row.allocation.amountCents} waitingOn="Not finalized yet" />
                        <span className="mny-fact__note">Allocation {row.allocation.status}</span>
                      </>
                    ) : (
                      <span className="grey">No fixed arrangement — commission only</span>
                    )}
                  </Fact>
                  <Fact
                    label="Earned"
                    note={
                      earnings
                        ? `${earnings.earnedPercent}% of the valid attributed subtotal`
                        : undefined
                    }
                  >
                    <Amount cents={earnings?.earnedTotalCents} waitingOn="Not finalized yet" />
                  </Fact>
                  <Fact
                    label="Returned to the Founder"
                    note={
                      earnings
                        ? 'The unearned remainder of what was provisioned. Earned + returned = provisional, to the cent.'
                        : undefined
                    }
                  >
                    <Amount cents={earnings?.unearnedReturnedCents} waitingOn="Not finalized yet" />
                  </Fact>
                  <Fact label="Approved by">
                    {earnings?.approvedBy ?? (
                      <span className="grey">Not approved for Transfer</span>
                    )}
                  </Fact>
                  <Fact label="Transfer">
                    {row.transfer ? (
                      <>
                        {row.transfer.status} · <Amount cents={row.transfer.totalCents} waitingOn="—" />
                        {row.transfer.providerTransferId ? (
                          <span className="mny-fact__note">
                            <code>{row.transfer.providerTransferId}</code>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="grey">Not created</span>
                    )}
                  </Fact>
                  <Fact label="Earliest Transfer">
                    {row.transferEarliestAt ? (
                      instant(row.transferEarliestAt)
                    ) : (
                      <span className="grey">The campaign has not closed</span>
                    )}
                  </Fact>
                </Facts>

                <div className="mny-acts">
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      open(
                        event,
                        {
                          kicker: row.publicHandle ?? row.associationId,
                          title: 'Record the completion decision',
                          body: (
                            <p>
                              What the deliverables actually were. The outcome decides what happens
                              to the fixed payment and to the commission — there is no second choice
                              to make about the money afterwards.
                            </p>
                          ),
                          fields: [
                            {
                              id: 'outcome',
                              label: 'Outcome',
                              required: true,
                              select: true,
                              options: view.completionOutcomes.map((outcome) => ({
                                value: outcome.key,
                                label: outcome.spec,
                              })),
                            },
                            {
                              id: 'deliverablesNote',
                              label: 'What you verified',
                              required: true,
                              textarea: true,
                              hint: 'Recorded with your name and the time.',
                            },
                          ],
                          primary: 'Record the decision',
                        },
                        async (values) => {
                          await recordCompletion(row.associationId, {
                            outcome: values['outcome'] ?? '',
                            deliverablesNote: values['deliverablesNote'] ?? '',
                          });
                          toast('Decision recorded');
                          reload();
                        },
                      )
                    }
                  >
                    Record completion
                  </Button>

                  <Button
                    tier="secondary"
                    small
                    onClick={() =>
                      void act(
                        () => finalizeEarnings(row.associationId),
                        'Earnings finalized',
                        'Earned and returned now resolve to the provisioned total, to the cent.',
                      )
                    }
                  >
                    Finalize earnings
                  </Button>

                  <Button
                    tier="secondary"
                    small
                    onClick={() =>
                      void act(
                        () => approveEarnings(row.associationId),
                        'Approved for Transfer',
                        'Your name is on the amount.',
                      )
                    }
                  >
                    Approve the amount
                  </Button>

                  <Button
                    tier="primary"
                    small
                    onClick={() =>
                      void act(
                        () => createTransfer(row.associationId),
                        'Transfer created',
                        'One per Creator, under its stable key.',
                      )
                    }
                  >
                    Create the Transfer
                  </Button>
                </div>

                <details className="mny-item__history">
                  <summary>Record a thank-you</summary>
                  <p className="helper">{THANK_YOU_COMPUTES_NOTHING}</p>
                  {row.thankYou.length > 0 ? (
                    <ul>
                      {row.thankYou.map((entry, index) => (
                        <li key={`${entry.createdAt}-${index}`}>
                          {entry.kind}
                          {entry.amountCents ? ` · ${usd(entry.amountCents)}` : ''} ·{' '}
                          {instant(entry.createdAt)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="helper">Nothing recorded.</p>
                  )}
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      open(
                        event,
                        {
                          kicker: row.publicHandle ?? row.associationId,
                          title: 'Record a thank-you',
                          body: (
                            <>
                              <p>{THANK_YOU_COMPUTES_NOTHING}</p>
                              <p>
                                Recognition needs a reason and nothing else. A payment additionally
                                needs the typed amount, the recorded approval, and all three
                                eligibility facts confirmed.
                              </p>
                            </>
                          ),
                          fields: [
                            {
                              id: 'kind',
                              label: 'Kind',
                              required: true,
                              select: true,
                              options: [
                                { value: 'recognition', label: 'Recognition — no money' },
                                { value: 'payment', label: 'Payment' },
                              ],
                            },
                            {
                              id: 'reason',
                              label: 'Reason',
                              required: true,
                              textarea: true,
                            },
                            {
                              id: 'amountCents',
                              label: 'Amount, in cents',
                              hint: 'Payments only. Nothing here suggests a number.',
                            },
                            { id: 'approvedBy', label: 'Approved by' },
                            { id: 'approvalReference', label: 'Approval reference' },
                            { id: 'taxTreatment', label: 'Tax treatment' },
                            ...view.thankYouEligibilityFacts.map((fact) => ({
                              id: fact.key,
                              label: fact.label,
                              select: true,
                              options: [
                                { value: '', label: 'Not confirmed' },
                                { value: 'yes', label: 'Confirmed' },
                              ],
                            })),
                          ],
                          primary: 'Record it',
                        },
                        async (values) => {
                          await recordThankYou(row.associationId, {
                            kind: values['kind'],
                            reason: values['reason'],
                            amountCents: values['amountCents'] || undefined,
                            approvedBy: values['approvedBy'] || undefined,
                            approvalReference: values['approvalReference'] || undefined,
                            taxTreatment: values['taxTreatment'] || undefined,
                            minimumWorkCompleted: values['minimum_work_completed'] === 'yes',
                            clickThresholdMet: values['click_threshold_met'] === 'yes',
                            brandAupCompliant: values['brand_aup_compliant'] === 'yes',
                          });
                          toast('Recorded');
                          reload();
                        },
                      )
                    }
                  >
                    Record a thank-you
                  </Button>
                </details>
              </li>
            );
          })}
        </ul>
      </MoneySection>

      <MoneySection title="Not on this screen">
        {absencesFor('creators').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>

      {panel}
    </>
  );
}

/* ── §22.3 ──────────────────────────────────────────────────────────────────*/

export function FounderPane({ campaignId, record, reload }: PaneProps) {
  const view = record.founder;
  const { open, act, panel, toast } = useDecision(reload);

  if (!view) {
    return (
      <MoneySection title="No Founder payment record yet">
        <Nothing>
          This campaign has no locked type or has not closed. The W-9 is requested when the close
          batch completes and something was captured — a tax form behind no payment is a burden
          nothing justifies.
        </Nothing>
      </MoneySection>
    );
  }

  const { status } = view;

  if (!status.applicable) {
    return (
      <MoneySection title="No Founder payment is due">
        <Nothing>{status.notApplicableReason ?? 'Nothing was captured on this campaign.'}</Nothing>
      </MoneySection>
    );
  }

  return (
    <>
      <MoneySection title="The W-9" lede={status.w9.line}>
        <Facts>
          <Fact label="State">
            <Pill
              label={status.w9.state}
              tone={status.w9.state === 'verified' ? 'ok' : status.w9.blocksPayments ? 'risk' : 'wait'}
              small
            />
          </Fact>
          <Fact label="Requested">{instant(status.w9.requestedAt)}</Fact>
          <Fact label="Submitted">{instant(status.w9.submittedAt)}</Fact>
          <Fact label="Verified">{instant(status.w9.verifiedAt)}</Fact>
          {status.w9.returnReason ? (
            <Fact label="Returned because">{status.w9.returnReason}</Fact>
          ) : null}
        </Facts>
        <Pinned>{W9_REFERENCE_NEVER_HOLDS_A_TIN}</Pinned>

        <div className="mny-acts">
          <Button
            tier="secondary"
            small
            onClick={() => void act(() => requestW9(campaignId), 'W-9 requested')}
          >
            Request the W-9
          </Button>
          <Button
            tier="secondary"
            small
            onClick={(event) =>
              open(
                event,
                {
                  kicker: 'W-9',
                  title: 'Record that the form arrived',
                  body: <p>{W9_REFERENCE_NEVER_HOLDS_A_TIN}</p>,
                  fields: [
                    {
                      id: 'reference',
                      label: 'Where the form is kept',
                      required: true,
                      hint: 'A location, never a number. A value shaped like an SSN or EIN is refused.',
                    },
                  ],
                  primary: 'Record receipt',
                },
                async (values) => {
                  await recordW9Submitted(campaignId, values['reference'] ?? '');
                  toast('Receipt recorded');
                  reload();
                },
              )
            }
          >
            Record receipt
          </Button>
          <Button
            tier="secondary"
            small
            onClick={(event) =>
              open(
                event,
                {
                  kicker: 'W-9',
                  title: 'Decide the W-9',
                  body: (
                    <p>
                      Verifying is one-way — payments are released on its basis. A return needs the
                      reason the Founder will read.
                    </p>
                  ),
                  fields: [
                    {
                      id: 'decision',
                      label: 'Decision',
                      required: true,
                      select: true,
                      options: [
                        { value: 'verified', label: 'Verified' },
                        { value: 'resubmission_required', label: 'Return it for resubmission' },
                      ],
                    },
                    { id: 'note', label: 'Note', required: true, textarea: true },
                  ],
                  primary: 'Record the decision',
                },
                async (values) => {
                  await decideW9(campaignId, {
                    decision: values['decision'] === 'verified' ? 'verified' : 'resubmission_required',
                    note: values['note'] ?? '',
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

      <MoneySection title="The eligible share" lede={status.eligibleShare.note}>
        <Facts wide>
          <Fact label="Eligible share">
            <Amount
              cents={status.eligibleShare.amountCents}
              waitingOn="Nothing captured"
              approximate={!status.eligibleShare.exact}
            />
          </Fact>
          <Fact label="Captured reward subtotal">
            <Amount
              cents={status.eligibleShare.basis.rewardSubtotalCapturedCents}
              waitingOn="Nothing captured"
            />
          </Fact>
          <Fact label="Proovd 5%">
            <Amount cents={status.eligibleShare.basis.proovdFeeCents} waitingOn="—" />
          </Fact>
          <Fact label="Finalized Creator compensation">
            <Amount
              cents={status.eligibleShare.basis.finalizedCreatorCompensationCents}
              waitingOn="Not finalized"
            />
          </Fact>
          <Fact label="Cause-based adjustments">
            <Amount cents={status.eligibleShare.basis.causeBasedAdjustmentsCents} waitingOn="—" />
          </Fact>
          <Fact label="Stripe fees allocated">
            <Amount
              cents={status.eligibleShare.basis.stripeFeesAllocatedToFounderCents}
              waitingOn="—"
            />
          </Fact>
        </Facts>
      </MoneySection>

      <MoneySection
        title="Payments"
        lede={
          status.model === 'idea'
            ? 'An Idea campaign has one payment.'
            : 'A Product campaign pays 40% and then the remainder.'
        }
      >
        {status.payments.length === 0 ? (
          <Nothing>No payment object exists yet.</Nothing>
        ) : (
          <ul className="mny-rows mny-rows--flat">
            {status.payments.map((line) => (
              <li key={line.kind} className="mny-payment">
                <span className="mny-row__lead">
                  <Pill
                    label={line.status}
                    tone={
                      line.status === 'released' ? 'ok' : line.status === 'eligible' ? 'wait' : 'risk'
                    }
                    small
                  />
                  <strong>{line.label}</strong>
                </span>
                <Facts>
                  <Fact label="Amount">
                    <Amount
                      cents={line.amountCents}
                      waitingOn="Not computed"
                      approximate={!line.amountExact}
                    />
                  </Fact>
                  <Fact label="Share">{line.percent}%</Fact>
                  <Fact label="Due">{instant(line.dueAt)}</Fact>
                  <Fact label="Released">
                    {line.releasedAt ? (
                      <>
                        {instant(line.releasedAt)}
                        {line.releasedEarly ? (
                          <span className="mny-fact__note">Released early</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="grey">Not released</span>
                    )}
                  </Fact>
                </Facts>
                {line.blockers.length > 0 ? (
                  <ul className="mny-blockers">
                    {line.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
                {line.secureAction ? <p className="helper">{line.secureAction}</p> : null}
                {line.noActionNeeded ? <p className="helper">No action needed.</p> : null}

                {/*
                  The acts render the line's own state.

                  A RELEASED payment offers nothing: there is nothing left to do
                  and manufacturing a control would be §20's caught-up rule
                  broken on a money screen. A BLOCKED one still offers both —
                  the server decides, and §1.1 is that a disabled button is not
                  authorization — but Release is not the prominent one, because
                  the blockers are printed directly above it and the most
                  emphasised control on a blocked line is an invitation.
                */}
                {line.status === 'released' ? null : (
                <div className="mny-acts">
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      open(
                        event,
                        {
                          kicker: line.label,
                          title: 'Create the payment object',
                          body: (
                            <p>
                              An Idea single payment additionally needs the recorded payment and
                              risk checks and a named approver. The service refuses without them.
                            </p>
                          ),
                          fields: [
                            { id: 'checksNote', label: 'Payment and risk checks', textarea: true },
                            { id: 'approvedBy', label: 'Approved by' },
                          ],
                          primary: 'Create it',
                        },
                        async (values) => {
                          await createFounderPayment(campaignId, {
                            kind: line.kind,
                            checksNote: values['checksNote'] || undefined,
                            approvedBy: values['approvedBy'] || undefined,
                          });
                          toast('Payment created');
                          reload();
                        },
                      )
                    }
                  >
                    Create
                  </Button>
                  <Button
                    tier={line.status === 'eligible' ? 'primary' : 'secondary'}
                    small
                    onClick={() =>
                      void act(
                        () => releaseFounderPayment(campaignId, line.kind),
                        'Released',
                        'The Founder has been told.',
                      )
                    }
                  >
                    Release
                  </Button>
                </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {status.day14 ? (
          <Pinned>
            {status.day14.line} — {instant(status.day14.dueAt)}
          </Pinned>
        ) : null}
        {status.nextReviewDate ? (
          <p className="helper">Next review: {instant(status.nextReviewDate)}</p>
        ) : null}
      </MoneySection>

      {status.earlyRelease ? (
        <MoneySection
          title="Early release of the remaining payment"
          lede={
            status.earlyRelease.settingEnabled
              ? 'Four proofs, all of them, and only then the decision.'
              : 'The setting that permits this is disabled, so the decision is refused whatever is recorded.'
          }
        >
          <Pinned>{status.earlyRelease.neverSkipsDay14}</Pinned>
          <Facts>
            <Fact label="Evidence recorded">
              {status.earlyRelease.evidence ? (
                instant(status.earlyRelease.evidence.recordedAt)
              ) : (
                <span className="grey">Nothing recorded</span>
              )}
            </Fact>
            <Fact label="Still missing">
              {status.earlyRelease.evidence?.missingFacts.length
                ? status.earlyRelease.evidence.missingFacts.join(', ')
                : status.earlyRelease.evidence
                  ? 'Nothing'
                  : '—'}
            </Fact>
            <Fact label="Founder request">
              {status.earlyRelease.pendingRequest ? (
                instant(status.earlyRelease.pendingRequest.createdAt)
              ) : (
                <span className="grey">None pending</span>
              )}
            </Fact>
          </Facts>

          <div className="mny-acts">
            <Button
              tier="secondary"
              small
              onClick={(event) =>
                open(
                  event,
                  {
                    kicker: 'Early release',
                    title: 'Record the evidence',
                    body: (
                      <p>
                        Each answer needs its detail. Internal readiness alone is not proof that
                        anything reached a Backer.
                      </p>
                    ),
                    fields: view.evidenceFacts.flatMap((fact) => [
                      {
                        id: `${fact.key}__recorded`,
                        label: fact.label,
                        select: true,
                        options: [
                          { value: '', label: 'Not established' },
                          { value: 'yes', label: 'Established' },
                        ],
                        ...(fact.note ? { hint: fact.note } : {}),
                      },
                      { id: `${fact.key}__detail`, label: 'Evidence', textarea: true },
                    ]),
                    primary: 'Record it',
                  },
                  async (values) => {
                    const facts: Record<string, { recorded: boolean; detail: string }> = {};
                    for (const fact of view.evidenceFacts) {
                      facts[fact.key] = {
                        recorded: values[`${fact.key}__recorded`] === 'yes',
                        detail: values[`${fact.key}__detail`] ?? '',
                      };
                    }
                    await recordEarlyReleaseEvidence(campaignId, facts);
                    toast('Evidence recorded');
                    reload();
                  },
                )
              }
            >
              Record evidence
            </Button>
            <Button
              tier="secondary"
              small
              onClick={(event) =>
                open(
                  event,
                  {
                    kicker: 'Early release',
                    title: 'Decide the request',
                    body: <p>{status.earlyRelease?.neverSkipsDay14}</p>,
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
                    await decideEarlyRelease(campaignId, {
                      decision: values['decision'] === 'approved' ? 'approved' : 'declined',
                      reason: values['reason'] ?? '',
                    });
                    toast('Decision recorded');
                    reload();
                  },
                )
              }
            >
              Decide the request
            </Button>
          </div>
        </MoneySection>
      ) : null}

      <MoneySection title="Not on this screen">
        {absencesFor('founder').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>

      {panel}
    </>
  );
}
