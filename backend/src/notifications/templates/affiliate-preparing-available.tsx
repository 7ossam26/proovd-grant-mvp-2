/**
 * The preparing-campaign notification — Spec §10, §27.2, §27.4, §31.5.
 *
 * §10: "A transactional notification has one action: `Review campaign`."
 *
 * One action. Not one primary action beside a secondary; one link in the whole
 * message. §27.2 allows at most one and §10 names it, so the only interactive
 * element here is that link and the plain-text support address.
 *
 * ── What this email must be careful not to imply ────────────────────────────
 * §10 is explicit that at this point the Creator "cannot accept, decline,
 * propose compensation, activate a link, or begin work until listing-fee
 * payment makes the formal opportunity actionable." So this message invites
 * them to *read*, and says plainly that there is nothing to decide yet and no
 * work to start. An email that read like an offer would create exactly the
 * expectation §10 spends a paragraph preventing.
 *
 * It also must not carry the confidential material. §31.5's exception is for a
 * "private authenticated" kit — email is neither. The campaign is named; the
 * Problem, Solution, Competition, and everything else stay behind the sign-in.
 *
 * ── The confidentiality reminder is a constant ─────────────────────────────
 * §31.5 grants the pre-view "before agreement" and requires the agreement
 * "before work". A Creator reading a Founder's unprotected product information
 * needs to be told, in the same message that grants access, that it is
 * confidential. That is a promise about how Proovd behaves, so it is fixed text
 * rather than something composed per campaign.
 */

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { BrandEmailTheme } from './brand-email-theme.js';
import { render } from '@react-email/render';

/** §10's one action, by name. A test asserts the link carries this label. */
export const REVIEW_CAMPAIGN = 'Review campaign';

/**
 * §31.5: the pre-view is granted before any agreement is signed, so the message
 * that grants it says what that means. Fixed text — an editable confidentiality
 * notice is one that gets trimmed for length.
 */
export const CONFIDENTIALITY_NOTICE =
  'What you can read is confidential. It is the Founder’s unreleased product information, ' +
  'shared with you early and in confidence because Proovd recruited you for this campaign. ' +
  'Please do not share it, post about it, or use it for anything else. Access is logged, and ' +
  'we can withdraw it at any time.';

/**
 * §10: no work permission. Said plainly, because the natural reading of "a
 * campaign is ready for you" is that something is being asked of you.
 */
export const NO_WORK_YET_NOTICE =
  'There is nothing to decide and nothing to do yet. You cannot accept, decline, or propose ' +
  'terms until the campaign is formally open, and no promotion should start before then. ' +
  'We will email you when it opens.';

export interface PreparingAvailableVariables {
  recipientName: string | null;
  productName: string | null;
  /** The one action's destination. Behind the Creator sign-in. */
  reviewUrl: string;
  reference: string;
  supportEmail: string;
}

type Resolved = { [K in keyof PreparingAvailableVariables]: string };

const MARKERS: Record<string, string> = {
  recipientName: '[RECIPIENT NAME]',
  productName: '[PRODUCT NAME]',
};

function resolve(variables: PreparingAvailableVariables): Resolved {
  const out = {} as Resolved;
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key as keyof PreparingAvailableVariables] =
      trimmed || MARKERS[key] || `[${key.toUpperCase()}]`;
  }
  return out;
}

export function preparingAvailableSubject(variables: PreparingAvailableVariables): string {
  const productName = variables.productName?.trim() || MARKERS['productName']!;
  return `${productName} is ready for you to read`;
}

function PreparingAvailableEmail({ v }: { v: Resolved }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>{`${v.productName} is preparing. You can read it now — nothing to decide yet.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>

          <Heading style={heading}>
            {v.recipientName}, {v.productName} is ready for you to read.
          </Heading>

          <Section style={section}>
            <Text style={text}>
              The Founder has finished setting up. You can now read what they have written
              about the product — the problem it solves, their solution, and how they see the
              competition — along with the campaign kit.
            </Text>
          </Section>

          {/* §10: no work permission, said before the action rather than after. */}
          <Section style={section}>
            <Text style={label}>Nothing is being asked of you yet</Text>
            <Text style={text}>{NO_WORK_YET_NOTICE}</Text>
          </Section>

          {/* §31.5: the exception is granted with its terms attached. */}
          <Section style={section}>
            <Text style={label}>This is confidential</Text>
            <Text style={text}>{CONFIDENTIALITY_NOTICE}</Text>
          </Section>

          <Hr style={rule} />

          {/* §10 / §27.2 — the ONE action. */}
          <Section style={section}>
            <Link href={v.reviewUrl} style={action}>
              {REVIEW_CAMPAIGN}
            </Link>
            <Text style={quiet}>You will be asked to sign in to your Proovd account.</Text>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions at any point: {v.supportEmail} — we respond within one business day,
              Monday to Friday, excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
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

function plainText(v: Resolved): string {
  return [
    `${v.recipientName}, ${v.productName} is ready for you to read.`,
    '',
    'The Founder has finished setting up. You can now read what they have written about',
    'the product — the problem it solves, their solution, and how they see the',
    'competition — along with the campaign kit.',
    '',
    'NOTHING IS BEING ASKED OF YOU YET',
    NO_WORK_YET_NOTICE,
    '',
    'THIS IS CONFIDENTIAL',
    CONFIDENTIALITY_NOTICE,
    '',
    REVIEW_CAMPAIGN.toUpperCase(),
    v.reviewUrl,
    'You will be asked to sign in to your Proovd account.',
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

export interface RenderedPreparingAvailable {
  subject: string;
  html: string;
  text: string;
}

export async function renderPreparingAvailable(
  variables: PreparingAvailableVariables,
): Promise<RenderedPreparingAvailable> {
  const resolved = resolve(variables);
  return {
    subject: preparingAvailableSubject(variables),
    html: await render(<PreparingAvailableEmail v={resolved} />),
    text: plainText(resolved),
  };
}

/* ── Styles — the proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#FFFFFF', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const action = { display: 'inline-block', backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '18px', fontWeight: 900, textDecoration: 'none', padding: '20px 44px', borderRadius: '1px' };
