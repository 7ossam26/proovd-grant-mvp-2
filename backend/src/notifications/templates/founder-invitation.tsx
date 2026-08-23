/**
 * The Founder invitation email — Spec §7, §27.2, §3.
 *
 * This is the first thing a real person receives from Proovd, and almost every
 * rule that governs it is a restraint rather than a feature.
 *
 * ── One primary action ──────────────────────────────────────────────────────
 * §27.2 allows at most one, and §7 names it: the secure draft link. There is no
 * second button, no "book a call", no "reply to get started" styled as an
 * action. The reply route is a plain-text address, which is what §27.2 means by
 * a plain-text support route.
 *
 * ── Nothing sensitive is ever requested ─────────────────────────────────────
 * No bank details, no tax details, no password, no identity documents, and no
 * field that looks like any of them. §8 states this for Affiliates and Phase 06
 * applies it everywhere: an email that asks for those things trains people to
 * answer the one that isn't from us.
 *
 * ── Vocabulary (§3) ─────────────────────────────────────────────────────────
 * `Creator`, never `affiliate`. `Pre-order`, never `reservation`. No
 * `pre-build` / `pre-launch` / `tranche` — those never render to a Founder.
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

/**
 * §7's no-guarantee paragraph. Fixed text. A test asserts the sent body
 * contains it verbatim, so softening it means deleting a passing test on
 * purpose rather than editing a string by accident.
 */
export const NO_GUARANTEE_TEXT =
  'Being invited is not an offer or a guarantee. Proovd cannot promise that any ' +
  'Creator will agree to promote your campaign, that your campaign will be approved, ' +
  'or that it will reach any particular result. Nothing here sets your reward prices ' +
  'or commits a named Creator to your campaign.';

/** §7's process summary. Fixed for the same reason. */
export const PROCESS_SUMMARY: readonly string[] = [
  'You tell us about the product, the problem it solves, and how many views your content gets.',
  'A person at Proovd reviews it with you, and may ask for a short interview.',
  'If it goes ahead, you set up your Stripe account, pay a listing fee, and build the campaign page.',
  'We introduce the campaign to Creators we have recruited for it. They decide for themselves whether to take it on.',
  'Backers save a card during the campaign and are charged later, under a rule shown to them before they commit.',
];

/**
 * A field that was left empty renders as its bracketed marker, and the marker
 * is what the preview gate looks for. §7: "Preview must show final variables
 * and no unresolved placeholder" — so an empty field has to be *visible* as
 * empty rather than collapsing into a sentence that reads fine and says
 * nothing.
 */
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z0-9 _/-]{2,}\]/g;

export interface InvitationVariables {
  recipientName: string | null;
  productName: string | null;
  productUrl: string | null;
  whatWeUnderstood: string | null;
  whyInvited: string | null;
  senderName: string | null;
  senderEmail: string | null;
  expectedSetupTime: string | null;
  /** The absolute draft URL, carrying the raw token. Never logged (§28.1). */
  draftUrl: string;
  /** The stable reference §27.2 requires. The campaign id. */
  reference: string;
  /** §27.8's published support address. */
  supportEmail: string;
}

type Resolved = {
  [K in keyof InvitationVariables]: string;
};

const MARKERS: Record<string, string> = {
  recipientName: '[RECIPIENT NAME]',
  productName: '[PRODUCT NAME]',
  whatWeUnderstood: '[WHAT PROOVD UNDERSTOOD]',
  whyInvited: '[WHY THIS FOUNDER WAS INVITED]',
  senderName: '[SENDER NAME]',
  senderEmail: '[SENDER EMAIL]',
  expectedSetupTime: '[EXPECTED SETUP TIME]',
};

/**
 * The one variable the message can do without, and why it is the only one.
 *
 * Every other variable here is a sentence the invitation is built out of — a
 * blank one leaves a hole a Founder would read, so it resolves to a marker and
 * the §7 preview gate refuses the send. The product URL is not a sentence: it
 * is a quiet supporting line under what Proovd understood, and the message
 * reads correctly without it.
 *
 * It is optional because a great many invitable Founders genuinely have no URL
 * — an Idea Campaign exists precisely for a product that is not built yet — and
 * a required box with nothing true to put in it is a box an Admin types
 * something into to get past the form. That is §5.3's reasoning, already
 * recorded for `campaign_fit`: an honestly incomplete record beats a
 * placeholder somebody invented. Until 2026-08-20 a blank URL resolved to
 * `[PRODUCT URL]`, which meant Send was refused for every Founder without a
 * website — and `Website` is not on the compose page's checklist, so the
 * button enabled and the refusal only arrived from the server.
 *
 * Adding anything to this set weakens the preview gate. Nothing belongs here
 * that a Founder would notice the absence of.
 */
const OPTIONAL_VARIABLES: ReadonlySet<string> = new Set(['productUrl']);

function resolve(variables: InvitationVariables): Resolved {
  const out = {} as Resolved;
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key as keyof InvitationVariables] = trimmed
      ? trimmed
      : OPTIONAL_VARIABLES.has(key)
        ? ''
        : (MARKERS[key] ?? `[${key.toUpperCase()}]`);
  }
  return out;
}

/**
 * §27.2: "Specific subject and campaign/product name." A subject that says
 * "An invitation from Proovd" is the kind a Founder deletes unread and support
 * later cannot find.
 */
export function invitationSubject(variables: InvitationVariables): string {
  const recipientName = variables.recipientName?.trim() || MARKERS['recipientName']!;
  const productName = variables.productName?.trim() || MARKERS['productName']!;
  return `${recipientName}, ${productName}'s first campaign is set up, come claim it`;
}

function InvitationEmail({ v }: { v: Resolved }) {
  return (
    <Html lang="en">
      <Head><BrandEmailTheme /></Head>
      <Preview>
        We filled it in from our call, read it over, fix what we got wrong, and it’s yours.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={wordmark}>proovd</Text>
          <Section style={art}>&nbsp;</Section>

          <Heading style={heading}>{v.recipientName}, your invite is ready.</Heading>
          <Heading as="h2" style={subheading}>
            {v.productName}'s first campaign, already set up on proovd.
          </Heading>
          <Text style={intro}>
            It came out of our call, so most of it is filled in. Read it over, fix
            anything we got wrong, and it's yours.
          </Text>

          <Hr style={rule} />

          {/* §7 item 9 / §27.2 — exactly one primary action. */}
          <Section style={section}>
            <Link href={v.draftUrl} style={action}>
              See your invite
            </Link>
            <Text style={quiet}>
              This link is personal to you and works once. It does not create an account,
              and nothing is charged. If it stops working, reply to this email and we will
              send a new one.
            </Text>
          </Section>

          <Hr style={rule} />

          {/* §7 item 4 + item 8 — who sent it, and how to reach a person. */}
          <Section style={section}>
            <Text style={text}>
              {v.senderName}
              <br />
              Proovd
            </Text>
            <Text style={quiet}>
              Reply to this email, or write to {v.senderEmail}. For anything else,{' '}
              {v.supportEmail}. We respond within one business day, Monday to Friday,
              excluding U.S. federal holidays.
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

/** The plain-text part. Hand-written so the support route and reference are
 *  exactly where §27.2 says they must be, rather than wherever a converter
 *  happened to put them. */
function plainText(v: Resolved): string {
  return [
    `${v.recipientName}, your invite is ready.`,
    `${v.productName}'s first campaign, already set up on proovd.`,
    '',
    "It came out of our call, so most of it is filled in. Read it over, fix anything we got wrong, and it's yours.",
    '',
    'SEE YOUR INVITE',
    v.draftUrl,
    'This link is personal to you and works once. It does not create an account, and',
    'nothing is charged. If it stops working, reply to this email and we will send a',
    'new one.',
    '',
    '---',
    v.senderName,
    'Proovd',
    '',
    `Reply to this email, or write to ${v.senderEmail}.`,
    `For anything else, ${v.supportEmail}. We respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    'Proovd will never ask you for your bank details, tax details, password, or',
    'identity documents by email.',
  ].join('\n');
}

export interface RenderedInvitation {
  subject: string;
  html: string;
  text: string;
  /** Every bracketed marker still present. Non-empty ⇒ Send is unavailable. */
  unresolved: string[];
}

/**
 * Renders the invitation and reports what is still unresolved.
 *
 * The scan runs over the *rendered* subject, body, and text rather than over
 * the input record. Checking the inputs would test the caller's list of
 * required fields; checking the output tests what the Founder would actually
 * receive, which is what §7's preview gate is about.
 */
export async function renderFounderInvitation(
  variables: InvitationVariables,
): Promise<RenderedInvitation> {
  const resolved = resolve(variables);
  const subject = invitationSubject(variables);
  const html = await render(<InvitationEmail v={resolved} />);
  const text = plainText(resolved);

  const found = new Set<string>();
  for (const part of [subject, html, text]) {
    for (const marker of part.matchAll(PLACEHOLDER_PATTERN)) {
      found.add(marker[0]);
    }
  }

  return { subject, html, text, unresolved: [...found].sort() };
}

/* ── Styles ───────────────────────────────────────────────────────────────────
   Inline, because email clients strip stylesheets. These are the proovd.css
   values written out by hand — a `<link>` to it would not survive the trip, and
   a mail client has no CSS variables to read a mode slot from. */

const body = {
  backgroundColor: '#FFFFFF',
  fontFamily: 'Satoshi, Arial, Helvetica, sans-serif',
  margin: 0,
  padding: '24px 12px',
};
const container = { backgroundColor: '#FFFFFF', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const wordmark = { fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: '24px', color: '#012D10', margin: 0 };
const art = { height: '112px', backgroundColor: '#DEFAFC', margin: '34px 0 0' };
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '46px 0 0' };
const subheading = { fontSize: '24px', lineHeight: '32px', fontWeight: 700, letterSpacing: '-0.02em', color: '#012D10', margin: '14px 0 0' };
const intro = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, letterSpacing: '-0.012em', color: '#013F17', margin: '24px 0 36px' };
const section = { margin: '0 0 24px' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '12px', lineHeight: '20px', fontWeight: 500, color: '#A2AFA8', margin: '8px 0 0' };
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
const action = { display: 'inline-block', backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '18px', lineHeight: '20px', fontWeight: 900, letterSpacing: '-0.02em', textDecoration: 'none', padding: '20px 44px', borderRadius: '1px' };
