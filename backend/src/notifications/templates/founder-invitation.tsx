/**
 * The Founder invitation email — Spec §7, §27.2, §3.
 *
 * This is the first thing a real person receives from Proovd, and almost every
 * rule that governs it is a restraint rather than a feature.
 *
 * ── The nine things §7 requires it to contain ───────────────────────────────
 *  1. the Founder/product reference          6. an honest time expectation
 *  2. what Proovd understood                 7. no guarantee of Creator
 *  3. why they were selected                    acceptance or campaign result
 *  4. who sent it                            8. a reply/support path
 *  5. what the process includes              9. ONE secure draft action
 *
 * ── The no-guarantee language is fixed, not a field ─────────────────────────
 * §7: Admin "must not promise acceptance, results, reward pricing, or
 * participation by a specific Creator." If that paragraph were a database
 * column it would be editable, and an editable disclaimer is one that gets
 * softened for a Founder who wants reassurance. So it is a constant in this
 * file, the compose surface renders it read-only, and a test compares the sent
 * body against it.
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
  productUrl: '[PRODUCT URL]',
  whatWeUnderstood: '[WHAT PROOVD UNDERSTOOD]',
  whyInvited: '[WHY THIS FOUNDER WAS INVITED]',
  senderName: '[SENDER NAME]',
  senderEmail: '[SENDER EMAIL]',
  expectedSetupTime: '[EXPECTED SETUP TIME]',
};

function resolve(variables: InvitationVariables): Resolved {
  const out = {} as Resolved;
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key as keyof InvitationVariables] = trimmed || MARKERS[key] || `[${key.toUpperCase()}]`;
  }
  return out;
}

/**
 * §27.2: "Specific subject and campaign/product name." A subject that says
 * "An invitation from Proovd" is the kind a Founder deletes unread and support
 * later cannot find.
 */
export function invitationSubject(variables: InvitationVariables): string {
  const productName = variables.productName?.trim() || MARKERS['productName']!;
  return `Proovd invitation: run a campaign for ${productName}`;
}

function InvitationEmail({ v }: { v: Resolved }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`An invitation from ${v.senderName} at Proovd about ${v.productName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>

          <Heading style={heading}>
            {v.recipientName}, we would like to invite {v.productName} to run a campaign
            on Proovd.
          </Heading>

          {/* §7 item 2 — what Proovd understood. */}
          <Section style={section}>
            <Text style={label}>What we understood about {v.productName}</Text>
            <Text style={text}>{v.whatWeUnderstood}</Text>
            <Text style={quiet}>{v.productUrl}</Text>
          </Section>

          {/* §7 item 3 — why this Founder. */}
          <Section style={section}>
            <Text style={label}>Why we are writing to you</Text>
            <Text style={text}>{v.whyInvited}</Text>
          </Section>

          {/* §7 item 5 — what the process includes. */}
          <Section style={section}>
            <Text style={label}>What the process involves</Text>
            {PROCESS_SUMMARY.map((step, index) => (
              <Text key={index} style={text}>
                {index + 1}. {step}
              </Text>
            ))}
          </Section>

          {/* §7 item 6 — an honest time expectation. */}
          <Section style={section}>
            <Text style={label}>How long the setup takes</Text>
            <Text style={text}>{v.expectedSetupTime}</Text>
          </Section>

          {/* §7 item 7 — the no-guarantee language, fixed. */}
          <Section style={section}>
            <Text style={label}>What this is not</Text>
            <Text style={text}>{NO_GUARANTEE_TEXT}</Text>
          </Section>

          <Hr style={rule} />

          {/* §7 item 9 / §27.2 — exactly one primary action. */}
          <Section style={section}>
            <Link href={v.draftUrl} style={action}>
              Open your draft
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
              {v.supportEmail} — we respond within one business day, Monday to Friday,
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
    `${v.recipientName}, we would like to invite ${v.productName} to run a campaign on Proovd.`,
    '',
    `WHAT WE UNDERSTOOD ABOUT ${v.productName.toUpperCase()}`,
    v.whatWeUnderstood,
    v.productUrl,
    '',
    'WHY WE ARE WRITING TO YOU',
    v.whyInvited,
    '',
    'WHAT THE PROCESS INVOLVES',
    ...PROCESS_SUMMARY.map((step, index) => `${index + 1}. ${step}`),
    '',
    'HOW LONG THE SETUP TAKES',
    v.expectedSetupTime,
    '',
    'WHAT THIS IS NOT',
    NO_GUARANTEE_TEXT,
    '',
    'OPEN YOUR DRAFT',
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
    `For anything else, ${v.supportEmail} — we respond within one business day,`,
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

const body = { backgroundColor: '#FAFAFA', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { maxWidth: '37.5rem', margin: '0 auto', padding: '2rem 1.5rem' };
const eyebrow = { fontSize: '0.875rem', fontWeight: 900, letterSpacing: '0.08em', color: '#012D10', textTransform: 'uppercase' as const, margin: '0 0 1.5rem' };
const heading = { fontSize: '1.5rem', lineHeight: 1.25, fontWeight: 900, color: '#012D10', margin: '0 0 1.5rem' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '1rem', lineHeight: 1.55, color: '#013F17', margin: '0 0 0.5rem' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const rule = { borderColor: '#F1F3F2', margin: '2rem 0' };
const action = { display: 'inline-block', backgroundColor: '#41ED98', color: '#E9FFE1', fontSize: '1rem', fontWeight: 700, textDecoration: 'none', padding: '0.75rem 1.5rem', borderRadius: '1px' };
