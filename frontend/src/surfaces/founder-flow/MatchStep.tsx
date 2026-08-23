/**
 * Founder Flow v2 — the reference's `[data-match]` screen.
 *
 * This page intentionally owns the viewport instead of using `FlowPage`:
 * the reference has no wordmark, Help control, Back control, or persistent
 * shell here. Its neighbours swap immediately and the arriving page supplies
 * the motion, so navigation from and out of this component is immediate too.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  founderFlowPath,
  prefillAffiliateTypeLabel,
  summarizePrefillAffiliateTypes,
} from '@proovd/shared';
import { flowDirection, resetFlowDirection, startFlowTransition } from './FlowPage.js';
import { fetchFounderDetails, type FounderDetails } from '../founder/api.js';

const ASSETS = {
  lockup: '/assets/match-lockup.webp',
  cupidLeft: '/assets/cupid-left.webp',
  cupidRight: '/assets/cupid-right.webp',
  logo: '/assets/proovd-logo.svg',
};

let artworkPreload: Promise<void> | null = null;

/**
 * The reference's artwork is already in the document before `verifyIntro`
 * starts. In the routed app these three images are fetched and
 * decode them on the preceding Details screen; otherwise identical tweens can
 * appear late as transparent image boxes finish decoding mid-timeline.
 */
export function preloadMatchArtwork(): Promise<void> {
  if (artworkPreload) return artworkPreload;
  if (typeof Image === 'undefined') return Promise.resolve();

  artworkPreload = Promise.all(
    [ASSETS.lockup, ASSETS.cupidLeft, ASSETS.cupidRight].map(
      (src) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => {
            if (typeof image.decode !== 'function') {
              resolve();
              return;
            }
            void image.decode().catch(() => undefined).then(() => resolve());
          };
          image.onerror = () => resolve();
          image.src = src;
        }),
    ),
  ).then(() => undefined);

  return artworkPreload;
}

const FIT_W = 2496;
const FIT_H = 1542;
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

function isSmallPortrait(): boolean {
  if (window.innerWidth >= 820 || window.innerHeight <= window.innerWidth) return false;
  try {
    return window.matchMedia('(hover:none) and (pointer:coarse)').matches;
  } catch {
    return false;
  }
}

export function MatchStep() {
  const { campaignId = '' } = useParams();
  const navigate = useNavigate();
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const incoming = useRef<1 | -1>(flowDirection());
  const leaving = useRef(false);
  const [portrait, setPortrait] = useState(() => isSmallPortrait());
  const [rotateOk, setRotateOk] = useState(false);
  const [details, setDetails] = useState<FounderDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFounderDetails(campaignId)
      .then(({ details: next }) => {
        if (!cancelled) setDetails(next);
      })
      .catch(() => {
        if (!cancelled) setDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const advance = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    startFlowTransition(1);
    void navigate(founderFlowPath('creator-payment', campaignId));
  }, [campaignId, navigate]);

  // `fitStages()` from the reference, including its delayed orientation settle.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    let settle = 0;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale().toFixed(4)})`;
    };
    const resize = () => {
      fit();
      setPortrait(isSmallPortrait());
    };
    const orientation = () => {
      resize();
      settle = window.setTimeout(resize, 320);
    };

    fit();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', orientation);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', orientation);
    };
  }, []);

  // `FlowPage` normally consumes this value; this full-viewport page is its
  // own shell, so reset it after capturing the backwards/forwards arrival.
  useLayoutEffect(() => {
    resetFlowDirection();
  }, []);

  // `verifyIntro()`'s forward match timeline and backwards relay, tween for tween.
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gsap = (window as any).gsap;
    const lock = host.querySelector<HTMLElement>('[data-match-grow]');
    const panel = host.querySelector<HTMLElement>('[data-match-anim="panel"]');
    const sub = host.querySelector<HTMLElement>('[data-match-anim="sub"]');
    const cta = host.querySelector<HTMLElement>('[data-match-anim="cta"]');
    const cupidLeft = host.querySelector<HTMLElement>('[data-match-cupid="l"]');
    const cupidRight = host.querySelector<HTMLElement>('[data-match-cupid="r"]');
    const rest = [panel, sub, cta].filter(Boolean) as HTMLElement[];
    const cupids = [cupidLeft, cupidRight].filter(Boolean) as HTMLElement[];

    if (!gsap || !lock || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of [lock, ...rest, ...cupids].filter(Boolean) as HTMLElement[]) {
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
      }
      return;
    }

    let afterTimer = 0;
    let sweepTimer = 0;
    const context = gsap.context(() => {
      gsap.set(rest, { opacity: 0 });
      gsap.set(cupids, { opacity: 0 });

      let relayed = false;
      const cupidsIn = (at: number) => {
        gsap.killTweensOf(cupids);
        if (cupidLeft) {
          gsap.fromTo(
            cupidLeft,
            { xPercent: -120, opacity: 0 },
            {
              xPercent: 0,
              opacity: 1,
              duration: 0.8,
              ease: 'power3.out',
              delay: at,
              clearProps: 'transform,opacity',
            },
          );
        }
        if (cupidRight) {
          gsap.fromTo(
            cupidRight,
            { xPercent: 120, opacity: 0 },
            {
              xPercent: 0,
              opacity: 1,
              duration: 0.8,
              ease: 'power3.out',
              delay: at + (cupidLeft ? 0.34 : 0),
              clearProps: 'transform,opacity',
            },
          );
        }
      };

      if (incoming.current === -1) {
        const backwards = [sub, panel, cta].filter(Boolean);
        cupidsIn(0.12);
        gsap.fromTo(
          backwards,
          { x: -150, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.62,
            ease: 'power3.out',
            force3D: true,
            stagger: { each: 0.085, from: 'end' },
            clearProps: 'transform,opacity',
          },
        );
        gsap.fromTo(
          lock,
          { scale: 0.62, opacity: 0, x: 0, y: 0 },
          {
            scale: 1,
            opacity: 1,
            x: 0,
            y: 0,
            duration: 0.62,
            ease: 'back.out(1.2)',
            transformOrigin: '50% 50%',
            force3D: true,
            clearProps: 'transform,opacity',
          },
        );
        sweepTimer = window.setTimeout(() => {
          gsap.set([lock, ...rest, ...cupids], { clearProps: 'opacity,transform' });
        }, 2200);
        return;
      }

      const relay = () => {
        if (relayed) return;
        relayed = true;
        gsap.fromTo(
          [panel, sub].filter(Boolean),
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.5,
            ease: 'power3.out',
            stagger: 0.14,
            force3D: true,
            clearProps: 'transform,opacity',
          },
        );
        cupidsIn(0.5);
        if (cta) {
          gsap.fromTo(
            cta,
            { y: 30, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.5,
              delay: 1.34,
              ease: 'power3.out',
              force3D: true,
              clearProps: 'transform,opacity',
            },
          );
        }
      };

      const rect = lock.getBoundingClientRect();
      const computed = stage.current ? getComputedStyle(stage.current).transform : 'none';
      const matrix = computed && computed !== 'none' ? computed.match(/matrix\(([^,]+)/) : null;
      const ratio = matrix ? Number.parseFloat(matrix[1]) || 1 : 1;
      const dy = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / ratio;

      gsap.killTweensOf(lock);
      const timeline = gsap.timeline({ onComplete: relay });
      timeline
        .fromTo(
          lock,
          { y: dy, scale: 0.5, opacity: 0 },
          {
            y: dy,
            scale: 1,
            opacity: 1,
            duration: 0.72,
            ease: 'back.out(1.9)',
            transformOrigin: '50% 50%',
            force3D: true,
          },
        )
        .to(
          lock,
          {
            y: 0,
            duration: 0.72,
            ease: 'power2.inOut',
            force3D: true,
            clearProps: 'transform',
          },
          '+=0.22',
        );

      // The reference's two dropped-ticker backstops.
      afterTimer = window.setTimeout(relay, 2200);
      sweepTimer = window.setTimeout(() => {
        gsap.set([lock, ...rest, ...cupids], { clearProps: 'opacity,transform' });
      }, 3800);
    }, host);

    return () => {
      window.clearTimeout(afterTimer);
      window.clearTimeout(sweepTimer);
      context.revert();
    };
  }, []);

  // The reference's document-level Enter progression.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      advance();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [advance]);

  const affiliateTypeLines = (
    summarizePrefillAffiliateTypes(details?.affiliateTypes) ??
    prefillAffiliateTypeLabel(details?.affiliateType) ??
    'Proovd is preparing the right creator type'
  ).split(' · ');

  return (
    <>
      <main className="ff-match" ref={root} onClick={advance}>
        <img
          className="ff-match__cupid ff-match__cupid--left"
          data-match-cupid="l"
          src={ASSETS.cupidLeft}
          fetchPriority="high"
          alt=""
        />
        <img
          className="ff-match__cupid ff-match__cupid--right"
          data-match-cupid="r"
          src={ASSETS.cupidRight}
          fetchPriority="high"
          alt=""
        />

        <div className="ff-match__stage" data-page-stage="1" ref={stage}>
          <div className="ff-match__lockup">
            <img
              className="ff-match__mark"
              data-match-grow="1"
              src={ASSETS.lockup}
              fetchPriority="high"
              alt="It's a match!"
            />

            <div className="ff-match__panel" data-match-anim="panel">
              <h1 className="ff-match__count">
                {details?.affiliateMatches === null || details?.affiliateMatches === undefined
                  ? 'Creator matches pending'
                  : `${details.affiliateMatches} ${details.affiliateMatches === 1 ? 'Affiliate' : 'Affiliates'}`}
              </h1>
              <span className="ff-match__types">
                {affiliateTypeLines.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </span>
            </div>

            <span className="ff-match__sub" data-match-anim="sub">
              In your category are ready to promote this
            </span>

            <button
              type="button"
              className="ff-match__cta"
              data-match-anim="cta"
              onClick={(event) => {
                event.stopPropagation();
                advance();
              }}
            >
              Lets start
            </button>
          </div>
        </div>
      </main>

      {portrait && !rotateOk ? (
        <div className="ff-match-rotate" onClick={() => setRotateOk(true)}>
          <img src={ASSETS.logo} alt="proovd" />
          <span className="ff-match-rotate__title">Turn your device sideways</span>
          <span className="ff-match-rotate__body">
            The founder flow is laid out landscape. Rotate to walk it.
          </span>
          <span className="ff-match-rotate__action">Tap to continue anyway</span>
        </div>
      ) : null}
    </>
  );
}
