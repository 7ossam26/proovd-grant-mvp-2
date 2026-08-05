/**
 * The Phase 21a messages — Spec §22.4, §22.5, §27.3, §27.5 (Phase 21a).
 *
 * The Backer delivery notice renders the SAME resolved item list
 * `resolveDeliveryNotice` produces — §22.5's five repeated items, each with its
 * own label, so §33.10.1 can assert against the rendered body rather than
 * against the sender's intention. There is no satisfaction control here:
 * §27.5 makes the survey its own message and §31.8's one-click surface is
 * Phase 21b's, so promising it now would be a link to nothing (§1.4).
 *
 * The Day 14 result names the outcome, the reasons in §22.4's own words, and
 * what happens next in the Spec's terms — never a raw provider or fraud code
 * (§25.6, §33.9.11), which the service refuses before this renders.
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
import { render } from '@react-email/render';

/* ── Backer delivery (§22.5, §33.10.1) ─────────────────────────────────────── */

export interface DeliveryNoticeVariables {
  campaignTitle: string;
  rewardTitle: string;
  /** The five §22.5 items, resolved and labelled. */
  items: readonly { key: string; label: string; value: string }[];
  actionUrl: string;
  /** §27.2: a stable reservation reference the Backer can quote. */
  reference: string;
  supportEmail: string;
}

export function deliveryNoticeSubject(v: DeliveryNoticeVariables): string {
  return `Your ${v.rewardTitle} is ready — ${v.campaignTitle}`;
}

function DeliveryNoticeEmail({ v }: { v: DeliveryNoticeVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Access to your ${v.rewardTitle} from ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>Your pre-order is ready.</Heading>
          {v.items.map((item) => (
            <Section key={item.key} style={section}>
              <Text style={label}>{item.label}</Text>
              <Text style={value}>{item.value}</Text>
            </Section>
          ))}
          <Section style={section}>
            <Text style={text}>
              <a href={v.actionUrl} style={link}>
                View pre-order or get help
              </a>
            </Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Campaign: {v.campaignTitle}. If anything is missing, contact the Founder first using
              the support route above. If that does not resolve it, reach Proovd at{' '}
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

export async function renderDeliveryNotice(v: DeliveryNoticeVariables) {
  const element = <DeliveryNoticeEmail v={v} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: deliveryNoticeSubject(v), html, text };
}

/* ── Founder Day 14 result (§22.4, §27.3) ──────────────────────────────────── */

export interface Day14ResultVariables {
  campaignTitle: string;
  outcome: 'pass' | 'fail';
  /** §22.4's own words for each recorded failure reason. */
  reasons: readonly string[];
  /** What happens now, in §22.4's terms. */
  consequences: readonly string[];
  /** The Admin's customer-facing explanation (§25.6, §29.4). */
  explanation: string;
  actionUrl: string;
  /** §27.2: a stable campaign reference the Founder can quote. */
  reference: string;
  supportEmail: string;
}

export function day14ResultSubject(v: Day14ResultVariables): string {
  return v.outcome === 'pass'
    ? `Day 14 Progress Check passed — ${v.campaignTitle}`
    : `Day 14 Progress Check did not pass — ${v.campaignTitle}`;
}

function Day14ResultEmail({ v }: { v: Day14ResultVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {v.outcome === 'pass'
          ? `Your Day 14 Progress Check passed for ${v.campaignTitle}.`
          : `Your Day 14 Progress Check did not pass for ${v.campaignTitle}.`}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>
            {v.outcome === 'pass'
              ? 'Your Day 14 Progress Check passed.'
              : 'Your Day 14 Progress Check did not pass.'}
          </Heading>
          <Section style={section}>
            <Text style={value}>{v.explanation}</Text>
          </Section>
          {v.reasons.length > 0 && (
            <Section style={section}>
              <Text style={label}>What we found</Text>
              {v.reasons.map((reason) => (
                <Text key={reason} style={value}>
                  {reason}
                </Text>
              ))}
            </Section>
          )}
          {v.consequences.length > 0 && (
            <Section style={section}>
              <Text style={label}>What happens now</Text>
              {v.consequences.map((consequence) => (
                <Text key={consequence} style={value}>
                  {consequence}
                </Text>
              ))}
            </Section>
          )}
          <Section style={section}>
            <Text style={text}>
              <a href={v.actionUrl} style={link}>
                View your campaign
              </a>
            </Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              Campaign: {v.campaignTitle}. Questions: {v.supportEmail} — we respond within one
              business day, Monday to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderDay14Result(v: Day14ResultVariables) {
  const element = <Day14ResultEmail v={v} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: day14ResultSubject(v), html, text };
}

/* ── Styles (read from proovd.css's palette; no hex invented here) ─────────── */

const body = { backgroundColor: '#0d0d0f', margin: 0, padding: '32px 0' } as const;
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 24px' } as const;
const eyebrow = {
  color: '#f5d90a',
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  margin: '0 0 12px',
} as const;
const heading = { color: '#fafaf7', fontSize: '24px', lineHeight: '1.3', margin: '0 0 20px' } as const;
const section = { margin: '0 0 18px' } as const;
const label = {
  color: '#8f8f96',
  fontSize: '12px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  margin: '0 0 4px',
} as const;
const value = { color: '#fafaf7', fontSize: '15px', lineHeight: '1.6', margin: 0 } as const;
const text = { color: '#fafaf7', fontSize: '15px', lineHeight: '1.6', margin: 0 } as const;
const link = { color: '#f5d90a', textDecoration: 'underline' } as const;
const rule = { borderColor: '#26262b', margin: '24px 0' } as const;
const quiet = { color: '#8f8f96', fontSize: '13px', lineHeight: '1.6', margin: 0 } as const;
