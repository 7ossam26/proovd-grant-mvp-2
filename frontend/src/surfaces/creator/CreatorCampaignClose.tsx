/**
 * The Creator's campaign close view — Spec §21, §22.1, Appendix B.7, §30
 * (Phase 18b).
 *
 * §21's own list, and nothing else: content verified, attributed pre-orders
 * and captures, estimated earnings as the exact B.7 status block (final ones
 * are Phase 19's and the surface says so), the next review date, and a factual
 * thank-you. There is no ranking anywhere — §30 forbids leaderboards, and the
 * server never computes one for this view.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { formatUsd } from '@proovd/shared';
import { Section, Measure, StatePanel } from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { fetchCreatorClose, CreatorRequestError, type CreatorCloseView } from './api.js';

type State =
  | { status: 'loading' }
  | { status: 'error'; title: string; detail: string }
  | { status: 'ready'; close: CreatorCloseView };

export function CreatorCampaignClose() {
  const { associationId = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { close } = await fetchCreatorClose(associationId);
        if (!cancelled) setState({ status: 'ready', close });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof CreatorRequestError) {
          setState({
            status: 'error',
            title: error.detail.title,
            detail: `${error.detail.whatHappened ?? ''} ${error.detail.next ?? ''}`.trim(),
          });
        } else {
          setState({
            status: 'error',
            title: 'This view could not be loaded',
            detail: 'Nothing has changed. Reload to try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [associationId]);

  if (state.status === 'loading') {
    return (
      <SurfaceLoading subject="your campaign close" reference={associationId} />
    );
  }

  if (state.status === 'error') {
    return (
      <Section aria-labelledby="creator-close-error">
        <Measure>
          <h1 className="h2" id="creator-close-error">
            {state.title}
          </h1>
          {/* §33.11.7: this is the surface a Creator opens to see what they
              earned. A failure here says who owns it and how to reach a person
              — the amount is not in question, the view is. */}
          <StatePanel
            state={state.title}
            whatHappened={state.detail}
            next="Reload the page. Your earnings are recorded on Proovd’s side and are not affected by this."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={
              <Link to={`/creator/campaigns/${associationId}/partnership`}>
                Back to your campaign dashboard
              </Link>
            }
            reference={associationId}
            getHelp={{ href: supportMailto(`Campaign close — ${associationId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  const c = state.close;
  return (
    <Section aria-labelledby="creator-close-title">
      <Measure>
        <p className="eyebrow">{c.campaignTitle}</p>
        <h1 className="h2" id="creator-close-title">
          The campaign has closed
        </h1>

        <p>{c.contentVerified.line}</p>
        <dl className="checkout__amounts">
          <div>
            <dt>Attributed pre-orders</dt>
            <dd>{c.attributed.preorders}</dd>
          </div>
          <div>
            <dt>Attributed captured charges</dt>
            <dd>{c.attributed.captured}</dd>
          </div>
        </dl>

        {/* Appendix B.7, exact — server-rendered, the same block the emails
            carry. Estimated until §22.1 finalization; then the recorded state. */}
        <h2 className="h3">Your earnings</h2>
        <p className="backer__recovery-body">{c.earnings.statusBlock}</p>
        {c.earnings.final ? (
          <dl className="checkout__amounts">
            <div>
              <dt>Finalized commission</dt>
              <dd>{formatUsd(BigInt(c.earnings.final.commissionCents))}</dd>
            </div>
            <div>
              <dt>Earned bonus</dt>
              <dd>{formatUsd(BigInt(c.earnings.final.bonusCents))}</dd>
            </div>
            <div>
              <dt>Fixed Creator payment eligible</dt>
              <dd>{formatUsd(BigInt(c.earnings.final.eligibleFixedCents))}</dd>
            </div>
            <div>
              <dt>Transfer total</dt>
              <dd>{formatUsd(BigInt(c.earnings.final.totalCents))}</dd>
            </div>
          </dl>
        ) : null}
        <p className="backer__recovery-note">{c.earnings.finalizationNote}</p>
        {c.bonus ? <p className="backer__recovery-note">{c.bonus.note}</p> : null}
        {c.fixedPayment.applicable ? (
          <p className="backer__recovery-note">
            Your fixed payment is {c.fixedPayment.status.replace(/_/g, ' ')}; its completion
            decision is part of the same verification.
          </p>
        ) : null}

        <p>{c.nextReviewLine}</p>
        <p>{c.thankYou}</p>

        <p>
          <Link to={`/creator/campaigns/${c.associationId}/partnership`}>
            Back to your campaign dashboard
          </Link>
        </p>
      </Measure>
    </Section>
  );
}
