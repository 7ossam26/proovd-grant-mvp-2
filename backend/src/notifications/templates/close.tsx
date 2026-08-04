/**
 * The close-batch messages — Spec §21, §27.3, §27.5, Appendix B.5 (Phase 18a).
 *
 * Four templates:
 *
 *  - the Backer's charge receipt — §21's campaign-aware confirmation, sent in
 *    addition to any provider receipt: Founder, campaign, reward, total,
 *    descriptor, delivery, magic link, and support;
 *  - the Backer's failed-payment recovery — Appendix B.5's exact block with
 *    ONE `Update card` action, neutral and non-shaming; the raw decline code
 *    never appears (§25.6, §33.9.11);
 *  - the Backer's US$0 no-charge closure — the threshold miss and the
 *    tax-unusable drop share the shape, each with its pinned reason sentence
 *    from `shared/close` (restated in `close/notifications.ts`);
 *  - the Founder's `Campaign ended` — fires at close, deliberately separate
 *    from `Results ready` (§21, §33.7.11), and says results follow separately.
 */

import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';

export interface RenderedCloseEmail {
  subject: string;
  html: string;
  text: string;
}

const SLA_LINE =
  'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.';

/* ── The charge receipt (§21, §27.5) ────────────────────────────────────────── */

export const CHARGE_RECEIPT_LEAD = 'Your Proovd pre-order charge is complete.';

export interface ChargeReceiptVariables {
  campaignTitle: string;
  founderLegalName: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalCaptured: string;
  statementDescriptor: string;
  delivery: string;
  magicLinkUrl: string;
  reference: string;
  supportEmail: string;
}

function ChargeReceiptEmail({ v }: { v: ChargeReceiptVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${CHARGE_RECEIPT_LEAD} US$${v.totalCaptured} for ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{CHARGE_RECEIPT_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Seller: {v.founderLegalName}</Text>
            <Text style={text}>Reward: {v.rewardTitle}</Text>
            <Text style={text}>Reward subtotal: US${v.rewardSubtotal}</Text>
            <Text style={text}>Sales tax: US${v.salesTax}</Text>
            <Text style={text}>Total charged: US${v.totalCaptured}</Text>
            <Text style={text}>Your statement shows: {v.statementDescriptor}</Text>
            <Text style={text}>Expected delivery: {v.delivery}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.magicLinkUrl}>
              View your pre-order
            </Button>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Questions: {v.supportEmail} — {SLA_LINE}
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderChargeReceipt(v: ChargeReceiptVariables): Promise<RenderedCloseEmail> {
  return {
    subject: `Receipt — US$${v.totalCaptured} for ${v.campaignTitle}`,
    html: await render(<ChargeReceiptEmail v={v} />),
    text: [
      CHARGE_RECEIPT_LEAD,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Seller: ${v.founderLegalName}`,
      `Reward: ${v.rewardTitle}`,
      `Reward subtotal: US$${v.rewardSubtotal}`,
      `Sales tax: US$${v.salesTax}`,
      `Total charged: US$${v.totalCaptured}`,
      `Your statement shows: ${v.statementDescriptor}`,
      `Expected delivery: ${v.delivery}`,
      '',
      'VIEW YOUR PRE-ORDER',
      v.magicLinkUrl,
      '',
      '---',
      `Questions: ${v.supportEmail} — ${SLA_LINE}`,
      '',
      `Reference: ${v.reference}`,
    ].join('\n'),
  };
}

/* ── The failed-payment recovery (Appendix B.5, §27.5) ─────────────────────── */

export interface FailedPaymentEmailVariables {
  /** The resolved B.5 body from `resolveFailedPaymentCopy` — exact text. */
  resolvedBody: string;
  /** B.5's one action label (`Update card`). */
  action: string;
  campaignTitle: string;
  updateCardUrl: string;
  reference: string;
  supportEmail: string;
}

function FailedPaymentEmail({ v }: { v: FailedPaymentEmailVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`We could not complete this pre-order charge for ${v.campaignTitle}. No money has moved.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          {/* Appendix B.5, resolved and rendered verbatim. */}
          <Section style={section}>
            <Text style={{ ...text, whiteSpace: 'pre-line' as const }}>{v.resolvedBody}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.updateCardUrl}>
              {v.action}
            </Button>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Questions: {v.supportEmail} — {SLA_LINE}
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderFailedPayment(
  v: FailedPaymentEmailVariables,
): Promise<RenderedCloseEmail> {
  return {
    subject: `Action needed — we could not complete your pre-order charge for ${v.campaignTitle}`,
    html: await render(<FailedPaymentEmail v={v} />),
    text: [
      v.resolvedBody,
      '',
      v.action.toUpperCase(),
      v.updateCardUrl,
      '',
      '---',
      `Questions: ${v.supportEmail} — ${SLA_LINE}`,
      '',
      `Reference: ${v.reference}`,
    ].join('\n'),
  };
}

/* ── The US$0 no-charge closure (§21 step 5 and the tax-unusable drop) ─────── */

export const NO_CHARGE_LEAD = 'Your pre-order closed without a charge.';

export interface NoChargeClosureVariables {
  /** The pinned reason sentence — THRESHOLD_MISS_REASON or TAX_UNUSABLE_DROP_REASON. */
  reason: string;
  campaignTitle: string;
  rewardTitle: string;
  reference: string;
  supportEmail: string;
}

function NoChargeClosureEmail({ v }: { v: NoChargeClosureVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${NO_CHARGE_LEAD} Amount charged: US$0.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{NO_CHARGE_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>{v.reason}</Text>
          </Section>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Reward: {v.rewardTitle}</Text>
            <Text style={text}>Amount charged: US$0</Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Your saved card will not be charged for this campaign. Questions: {v.supportEmail} —{' '}
              {SLA_LINE}
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderNoChargeClosure(
  v: NoChargeClosureVariables,
): Promise<RenderedCloseEmail> {
  return {
    subject: `${NO_CHARGE_LEAD.replace(/\.$/, '')} — ${v.campaignTitle}`,
    html: await render(<NoChargeClosureEmail v={v} />),
    text: [
      NO_CHARGE_LEAD,
      '',
      v.reason,
      '',
      `Campaign: ${v.campaignTitle}`,
      `Reward: ${v.rewardTitle}`,
      'Amount charged: US$0',
      '',
      '---',
      `Your saved card will not be charged for this campaign. Questions: ${v.supportEmail} — ${SLA_LINE}`,
      '',
      `Reference: ${v.reference}`,
    ].join('\n'),
  };
}

/* ── The Founder's Campaign ended (§21, §33.7.11) ──────────────────────────── */

export const CAMPAIGN_ENDED_LEAD = 'Your campaign has closed.';

export interface CampaignEndedVariables {
  founderName: string;
  campaignTitle: string;
  closedAtUtc: string;
  /** What close means for this campaign, stated factually — outcome copy, not a promise. */
  outcomeLine: string;
  campaignHomeUrl: string;
  reference: string;
  supportEmail: string;
}

function CampaignEndedEmail({ v }: { v: CampaignEndedVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${CAMPAIGN_ENDED_LEAD} ${v.campaignTitle} closed at ${v.closedAtUtc}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{CAMPAIGN_ENDED_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Hi {v.founderName},</Text>
            <Text style={text}>
              {v.campaignTitle} closed at {v.closedAtUtc}. New pre-orders, cancellations, and
              Creator joins have ended.
            </Text>
            <Text style={text}>{v.outcomeLine}</Text>
            <Text style={text}>
              Your full results — charges, retries, and reconciliation — arrive as a separate
              `Results ready` message once they are prepared. This message is only the close
              itself.
            </Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.campaignHomeUrl}>
              Open your campaign
            </Button>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Questions: {v.supportEmail} — {SLA_LINE}
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderCampaignEnded(v: CampaignEndedVariables): Promise<RenderedCloseEmail> {
  return {
    subject: `Campaign ended — ${v.campaignTitle}`,
    html: await render(<CampaignEndedEmail v={v} />),
    text: [
      CAMPAIGN_ENDED_LEAD,
      '',
      `Hi ${v.founderName},`,
      '',
      `${v.campaignTitle} closed at ${v.closedAtUtc}. New pre-orders, cancellations, and Creator joins have ended.`,
      '',
      v.outcomeLine,
      '',
      'Your full results — charges, retries, and reconciliation — arrive as a separate',
      '`Results ready` message once they are prepared. This message is only the close itself.',
      '',
      'OPEN YOUR CAMPAIGN',
      v.campaignHomeUrl,
      '',
      '---',
      `Questions: ${v.supportEmail} — ${SLA_LINE}`,
      '',
      `Reference: ${v.reference}`,
    ].join('\n'),
  };
}

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '1.375rem', lineHeight: 1.3, fontWeight: 900, color: '#012D10', margin: '0 0 1rem' };
const section = { margin: '0 0 1.5rem' };
const text = { fontSize: '1rem', lineHeight: 1.55, color: '#013F17', margin: '0 0 0.25rem' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const button = { backgroundColor: '#012D10', color: '#F5C518', fontSize: '1rem', fontWeight: 700, padding: '0.75rem 1.5rem', borderRadius: '0.5rem', textDecoration: 'none' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
