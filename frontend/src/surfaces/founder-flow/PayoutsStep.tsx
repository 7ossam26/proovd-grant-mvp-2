/**
 * Screen 25 — how you get paid — Founder Flow v2, Session E.
 *
 * §13's hosted onboarding, presented as a page in the sequence. Proovd issues a
 * link and reads a status; it collects nothing, and the absence is the whole
 * point of the screen — the "Prepare:" list names what STRIPE will ask for, on
 * a page from a company that is not the one asking.
 *
 * ── There is no input here, and there is no route that would take one ───────
 * §11 forbids reproducing provider-controlled fields; §5.3 says Proovd stores
 * statuses and IDs and "never full bank details"; §13 forbids storing identity
 * documents. `PAYOUT_PREPARE_COLLECTS_NOTHING` sits WITH the list rather than
 * under it, because a list of things somebody is about to be asked for reads as
 * the start of a form unless the sentence arrives at the same moment. A test
 * asserts this page renders no `input`, `select` or `textarea` at all.
 *
 * ── The reference drew two of §13's five states ─────────────────────────────
 * "Get paid" and "Payouts ready" — `not_started` and `complete`. The other
 * three (more information required, under review, restricted) and the
 * unconfigured case have no screen in the prototype at all, and a fee screen
 * reached from a dead end is a dead end with a payment button on it. Those
 * render through `PayoutOnboarding`, the component §13's four states already
 * live in, rather than through a second copy of the same sentences here.
 *
 * ── Only a complete account offers a way forward ────────────────────────────
 * §13: "no misleading ability to pay the listing fee". `listingFeeEligible` is
 * true only for a COMPLETE seller account, so the fee page refuses for the
 * other three — and a control that opens a page whose server-side answer we
 * already know is a refusal is §1.4's failure with an arrow on it. §13 is
 * strongest about the restricted state; the other two are the same fact with a
 * happier ending, so they are treated the same way.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { PayoutOnboarding, type PayoutState } from '../payouts/PayoutOnboarding.js';
import { fetchPayouts, requestOnboardingLink, PayoutRequestError } from '../payouts/api.js';
import { flowDirection, FlowPage, useFlowNav } from './FlowPage.js';
import { PITCH_DEMO } from './referenceWalkthrough.js';

/**
 * Pitch builds need the complete Founder Flow without pretending that a real
 * payment provider exists. `Take me to stripe` advances to the "You're all set
 * to get paid!" screen and never opens a hosted onboarding link. Development
 * uses the demo unless explicitly disabled; a production build must explicitly
 * set `VITE_PITCH_DEMO=true`.
 */
const PAYOUT_ASSETS = {
  logo: '/assets/proovd-logo.svg',
  stripe: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/stripe.svg',
    import.meta.url,
  ).href,
  id: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-id.svg',
    import.meta.url,
  ).href,
  bank: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-bank.svg',
    import.meta.url,
  ).href,
  ssn: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-ssn.svg',
    import.meta.url,
  ).href,
  piggy: new URL(
    '../../../../docs/design-refrence/Proovd-Founder-Flow-v2/assets/piggy.png',
    import.meta.url,
  ).href,
};

interface PayoutGsap {
  from: (target: unknown, vars: Record<string, unknown>) => void;
  fromTo: (
    target: unknown,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ) => void;
  killTweensOf: (target: unknown) => void;
  set: (target: unknown, vars: Record<string, unknown>) => void;
  to: (target: unknown, vars: Record<string, unknown>) => void;
}

function payoutGsap(): PayoutGsap | undefined {
  return (window as unknown as { gsap?: PayoutGsap }).gsap;
}

function pressCloseButton(event: React.PointerEvent<HTMLButtonElement>) {
  payoutGsap()?.to(event.currentTarget, { scale: 0.78, duration: 0.12, ease: 'power2.out' });
}

function releaseCloseButton(event: React.PointerEvent<HTMLButtonElement>) {
  payoutGsap()?.to(event.currentTarget, { scale: 1, duration: 0.25, ease: 'power3.out' });
}

export function PayoutsStep() {
  const { campaignId = '' } = useParams();
  const [payouts, setPayouts] = useState<PayoutState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPayouts('founder')
      .then((result) => {
        if (!cancelled) setPayouts(result.payouts);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof PayoutRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read your payout setup just now.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) {
    return (
      <FlowPage pageId="payouts" param={campaignId}>
        <div className="ff-money">
          <StatePanel
            state="We could not check your payout setup"
            whatHappened={failure}
            next="Nothing about your account has changed. Reload the page, or contact support if it keeps happening."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference="Payout setup"
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!payouts) return <SurfaceLoading subject="your payout setup" reference="Payout setup" />;

  return (
    <FlowPage pageId="payouts" param={campaignId}>
      <Body payouts={payouts} />
    </FlowPage>
  );
}

function Body({ payouts }: { payouts: PayoutState }) {
  const { leaveToPage, swapToPage } = useFlowNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The demo advance, held here rather than pushed at the server: nothing about
  // the account has changed, and a reload correctly returns to the setup state.
  const [demoComplete, setDemoComplete] = useState(false);

  const start = useCallback(async () => {
    if (PITCH_DEMO) {
      setDemoComplete(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const link = await requestOnboardingLink('founder');
      window.location.assign(link.url);
    } catch (cause: unknown) {
      setBusy(false);
      setError(
        cause instanceof PayoutRequestError
          ? (cause.detail.whatHappened ?? cause.detail.title)
          : 'We could not open Stripe. Nothing has changed.',
      );
    }
  }, []);

  // The reference swaps the state immediately and lets the arriving screen
  // relay in from the left. There is no outgoing fade on this Back action.
  const back = () => swapToPage('rewards', -1);

  if (demoComplete || payouts.state === 'complete') {
    return (
      <ReferenceShell onBack={back}>
        <ReferenceStage key="complete" state="complete">
          <div className="ff-payout-ref__paid-lockup">
            <h1 data-payout-anim="head" className="ff-payout-ref__paid-head">
              You’re all set to get paid!
            </h1>
            <img
              data-payout-grow="1"
              className="ff-payout-ref__piggy"
              src={PAYOUT_ASSETS.piggy}
              alt=""
            />
            <button
              type="button"
              data-payout-anim="cta"
              className="ff-payout-ref__paid-cta"
              aria-label="Continue to campaign review"
              onClick={() => leaveToPage('in-review')}
            >
              Continue
            </button>
          </div>
        </ReferenceStage>
      </ReferenceShell>
    );
  }

  // These server states do not exist in the prototype. Keep the product's
  // exact missing-requirement, review, and restriction behavior for them.
  //
  // Only the `onboardingAvailable` half is relaxed for a pitch build. A
  // deployment with no Stripe Connect URLs is exactly the one a pitch runs on,
  // so refusing there would hide the screen the demo exists to show — while a
  // genuinely restricted or under-review account still renders its own state.
  if (payouts.state !== 'not_started' || (!payouts.onboardingAvailable && !PITCH_DEMO)) {
    return (
      <ReferenceShell onBack={back}>
        <div className="ff-payout-ref__fallback">
          <h1 className="ff-money__title">How you get paid</h1>
          <div className="ff-money__panel">
            <PayoutOnboarding payouts={payouts} role="founder" onStart={start} />
          </div>
        </div>
      </ReferenceShell>
    );
  }

  return (
    <ReferenceShell onBack={back}>
      <ReferenceStage key="setup" state="setup">
        <div className="ff-payout-ref__setup-lockup">
          <h1 data-payout-anim="head" className="ff-payout-ref__setup-head">
            Setup how you get paid
          </h1>
          <div data-payout-anim="panel" className="ff-payout-ref__prepare">
            <div className="ff-payout-ref__prepare-head">
              <span>Prepare:</span>
              <img src={PAYOUT_ASSETS.stripe} alt="stripe" />
            </div>
            <div className="ff-payout-ref__items">
              <PayoutPrepareItem icon={PAYOUT_ASSETS.id}>A government ID</PayoutPrepareItem>
              <PayoutPrepareItem icon={PAYOUT_ASSETS.bank}>
                Your US bank account details
              </PayoutPrepareItem>
              <PayoutPrepareItem icon={PAYOUT_ASSETS.ssn}>
                Your SSN or EIN if you have a business
              </PayoutPrepareItem>
            </div>
          </div>
          <button
            type="button"
            data-payout-anim="cta"
            className="ff-payout-ref__setup-cta"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? 'Opening Stripe…' : 'Take me to stripe'}
          </button>
          {error ? (
            <p className="ff-payout-ref__error" role="alert">
              {error} Nothing about your account has changed.
            </p>
          ) : null}
        </div>
      </ReferenceStage>
    </ReferenceShell>
  );
}

function ReferenceShell({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const { campaignId = '' } = useParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!drawerOpen) return;
    const gsap = payoutGsap();
    const drawer = drawerRef.current;
    const scrim = scrimRef.current;
    if (!gsap) return;

    if (scrim) gsap.from(scrim, { opacity: 0, duration: 0.25 });
    if (drawer) gsap.from(drawer, { xPercent: 100, duration: 0.4, ease: 'power3.out' });

    return () => {
      if (scrim) gsap.killTweensOf(scrim);
      if (drawer) gsap.killTweensOf(drawer);
    };
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => {
    if (drawerClosing) return;
    const gsap = payoutGsap();
    const drawer = drawerRef.current;
    const done = () => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    };

    setDrawerClosing(true);
    if (gsap && drawer) {
      gsap.to(drawer, { xPercent: 100, duration: 0.28, ease: 'power2.in', onComplete: done });
    } else {
      done();
    }
  }, [drawerClosing]);

  return (
    <section className="ff-payout-ref">
      <button
        type="button"
        className="ff-payout-ref__back"
        aria-label="Back to your Backer rewards"
        onClick={onBack}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>
      <header className="ff-payout-ref__top">
        <img src={PAYOUT_ASSETS.logo} alt="proovd" className="ff-payout-ref__logo" />
        <button type="button" className="ff-payout-ref__help" onClick={() => setDrawerOpen(true)}>
          Help
        </button>
      </header>
      {children}
      {drawerOpen ? (
        <>
          <div ref={scrimRef} className="ff-payout-ref__scrim" onClick={closeDrawer} />
          <aside ref={drawerRef} className="ff-payout-ref__drawer" role="dialog" aria-modal="true" aria-label="Help">
            <div className="ff-payout-ref__drawer-head">
              <span>Help</span>
              <button
                type="button"
                onClick={closeDrawer}
                onPointerDown={pressCloseButton}
                onPointerUp={releaseCloseButton}
                onPointerCancel={releaseCloseButton}
                onPointerLeave={releaseCloseButton}
                aria-label="Close help"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="ff-payout-ref__drawer-intro">Help for this page</div>
            <div className="ff-payout-ref__docs">
              <section className="ff-payout-ref__doc is-current">
                <span className="ff-payout-ref__doc-title">Stripe payout onboarding</span>
                <span className="ff-payout-ref__doc-body">Stripe collects and verifies identity, tax, and bank details on its hosted page. Proovd stores only the resulting account status and identifiers.</span>
                <a href={`/support?reference=${encodeURIComponent(campaignId)}`}>Contact Proovd support</a>
              </section>
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}

function ReferenceStage({ children, state }: { children: ReactNode; state: 'setup' | 'complete' }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef(flowDirection());

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

    const gsap = payoutGsap();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animated = Array.from(stage.querySelectorAll('[data-payout-anim]'));
    const grow = stage.querySelector('[data-payout-grow]');

    if (gsap && !reduced) {
      if (state === 'setup') {
        gsap.fromTo(
          animated,
          { x: 150 * directionRef.current, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.62,
            ease: 'power3.out',
            stagger: { each: 0.085, from: directionRef.current === -1 ? 'end' : 'start' },
            force3D: true,
            clearProps: 'transform,opacity',
          },
        );
      } else if (grow) {
        gsap.set(animated, { opacity: 0 });
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
                animated,
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
    }

    const sweep = window.setTimeout(() => {
      if (gsap) gsap.set([...animated, ...(grow ? [grow] : [])], { clearProps: 'transform,opacity' });
    }, 2200);

    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', settle);
      window.clearTimeout(sweep);
      if (gsap) gsap.killTweensOf([...animated, ...(grow ? [grow] : [])]);
    };
  }, [state]);

  return (
    <div className="ff-payout-ref__stage" ref={stageRef}>
      {children}
    </div>
  );
}

function PayoutPrepareItem({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="ff-payout-ref__item">
      <img src={icon} alt="" />
      <span>{children}</span>

    </div>
  );
}
