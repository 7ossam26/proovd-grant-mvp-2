/**
 * Screen 22 — Set your order goal, rebuilt from the reference's `scGoal`.
 * The fixed stage, copy, states, relay, $500 beat, and Help drawer below are
 * the reference implementation. The existing API still persists the value.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { NO_ACTION, StatePanel } from '../../components/index.js';
import {
  referenceDrawerClose,
  referenceDrawerOpen,
  stageRelayIn,
  thresholdFloorPop,
} from '../../components/anim.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { FlowPage, flowDirection, useFlowNav } from './FlowPage.js';
import { useBuildFlow, type BuildFlowState } from './useBuild.js';

const FIT_W = 2496;
const FIT_H = 1542;
const PAGE_SCALE = 0.78;
const RELAY = ['note', 'sub', 'panel', 'cta'] as const;

function stageScale(): string {
  return (Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE).toFixed(4);
}

export function ThresholdStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);

  if (build.failure) {
    return (
      <FlowPage pageId="threshold" param={campaignId}>
        <div className="ff-goal__state">
          <StatePanel state="We could not open your campaign page" whatHappened={build.failure}
            next="Reload the page. Everything you have already saved is on your campaign."
            owner="Proovd" nextUpdate="As soon as you reload" action={NO_ACTION}
            reference={campaignId} getHelp={{ href: '/support' }} ring />
        </div>
      </FlowPage>
    );
  }
  if (!build.state) return <SurfaceLoading subject="your campaign page" reference="Your campaign" />;
  if (build.state.model !== 'idea') {
    return (
      <FlowPage pageId="threshold" param={campaignId}>
        <div className="ff-goal__state">
          <StatePanel state="This step is for Idea Campaigns"
            whatHappened="A Product Campaign has no public order threshold."
            next="Carry on with your FAQs." owner="You" nextUpdate="No further update needed"
            action={NO_ACTION} reference={campaignId} />
        </div>
      </FlowPage>
    );
  }
  return (
    <FlowPage pageId="threshold" param={campaignId}>
      <GoalScreen campaignId={campaignId} build={build} />
    </FlowPage>
  );
}

function GoalScreen({ campaignId, build }: { campaignId: string; build: BuildFlowState }) {
  const { swapToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const stored = build.state?.build?.orderThreshold;
  const initial = useMemo(() => stored === null || stored === undefined ? '' : String(stored), [stored]);
  const [digits, setDigits] = useState(initial);
  const [drawer, setDrawer] = useState(false);
  const amount = Number(digits || 0);
  const empty = digits === '';
  const low = !empty && amount < 500;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => { el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`; };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const write = useCallback((next: string) => {
    const onlyDigits = next.replace(/[^0-9]/g, '');
    setDigits(onlyDigits);
    build.autosave.queue({ orderThreshold: onlyDigits === '' ? null : Number(onlyDigits) });
  }, [build.autosave]);

  const continueToFaqs = useCallback(() => {
    if (empty) return;
    if (amount < 500) {
      setDigits('500');
      build.autosave.queue({ orderThreshold: 500 });
      void build.autosave.flush();
      thresholdFloorPop(input.current);
      timer.current = window.setTimeout(() => swapToPage('faqs'), 450);
      return;
    }
    void build.autosave.flush();
    swapToPage('faqs');
  }, [amount, build.autosave, empty, swapToPage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || drawer || amount < 500) return;
      event.preventDefault();
      continueToFaqs();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [amount, continueToFaqs, drawer]);

  return (
    <div className="ff-goal" ref={root}>
      <button type="button" className="ff-goal__back" aria-label="Back to your brand voice"
        onClick={() => { void build.autosave.flush(); swapToPage('voice', -1); }}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-goal__top">
        <img className="ff-goal__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <button type="button" className="ff-goal__help" onClick={() => setDrawer(true)}>Help</button>
      </div>

      <div className="ff-goal__stage" data-page-stage="1" ref={stage}>
        <div className="ff-goal__column">
          <h1 className="ff-goal__note" data-stage-anim="note">Set your order goal</h1>
          <span className="ff-goal__sub" data-stage-anim="sub">(USD)</span>
          <div className="ff-goal__panel" data-stage-anim="panel" data-empty={empty ? 'true' : 'false'}>
            <input id="goalInput" ref={input} className="ff-goal__input" inputMode="numeric"
              aria-label="Order goal in US dollars"
              value={empty ? '' : `$${amount.toLocaleString('en-US')}`}
              onChange={(event) => write(event.currentTarget.value)} />
            {empty ? (
              <span className="ff-goal__placeholder" aria-hidden="true">
                <span className="ff-goal__example">Ex:</span>
                <span className="ff-goal__example-value">$1,000</span>
                <span className="ff-goal__minimum">Min.&nbsp;&nbsp;$500</span>
              </span>
            ) : null}
          </div>
          {empty ? <p className="ff-goal__body">This should be high enough that you and the affiliates are excited, and low enough that you and the backers belive its achievable.</p> : null}
          {low ? <span className="ff-goal__hint">Minimum goal is $500</span> : null}
          {!empty ? <button type="button" className="ff-goal__continue" data-stage-anim="cta"
            onClick={continueToFaqs}>Continue</button> : null}
        </div>
      </div>

      <span className="ff-goal__save" role="status" aria-live="polite">{build.autosave.state.status}</span>
      {drawer ? <GoalHelpDrawer campaignId={campaignId} onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}

function GoalHelpDrawer({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const aside = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => referenceDrawerOpen(aside.current, scrim.current), []);
  const close = useCallback(() => referenceDrawerClose(aside.current, onClose), [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <>
      <div className="ff-goal-help__scrim" ref={scrim} onClick={close} />
      <aside className="ff-goal-help" ref={aside} aria-label="Help">
        <div className="ff-goal-help__head"><span>Help</span>
          <button type="button" onClick={close} aria-label="Close help">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="ff-goal-help__intro">Reading for this page</div>
        <div className="ff-goal-help__docs">
          <button type="button" className="is-current"><span className="ff-goal-help__tag">PDF · 0.8 MB</span>
            <strong>Setting a goal you can deliver.pdf</strong><span>Sizing a target against your production run.</span></button>
          <button type="button"><span className="ff-goal-help__tag">GUIDE · 4.2 MB</span>
            <strong>Proovd founder handbook.pdf</strong><span>Every step of the flow in one document. Worth a skim.</span></button>
        </div>
        <span className="ff-goal-help__reference">{campaignId}</span>
      </aside>
    </>
  );
}
