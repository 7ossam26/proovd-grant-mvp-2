/**
 * The listing-fee payment surface — Spec §13, §24.6, §31.6, §33.3.5, §33.3.11.
 *
 * §13 fixes what the Founder sees before paying: the US$35 base line, each
 * earned US$2 saving as its own labeled line, any promotional discount, tax,
 * total due now, the descriptor, the separate 5% explanation, the full refund
 * promise, and **the exact consent from Appendix A.5**.
 *
 * ── The consent is rendered, never written ──────────────────────────────────
 * `LISTING_FEE_CONSENT_TEMPLATE` is the shared A.5 register and
 * `resolveListingFeeConsent` substitutes only the two amounts. Nothing in this
 * file paraphrases, shortens, or reflows it — Phase 11's trap in one line, and
 * a test compares the rendered text against the Spec's own appendix.
 *
 * ── Nothing here does arithmetic ────────────────────────────────────────────
 * Every amount is a string of integer cents the server calculated, parsed only
 * to be formatted. The total shown is the total the session charges, because
 * both come from the same server response — which is exactly why the tax
 * calculation happens before the consent renders rather than at Stripe.
 *
 * ── Tax needs an address, so the address comes first ────────────────────────
 * A.5 names an exact total, and an exact total needs a billing address. So the
 * surface asks for one, gets the quote, and only then renders the consent and
 * the pay action. Showing A.5 with an unresolved total would be showing a
 * consent to an unknown number.
 *
 * ── One action, and the optional consent is separate ────────────────────────
 * §28.4 forbids bundling: the newsletter is its own unchecked control and
 * nothing about paying implies it. §30 forbids competing actions in a payment
 * state — there is one primary button here, and the cancellation control only
 * appears after payment, where it is a different decision.
 */

import { useEffect, useState } from 'react';
import {
  formatUsd,
  OPTIONAL_ITEMS,
  type OptionalItemKey,
  LISTING_FEE_NEWSLETTER_LABEL,
  PENDING_PROPOSAL_NOTE,
  SEPARATE_FIVE_PERCENT_NOTE,
  resolveListingFeeConsent,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Option,
  StatePanel,
  NO_ACTION,
} from '../../components/index.js';
import {
  fetchListing,
  openListingCheckout,
  cancelListing,
  FounderRequestError,
  type ListingState,
  type CheckoutQuote,
  type FounderError,
} from './api.js';

const LABELS = new Map<OptionalItemKey, string>(OPTIONAL_ITEMS.map((i) => [i.key, i.label]));

/** Cents cross the wire as decimal strings; `bigint` is the only safe parse. */
const usd = (cents: string): string => formatUsd(BigInt(cents));
/** The bare formatted amount A.5's `US$[TOTAL]` markers take. */
const plain = (cents: string): string => usd(cents).replace('US$', '');

export interface ListingPaymentProps {
  campaignId: string;
}

export function ListingPayment({ campaignId }: ListingPaymentProps) {
  const [listing, setListing] = useState<ListingState | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [postalCode, setPostalCode] = useState('');
  const [region, setRegion] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FounderError | null>(null);

  useEffect(() => {
    let live = true;
    fetchListing(campaignId)
      .then((r) => {
        if (live) setListing(r.listing);
      })
      .catch((e: unknown) => {
        if (live && e instanceof FounderRequestError) setError(e.detail);
      });
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (!listing) {
    return (
      <Card>
        <p className="lede">Loading your listing fee…</p>
        {error ? <p className="fine">{error.whatHappened}</p> : null}
      </Card>
    );
  }

  /* ── After payment (§24.6's record, §31.6's decision) ───────────────────── */

  if (listing.paid && listing.payment) {
    return (
      <PaidPanel
        campaignId={campaignId}
        listing={listing}
        onCanceled={(next) => setListing(next)}
      />
    );
  }

  /* ── §13: restricted and incomplete states offer no way to pay ─────────── */

  if (!listing.checkoutAvailable) {
    const restricted = listing.onboardingState === 'restricted';
    return (
      <StatePanel
        state={restricted ? 'Payment is not available' : 'Payment is not open yet'}
        whatHappened={
          restricted
            ? 'Stripe cannot continue with your payout account, so the listing fee cannot be paid from here.'
            : listing.taxAvailable === false
              ? 'Sales-tax calculation is not switched on for this deployment yet, so we cannot show you an exact total to agree to.'
              : 'Your payout setup is not finished, so the listing fee cannot be paid yet.'
        }
        next={
          restricted
            ? 'Contact support and a person here will go through it with you.'
            : listing.taxAvailable === false
              ? 'Nothing you have done is affected. We will email you when payment opens.'
              : 'Finish payout setup first. Everything in your campaign is saved.'
        }
        owner={restricted || listing.taxAvailable === false ? 'Proovd' : 'You'}
        nextUpdate="When your payout setup is complete"
        action={NO_ACTION}
        reference={campaignId}
        getHelp={{ href: '/support' }}
      />
    );
  }

  async function getQuote() {
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
  }

  return (
    <Card>
      <h2 className="section-title">Pay your listing fee</h2>

      {!quote ? (
        <>
          <p className="lede">
            Sales tax depends on where you are billed, so we work out your exact total before you
            agree to anything.
          </p>
          <Field label="Billing ZIP code" id="listing-postal">
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.currentTarget.value)}
              autoComplete="postal-code"
            />
          </Field>
          <Field label="State" id="listing-region">
            <Input
              value={region}
              onChange={(e) => setRegion(e.currentTarget.value)}
              autoComplete="address-level1"
            />
          </Field>
          <Button
            tier="primary"
            onClick={() => void getQuote()}
            disabled={busy || postalCode.trim().length === 0}
          >
            {busy ? 'Working out your total…' : 'Show my total'}
          </Button>
          {error ? (
            <div className="notice notice--warn" role="alert">
              <p>{error.whatHappened}</p>
              <p className="fine">{error.next}</p>
            </div>
          ) : null}
        </>
      ) : (
        <ConsentAndPay
          quote={quote}
          newsletterOptIn={newsletterOptIn}
          onNewsletterChange={setNewsletterOptIn}
          error={error}
        />
      )}
    </Card>
  );
}

/* ── The §13 itemisation, the A.5 consent, and the one action ─────────────── */

function ConsentAndPay({
  quote,
  newsletterOptIn,
  onNewsletterChange,
  error,
}: {
  quote: CheckoutQuote;
  newsletterOptIn: boolean;
  onNewsletterChange: (value: boolean) => void;
  error: FounderError | null;
}) {
  // A.5's two variables, from the same server response the session charges.
  const consent = resolveListingFeeConsent({
    subtotal: plain(quote.subtotalCents),
    total: plain(quote.totalCents),
  });

  return (
    <>
      <dl className="fee-preview">
        <div className="fee-preview__row">
          <dt>Listing a campaign</dt>
          <dd>{usd(quote.baseCents)}</dd>
        </div>

        {/* §13: "each earned $2 saving as its own labeled line". */}
        {quote.discountLines.map((line) => (
          <div className="fee-preview__row fee-preview__row--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}

        <div className="fee-preview__row">
          <dt>Subtotal</dt>
          <dd>{usd(quote.subtotalCents)}</dd>
        </div>
        <div className="fee-preview__row">
          <dt>Sales tax</dt>
          <dd>{usd(quote.taxCents)}</dd>
        </div>
        <div className="fee-preview__row fee-preview__row--total">
          <dt>Total due now</dt>
          <dd>{usd(quote.totalCents)}</dd>
        </div>
      </dl>

      <p className="fine">Your card statement will show “{quote.descriptor}”.</p>

      {/* §24.6 / §12: the 5% is a separate stream, said separately. */}
      <p className="fine fine--separated">{SEPARATE_FIVE_PERCENT_NOTE}</p>

      {/* §13: "A pending proposal is not acceptance…" — the brief asks for this
          in the surface, not only inside the consent text. */}
      <p className="fine">{PENDING_PROPOSAL_NOTE}</p>

      {/* Appendix A.5, verbatim, with only its two amounts resolved. */}
      <div className="consent" data-testid="listing-consent">
        <p className="consent__body">{consent.body}</p>
      </div>

      {/* §28.4: its own unchecked control, never bundled into the payment. */}
      <Option
        label={LISTING_FEE_NEWSLETTER_LABEL}
        checked={newsletterOptIn}
        onCheckedChange={onNewsletterChange}
      />

      {/* §30: one action in a payment state. A.5 fixes its words. */}
      <Button tier="primary" href={quote.url}>
        {consent.action}
      </Button>

      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error.whatHappened}</p>
          <p className="fine">{error.next}</p>
        </div>
      ) : null}
    </>
  );
}

/* ── After payment (§24.6, §31.6, §33.3.11) ───────────────────────────────── */

function PaidPanel({
  campaignId,
  listing,
  onCanceled,
}: {
  campaignId: string;
  listing: ListingState;
  onCanceled: (next: ListingState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FounderError | null>(null);
  const payment = listing.payment!;

  const freeUntil = new Date(payment.freeCancellationDeadlineAt);
  const withinFreeWindow = freeUntil.getTime() > Date.now();
  const canceled = listing.cancellation?.status === 'canceled';

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelListing(campaignId, 'Founder canceled from the campaign workspace');
      const refreshed = await fetchListing(campaignId);
      onCanceled(refreshed.listing);
    } catch (e: unknown) {
      if (e instanceof FounderRequestError) setError(e.detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="section-title">Your listing fee is paid</h2>

      <dl className="fee-preview">
        <div className="fee-preview__row">
          <dt>Listing a campaign</dt>
          <dd>{usd(payment.baseCents)}</dd>
        </div>
        {payment.discountLines.map((line) => (
          <div className="fee-preview__row fee-preview__row--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}
        <div className="fee-preview__row">
          <dt>Subtotal</dt>
          <dd>{usd(payment.subtotalCents)}</dd>
        </div>
        <div className="fee-preview__row">
          <dt>Sales tax</dt>
          <dd>{usd(payment.taxCents)}</dd>
        </div>
        <div className="fee-preview__row fee-preview__row--total">
          <dt>Total charged</dt>
          <dd>{usd(payment.totalCents)}</dd>
        </div>
      </dl>

      <p className="fine">
        Your card statement will show “{payment.descriptor}”. Your itemised receipt is in your
        email; a formal invoice is available through support at any time.
      </p>

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
          <p className="fine">
            {withinFreeWindow
              ? 'You can cancel and get the whole amount back, including its sales tax, until ' +
                freeUntil.toLocaleString() +
                '. After that, cancelling needs our approval and no automatic refund applies.'
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
    </Card>
  );
}
