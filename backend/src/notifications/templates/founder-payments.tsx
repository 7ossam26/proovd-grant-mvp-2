/**
 * The Founder money messages — Spec §22.3, §27.3 (Phase 19b).
 *
 * Five templates: the W-9 request, the W-9 block, the payment release (one
 * template, three §27.3 keys), the early-release request acknowledgement, and
 * the early-release result. Every amount, status, and reason a Founder reads
 * here comes from the ONE §22.3 resolver (`readFounderPaymentStatus`) — one
 * source, many renderers (§33.8.13).
 *
 * Never a §3.2 money-status word, and never an internal payment-kind key —
 * §3.1's labels only. No raw provider code reaches any of these (§25.6).
 */

import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';

export interface RenderedFounderPaymentEmail {
  subject: string;
  html: string;
  text: string;
}

const SLA_LINE =
  'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.';

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = { fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#666666' };
const heading = { fontSize: '1.375rem', lineHeight: '1.3', color: '#111111' };
const section = { margin: '1rem 0' };
const text = { fontSize: '0.9375rem', lineHeight: '1.5', color: '#222222', margin: '0.25rem 0' };
const strong = { fontSize: '1.0625rem', lineHeight: '1.5', color: '#111111', margin: '0.25rem 0' };
const button = {
  backgroundColor: '#111111',
  color: '#FFFFFF',
  padding: '0.75rem 1.25rem',
  borderRadius: '0.5rem',
  fontSize: '0.9375rem',
};
const rule = { borderColor: '#E5E5E5', margin: '1.5rem 0' };
const quiet = { fontSize: '0.8125rem', lineHeight: '1.5', color: '#666666', margin: '0.25rem 0' };

function footer(supportEmail: string, reference: string) {
  return (
    <Section style={section}>
      <Text style={quiet}>
        Questions: {supportEmail} — {SLA_LINE}
      </Text>
      <Text style={quiet}>Reference: {reference}</Text>
    </Section>
  );
}

function footerText(supportEmail: string, reference: string): string[] {
  return ['---', `Questions: ${supportEmail} — ${SLA_LINE}`, '', `Reference: ${reference}`];
}

/* ── The W-9 request (§22.3, §27.3) ─────────────────────────────────────────── */

export const W9_PROMPT_LEAD = 'Proovd needs your W-9 before any Founder payment.';

/**
 * The "secure W-9 submission instructions" the pinned §22.3 action points at —
 * the context-preserving support route, with the reason no attachment goes out
 * cold. This message IS the instructions, so the sentence lives here.
 */
export const W9_SUBMISSION_INSTRUCTIONS =
  'Reply to this message and Proovd support will arrange the secure delivery of your W-9. Do not send the form as an ordinary attachment before support confirms the secure channel. Proovd records receipt and verification, and never stores your tax identification number.';

export interface W9PromptVariables {
  campaignTitle: string;
  /** True on a resubmission request — the recorded reason travels with it. */
  resubmission: boolean;
  resubmissionReason: string | null;
  paymentsUrl: string;
  reference: string;
  supportEmail: string;
}

function W9PromptEmail({ v }: { v: W9PromptVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${W9_PROMPT_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{W9_PROMPT_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            {v.resubmission ? (
              <Text style={text}>
                The W-9 you sent could not be verified and needs to be resubmitted
                {v.resubmissionReason ? `: ${v.resubmissionReason}` : '.'}
              </Text>
            ) : (
              <Text style={text}>
                Your campaign has closed and its charges have settled. A completed W-9 is required
                before any Founder payment can be made — a missing or unverified W-9 blocks every
                payment on the schedule.
              </Text>
            )}
            <Text style={text}>{W9_SUBMISSION_INSTRUCTIONS}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.paymentsUrl}>
              See your payment status
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderW9Prompt(v: W9PromptVariables): Promise<RenderedFounderPaymentEmail> {
  return {
    subject: v.resubmission
      ? `Your W-9 needs to be resubmitted — ${v.campaignTitle}`
      : `Your W-9 is needed — ${v.campaignTitle}`,
    html: await render(<W9PromptEmail v={v} />),
    text: [
      W9_PROMPT_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      v.resubmission
        ? `The W-9 you sent could not be verified and needs to be resubmitted${v.resubmissionReason ? `: ${v.resubmissionReason}` : '.'}`
        : 'Your campaign has closed and its charges have settled. A completed W-9 is required before any Founder payment can be made — a missing or unverified W-9 blocks every payment on the schedule.',
      W9_SUBMISSION_INSTRUCTIONS,
      '',
      'SEE YOUR PAYMENT STATUS',
      v.paymentsUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── The W-9 block (§22.3, §27.3) ───────────────────────────────────────────── */

export const W9_BLOCK_LEAD = 'Your Founder payment is blocked until your W-9 is verified.';

export interface W9BlockVariables {
  campaignTitle: string;
  /** The exact amount affected (§22.3), formatted `US$…`, from the resolver. */
  amountAffected: string;
  amountExact: boolean;
  nextReviewDate: string | null;
  paymentsUrl: string;
  reference: string;
  supportEmail: string;
}

function W9BlockEmail({ v }: { v: W9BlockVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${W9_BLOCK_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{W9_BLOCK_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={strong}>
              Amount affected: {v.amountAffected}
              {v.amountExact ? '' : ' at minimum — the exact amount is fixed when Creator earnings finalize'}
            </Text>
            <Text style={text}>
              Requirement: a completed, verified W-9. This is the only thing standing between you and
              the payment schedule.
            </Text>
            <Text style={text}>{W9_SUBMISSION_INSTRUCTIONS}</Text>
            {v.nextReviewDate ? <Text style={text}>Next review date: {v.nextReviewDate}</Text> : null}
          </Section>
          <Section style={section}>
            <Button style={button} href={v.paymentsUrl}>
              See your payment status
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderW9Block(v: W9BlockVariables): Promise<RenderedFounderPaymentEmail> {
  return {
    subject: `Action needed: W-9 required for your payment — ${v.campaignTitle}`,
    html: await render(<W9BlockEmail v={v} />),
    text: [
      W9_BLOCK_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Amount affected: ${v.amountAffected}${v.amountExact ? '' : ' at minimum — the exact amount is fixed when Creator earnings finalize'}`,
      'Requirement: a completed, verified W-9. This is the only thing standing between you and the payment schedule.',
      W9_SUBMISSION_INSTRUCTIONS,
      ...(v.nextReviewDate ? [`Next review date: ${v.nextReviewDate}`] : []),
      '',
      'SEE YOUR PAYMENT STATUS',
      v.paymentsUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── A payment released (§22.3, §27.3 — three keys, one template) ───────────── */

export interface PaymentReleasedVariables {
  /** §3.1's customer-facing label — never the internal kind key. */
  kindLabel: string;
  campaignTitle: string;
  amount: string;
  shareAmount: string;
  /** What this release is, in schedule terms — composed by the sender. */
  scheduleLine: string;
  /** Present on an early remaining release: the §33.8.12 sentence. */
  earlyLine: string | null;
  taxNote: string;
  paymentsUrl: string;
  reference: string;
  supportEmail: string;
}

function PaymentReleasedEmail({ v }: { v: PaymentReleasedVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${v.kindLabel} released — ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{`${v.kindLabel} released`}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={strong}>Released: {v.amount}</Text>
            <Text style={text}>Eligible Founder share: {v.shareAmount}</Text>
            <Text style={text}>{v.scheduleLine}</Text>
            {v.earlyLine ? <Text style={text}>{v.earlyLine}</Text> : null}
            <Text style={quiet}>{v.taxNote}</Text>
            <Text style={quiet}>
              Your campaign charges settled to your own Stripe account; this release is Proovd&apos;s
              recorded confirmation that this amount is yours under the payment schedule.
            </Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.paymentsUrl}>
              See your payment status
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderPaymentReleased(
  v: PaymentReleasedVariables,
): Promise<RenderedFounderPaymentEmail> {
  return {
    subject: `${v.kindLabel} released — ${v.campaignTitle}`,
    html: await render(<PaymentReleasedEmail v={v} />),
    text: [
      `${v.kindLabel} released`,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Released: ${v.amount}`,
      `Eligible Founder share: ${v.shareAmount}`,
      v.scheduleLine,
      ...(v.earlyLine ? [v.earlyLine] : []),
      v.taxNote,
      "Your campaign charges settled to your own Stripe account; this release is Proovd's recorded confirmation that this amount is yours under the payment schedule.",
      '',
      'SEE YOUR PAYMENT STATUS',
      v.paymentsUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Early-release request received (§22.3, §27.3) ──────────────────────────── */

export const EARLY_REQUEST_LEAD = 'Your early remaining payment request was received.';

export interface EarlyRequestVariables {
  campaignTitle: string;
  paymentsUrl: string;
  reference: string;
  supportEmail: string;
}

function EarlyRequestEmail({ v }: { v: EarlyRequestVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${EARLY_REQUEST_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{EARLY_REQUEST_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>
              Proovd reviews each request against recorded evidence that the promised reward or
              access is actually available to affected Backers, that the required communication was
              sent, that tax and payment requirements are complete, and that no immediate risk flag
              exists. Internal readiness alone is not enough.
            </Text>
            <Text style={text}>You will receive the decision with its reason. No action needed.</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.paymentsUrl}>
              See your payment status
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderEarlyRequestAck(
  v: EarlyRequestVariables,
): Promise<RenderedFounderPaymentEmail> {
  return {
    subject: `Early remaining payment request received — ${v.campaignTitle}`,
    html: await render(<EarlyRequestEmail v={v} />),
    text: [
      EARLY_REQUEST_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      'Proovd reviews each request against recorded evidence that the promised reward or access is actually available to affected Backers, that the required communication was sent, that tax and payment requirements are complete, and that no immediate risk flag exists. Internal readiness alone is not enough.',
      'You will receive the decision with its reason. No action needed.',
      '',
      'SEE YOUR PAYMENT STATUS',
      v.paymentsUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Early-release result (§22.3, §27.3) ────────────────────────────────────── */

export interface EarlyResultVariables {
  campaignTitle: string;
  approved: boolean;
  /**
   * The remaining payment this decision is about (§27.2: a money email names
   * its amount). An approved request releases it now; a declined one leaves it
   * on the default schedule — and either way the Founder is owed the number,
   * not just the verdict.
   */
  amount: string;
  reason: string;
  /** On approval: the §33.8.12 sentence travels with the good news. */
  neverSkipsLine: string | null;
  paymentsUrl: string;
  reference: string;
  supportEmail: string;
}

function EarlyResultEmail({ v }: { v: EarlyResultVariables }) {
  const lead = v.approved
    ? 'Your early remaining payment request was approved.'
    : 'Your early remaining payment request was declined.';
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${lead} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{lead}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Remaining payment: {v.amount}</Text>
            <Text style={text}>
              {v.approved
                ? 'Status: released — the remaining payment has been released to you.'
                : 'Status: eligible, on the default schedule — nothing has been released early.'}
            </Text>
            <Text style={text}>Reason: {v.reason}</Text>
            {v.neverSkipsLine ? <Text style={text}>{v.neverSkipsLine}</Text> : null}
            {!v.approved ? (
              <Text style={text}>
                The remaining payment stays on its default schedule. You can ask support to walk
                through what evidence was missing without losing context.
              </Text>
            ) : null}
          </Section>
          <Section style={section}>
            <Button style={button} href={v.paymentsUrl}>
              See your payment status
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderEarlyResult(v: EarlyResultVariables): Promise<RenderedFounderPaymentEmail> {
  const lead = v.approved
    ? 'Your early remaining payment request was approved.'
    : 'Your early remaining payment request was declined.';
  return {
    subject: v.approved
      ? `Early remaining payment approved — ${v.campaignTitle}`
      : `Early remaining payment declined — ${v.campaignTitle}`,
    html: await render(<EarlyResultEmail v={v} />),
    text: [
      lead,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Remaining payment: ${v.amount}`,
      v.approved
        ? 'Status: released — the remaining payment has been released to you.'
        : 'Status: eligible, on the default schedule — nothing has been released early.',
      `Reason: ${v.reason}`,
      ...(v.neverSkipsLine ? [v.neverSkipsLine] : []),
      ...(v.approved
        ? []
        : [
            'The remaining payment stays on its default schedule. You can ask support to walk through what evidence was missing without losing context.',
          ]),
      '',
      'SEE YOUR PAYMENT STATUS',
      v.paymentsUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}
