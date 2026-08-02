/**
 * The formal-opportunity email — Spec §13, §14.3, §27.2, §27.4.
 *
 * Sent to each eligible Creator when the listing payment opens the formal
 * decision — §13's effect 4, delivered exactly once per association through
 * `notification_deliveries` (§13: "Affiliate formal-opportunity notifications
 * exactly once each").
 *
 * ── One action, and it goes to the campaign, not to a decision ──────────────
 * §27.2 allows at most one primary action. The accept/decline/propose surface
 * is Phase 12's; this email links to the Creator's own campaign view, where
 * today they see the opened state and their kit, and from Phase 12 the three
 * §14.2 actions. Putting a decision link in an email would put a commercial
 * choice one unauthenticated click away.
 *
 * ── The deadline is stated plainly, without pressure ────────────────────────
 * §14.3 gives the window; §30 forbids countdown pressure. One sentence, one
 * time, labeled UTC (no Creator timezone is stored), and the §8 promise
 * restated: declining does not harm standing.
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

/** §10's action word, reused: the email opens the campaign, nothing else. */
export const REVIEW_OPPORTUNITY_ACTION = 'Review the opportunity';

export interface FormalOpportunityVariables {
  creatorName: string | null;
  productName: string | null;
  /** The Creator's campaign view. The one link in the message. */
  campaignUrl: string;
  /** The 72-hour deadline, formatted, labeled UTC by the template. */
  responseDeadlineUtc: string;
  reference: string;
  supportEmail: string;
}

function named(value: string | null, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || fallback;
}

export function formalOpportunitySubject(v: FormalOpportunityVariables): string {
  return `The formal opportunity is open — ${named(v.productName, '[PRODUCT NAME]')}`;
}

function FormalOpportunityEmail({ v }: { v: FormalOpportunityVariables }) {
  const creator = named(v.creatorName, '[CREATOR NAME]');
  const product = named(v.productName, '[PRODUCT NAME]');
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${creator}, the formal opportunity for ${product} is open.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>
            {creator}, the formal opportunity for {product} is open.
          </Heading>

          <Section style={section}>
            <Text style={text}>
              The Founder has completed their listing, so the campaign you were recruited for is
              now a formal opportunity. Your campaign page has everything currently available —
              reading it commits you to nothing.
            </Text>
          </Section>

          <Section style={section}>
            <Text style={label}>The one date that matters</Text>
            <Text style={text}>
              A decision is open until {v.responseDeadlineUtc} (UTC). Declining, then or at any
              time, does not affect your standing with Proovd.
            </Text>
          </Section>

          <Section style={section}>
            <Button href={v.campaignUrl} style={button}>
              {REVIEW_OPPORTUNITY_ACTION}
            </Button>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions at any point: {v.supportEmail} — we respond within one business day, Monday
              to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
            <Text style={quiet}>
              Proovd will never ask you for your bank details, tax details, password, or identity
              documents by email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: FormalOpportunityVariables): string {
  const creator = named(v.creatorName, '[CREATOR NAME]');
  const product = named(v.productName, '[PRODUCT NAME]');
  return [
    `${creator}, the formal opportunity for ${product} is open.`,
    '',
    'The Founder has completed their listing, so the campaign you were recruited for is now a',
    'formal opportunity. Your campaign page has everything currently available — reading it',
    'commits you to nothing.',
    '',
    'THE ONE DATE THAT MATTERS',
    `A decision is open until ${v.responseDeadlineUtc} (UTC). Declining, then or at any time,`,
    'does not affect your standing with Proovd.',
    '',
    `${REVIEW_OPPORTUNITY_ACTION.toUpperCase()}`,
    v.campaignUrl,
    '',
    '---',
    `Questions at any point: ${v.supportEmail} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  ].join('\n');
}

export async function renderFormalOpportunity(v: FormalOpportunityVariables): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  return {
    subject: formalOpportunitySubject(v),
    html: await render(<FormalOpportunityEmail v={v} />),
    text: plainText(v),
  };
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '1.5rem', lineHeight: 1.25, fontWeight: 900, color: '#012D10', margin: '0 0 1.5rem' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '1rem', lineHeight: 1.55, color: '#013F17', margin: '0 0 0.5rem' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
const button = { backgroundColor: '#012D10', color: '#FAFAFA', fontSize: '1rem', fontWeight: 700, padding: '0.75rem 1.5rem', borderRadius: '1px', textDecoration: 'none', display: 'inline-block' };
