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
import { Section, Measure } from '../../components/index.js';
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
      <Section>
        <Measure>
          <p>Loading your campaign close…</p>
        </Measure>
      </Section>
    );
  }

  if (state.status === 'error') {
    return (
      <Section aria-labelledby="creator-close-error">
        <Measure>
          <h1 className="h2" id="creator-close-error">
            {state.title}
          </h1>
          <p>{state.detail}</p>
          <p>
            <Link to={`/creator/campaigns/${associationId}/partnership`}>
              Back to your campaign dashboard
            </Link>
          </p>
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

        {/* Appendix B.7, exact — the estimated-earnings status block. */}
        <h2 className="h3">Your earnings</h2>
        <p className="backer__recovery-body">{c.earnings.statusBlock}</p>
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
