/**
 * The Creator's signup confirmation — Spec §11, §27.2, §27.4, §33.2.3.
 *
 * §27.4 names this "Signup confirmed / waiting state", and §11 fixes what the
 * waiting state has to say: it "confirms signup, names the campaign, says the
 * Founder is finishing setup, identifies Proovd as owner, gives the next-update
 * expectation, and says `No action needed`."
 *
 * Those are §27.1's six questions, and the email answers all six because a
 * Creator who signed up and heard nothing has no way to tell "still preparing"
 * from "forgotten". The surface says the same six things; this is the copy that
 * reaches someone who has closed the tab.
 *
 * ── `No action needed` is verbatim, and it is load-bearing ─────────────────
 * §11 puts it in backticks. §33.2.3 tests for it. A paraphrase — "nothing to do
 * for now", "sit tight" — is a softer promise that leaves room for the reader to
 * wonder whether something is expected of them. It is a constant here and a
 * constant on the surface, and both are compared against this export.
 *
 * ── One action, and at this moment there is none ───────────────────────────
 * §27.2 allows at most one primary action. There is nothing for a Creator to do
 * while the Founder finishes setup, so this email has no button at all — an
 * action that leads to a page saying "no action needed" is the §1.4 failure
 * with a link on it. The support route is a plain-text address, which is what
 * §27.2 means by a plain-text support route.
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

/** §11's exact words. §33.2.3 tests for this string. */
export const NO_ACTION_NEEDED = 'No action needed';

/**
 * §11: the waiting state "identifies Proovd as owner". Fixed text — the owner
 * of a wait is a promise about who is accountable for ending it, and an
 * editable version is one that quietly becomes "the Founder's fault".
 */
export const PROOVD_OWNS_THE_WAIT =
  'Proovd owns this step. We are working with the Founder to finish their setup, and we will ' +
  'email you as soon as there is something for you to look at.';

export interface SignupConfirmedVariables {
  recipientName: string | null;
  productName: string | null;
  /** §27.1: when the next update is expected. */
  nextUpdate: string;
  reference: string;
  supportEmail: string;
}

type Resolved = { [K in keyof SignupConfirmedVariables]: string };

const MARKERS: Record<string, string> = {
  recipientName: '[RECIPIENT NAME]',
  productName: '[PRODUCT NAME]',
};

function resolve(variables: SignupConfirmedVariables): Resolved {
  const out = {} as Resolved;
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key as keyof SignupConfirmedVariables] =
      trimmed || MARKERS[key] || `[${key.toUpperCase()}]`;
  }
  return out;
}

export function signupConfirmedSubject(variables: SignupConfirmedVariables): string {
  const productName = variables.productName?.trim() || MARKERS['productName']!;
  return `Your Proovd account is set up — ${productName}`;
}

function SignupConfirmedEmail({ v }: { v: Resolved }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your Proovd account is ready. ${v.productName} is still being prepared.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>

          {/* §11: confirms signup, and names the campaign. */}
          <Heading style={heading}>
            {v.recipientName}, your Proovd account is set up.
          </Heading>

          <Section style={section}>
            <Text style={text}>
              You are joined to {v.productName}. That is the one campaign this account is for.
            </Text>
          </Section>

          {/* §11: says the Founder is finishing setup, and who owns the wait. */}
          <Section style={section}>
            <Text style={label}>What happens next</Text>
            <Text style={text}>
              The Founder is still finishing their setup. Until that is done there is no
              campaign for you to review.
            </Text>
            <Text style={text}>{PROOVD_OWNS_THE_WAIT}</Text>
          </Section>

          {/* §11 / §27.1: the next-update expectation. */}
          <Section style={section}>
            <Text style={label}>When you will hear from us</Text>
            <Text style={text}>{v.nextUpdate}</Text>
          </Section>

          {/* §11's exact words. */}
          <Section style={section}>
            <Text style={label}>What you need to do</Text>
            <Text style={text}>{NO_ACTION_NEEDED}.</Text>
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
    `${v.recipientName}, your Proovd account is set up.`,
    '',
    `You are joined to ${v.productName}. That is the one campaign this account is for.`,
    '',
    'WHAT HAPPENS NEXT',
    'The Founder is still finishing their setup. Until that is done there is no campaign',
    'for you to review.',
    PROOVD_OWNS_THE_WAIT,
    '',
    'WHEN YOU WILL HEAR FROM US',
    v.nextUpdate,
    '',
    'WHAT YOU NEED TO DO',
    `${NO_ACTION_NEEDED}.`,
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

export interface RenderedSignupConfirmed {
  subject: string;
  html: string;
  text: string;
}

export async function renderSignupConfirmed(
  variables: SignupConfirmedVariables,
): Promise<RenderedSignupConfirmed> {
  const resolved = resolve(variables);
  return {
    subject: signupConfirmedSubject(variables),
    html: await render(<SignupConfirmedEmail v={resolved} />),
    text: plainText(resolved),
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
