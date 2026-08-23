/**
 * The four Founder interview emails — Spec §12, §27.1, §27.2, §27.3.
 *
 * §12: "Send confirmation, reminder, reschedule, and cancellation
 * notifications." §27.3 names all four as Founder events. They share one
 * template module rather than four files because they are four moments in the
 * life of one booking and say the same six things about it (§27.1) — four
 * copies of the same layout, the same styles, and the same footer would be four
 * places for one wording change to be applied three times.
 *
 * ── One action, and only where there is one ────────────────────────────────
 * §27.2 allows at most one primary action. A confirmation and a reschedule have
 * one: the joining link, which is the only thing the Founder needs. A
 * cancellation has none — there is nothing to join and nothing to fix, and a
 * button leading to a page that says so would be §1.4's failure with a link on
 * it. The reminder carries the same single link as the confirmation.
 *
 * ── Times are rendered twice, and that is §27.1 ────────────────────────────
 * "Timestamps render in local time with a UTC secondary." A Founder who booked
 * in one timezone and reads the email in another has to be able to tell which
 * one the time is in, and an interview missed over an offset is a US$2 discount
 * and a real person's afternoon. The caller formats both — it holds the
 * booking's stored zone, which is the whole reason §12 asks for the zone
 * separately from the instant.
 *
 * ── No cancellation link ───────────────────────────────────────────────────
 * Cancelling happens in the workspace or in the provider, both of which require
 * the Founder to be signed in. An email link that cancelled an interview would
 * be an unauthenticated state change reachable by anyone who saw the message.
 */

import {
  Body,
  Button,
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

export type InterviewEmailKind = 'confirmed' | 'reminder' | 'rescheduled' | 'canceled';

export interface InterviewEmailVariables {
  founderName: string | null;
  productName: string | null;
  /** The scheduled time in the Founder's own zone, already formatted. */
  localTime: string | null;
  /** §27.1's UTC secondary, already formatted. */
  utcTime: string | null;
  /** The IANA zone the booking was made in. */
  timezone: string | null;
  /** §12: Google Meet, Zoom, or Microsoft Teams — the customer-facing name. */
  meetingProvider: string | null;
  meetingLink: string | null;
  /** §12: "Interviewer." A named person, never "the Proovd team". */
  interviewer: string | null;
  /** Only on a cancellation. What was recorded, in plain language. */
  cancellationReason?: string | null;
  /** §27.1: what happens next, and when. */
  nextUpdate: string;
  reference: string;
  supportEmail: string;
}

type Resolved = Record<string, string>;

const MARKERS: Record<string, string> = {
  founderName: '[FOUNDER NAME]',
  productName: '[PRODUCT NAME]',
  localTime: '[SCHEDULED TIME]',
  utcTime: '[UTC TIME]',
  timezone: '[TIMEZONE]',
  meetingProvider: '[MEETING PROVIDER]',
  interviewer: '[INTERVIEWER]',
};

function resolve(variables: InterviewEmailVariables): Resolved {
  const out: Resolved = {};
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key] = trimmed || MARKERS[key] || '';
  }
  return out;
}

/**
 * §27.2: "specific subject". The product name is in every one of them, because
 * a Founder with two campaigns has to be able to tell which interview moved
 * without opening the message.
 */
export function interviewSubject(
  kind: InterviewEmailKind,
  variables: InterviewEmailVariables,
): string {
  const product = variables.productName?.trim() || MARKERS['productName']!;
  switch (kind) {
    case 'confirmed':
      return `Your Proovd interview is confirmed — ${product}`;
    case 'reminder':
      return `Your Proovd interview is coming up — ${product}`;
    case 'rescheduled':
      return `Your Proovd interview has moved — ${product}`;
    case 'canceled':
      return `Your Proovd interview is canceled — ${product}`;
  }
}

function heroFor(kind: InterviewEmailKind, v: Resolved): string {
  switch (kind) {
    case 'confirmed':
      return `${v['founderName']}, your interview is confirmed.`;
    case 'reminder':
      return `${v['founderName']}, your interview is coming up.`;
    case 'rescheduled':
      return `${v['founderName']}, your interview has moved.`;
    case 'canceled':
      return `${v['founderName']}, your interview is canceled.`;
  }
}

/**
 * The one sentence about the listing fee, and it is only true before payment.
 *
 * §12 makes the confirmed interview worth US$2, and §12 also makes cancelling
 * before payment recalculate. Saying so on the cancellation is what keeps the
 * Founder from discovering it at Checkout — but the sentence is written by the
 * caller, which is the only thing that knows whether the fee is already locked.
 */
export interface FeeNote {
  heading: string;
  body: string;
}

function InterviewEmail({
  kind,
  v,
  feeNote,
}: {
  kind: InterviewEmailKind;
  v: Resolved;
  feeNote: FeeNote | null;
}) {
  const showDetails = kind !== 'canceled';
  const link = v['meetingLink'];

  return (
    <Html lang="en">
      <Head />
      <Preview>{heroFor(kind, v)}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{heroFor(kind, v)}</Heading>

          <Section style={section}>
            <Text style={text}>
              {kind === 'canceled'
                ? `Your interview about ${v['productName']} is no longer booked.`
                : `This is your conversation with someone at Proovd about ${v['productName']}.`}
            </Text>
          </Section>

          {showDetails ? (
            <Section style={section}>
              <Text style={label}>When</Text>
              {/* §27.1: local time, with UTC as the secondary. */}
              <Text style={text}>
                {v['localTime']} ({v['timezone']})
              </Text>
              <Text style={quiet}>{v['utcTime']} UTC</Text>

              <Text style={label}>Where</Text>
              <Text style={text}>{v['meetingProvider']}</Text>

              <Text style={label}>Who you are meeting</Text>
              <Text style={text}>{v['interviewer']}</Text>
            </Section>
          ) : null}

          {/* §27.2: at most one primary action. A cancellation has none. */}
          {showDetails && link ? (
            <Section style={section}>
              <Button href={link} style={button}>
                Join the interview
              </Button>
            </Section>
          ) : null}

          {kind === 'canceled' && v['cancellationReason'] ? (
            <Section style={section}>
              <Text style={label}>What was recorded</Text>
              <Text style={text}>{v['cancellationReason']}</Text>
            </Section>
          ) : null}

          {feeNote ? (
            <Section style={section}>
              <Text style={label}>{feeNote.heading}</Text>
              <Text style={text}>{feeNote.body}</Text>
            </Section>
          ) : null}

          <Section style={section}>
            <Text style={label}>What happens next</Text>
            <Text style={text}>{v['nextUpdate']}</Text>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions at any point: {v['supportEmail']} — we respond within one business day,
              Monday to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v['reference']}</Text>
            <Text style={quiet}>
              Proovd will never ask you for your bank details, tax details, password, or
              identity documents by email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(kind: InterviewEmailKind, v: Resolved, feeNote: FeeNote | null): string {
  const lines: string[] = [heroFor(kind, v), ''];

  lines.push(
    kind === 'canceled'
      ? `Your interview about ${v['productName']} is no longer booked.`
      : `This is your conversation with someone at Proovd about ${v['productName']}.`,
    '',
  );

  if (kind !== 'canceled') {
    lines.push(
      'WHEN',
      `${v['localTime']} (${v['timezone']})`,
      `${v['utcTime']} UTC`,
      '',
      'WHERE',
      v['meetingProvider'] ?? '',
      '',
      'WHO YOU ARE MEETING',
      v['interviewer'] ?? '',
      '',
    );
    if (v['meetingLink']) {
      lines.push('JOIN THE INTERVIEW', v['meetingLink'], '');
    }
  } else if (v['cancellationReason']) {
    lines.push('WHAT WAS RECORDED', v['cancellationReason'], '');
  }

  if (feeNote) {
    lines.push(feeNote.heading.toUpperCase(), feeNote.body, '');
  }

  lines.push(
    'WHAT HAPPENS NEXT',
    v['nextUpdate'] ?? '',
    '',
    '---',
    `Questions at any point: ${v['supportEmail']} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v['reference']}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  );

  return lines.join('\n');
}

export interface RenderedInterviewEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderInterviewEmail(
  kind: InterviewEmailKind,
  variables: InterviewEmailVariables,
  feeNote: FeeNote | null = null,
): Promise<RenderedInterviewEmail> {
  const resolved = resolve(variables);
  return {
    subject: interviewSubject(kind, variables),
    html: await render(<InterviewEmail kind={kind} v={resolved} feeNote={feeNote} />),
    text: plainText(kind, resolved, feeNote),
  };
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#F1F3F2', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FAFAFA', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const button = { backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '18px', fontWeight: 900, padding: '20px 44px', borderRadius: '1px', textDecoration: 'none', display: 'inline-block' };
