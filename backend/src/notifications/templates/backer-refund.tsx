/**
 * The Backer's refund notices — Spec §24.8, §27.5, Appendix B.6 (Phase 20a).
 *
 * The body IS the resolved Appendix B.6 block — amount, destination where
 * safely available, start date, the typical bank timing as a verified range
 * (never a promised settlement date, §13's rule), the status, and the quotable
 * reference — rendered line for line from the same resolver the magic-link
 * page uses (one source, many renderers). The B.6 action renders as the one
 * control. No decline code, no provider vocabulary (§25.6, §33.9.11).
 */

import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';

export interface RefundNoticeVariables {
  /** §27.5's event word: started / completed / failed. */
  statusWord: string;
  campaignTitle: string;
  /** The resolved Appendix B.6 body, action line already removed. */
  noticeBody: string;
  /** B.6's one action and where it goes. */
  action: string;
  actionUrl: string;
  reference: string;
  supportEmail: string;
}

export function refundNoticeSubject(v: RefundNoticeVariables): string {
  return `Refund ${v.statusWord} — ${v.campaignTitle}`;
}

function RefundNoticeEmail({ v }: { v: RefundNoticeVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Refund ${v.statusWord} for ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>Refund {v.statusWord}.</Heading>
          <Section style={section}>
            <Text style={notice}>{v.noticeBody}</Text>
          </Section>
          <Section style={section}>
            <Text style={text}>
              <a href={v.actionUrl} style={link}>
                {v.action}
              </a>
            </Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Campaign: {v.campaignTitle}. Questions: {v.supportEmail} — we respond within one
              business day, Monday to Friday, excluding U.S. federal holidays. Quote reference{' '}
              {v.reference} and we will have everything in front of us.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: RefundNoticeVariables): string {
  return [
    `Refund ${v.statusWord}.`,
    '',
    v.noticeBody,
    '',
    `${v.action}: ${v.actionUrl}`,
    '',
    '---',
    `Campaign: ${v.campaignTitle}. Questions: ${v.supportEmail} — we respond within one business`,
    'day, Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
  ].join('\n');
}

export interface RenderedRefundNotice {
  subject: string;
  html: string;
  text: string;
}

export async function renderRefundNotice(v: RefundNoticeVariables): Promise<RenderedRefundNotice> {
  return {
    subject: refundNoticeSubject(v),
    html: await render(<RefundNoticeEmail v={v} />),
    text: plainText(v),
  };
}

const body = { backgroundColor: '#f6f5f1', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0 };
const container = { backgroundColor: '#ffffff', borderRadius: '12px', margin: '24px auto', maxWidth: '560px', padding: '32px' };
const eyebrow = { color: '#6b6b66', fontSize: '12px', letterSpacing: '0.08em', margin: '0 0 8px', textTransform: 'uppercase' as const };
const heading = { color: '#1a1a17', fontSize: '22px', lineHeight: '1.3', margin: '0 0 16px' };
const section = { margin: '0 0 8px' };
const text = { color: '#1a1a17', fontSize: '14px', lineHeight: '1.6', margin: '0 0 8px' };
const notice = {
  color: '#1a1a17',
  fontSize: '14px',
  lineHeight: '1.7',
  margin: '0 0 8px',
  whiteSpace: 'pre-line' as const,
};
const link = { color: '#1a1a17', textDecoration: 'underline' };
const quiet = { color: '#6b6b66', fontSize: '12px', lineHeight: '1.6', margin: '0 0 8px' };
const rule = { borderColor: '#e8e6df', margin: '16px 0' };
