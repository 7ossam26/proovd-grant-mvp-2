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

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  PAYOUTS_BEFORE_FEE,
  PAYOUT_PREPARE_COLLECTS_NOTHING,
  STRIPE_PREPARE_ITEMS,
} from '@proovd/shared';
import { Button, StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { PayoutOnboarding, type PayoutState } from '../payouts/PayoutOnboarding.js';
import { fetchPayouts, requestOnboardingLink, PayoutRequestError } from '../payouts/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

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
    <FlowPage pageId="payouts" param={campaignId} badge>
      <Body payouts={payouts} />
    </FlowPage>
  );
}

function Body({ payouts }: { payouts: PayoutState }) {
  const { leaveToPage } = useFlowNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const link = await requestOnboardingLink('founder');
      window.location.assign(link.url);
    } catch (e: unknown) {
      setBusy(false);
      setError(
        e instanceof PayoutRequestError
          ? (e.detail.whatHappened ?? e.detail.title)
          : 'We could not open Stripe. Nothing has changed.',
      );
    }
  }, []);

  const back = (
    <Button tier="tertiary" onClick={() => leaveToPage('last-look', -1)}>
      Back to Last look
    </Button>
  );

  /* ── §13: complete. The reference's "You're all set to get paid!" ───────── */

  if (payouts.state === 'complete') {
    return (
      <div className="ff-money ff-money--done">
        <h1 className="ff-money__title" data-anim="head">
          You’re all set to get paid!
        </h1>
        <p className="ff-money__lede" data-anim="sub">
          Stripe has everything it needs from you. Your campaign can take pre-orders when it goes
          live, and the money lands in your own account.
        </p>
        <div className="ff-nav" data-anim="cta">
          {back}
          {/* §33.11.4: a control names its destination. The reference's own
              label here is `Continue`, and the next thing is money. */}
          <Button tier="primary" onClick={() => leaveToPage('fee')}>
            Continue to your listing fee
          </Button>
        </div>
      </div>
    );
  }

  /* ── §13's other three states, and the unconfigured case ────────────────── */

  if (payouts.state !== 'not_started' || !payouts.onboardingAvailable) {
    return (
      <div className="ff-money">
        <h1 className="ff-money__title" data-anim="head">
          How you get paid
        </h1>
        <div className="ff-money__panel" data-anim="panel">
          <PayoutOnboarding payouts={payouts} role="founder" onStart={start} />
        </div>
        {/* No forward control on any of these three. `listingFeeEligible` is
            true only for a COMPLETE seller account, so the fee page refuses
            for all of them — and offering to open a page whose server-side
            answer we already know is a refusal is §1.4's failure with an
            arrow on it. §13 is strongest about the restricted one ("no
            misleading ability to pay the listing fee") and the other two are
            the same fact with a happier ending. The resume action, where
            there is one, is inside the panel above. */}
        <div className="ff-nav" data-anim="cta">{back}</div>
      </div>
    );
  }

  /* ── Not started. The reference's "Setup how you get paid" ──────────────── */

  return (
    <div className="ff-money">
      <h1 className="ff-money__title ff-money__title--small" data-anim="head">
        Set up how you get paid
      </h1>
      <p className="ff-money__lede" data-anim="sub">
        {PAYOUTS_BEFORE_FEE}
      </p>

      <div className="ff-prepare" data-anim="panel">
        <div className="ff-prepare__head">
          <h2 className="ff-prepare__title">Prepare:</h2>
          {/* The provider's own name, as text. An image here would be a claim
              rendered as a logo, and the sentence below is what carries it. */}
          <span className="ff-prepare__mark">Stripe</span>
        </div>
        <ul className="ff-prepare__list">
          {STRIPE_PREPARE_ITEMS.map((item) => (
            <li className="ff-prepare__item" key={item.key}>
              <span className="ff-prepare__label">{item.label}</span>
              <span className="ff-prepare__why">{item.why}</span>
            </li>
          ))}
        </ul>
        <p className="ff-prepare__note">{PAYOUT_PREPARE_COLLECTS_NOTHING}</p>
      </div>

      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error}</p>
          <p className="fine">Nothing about your account has changed.</p>
        </div>
      ) : null}

      <div className="ff-nav" data-anim="cta">
        {back}
        <Button tier="primary" onClick={() => void start()} disabled={busy}>
          {busy ? 'Opening Stripe…' : 'Take me to Stripe'}
        </Button>
      </div>
      {/* §1.4: Stripe does not return anybody HERE. §32.2 gives Connect one
          configured return address per deployment, and it is `/stripe/return`,
          which re-reads the account and renders whichever of §13's states is
          actually true. Saying "this page" would name the wrong destination on
          the screen somebody reads before leaving. */}
      <p className="ff-money__foot">
        Stripe opens in this tab. When you finish there we show you what Stripe said, and your
        campaigns are one step away.
      </p>
    </div>
  );
}
