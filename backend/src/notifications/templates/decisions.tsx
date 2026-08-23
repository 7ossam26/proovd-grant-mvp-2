/**
 * The §14.2 decision emails — Spec §14.2, §27.2, §27.3, §27.4.
 *
 * Eight messages share one shell: at most one primary action (§27.2), a
 * plain-text part carrying the support route and the reference, and no
 * countdown pressure (§30) — the deadline is a stated time, once, labeled UTC.
 *
 * The durable acceptance confirmation is §14.2's own list: a worked example on
 * a captured pre-tax charge, what is fixed versus conditional, the first
 * action, dates, disclosure, support, and the explicit statement that
 * first-post verification releases no fixed-payment money. The worked example
 * is computed by the caller from the LOCKED terms — a template that did its
 * own arithmetic would be a second waterfall.
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
import {
  NO_FIXED_MONEY_AT_FIRST_POST,
  DECLINE_NO_PENALTY_NOTE,
  PENDING_PROPOSAL_NOTE,
} from '../../affiliates/roster-labels.js';

/* ── The shared shell ─────────────────────────────────────────────────────── */

interface Shell {
  subject: string;
  preview: string;
  heading: string;
  sections: Array<{ label?: string; lines: string[] }>;
  action?: { label: string; url: string } | undefined;
  reference: string;
  supportEmail: string;
}

function DecisionEmail({ s }: { s: Shell }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{s.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>
          <Heading style={heading}>{s.heading}</Heading>
          {s.sections.map((section, i) => (
            <Section style={sectionStyle} key={i}>
              {section.label ? <Text style={label}>{section.label}</Text> : null}
              {section.lines.map((line, j) => (
                <Text style={text} key={j}>
                  {line}
                </Text>
              ))}
            </Section>
          ))}
          {s.action ? (
            <Section style={sectionStyle}>
              <Button href={s.action.url} style={button}>
                {s.action.label}
              </Button>
            </Section>
          ) : null}
          <Hr style={rule} />
          <Section style={sectionStyle}>
            <Text style={quiet}>
              Questions at any point: {s.supportEmail} — we respond within one business day, Monday
              to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {s.reference}</Text>
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

function plainText(s: Shell): string {
  const lines: string[] = [s.heading, ''];
  for (const section of s.sections) {
    if (section.label) lines.push(section.label.toUpperCase());
    lines.push(...section.lines, '');
  }
  if (s.action) lines.push(s.action.label.toUpperCase(), s.action.url, '');
  lines.push(
    '---',
    `Questions at any point: ${s.supportEmail} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${s.reference}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  );
  return lines.join('\n');
}

async function renderShell(s: Shell): Promise<{ subject: string; html: string; text: string }> {
  return { subject: s.subject, html: await render(<DecisionEmail s={s} />), text: plainText(s) };
}

function named(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || fallback;
}

/* ── The durable acceptance confirmation (§14.2) ──────────────────────────── */

export interface AcceptConfirmationVariables {
  creatorName: string | null;
  productName: string | null;
  totalPercent: number;
  /** Formatted, e.g. "US$100.00" and "US$30.00" — computed by the caller. */
  exampleChargeFormatted: string;
  exampleShareFormatted: string;
  /** Formatted fixed payment, when one was agreed; null otherwise. */
  fixedPaymentFormatted: string | null;
  responseDeadlineUtc: string;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderAcceptConfirmation(v: AcceptConfirmationVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your terms are locked — ${product}`,
    preview: `Your compensation for ${product} is agreed and locked.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, your terms for ${product} are locked.`,
    sections: [
      {
        label: 'A worked example',
        lines: [
          `Your percentage is ${v.totalPercent}% of each successfully captured, validly attributed, pre-tax charge. ` +
            `On a captured pre-tax charge of ${v.exampleChargeFormatted}, your share would be ${v.exampleShareFormatted}. ` +
            'Sales tax is never part of this base.',
        ],
      },
      {
        label: 'What is fixed, and what is conditional',
        lines: [
          v.fixedPaymentFormatted
            ? `A fixed Creator payment of ${v.fixedPaymentFormatted} was agreed. It is funded by the Founder before launch and sits outside the percentage. ${NO_FIXED_MONEY_AT_FIRST_POST}`
            : `${NO_FIXED_MONEY_AT_FIRST_POST} No fixed payment is part of your terms; your compensation is the percentage above, and it depends entirely on captured charges attributed to your link.`,
          'The percentage is locked for this campaign. Your earnings depend on what is actually captured and attributed — nothing here is a guarantee of results.',
        ],
      },
      {
        label: 'Your first action',
        lines: [
          'Nothing yet. Your unique tracking link exists and is inactive; it activates only after the campaign is approved and you are marked ready. Posting before then earns nothing.',
        ],
      },
      {
        label: 'Dates and disclosure',
        lines: [
          `The campaign's response window runs to ${v.responseDeadlineUtc} (UTC); launch dates follow the Founder's approved campaign and we will email each one.`,
          'Every promotion must carry the disclosure text from your campaign page — it is required by FTC rules, and it is part of your agreement.',
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Decline confirmation (§14.2) ─────────────────────────────────────────── */

export interface DeclineConfirmationVariables {
  creatorName: string | null;
  productName: string | null;
  reference: string;
  supportEmail: string;
}

export async function renderDeclineConfirmation(v: DeclineConfirmationVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your decline was recorded — ${product}`,
    preview: DECLINE_NO_PENALTY_NOTE,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, your decision is recorded.`,
    sections: [
      {
        lines: [
          DECLINE_NO_PENALTY_NOTE,
          'There is nothing further to do, and nothing to undo. If a future campaign fits your audience, we may reach out again — that is always your decision too.',
        ],
      },
    ],
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Proposal lifecycle messages ──────────────────────────────────────────── */

export interface ProposalVariables {
  recipientName: string | null;
  productName: string | null;
  versionNumber: number;
  termsSummary: string;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderProposalSubmitted(v: ProposalVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your proposal was submitted — ${product}`,
    preview: `Version ${v.versionNumber} is with the Founder.`,
    heading: `${named(v.recipientName, '[CREATOR NAME]')}, your proposal is with the Founder.`,
    sections: [
      {
        lines: [
          `Version ${v.versionNumber}: ${v.termsSummary}.`,
          'The Founder can accept it, decline it, or propose a revision. Only a version both of you explicitly accept becomes your terms.',
          PENDING_PROPOSAL_NOTE,
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

export async function renderProposalReceived(v: ProposalVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `A Creator proposed terms — ${product}`,
    preview: `Proposal version ${v.versionNumber} is waiting for your decision.`,
    heading: `A Creator proposed terms for ${product}.`,
    sections: [
      {
        lines: [
          `Version ${v.versionNumber}: ${v.termsSummary}.`,
          'You can accept it, decline it, or propose a revision. A revision is not acceptance — only a version you both explicitly accept locks.',
          PENDING_PROPOSAL_NOTE,
        ],
      },
    ],
    action: { label: 'Review the proposal', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

export async function renderFounderRevision(v: ProposalVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `The Founder proposed a revision — ${product}`,
    preview: `Version ${v.versionNumber} is waiting for your decision.`,
    heading: `${named(v.recipientName, '[CREATOR NAME]')}, the Founder proposed a revision.`,
    sections: [
      {
        lines: [
          `Version ${v.versionNumber}: ${v.termsSummary}.`,
          'This replaces the previous version, and it is not an acceptance of what you proposed. You can accept it, decline it, or counter with your own version — declining still costs you nothing.',
        ],
      },
    ],
    action: { label: 'Review the revision', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

export interface DecisionOnVersionVariables extends ProposalVariables {
  decision: 'accepted' | 'declined';
  decidedBy: 'Founder' | 'Creator';
}

export async function renderVersionDecision(v: DecisionOnVersionVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  const accepted = v.decision === 'accepted';
  return renderShell({
    subject: accepted
      ? `Proposal accepted — ${product}`
      : `Proposal declined — ${product}`,
    preview: `The ${v.decidedBy} ${v.decision} version ${v.versionNumber}.`,
    heading: accepted
      ? `The ${v.decidedBy} accepted version ${v.versionNumber}.`
      : `The ${v.decidedBy} declined version ${v.versionNumber}.`,
    sections: [
      {
        lines: [
          `Version ${v.versionNumber}: ${v.termsSummary}.`,
          accepted
            ? 'Both sides have now explicitly accepted this exact version, so it is locked as the compensation for this campaign.'
            : 'Nothing is agreed and nothing was lost. The standard terms remain open to accept, and a new proposal can still be made while the response window is open.',
        ],
      },
    ],
    action: { label: 'Open the campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Deadline expiry (§14.6, §27.4) ───────────────────────────────────────── */

export interface ProposalExpiredVariables {
  creatorName: string | null;
  productName: string | null;
  reference: string;
  supportEmail: string;
}

export async function renderProposalExpired(v: ProposalExpiredVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `The response window closed — ${product}`,
    preview: `The decision window for ${product} has ended.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, the response window for ${product} closed.`,
    sections: [
      {
        lines: [
          'The campaign\'s response window ended before terms were agreed, so the open decision is now closed. This does not affect your standing with Proovd in any way.',
          'There is nothing you need to do. If a future campaign fits your audience, we may reach out again.',
        ],
      },
    ],
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#F1F3F2', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FAFAFA', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const sectionStyle = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const button = { backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '18px', fontWeight: 900, padding: '20px 44px', borderRadius: '1px', textDecoration: 'none', display: 'inline-block' };
