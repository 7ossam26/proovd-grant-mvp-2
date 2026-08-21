/**
 * Screen 20 — you're in, please pay — rebuilt 1:1 from the reference.
 *
 * REBUILT FROM SCRATCH 2026-08-21 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-paynow]` / `kindWide`) and its
 * screenshot. What stood here was Session E's `.ff-money` layout — a token-scale
 * title, a `clamp()` hero, a `dl` of fee lines, a billing panel and a two-button
 * nav row, then a second screen for the quote and the consent. None of that
 * markup is left.
 *
 * `isPayNow(c){ return (c||this.cur())==='fee'; }` — the listing fee, reached
 * from `model` (Creator pay) and leaving to `build`.
 *
 * ── The layout model is the reference's, literally ─────────────────────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names `fee`, so this screen takes `pageScale`
 * alone — unlike Last look's `s *= .9` or `problem`/`solution`'s `s *= 1.38`.
 * Measured against the reference in Chrome at 1320x900 it reports
 * `scale(0.4125)`, which is exactly that expression.
 *
 * Inside the stage sits a 2220px column, centred, `flex-direction: column;
 * align-items: center`, and every child carries the reference's own pixel value
 * on that stage: a 118px headline, then 150px to a 290px number, 110px to the
 * saving, 110px to the 1130x130 discount control, 36px to the 1130x150 CTA.
 * Nothing reflows; the stage scales, which is why the composition is identical
 * at every viewport (§33.11.1) — and `isClaimPhone()` returns `false` in the
 * reference ("one composition everywhere: the phone posture stays off"), so its
 * `kindPhone` branch is dead code and this is what every viewport gets.
 *
 * ── The entrance is this flow's one title-FIRST page ───────────────────────
 * `verifyIntro` names it: `const bigFirst = !back && !growFirst &&
 * root.matches('[data-paynow]')`. The headline opens large in the middle of the
 * VIEWPORT, travels and shrinks into its real place over 1.15s, and only then
 * do the number, the saving, the discount control and the CTA relay in behind
 * it. `stageBigHeadIn` is that branch, tween for tween; on a BACK arrival
 * `bigFirst` is false there, so this uses the ordinary `stageRelayIn` with the
 * head IN the order and the stagger running from the end.
 *
 * ── Every amount is the server's, in the reference's own shape ─────────────
 * The prototype hardcodes `FEE_BASE=35`, `FEE_FLOOR=25`, `FEE_PER=2` and builds
 * three of its five strings from them. All four are §6 settings and Phase 06's
 * rule is unambiguous — "a hardcoded duration is a bug even when the number is
 * right. Read the setting." So the sentences are the reference's copy and the
 * amounts come from `fee`, formatted and never calculated:
 *
 *   `${{ feeNow }}`   → `$` + the server's subtotal
 *   `paySavedText`    → `payoutSavedLine(the server's discount)`
 *   `payDiscountText` → `payoutDiscountLine(the server's remaining discount)`
 *   `payCanLower`     → that remaining discount, above zero
 *
 * The last is the one that could not be done here: the reference writes
 * `fee() - FEE_FLOOR`, which is only the remaining discount while `base − cap`
 * and the floor coincide — they do on the seeded §6 numbers and need not after
 * an Admin edits one of the four. `workspace/listing-fee.ts` derives it beside
 * §12's own arithmetic and sends it as `remainingDiscountCents`.
 *
 * `You saved $0 by doing bonus tasks` is DELIBERATELY REINSTATED — see
 * `payoutSavedLine`, which records the inversion.
 *
 * ── What the reference has no room for, and where it went ──────────────────
 * `payAndStart` advances a step there. Here it opens a charge, and §13 requires
 * a billing address, a real Stripe Tax total, the itemisation, the descriptor
 * and Appendix A.5 verbatim before anybody agrees to anything. None of that
 * fits this composition, and putting it in would change the one thing this
 * rebuild exists to reproduce — so it is a sheet over the stage, drawn in the
 * reference's OWN card vocabulary (`[data-pay-modal]` on the adjacent
 * `[data-paypick]` screen: 720px, a 3px brand border, a 2px radius, over a
 * `rgba(1,63,23,.35)` scrim, entering with its `payModalIn` tween). Borrowed
 * rather than invented, which is what keeps a step the reference does not draw
 * inside its design language.
 *
 * ── Enter does not advance on this page ────────────────────────────────────
 * `founder-flow-reconciliation.md`, disagreement 10, and it stands. The
 * reference binds Enter globally (`enterAdvance` → `next()`, whose `ctaState`
 * for `fee` is `{show:true,label:'Pay $35'}`), which is fine where the one
 * control is a one-line input and dangerous here: a stray keystroke in a ZIP
 * field must not authorize a charge (§30 — no competing actions in a payment
 * state). There is no key handler and no `<form>` on this page, so the
 * browser's own submit-on-Enter has nothing to submit either.
 *
 * ── The four states the reference does not draw ────────────────────────────
 * The read failing, a §13 account that cannot pay, a fee that has not been
 * calculated, and §31.6 after payment. The first three replace the stage with a
 * `StatePanel` answering §27.1's six questions — a payment screen showing a
 * hero over a control that will refuse is worse than no hero. The fourth keeps
 * the composition and says the deadline in the chrome, which is absolutely
 * positioned so no reference box moves for it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  LISTING_FEE_ADDRESS_FIRST,
  LISTING_FEE_AT_THE_FLOOR,
  LISTING_FEE_CHECKOUT_CANCELED,
  LISTING_FEE_LOCKED_AFTER_PAYMENT,
  LISTING_FEE_NEWSLETTER_LABEL,
  OPTIONAL_ITEMS,
  PAY_SHEET_ADDRESS_HEAD,
  PAY_SHEET_EYEBROW,
  PAY_SHEET_NOTHING_CHARGED_YET,
  PAY_SHEET_TOTAL_HEAD,
  PENDING_PROPOSAL_NOTE,
  SEPARATE_FIVE_PERCENT_NOTE,
  formatUsd,
  payoutDiscountLine,
  payoutSavedLine,
  resolveListingFeeConsent,
  type OptionalItemKey,
} from '@proovd/shared';
import { Button, Option, StatePanel, NO_ACTION } from '../../components/index.js';
import { paySheetIn, stageBigHeadIn, stageRelayIn } from '../../components/anim.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fetchListing,
  openListingCheckout,
  cancelListing,
  FounderRequestError,
  type CheckoutQuote,
  type FeeState,
  type FounderError,
  type ListingState,
} from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): string {
  const s = Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
  // `s.toFixed(4)` is the reference's own — it writes the transform as a string
  // and rounds there, so this is the same number to the digit rather than one
  // that agrees to five decimal places.
  return s.toFixed(4);
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. This screen carries five of the thirteen, and here they happen to be
 * in document order — but the list is still passed rather than read from the
 * markup, because the 0.085s stagger follows THAT order and the two agreeing
 * today is not a reason to depend on it.
 */
const RELAY = ['head', 'fee', 'sub', 'hint', 'cta'] as const;

const LABELS = new Map<OptionalItemKey, string>(OPTIONAL_ITEMS.map((i) => [i.key, i.label]));

/** Cents cross the wire as decimal strings; `bigint` is the only safe parse. */
const usd = (cents: string): string => formatUsd(BigInt(cents));

/**
 * The bare formatted amount, without the `US` prefix.
 *
 * Two callers, and both are the reference's or the Spec's own copy rather than
 * a preference: Appendix A.5 writes `US$[SUBTOTAL]` and `US$[TOTAL]` with the
 * prefix already in the sentence, and the reference writes the stage's amounts
 * as a literal `$` followed by its variable (`${{ feeNow }}`). Replacing only
 * the variable is what the brief asks for, so the `$` is copy and this is the
 * value.
 */
const plain = (cents: string): string => usd(cents).replace('US$', '');

/** The hero's shape: the reference's `$`, the server's amount. */
const heroAmount = (cents: string): string => `$${plain(cents)}`;

/**
 * A deadline, local with UTC beside it — §27.1's rule.
 *
 * `toLocaleString()` alone renders `1/1/2099, 11:00:00 AM`, which is the
 * machine's locale and names no zone at all. §27.1 asks for the timezone
 * spelled out on a deadline, and this is the one deadline on this page: after
 * it, §31.6 stops being an automatic refund and becomes a request an Admin
 * decides.
 */
const deadline = (at: Date): string =>
  `${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ` +
  `(${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC)`;

const dateOnly = (at: Date): string => at.toLocaleDateString(undefined, { dateStyle: 'long' });

/* ── The route ─────────────────────────────────────────────────────────────── */

export function FeeStep() {
  const { campaignId = '' } = useParams();
  const [params] = useSearchParams();
  const setup = useSetupWorkspace(campaignId);
  const [listing, setListing] = useState<ListingState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await fetchListing(campaignId);
    setListing(result.listing);
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    fetchListing(campaignId)
      .then((result) => {
        if (!cancelled) setListing(result.listing);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read your listing fee just now.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const problem = failure ?? setup.failure;

  if (problem) {
    return (
      <FlowPage pageId="fee" param={campaignId}>
        <Shell campaignId={campaignId}>
          <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
            <StatePanel
              state="We could not open your listing fee"
              whatHappened={problem}
              next="Nothing has been charged. Reload the page, or contact support if it keeps happening."
              owner="Proovd"
              nextUpdate="As soon as you reload"
              action={NO_ACTION}
              reference={campaignId}
              getHelp={{ href: '/support' }}
              ring
            />
          </div>
        </Shell>
      </FlowPage>
    );
  }

  if (!listing || !setup.state) {
    return <SurfaceLoading subject="your listing fee" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="fee" param={campaignId}>
      <FeeScreen
        campaignId={campaignId}
        listing={listing}
        fee={setup.state.fee}
        canceled={params.get('listing') === 'canceled'}
        onChange={reload}
      />
    </FlowPage>
  );
}

/* ── The screen ────────────────────────────────────────────────────────────── */

type Sheet = 'none' | 'address' | 'quote' | 'record';

function FeeScreen({
  campaignId,
  listing,
  fee,
  canceled,
  onChange,
}: {
  campaignId: string;
  listing: ListingState;
  fee: FeeState | null;
  canceled: boolean;
  onChange: () => Promise<void>;
}) {
  const { leaveToPage } = useFlowNav();

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const payButton = useRef<HTMLButtonElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const [sheet, setSheet] = useState<Sheet>('none');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [postalCode, setPostalCode] = useState('');
  const [region, setRegion] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FounderError | null>(null);

  const payment = listing.payment ?? null;
  const paid = listing.paid && payment !== null;
  const refunded = listing.refund != null;
  const cancellation = listing.cancellation ?? null;

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Which entrance this arrival gets. Forward is `verifyIntro`'s `bigFirst`
  // branch; backwards is its ordinary relay, with the head in the order and the
  // stagger from the end, because `bigFirst` is `!back && …` there.
  const stageReady = !refunded && cancellation?.status !== 'canceled' && cancellation?.status !== 'pending';
  useLayoutEffect(() => {
    if (!stageReady) return;
    return direction.current === -1
      ? stageRelayIn(root.current, -1, RELAY)
      : stageBigHeadIn(root.current, RELAY);
  }, [stageReady]);

  const closeSheet = useCallback(() => {
    setSheet('none');
    setError(null);
    requestAnimationFrame(() => payButton.current?.focus());
  }, []);

  /** `payAndStart` — the reference advances; here it opens the charge. */
  const startPaying = useCallback(() => {
    setError(null);
    setSheet('address');
  }, []);

  const getQuote = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await openListingCheckout(campaignId, {
        address: { postalCode: postalCode.trim(), country: 'US', state: region.trim() },
        newsletterOptIn,
      });
      setQuote(result.checkout);
      setSheet('quote');
    } catch (e: unknown) {
      if (e instanceof FounderRequestError) setError(e.detail);
    } finally {
      setBusy(false);
    }
  }, [campaignId, postalCode, region, newsletterOptIn]);

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelListing(campaignId, 'Founder canceled from the listing-fee page');
      await onChange();
      setSheet('none');
    } catch (e: unknown) {
      if (e instanceof FounderRequestError) setError(e.detail);
    } finally {
      setBusy(false);
    }
  }, [campaignId, onChange]);

  /* ── The states that replace the stage ──────────────────────────────────── */

  if (refunded) {
    const refund = listing.refund!;
    return (
      <Shell campaignId={campaignId}>
        <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
          <StatePanel
            state="Your listing fee is refunded in full"
            whatHappened={refund.explanation}
            next={`${usd(refund.totalRefundedCents)} — the entire amount charged, including its sales tax — is on its way back to your original payment method. Your bank typically shows it within 5–10 business days; we cannot promise an exact date.`}
            owner="Stripe"
            nextUpdate="When your bank posts the refund"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </div>
      </Shell>
    );
  }

  if (cancellation?.status === 'canceled') {
    return (
      <Shell campaignId={campaignId}>
        <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
          <StatePanel
            state="Your campaign is canceled"
            whatHappened={cancellation.explanation}
            next="Nothing further is needed from you."
            owner="Proovd"
            nextUpdate="Within one business day"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </div>
      </Shell>
    );
  }

  if (cancellation?.status === 'pending') {
    return (
      <Shell campaignId={campaignId}>
        <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
          <StatePanel
            state="Your cancellation request is with our team"
            whatHappened={cancellation.explanation}
            next="We will come back to you with a decision."
            owner="Proovd"
            nextUpdate="Within one business day"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </div>
      </Shell>
    );
  }

  // §13: the incomplete and restricted states offer no way to pay, so they do
  // not get a screen whose whole composition is an amount and a Pay control.
  if (!paid && !listing.checkoutAvailable) {
    const restricted = listing.onboardingState === 'restricted';
    const taxOff = listing.taxAvailable === false;
    return (
      <Shell campaignId={campaignId}>
        <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
          <StatePanel
            state={restricted ? 'Payment is not available' : 'Payment is not open yet'}
            whatHappened={
              restricted
                ? 'Stripe cannot continue with your payout account, so the listing fee cannot be paid from here.'
                : taxOff
                  ? 'Sales-tax calculation is not switched on for this deployment yet, so we cannot show you an exact total to agree to.'
                  : 'Your payout setup is not finished, so the listing fee cannot be paid yet.'
            }
            next={
              restricted
                ? 'Contact support and a person here will go through it with you.'
                : taxOff
                  ? 'Nothing you have done is affected. We will email you when payment opens.'
                  : 'Set up your payouts first. Everything in your campaign is saved.'
            }
            owner={restricted || taxOff ? 'Proovd' : 'You'}
            nextUpdate="When your payout setup is complete"
            action={
              restricted || taxOff ? (
                NO_ACTION
              ) : (
                <Button tier="primary" onClick={() => leaveToPage('payouts', -1)}>
                  Finish setting up payouts
                </Button>
              )
            }
            reference={campaignId}
            getHelp={{ href: '/support' }}
            /* `ring` is `StatePanel`'s "needs you" emphasis, so it belongs on
               the one of these three a Founder can act on. A restricted
               account and an unconfigured tax service are Proovd's, and both
               say `No action needed` underneath. */
            ring={!restricted && !taxOff}
          />
        </div>
      </Shell>
    );
  }

  if (!paid && !fee) {
    return (
      <Shell campaignId={campaignId}>
        <div className="ff-fee__state">
            <h1 className="ff-fee__state-title">Your listing fee</h1>
          <StatePanel
            state="Your listing fee has not been worked out yet"
            whatHappened="We calculate it from the optional answers you have completed, and no calculation is recorded for this campaign yet."
            next="Go back through your answers — the fee appears as soon as one is saved. Nothing has been charged."
            owner="Proovd"
            nextUpdate="As soon as your campaign is read again"
            action={
              <Button tier="primary" onClick={() => leaveToPage('last-look', -1)}>
                Back to Last look
              </Button>
            }
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </Shell>
    );
  }

  /* ── The reference's screen ─────────────────────────────────────────────── */

  const remaining = fee ? BigInt(fee.remainingDiscountCents) : 0n;
  /** `payCanLower: this.fee() > this.FEE_FLOOR` — the server's answer to it. */
  const canLower = !paid && remaining > 0n;

  const heroCents = paid ? payment!.totalCents : fee!.subtotalCents;
  const freeUntil = paid ? new Date(payment!.freeCancellationDeadlineAt) : null;
  const withinFreeWindow = freeUntil !== null && freeUntil.getTime() > Date.now();

  const sheetOpen = sheet !== 'none';

  return (
    <Shell campaignId={campaignId} rootRef={root} inert={sheetOpen}>
      <div className="ff-fee__page" inert={sheetOpen}>
      <div className="ff-fee__stage" data-page-stage="1" ref={stage}>
        <div className="ff-fee__column">
          <h1 className="ff-fee__head" data-stage-anim="head">
            {paid ? 'Paid. Now build it.' : 'You’re in. Please Pay...'}
          </h1>

          {/* `${{ feeNow }}` — the reference's `$`, the server's amount. */}
          <span className="ff-fee__amount" data-stage-anim="fee">
            {heroAmount(heroCents)}
          </span>

          {/* `{{ paySavedText }}` */}
          <span className="ff-fee__saved" data-stage-anim="sub">
            {paid
              ? `Paid on ${dateOnly(new Date(payment!.paidAt))}`
              : payoutSavedLine(heroAmount(fee!.discountCents))}
          </span>

          {/* `<sc-if value="{{ payCanLower }}">` — absent at the floor, exactly
              as it is there, rather than disabled. On the paid state the same
              slot is what opens the record §24.6 requires. */}
          {canLower ? (
            <button
              type="button"
              className="ff-fee__hint"
              data-stage-anim="hint"
              onClick={() => leaveToPage('last-look', -1)}
            >
              {payoutDiscountLine(heroAmount(fee!.remainingDiscountCents))}
            </button>
          ) : paid ? (
            <button
              type="button"
              className="ff-fee__hint"
              data-stage-anim="hint"
              onClick={() => setSheet('record')}
            >
              See what you paid
            </button>
          ) : null}

          {/* `{{ payAndStart }}`. On the paid state the forward move is the
              reference's own next step: `this.step({si:this.I('build')})`. */}
          <button
            type="button"
            className="ff-fee__cta"
            data-stage-anim="cta"
            ref={payButton}
            aria-label={
              paid
                ? 'Start your campaign page — your brand voice'
                : 'Pay & Start — your billing address and total'
            }
            onClick={() => (paid ? leaveToPage('voice') : startPaying())}
          >
            {paid ? 'Start your campaign page' : 'Pay & Start'}
          </button>
        </div>
      </div>

      {/* Absolutely positioned in the chrome, so nothing below can move a
          reference box however long it gets. The reference has none of it. */}
      {canceled ? (
        <p className="ff-fee__note" role="status">
          {LISTING_FEE_CHECKOUT_CANCELED}
        </p>
      ) : null}
      {paid && !canceled ? (
        <p className="ff-fee__note">
          {withinFreeWindow
            ? `You can cancel and get the whole amount back, including its sales tax, until ${deadline(freeUntil)}.`
            : 'The free cancellation window has closed. You can still ask to cancel, and our team will review it — no automatic refund applies at this stage.'}
        </p>
      ) : null}
      </div>

      {sheetOpen ? (
        <PaySheet onClose={closeSheet}>
          {sheet === 'address' ? (
            <AddressStep
              postalCode={postalCode}
              region={region}
              onPostalCode={setPostalCode}
              onRegion={setRegion}
              busy={busy}
              error={error}
              fee={fee}
              onSubmit={() => void getQuote()}
              onClose={closeSheet}
            />
          ) : null}
          {sheet === 'quote' && quote ? (
            <QuoteStep
              quote={quote}
              newsletterOptIn={newsletterOptIn}
              onNewsletterChange={setNewsletterOptIn}
              onBack={() => setSheet('address')}
              error={error}
              onClose={closeSheet}
            />
          ) : null}
          {sheet === 'record' && payment ? (
            <RecordStep
              payment={payment}
              withinFreeWindow={withinFreeWindow}
              freeUntil={freeUntil}
              busy={busy}
              error={error}
              onCancel={() => void cancel()}
              onClose={closeSheet}
            />
          ) : null}
        </PaySheet>
      ) : null}
    </Shell>
  );
}

/* ── The chrome ────────────────────────────────────────────────────────────
   The reference's own, and its `clamp()`s are viewport-relative there too:
   this is furniture rather than part of the composition, so it does not scale
   with the stage. Identical markup on every state, so a failure and the screen
   have the same way out and the same way to get help. */

function Shell({
  campaignId,
  rootRef,
  inert,
  children,
}: {
  campaignId: string;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * True while the pay sheet is open.
   *
   * The scrim already blocks a POINTER — it covers the viewport — and blocked
   * nothing for a keyboard, so tab ran straight through `Pay & Start` behind
   * it while the sheet claimed `aria-modal`. Two competing actions in a payment
   * state (§30), and a claim to a screen reader that was not true. `inert` on
   * the background is what makes the two agree, and it needs no focus trap.
   */
  inert?: boolean;
  children: ReactNode;
}) {
  const { leaveToPage } = useFlowNav();
  return (
    <div className="ff-fee" ref={rootRef}>
      {/* `back()`: `if(c==='fee'){ this.step({si:this.I('model')},'back'); }` —
          with its own comment, `/* skip the review wait *​/`. The visible word
          is the reference's `Back`; §33.11.4's objectless-CTA rule is answered
          by the accessible name rather than by overriding its copy. */}
      <button
        type="button"
        className="ff-fee__back"
        aria-label="Back to how Creators are paid"
        inert={inert}
        onClick={() => leaveToPage('creator-payment', -1)}
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

      <div className="ff-fee__top" inert={inert}>
        {/* Not a link. A half-paid campaign is not a site, and the way out of a
            payment screen should not be the brand. */}
        <img className="ff-fee__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="fee"
          param={campaignId}
          trigger={
            <button type="button" className="ff-fee__help">
              Help
            </button>
          }
        />
      </div>

      {children}
    </div>
  );
}

/* ── The pay sheet ─────────────────────────────────────────────────────────
   `[data-pay-modal]`, borrowed from the adjacent screen — see the header. */

function PaySheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => paySheetIn(card.current), []);

  useEffect(() => {
    // Focus the first thing inside rather than the card, so a keyboard user
    // lands on the field they came here to fill. The reference gives its own
    // modal no focus handling at all and no way out but its button.
    const focusable = card.current?.querySelector<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ff-fee__scrim">
      {/* Three regions, and the middle one is the only thing that scrolls.
          The card is a fixed-height column: the eyebrow and the title stay at
          the top, the ONE action stays at the bottom, and the reading between
          them moves. A card that simply overflowed put `Agree and Pay` below
          its own fold, which on a payment screen is the action being hidden
          (§30, §1.1) — caught by measuring the boxes, not by reading. */}
      <div className="ff-fee__sheet" ref={card} role="dialog" aria-modal="true" aria-labelledby="ff-fee-sheet-title">
        {children}
      </div>
    </div>
  );
}

/** Step 1 — §13's billing address, because A.5 names an exact `US$[TOTAL]`. */
function AddressStep({
  postalCode,
  region,
  onPostalCode,
  onRegion,
  busy,
  error,
  fee,
  onSubmit,
  onClose,
}: {
  postalCode: string;
  region: string;
  onPostalCode: (value: string) => void;
  onRegion: (value: string) => void;
  busy: boolean;
  error: FounderError | null;
  fee: FeeState | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const atTheFloor = fee !== null && BigInt(fee.remainingDiscountCents) === 0n;
  return (
    <>
      <div className="ff-fee__sheet-head">
        <span className="ff-fee__eyebrow">{PAY_SHEET_EYEBROW}</span>
        <h2 className="ff-fee__sheet-title" id="ff-fee-sheet-title">
          {PAY_SHEET_ADDRESS_HEAD}
        </h2>
      </div>

      <div className="ff-fee__sheet-scroll">
        <p className="ff-fee__sheet-body">{LISTING_FEE_ADDRESS_FIRST}</p>

        {fee ? <FeeLines fee={fee} /> : null}
      {atTheFloor ? <p className="ff-fee__sheet-fine">{LISTING_FEE_AT_THE_FLOOR}</p> : null}
      {/* §24.6 / §12: the 5% is a separate stream, said separately — and said
          here rather than only on the quote, because a Founder who stops at
          this step would otherwise never be told. */}
      <p className="ff-fee__sheet-fine">{SEPARATE_FIVE_PERCENT_NOTE}</p>

      <div className="ff-fee__fields">
        <label className="ff-fee__label" htmlFor="ff-fee-postal">
          Billing ZIP code
        </label>
        <input
          id="ff-fee-postal"
          className="ff-fee__input"
          value={postalCode}
          autoComplete="postal-code"
          onChange={(event) => onPostalCode(event.target.value)}
        />
        <label className="ff-fee__label" htmlFor="ff-fee-region">
          State
        </label>
        <input
          id="ff-fee-region"
          className="ff-fee__input"
          value={region}
          autoComplete="address-level1"
          onChange={(event) => onRegion(event.target.value)}
        />
      </div>

        {error ? <SheetError error={error} /> : null}
      </div>

      <div className="ff-fee__sheet-foot">
        <button
          type="button"
          className="ff-fee__sheet-cta"
          disabled={busy || postalCode.trim().length === 0}
          onClick={onSubmit}
        >
          {busy ? 'Working out your total…' : 'Work out my total'}
        </button>
        <p className="ff-fee__sheet-fine ff-fee__sheet-fine--centred">
          {PAY_SHEET_NOTHING_CHARGED_YET}
        </p>
        <SheetClose onClose={onClose} />
      </div>
    </>
  );
}

/** Step 2 — the quote, Appendix A.5 verbatim, and the one action. */
function QuoteStep({
  quote,
  newsletterOptIn,
  onNewsletterChange,
  onBack,
  error,
  onClose,
}: {
  quote: CheckoutQuote;
  newsletterOptIn: boolean;
  onNewsletterChange: (value: boolean) => void;
  onBack: () => void;
  error: FounderError | null;
  onClose: () => void;
}) {
  // A.5's two variables, from the same server response the session charges.
  const consent = resolveListingFeeConsent({
    subtotal: plain(quote.subtotalCents),
    total: plain(quote.totalCents),
  });

  return (
    <>
      <div className="ff-fee__sheet-head">
        <span className="ff-fee__eyebrow">{PAY_SHEET_EYEBROW}</span>
        <h2 className="ff-fee__sheet-title" id="ff-fee-sheet-title">
          {PAY_SHEET_TOTAL_HEAD}
        </h2>
      </div>

      <div className="ff-fee__sheet-scroll">
      <dl className="ff-fee__lines">
        <div className="ff-fee__line">
          <dt>Listing a campaign</dt>
          <dd>{usd(quote.baseCents)}</dd>
        </div>
        {quote.discountLines.map((line) => (
          <div className="ff-fee__line ff-fee__line--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}
        <div className="ff-fee__line">
          <dt>Subtotal</dt>
          <dd>{usd(quote.subtotalCents)}</dd>
        </div>
        <div className="ff-fee__line">
          <dt>Sales tax</dt>
          <dd>{usd(quote.taxCents)}</dd>
        </div>
        <div className="ff-fee__line ff-fee__line--total">
          <dt>Total due now</dt>
          <dd>{usd(quote.totalCents)}</dd>
        </div>
      </dl>

      <p className="ff-fee__sheet-fine">Your card statement will show “{quote.descriptor}”.</p>

      {/* Appendix A.5, verbatim, with only its two amounts resolved.

          Directly under the amounts it is about, and above the two notes that
          elaborate on it. The first draft put all three notes first and the
          consent last, which left the one block somebody has to READ starting
          below the card's fold — found by measuring, not by looking. */}
      <div className="ff-fee__consent" data-testid="listing-consent">
        <p className="ff-fee__consent-body">{consent.body}</p>
      </div>

      <p className="ff-fee__sheet-fine">{SEPARATE_FIVE_PERCENT_NOTE}</p>
      {/* §13: "A pending proposal is not acceptance…" — in the surface, not
          only inside the consent text. */}
      <p className="ff-fee__sheet-fine">{PENDING_PROPOSAL_NOTE}</p>

      {/* §28.4: its own unchecked control, never bundled into the payment. */}
      <div className="ff-fee__option">
        <Option
          label={LISTING_FEE_NEWSLETTER_LABEL}
          checked={newsletterOptIn}
          onCheckedChange={onNewsletterChange}
        />
      </div>

      {error ? <SheetError error={error} /> : null}
      </div>

      <div className="ff-fee__sheet-foot">
        {/* §30: one action in a payment state. A.5 fixes its words — the
            reference's own `Pay & Start` is the control that OPENED this sheet,
            and using it again here would leave the consent's own opening
            clause, "By clicking Agree and Pay", describing a control that is
            not on the page. */}
        <a className="ff-fee__sheet-cta" href={quote.url}>
          {consent.action}
        </a>
        <button type="button" className="ff-fee__sheet-back" onClick={onBack}>
          Back to your billing address
        </button>
        <SheetClose onClose={onClose} />
      </div>
    </>
  );
}

/** The paid record — §24.6's itemisation and §31.6's decision. */
function RecordStep({
  payment,
  withinFreeWindow,
  freeUntil,
  busy,
  error,
  onCancel,
  onClose,
}: {
  payment: NonNullable<ListingState['payment']>;
  withinFreeWindow: boolean;
  freeUntil: Date | null;
  busy: boolean;
  error: FounderError | null;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="ff-fee__sheet-head">
        <span className="ff-fee__eyebrow">{PAY_SHEET_EYEBROW}</span>
        <h2 className="ff-fee__sheet-title" id="ff-fee-sheet-title">
          What you paid
        </h2>
      </div>

      <div className="ff-fee__sheet-scroll">
      <dl className="ff-fee__lines">
        <div className="ff-fee__line">
          <dt>Listing a campaign</dt>
          <dd>{usd(payment.baseCents)}</dd>
        </div>
        {payment.discountLines.map((line) => (
          <div className="ff-fee__line ff-fee__line--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}
        <div className="ff-fee__line">
          <dt>Subtotal</dt>
          <dd>{usd(payment.subtotalCents)}</dd>
        </div>
        <div className="ff-fee__line">
          <dt>Sales tax</dt>
          <dd>{usd(payment.taxCents)}</dd>
        </div>
        <div className="ff-fee__line ff-fee__line--total">
          <dt>Total charged</dt>
          <dd>{usd(payment.totalCents)}</dd>
        </div>
      </dl>

      <p className="ff-fee__sheet-fine">
        Your card statement will show “{payment.descriptor}”. Your itemised receipt is in your
        email; a formal invoice is available through support at any time.
      </p>
      <p className="ff-fee__sheet-fine">{LISTING_FEE_LOCKED_AFTER_PAYMENT}</p>
      <p className="ff-fee__sheet-fine">
        {withinFreeWindow && freeUntil
          ? `You can cancel and get the whole amount back, including its sales tax, until ${deadline(freeUntil)}. After that, cancelling needs our approval and no automatic refund applies.`
          : 'The free cancellation window has closed. You can still ask to cancel, and our team will review it — no automatic refund applies at this stage.'}
      </p>

      {error ? <SheetError error={error} /> : null}
      </div>

      <div className="ff-fee__sheet-foot">
        {/* Never a primary. §31.6's decision is the quieter of the two on this
            page — the loud one is the campaign page a Founder came here to
            build. */}
        <button type="button" className="ff-fee__sheet-back" disabled={busy} onClick={onCancel}>
          {busy
            ? 'Sending…'
            : withinFreeWindow
              ? 'Cancel and refund my listing fee'
              : 'Ask to cancel this campaign'}
        </button>
        <SheetClose onClose={onClose} />
      </div>
    </>
  );
}

/** §13's itemisation before the quote: the base line and each earned saving. */
function FeeLines({ fee }: { fee: FeeState }) {
  return (
    <dl className="ff-fee__lines">
      <div className="ff-fee__line">
        <dt>Listing a campaign</dt>
        <dd>{usd(fee.baseCents)}</dd>
      </div>
      {fee.discountLines.map((line) => (
        <div className="ff-fee__line ff-fee__line--saving" key={line.item}>
          <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
          <dd>−{usd(line.discountCents)}</dd>
        </div>
      ))}
      {/* Tax before an address exists is a sentence, not a US$0.00 line
          (§1.4) — and it sits ABOVE the total rather than under it, so the
          rule the divider draws is "everything above adds up to this". */}
      <div className="ff-fee__line">
        <dt>Sales tax</dt>
        <dd className="ff-fee__pending">Worked out from your billing address</dd>
      </div>
      <div className="ff-fee__line ff-fee__line--total">
        <dt>Subtotal before tax</dt>
        <dd>{usd(fee.subtotalCents)}</dd>
      </div>
    </dl>
  );
}

/**
 * The way out.
 *
 * Never a primary and never beside the pay control's weight: §30 forbids a
 * second thing competing for the press in a payment state, and this exists so
 * the sheet is not a trap for somebody who opened it by accident. Escape does
 * the same thing.
 */
function SheetClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="ff-fee__sheet-close" onClick={onClose}>
      Close
    </button>
  );
}

function SheetError({ error }: { error: FounderError }) {
  return (
    <div className="ff-fee__error" role="alert">
      <p>{error.whatHappened}</p>
      <p>{error.next}</p>
    </div>
  );
}
