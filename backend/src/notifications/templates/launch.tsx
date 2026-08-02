/**
 * Launch and first-post verification emails — Spec §17, §27.2, §27.3, §27.4.
 *
 * Five messages share one shell: at most one primary action (§27.2), a
 * plain-text part carrying the support route and the reference, and no
 * countdown pressure (§30) — any deadline is a stated time, once, labeled UTC.
 *
 * The first-post messages never imply money moved: §17/§33.4.7 make
 * verification a compliance gate, so `renderFirstPostPass` says earnings still
 * depend on captured, attributed charges and that nothing was released by the
 * verification itself.
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

function LaunchEmail({ s }: { s: Shell }) {
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
  return { subject: s.subject, html: await render(<LaunchEmail s={s} />), text: plainText(s) };
}

function named(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || fallback;
}

/* ── Campaign live — Founder (§27.3) ──────────────────────────────────────── */

export interface CampaignLiveFounderVariables {
  founderName: string | null;
  productName: string | null;
  campaignUrl: string;
  closeUtc: string;
  reference: string;
  supportEmail: string;
}

export async function renderCampaignLiveFounder(v: CampaignLiveFounderVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your campaign is live — ${product}`,
    preview: `${product} is now live and accepting pre-orders.`,
    heading: `${named(v.founderName, '[FOUNDER NAME]')}, ${product} is live.`,
    sections: [
      {
        label: 'What just happened',
        lines: [
          'Your approved campaign page is now public, and every scheduled Creator tracking link is active and pointing at it.',
          `The campaign closes ${v.closeUtc} (UTC). You are responsible for required updates, support answers, and truthful live content.`,
        ],
      },
      {
        label: 'What to do now',
        lines: [
          'Open your campaign to see it as a Backer does. Your live campaign workspace shows pre-orders, Creator activation and verification, and attribution as it comes in.',
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Campaign live — Creator (§27.4) ──────────────────────────────────────── */

export interface CampaignLiveAffiliateVariables {
  creatorName: string | null;
  productName: string | null;
  kitUrl: string;
  closeUtc: string;
  reference: string;
  supportEmail: string;
}

export async function renderCampaignLiveAffiliate(v: CampaignLiveAffiliateVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your tracking link is live — ${product}`,
    preview: `${product} is live and your tracking link is active.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, your link for ${product} is live.`,
    sections: [
      {
        label: 'You can post now',
        lines: [
          'The campaign is live and your unique tracking link is active. Publish your scheduled post with the working link, then submit the public post URL from your Campaign kit so we can verify it.',
          `The campaign closes ${v.closeUtc} (UTC).`,
        ],
      },
      {
        label: 'A reminder',
        lines: [
          'Your post must carry the disclosure text from the campaign — it is required by FTC rules and is part of your agreement. Verifying your post confirms compliance; it does not release any payment on its own. Your earnings depend on captured charges attributed to your link.',
        ],
      },
    ],
    action: { label: 'Open your Campaign kit', url: v.kitUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── First-post passed (§27.4) ────────────────────────────────────────────── */

export interface FirstPostPassVariables {
  creatorName: string | null;
  productName: string | null;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderFirstPostPass(v: FirstPostPassVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your post passed verification — ${product}`,
    preview: `Your first post for ${product} passed verification.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, your post passed.`,
    sections: [
      {
        lines: [
          'We verified your first post against the campaign requirements and it passed. Your tracking link stays active for the rest of the campaign.',
          'Passing verification does not release any payment on its own — it confirms your post is compliant. Your earnings depend on pre-orders that are captured and validly attributed to your link, and are estimated until the campaign closes and reconciles.',
        ],
      },
    ],
    action: { label: 'Open your Campaign kit', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── First-post correction needed (§27.4) ─────────────────────────────────── */

export interface FirstPostCorrectionVariables {
  creatorName: string | null;
  productName: string | null;
  correctionDetail: string;
  correctionDueUtc: string | null;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderFirstPostCorrection(v: FirstPostCorrectionVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `A correction is needed on your post — ${product}`,
    preview: `Your first post for ${product} needs a correction.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, your post needs a correction.`,
    sections: [
      {
        label: 'What to fix',
        lines: [
          v.correctionDetail,
          v.correctionDueUtc
            ? `Please make the correction and resubmit by ${v.correctionDueUtc} (UTC).`
            : 'Please make the correction and resubmit.',
        ],
      },
      {
        label: 'While it is being corrected',
        lines: [
          'Your tracking link is paused until the corrected post is verified, so traffic during the pause does not earn. Nothing about the campaign itself has changed, and this does not affect your standing with Proovd.',
        ],
      },
    ],
    action: { label: 'Open your Campaign kit', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── First-post rejected (§27.4) ──────────────────────────────────────────── */

export interface FirstPostRejectVariables {
  creatorName: string | null;
  productName: string | null;
  reason: string;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderFirstPostReject(v: FirstPostRejectVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your post could not be accepted — ${product}`,
    preview: `Your first post for ${product} could not be accepted.`,
    heading: `${named(v.creatorName, '[CREATOR NAME]')}, we could not accept your post.`,
    sections: [
      {
        label: 'What happened',
        lines: [
          v.reason,
          'Your tracking link is paused and this is under review by our team. Traffic during the pause does not earn. We will be in touch about next steps.',
        ],
      },
    ],
    action: { label: 'Contact support', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '1.5rem', lineHeight: 1.25, fontWeight: 900, color: '#012D10', margin: '0 0 1.5rem' };
const sectionStyle = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '1rem', lineHeight: 1.55, color: '#013F17', margin: '0 0 0.5rem' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
const button = { backgroundColor: '#012D10', color: '#FAFAFA', fontSize: '1rem', fontWeight: 700, padding: '0.75rem 1.5rem', borderRadius: '1px', textDecoration: 'none', display: 'inline-block' };
