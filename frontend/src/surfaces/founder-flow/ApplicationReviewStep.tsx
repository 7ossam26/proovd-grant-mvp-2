/**
 * The reference's `approval` / `[data-reviewwait]` beat, inserted between the
 * Creator-payment answer and payouts. It is deliberately passive: there is no
 * CTA and no Back control, and it advances after the reference's five seconds.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { SurfaceLoading } from '../../features/public/states.js';
import { fetchOpenness, type OpennessState } from '../founder/api.js';
import { FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';

type CampaignType = OpennessState['campaignType'];

interface ReviewRouteState {
  campaignType?: CampaignType;
}

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
const REVIEW_HOLD_MS = 5000;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT) *
    PAGE_SCALE *
    REVIEW_SCALE
  );
}

function routeCampaignType(state: unknown): CampaignType | null {
  if (!state || typeof state !== 'object') return null;
  const campaignType = (state as ReviewRouteState).campaignType;
  return campaignType === 'pre_build' || campaignType === 'pre_launch' ? campaignType : null;
}

export function ApplicationReviewStep() {
  const { campaignId = '' } = useParams();
  const location = useLocation();
  const [campaignType, setCampaignType] = useState<CampaignType | null>(() =>
    routeCampaignType(location.state),
  );

  useEffect(() => {
    if (campaignType) return;
    let cancelled = false;
    fetchOpenness(campaignId)
      .then(({ openness }) => {
        if (!cancelled) setCampaignType(openness.campaignType);
      })
      .catch(() => {
        // A reload can arrive without router state. Keep the loading surface
        // rather than guessing whether the campaign is an Idea or Product.
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, campaignType]);

  if (!campaignType) {
    return <SurfaceLoading subject="your application" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="application-review" param={campaignId}>
      <ApplicationReviewScreen campaignType={campaignType} />
    </FlowPage>
  );
}

function ApplicationReviewScreen({ campaignType }: { campaignType: CampaignType }) {
  const { param, swapToPage } = useFlowNav();
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

  useEffect(() => {
    const hold = window.setTimeout(() => swapToPage('fee'), REVIEW_HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [swapToPage]);

  const campaignWord = campaignType === 'pre_launch' ? 'Product' : 'Idea';

  return (
    <section className="ff-application-review" data-reviewwait="1">
      <header className="ff-application-review__top">
        <img
          src="/assets/proovd-logo.svg"
          alt="proovd"
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
            src="/assets/review-loupe.png"
            alt=""
            className="ff-application-review__art"
          />
          <h1 data-review-anim="copy" className="ff-application-review__head">
            Application in review
          </h1>
          <p data-review-anim="copy" className="ff-application-review__sub">
            We’re reviewing your {campaignWord} this won’t take long
          </p>
          <p data-review-anim="copy" className="ff-application-review__note">
            Our Team will reach out to you as soon as we approve you for the next steps
          </p>
        </div>
      </div>
    </section>
  );
}
