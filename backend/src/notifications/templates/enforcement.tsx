/**
 * The campaign suspension/kill notices — Spec §26.7, §27.3/§27.4/§27.5
 * (Phase 20b).
 *
 * One template, three audiences: the body leads with the Admin-recorded
 * customer explanation (already refused if it carries a raw provider or fraud
 * code, §33.9.11), then states the audience-specific money fact — whether this
 * reader was charged and what happens to that money — and ends with the human
 * route. §18's rule carries into the inbox: never one generic `Campaign
 * ended`.
 */

import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { BrandEmailTheme } from './brand-email-theme.js';
import { render } from '@react-email/render';

export interface EnforcementNoticeVariables {
  /** `paused` (suspend) or `stopped` (kill) — the customer word, never §23.1's. */
  outcomeWord: string;
  campaignTitle: string;
  /** The Admin-recorded §26.7 customer explanation. */
  explanation: string;
  /** The audience-specific money fact, composed by the sender. */
  moneyFact: string;
  /** What happens next for this reader. */
  nextStep: string;
  /** §27.2: a stable campaign reference the reader can quote. */
  reference: string;
  supportEmail: string;
}

export function enforcementNoticeSubject(v: EnforcementNoticeVariables): string {
  return `Campaign ${v.outcomeWord} — ${v.campaignTitle}`;
}

function EnforcementNoticeEmail({ v }: { v: EnforcementNoticeVariables }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${v.campaignTitle} has been ${v.outcomeWord} by Proovd.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>
            {v.campaignTitle} has been {v.outcomeWord}.
          </Heading>
          <Section style={section}>
            <Text style={notice}>{v.explanation}</Text>
          </Section>
          <Section style={section}>
            <Text style={text}>{v.moneyFact}</Text>
            <Text style={text}>{v.nextStep}</Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Questions: {v.supportEmail} — we respond within one business day, Monday to Friday,
              excluding U.S. federal holidays. A person answers.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: EnforcementNoticeVariables): string {
  return [
    `${v.campaignTitle} has been ${v.outcomeWord}.`,
    '',
    v.explanation,
    '',
    v.moneyFact,
    v.nextStep,
    '',
    '---',
    `Questions: ${v.supportEmail} — we respond within one business day, Monday to Friday,`,
    'excluding U.S. federal holidays. A person answers.',
    '',
    `Reference: ${v.reference}`,
  ].join('\n');
}

export interface RenderedEnforcementNotice {
  subject: string;
  html: string;
  text: string;
}

export async function renderEnforcementNotice(
  v: EnforcementNoticeVariables,
): Promise<RenderedEnforcementNotice> {
  return {
    subject: enforcementNoticeSubject(v),
    html: await render(<EnforcementNoticeEmail v={v} />),
    text: plainText(v),
  };
}

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', borderRadius: '1px', margin: '0 auto', maxWidth: '600px', padding: '44px' };
const eyebrow = { color: '#012D10', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 34px' };
const heading = { color: '#012D10', fontSize: '38px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: '46px', margin: '0 0 24px' };
const section = { margin: '0 0 8px' };
const text = { color: '#013F17', fontSize: '18px', fontWeight: 500, lineHeight: '28px', margin: '0 0 8px' };
const notice = {
  color: '#1a1a17',
  fontSize: '14px',
  lineHeight: '1.7',
  margin: '0 0 8px',
  whiteSpace: 'pre-line' as const,
};
const quiet = { color: '#A2AFA8', fontSize: '12px', lineHeight: '20px', margin: '0 0 8px' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
