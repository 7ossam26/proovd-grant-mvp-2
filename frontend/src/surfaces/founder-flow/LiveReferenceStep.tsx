/** Pitch-only celebration shown after the simulated campaign review. */

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { FlowPage, useFlowNav } from './FlowPage.js';

export function LiveRoute() {
  return <LiveReferenceStep />;
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

  return <FounderEntryCelebration onContinue={() => swapToPage('password')} />;
}

export function FounderEntryCelebration({ onContinue }: { onContinue: () => void }) {

  return (
    <section className="ff-live">
      <LiveStage>
        <div className="ff-live__col">
          <h1 className="ff-live__head" data-live-anim="head">
            You’re in!
          </h1>
          <p className="ff-live__lede" data-live-anim="panel">
            we've matched you with your content creators, kick back and check your dashboard for affiliate offers
          </p>
          <button
            type="button"
            className="ff-live__cta"
            data-live-anim="cta"
            onClick={onContinue}
          >
            Secure account and open my dashboard
          </button>
        </div>
      </LiveStage>
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
