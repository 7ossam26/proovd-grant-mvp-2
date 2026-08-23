/**
 * The listing-fee receipt and refund emails — Spec §13, §24.6, §27.1, §27.3.
 *
 * §13 fixes the receipt's contents: "amount, itemized savings/tax, receipt
 * access, refund condition, deadline, what happens next, owner, and next update
 * date." §27.2 adds the frame: specific subject, at most one action, a
 * plain-text part, a stable reference. The refund email is §13's Admin rule in
 * customer words: the full amount, to the original payment method, in the
 * typical 5–10 business days — and **never a promised settlement date**.
 *
 * ── The amounts come from the payment row ───────────────────────────────────
 * Appendix A's rule again: variables from the same versioned records the ledger
 * uses. The caller reads `listing_fee_payments` and formats; this file only
 * renders. No arithmetic happens here.
 *
 * ── The refund condition is A.5's own paragraph ─────────────────────────────
 * The receipt must state the refund condition, and the safest statement is the
 * one the Founder already consented to, verbatim. It is a constant the
 * acceptance suite compares against the Spec's appendix, exactly as the §27.8
 * contact block is pinned.
 *
 * ── Times are UTC, and say so ───────────────────────────────────────────────
 * §27.1 renders local with a UTC secondary where a local zone is *known*. The
 * interview emails know the booking's zone; a payment has none, and guessing
 * one would put a wrong wall-clock time on a deadline with money attached. So
 * the deadline is rendered once, labeled UTC, unambiguous.
 */

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { BrandEmailTheme } from './brand-email-theme.js';
import { render } from '@react-email/render';

/**
 * §13's refund condition, stated as the A.5 paragraph the Founder consented
 * to. Restated here because the backend cannot import `@proovd/shared` at
 * runtime; the acceptance suite drift-tests it against the shared register.
 */
/**
 * §27.2 asks every money email to name its seller and merchant of record, and
 * this is the only charge in the product where that is Proovd rather than the
 * Founder (§24.6, §13). Naming it here is what keeps the two streams legible
 * to the person paying: everything else they ever see is sold by them.
 */
export const LISTING_MERCHANT_OF_RECORD = 'Proovd LLC';

export const LISTING_REFUND_PROMISE = `Proovd will refund the entire amount charged at this Checkout — the
listing-fee subtotal plus the associated sales-tax reversal or
correction — if no eligible campaign-specific Creator is recruited,
or if no Creator and Founder mutually accept locked campaign terms
within 72 hours after this payment succeeds. A pending proposal does
not pause or extend that deadline. The same full refund applies if a
required launch Creator later fails and Proovd does not make a fully
ready replacement available within three U.S. business days after the
failure is recorded.`;

/**
 * §13's bank-timing sentence, in the only shape §13 allows: typical, and
 * never a promised date.
 */
export const REFUND_TIMING_SENTENCE =
  'Your bank typically shows the refund within 5–10 business days. We cannot promise an exact date — that timing belongs to your bank.';

/**
 * §13/§33.3.5: the separate 5% explanation, on the receipt as on the
 * pre-payment surface. Restated from `shared/src/checkout/consent.ts`
 * (`SEPARATE_FIVE_PERCENT_NOTE`) and drift-tested by the suite.
 */
export const SEPARATE_FIVE_PERCENT_NOTE =
  'Separately from this listing fee, Proovd retains 5% of the captured campaign reward ' +
  'subtotal if your campaign succeeds. That percentage is unchanged by anything on this page.';

/**
 * §12's five items, by their customer-facing labels. Restated from
 * `shared/src/workspace/optional-items.ts` (the backend cannot import it at
 * runtime) and drift-tested by the suite — an internal key in a Founder's
 * receipt would be the §3.1 leak.
 */
export const OPTIONAL_ITEM_LABELS: Record<string, string> = {
  visuals: 'Visuals',
  branding: 'Branding',
  interview: 'Founder interview',
  story: 'Story',
  socials: 'Socials',
};

export interface ListingFeeLine {
  label: string;
  /** Already formatted, e.g. "US$35.00" or "−US$2.00". */
  amount: string;
}

export interface ListingReceiptVariables {
  founderName: string | null;
  productName: string | null;
  /** The §24.6 lines: base, each labeled saving, tax, total. Pre-formatted. */
  lines: ListingFeeLine[];
  total: string;
  descriptor: string;
  /** Stripe's receipt when one exists; the itemisation below is always here. */
  receiptUrl: string | null;
  /** The 72-hour deadline, formatted, labeled UTC by the template. */
  responseDeadlineUtc: string;
  reference: string;
  supportEmail: string;
}

export interface ListingRefundVariables {
  founderName: string | null;
  productName: string | null;
  totalRefunded: string;
  /** Why, in the customer's words — the recorded customer_explanation. */
  explanation: string;
  reference: string;
  supportEmail: string;
}

const FALLBACKS: Record<string, string> = {
  founderName: '[FOUNDER NAME]',
  productName: '[PRODUCT NAME]',
};

function named(value: string | null, key: keyof typeof FALLBACKS): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || FALLBACKS[key]!;
}

/* ── The receipt ──────────────────────────────────────────────────────────── */

export function listingReceiptSubject(v: ListingReceiptVariables): string {
  return `Your Proovd listing payment and what starts now — ${named(v.productName, 'productName')}`;
}

function ReceiptEmail({ v }: { v: ListingReceiptVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${named(v.founderName, 'founderName')}, your listing payment succeeded.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>
            {named(v.founderName, 'founderName')}, your listing payment succeeded.
          </Heading>

          <Section style={section}>
            <Text style={label}>What you paid</Text>
            {v.lines.map((line) => (
              <Text style={text} key={line.label}>
                {line.label}: {line.amount}
              </Text>
            ))}
            <Text style={{ ...text, fontWeight: 700 }}>Total charged: {v.total}</Text>
            <Text style={text}>
              Seller and merchant of record: {LISTING_MERCHANT_OF_RECORD}
            </Text>
            <Text style={quiet}>Your card statement will show “{v.descriptor}”.</Text>
            {v.receiptUrl ? (
              <Text style={quiet}>Your card receipt: {v.receiptUrl}</Text>
            ) : (
              <Text style={quiet}>
                This email is your itemised receipt. A formal invoice is available any time through
                support without losing your place.
              </Text>
            )}
          </Section>

          <Section style={section}>
            <Text style={label}>The refund promise you accepted</Text>
            <Text style={text}>{LISTING_REFUND_PROMISE}</Text>
          </Section>

          <Section style={section}>
            <Text style={label}>The 5% is a separate stream</Text>
            <Text style={text}>{SEPARATE_FIVE_PERCENT_NOTE}</Text>
          </Section>

          <Section style={section}>
            <Text style={label}>The deadline that just started</Text>
            <Text style={text}>
              Creators now see the formal opportunity for {named(v.productName, 'productName')}.
              If no Creator and you mutually accept the same locked terms by{' '}
              {v.responseDeadlineUtc} (UTC), the full amount above is refunded automatically.
            </Text>
          </Section>

          <Section style={section}>
            <Text style={label}>What happens next, and who owns it</Text>
            <Text style={text}>
              Proovd owns this step. Campaign building continues in parallel — nothing is required
              from you right now. We will update you by {v.responseDeadlineUtc} (UTC) at the
              latest, or sooner when a Creator responds.
            </Text>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions at any point: {v.supportEmail} — we respond within one business day, Monday
              to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
            <Text style={quiet}>
              Proovd will never ask you for your bank details, tax details, password, or identity
              documents by email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function receiptText(v: ListingReceiptVariables): string {
  return [
    `${named(v.founderName, 'founderName')}, your listing payment succeeded.`,
    '',
    'WHAT YOU PAID',
    ...v.lines.map((line) => `${line.label}: ${line.amount}`),
    `Total charged: ${v.total}`,
    `Seller and merchant of record: ${LISTING_MERCHANT_OF_RECORD}`,
    `Your card statement will show "${v.descriptor}".`,
    v.receiptUrl
      ? `Your card receipt: ${v.receiptUrl}`
      : 'This email is your itemised receipt. A formal invoice is available any time through support.',
    '',
    'THE REFUND PROMISE YOU ACCEPTED',
    LISTING_REFUND_PROMISE,
    '',
    'THE 5% IS A SEPARATE STREAM',
    SEPARATE_FIVE_PERCENT_NOTE,
    '',
    'THE DEADLINE THAT JUST STARTED',
    `Creators now see the formal opportunity for ${named(v.productName, 'productName')}. If no`,
    `Creator and you mutually accept the same locked terms by ${v.responseDeadlineUtc} (UTC),`,
    'the full amount above is refunded automatically.',
    '',
    'WHAT HAPPENS NEXT, AND WHO OWNS IT',
    'Proovd owns this step. Campaign building continues in parallel — nothing is required from',
    `you right now. We will update you by ${v.responseDeadlineUtc} (UTC) at the latest, or sooner`,
    'when a Creator responds.',
    '',
    '---',
    `Questions at any point: ${v.supportEmail} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  ].join('\n');
}

/* ── The refund confirmation ──────────────────────────────────────────────── */

export function listingRefundSubject(v: ListingRefundVariables): string {
  return `Your Proovd listing fee is refunded in full — ${named(v.productName, 'productName')}`;
}

function RefundEmail({ v }: { v: ListingRefundVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${named(v.founderName, 'founderName')}, your listing fee is refunded in full.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>
            {named(v.founderName, 'founderName')}, your listing fee is refunded in full.
          </Heading>

          <Section style={section}>
            <Text style={label}>What happened</Text>
            <Text style={text}>{v.explanation}</Text>
          </Section>

          <Section style={section}>
            <Text style={label}>The money</Text>
            <Text style={text}>
              {v.totalRefunded} — the entire amount charged at Checkout, including its sales tax —
              is on its way back to your original payment method. {REFUND_TIMING_SENTENCE}
            </Text>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions at any point: {v.supportEmail} — we respond within one business day, Monday
              to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
            <Text style={quiet}>
              Proovd will never ask you for your bank details, tax details, password, or identity
              documents by email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function refundText(v: ListingRefundVariables): string {
  return [
    `${named(v.founderName, 'founderName')}, your listing fee is refunded in full.`,
    '',
    'WHAT HAPPENED',
    v.explanation,
    '',
    'THE MONEY',
    `${v.totalRefunded} — the entire amount charged at Checkout, including its sales tax — is on`,
    `its way back to your original payment method. ${REFUND_TIMING_SENTENCE}`,
    '',
    '---',
    `Questions at any point: ${v.supportEmail} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  ].join('\n');
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderListingReceipt(v: ListingReceiptVariables): Promise<RenderedEmail> {
  return {
    subject: listingReceiptSubject(v),
    html: await render(<ReceiptEmail v={v} />),
    text: receiptText(v),
  };
}

export async function renderListingRefund(v: ListingRefundVariables): Promise<RenderedEmail> {
  return {
    subject: listingRefundSubject(v),
    html: await render(<RefundEmail v={v} />),
    text: refundText(v),
  };
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px', whiteSpace: 'pre-line' as const };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
