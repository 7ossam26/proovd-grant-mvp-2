/**
 * The Backer pre-order checkout — Spec §19, Appendix A.3/A.4, B.2, §33.5.
 *
 * The §19 twelve-step flow, in a Drawer opened from the live campaign page: the
 * fixed demand survey, contact and US billing, the exact reward subtotal / sales
 * tax / total authorized with `US$0 charged today`, the campaign-specific consent
 * read before any card, the three separate unchecked consents (§28.4), the
 * Stripe-hosted card field, and the `Authorize pre-order` action that creates the
 * reservation only after SetupIntent success. On success it becomes the B.2
 * "Pre-order saved — you were not charged" state.
 *
 * Every surface here leads with the not-charged fact and never implies a
 * completed purchase (§30). Card data never touches this DOM — Stripe's fields
 * are hosted iframes (§28.3); when Stripe is not yet configured the card step
 * refuses loudly and offers no field.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Field, Input, Textarea, Toggle } from '../../../components/index.js';
import {
  fetchQuote as defaultFetchQuote,
  submitPreorder as defaultSubmit,
  type Quote,
  type PreorderError,
  type PreorderSuccess,
} from './api.js';
import { mountCardElement, stripeConfigured, type StripeCard } from './stripe.js';

/** The lead line, verbatim, everywhere in this phase (§19, B.2). */
export const PREORDER_SAVED_LEAD = 'Pre-order saved — you were not charged';

export interface CheckoutReward {
  sku: string;
  title: string;
  priceCents: bigint;
  delivery: string;
}

type CreatePaymentMethod = (
  billing: Record<string, unknown>,
) => Promise<{ ok: true; paymentMethodId: string } | { ok: false; message: string }>;

export interface CheckoutFormProps {
  campaignId: string;
  reward: CheckoutReward;
  model: 'idea' | 'product';
  founderLegalName: string;
  /** Test seams — default to the real network + Stripe card. */
  fetchQuoteFn?: typeof defaultFetchQuote;
  submitFn?: typeof defaultSubmit;
  createPaymentMethodFn?: CreatePaymentMethod;
}

const RECOMMEND_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

export function CheckoutForm(props: CheckoutFormProps) {
  const fetchQuote = props.fetchQuoteFn ?? defaultFetchQuote;
  const submit = props.submitFn ?? defaultSubmit;

  const [step, setStep] = useState<'details' | 'review' | 'success'>('details');
  const [why, setWhy] = useState('');
  const [recommend, setRecommend] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [success, setSuccess] = useState<PreorderSuccess | null>(null);
  const [error, setError] = useState<PreorderError | null>(null);
  const [busy, setBusy] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const cardHandle = useRef<StripeCard | null>(null);
  const [cardReady, setCardReady] = useState(false);

  // Mount the Stripe card field once the review step is shown. Card data lives
  // in Stripe's iframe, never here (§28.3). Skipped in tests that inject a
  // payment-method function instead.
  useEffect(() => {
    if (step !== 'review' || props.createPaymentMethodFn) return;
    let cancelled = false;
    void (async () => {
      if (!cardRef.current) return;
      const handle = await mountCardElement(cardRef.current);
      if (cancelled) return;
      cardHandle.current = handle;
      setCardReady(Boolean(handle));
    })();
    return () => {
      cancelled = true;
      cardHandle.current?.element.unmount();
    };
  }, [step, props.createPaymentMethodFn]);

  const billing = { country: 'US', postalCode: postalCode.trim(), ...(stateCode.trim() ? { state: stateCode.trim() } : {}) };

  async function calculateTotal() {
    setError(null);
    if (!why.trim() || !recommend || !email.trim() || !phone.trim() || !postalCode.trim()) {
      setError({ code: 'invalid', message: 'Fill in the survey, your contact details, and billing before continuing.' });
      return;
    }
    setBusy(true);
    const result = await fetchQuote(props.campaignId, { rewardSku: props.reward.sku, billing });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuote(result.quote);
    setStep('review');
  }

  async function authorize() {
    setError(null);
    if (!ageOk) {
      setError({ code: 'age', message: 'Please confirm you are 18+ and billing in the US.', field: 'ageConfirmed' });
      return;
    }
    const createPm = props.createPaymentMethodFn ?? (async (b) => {
      if (!cardHandle.current) return { ok: false as const, message: 'The card field is not available yet.' };
      return cardHandle.current.createPaymentMethod(b);
    });

    setBusy(true);
    const pm = await createPm({ email, address: { postal_code: postalCode, country: 'US' } });
    if (!pm.ok) {
      setBusy(false);
      setError({ code: 'card', message: pm.message, field: 'card' });
      return;
    }
    const result = await submit(props.campaignId, {
      rewardSku: props.reward.sku,
      contact: { email: email.trim(), phone: phone.trim() },
      billing,
      ageConfirmed: ageOk,
      survey: { why: why.trim(), recommend: Number(recommend) },
      operationalSharingAck: true,
      founderMarketingConsent: marketing,
      newsletterConsent: newsletter,
      paymentMethodId: pm.paymentMethodId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(result.success);
    setStep('success');
  }

  if (step === 'success' && success) return <SuccessState success={success} />;

  return (
    <div className="checkout">
      {/*
        The reference's two-segment rail and `STEP 1 OF 2`.

        It lives inside the form rather than on the Drawer because the step
        does: lifting the state out to hand it to a chrome prop would put the
        §19 flow's own progress somewhere the flow cannot see it. The rail is
        decorative — the step is named in text beside it, which is what a
        screen reader reads — and the three steps are NOT renumbered: `details`
        and `review` are §19's, and `success` is Appendix B.2's done state.
      */}
      <div className="checkout__rail">
        <span className="checkout__rail-seg is-on" />
        <span className={step === 'review' ? 'checkout__rail-seg is-on' : 'checkout__rail-seg'} />
      </div>
      <p className="checkout__step">Step {step === 'details' ? 1 : 2} of 2</p>

      {error ? (
        <p className="checkout__error" role="alert">
          {error.message}
          {error.next ? ` ${error.next}` : ''}
        </p>
      ) : null}

      {step === 'details' ? (
        <>
          <p className="checkout__lead">
            You are reserving <strong>{props.reward.title}</strong>. Your card is saved today and{' '}
            <strong>US$0 is charged today</strong>.
          </p>

          <fieldset className="checkout__section">
            <legend>A quick question or two</legend>
            <Field label="Why do you want this product?">
              <Textarea value={why} maxLength={2000} onChange={(e) => setWhy(e.target.value)} />
            </Field>
            <Field label="How likely are you to recommend this to someone? (1–10)">
              <select
                className="pv-select"
                aria-label="How likely are you to recommend this to someone?"
                value={recommend}
                onChange={(e) => setRecommend(e.target.value)}
              >
                <option value="">Choose…</option>
                {RECOMMEND_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </fieldset>

          <fieldset className="checkout__section">
            <legend>Where to reach you</legend>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Billing postal code" hint="US billing only.">
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </Field>
            <Field label="State (2-letter)">
              <Input value={stateCode} maxLength={2} onChange={(e) => setStateCode(e.target.value)} />
            </Field>
          </fieldset>

          <Button tier="primary" onClick={calculateTotal} disabled={busy}>
            {busy ? 'Calculating…' : 'Calculate total'}
          </Button>
        </>
      ) : null}

      {step === 'review' && quote ? (
        <>
          {/*
            The reference's summary card and its `$0 today → $N at threshold`
            pair, wrapping the values the §19 quote already returned. Nothing
            here computes an amount: every figure below is `quote`'s, and the
            full itemised list follows it unchanged.
          */}
          <div className="checkout__summary">
            <span>
              {quote.rewardTitle}
              <small>{props.reward.delivery}</small>
            </span>
            <strong>US${quote.totalAuthorized}</strong>
          </div>
          <div className="checkout__rule">
            <div>
              <strong>US${quote.chargedToday}</strong>
              <span>Today</span>
            </div>
            <span className="checkout__rule-arrow" aria-hidden="true">
              →
            </span>
            <div>
              <strong>US${quote.totalAuthorized}</strong>
              <span>{props.model === 'idea' ? 'If the threshold is met' : 'When it closes'}</span>
            </div>
          </div>
          <p className="checkout__cancel-note">
            Cancel free any time before the charge date, and nothing is charged if you do.
          </p>

          <dl className="checkout__amounts">
            <div>
              <dt>Reward</dt>
              <dd>{quote.rewardTitle}</dd>
            </div>
            <div>
              <dt>Reward subtotal</dt>
              <dd>US${quote.rewardSubtotal}</dd>
            </div>
            <div>
              <dt>Sales tax</dt>
              <dd>US${quote.salesTax}</dd>
            </div>
            <div className="checkout__amounts-total">
              <dt>Total authorized</dt>
              <dd>US${quote.totalAuthorized}</dd>
            </div>
            <div>
              <dt>Charged today</dt>
              <dd>US${quote.chargedToday}</dd>
            </div>
          </dl>

          <ul className="checkout__facts">
            <li>Seller: {quote.founderLegalName}</li>
            <li>{quote.chargeRule}</li>
            <li>Charge time: {quote.chargeTimeUtc}</li>
            <li>Delivery: {quote.delivery}</li>
            <li>Expected statement: {quote.statementDescriptor}</li>
            <li>{quote.cancellationPath}</li>
          </ul>

          <details className="checkout__consent" open>
            <summary>The full consent you are authorizing (Appendix {quote.consentAppendix})</summary>
            <p className="checkout__consent-body">{quote.consentText}</p>
          </details>

          <p className="checkout__sharing">{quote.sharingDisclosure}</p>

          <div className="checkout__consents">
            <Toggle
              label="I confirm that I am at least 18 years old and that my billing location is in the United States."
              checked={ageOk}
              onCheckedChange={setAgeOk}
            />
            <Toggle
              label={quote.marketingLabel}
              sub="Optional"
              checked={marketing}
              onCheckedChange={setMarketing}
            />
            <Toggle
              label="Send me Proovd's monthly newsletter about new campaigns."
              sub="Optional"
              checked={newsletter}
              onCheckedChange={setNewsletter}
            />
          </div>

          {props.createPaymentMethodFn ? (
            <p className="checkout__card-note">Card entry is handled by Stripe.</p>
          ) : stripeConfigured() ? (
            <Field label="Card details">
              <div ref={cardRef} className="checkout__card" />
            </Field>
          ) : (
            <p className="checkout__card-note" role="note">
              Card entry isn&rsquo;t available on this deployment yet. Everything above is real; the
              secure card field turns on once Stripe is configured. You were not charged.
            </p>
          )}

          <Button
            tier="primary"
            onClick={authorize}
            disabled={busy || (!props.createPaymentMethodFn && !stripeConfigured()) || (!props.createPaymentMethodFn && stripeConfigured() && !cardReady)}
          >
            {busy ? 'Authorizing…' : 'Authorize pre-order'}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** Appendix B.2 — the pre-order success state. Leads with the not-charged fact. */
export function SuccessState({ success }: { success: PreorderSuccess }) {
  const magicToken = success.magicLinkUrl.split('/backer/')[1] ?? '';
  return (
    <div className="checkout checkout--success">
      <span className="checkout__done-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m5 12 4 4L19 6" />
        </svg>
      </span>
      <h3 className="checkout__success-lead">{PREORDER_SAVED_LEAD}.</h3>
      <p className="checkout__success-zero">US$0 charged today</p>
      {/*
        The reference's `Founding user #248` is deliberately NOT rendered.

        17b's `campaign_backer_numbers` is minted on a Backer's first COMMENT,
        not at pre-order (`campaign/comments.ts` is the only writer), so there
        is no number here to show. Producing one would mean minting it in the
        §19 flow — a behaviour change, in the one flow this rebuild is
        explicitly a restyle of — and inventing a display number instead would
        be a fabricated position in a queue (§30). The reserved reward and the
        amounts below are what a person actually needs from this state.
      */}
      <dl className="checkout__amounts">
        <div>
          <dt>Reserved</dt>
          <dd>{success.rewardTitle}</dd>
        </div>
        <div>
          <dt>Seller</dt>
          <dd>{success.founderLegalName}</dd>
        </div>
        <div>
          <dt>Reward subtotal</dt>
          <dd>US${success.rewardSubtotal}</dd>
        </div>
        <div>
          <dt>Sales tax</dt>
          <dd>US${success.salesTax}</dd>
        </div>
        <div className="checkout__amounts-total">
          <dt>Total authorized</dt>
          <dd>US${success.totalAuthorized}</dd>
        </div>
      </dl>
      <ul className="checkout__facts">
        <li>{success.chargeRule}</li>
        <li>Charge time: {success.chargeTimeUtc}</li>
        <li>Delivery: {success.delivery}</li>
        <li>Expected statement: {success.statementDescriptor}</li>
      </ul>
      <p className="checkout__today-trigger">Today → Charge decision → Delivery</p>
      <Button tier="primary" href={magicToken ? `/backer/${magicToken}` : success.magicLinkUrl}>
        Review or cancel pre-order
      </Button>
      <p className="checkout__magic-note">
        We emailed your secure backer link. You can cancel free any time before the charge date.
      </p>
    </div>
  );
}

/** The Drawer that opens the checkout from the live campaign page. */
export function CheckoutDrawer(props: CheckoutFormProps & { triggerLabel?: string }) {
  return (
    <Drawer
      trigger={<Button tier="primary">{props.triggerLabel ?? 'Reserve a pre-order'}</Button>}
      eyebrow={props.reward.title}
      title="Reserve a pre-order"
    >
      <CheckoutForm {...props} />
    </Drawer>
  );
}
