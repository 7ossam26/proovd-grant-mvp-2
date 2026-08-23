/**
 * Launch, first-post verification, and discovery emails — Spec §17, §18, §27.2,
 * §27.3, §27.4.
 *
 * Six messages share one shell: at most one primary action (§27.2), a
 * plain-text part carrying the support route and the reference, and no
 * countdown pressure (§30) — any deadline is a stated time, once, labeled UTC.
 *
 * The first-post messages never imply money moved: §17/§33.4.7 make
 * verification a compliance gate, so `renderFirstPostPass` says earnings still
 * depend on captured, attributed charges and that nothing was released by the
 * verification itself. The Phase 14b discovery notice (§18) is factual, not a
 * nudge: it states what browse/index eligibility changed and how organic,
 * house, and Creator attribution differ.
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
import { BrandEmailTheme } from './brand-email-theme.js';
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
      <Head><BrandEmailTheme /></Head>
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

/* ── Discovery opened — Founder (§18, §27.3) ──────────────────────────────── */

export interface CampaignDiscoveryOpenedVariables {
  founderName: string | null;
  productName: string | null;
  campaignUrl: string;
  reference: string;
  supportEmail: string;
}

export async function renderCampaignDiscoveryOpened(v: CampaignDiscoveryOpenedVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your campaign can now be discovered — ${product}`,
    preview: `${product} can now appear in Proovd browse and search.`,
    heading: `${named(v.founderName, '[FOUNDER NAME]')}, ${product} can now be discovered.`,
    sections: [
      {
        label: 'What changed',
        lines: [
          'For its first seven days your campaign was reachable only through links you and your Creators shared. From today it can appear in Proovd browse and be indexed by search engines.',
          'Nothing about your pre-orders, your Creators, or their agreements changed. This does not rewrite any attribution already recorded.',
        ],
      },
      {
        label: 'How attribution works from here',
        lines: [
          'A pre-order that arrives through a Creator’s tracking link may earn that Creator a commission if the later charge succeeds.',
          'A pre-order that arrives organically — from browse, search, or a direct visit — carries no Creator commission.',
          'Proovd-house traffic is tracked separately from your Creators’ performance.',
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Threshold reached / lost — Founder (§20, §27.3) ──────────────────────── */

/**
 * §20's two crossing notices, one per crossing.
 *
 * Both state the count, the threshold, and what happens at close, and neither
 * promises a result: the Idea threshold is fixed at close (§21), so a campaign
 * that is above it today may not be at close and one below it today may be. A
 * `reached` message that read as a guarantee would be the §30 failure — and a
 * `lost` message that read as a warning to go and campaign harder would be the
 * §33.6.11 one arriving through the other door. Both are factual and neither
 * carries a countdown.
 */
export interface ThresholdCrossingVariables {
  founderName: string | null;
  productName: string | null;
  campaignUrl: string;
  uniqueActiveBackers: number;
  threshold: number;
  closeUtc: string;
  reference: string;
  supportEmail: string;
}

export async function renderThresholdReached(v: ThresholdCrossingVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your order threshold is met — ${product}`,
    preview: `${product} has reached its order threshold.`,
    heading: `${named(v.founderName, '[FOUNDER NAME]')}, ${product} has reached its order threshold.`,
    sections: [
      {
        label: 'Where the campaign stands',
        lines: [
          `${v.uniqueActiveBackers} unique Backers currently hold an active pre-order, against your threshold of ${v.threshold}.`,
          'Nobody has been charged. These Backers selected an offer and agreed to the charge rules, and the cards are saved for later.',
        ],
      },
      {
        label: 'What this does and does not mean',
        lines: [
          `The threshold is measured again when the campaign closes ${v.closeUtc} (UTC). What matters is the count at that moment, not today’s.`,
          'Backers can still cancel at no cost before close, so this figure can move in either direction. We will tell you if it drops back below.',
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

export async function renderThresholdLost(v: ThresholdCrossingVariables) {
  const product = named(v.productName, '[PRODUCT NAME]');
  return renderShell({
    subject: `Your order threshold is no longer met — ${product}`,
    preview: `${product} has dropped below its order threshold.`,
    heading: `${named(v.founderName, '[FOUNDER NAME]')}, ${product} is below its order threshold.`,
    sections: [
      {
        label: 'Where the campaign stands',
        lines: [
          `${v.uniqueActiveBackers} unique Backers currently hold an active pre-order, against your threshold of ${v.threshold}.`,
          'Nobody has been charged, and nothing has been decided.',
        ],
      },
      {
        label: 'What happens next',
        lines: [
          `The threshold is measured when the campaign closes ${v.closeUtc} (UTC). If it is met at that moment, the saved cards are charged under the rules Backers agreed to. If it is not, nobody is charged.`,
          'We are telling you because it changed, not because you need to do anything right now.',
        ],
      },
    ],
    action: { label: 'Open your campaign', url: v.campaignUrl },
    reference: v.reference,
    supportEmail: v.supportEmail,
  });
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const sectionStyle = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const button = { backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '18px', fontWeight: 900, padding: '20px 44px', borderRadius: '1px', textDecoration: 'none', display: 'inline-block' };
