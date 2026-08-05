/**
 * The Founder's campaign results — Spec §21, §33.7.11, DNA §5.14 (Phase 18b).
 *
 * Two states, honestly distinct:
 *
 *  - `preparing` — the campaign closed and reconciliation has not finished.
 *    The §27.1 six questions render as a waiting state; no number is shown as
 *    final while the retry window or reconciliation could still change it.
 *  - `ready` — `Results ready` has fired. Glance is the outcome and the three
 *    §21 totals stated separately; Explore is every §21 section, each carrying
 *    what its numbers count; the Admin-reviewed narrative ends with what this
 *    result does and does not prove — the honesty section §21 requires to
 *    avoid false causality.
 *
 * Creator rows are public handles only (§11). Survey answers are the consented
 * ones only — the server already withheld the rest, and this surface says so.
 * Creator money is provisional and says so (§24.4): Phase 19 finalizes it.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  Button,
  Field,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { formatUsd } from '@proovd/shared';
import {
  fetchCampaignResults,
  fetchFounderPayments,
  requestEarlyRemainingRelease,
  type FounderResultsView,
  type FounderPaymentStatusView,
  FounderRequestError,
} from './api.js';

const usd = (cents: string): string => formatUsd(BigInt(cents));

/**
 * §22.3's Founder payment status (Phase 19b) — rendered from the ONE server
 * resolver, never recomputed here (§33.8.13). It answers §22.3's list: the
 * exact amount affected, the requirement or blocker by name, the secure
 * action, the submitted/verified W-9 state, the next review date, and `No
 * action needed` while under review. Status words are `eligible`, `blocked`,
 * or `released` — never a fourth.
 */
function FounderPaymentsPanel({ campaignId }: { campaignId: string }) {
  const [view, setView] = useState<FounderPaymentStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [requestState, setRequestState] = useState<'idle' | 'sending' | 'sent' | 'refused'>('idle');
  const [refusal, setRefusal] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { payments } = await fetchFounderPayments(campaignId);
        if (!cancelled) setView(payments);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failed) {
    return (
      <>
        <h2 className="h3">Your payment</h2>
        <p>Your payment status could not be loaded. Nothing has changed — reload to try again.</p>
      </>
    );
  }
  if (!view) return null;
  if (!view.applicable) {
    return (
      <>
        <h2 className="h3">Your payment</h2>
        <p>{view.notApplicableReason}</p>
      </>
    );
  }

  const remaining = view.payments.find((p) => p.kind === 'remaining_payment');
  const first = view.payments.find((p) => p.kind === 'first_payment');
  const canAskEarly =
    view.model === 'product' &&
    remaining?.status !== 'released' &&
    first?.status === 'released' &&
    !view.earlyRelease?.pendingRequest &&
    requestState !== 'sent';

  async function submitRequest() {
    setRequestState('sending');
    try {
      await requestEarlyRemainingRelease(campaignId, message);
      setRequestState('sent');
    } catch (error) {
      setRequestState('refused');
      setRefusal(
        error instanceof FounderRequestError
          ? `${error.detail.whatHappened ?? error.detail.title} ${error.detail.next ?? ''}`.trim()
          : 'The request could not be recorded. Nothing has changed — try again.',
      );
    }
  }

  return (
    <>
      <h2 className="h3">Your payment</h2>

      {/* ── The W-9: requirement, state, and the secure action (§22.3) ─────── */}
      <p>
        <Tag variant={view.w9.state === 'verified' ? 'mint' : 'default'}>
          {view.w9.state === 'not_requested'
            ? 'W-9 not requested yet'
            : `W-9 ${view.w9.state}`}
        </Tag>
      </p>
      <p>{view.w9.line}</p>
      <p>
        <strong>{view.w9.action}</strong>
      </p>

      {/* ── The eligible share, with what it is made of ────────────────────── */}
      <p>
        Eligible Founder share: <strong>{usd(view.eligibleShare.amountCents)}</strong>
        {view.eligibleShare.exact ? '' : ' at minimum'}. {view.eligibleShare.note}
      </p>

      {/* ── Each scheduled payment: amount, status, named blockers ─────────── */}
      <ul>
        {view.payments.map((p) => (
          <li key={p.kind}>
            <strong>{p.label}</strong> — {usd(p.amountCents)}
            {p.amountExact ? '' : ' at minimum'} ({p.percent}%), due{' '}
            {p.dueAt.slice(0, 10)}:{' '}
            <Tag
              variant={
                p.status === 'released' ? 'mint' : p.status === 'eligible' ? 'sage' : 'default'
              }
            >
              {p.status}
            </Tag>
            {p.status === 'released' && p.releasedAt ? ` on ${p.releasedAt.slice(0, 10)}` : ''}
            {p.releasedEarly ? ' (released early on recorded evidence)' : ''}
            {p.status === 'blocked' && p.blockers.length > 0 ? (
              <ul>
                {p.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {view.nextReviewDate ? <p>Next review date: {view.nextReviewDate.slice(0, 10)}.</p> : null}
      {view.day14 ? <p className="backer__recovery-note">{view.day14.line}</p> : null}

      {/* ── The early remaining release ask (§22.3) ────────────────────────── */}
      {view.earlyRelease?.pendingRequest ? (
        <p>
          Your early-release request from{' '}
          {view.earlyRelease.pendingRequest.createdAt.slice(0, 10)} is being reviewed against
          recorded delivery, communication, tax, and risk evidence. You will receive the decision
          with its reason. No action needed.
        </p>
      ) : null}
      {requestState === 'sent' ? (
        <p>
          Your early-release request was received. Proovd decides it on recorded evidence and you
          will get the decision with its reason. No action needed.
        </p>
      ) : canAskEarly ? (
        <>
          <Field label="Ask for the remaining payment early">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
              rows={3}
              placeholder="What can affected backers already reach, and what did you send them?"
            />
          </Field>
          <p className="field-hint">
            Early release needs recorded proof that the promised reward or access is actually
            available to affected backers — internal readiness alone is not enough — and it does not
            skip the Day 14 status review.
          </p>
          <Button
            onClick={() => void submitRequest()}
            disabled={requestState === 'sending' || message.trim().length === 0}
          >
            {requestState === 'sending' ? 'Sending…' : 'Request early release'}
          </Button>
          {requestState === 'refused' ? <p role="alert">{refusal}</p> : null}
        </>
      ) : null}
    </>
  );
}

type State =
  | { status: 'loading' }
  | { status: 'error'; title: string; detail: string }
  | { status: 'ready'; results: FounderResultsView };

export function CampaignResults() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { results } = await fetchCampaignResults(campaignId);
        if (!cancelled) setState({ status: 'ready', results });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof FounderRequestError) {
          setState({
            status: 'error',
            title: error.detail.title,
            detail: `${error.detail.whatHappened ?? ''} ${error.detail.next ?? ''}`.trim(),
          });
        } else {
          setState({
            status: 'error',
            title: 'Results could not be loaded',
            detail: 'Nothing has changed. Reload to try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (state.status === 'loading') {
    return (
      <SurfaceLoading subject="your results" reference={campaignId} />
    );
  }

  if (state.status === 'error') {
    // §33.11.7: the six questions, on the surface a Founder opens to find out
    // what their campaign earned. A title and a sentence answer two of them.
    return (
      <Section aria-labelledby="results-error">
        <Measure>
          <h1 className="h2" id="results-error">
            {state.title}
          </h1>
          <StatePanel
            state={state.title}
            whatHappened={state.detail}
            next="Reload the page. Your results are computed from your record when you open it, so nothing was lost."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Campaign results — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  const r = state.results;

  if (r.state === 'preparing') {
    // §27.1's six questions, as facts — not a spinner pretending to work.
    return (
      <Section aria-labelledby="results-title">
        <Measure>
          <p className="eyebrow">{r.campaignTitle}</p>
          <h1 className="h2" id="results-title">
            Your results are being prepared
          </h1>
          <p>{r.preparing!.whatHappened}</p>
          <p>{r.preparing!.whatNext}</p>
          <p>
            Owner: {r.preparing!.owner}. Questions without losing context:{' '}
            <a href="mailto:support@proovd.co">support@proovd.co</a>.
          </p>

          {/* §22.3: the W-9 is requested immediately after close, so the
              payment status renders here too — before results are ready. */}
          <FounderPaymentsPanel campaignId={r.campaignId} />

          <p>
            <Link to={`/campaigns/${r.campaignId}/home`}>Back to your campaign</Link>
          </p>
        </Measure>
      </Section>
    );
  }

  return (
    <Section aria-labelledby="results-title">
      <Measure>
        <p className="eyebrow">{r.campaignTitle}</p>
        <h1 className="h2" id="results-title">
          Results
        </h1>

        {/* ── Glance: the outcome and the three §21 totals, separately ────── */}
        {r.threshold ? (
          <p>
            {r.threshold.met
              ? `Your campaign reached its order threshold — ${r.threshold.uniqueActiveBackers} unique backers against ${r.threshold.required} required.`
              : `Your campaign closed below its order threshold — ${r.threshold.uniqueActiveBackers} of ${r.threshold.required} unique backers — so no cards were charged.`}
          </p>
        ) : null}
        <dl className="checkout__amounts">
          <div>
            <dt>Pre-orders placed</dt>
            <dd>{r.preorders.placed}</dd>
          </div>
          <div>
            <dt>Pre-orders captured</dt>
            <dd>{r.preorders.captured}</dd>
          </div>
          <div>
            <dt>Unique backers</dt>
            <dd>{r.uniqueBackers}</dd>
          </div>
          {r.productTransactions ? (
            <div>
              <dt>Transactions / units</dt>
              <dd>
                {r.productTransactions.transactions} / {r.productTransactions.units}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Reward subtotal captured</dt>
            <dd>{usd(r.money.rewardSubtotalCapturedCents)}</dd>
          </div>
          <div>
            <dt>Sales tax captured</dt>
            <dd>{usd(r.money.salesTaxCapturedCents)}</dd>
          </div>
          <div className="checkout__amounts-total">
            <dt>Total captured</dt>
            <dd>{usd(r.money.totalCapturedCents)}</dd>
          </div>
        </dl>

        {/* ── The Admin-reviewed narrative (§21) ──────────────────────────── */}
        <h2 className="h3">What this result means</h2>
        <p>
          <strong>Strongest signal.</strong> {r.narrative!.strongestSignal}
        </p>
        <p>
          <strong>Weakest signal.</strong> {r.narrative!.weakestSignal}
        </p>
        <p>
          <strong>Leading survey reason.</strong> {r.narrative!.leadingSurveyReason}
        </p>
        <p>
          <strong>What this proves.</strong> {r.narrative!.whatThisProves}
        </p>
        <p>
          <strong>What this does not prove.</strong> {r.narrative!.whatThisDoesNotProve}
        </p>
        <p className="backer__recovery-note">
          Reviewed by Proovd before release, so the numbers above are not over-read.
        </p>

        {/* ── Payments (§21: failed, recovered, dropped) ──────────────────── */}
        <h2 className="h3">Payments</h2>
        <p>
          {r.payments.failed} payment{r.payments.failed === 1 ? '' : 's'} failed at close;{' '}
          {r.payments.recovered} recovered inside the 48-hour update window and count as captured;{' '}
          {r.payments.dropped} were dropped and count as no revenue, no Creator commission, and no
          share to you.
        </p>

        {/* ── Conversion and drop-off ─────────────────────────────────────── */}
        <h2 className="h3">Conversion</h2>
        <p>
          {r.conversion.clicks} tracked clicks led to {r.conversion.placed} pre-orders
          {r.conversion.conversionRate ? ` (${r.conversion.conversionRate})` : ''}.{' '}
          {r.conversion.canceled} were canceled before close
          {r.conversion.dropOffRate ? ` (${r.conversion.dropOffRate})` : ''}.
          {r.conversion.conversionRate === null
            ? ' No conversion rate is shown because no tracked clicks were recorded.'
            : ''}
        </p>

        {/* ── Revenue by source (§18's attribution) ───────────────────────── */}
        <h2 className="h3">Where the revenue came from</h2>
        <dl className="checkout__amounts">
          <div>
            <dt>Creator-attributed subtotal</dt>
            <dd>{usd(r.revenueBySource.creatorAttributedCents)}</dd>
          </div>
          <div>
            <dt>Direct / organic subtotal</dt>
            <dd>{usd(r.revenueBySource.directCents)}</dd>
          </div>
        </dl>
        <p className="backer__recovery-note">{r.revenueBySource.note}</p>

        {/* ── Per-Creator performance (§21) — public handles only (§11) ───── */}
        <h2 className="h3">Creator performance</h2>
        {r.perCreator.length === 0 ? (
          <p>No Creators promoted this campaign.</p>
        ) : (
          <ul>
            {r.perCreator.map((c) => (
              <li key={c.associationId}>
                <strong>{c.handle ?? 'Creator'}</strong> — {c.clicks} clicks,{' '}
                {c.attributedPlaced} attributed pre-orders, {c.attributedCaptured} captured (
                {usd(c.capturedSubtotalCents)} subtotal). Provisional set-aside{' '}
                {usd(c.provisionalCents)}
                {c.lockedPercent !== null ? ` at the locked ${c.lockedPercent}%` : ''}.
              </li>
            ))}
          </ul>
        )}
        <p className="backer__recovery-note">{r.finalization.note}</p>

        {/* ── Survey answers, per consent (§25.2) ─────────────────────────── */}
        <h2 className="h3">Survey answers</h2>
        <p>
          {r.survey.consentedCount} of {r.survey.totalPreorderCount} backers consented to share
          their answers with you
          {r.survey.averageRecommend
            ? `; average recommendation ${r.survey.averageRecommend} of 10`
            : ''}
          . Answers from backers who did not consent are not shown to anyone.
        </p>
        {r.survey.reasons.length > 0 ? (
          <ul>
            {r.survey.reasons.map((reason, index) => (
              <li key={index}>&ldquo;{reason}&rdquo;</li>
            ))}
          </ul>
        ) : null}

        {/* ── §22.3: your payment — one source, many renderers (§33.8.13) ─── */}
        <FounderPaymentsPanel campaignId={r.campaignId} />

        <p>
          <Link to={`/campaigns/${r.campaignId}/home`}>Back to your campaign</Link>
        </p>
      </Measure>
    </Section>
  );
}
