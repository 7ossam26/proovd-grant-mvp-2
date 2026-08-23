/** Pitch-only celebration shown after the simulated campaign review. */

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { founderDashboardPath } from '@proovd/shared';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { PITCH_DEMO } from './referenceWalkthrough.js';

/** Preserve the dashboard redirect for every genuine, non-demo visit. */
export function LiveRoute() {
  const { campaignId = '' } = useParams();

  return PITCH_DEMO ? (
    <LiveReferenceStep />
  ) : (
    <Navigate to={founderDashboardPath(campaignId)} replace />
  );
}

export function LiveReferenceStep() {
  const { campaignId = '' } = useParams();

  return (
    <FlowPage pageId="live" param={campaignId}>
      <LiveBody />
    </FlowPage>
  );
}

function LiveBody() {
  const { swapToPage } = useFlowNav();

  return (
    <section className="ff-live">
      <LiveStage>
        <div className="ff-live__col">
          <h1 className="ff-live__head" data-live-anim="head">
            You’re Live!
          </h1>
          <p className="ff-live__lede" data-live-anim="panel">
            Your content creators are hard at work, kick back and check your dashboard for backers!
          </p>
          <button
            type="button"
            className="ff-live__cta"
            data-live-anim="cta"
            onClick={() => swapToPage('password')}
          >
            Secure account and open my dashboard
          </button>
        </div>
      </LiveStage>
      <p className="ff-live__demo">Demo walkthrough — no real campaign launch is recorded</p>
    </section>
  );
}

function LiveStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const fit = () => {
      const scale = Math.min(window.innerWidth / 2496, window.innerHeight / 1542) * 0.78;
      stage.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    };
    fit();
    window.addEventListener('resize', fit);

    const gsap = (
      window as unknown as {
        gsap?: {
          fromTo: (
            target: unknown,
            from: Record<string, unknown>,
            to: Record<string, unknown>,
          ) => void;
          killTweensOf: (target: unknown) => void;
        };
      }
    ).gsap;
    const animated = Array.from(stage.querySelectorAll('[data-live-anim]'));

    if (gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(
        animated,
        { y: 48, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.65,
          ease: 'power3.out',
          stagger: 0.14,
          clearProps: 'transform,opacity',
        },
      );
    }

    return () => {
      window.removeEventListener('resize', fit);
      if (gsap) gsap.killTweensOf(animated);
    };
  }, []);

  return (
    <div ref={stageRef} className="ff-live__stage">
      {children}
    </div>
  );
}
