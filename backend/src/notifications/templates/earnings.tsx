/**
 * The Creator money messages — Spec §22.1, §27.4, Appendix B.7 (Phase 19a).
 *
 * Six templates: the completion decision, commission finalized, Transfer
 * created, Transfer failure, payout paid, payout failed. Every money status a
 * Creator reads here is the SAME server-rendered Appendix B.7 block the close
 * view renders (`resolveAffiliateMoneyStatus`) — one source, many renderers
 * (§33.8.13).
 *
 * No raw provider code reaches any of these (§25.6, §33.9.11): the Transfer
 * failure names the retry and the payout failure names the Stripe-managed
 * update path, and the codes stay on the internal rows. And never a §3.2
 * money-status word — §22.3's rule is scanned across this file by the suite.
 */

import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { BrandEmailTheme } from './brand-email-theme.js';
import { render } from '@react-email/render';

export interface RenderedEarningsEmail {
  subject: string;
  html: string;
  text: string;
}

const SLA_LINE =
  'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.';

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: '#012D10' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10' };
const section = { margin: '1rem 0' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '8px 0' };
const mono = {
  fontSize: '0.875rem',
  lineHeight: '1.5',
  color: '#222222',
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  backgroundColor: '#F1F1F1',
  padding: '0.75rem',
  borderRadius: '0.375rem',
};
const button = {
  backgroundColor: '#41ED98',
  color: '#E9FFE1',
  padding: '20px 44px',
  borderRadius: '1px',
  fontSize: '18px',
  fontWeight: 900,
};
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const quiet = { fontSize: '12px', lineHeight: '20px', color: '#A2AFA8', margin: '8px 0' };

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

/* ── The completion decision (§22.1, §27.4) ─────────────────────────────────── */

export const COMPLETION_DECISION_LEAD = 'Your campaign completion review is recorded.';

export interface CompletionDecisionVariables {
  campaignTitle: string;
  /** The customer-safe outcome sentence — a fixed map, never internal text. */
  outcomeLine: string;
  /** What happened to the fixed Creator payment, in §16's permitted words. */
  fixedPaymentLine: string | null;
  partnershipUrl: string;
  reference: string;
  supportEmail: string;
}

function CompletionDecisionEmail({ v }: { v: CompletionDecisionVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${COMPLETION_DECISION_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{COMPLETION_DECISION_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>{v.outcomeLine}</Text>
            {v.fixedPaymentLine ? <Text style={text}>{v.fixedPaymentLine}</Text> : null}
          </Section>
          <Section style={section}>
            <Button style={button} href={v.partnershipUrl}>
              Open your campaign view
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderCompletionDecision(
  v: CompletionDecisionVariables,
): Promise<RenderedEarningsEmail> {
  return {
    subject: `Completion review recorded — ${v.campaignTitle}`,
    html: await render(<CompletionDecisionEmail v={v} />),
    text: [
      COMPLETION_DECISION_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      v.outcomeLine,
      ...(v.fixedPaymentLine ? [v.fixedPaymentLine] : []),
      '',
      'OPEN YOUR CAMPAIGN VIEW',
      v.partnershipUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Commission finalized (§22.1, §27.4) ────────────────────────────────────── */

export const COMMISSION_FINALIZED_LEAD = 'Your campaign earnings are finalized.';

export interface CommissionFinalizedVariables {
  campaignTitle: string;
  commissionAmount: string;
  bonusAmount: string;
  fixedAmount: string;
  /** The rendered Appendix B.7 block — the one source (§33.8.13). */
  moneyStatusBlock: string;
  partnershipUrl: string;
  reference: string;
  supportEmail: string;
}

function CommissionFinalizedEmail({ v }: { v: CommissionFinalizedVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${COMMISSION_FINALIZED_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{COMMISSION_FINALIZED_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Finalized commission: US${v.commissionAmount}</Text>
            <Text style={text}>Earned bonus: US${v.bonusAmount}</Text>
            <Text style={text}>Fixed Creator payment eligible: US${v.fixedAmount}</Text>
          </Section>
          <Section style={section}>
            <Text style={mono}>{v.moneyStatusBlock}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.partnershipUrl}>
              Open your campaign view
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderCommissionFinalized(
  v: CommissionFinalizedVariables,
): Promise<RenderedEarningsEmail> {
  return {
    subject: `Earnings finalized — ${v.campaignTitle}`,
    html: await render(<CommissionFinalizedEmail v={v} />),
    text: [
      COMMISSION_FINALIZED_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Finalized commission: US$${v.commissionAmount}`,
      `Earned bonus: US$${v.bonusAmount}`,
      `Fixed Creator payment eligible: US$${v.fixedAmount}`,
      '',
      v.moneyStatusBlock,
      '',
      'OPEN YOUR CAMPAIGN VIEW',
      v.partnershipUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Transfer created (§22.1, §27.4) ────────────────────────────────────────── */

export const TRANSFER_CREATED_LEAD = 'Your campaign Transfer has been created.';

export interface TransferCreatedVariables {
  campaignTitle: string;
  commissionAmount: string;
  bonusAmount: string;
  fixedAmount: string;
  totalAmount: string;
  moneyStatusBlock: string;
  partnershipUrl: string;
  reference: string;
  supportEmail: string;
}

function TransferCreatedEmail({ v }: { v: TransferCreatedVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${TRANSFER_CREATED_LEAD} US$${v.totalAmount} for ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{TRANSFER_CREATED_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Finalized commission: US${v.commissionAmount}</Text>
            <Text style={text}>Earned bonus: US${v.bonusAmount}</Text>
            <Text style={text}>Fixed Creator payment: US${v.fixedAmount}</Text>
            <Text style={text}>Transfer total: US${v.totalAmount}</Text>
            <Text style={text}>
              Your bank payout follows your Stripe payout schedule; we will confirm when it is paid
              out.
            </Text>
          </Section>
          <Section style={section}>
            <Text style={mono}>{v.moneyStatusBlock}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.partnershipUrl}>
              Open your campaign view
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderTransferCreated(
  v: TransferCreatedVariables,
): Promise<RenderedEarningsEmail> {
  return {
    subject: `Transfer created — US$${v.totalAmount} for ${v.campaignTitle}`,
    html: await render(<TransferCreatedEmail v={v} />),
    text: [
      TRANSFER_CREATED_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Finalized commission: US$${v.commissionAmount}`,
      `Earned bonus: US$${v.bonusAmount}`,
      `Fixed Creator payment: US$${v.fixedAmount}`,
      `Transfer total: US$${v.totalAmount}`,
      'Your bank payout follows your Stripe payout schedule; we will confirm when it is paid out.',
      '',
      v.moneyStatusBlock,
      '',
      'OPEN YOUR CAMPAIGN VIEW',
      v.partnershipUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Transfer failure (§22.1, §32.3, §27.4) ─────────────────────────────────── */

export const TRANSFER_FAILURE_LEAD = 'Your campaign Transfer needs another attempt.';

export interface TransferFailureVariables {
  campaignTitle: string;
  /**
   * §27.2: a money message states its amount. Without it the Creator is told
   * something went wrong with an unnamed sum, which is the shape of message
   * that generates a support case rather than answering one.
   */
  amount: string;
  partnershipUrl: string;
  reference: string;
  supportEmail: string;
}

function TransferFailureEmail({ v }: { v: TransferFailureVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${TRANSFER_FAILURE_LEAD} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{TRANSFER_FAILURE_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Amount: {v.amount}</Text>
            <Text style={text}>Status: pending — retrying</Text>
            <Text style={text}>
              We could not complete the Transfer of your finalized earnings on the first attempt.
              Your amount is unchanged and approved; Proovd is retrying automatically.
            </Text>
            <Text style={text}>No action needed — we will confirm as soon as it completes.</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.partnershipUrl}>
              Open your campaign view
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export async function renderTransferFailure(
  v: TransferFailureVariables,
): Promise<RenderedEarningsEmail> {
  return {
    subject: `Transfer retry in progress — ${v.campaignTitle}`,
    html: await render(<TransferFailureEmail v={v} />),
    text: [
      TRANSFER_FAILURE_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Amount: ${v.amount}`,
      'Status: pending — retrying',
      'We could not complete the Transfer of your finalized earnings on the first attempt.',
      'Your amount is unchanged and approved; Proovd is retrying automatically.',
      'No action needed — we will confirm as soon as it completes.',
      '',
      'OPEN YOUR CAMPAIGN VIEW',
      v.partnershipUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}

/* ── Payout paid / payout failed (§22.1, §27.4) ─────────────────────────────── */

export const PAYOUT_PAID_LEAD = 'Your payout is on its way to your bank.';
export const PAYOUT_FAILED_LEAD = 'Your bank payout did not complete.';

export interface PayoutVariables {
  campaignTitle: string;
  moneyStatusBlock: string;
  partnershipUrl: string;
  reference: string;
  supportEmail: string;
}

function PayoutEmail({ v, lead, detail }: { v: PayoutVariables; lead: string; detail: string }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${lead} ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{lead}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>{detail}</Text>
          </Section>
          <Section style={section}>
            <Text style={mono}>{v.moneyStatusBlock}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.partnershipUrl}>
              Open your campaign view
            </Button>
          </Section>
          <Hr style={rule} />
          {footer(v.supportEmail, v.reference)}
        </Container>
      </Body>
    </Html>
  );
}

export const PAYOUT_PAID_DETAIL =
  'Stripe has paid out your balance, which includes this campaign Transfer.';
export const PAYOUT_FAILED_DETAIL =
  'Stripe could not pay out your balance. Update your payout details through your Stripe-managed payout setup — your earnings are unchanged and will pay out once your details are updated.';

export async function renderPayout(
  kind: 'paid' | 'failed',
  v: PayoutVariables,
): Promise<RenderedEarningsEmail> {
  const lead = kind === 'paid' ? PAYOUT_PAID_LEAD : PAYOUT_FAILED_LEAD;
  const detail = kind === 'paid' ? PAYOUT_PAID_DETAIL : PAYOUT_FAILED_DETAIL;
  return {
    subject: `${kind === 'paid' ? 'Payout paid' : 'Payout needs attention'} — ${v.campaignTitle}`,
    html: await render(<PayoutEmail v={v} lead={lead} detail={detail} />),
    text: [
      lead,
      '',
      `Campaign: ${v.campaignTitle}`,
      detail,
      '',
      v.moneyStatusBlock,
      '',
      'OPEN YOUR CAMPAIGN VIEW',
      v.partnershipUrl,
      '',
      ...footerText(v.supportEmail, v.reference),
    ].join('\n'),
  };
}
