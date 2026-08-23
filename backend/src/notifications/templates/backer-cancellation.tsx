/**
 * The Backer's cancellation confirmation — Spec §20, Appendix B.4, §27.5.
 *
 * Leads with the exact B.4 words `Canceled — you were not charged`, states the
 * campaign, reward, US$0, and the local/UTC cancellation time, and offers the
 * re-pre-order route if the campaign is still open. No charge language beyond
 * `US$0`, because a cancellation is the one moment it is most important not to
 * imply money moved (§30).
 */

import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { BrandEmailTheme } from './brand-email-theme.js';
import { render } from '@react-email/render';

/** Appendix B.4's exact lead. */
export const CANCELED_LEAD = 'Canceled — you were not charged';

export interface CancellationVariables {
  campaignTitle: string;
  rewardTitle: string;
  canceledAtUtc: string;
  reference: string;
  supportEmail: string;
}

export function cancellationSubject(v: CancellationVariables): string {
  return `${CANCELED_LEAD} — ${v.campaignTitle}`;
}

function CancellationEmail({ v }: { v: CancellationVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${CANCELED_LEAD}. US$0 charged for ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{CANCELED_LEAD}.</Heading>
          <Section style={section}>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Reward: {v.rewardTitle}</Text>
            <Text style={text}>Canceled: {v.canceledAtUtc}</Text>
            <Text style={text}>Amount charged: US$0</Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              You can pre-order again any time before the campaign closes. Questions:{' '}
              {v.supportEmail} — we respond within one business day, Monday to Friday, excluding
              U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: CancellationVariables): string {
  return [
    `${CANCELED_LEAD}.`,
    '',
    `Campaign: ${v.campaignTitle}`,
    `Reward: ${v.rewardTitle}`,
    `Canceled: ${v.canceledAtUtc}`,
    'Amount charged: US$0',
    '',
    '---',
    `You can pre-order again any time before the campaign closes. Questions: ${v.supportEmail} —`,
    'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
  ].join('\n');
}

export interface RenderedCancellation {
  subject: string;
  html: string;
  text: string;
}

export async function renderCancellation(v: CancellationVariables): Promise<RenderedCancellation> {
  return { subject: cancellationSubject(v), html: await render(<CancellationEmail v={v} />), text: plainText(v) };
}

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const section = { margin: '0 0 1.5rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
