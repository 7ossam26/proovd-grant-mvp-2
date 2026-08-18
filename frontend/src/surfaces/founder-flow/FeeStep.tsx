/**
 * Screen 20 — your listing fee — Founder Flow v2, Session E.
 *
 * The ONE address for the listing fee. It renders §13's pre-payment surface,
 * §24.6's record once the fee is paid, and §31.6's cancellation decision —
 * `/campaigns/:campaignId/workspace` retired to a redirect rather than keeping a
 * second copy of any of them (`CLAUDE.md`, Session D: two surfaces over the same
 * money is two places to answer one question).
 *
 * ── The hero is the Glance and the payment is the Act ───────────────────────
 * DNA §5.14. The reference draws one number at 290px and a button. §13 requires
 * a great deal more before anybody agrees to anything — every earned saving as
 * its own labeled line, tax against a real billing address, the descriptor, the
 * separate 5% explanation, and Appendix A.5 verbatim — so the number and what
 * still lowers it are the first thing, and the itemisation, the consent and the
 * one action are the second. A person who is not ready to pay reads the first
 * half and leaves; nothing about the first half can charge anybody.
 *
 * ── Nothing here does arithmetic ────────────────────────────────────────────
 * Phase 09's trap, and the reference is the example: it hardcodes `FEE_BASE=35`,
 * `FEE_PER=2`, `FEE_FLOOR=25` and derives `Discount $10 by completing tasks` in
 * the browser. Every amount below is a decimal string of integer cents the
 * server computed, parsed only to be formatted. What is still available is said
 * as a COUNT of answers and the per-answer amount the server sent — never a
 * total worked out here.
 *
 * ── Enter does not advance on this page ─────────────────────────────────────
 * `founder-flow-reconciliation.md`, disagreement 10. The reference binds Enter
 * to the current page's primary action throughout, which is fine where the one
 * control is a one-line input and dangerous here: a stray keystroke in a ZIP
 * field must not authorize a charge (§30 — no competing actions in a payment
 * state). There is no key handler and no `<form>` on this page, so the default
 * submit-on-Enter has nothing to submit either.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  LISTING_FEE_ADDRESS_FIRST,
  LISTING_FEE_AT_THE_FLOOR,
  LISTING_FEE_CHECKOUT_CANCELED,
  LISTING_FEE_LOCKED_AFTER_PAYMENT,
  LISTING_FEE_NEWSLETTER_LABEL,
  LISTING_FEE_STILL_LOWERABLE,
  OPTIONAL_ITEMS,
  PENDING_PROPOSAL_NOTE,
  SEPARATE_FIVE_PERCENT_NOTE,
  formatUsd,
  resolveListingFeeConsent,
  type OptionalItemKey,
} from '@proovd/shared';
import {
  Button,
  Field,
  Input,
  Option,
  StatePanel,
  NO_ACTION,
} from '../../components/index.js';
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
import { FlowPage, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

const LABELS = new Map<OptionalItemKey, string>(OPTIONAL_ITEMS.map((i) => [i.key, i.label]));

/** Cents cross the wire as decimal strings; `bigint` is the only safe parse. */
const usd = (cents: string): string => formatUsd(BigInt(cents));

/**
 * A deadline, local with UTC beside it — §27.1's rule.
 *
 * `toLocaleString()` alone renders `1/1/2099, 11:00:00 AM`, which is the
 * machine's locale and names no zone at all. §27.1 asks for the timezone spelled
 * out on a deadline, and this is the one deadline on this page: after it, §31.6
 * stops being an automatic refund and becomes a request an Admin decides.
 * `StatePanel`'s own `When` renders the same pair.
 */
const deadline = (at: Date): string =>
  `${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ` +
  `(${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC)`;
/** The bare formatted amount A.5's `US$[TOTAL]` markers take. */
const plain = (cents: string): string => usd(cents).replace('US$', '');

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

  if (failure ?? setup.failure) {
    return (
      <FlowPage pageId="fee" param={campaignId}>
        <div className="ff-money">
          <StatePanel
            state="We could not open your listing fee"
            whatHappened={failure ?? setup.failure ?? ''}
            next="Nothing has been charged. Reload the page, or contact support if it keeps happening."
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

  if (!listing || !setup.state) {
    return <SurfaceLoading subject="your listing fee" reference="Your campaign" />;
  }

  return (
    /* No message badge on this page. It renders as a second `btn--primary`, and
       §30 forbids competing actions in a payment state — a small green button
       beside "Agree and Pay US$35.72" is exactly the competition it means.
       Help is not lost: HELP sits in the top bar of every page in the flow. */
    <FlowPage pageId="fee" param={campaignId}>
      {listing.paid && listing.payment ? (
        <Paid campaignId={campaignId} listing={listing} onChange={reload} />
      ) : (
        <Unpaid
          campaignId={campaignId}
          listing={listing}
          fee={setup.state.fee}
          canceled={params.get('listing') === 'canceled'}
        />
      )}
    </FlowPage>
  );
}

/* ── Before payment (§13, Appendix A.5) ───────────────────────────────────── */

function Unpaid({
  campaignId,
  listing,
  fee,
  canceled,
}: {
  campaignId: string;
  listing: ListingState;
  fee: FeeState | null;
  canceled: boolean;
}) {
  const { leaveToPage } = useFlowNav();
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [postalCode, setPostalCode] = useState('');
  const [region, setRegion] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FounderError | null>(null);

  const getQuote = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await openListingCheckout(campaignId, {
        address: { postalCode: postalCode.trim(), country: 'US', state: region.trim() },
        newsletterOptIn,
      });
      setQuote(result.checkout);
    } catch (e: unknown) {
      if (e instanceof FounderRequestError) setError(e.detail);
    } finally {
      setBusy(false);
    }
  }, [campaignId, postalCode, region, newsletterOptIn]);

  /* §13: the incomplete and restricted states offer no way to pay. */
  if (!listing.checkoutAvailable) {
    const restricted = listing.onboardingState === 'restricted';
    const taxOff = listing.taxAvailable === false;
    return (
      <div className="ff-money">
        <h1 className="ff-money__title" data-anim="head">
          Your listing fee
        </h1>
        <div className="ff-money__panel" data-anim="panel">
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
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        </div>
        <div className="ff-nav" data-anim="cta">
          <Button tier="tertiary" onClick={() => leaveToPage('payouts', -1)}>
            Back to how you get paid
          </Button>
          {restricted || taxOff ? null : (
            <Button tier="primary" onClick={() => leaveToPage('payouts', -1)}>
              Finish setting up payouts
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (quote) {
    return (
      <ConsentAndPay
        quote={quote}
        newsletterOptIn={newsletterOptIn}
        onNewsletterChange={setNewsletterOptIn}
        onBack={() => setQuote(null)}
        error={error}
      />
    );
  }

  const atTheFloor = fee !== null && fee.completedItems >= OPTIONAL_ITEMS.length;

  return (
    <div className="ff-money">
      <h1 className="ff-money__title" data-anim="head">
        Your listing fee
      </h1>

      {/* §30: a payment state never reports a generic outcome without saying
          what happened to the money. Stripe sending somebody back is ordinary. */}
      {canceled ? (
        <p className="ff-money__canceled" role="status" data-anim="sub">
          {LISTING_FEE_CHECKOUT_CANCELED}
        </p>
      ) : null}

      {/* The reference's hero. The number is the server's §12 subtotal. */}
      <p className="ff-money__amount" data-anim="fee">
        {fee ? usd(fee.subtotalCents) : '—'}
      </p>

      {fee ? (
        <p className="ff-money__saving" data-anim="sub">
          {fee.completedItems > 0 ? (
            <>
              Down from {usd(fee.baseCents)} — {usd(fee.discountCents)} off for{' '}
              {fee.completedItems} of the {OPTIONAL_ITEMS.length} optional answers.
            </>
          ) : (
            /* The reference renders `You saved $0 by doing bonus tasks` here.
               Telling somebody who completed none of them that they saved
               nothing is the report they least need on the screen where they
               can still change it. */
            <>
              {usd(fee.baseCents)} to list your campaign. Each optional answer takes{' '}
              {usd(fee.itemDiscountCents)} off.
            </>
          )}
        </p>
      ) : null}

      <p className="ff-money__lede" data-anim="note">
        {atTheFloor ? LISTING_FEE_AT_THE_FLOOR : LISTING_FEE_STILL_LOWERABLE}
      </p>

      {fee && !atTheFloor ? (
        <p className="ff-money__foot" data-anim="note">
          <Button tier="secondary" small onClick={() => leaveToPage('last-look', -1)}>
            Go back to Last look to add another
          </Button>
        </p>
      ) : null}

      {/* §13's itemisation, before anybody agrees to anything. */}
      {fee ? <FeeLines fee={fee} /> : null}

      {/* §24.6 / §12: the 5% is a separate stream, said separately — and said
          HERE rather than only on the quote step, because a Founder who never
          asks for a total would otherwise never be told. */}
      <p className="ff-money__foot">{SEPARATE_FIVE_PERCENT_NOTE}</p>

      <div className="ff-money__panel" data-anim="panel">
        <h2 className="ff-money__sub">Where are you billed?</h2>
        <p className="ff-money__lede">{LISTING_FEE_ADDRESS_FIRST}</p>
        <div className="ff-money__fields">
          <Field label="Billing ZIP code" id="ff-fee-postal">
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.currentTarget.value)}
              autoComplete="postal-code"
            />
          </Field>
          <Field label="State" id="ff-fee-region">
            <Input
              value={region}
              onChange={(e) => setRegion(e.currentTarget.value)}
              autoComplete="address-level1"
            />
          </Field>
        </div>
        {error ? (
          <div className="notice notice--warn" role="alert">
            <p>{error.whatHappened}</p>
            <p className="fine">{error.next}</p>
          </div>
        ) : null}
      </div>

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('payouts', -1)}>
          Back to how you get paid
        </Button>
        <Button
          tier="primary"
          onClick={() => void getQuote()}
          disabled={busy || postalCode.trim().length === 0}
        >
          {busy ? 'Working out your total…' : 'Work out my total'}
        </Button>
      </div>
      {/* The one thing a person on a payment screen should be certain of before
          they press anything (§30). */}
      <p className="ff-money__foot">
        Nothing is charged by this. It works out the tax so we can show you the exact total to
        agree to.
      </p>
    </div>
  );
}

/** §13: the base line, each earned saving as its own labeled line, the total. */
function FeeLines({ fee }: { fee: FeeState }) {
  return (
    <dl className="ff-lines" data-anim="field">
      <div className="ff-lines__row">
        <dt>Listing a campaign</dt>
        <dd>{usd(fee.baseCents)}</dd>
      </div>
      {fee.discountLines.map((line) => (
        <div className="ff-lines__row ff-lines__row--saving" key={line.item}>
          <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
          <dd>−{usd(line.discountCents)}</dd>
        </div>
      ))}
      <div className="ff-lines__row ff-lines__row--total">
        <dt>Subtotal</dt>
        <dd>{usd(fee.subtotalCents)}</dd>
      </div>
      <div className="ff-lines__note">
        <dt>Sales tax</dt>
        <dd>Worked out from your billing address</dd>
      </div>
    </dl>
  );
}

/* ── The quote, Appendix A.5, and the one action ──────────────────────────── */

function ConsentAndPay({
  quote,
  newsletterOptIn,
  onNewsletterChange,
  onBack,
  error,
}: {
  quote: CheckoutQuote;
  newsletterOptIn: boolean;
  onNewsletterChange: (value: boolean) => void;
  onBack: () => void;
  error: FounderError | null;
}) {
  // A.5's two variables, from the same server response the session charges.
  const consent = resolveListingFeeConsent({
    subtotal: plain(quote.subtotalCents),
    total: plain(quote.totalCents),
  });

  return (
    <div className="ff-money">
      <h1 className="ff-money__title ff-money__title--small" data-anim="head">
        Your total
      </h1>

      <dl className="ff-lines" data-anim="field">
        <div className="ff-lines__row">
          <dt>Listing a campaign</dt>
          <dd>{usd(quote.baseCents)}</dd>
        </div>
        {quote.discountLines.map((line) => (
          <div className="ff-lines__row ff-lines__row--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}
        <div className="ff-lines__row">
          <dt>Subtotal</dt>
          <dd>{usd(quote.subtotalCents)}</dd>
        </div>
        <div className="ff-lines__row">
          <dt>Sales tax</dt>
          <dd>{usd(quote.taxCents)}</dd>
        </div>
        <div className="ff-lines__row ff-lines__row--total">
          <dt>Total due now</dt>
          <dd>{usd(quote.totalCents)}</dd>
        </div>
      </dl>

      <p className="ff-money__foot">Your card statement will show “{quote.descriptor}”.</p>
      {/* §24.6 / §12: the 5% is a separate stream, said separately. */}
      <p className="ff-money__foot">{SEPARATE_FIVE_PERCENT_NOTE}</p>
      {/* §13: "A pending proposal is not acceptance…" — in the surface, not only
          inside the consent text. */}
      <p className="ff-money__foot">{PENDING_PROPOSAL_NOTE}</p>

      {/* Appendix A.5, verbatim, with only its two amounts resolved. */}
      <div className="consent" data-testid="listing-consent" data-anim="panel">
        <p className="consent__body">{consent.body}</p>
      </div>

      {/* §28.4: its own unchecked control, never bundled into the payment. */}
      <Option
        label={LISTING_FEE_NEWSLETTER_LABEL}
        checked={newsletterOptIn}
        onCheckedChange={onNewsletterChange}
      />

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={onBack}>
          Back to your billing address
        </Button>
        {/* §30: one action in a payment state. A.5 fixes its words — the
            reference's own `Pay & Start` would leave the consent's opening
            clause, "By clicking Agree and Pay", describing a control that is
            not on the page. */}
        <Button tier="primary" href={quote.url}>
          {consent.action}
        </Button>
      </div>

      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error.whatHappened}</p>
          <p className="fine">{error.next}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ── After payment (§24.6, §31.6, §33.3.11) ───────────────────────────────── */

function Paid({
  campaignId,
  listing,
  onChange,
}: {
  campaignId: string;
  listing: ListingState;
  onChange: () => Promise<void>;
}) {
  const { leave } = useFlowNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FounderError | null>(null);
  const payment = listing.payment!;

  const freeUntil = new Date(payment.freeCancellationDeadlineAt);
  const withinFreeWindow = freeUntil.getTime() > Date.now();
  const canceled = listing.cancellation?.status === 'canceled';

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelListing(campaignId, 'Founder canceled from the listing-fee page');
      await onChange();
    } catch (e: unknown) {
      if (e instanceof FounderRequestError) setError(e.detail);
    } finally {
      setBusy(false);
    }
  }, [campaignId, onChange]);

  return (
    <div className="ff-money">
      <h1 className="ff-money__title ff-money__title--small" data-anim="head">
        Your listing fee is paid
      </h1>

      <p className="ff-money__amount ff-money__amount--paid" data-anim="fee">
        {usd(payment.totalCents)}
      </p>

      <dl className="ff-lines" data-anim="field">
        <div className="ff-lines__row">
          <dt>Listing a campaign</dt>
          <dd>{usd(payment.baseCents)}</dd>
        </div>
        {payment.discountLines.map((line) => (
          <div className="ff-lines__row ff-lines__row--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}
        <div className="ff-lines__row">
          <dt>Subtotal</dt>
          <dd>{usd(payment.subtotalCents)}</dd>
        </div>
        <div className="ff-lines__row">
          <dt>Sales tax</dt>
          <dd>{usd(payment.taxCents)}</dd>
        </div>
        <div className="ff-lines__row ff-lines__row--total">
          <dt>Total charged</dt>
          <dd>{usd(payment.totalCents)}</dd>
        </div>
      </dl>

      <p className="ff-money__foot">
        Your card statement will show “{payment.descriptor}”. Your itemised receipt is in your
        email; a formal invoice is available through support at any time.
      </p>
      <p className="ff-money__foot">{LISTING_FEE_LOCKED_AFTER_PAYMENT}</p>

      <div className="ff-money__panel" data-anim="panel">
        {listing.refund ? (
          <StatePanel
            state="Your listing fee is refunded in full"
            whatHappened={listing.refund.explanation}
            next={`${usd(listing.refund.totalRefundedCents)} — the entire amount charged, including its sales tax — is on its way back to your original payment method. Your bank typically shows it within 5–10 business days; we cannot promise an exact date.`}
            owner="Stripe"
            nextUpdate="When your bank posts the refund"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        ) : canceled ? (
          <StatePanel
            state="Your campaign is canceled"
            whatHappened={listing.cancellation!.explanation}
            next="Nothing further is needed from you."
            owner="Proovd"
            nextUpdate="Within one business day"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        ) : listing.cancellation?.status === 'pending' ? (
          <StatePanel
            state="Your cancellation request is with our team"
            whatHappened={listing.cancellation.explanation}
            next="We will come back to you with a decision."
            owner="Proovd"
            nextUpdate="Within one business day"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
          />
        ) : (
          <>
            {/* §31.6, said plainly in both directions. */}
            <p className="ff-money__lede">
              {withinFreeWindow
                ? `You can cancel and get the whole amount back, including its sales tax, until ${deadline(freeUntil)}. After that, cancelling needs our approval and no automatic refund applies.`
                : 'The free cancellation window has closed. You can still ask to cancel, and our team will review it — no automatic refund applies at this stage.'}
            </p>
            {/* §30: never a competing primary in a payment state. Cancellation
                is the quieter of the two decisions on this page. */}
            <Button tier="tertiary" onClick={() => void cancel()} disabled={busy}>
              {busy
                ? 'Sending…'
                : withinFreeWindow
                  ? 'Cancel and refund my listing fee'
                  : 'Ask to cancel this campaign'}
            </Button>
          </>
        )}
        {error ? (
          <div className="notice notice--warn" role="alert">
            <p>{error.whatHappened}</p>
            <p className="fine">{error.next}</p>
          </div>
        ) : null}
      </div>

      <div className="ff-nav" data-anim="cta">
        {/* Session F puts screen 18 and the four build steps here. Until it
            does, the campaign build is what comes next and it is a real
            surface — a control naming a page that does not exist yet would be
            §1.4's failure with a forward arrow on it. */}
        <Button
          tier="primary"
          onClick={() => leave(`/campaigns/${encodeURIComponent(campaignId)}/build`)}
        >
          Build your campaign page
        </Button>
      </div>
    </div>
  );
}
