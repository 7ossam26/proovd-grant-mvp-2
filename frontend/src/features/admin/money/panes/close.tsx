/**
 * The §21 close batch, and the §21 reconciliation that follows it.
 *
 * ── Resume is the only control on the batch, and it is not a repair ─────────
 * `runCloseBatch` + `endRetryWindow` are the pair the scheduled sweep runs, and
 * pressing this runs exactly them. §33.7.12's guarantee — "retry does not
 * double-charge or duplicate receipts" — is the stable attempt keys and the
 * per-entity dedups, not this button being careful, and the pinned sentence
 * beside it says so. Anything that framed this as a repair would invite
 * somebody to add a confirmation step implying the opposite.
 *
 * ── The threshold decision is rendered and not editable ─────────────────────
 * It was taken from the state at exactly close and migration 0028 refuses to
 * move it. There is no control, and the refusal that would have been one is
 * rendered in its place.
 *
 * ── Reconciliation records an answer; it does not compute one ───────────────
 * Each item's `derived` block is what the app's own records show — that is the
 * evidence a person checks against. The verification is theirs, it needs a
 * non-blank note (§1.3), and it is insert-only: a discrepancy later resolved is
 * a NEW row and both answers survive.
 */

import { useState, type MouseEvent } from 'react';
import {
  MONEY_OPERATIONS_ABSENCES,
  RECONCILIATION_WAITS_FOR_THE_WINDOW,
  RESUME_IS_THE_SAME_MACHINE,
  THRESHOLD_DECISION_IS_FROZEN,
} from '@proovd/shared';
import { Button, useToast } from '../../../../components/index.js';
import { ConfirmDialog, type DialogSpec, type DialogValues } from '../../founders/dialogs/ConfirmDialog.js';
import { AdminRequestError, prepareResults, recordReconciliation, resumeBatch } from '../api.js';
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
  humanKey,
  instant,
  withoutCitation,
} from '../shared.js';

const absencesFor = (tab: string) => MONEY_OPERATIONS_ABSENCES.filter((a) => a.tab === tab);

/* ── The batch ──────────────────────────────────────────────────────────────*/

export function ClosePane({ campaignId, record, reload }: PaneProps) {
  const { detail } = record.close;
  const batch = detail.batch;
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function resume() {
    setBusy(true);
    try {
      await resumeBatch(campaignId);
      toast('The batch was resumed', {
        sub: 'Every capture retried under the key it was first claimed with.',
      });
      reload();
    } catch (error) {
      toast(
        error instanceof AdminRequestError
          ? error.detail.whatHappened ?? error.detail.title
          : 'Nothing was changed, and it is not certain why the resume did not run.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!batch) {
    return (
      <MoneySection title="No close batch">
        <Nothing>
          This campaign has not closed. The batch is created when the close anchor arrives, and
          nothing on this tab exists until then.
        </Nothing>
      </MoneySection>
    );
  }

  const incomplete = batch.completedAt === null;
  const windowOpen = batch.retryDeadlineAt !== null && new Date(batch.retryDeadlineAt) > new Date();

  return (
    <>
      <MoneySection
        title="The batch"
        lede="One batch per campaign. Running it again resumes it — it never restarts."
        aside={
          <Button tier="primary" small onClick={() => void resume()} disabled={busy}>
            {busy ? 'Resuming…' : 'Resume the batch'}
          </Button>
        }
      >
        <Facts wide>
          <Fact label="Status">
            <Pill label={batch.status} tone={incomplete ? 'risk' : 'ok'} small />
          </Fact>
          <Fact label="Started">{instant(batch.startedAt)}</Fact>
          <Fact label="Completed">
            {batch.completedAt ? (
              instant(batch.completedAt)
            ) : (
              <span className="grey">Still running — reservations are locked and safe</span>
            )}
          </Fact>
          <Fact label="Retry window">{batch.retryWindowHours} hours from the first failure</Fact>
          <Fact label="First failure">{instant(batch.firstFailureAt)}</Fact>
          <Fact label="Window closes">
            {batch.retryDeadlineAt ? (
              instant(batch.retryDeadlineAt)
            ) : (
              <span className="grey">No card has failed</span>
            )}
          </Fact>
        </Facts>
        <Pinned>{RESUME_IS_THE_SAME_MACHINE}</Pinned>
        {windowOpen ? (
          <Pinned>
            A recovery inside the window counts as captured. Anything still failing when it shuts
            closes at US$0.00, and nothing about that is reversible afterwards.
          </Pinned>
        ) : null}
      </MoneySection>

      <MoneySection
        title="The threshold decision"
        lede="Decided once, from the state at exactly close."
      >
        {batch.thresholdDecision ? (
          <Facts>
            <Fact label="Outcome">
              <Pill
                label={batch.thresholdDecision.met ? 'Threshold met' : 'Threshold not met'}
                tone={batch.thresholdDecision.met ? 'ok' : 'off'}
                small
              />
            </Fact>
            <Fact label="Unique Backers at close">{batch.thresholdDecision.unique}</Fact>
            <Fact label="Required">{batch.thresholdDecision.required}</Fact>
          </Facts>
        ) : (
          <Nothing>
            No threshold decision was recorded. A Product campaign has no public funding gate, and
            an Idea campaign records one the moment its batch reaches that step.
          </Nothing>
        )}
        <Pinned>{THRESHOLD_DECISION_IS_FROZEN}</Pinned>
      </MoneySection>

      <MoneySection
        title="Pre-orders by state"
        lede="Where every reservation on this campaign now stands."
      >
        {Object.keys(detail.reservationsByStatus).length === 0 ? (
          <Nothing>No pre-order on this campaign has reached the close batch.</Nothing>
        ) : (
          <Facts wide codes>
            {Object.entries(detail.reservationsByStatus).map(([status, count]) => (
              <Fact key={status} label={status}>
                {count}
              </Fact>
            ))}
          </Facts>
        )}
      </MoneySection>

      <MoneySection
        title="Capture attempts"
        lede="Every attempt, with the idempotency key it was claimed under before the provider was called."
      >
        {detail.attempts.length === 0 ? (
          <Nothing>No capture has been attempted on this campaign.</Nothing>
        ) : (
          <ul className="mny-rows mny-rows--flat">
            {detail.attempts.map((attempt) => (
              <li key={attempt.idempotencyKey} className="mny-attempt">
                <span className="mny-row__lead">
                  <Pill
                    label={attempt.outcome ?? 'Unresolved'}
                    tone={
                      attempt.outcome === 'succeeded'
                        ? 'ok'
                        : attempt.outcome === null
                          ? 'risk'
                          : 'wait'
                    }
                    small
                  />
                  <strong>Attempt {attempt.attemptNumber}</strong>
                </span>
                <Facts>
                  <Fact label="Amount">
                    <Amount cents={attempt.amountCents} waitingOn="Not recorded" />
                  </Fact>
                  <Fact label="Pre-order">{attempt.reservationId}</Fact>
                  <Fact label="Requested">{instant(attempt.requestedAt)}</Fact>
                  <Fact label="Resolved">
                    {attempt.resolvedAt ? (
                      instant(attempt.resolvedAt)
                    ) : (
                      <span className="grey">
                        In flight — a resume finishes it under this same key
                      </span>
                    )}
                  </Fact>
                  {/* §25.6: the key and the provider id are internal detail an
                      Admin needs and no customer message ever carries. */}
                  <Fact label="Idempotency key">
                    <code>{attempt.idempotencyKey}</code>
                  </Fact>
                  <Fact label="PaymentIntent">
                    {attempt.paymentIntentId ? (
                      <code>{attempt.paymentIntentId}</code>
                    ) : (
                      <span className="grey">None — the provider was never called</span>
                    )}
                  </Fact>
                </Facts>
              </li>
            ))}
          </ul>
        )}
      </MoneySection>

      <MoneySection title="Not on this screen">
        {absencesFor('close').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>
    </>
  );
}

/* ── Reconciliation and results ─────────────────────────────────────────────*/

export function ReconciliationPane({ campaignId, record, reload }: PaneProps) {
  const reconciliation = record.close.reconciliation;
  const [dialog, setDialog] = useState<{ spec: DialogSpec; submit: (v: DialogValues) => Promise<void> } | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const toast = useToast();

  if (!reconciliation) {
    return (
      <MoneySection title="Nothing to reconcile">
        <Nothing>This campaign has no close record yet.</Nothing>
      </MoneySection>
    );
  }

  function open(event: MouseEvent<HTMLElement>, spec: DialogSpec, submit: (v: DialogValues) => Promise<void>) {
    setTrigger(event.currentTarget);
    setDialog({ spec, submit });
  }

  const required = reconciliation.items.filter((item) => item.requiredForResults);
  const requiredVerified = required.filter((item) => item.latest?.result === 'verified');

  return (
    <>
      {!reconciliation.open ? (
        <MoneySection title="Reconciliation is not open yet">
          <Nothing>{reconciliation.openReason ?? RECONCILIATION_WAITS_FOR_THE_WINDOW}</Nothing>
          <Pinned>{RECONCILIATION_WAITS_FOR_THE_WINDOW}</Pinned>
        </MoneySection>
      ) : null}

      <MoneySection
        title="The nine items"
        lede={`${requiredVerified.length} of ${required.length} items required for results are verified. The other five are recorded for the file and do not gate anything.`}
      >
        <ul className="mny-rows mny-rows--flat">
          {reconciliation.items.map((item) => (
            <li key={item.key} className="mny-item">
              <span className="mny-row__lead">
                <Pill
                  label={
                    item.latest
                      ? item.latest.result === 'verified'
                        ? 'Verified'
                        : 'Discrepancy'
                      : 'Not checked'
                  }
                  tone={
                    item.latest
                      ? item.latest.result === 'verified'
                        ? 'ok'
                        : 'risk'
                      : 'wait'
                  }
                  small
                />
                {item.requiredForResults ? <Pill label="Required for results" tone="wait" small /> : null}
              </span>
              <p className="mny-item__spec">{withoutCitation(item.spec)}</p>

              {item.waitsOn ? (
                <p className="helper">Waiting on: {item.waitsOn}</p>
              ) : null}

              {item.derived ? (
                <Facts>
                  {Object.entries(item.derived).map(([key, value]) => (
                    <Fact key={key} label={humanKey(key)}>
                      {typeof value === 'object' && value !== null
                        ? JSON.stringify(value)
                        : String(value)}
                    </Fact>
                  ))}
                </Facts>
              ) : (
                <p className="helper">
                  The app derives nothing for this item — it is a person’s judgement against the
                  records named above.
                </p>
              )}

              {item.latest ? (
                <p className="mny-item__latest">
                  <strong>{item.latest.actor}</strong> · {instant(item.latest.recordedAt)} —{' '}
                  {item.latest.note}
                </p>
              ) : null}

              {item.history.length > 1 ? (
                <details className="mny-item__history">
                  <summary>{item.history.length} recorded answers</summary>
                  <ul>
                    {item.history.map((entry, index) => (
                      <li key={`${entry.recordedAt}-${index}`}>
                        {entry.result} · {entry.actor} · {instant(entry.recordedAt)} — {entry.note}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <Button
                tier="secondary"
                small
                disabled={!reconciliation.open}
                onClick={(event) =>
                  open(
                    event,
                    {
                      kicker: `Reconciliation · ${item.key}`,
                      title: 'Record what you checked',
                      body: (
                        <>
                          <p>{withoutCitation(item.spec)}</p>
                          <p>
                            This is recorded and kept. A discrepancy resolved later is recorded
                            again, and both answers remain.
                          </p>
                        </>
                      ),
                      fields: [
                        {
                          id: 'result',
                          label: 'Result',
                          required: true,
                          select: true,
                          options: [
                            { value: 'verified', label: 'Verified — the records agree' },
                            { value: 'discrepancy', label: 'Discrepancy — they do not' },
                          ],
                        },
                        {
                          id: 'note',
                          label: 'What you checked',
                          required: true,
                          textarea: true,
                          hint: 'Recorded with your name and the time. A result with no note is refused.',
                        },
                      ],
                      primary: 'Record it',
                    },
                    async (values) => {
                      await recordReconciliation(campaignId, {
                        itemKey: item.key,
                        result: values['result'] ?? '',
                        note: values['note'] ?? '',
                      });
                      toast('Recorded');
                      reload();
                    },
                  )
                }
              >
                Record a verification
              </Button>
            </li>
          ))}
        </ul>
      </MoneySection>

      <MoneySection
        title="Results"
        lede="The Founder sees every §21 number computed live. What is recorded here is the narrative beside them — which is Admin-authored, because the product does not invent causality."
      >
        {reconciliation.resultsPrepared ? (
          <>
            <Pill label="Prepared and sent" tone="ok" />
            <Nothing>
              The Founder has been told. Results cannot be unsent — a correction is a new record
              rather than an erasure.
            </Nothing>
          </>
        ) : (
          <>
            <Nothing>
              Not prepared. Preparation needs the charge outcomes final, the four required items
              verified, and all five narrative fields written.
            </Nothing>
            <Button
              tier="primary"
              small
              disabled={!reconciliation.open}
              onClick={(event) =>
                open(
                  event,
                  {
                    kicker: 'Results',
                    title: 'Prepare the results',
                    body: (
                      <p>
                        Five fields, all required. They are what the Founder reads beside the
                        numbers, so each says something a person concluded rather than something
                        the product inferred.
                      </p>
                    ),
                    fields: [
                      { id: 'strongestSignal', label: 'Strongest signal', required: true, textarea: true },
                      { id: 'weakestSignal', label: 'Weakest signal', required: true, textarea: true },
                      {
                        id: 'leadingSurveyReason',
                        label: 'Leading survey reason',
                        required: true,
                        textarea: true,
                      },
                      {
                        id: 'whatThisProves',
                        label: 'What this result proves',
                        required: true,
                        textarea: true,
                      },
                      {
                        id: 'whatThisDoesNotProve',
                        label: 'What this result does not prove',
                        required: true,
                        textarea: true,
                        hint: 'The field a results page is least likely to have and most needs.',
                      },
                    ],
                    primary: 'Prepare and send',
                  },
                  async (values) => {
                    await prepareResults(campaignId, values);
                    toast('Results prepared', { sub: 'The Founder has been told.' });
                    reload();
                  },
                )
              }
            >
              Prepare results
            </Button>
          </>
        )}
      </MoneySection>

      <MoneySection title="Not on this screen">
        {absencesFor('reconciliation').map((absence) => (
          <Absence key={absence.key} control={absence.control} sentence={absence.sentence} />
        ))}
      </MoneySection>

      {dialog ? (
        <ConfirmDialog
          spec={dialog.spec}
          trigger={trigger}
          onSubmit={dialog.submit}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
