/**
 * The Backer's pre-charge reminder — Spec §20, Appendix B.3, §27.5.
 *
 * Roughly 24 hours before the charge decision, one reminder per still-active
 * scheduled transaction. It states the campaign, seller, amounts, the local/UTC
 * decision time, the condition, and the expected descriptor, and links to the
 * secure backer page to review or cancel.
 *
 * ── It never guarantees the card will succeed, and for Idea it never implies ──
 * the threshold is final before close (§20, B.3). The `condition` line is the
 * campaign rule as a *condition*, and the copy says "charge decision", not
 * "charge" — the threshold is measured at close, and even a met threshold does
 * not guarantee every card succeeds.
 */

import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';

export const PRECHARGE_LEAD = 'Your Proovd pre-order is scheduled for its charge decision tomorrow.';

export interface PrechargeReminderVariables {
  campaignTitle: string;
  founderLegalName: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  whenUtc: string;
  condition: string;
  statementDescriptor: string;
  magicLinkUrl: string;
  reference: string;
  supportEmail: string;
}

export function prechargeReminderSubject(v: PrechargeReminderVariables): string {
  return `Your Proovd pre-order for ${v.campaignTitle} is coming up`;
}

function PrechargeReminderEmail({ v }: { v: PrechargeReminderVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{PRECHARGE_LEAD}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{PRECHARGE_LEAD}</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Seller: {v.founderLegalName}</Text>
            <Text style={text}>Reward subtotal: US${v.rewardSubtotal}</Text>
            <Text style={text}>Sales tax: US${v.salesTax}</Text>
            <Text style={text}>Total authorized: US${v.totalAuthorized}</Text>
            <Text style={text}>When: {v.whenUtc}</Text>
            <Text style={text}>Condition: {v.condition}</Text>
            <Text style={text}>Expected statement: {v.statementDescriptor}</Text>
          </Section>
          <Section style={section}>
            <Button style={button} href={v.magicLinkUrl}>
              Review or cancel
            </Button>
            <Text style={quiet}>You can review or cancel before the deadline using your secure backer link.</Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Questions: {v.supportEmail} — we respond within one business day, Monday to Friday,
              excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: PrechargeReminderVariables): string {
  return [
    PRECHARGE_LEAD,
    '',
    `Campaign: ${v.campaignTitle}`,
    `Seller: ${v.founderLegalName}`,
    `Reward subtotal: US$${v.rewardSubtotal}`,
    `Sales tax: US$${v.salesTax}`,
    `Total authorized: US$${v.totalAuthorized}`,
    `When: ${v.whenUtc}`,
    `Condition: ${v.condition}`,
    `Expected statement: ${v.statementDescriptor}`,
    '',
    'REVIEW OR CANCEL',
    v.magicLinkUrl,
    'You can review or cancel before the deadline using your secure backer link.',
    '',
    '---',
    `Questions: ${v.supportEmail} — we respond within one business day, Monday to Friday,`,
    'excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
  ].join('\n');
}

export interface RenderedPrechargeReminder {
  subject: string;
  html: string;
  text: string;
}

export async function renderPrechargeReminder(
  v: PrechargeReminderVariables,
): Promise<RenderedPrechargeReminder> {
  return {
    subject: prechargeReminderSubject(v),
    html: await render(<PrechargeReminderEmail v={v} />),
    text: plainText(v),
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
