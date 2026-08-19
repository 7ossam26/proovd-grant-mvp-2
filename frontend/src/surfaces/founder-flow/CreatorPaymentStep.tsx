/**
 * Screen 18 — how Creators are paid — Founder Flow v2, Session F.
 *
 * The screen for **deviation 3**, the fixed-payment openness record: whether the
 * Founder would consider funding an optional fixed Creator payment, and nothing
 * else. It sits after the listing fee because Phase 11's effect 4 is what opens
 * the formal Creator opportunity — before that there is no Creator to be open
 * to.
 *
 * ── It is not a choice of pay structure, and that is the whole design ───────
 * The reference draws a pager over two structures with a Select button. §16
 * makes the optional fixed Creator payment the CREATOR's request, accepted
 * bilaterally through one §14.2 proposal version — so a Founder picking one
 * here would be making the offer only a Creator may make. What is collected is
 * an openness: three answers, no amount, no percentage, no proposal reference,
 * and a record with no column for any of them.
 *
 * ── An Idea campaign gets an explanation and no control at all ──────────────
 * §14.3 prohibits the fixed Creator payment there. The server answers
 * `applicable: false`, the page renders the explanation, and there is no
 * control to disable — the absence IS the rule (§1.4). The database refuses it
 * twice more regardless (a 0052 CHECK and a shape trigger).
 *
 * ── The percentages are the settings ────────────────────────────────────────
 * §14.3's 30% and 20% are `affiliate_base_percent_standard` and
 * `affiliate_base_percent_with_fixed`, read on every request. Phase 06's rule:
 * a hardcoded number is a bug even when it is right. There is no number in this
 * file.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  FIXED_PAYMENT_BINDS_NOBODY,
  FIXED_PAYMENT_IDEA_EXPLAINER,
  FIXED_PAYMENT_STANCES,
  FIXED_PAYMENT_TERMS_COME_LATER,
  type FixedPaymentStance,
} from '@proovd/shared';
import { Button, Choice, StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fetchOpenness,
  recordOpenness,
  FounderRequestError,
  type OpennessState,
} from '../founder/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

export function CreatorPaymentStep() {
  const { campaignId = '' } = useParams();
  const [openness, setOpenness] = useState<OpennessState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOpenness(campaignId)
      .then((result) => {
        if (!cancelled) setOpenness(result.openness);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not open this step.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (failure) {
    return (
      <FlowPage pageId="creator-payment" param={campaignId}>
        <div className="ff-money">
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
        </div>
      </FlowPage>
    );
  }

  if (!openness) return <SurfaceLoading subject="this step" reference="Your campaign" />;

  return (
    <FlowPage pageId="creator-payment" param={campaignId} badge>
      <Body openness={openness} campaignId={campaignId} onRecorded={setOpenness} />
    </FlowPage>
  );
}

function Body({
  openness,
  campaignId,
  onRecorded,
}: {
  openness: OpennessState;
  campaignId: string;
  onRecorded: (next: OpennessState) => void;
}) {
  const { leaveToPage } = useFlowNav();
  const [chosen, setChosen] = useState<string>(openness.stance ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordOpenness(campaignId, chosen as FixedPaymentStance);
      onRecorded(result.openness);
      leaveToPage('voice');
    } catch (e: unknown) {
      setBusy(false);
      setError(
        e instanceof FounderRequestError
          ? (e.detail.whatHappened ?? e.detail.title)
          : 'We could not record that. Nothing has changed.',
      );
    }
  }, [campaignId, chosen, leaveToPage, onRecorded]);

  /* ── §14.3: an Idea Campaign has nothing to be open to ─────────────────── */

  if (!openness.applicable) {
    return (
      <div className="ff-pay">
        <h1 className="ff-money__title" data-anim="head">
          How Creators are paid
        </h1>
        <p className="ff-money__lede" data-anim="sub">
          Creators take {openness.standardBasePercent}% of what your campaign collects, before
          sales tax. They are paid when you are — never before.
        </p>
        {/* No control, because there is nothing to answer. §14.3 prohibits the
            fixed Creator payment on an Idea Campaign, and a disabled control
            would imply a decision somebody could make (§1.4). */}
        <p className="ff-pay__explainer" data-anim="panel">
          {FIXED_PAYMENT_IDEA_EXPLAINER}
        </p>
        <div className="ff-nav" data-anim="cta">
          <Button tier="primary" onClick={() => leaveToPage('voice')}>
            Start your campaign page
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ff-pay">
      <h1 className="ff-money__title ff-money__title--small" data-anim="head">
        How Creators are paid
      </h1>
      <p className="ff-money__lede" data-anim="sub">
        Creators take {openness.standardBasePercent}% of what your campaign collects, before sales
        tax. They are paid when you are — never before.
      </p>

      <div className="ff-pay__panel" data-anim="panel">
        <h2 className="ff-money__sub">One Creator may ask for something different</h2>
        <p className="ff-money__lede">
          On a Product Campaign a Creator can ask to be paid a fixed amount as well. Where that is
          agreed, their share of what the campaign collects drops from{' '}
          {openness.standardBasePercent}% to {openness.withFixedBasePercent}%.
        </p>
        {/* Pinned. A screen that collected this without saying it reads as the
            offer, which is the one thing §16 says a Founder does not make. */}
        <p className="ff-pay__pinned">{FIXED_PAYMENT_BINDS_NOBODY}</p>
        <p className="ff-pay__pinned">{FIXED_PAYMENT_TERMS_COME_LATER}</p>
      </div>

      <fieldset className="ff-pay__choice">
        <legend className="ff-money__sub">
          Would you consider funding a fixed Creator payment?
        </legend>
        <Choice
          label="Would you consider funding a fixed Creator payment?"
          value={chosen}
          onValueChange={setChosen}
          entries={FIXED_PAYMENT_STANCES.map((stance) => ({
            value: stance.value,
            label: stance.label,
            sub: stance.meaning,
          }))}
        />
      </fieldset>

      {openness.stance ? (
        <p className="ff-money__foot">
          Your answer is recorded. Choosing another one replaces it, and we keep both.
        </p>
      ) : null}

      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('fee', -1)}>
          Back to your listing fee
        </Button>
        <Button tier="primary" onClick={() => void save()} disabled={busy || !chosen}>
          {busy ? 'Recording…' : 'Save and start your campaign page'}
        </Button>
      </div>
    </div>
  );
}
