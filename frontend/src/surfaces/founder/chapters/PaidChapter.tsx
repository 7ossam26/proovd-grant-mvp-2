/**
 * Chapter 3, Get paid — Founder Dashboard Session E.
 *
 * The campaign has closed. §21's retry window is running or has run, §22.3's
 * W-9 and payment schedule decide when money reaches the Founder, §22.4's Day
 * 14 Progress Check sits between the two Product payments, and §22.5's four
 * obligations run from the charge to delivery.
 *
 * It absorbs `/campaigns/:campaignId/results` (Phase 18b) and
 * `/campaigns/:campaignId/fulfillment` (Phase 21a) whole; both addresses now
 * redirect here. Two Founder surfaces over one campaign's money would be two
 * places to read an amount — the reasoning that retired `/roster` into Chapter
 * 1 and `/updates` into Chapter 2.
 *
 * ── Nothing here does arithmetic on money ─────────────────────────────────
 * §33.8.13 is one source and many renderers. `readFounderPaymentStatus` is the
 * only place §22.3's status is composed, and the Admin queue reads the same
 * view — so a figure on this page arrived resolved. There is no `+`, no `-`,
 * no `*`, and no percentage taken of anything in this file, and Session E's
 * suite scans the source for exactly that.
 *
 * The reference computes `net = gross − aff − proovd` in the browser and then
 * splits it `Math.round(net*.4)` / `Math.round(net*.6)`. Beyond being a mock,
 * it drops two of §22.3's five subtracted terms and makes the remaining
 * payment an independent floor rather than the exact remainder (§33.8.11).
 *
 * ── There is no payment request, and that is the largest refusal ──────────
 * The reference's spine is `Request payment` → `In review` → `Paid ✓`. §22.3
 * creates each payment on its own §6 day and releases it on Proovd's recorded
 * decision; the ONE ask a Founder makes is the early remaining release, which
 * is Product-only, behind a §6 setting that ships disabled, and gated on four
 * recorded proofs. A request button would tell a Founder their money is
 * waiting on them when it is not (§1.4).
 *
 * ── The Day 14 clarification finally has somewhere to answer ──────────────
 * `POST …/day-14/clarification` shipped with Phase 21a and had no client. The
 * old surface rendered the question, said that not answering inside five
 * business days is one of the things that fails the review, and offered no
 * control — on a review whose failure blocks a payment.
 *
 * ── The panels are inline rather than modal ───────────────────────────────
 * Sessions C and D's reasoning, unchanged: every form here can be refused by
 * the server, and `Modal` closes on its own primary action.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CLARIFICATION_IS_ANSWERED_HERE,
  DAY_14_IS_ANCHORED_ON_CLOSE,
  DAY_14_RECEIPT_IS_KEPT,
  EARLY_RELEASE_NEVER_SKIPS_DAY_14,
  NO_PAYMENT_REQUEST,
  OBLIGATIONS_ARE_RECORDED_NOT_THREATENED,
  PAID_ABSENCES,
  REMAINING_IS_THE_EXACT_REMAINDER,
  RETRY_WINDOW_IS_STORED,
  RETRY_WINDOW_OUTCOME,
  W9_IS_NOT_UPLOADED_HERE,
  W9_NO_ACTION_NEEDED,
  formatUsd,
  paidAbsence,
} from '@proovd/shared';
import {
  Accordion,
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stat,
  Tag,
  Textarea,
} from '../../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../../features/public/states.js';
import {
  applyDeliveryRevision,
  fetchCampaignResults,
  fetchDay14,
  fetchFounderPayments,
  fetchFulfillment,
  recordDelivery,
  recordOriginalCommitment,
  requestDeliveryChange,
  requestEarlyRemainingRelease,
  respondToDay14Clarification,
  setDeliveryMechanism,
  submitDay14Evidence,
  FounderRequestError,
  type Day14ChecklistView,
  type FounderPaymentStatusView,
  type FounderResultsView,
  type FulfillmentStatusView,
} from '../api.js';

/* ── Small shared helpers ─────────────────────────────────────────────────── */

/**
 * The one place cents become words. `formatUsd` is the shared kernel every
 * money surface in the product renders through; this only widens a string to
 * the bigint it already is. It is a FORMAT, not a computation — nothing here
 * combines two amounts.
 */
const usd = (cents: string): string => formatUsd(BigInt(cents));

/** §27.1: local, with UTC beside it wherever the moment is a deadline. */
function deadline(iso: string | null): string {
  if (!iso) return 'a date Proovd has not set yet';
  const at = new Date(iso);
  return `${at.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })} (${at.toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
}

function localDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : 'The request did not complete. Nothing was changed.';
}

/** The register's own sentence, where the reference put a control. */
function Absence({ id }: { id: string }) {
  return <p className="fd-absence">{paidAbsence(id).sentence}</p>;
}

/* ── The chapter ──────────────────────────────────────────────────────────── */

export function PaidChapter({ campaignId }: { campaignId: string }) {
  const [results, setResults] = useState<FounderResultsView | null>(null);
  const [payments, setPayments] = useState<FounderPaymentStatusView | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentStatusView | null>(null);
  const [day14, setDay14] = useState<Day14ChecklistView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
    Four reads, one round trip's worth of latency. `results` is the only one
    that must succeed: it names the campaign and carries §21's own numbers, and
    without it there is no chapter. The other three answer 404 on a campaign
    that has not reached their part of the lifecycle, which is a state rather
    than a failure — a campaign in the retry window has no Day 14 record, and
    saying so is not the same as the page being broken (§1.4).
  */
  const load = useCallback(async () => {
    try {
      const [resultsResult, paymentsResult, fulfillmentResult, day14Result] = await Promise.all([
        fetchCampaignResults(campaignId),
        fetchFounderPayments(campaignId).catch(() => null),
        fetchFulfillment(campaignId).catch(() => null),
        fetchDay14(campaignId).catch(() => null),
      ]);
      setResults(resultsResult.results);
      setPayments(paymentsResult?.payments ?? null);
      setFulfillment(fulfillmentResult ?? null);
      setDay14(day14Result ?? null);
      setFailure(null);
    } catch (caught: unknown) {
      setFailure(refusalText(caught, 'Your campaign’s money could not be loaded.'));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <Section aria-labelledby="fd-paid-error">
        <Measure>
          <h1 className="h2" id="fd-paid-error">
            We could not load your money
          </h1>
          <StatePanel
            state="We could not load your money"
            whatHappened={failure}
            next="Reload the page. Every figure here is worked out from your record when you open it, so nothing was lost and nothing has changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Get paid — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  if (!results) return <SurfaceLoading subject="your money" reference={campaignId} />;

  return (
    <Section aria-labelledby="fd-paid-title">
      <Measure>
        <p className="kicker">{results.campaignTitle}</p>
        {/* §33.11.2: one `h1`, and the money figure below it is not a title. */}
        <h1 className="h2" id="fd-paid-title">
          Get paid
        </h1>

        <RetryWindowPanel results={results} />
        <PaymentsPanel
          campaignId={campaignId}
          payments={payments}
          onChanged={() => void load()}
        />
        <ResultsPanel results={results} />
        {fulfillment ? (
          <ObligationsPanel
            campaignId={campaignId}
            fulfillment={fulfillment}
            onChanged={() => void load()}
          />
        ) : null}
        {day14 ? (
          <Day14Panel campaignId={campaignId} day14={day14} onChanged={() => void load()} />
        ) : null}
      </Measure>
    </Section>
  );
}

/* ── §21: the retry window ────────────────────────────────────────────────── */

/**
 * The window is a stored fact in three columns and the surface renders all
 * three. The reference calls it a "Three-day card retry window" and then
 * reuses those three days as the payout gate; both halves are wrong on any
 * deployment whose §6 settings differ from the mock's.
 */
function RetryWindowPanel({ results }: { results: FounderResultsView }) {
  const window = results.retryWindow;

  return (
    <Card className="fd-paid__retry">
      <h2 className="h3">Card retries</h2>

      {window === null ? (
        <p>
          Your campaign has not been through its close batch yet. Nothing has been charged and
          there is nothing to retry.
        </p>
      ) : window.state === 'not_opened' ? (
        <p>
          No card failed at close, so the retry window never opened. Your charge outcomes were
          final the day your campaign closed.
        </p>
      ) : (
        <>
          <p>
            {window.state === 'open'
              ? `Some cards did not go through at close, so Proovd is retrying them. This window ends ${deadline(window.deadlineAt)}.`
              : `The retry window ran from ${localDate(window.firstFailureAt)} and has ended. Your charge outcomes are final.`}
          </p>
          <p className="fd-note">{RETRY_WINDOW_OUTCOME}</p>
          <Absence id="three_day_retry" />
        </>
      )}

      <dl className="fd-paid__counts">
        <div>
          <dt>Charged</dt>
          <dd>{results.preorders.captured}</dd>
        </div>
        <div>
          <dt>Failed at close</dt>
          <dd>{results.payments.failed}</dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd>{results.payments.recovered}</dd>
        </div>
        <div>
          <dt>Closed at US$0.00</dt>
          <dd>{results.payments.dropped}</dd>
        </div>
      </dl>
    </Card>
  );
}

/* ── §22.3: the W-9 and the payment schedule ──────────────────────────────── */

/**
 * Every line here comes from `readFounderPaymentStatus`, the ONE resolver the
 * Admin queue also renders. §22.3's six facts — the exact amount affected, the
 * requirement or blocker by name, the secure action, the submitted/verified
 * state, the next review date, and `No action needed` while under review — are
 * all on the view; this renders them.
 */
function PaymentsPanel({
  campaignId,
  payments,
  onChanged,
}: {
  campaignId: string;
  payments: FounderPaymentStatusView | null;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!payments) {
    return (
      <Card className="fd-paid__payments">
        <h2 className="h3">Your payment</h2>
        <p>
          Your payment schedule appears once your campaign has closed and its charges have been
          counted.
        </p>
      </Card>
    );
  }

  if (!payments.applicable) {
    return (
      <Card className="fd-paid__payments">
        <h2 className="h3">Your payment</h2>
        <p>{payments.notApplicableReason}</p>
      </Card>
    );
  }

  const remaining = payments.payments.find((p) => p.kind === 'remaining_payment');
  const first = payments.payments.find((p) => p.kind === 'first_payment');
  const early = payments.earlyRelease;
  /*
    Four conditions, all of them read from the view. There is no arithmetic and
    no derived eligibility: `applyEarlyRelease` re-decides every one of them
    server-side and refuses by name, so this only decides whether to offer the
    control (§1.1 — a rendered control is not authorization).
  */
  const canAskEarly =
    payments.model === 'product' &&
    early !== null &&
    early.settingEnabled &&
    early.pendingRequest === null &&
    first?.status === 'released' &&
    remaining?.status !== 'released' &&
    !sent;

  async function askEarly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);
    try {
      await requestEarlyRemainingRelease(campaignId, message);
      setSent(true);
      setMessage('');
      onChanged();
    } catch (caught: unknown) {
      setRefusal(refusalText(caught, 'Your request was not recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="fd-paid__payments">
      <h2 className="h3">Your payment</h2>

      {/* ── The hero: the eligible share, resolved (§22.3, §33.8.13) ─────── */}
      <Stat
        variant="white"
        brandValue
        value={usd(payments.eligibleShare.amountCents)}
        sub={
          payments.eligibleShare.exact
            ? 'your share, once everything is counted'
            : 'your share so far — at minimum, while creator earnings are still being settled'
        }
      />
      <p className="fd-note">{payments.eligibleShare.note}</p>
      <Absence id="net_arithmetic" />

      {/* ── The W-9 (§22.3, §11, §13) ────────────────────────────────────── */}
      <h3 className="h4">Your W-9</h3>
      <p>
        <Tag variant={payments.w9.state === 'verified' ? 'mint' : 'default'}>
          {payments.w9.state === 'not_requested'
            ? 'Not requested yet'
            : payments.w9.state === 'requested'
              ? 'Requested'
              : payments.w9.state === 'submitted'
                ? 'With Proovd'
                : 'Verified'}
        </Tag>
      </p>
      <p>{payments.w9.line}</p>
      {/*
        The brand-ringed block is the SECURE ACTION slot, and §22.3's `action`
        is `No action needed` once the W-9 is verified. Putting that in the
        loud slot shouts the absence of a task at somebody — so the emphasis
        follows whether there is actually something to do.
      */}
      {payments.w9.action === W9_NO_ACTION_NEEDED ? (
        <p className="fd-note">{payments.w9.action}</p>
      ) : (
        <p className="fd-paid__action">{payments.w9.action}</p>
      )}
      <Absence id="w9_upload" />

      {/* ── The schedule (§22.3) ─────────────────────────────────────────── */}
      <h3 className="h4">When each payment lands</h3>
      {payments.model === 'product' ? (
        <p className="fd-note">{REMAINING_IS_THE_EXACT_REMAINDER}</p>
      ) : null}
      <Absence id="payment_request" />
      <Absence id="held_balance" />

      <ul className="fd-paid__schedule">
        {payments.payments.map((payment) => (
          <li key={payment.kind} className="fd-paid__line">
            <p className="fd-paid__linehead">
              <Tag
                variant={
                  payment.status === 'released'
                    ? 'mint'
                    : payment.status === 'eligible'
                      ? 'sage'
                      : 'default'
                }
              >
                {payment.status === 'released'
                  ? 'Paid'
                  : payment.status === 'eligible'
                    ? 'Ready'
                    : 'Waiting on something'}
              </Tag>{' '}
              <strong>{payment.label}</strong> —{' '}
              {payment.amountExact
                ? usd(payment.amountCents)
                : `${usd(payment.amountCents)} at minimum`}
            </p>
            <p className="fd-paid__linemeta">
              {payment.status === 'released' && payment.releasedAt
                ? `Released ${localDate(payment.releasedAt)}${payment.releasedEarly ? ' — early, on recorded evidence' : ''}.`
                : `Due ${localDate(payment.dueAt)}.`}
            </p>
            {payment.status === 'blocked' && payment.blockers.length > 0 ? (
              <ul className="fd-paid__blockers">
                {payment.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            {/*
              Same distinction on the schedule. When §22.3 says no action is
              needed, `secureAction` is a statement of what happens next
              WITHOUT the Founder — so it reads as a note. It only takes the
              action treatment when the payment is genuinely waiting on them.
            */}
            {payment.secureAction ? (
              <p className={payment.noActionNeeded ? 'fd-note' : 'fd-paid__action'}>
                {payment.secureAction}
              </p>
            ) : null}
            {payment.noActionNeeded && !payment.secureAction ? (
              <p className="fd-note">{NO_ACTION}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {payments.nextReviewDate ? (
        <p>Next review: {localDate(payments.nextReviewDate)}.</p>
      ) : null}
      {payments.day14 ? <p className="fd-note">{payments.day14.line}</p> : null}

      {/* ── The one ask §22.3 gives a Founder ────────────────────────────── */}
      {early !== null ? (
        <>
          <h3 className="h4">Asking for the remaining payment early</h3>
          {/*
            §33.8.12, pinned by the shared register and rendered where §22.3
            puts it — beside the ask itself, not under it. An early release
            that reads as "done" is exactly how the Day 14 review gets skipped
            in practice.
          */}
          <p className="fd-note">{EARLY_RELEASE_NEVER_SKIPS_DAY_14}</p>

          {!early.settingEnabled ? (
            <p>Early release is not available on this campaign.</p>
          ) : early.pendingRequest ? (
            <p>
              Your request from {localDate(early.pendingRequest.createdAt)} is with Proovd, which
              decides it against recorded delivery, communication, tax, and risk evidence. You
              will get the decision with its reason. {NO_ACTION}.
            </p>
          ) : sent ? (
            <p role="status">
              Your request was recorded. Proovd decides it on recorded evidence and you will get
              the decision with its reason. {NO_ACTION}.
            </p>
          ) : canAskEarly ? (
            <form className="fd-paid__early" onSubmit={(event) => void askEarly(event)}>
              <Field
                label="What can affected backers already reach?"
                hint="Proof of what people can actually get to, and what you sent them. Being ready internally is not enough on its own."
              >
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                  rows={4}
                  required
                />
              </Field>
              <Button type="submit" disabled={busy || message.trim().length === 0}>
                {busy ? 'Sending…' : 'Ask Proovd'}
              </Button>
              {refusal ? <p role="alert">{refusal}</p> : null}
            </form>
          ) : (
            <p>
              You can ask for this once your first payment has been released and the remaining one
              has not.
            </p>
          )}

          {early.evidence && early.evidence.missingFacts.length > 0 ? (
            <>
              <p className="fd-note">Proovd still has no record of:</p>
              <ul className="fd-paid__blockers">
                {early.evidence.missingFacts.map((fact, index) => (
                  <li key={index}>{fact}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/* ── §21: the results ─────────────────────────────────────────────────────── */

function ResultsPanel({ results }: { results: FounderResultsView }) {
  if (results.state === 'preparing') {
    return (
      <Card className="fd-paid__results">
        <h2 className="h3">Your results</h2>
        <StatePanel
          state="Being prepared"
          whatHappened={results.preparing!.whatHappened}
          next={results.preparing!.whatNext}
          owner="Proovd"
          nextUpdate={
            results.retryWindow?.state === 'open' && results.retryWindow.deadlineAt
              ? `After the retry window ends, ${deadline(results.retryWindow.deadlineAt)}`
              : 'When Proovd has finished reconciling'
          }
          action={NO_ACTION}
          reference={results.campaignId}
          getHelp={{ href: supportMailto(`Results — ${results.campaignId}`) }}
        />
      </Card>
    );
  }

  const narrative = results.narrative!;

  return (
    <Card className="fd-paid__results">
      <h2 className="h3">Your results</h2>

      {results.threshold ? (
        <p>
          {results.threshold.met
            ? `You reached your order threshold — ${results.threshold.uniqueActiveBackers} unique backers against ${results.threshold.required} required.`
            : `You closed below your order threshold — ${results.threshold.uniqueActiveBackers} of ${results.threshold.required} unique backers — so no cards were charged.`}
        </p>
      ) : null}

      <dl className="fd-paid__counts">
        <div>
          <dt>Pre-orders placed</dt>
          <dd>{results.preorders.placed}</dd>
        </div>
        <div>
          <dt>Unique backers</dt>
          <dd>{results.uniqueBackers}</dd>
        </div>
        <div>
          <dt>Reward subtotal charged</dt>
          <dd>{usd(results.money.rewardSubtotalCapturedCents)}</dd>
        </div>
        <div>
          <dt>Sales tax charged</dt>
          <dd>{usd(results.money.salesTaxCapturedCents)}</dd>
        </div>
        <div>
          <dt>Total charged</dt>
          <dd>{usd(results.money.totalCapturedCents)}</dd>
        </div>
      </dl>

      {/* §21's honesty section — Admin-reviewed, never derived (§1 rule 6). */}
      <Accordion
        items={[
          {
            value: 'narrative',
            head: 'What this result means',
            body: (
              <div className="fd-paid__narrative">
                <p>
                  <strong>Strongest signal.</strong> {narrative.strongestSignal}
                </p>
                <p>
                  <strong>Weakest signal.</strong> {narrative.weakestSignal}
                </p>
                <p>
                  <strong>Leading survey reason.</strong> {narrative.leadingSurveyReason}
                </p>
                <p>
                  <strong>What this proves.</strong> {narrative.whatThisProves}
                </p>
                <p>
                  <strong>What this does not prove.</strong> {narrative.whatThisDoesNotProve}
                </p>
                <p className="fd-note">
                  Reviewed by Proovd before it was released to you, so the numbers above are not
                  over-read.
                </p>
              </div>
            ),
          },
          {
            value: 'where',
            head: 'Where the money came from',
            body: (
              <div>
                <dl className="fd-paid__counts">
                  <div>
                    <dt>Through a creator link</dt>
                    <dd>{usd(results.revenueBySource.creatorAttributedCents)}</dd>
                  </div>
                  <div>
                    <dt>Direct and organic</dt>
                    <dd>{usd(results.revenueBySource.directCents)}</dd>
                  </div>
                </dl>
                <p className="fd-note">{results.revenueBySource.note}</p>
                {results.perCreator.length > 0 ? (
                  <ul className="fd-paid__creators">
                    {results.perCreator.map((creator) => (
                      <li key={creator.associationId}>
                        <strong>{creator.handle ?? 'Creator'}</strong> — {creator.clicks} clicks,{' '}
                        {creator.attributedCaptured} charged pre-orders,{' '}
                        {usd(creator.capturedSubtotalCents)} subtotal. Set aside for them:{' '}
                        {usd(creator.provisionalCents)}.
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="fd-note">{results.finalization.note}</p>
              </div>
            ),
          },
          {
            value: 'survey',
            head: 'What backers said',
            body: (
              <div>
                <p>
                  {results.survey.consentedCount} of {results.survey.totalPreorderCount} backers
                  agreed to share their answers with you
                  {results.survey.averageRecommend
                    ? `; they recommend you ${results.survey.averageRecommend} out of 10 on average`
                    : ''}
                  . Answers from backers who did not agree are shown to nobody.
                </p>
                {results.survey.reasons.length > 0 ? (
                  <ul>
                    {results.survey.reasons.map((reason, index) => (
                      <li key={index}>&ldquo;{reason}&rdquo;</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

/* ── §22.5: what the Founder owes their Backers ───────────────────────────── */

const OBLIGATION_TAG: Record<string, 'mint' | 'sage' | 'live' | 'default'> = {
  met: 'mint',
  due: 'sage',
  overdue: 'live',
  not_applicable: 'default',
};

const OBLIGATION_WORD: Record<string, string> = {
  met: 'Done',
  due: 'Due',
  overdue: 'Overdue',
  not_applicable: 'Not applicable',
};

function ObligationsPanel({
  campaignId,
  fulfillment,
  onChanged,
}: {
  campaignId: string;
  fulfillment: FulfillmentStatusView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const original = fulfillment.commitments.find((c) => c.isOriginal) ?? null;

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      onChanged();
    } catch (caught: unknown) {
      setRefusal(refusalText(caught, 'That did not complete, so nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="fd-paid__obligations">
      <h2 className="h3">What you owe your backers</h2>
      <Absence id="ghost_ban_threat" />

      <ul className="fd-paid__oblist">
        {fulfillment.obligations.map((obligation) => (
          <li key={obligation.key} className="fd-paid__ob">
            <p className="fd-paid__obhead">
              <Tag variant={OBLIGATION_TAG[obligation.state] ?? 'default'}>
                {OBLIGATION_WORD[obligation.state] ?? obligation.state}
              </Tag>{' '}
              <strong>{obligation.label}</strong>
            </p>
            <p className="fd-paid__obmeta">{obligation.detail}</p>
            {obligation.dueAt ? (
              <p className="fd-paid__obmeta">Due {deadline(obligation.dueAt)}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {notice ? <p role="status">{notice}</p> : null}
      {refusal ? <p role="alert">{refusal}</p> : null}

      {/* ── The delivery commitment, original first (§22.5, §33.10.2) ────── */}
      <h3 className="h4">What you promised</h3>
      {fulfillment.commitments.length === 0 ? (
        <form
          className="fd-paid__form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(
              () =>
                recordOriginalCommitment(campaignId, {
                  deliveryMonth: String(form.get('deliveryMonth') ?? ''),
                  commitmentText: String(form.get('commitmentText') ?? ''),
                }),
              'Recorded. It is kept from here on — a change is added beside it and never over it.',
            );
          }}
        >
          <p>
            Write down what you promised. This is kept permanently; every later change sits beside
            it rather than replacing it.
          </p>
          <Field label="Delivery month" hint="The month you disclosed, as YYYY-MM.">
            <Input name="deliveryMonth" required placeholder="2026-12" pattern="\d{4}-\d{2}" />
          </Field>
          <Field label="What you promised" hint="In your own words, as a backer read it.">
            <Textarea
              name="commitmentText"
              required
              rows={3}
              defaultValue={fulfillment.disclosedCommitmentSuggestion ?? ''}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            Record what I promised
          </Button>
        </form>
      ) : (
        <ol className="fd-paid__commitments">
          {fulfillment.commitments.map((commitment) => (
            <li key={commitment.sequence} className="fd-paid__commitment">
              <p className="fd-paid__obhead">
                <Tag variant={commitment.isOriginal ? 'default' : 'sage'}>
                  {commitment.isOriginal ? 'Original' : `Change ${commitment.sequence - 1}`}
                </Tag>{' '}
                <strong>{commitment.deliveryMonth}</strong>
              </p>
              <p>{commitment.commitmentText}</p>
              {commitment.reason ? (
                <p className="fd-paid__obmeta">Reason: {commitment.reason}</p>
              ) : null}
              <p className="fd-paid__obmeta">
                {commitment.notifiedBackersAt
                  ? `Backers told ${localDate(commitment.notifiedBackersAt)}.`
                  : commitment.isOriginal
                    ? 'Disclosed on your campaign page.'
                    : 'Not published to backers yet.'}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* ── §22.6's two paths, stated rather than chosen ─────────────────── */}
      {original ? (
        <Accordion
          items={[
            {
              value: 'change-date',
              head: 'Changing the delivery date',
              body: (
                <div>
                  <p>
                    {fulfillment.changePath === 'admin_preapproval'
                      ? 'Your remaining payment has not gone out, so Proovd reviews a date change before your backers are told. We answer within five business days.'
                      : 'Your remaining payment has gone out, so you do not need Proovd’s approval — but you must tell your backers before the month you originally promised has passed. Refund, support, and enforcement rules still apply.'}
                  </p>

                  {fulfillment.pendingChangeRequest ? (
                    <p>
                      A change to {fulfillment.pendingChangeRequest.proposedDeliveryMonth} is with
                      Proovd. We will answer by{' '}
                      {deadline(fulfillment.pendingChangeRequest.reviewDueAt)}. Your backers have
                      not been told — that happens once it is approved.
                    </p>
                  ) : (
                    <form
                      className="fd-paid__form"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const body = {
                          proposedDeliveryMonth: String(form.get('proposedDeliveryMonth') ?? ''),
                          reason: String(form.get('reason') ?? ''),
                          unchangedObligations: String(form.get('unchangedObligations') ?? ''),
                          nextUpdateDate: String(form.get('nextUpdateDate') ?? ''),
                          supportRefundRoute: String(form.get('supportRefundRoute') ?? ''),
                        };
                        if (fulfillment.changePath === 'admin_preapproval') {
                          void run(
                            () => requestDeliveryChange(campaignId, body),
                            'Sent to Proovd. Your backers have not been told — that happens once it is approved.',
                          );
                        } else {
                          void run(
                            () =>
                              applyDeliveryRevision(campaignId, {
                                ...body,
                                commitmentText: String(form.get('commitmentText') ?? ''),
                              }),
                            'Your backers have been told. What you originally promised is still on record beside it.',
                          );
                        }
                      }}
                    >
                      <Field label="New delivery month" hint="As YYYY-MM.">
                        <Input
                          name="proposedDeliveryMonth"
                          required
                          placeholder="2027-03"
                          pattern="\d{4}-\d{2}"
                        />
                      </Field>
                      {fulfillment.changePath === 'notice_before_original_month' ? (
                        <Field label="What you are now promising" hint="In your own words.">
                          <Textarea name="commitmentText" required rows={3} />
                        </Field>
                      ) : null}
                      <Field label="Reason" hint="What actually changed. Backers read this.">
                        <Textarea name="reason" required rows={3} />
                      </Field>
                      <Field
                        label="What is unchanged"
                        hint="Say what still stands — reward contents, price, refund policy."
                      >
                        <Textarea name="unchangedObligations" required rows={3} />
                      </Field>
                      <Field label="Next update date" hint="When you will next post, as YYYY-MM-DD.">
                        <Input name="nextUpdateDate" required pattern="\d{4}-\d{2}-\d{2}" />
                      </Field>
                      <Field
                        label="Support and refund route"
                        hint="How a backer reaches you about this."
                      >
                        <Textarea name="supportRefundRoute" required rows={2} />
                      </Field>
                      <Button type="submit" disabled={busy}>
                        {fulfillment.changePath === 'admin_preapproval'
                          ? 'Send to Proovd for review'
                          : 'Tell my backers'}
                      </Button>
                    </form>
                  )}
                </div>
              ),
            },
          ]}
        />
      ) : null}

      {/* ── Delivering (§22.5) ───────────────────────────────────────────── */}
      <h3 className="h4">Delivering</h3>
      {fulfillment.deliveredAt ? (
        <p>
          Delivered {localDate(fulfillment.deliveredAt)} by {fulfillment.mechanismLabel}. Every
          charged backer still due fulfillment was told, with your access instructions and what you
          originally promised.
        </p>
      ) : (
        <>
          <form
            className="fd-paid__form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  setDeliveryMechanism(campaignId, {
                    mechanism: String(form.get('mechanism') ?? ''),
                    accessInstructions: String(form.get('accessInstructions') ?? ''),
                  }),
                'Saved. When access is actually live, record the delivery and we will tell your backers.',
              );
            }}
          >
            <Field label="How backers get access">
              <select
                name="mechanism"
                required
                className="input"
                defaultValue={fulfillment.mechanism ?? ''}
              >
                <option value="" disabled>
                  Choose one
                </option>
                {fulfillment.mechanisms.map((mechanism) => (
                  <option key={mechanism.key} value={mechanism.key}>
                    {mechanism.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Access instructions"
              hint="Exactly what a backer does. This is repeated in the email they get."
            >
              <Textarea
                name="accessInstructions"
                required
                rows={3}
                defaultValue={fulfillment.accessInstructions ?? ''}
              />
            </Field>
            <Button type="submit" tier="secondary" disabled={busy}>
              Save access details
            </Button>
          </form>

          {fulfillment.mechanism && original ? (
            <div className="fd-paid__deliver">
              <p>
                When access is live, record it. Every charged backer still due fulfillment gets
                your access instructions, what you originally promised, your support route, and how
                to reach Proovd.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => recordDelivery(campaignId),
                    'Delivery recorded and your backers have been told.',
                  )
                }
              >
                Record delivery and tell my backers
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* ── §22.4: the Day 14 Progress Check ─────────────────────────────────────── */

function Day14Panel({
  campaignId,
  day14,
  onChanged,
}: {
  campaignId: string;
  day14: Day14ChecklistView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      onChanged();
    } catch (caught: unknown) {
      setRefusal(refusalText(caught, 'That did not complete, so nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  const open = day14.clarifications.filter((c) => !c.respondedAt);

  return (
    <Card className="fd-paid__day14">
      <h2 className="h3">Day 14 progress check</h2>
      <p className="fd-note">{DAY_14_IS_ANCHORED_ON_CLOSE}</p>

      {!day14.reviewOpen ? (
        <p>
          Your Day 14 review has not opened yet. When it does, Proovd asks for the same checklist
          you can read below, and you will get a message about it.
        </p>
      ) : (
        <p>
          {day14.enforcementOnly
            ? 'Your campaign has no remaining payment, so this review is about delivery and communication only.'
            : 'A review that does not pass blocks a remaining payment that has not gone out.'}{' '}
          A decision is due {deadline(day14.decisionDueAt)}.
        </p>
      )}

      {/*
        `outcome` is `pending`, `pass`, `fail`, or `not_opened`. Deciding this on
        `!== 'pending'` renders a review nobody has opened as one that DID NOT
        PASS — the worst possible direction for a state that blocks a payment
        (§1.4), and what the old surface did.
      */}
      {day14.outcome === 'pass' || day14.outcome === 'fail' ? (
        <p>
          Recorded outcome: {day14.outcome === 'pass' ? 'passed' : 'did not pass'}. Proovd emailed
          you the reasons and what happens next.
        </p>
      ) : null}

      {notice ? <p role="status">{notice}</p> : null}
      {refusal ? <p role="alert">{refusal}</p> : null}

      {/* ── The clarification, and somewhere to answer it (§22.4) ────────── */}
      {open.length > 0 ? (
        <>
          <h3 className="h4">Proovd has asked you something</h3>
          <p className="fd-note">{CLARIFICATION_IS_ANSWERED_HERE}</p>
          <ul className="fd-paid__clarifications">
            {open.map((clarification) => (
              <li key={clarification.id} className="fd-paid__clarification">
                <p className="fd-paid__obhead">
                  <Tag variant={clarification.overdue ? 'live' : 'sage'}>
                    {clarification.overdue ? 'Overdue' : 'Waiting on you'}
                  </Tag>
                </p>
                <p>{clarification.question}</p>
                <p className="fd-paid__obmeta">
                  Answer by {deadline(clarification.dueAt)}. Not answering inside five business
                  days is one of the recorded reasons a review does not pass.
                </p>
                <form
                  className="fd-paid__form"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    void run(
                      () =>
                        respondToDay14Clarification(
                          campaignId,
                          clarification.id,
                          answers[clarification.id] ?? '',
                        ),
                      'Your answer is on the record and Proovd has it.',
                    );
                  }}
                >
                  <Field label="Your answer">
                    <Textarea
                      value={answers[clarification.id] ?? ''}
                      onChange={(event) => {
                        /*
                          The value is read HERE and not inside the updater.
                          React runs a functional `setState` later, during the
                          reducer, and by then the synthetic event has been
                          recycled and `currentTarget` is null — so closing
                          over the event throws on the first keystroke. It
                          throws on the one control in this chapter that
                          answers a review which blocks a payment, and only a
                          real interaction finds it.
                        */
                        const value = event.currentTarget.value;
                        setAnswers((previous) => ({
                          ...previous,
                          [clarification.id]: value,
                        }));
                      }}
                      rows={3}
                      required
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={busy || (answers[clarification.id] ?? '').trim().length === 0}
                  >
                    Send my answer
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* ── The checklist (§22.4 — the same one the Admin reads) ─────────── */}
      {day14.reviewOpen && day14.outcome !== 'pass' && day14.outcome !== 'fail' ? (
        <>
          <h3 className="h4">What to send</h3>
          <p className="fd-note">{DAY_14_RECEIPT_IS_KEPT}</p>
          <Absence id="delivery_proof_upload" />
          <form
            className="fd-paid__form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const items = day14.items
                .map((item) => ({
                  itemKey: item.key,
                  detail: String(form.get(item.key) ?? '').trim(),
                }))
                .filter((item) => item.detail.length > 0);
              void run(
                () => submitDay14Evidence(campaignId, items),
                'Sent. Your receipt lists everything you sent and when Proovd owes you a decision.',
              );
            }}
          >
            {day14.items.map((item) => (
              <Field
                key={item.key}
                label={item.required ? item.label : `${item.label} (optional)`}
                hint={`For example: ${item.example}`}
              >
                <Textarea name={item.key} required={item.required} rows={3} />
              </Field>
            ))}
            <Button type="submit" disabled={busy}>
              Send this
            </Button>
          </form>
        </>
      ) : null}

      {day14.submissions.length > 0 ? (
        <Accordion
          items={[
            {
              value: 'receipts',
              head: `What you have sent (${day14.submissions.length})`,
              body: (
                <div>
                  {day14.submissions.map((submission) => (
                    <div key={submission.id} className="fd-paid__receipt">
                      <p className="fd-paid__obmeta">
                        Reference {submission.reference} — sent {localDate(submission.submittedAt)},
                        decision due {localDate(submission.decisionDueAt)}.
                      </p>
                      <dl className="fd-paid__counts">
                        {submission.items.map((item) => (
                          <div key={item.itemKey}>
                            <dt>{item.label}</dt>
                            <dd>{item.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      ) : null}
    </Card>
  );
}

/** Exported so a test can walk the register against what actually renders. */
export const PAID_ABSENCE_IDS = PAID_ABSENCES.map((absence) => absence.id);
