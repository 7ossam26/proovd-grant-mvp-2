import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Button, NO_ACTION, StatePanel } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fetchApplicationReview,
  FounderRequestError,
  submitApplicationReview,
  type FounderApplicationReviewState,
} from '../founder/api.js';
import { FlowPage } from './FlowPage.js';

export function ApplicationReviewStep() {
  const { campaignId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<FounderApplicationReviewState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApplicationReview(campaignId)
      .then(({ applicationReview }) => {
        if (cancelled) return;
        if (!applicationReview.required) {
          void navigate(founderFlowPath('fee', campaignId), { replace: true });
          return;
        }
        setState(applicationReview);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setFailure(
            error instanceof FounderRequestError
              ? (error.detail.whatHappened ?? error.detail.title)
              : 'We could not read your Application Review.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, navigate]);

  if (failure) {
    return (
      <FlowPage pageId="application-review" param={campaignId}>
        <div className="ff-wait">
          <StatePanel
            state="We could not read your Application Review"
            whatHappened={failure}
            next="Reload this page. Nothing about your application has changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </div>
      </FlowPage>
    );
  }
  if (!state) return <SurfaceLoading subject="your Application Review" reference={campaignId} />;

  const outcome = state.review?.outcome ?? 'waiting';
  const changes = state.review?.changeRequests.filter((request) => !request.resolvedAt) ?? [];
  const approved = state.mayContinue;
  const resubmittable = outcome === 'changes_requested';
  const explanation =
    state.review?.customerExplanation ??
    (changes.map((request) => `${request.fieldKey}: ${request.reason}`).join('\n') || null);

  async function resubmit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await submitApplicationReview(campaignId);
      setState(result.applicationReview);
    } catch (error: unknown) {
      setFailure(
        error instanceof FounderRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'We could not resubmit your application.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlowPage pageId="application-review" param={campaignId} badge>
      <div className="ff-wait">
        <h1 className="ff-build__title">Application Review</h1>
        <StatePanel
          state={
            approved
              ? 'Your application is approved'
              : resubmittable
                ? 'Your application needs changes'
                : outcome === 'rejected'
                  ? 'Your application was not approved'
                  : 'Your application is with our review team'
          }
          whatHappened={
            explanation ??
            (approved
              ? 'The required review is complete, so your listing-fee step is now unlocked.'
              : 'A person here is reviewing the information you submitted.')
          }
          next={
            approved
              ? 'Continue to your listing fee.'
              : resubmittable
                ? 'Make the requested changes, then resubmit this application.'
                : 'We will email you when the review changes.'
          }
          owner={resubmittable ? 'You' : 'Proovd'}
          nextUpdate="We email you when it changes"
          action={
            approved ? (
              <Button
                tier="primary"
                onClick={() => void navigate(founderFlowPath('fee', campaignId))}
              >
                Continue to listing fee
              </Button>
            ) : resubmittable ? (
              <Button tier="primary" disabled={busy} onClick={() => void resubmit()}>
                {busy ? 'Resubmitting…' : 'Resubmit application'}
              </Button>
            ) : (
              NO_ACTION
            )
          }
          reference={`${campaignId} · submission ${state.review?.round ?? 1}`}
          getHelp={{ href: '/support' }}
          ring={!approved}
        />
      </div>
    </FlowPage>
  );
}
