import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
import { FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';

type Gsap = {
  set: (target: unknown, vars: Record<string, unknown>) => void;
  fromTo: (
    target: unknown,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ) => void;
  killTweensOf: (target: unknown) => void;
};

const STAGE_WIDTH = 2496;
const STAGE_HEIGHT = 1542;
const PAGE_SCALE = 0.78;
const REVIEW_SCALE = 1.06;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT) *
    PAGE_SCALE *
    REVIEW_SCALE
  );
}

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

  const heading = approved
    ? 'Your application is approved'
    : resubmittable
      ? 'Your application needs changes'
      : outcome === 'rejected'
        ? 'Your application was not approved'
        : 'Application in review';
  const detail =
    explanation ??
    (approved
      ? 'The required review is complete, so your listing-fee step is now unlocked.'
      : 'A person here is reviewing the information you submitted.');
  const next = approved
    ? 'Continue to your listing fee.'
    : resubmittable
      ? 'Make the requested changes, then resubmit this application.'
      : 'We will email you when the review changes.';

  return (
    <FlowPage pageId="application-review" param={campaignId}>
      <ApplicationReviewScreen
        heading={heading}
        detail={detail}
        next={next}
        action={
          approved ? (
            <Button
              className="ff-application-review__action"
              data-review-anim="copy"
              tier="primary"
              onClick={() => void navigate(founderFlowPath('fee', campaignId))}
            >
              Continue to listing fee
            </Button>
          ) : resubmittable ? (
            <Button
              className="ff-application-review__action"
              data-review-anim="copy"
              tier="primary"
              disabled={busy}
              onClick={() => void resubmit()}
            >
              {busy ? 'Resubmitting…' : 'Resubmit application'}
            </Button>
          ) : null
        }
      />
    </FlowPage>
  );
}

function ApplicationReviewScreen({
  heading,
  detail,
  next,
  action,
}: {
  heading: string;
  detail: string;
  next: string;
  action: ReactNode;
}) {
  const { param } = useFlowNav();
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const fit = () => {
      stage.style.transform = `translate(-50%, -50%) scale(${stageScale().toFixed(4)})`;
    };
    const settle = () => window.setTimeout(fit, 320);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', settle);

    const gsap = (window as unknown as { gsap?: Gsap }).gsap;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const grow = stage.querySelector<HTMLElement>('[data-review-anim="grow"]');
    const copy = Array.from(stage.querySelectorAll<HTMLElement>('[data-review-anim="copy"]'));

    if (gsap && !reduced && grow) {
      gsap.set(copy, { opacity: 0 });
      gsap.fromTo(
        grow,
        { scale: 0.12, opacity: 0, x: 0, y: 0 },
        {
          scale: 1,
          opacity: 1,
          x: 0,
          y: 0,
          duration: 1,
          ease: 'back.out(2.2)',
          transformOrigin: '50% 50%',
          force3D: true,
          clearProps: 'transform,opacity',
          onComplete: () =>
            gsap.fromTo(
              copy,
              { y: 34, opacity: 0 },
              {
                y: 0,
                opacity: 1,
                duration: 0.5,
                ease: 'power3.out',
                stagger: 0.12,
                force3D: true,
                clearProps: 'transform,opacity',
              },
            ),
        },
      );
    }

    const sweep = window.setTimeout(() => {
      gsap?.set([...(grow ? [grow] : []), ...copy], { clearProps: 'transform,opacity' });
    }, 3400);

    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', settle);
      window.clearTimeout(sweep);
      gsap?.killTweensOf([...(grow ? [grow] : []), ...copy]);
    };
  }, []);

  return (
    <section className="ff-application-review" data-reviewwait="1">
      <header className="ff-application-review__top">
        <img
          src="/assets/proovd-logo.svg"
          alt="Proovd"
          className="ff-application-review__logo"
        />
        <HelpDrawer
          pageId="application-review"
          param={param}
          trigger={
            <button type="button" className="ff-application-review__help">
              Help
            </button>
          }
        />
      </header>

      <div className="ff-application-review__stage" ref={stageRef}>
        <div className="ff-application-review__lockup">
          <img
            data-review-anim="grow"
            src="/assets/review-loupe.webp"
            alt=""
            className="ff-application-review__art"
          />
          <h1 data-review-anim="copy" className="ff-application-review__head">
            {heading}
          </h1>
          <p data-review-anim="copy" className="ff-application-review__sub">
            {detail}
          </p>
          <p data-review-anim="copy" className="ff-application-review__note">
            {next}
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}
