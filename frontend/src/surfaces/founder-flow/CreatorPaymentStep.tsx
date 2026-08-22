import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fetchOpenness,
  recordOpenness,
  FounderRequestError,
  type OpennessState,
} from '../founder/api.js';
import { FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';

const STAGE_WIDTH = 2496;
const STAGE_HEIGHT = 1542;
const PAGE_SCALE = 0.78;

const PAYMENT_MODELS = [
  {
    stance: 'not_open' as const,
    title: 'No optional fixed Creator payment',
    art: '/assets/pie-cursor.png',
    body: 'Creators are paid only through their agreed share of captured pre-orders.',
  },
  {
    stance: 'open' as const,
    title: 'Open to an optional fixed Creator payment',
    art: '/assets/cash-hand.png',
    body: 'A Creator may propose a fixed payment alongside a lower agreed percentage. Nothing is agreed on this screen.',
  },
] as const;

function fittedScale(): number {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT) * PAGE_SCALE;
}

export function CreatorPaymentStep() {
  const { campaignId = '' } = useParams();
  const [openness, setOpenness] = useState<OpennessState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOpenness(campaignId)
      .then(({ openness: result }) => {
        if (!cancelled) setOpenness(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not open this step.',
        );
      });
    return () => { cancelled = true; };
  }, [campaignId]);

  if (failure) {
    return (
      <FlowPage pageId="creator-payment" param={campaignId}>
        <StatePanel
          state="We could not open this step"
          whatHappened={failure}
          next="Reload the page. Nothing about your campaign has changed."
          owner="Proovd"
          nextUpdate="As soon as you reload"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: '/support' }}
          ring
        />
      </FlowPage>
    );
  }

  if (!openness) return <SurfaceLoading subject="this step" reference="Your campaign" />;

  return (
    <FlowPage pageId="creator-payment" param={campaignId}>
      {openness.applicable ? (
        <PaymentPicker openness={openness} campaignId={campaignId} onRecorded={setOpenness} />
      ) : (
        <PaymentExplainer />
      )}
    </FlowPage>
  );
}

function ReferenceChrome({ backLabel }: { backLabel: string }) {
  const { param, swapToPage } = useFlowNav();
  return (
    <>
      <button type="button" className="ff-paypick__back" aria-label={backLabel} onClick={() => swapToPage('match', -1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
        Back
      </button>
      <header className="ff-paypick__top">
        <img className="ff-paypick__logo" src="/assets/proovd-logo.svg" alt="proovd" />
        <HelpDrawer
          pageId="creator-payment"
          param={param}
          trigger={<button type="button" className="ff-paypick__help">Help</button>}
        />
      </header>
    </>
  );
}

function PaymentPicker({ openness, campaignId, onRecorded }: {
  openness: OpennessState;
  campaignId: string;
  onRecorded: (next: OpennessState) => void;
}) {
  const { swapToPage } = useFlowNav();
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(openness.stance === 'open' ? 1 : 0);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = PAYMENT_MODELS[index];

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => { el.style.transform = `translate(-50%, -50%) scale(${fittedScale()})`; };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const choose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await recordOpenness(campaignId, model.stance);
      onRecorded(result.openness);
      if (model.stance === 'open') {
        setModal(true);
        setBusy(false);
      } else {
        swapToPage('fee', 1);
      }
    } catch (cause: unknown) {
      setBusy(false);
      setError(
        cause instanceof FounderRequestError
          ? (cause.detail.whatHappened ?? cause.detail.title)
          : 'We could not record that. Nothing has changed.',
      );
    }
  }, [campaignId, model.stance, onRecorded, swapToPage]);

  const move = (delta: number) => setIndex((current) => (current + delta + PAYMENT_MODELS.length) % PAYMENT_MODELS.length);

  return (
    <section className="ff-paypick" data-paypick="1">
      <ReferenceChrome backLabel="Back to Creator match" />
      {modal ? (
        <div className="ff-paypick__modal-layer" role="presentation">
          <div className="ff-paypick__modal" role="dialog" aria-modal="true" aria-labelledby="fixed-payment-title" data-pay-modal="1">
            <span id="fixed-payment-title" className="ff-paypick__modal-tag">Optional fixed Creator payment</span>
            <p>A Proovd representative will help both sides record a proposal. Nothing is agreed until the Creator and Founder accept the same version.</p>
            <button type="button" onClick={() => swapToPage('fee', 1)}>Got it</button>
          </div>
        </div>
      ) : null}
      <div className="ff-paypick__stage" data-page-stage="1" ref={stage}>
        <div className="ff-paypick__column">
          <span className="ff-paypick__note" data-anim="note">Choose your creator payment structure</span>
          <h1 className="ff-paypick__title" data-anim="head">{model.title}</h1>
          <div className="ff-paypick__art-row" data-anim="art">
            <ArrowButton direction="left" onClick={() => move(-1)} />
            <span key={model.art} className="ff-paypick__art" data-pay-art="1" style={{ backgroundImage: `url(${model.art})` }} role="img" aria-label={model.title} />
            <ArrowButton direction="right" onClick={() => move(1)} />
          </div>
          <p className="ff-paypick__body" data-anim="body">{model.body}</p>
          {error ? <p className="ff-paypick__error" role="alert">{error}</p> : null}
          <button type="button" className="ff-paypick__cta" data-anim="cta" disabled={busy} onClick={() => void choose()}>
            {busy ? 'Selecting…' : 'Select'}
          </button>
        </div>
      </div>
    </section>
  );
}

function ArrowButton({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  return (
    <button type="button" className="ff-paypick__arrow" aria-label={`${direction === 'left' ? 'Previous' : 'Next'} payment structure`} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={direction === 'left' ? 'M15 5 8 12l7 7' : 'm9 5 7 7-7 7'} /></svg>
    </button>
  );
}

function PaymentExplainer() {
  const { swapToPage } = useFlowNav();
  const stage = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => { el.style.transform = `translate(-50%, -50%) scale(${fittedScale()})`; };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <section className="ff-paypick ff-paypick--explainer" data-pay="1">
      <ReferenceChrome backLabel="Back to Creator match" />
      <div className="ff-paypick__stage" data-page-stage="1" ref={stage}>
        <div className="ff-paypick__explainer-column">
          <img className="ff-paypick__explainer-art" data-anim="art" src="/assets/pie-cursor.png" alt="" />
          <h1 className="ff-paypick__explainer-title" data-anim="head">Creators earn an agreed share<br />of captured pre-orders</h1>
          <button type="button" className="ff-paypick__explainer-cta" data-anim="cta" onClick={() => swapToPage('fee', 1)}>I understand</button>
        </div>
      </div>
    </section>
  );
}
