/** Campaign in review — the reference's five-second image-first interstitial. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';
import { fetchBuild, fetchRoster, FounderRequestError } from '../founder/api.js';
import type { BuildState, RosterView } from '../founder/api.js';

const REVIEW_ASSETS = {
  logo: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/proovd-logo.svg',
    import.meta.url,
  ).href,
  lens: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/review-lens.png',
    import.meta.url,
  ).href,
};

const REFERENCE_CREATORS = [
  { initials: 'AA', handle: 'ahmedamr' },
  { initials: 'H', handle: 'Habiba' },
  { initials: 'KS', handle: 'KhaledSamer' },
] as const;

export function InReviewReferenceStep() {
  const { campaignId = '' } = useParams();
  const [build, setBuild] = useState<BuildState | null>(null);
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBuild(campaignId), fetchRoster(campaignId).catch(() => null)])
      .then(([buildState, rosterResult]) => {
        if (cancelled) return;
        setBuild(buildState);
        setRoster(rosterResult?.roster ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read where your campaign stands.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failure) {
    return (
      <FlowPage pageId="in-review" param={campaignId}>
        <div className="ff-wait">
          <StatePanel
            state="We could not read where your campaign stands"
            whatHappened={failure}
            next="Reload the page. Nothing about your campaign has changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!build) return <SurfaceLoading subject="your campaign" reference="Your campaign" />;

  return (
    <FlowPage pageId="in-review" param={campaignId}>
      <ReviewBody roster={roster} />
    </FlowPage>
  );
}

function ReviewBody({ roster }: { roster: RosterView | null }) {
  const { param, swapToPage } = useFlowNav();
  const [accepted, setAccepted] = useState(1);
  const creators = useMemo(
    () =>
      REFERENCE_CREATORS.map((reference, index) => ({
        initials: reference.initials,
        handle: roster?.creators[index]?.handle?.replace(/^@/, '').trim() || reference.handle,
      })),
    [roster],
  );

  useEffect(() => {
    const second = window.setTimeout(() => setAccepted(2), 1500);
    const third = window.setTimeout(() => setAccepted(3), 3000);
    const live = window.setTimeout(() => swapToPage('live'), 5000);
    return () => {
      window.clearTimeout(second);
      window.clearTimeout(third);
      window.clearTimeout(live);
    };
  }, [swapToPage]);

  return (
    <section className="ff-review-ref">
      <header className="ff-review-ref__top">
        <img src={REVIEW_ASSETS.logo} alt="proovd" className="ff-review-ref__logo" />
        <HelpDrawer
          pageId="in-review"
          param={param}
          trigger={<button type="button" className="ff-review-ref__help">Help</button>}
        />
      </header>

      <ReviewStage>
        <div className="ff-review-ref__lockup">
          <img
            data-review-anim="grow"
            src={REVIEW_ASSETS.lens}
            alt=""
            className="ff-review-ref__lens"
          />
          <h1 data-review-anim="head">Campaign in review</h1>
          <p data-review-anim="sub" className="ff-review-ref__sub">
            We’re reviewing your campaign this won’t take long
          </p>
          <div data-review-anim="cta" className="ff-review-ref__creators">
            {creators.map((creator, index) => {
              const hasAccepted = index < accepted;
              return (
                <div
                  className={`ff-review-ref__creator${hasAccepted ? ' is-accepted' : ''}`}
                  key={`${creator.handle}-${index}`}
                >
                  <span className="ff-review-ref__avatar">{creator.initials}</span>
                  <span className="ff-review-ref__creator-copy">
                    @{creator.handle} {hasAccepted ? 'has accepted' : 'is looking at'} your campaign
                  </span>
                </div>
              );
            })}
          </div>
          <p data-review-anim="note" className="ff-review-ref__note">
            Our Team will reach out to you as soon as we get all your affiliates in place
          </p>
        </div>
      </ReviewStage>
    </section>
  );
}

function ReviewStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const scale = Math.min(window.innerWidth / 2496, window.innerHeight / 1542) * 0.78;
      stage.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    };
    const settle = () => window.setTimeout(fit, 320);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', settle);

    const gsap = (
      window as unknown as {
        gsap?: {
          set: (target: unknown, vars: Record<string, unknown>) => void;
          fromTo: (
            target: unknown,
            from: Record<string, unknown>,
            to: Record<string, unknown>,
          ) => void;
          killTweensOf: (target: unknown) => void;
        };
      }
    ).gsap;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const grow = stage.querySelector('[data-review-anim="grow"]');
    const rest = Array.from(
      stage.querySelectorAll('[data-review-anim]:not([data-review-anim="grow"])'),
    );

    if (gsap && !reduced && grow) {
      gsap.set(rest, { opacity: 0 });
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
          onComplete: () => {
            gsap.fromTo(
              rest,
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
            );
          },
        },
      );
    }

    const sweep = window.setTimeout(() => {
      if (gsap) {
        gsap.set([...(grow ? [grow] : []), ...rest], { clearProps: 'opacity,transform' });
      }
    }, 3400);

    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', settle);
      window.clearTimeout(sweep);
      if (gsap) gsap.killTweensOf([...(grow ? [grow] : []), ...rest]);
    };
  }, []);

  return <div ref={stageRef} className="ff-review-ref__stage">{children}</div>;
}
