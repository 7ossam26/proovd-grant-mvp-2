/**
 * The optional activity digest — Spec §27.7, §27.2, §30, DNA §5.5 (Phase 22c).
 *
 * The one message in the product a person may switch off, and the only one that
 * has to say so. Three things make it a summary rather than a nudge, and all
 * three are structural rather than editorial:
 *
 *  - **it lists what happened and asks for nothing.** Every line is a fact with
 *    a date. There is no "see what you missed", no count of anything unread, no
 *    scarcity, and `BANNED_DIGEST_TERMS` is scanned across the rendered output
 *    by the coverage suite — the wording is what leaks, so the wording is what
 *    is checked;
 *
 *  - **its one action is the preference itself** (§27.2 allows one). A digest
 *    whose primary action was "open your campaign" would be a check-in email
 *    with a list stapled to it, which is what §33.6.11 forbids. Each item names
 *    its campaign; the reader knows where to go;
 *
 *  - **it never carries a money fact.** The composer only ever hands this
 *    updates, comments, and roster changes. `DIGEST_PROHIBITIONS` states it and
 *    the suite asserts no eligible activity is a money or deadline message —
 *    because a charge receipt inside an opt-out-able email would breach §27.2's
 *    first rule.
 *
 * The subject names a campaign because §27.2 requires it. With more than one it
 * names the first and counts the rest, rather than a generic "Your Proovd
 * summary" — which is the subject line a check-in email would wear.
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
import { DIGEST_NEVER_REPLACES_TRANSACTIONAL, type DigestAudience } from '../digest-logic.js';
import type { RenderedNotice } from './plain.js';

export interface DigestItemView {
  campaignTitle: string;
  headline: string;
  occurredAt: Date;
}

export interface DigestVariables {
  audience: DigestAudience;
  frequency: 'daily' | 'weekly';
  items: readonly DigestItemView[];
  /** §27.2's one primary action. */
  preferencesUrl: string;
  supportEmail: string;
  reference: string;
}

const SLA_LINE =
  'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.';

/**
 * §27.1: dates render with a canonical UTC secondary. An email has no local
 * timezone to be primary about, so this is the honest half of the rule — and
 * the digest carries no deadline, so §27.1's spelled-out-timezone rule for
 * deadline emails does not apply to it.
 */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function subjectFor(v: DigestVariables): string {
  const titles = [...new Set(v.items.map((item) => item.campaignTitle))];
  const first = titles[0] ?? 'your campaign';
  const cadence = v.frequency === 'daily' ? 'Today' : 'This week';
  return titles.length > 1
    ? `${cadence} on ${first} and ${titles.length - 1} other campaign${titles.length > 2 ? 's' : ''}`
    : `${cadence} on ${first}`;
}

function headlineFor(v: DigestVariables): string {
  const count = v.items.length;
  const noun = count === 1 ? 'update' : 'updates';
  return v.frequency === 'daily'
    ? `${count} ${noun} in the last day`
    : `${count} ${noun} in the last week`;
}

function DigestEmail({ v }: { v: DigestVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{headlineFor(v)}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{headlineFor(v)}</Heading>
          <Section style={section}>
            {v.items.map((item, index) => (
              <Text key={`${item.campaignTitle}-${index}`} style={text}>
                {item.campaignTitle}: {item.headline} — {stamp(item.occurredAt)}
              </Text>
            ))}
          </Section>
          <Section style={section}>
            <Text style={text}>
              <a href={v.preferencesUrl} style={link}>
                Change how often you get this
              </a>
            </Text>
          </Section>
          <Hr style={rule} />
          <Section style={section}>
            {/*
              §27.2 vs §27.7. Someone turning this off has to know which of the
              two they are touching, or the control quietly reads as "stop
              emailing me" — and the next message they receive is a charge
              receipt they believe they unsubscribed from.
            */}
            <Text style={quiet}>{DIGEST_NEVER_REPLACES_TRANSACTIONAL}</Text>
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

function plainText(v: DigestVariables): string {
  const lines: string[] = [headlineFor(v), ''];
  for (const item of v.items) {
    lines.push(`${item.campaignTitle}: ${item.headline} — ${stamp(item.occurredAt)}`);
  }
  lines.push('', 'CHANGE HOW OFTEN YOU GET THIS', v.preferencesUrl, '');
  lines.push('---');
  lines.push(DIGEST_NEVER_REPLACES_TRANSACTIONAL);
  lines.push(`Questions: ${v.supportEmail} — ${SLA_LINE}`);
  lines.push('', `Reference: ${v.reference}`);
  return lines.join('\n');
}

export async function renderDigest(v: DigestVariables): Promise<RenderedNotice> {
  return {
    subject: subjectFor(v),
    html: await render(<DigestEmail v={v} />),
    text: plainText(v),
  };
}

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = {
  fontSize: '0.875rem',
  fontWeight: 900,
  letterSpacing: '0.08em',
  color: '#012D10',
  textTransform: 'uppercase' as const,
  margin: '0 0 1.5rem',
};
const heading = {
  fontSize: '1.5rem',
  lineHeight: 1.25,
  fontWeight: 900,
  color: '#012D10',
  margin: '0 0 1rem',
};
const section = { margin: '0 0 1.5rem' };
const text = { fontSize: '1rem', lineHeight: 1.55, color: '#013F17', margin: '0 0 0.25rem' };
const link = { color: '#012D10', textDecoration: 'underline' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
