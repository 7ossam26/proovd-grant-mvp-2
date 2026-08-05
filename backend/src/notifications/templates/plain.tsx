/**
 * The two structured messages every sender that had none was building by hand —
 * Spec §27.1, §27.2, §27.6 (Phase 22a).
 *
 * Fourteen senders reached Phase 22 emitting `html: <p>${summary}</p>` with the
 * same string as the text part. That is not a §27.2 message: it carries no
 * plain-text support route, no stable reference, and not even a complete HTML
 * document. Each one was locally reasonable — an internal queue notice does not
 * need a designed template — and collectively they were the largest hole in the
 * transactional contract, which is exactly the kind of thing a coverage sweep
 * exists to find.
 *
 * So there is one template with two entry points, and the difference between
 * them is real rather than cosmetic:
 *
 *  - `renderInternalNotice` addresses an Admin. §3.1's customer-facing names do
 *    not bind it — a queue notice that says `reservation` is naming the table
 *    the Admin will open — but §27.2's rules do: one action (the queue), a
 *    stable reference, and the facts as labelled rows rather than a sentence
 *    somebody has to parse under time pressure.
 *
 *  - `renderPlainNotice` addresses a Founder, Creator, or Backer. Same shape,
 *    plus the §27.8 support line and the §3.1 naming contract, which the
 *    coverage suite enforces against the rendered output.
 *
 * Facts are `{label, value}` rows rather than a prose blob because §27.1 asks
 * every one of these states to answer six questions, and a labelled row is
 * checkable where a paragraph is not.
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

export interface NoticeFact {
  label: string;
  value: string;
}

export interface PlainNoticeVariables {
  subject: string;
  headline: string;
  /** The labelled facts — §27.1's six questions, as many as apply. */
  facts: readonly NoticeFact[];
  /** Free-standing paragraphs below the facts, in order. */
  paragraphs?: readonly string[];
  /** §27.2: at most one. Omit it and the message carries none. */
  action?: { label: string; url: string } | undefined;
  /** §27.2: a stable campaign, reservation, or case reference. */
  reference: string;
  /** §27.2/§27.8: the plain-text support route. */
  supportEmail: string;
  /** Internal notices skip the customer SLA line — nobody is promised it. */
  internal?: boolean;
}

export interface RenderedNotice {
  subject: string;
  html: string;
  text: string;
}

const SLA_LINE =
  'we respond within one business day, Monday to Friday, excluding U.S. federal holidays.';

function PlainNoticeEmail({ v }: { v: PlainNoticeVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{v.headline}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{v.headline}</Heading>
          {v.facts.length > 0 && (
            <Section style={section}>
              {v.facts.map((fact) => (
                <Text key={fact.label} style={text}>
                  {fact.label}: {fact.value}
                </Text>
              ))}
            </Section>
          )}
          {(v.paragraphs ?? []).map((paragraph) => (
            <Section key={paragraph.slice(0, 48)} style={section}>
              {/*
                `pre-line`, because some paragraphs are pinned multi-line text
                — Appendix B.8's acknowledgement among them — and §33.11.5
                requires the string on screen and the string in the inbox to be
                the same string. Collapsing its line breaks in HTML while the
                text part keeps them would make two renderings of one promise.
              */}
              <Text style={paragraphText}>{paragraph}</Text>
            </Section>
          ))}
          {v.action && (
            <Section style={section}>
              <Text style={text}>
                <a href={v.action.url} style={link}>
                  {v.action.label}
                </a>
              </Text>
            </Section>
          )}
          <Hr style={rule} />
          <Section style={section}>
            <Text style={quiet}>
              {v.internal
                ? `Questions: ${v.supportEmail}`
                : `Questions: ${v.supportEmail} — ${SLA_LINE}`}
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: PlainNoticeVariables): string {
  const lines: string[] = [v.headline, ''];
  for (const fact of v.facts) lines.push(`${fact.label}: ${fact.value}`);
  if (v.facts.length > 0) lines.push('');
  for (const paragraph of v.paragraphs ?? []) {
    lines.push(paragraph, '');
  }
  if (v.action) {
    lines.push(v.action.label.toUpperCase(), v.action.url, '');
  }
  lines.push('---');
  lines.push(
    v.internal ? `Questions: ${v.supportEmail}` : `Questions: ${v.supportEmail} — ${SLA_LINE}`,
  );
  lines.push('', `Reference: ${v.reference}`);
  return lines.join('\n');
}

/** A Founder-, Creator-, or Backer-facing structured notice. */
export async function renderPlainNotice(v: PlainNoticeVariables): Promise<RenderedNotice> {
  const value = { ...v, internal: false };
  return {
    subject: v.subject,
    html: await render(<PlainNoticeEmail v={value} />),
    text: plainText(value),
  };
}

/** A §27.6 Admin queue notice. Same contract, no customer SLA promise. */
export async function renderInternalNotice(
  v: Omit<PlainNoticeVariables, 'internal'>,
): Promise<RenderedNotice> {
  const value = { ...v, internal: true };
  return {
    subject: v.subject,
    html: await render(<PlainNoticeEmail v={value} />),
    text: plainText(value),
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
const paragraphText = { ...text, whiteSpace: 'pre-line' as const };
const link = { color: '#012D10', textDecoration: 'underline' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
