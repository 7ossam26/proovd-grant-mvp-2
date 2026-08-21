/**
 * The reference's `CREATOR PAY` (`scPay`) beat, inserted between brand voice
 * and FAQs. This is deliberately separate from `CreatorPaymentStep`: that
 * earlier page records the product's fixed-payment openness decision, while
 * this page is the supplied explanatory screen and records nothing.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { stageRelayIn } from '../../components/anim.js';
import { FlowPage, flowDirection, useFlowNav } from './FlowPage.js';

const FIT_WIDTH = 2496;
const FIT_HEIGHT = 1542;
const PAGE_SCALE = 0.78;

/** `verifyIntro`'s fixed order, filtered to the elements on this screen. */
const RELAY = ['head', 'art', 'cta'] as const;

function fittedScale(): number {
  return Math.min(window.innerWidth / FIT_WIDTH, window.innerHeight / FIT_HEIGHT) * PAGE_SCALE;
}

export function CreatorPayExplainerStep() {
  const { campaignId = '' } = useParams();

  return (
    <FlowPage pageId="creator-pay-explainer" param={campaignId}>
      <CreatorPayExplainerScreen />
    </FlowPage>
  );
}

function CreatorPayExplainerScreen() {
  const { swapToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const direction = useRef<1 | -1>(flowDirection());

  // The reference authors the desktop composition once at 2496x1542 and fits
  // it with `min(viewport/stage) * pageScale` on every resize.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${fittedScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Reference `verifyIntro`: x:150 → 0, opacity:0 → 1, .62s power3.out,
  // .085s stagger; reverse the order when returning from FAQs.
  useLayoutEffect(
    () => stageRelayIn(root.current, direction.current, RELAY),
    [],
  );

  return (
    <div className="ff-payx" ref={root}>
      <button
        type="button"
        className="ff-payx__back"
        aria-label="Back to your brand voice"
        onClick={() => swapToPage('voice', -1)}
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

      <div className="ff-payx__top">
        <img className="ff-payx__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <ReferencePayHelp />
      </div>

      <div className="ff-payx__stage" data-page-stage="1" ref={stage}>
        <div className="ff-payx__column">
          <img
            className="ff-payx__art"
            data-stage-anim="art"
            src="/assets/pie-cursor.png"
            alt=""
          />
          <h1 className="ff-payx__title" data-stage-anim="head">
            Creators take a % of the preorders<br />so you pay nothing upfront
          </h1>
          <button
            type="button"
            className="ff-payx__cta"
            data-stage-anim="cta"
            onClick={() => swapToPage('faqs', 1)}
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}

function ReferencePayHelp() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 280);
  };

  return (
    <>
      <button type="button" className="ff-payx__help" onClick={() => setOpen(true)}>
        Help
      </button>
      {open ? (
        <>
          <button
            type="button"
            className={closing ? 'ff-payx__scrim is-closing' : 'ff-payx__scrim'}
            aria-label="Close help"
            onClick={close}
          />
          <aside
            className={closing ? 'ff-payx__drawer is-closing' : 'ff-payx__drawer'}
            aria-label="Help"
          >
            <div className="ff-payx__drawer-head">
              <span>Help</span>
              <button type="button" className="ff-payx__drawer-close" onClick={close}>
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
            <div className="ff-payx__drawer-intro">Reading for this page</div>
            <div className="ff-payx__docs">
              <button type="button" className="ff-payx__doc is-current">
                <span className="ff-payx__doc-copy">
                  <span className="ff-payx__doc-tag">PDF · 0.9 MB</span>
                  <span className="ff-payx__doc-title">Creator commission, worked example.pdf</span>
                </span>
                <span className="ff-payx__doc-body">
                  A $40,000 campaign, line by line, both pay models.
                </span>
              </button>
              <button type="button" className="ff-payx__doc">
                <span className="ff-payx__doc-copy">
                  <span className="ff-payx__doc-tag">GUIDE · 4.2 MB</span>
                  <span className="ff-payx__doc-title">Proovd founder handbook.pdf</span>
                </span>
                <span className="ff-payx__doc-body">
                  Every step of the flow in one document. Worth a skim.
                </span>
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
