/**
 * The private campaign-specific Affiliate invitation — Spec §8, §27.2, §27.4, §3.
 *
 * ── The seven things §8 requires it to name ─────────────────────────────────
 *  1. the Founder and product/campaign          5. that the opportunity may
 *  2. why this Affiliate/channel was recruited     still be preparing
 *  3. which public presence Proovd reviewed     6. that declining later does
 *  4. that signup is for THIS campaign             not harm standing
 *                                               7. ONE secure account-claim
 *                                                  action, plus a support route
 *
 * ── Two sentences that are constants, not fields ────────────────────────────
 * §8 requires the email to say the opportunity may still be preparing and that
 * declining later does not harm standing. Both are promises about how Proovd
 * behaves, so neither is Admin's to reword under pressure from a Founder who
 * wants a roster filled — the same reasoning that made §7's no-guarantee
 * paragraph a constant. `PREPARING_NOTICE` and `DECLINE_NOTICE` are compared
 * verbatim by test, and the compose surface renders them read-only.
 *
 * ── What this email must never ask for (§8) ─────────────────────────────────
 * "It must not request sensitive bank, tax, password, or identity information
 * by email." Not a field, not a link to a form that collects them, not a
 * sentence inviting a reply containing them. Stripe collects identity and
 * banking through its own onboarding (§11), after an account exists. The
 * closing line says so explicitly, because the best defence against a phishing
 * email that imitates this one is a real one that tells people what we never do.
 *
 * ── One primary action (§27.2) ──────────────────────────────────────────────
 * The account-claim link. There is no second button — no "see the campaign",
 * no "reply to express interest". At this point in the lifecycle there is
 * nothing to accept: §8's recruitment "does not start the paid 72-hour response
 * clock", and the formal opportunity is Phase 12's.
 *
 * ── Vocabulary (§3) ─────────────────────────────────────────────────────────
 * `Creator`, never `affiliate`. `Pre-order`, never `reservation`. No
 * `pre-build` / `pre-launch` / `tranche` — those never render to a Creator.
 * The word `campaign` is fine; the internal type name is not.
 */

import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';

/**
 * §8: the email must say "that the opportunity may still be preparing."
 *
 * Fixed text. A Creator who reads this and signs up has been told, before they
 * spent any time, that there may be nothing to review yet — which is the whole
 * point of saying it. §1.4: never imply an activity that is not there.
 */
export const PREPARING_NOTICE =
  'This campaign may still be preparing. The Founder may not have finished setting up yet, ' +
  'so after you create your account there may be nothing for you to review for a while. ' +
  'We will email you when the campaign is ready to look at. There is nothing for you to chase.';

/**
 * §8: the email must say "that declining later does not harm standing."
 *
 * Fixed for the same reason. An editable version of this sentence is one that
 * quietly acquires a condition.
 */
export const DECLINE_NOTICE =
  'Creating an account does not commit you to anything. When the campaign is formally ' +
  'open you can accept it, decline it, or propose different terms, and declining does not ' +
  'affect whether we work with you again — not on this campaign and not on any future one.';

/**
 * §8: "It must not request sensitive bank, tax, password, or identity
 * information by email."
 *
 * Stated positively to the recipient, because a person who knows what Proovd
 * never asks for is a person who recognises the email that does.
 */
export const NEVER_ASKS_NOTICE =
  'Proovd will never ask you for your bank details, tax details, password, or identity ' +
  'documents by email. When it is time to set up payouts, you will do that inside your ' +
  'Proovd account, through Stripe.';

/** Mirrors the Founder template: an empty field must render as visibly empty. */
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z0-9 _/-]{2,}\]/g;

export interface AffiliateInvitationVariables {
  /** §8 item 1 — who they are, and the Founder and product. */
  recipientName: string | null;
  founderName: string | null;
  productName: string | null;
  /** §8 item 2 — why this Creator and this channel. */
  whyRecruited: string | null;
  /** §8 item 3 — the public presence Proovd actually looked at. */
  reviewedPresence: string | null;
  /** Who at Proovd is writing, and the reply route (§27.2). */
  senderName: string | null;
  senderEmail: string | null;
  /** The absolute claim URL, carrying the raw token. Never logged (§28.1). */
  claimUrl: string;
  /** The stable reference §27.2 requires. The campaign id. */
  reference: string;
  /** §27.8's published support address. */
  supportEmail: string;
  /**
   * Legacy presentation input, retained for existing compose callers. Personal
   * invitation emails no longer embed decorative art.
   */
  artUrl: string;
}

type Resolved = { [K in keyof AffiliateInvitationVariables]: string };

const MARKERS: Record<string, string> = {
  recipientName: '[RECIPIENT NAME]',
  founderName: '[FOUNDER NAME]',
  productName: '[PRODUCT NAME]',
  whyRecruited: '[WHY THIS CREATOR WAS RECRUITED]',
  reviewedPresence: '[PUBLIC PRESENCE PROOVD REVIEWED]',
  senderName: '[SENDER NAME]',
  senderEmail: '[SENDER EMAIL]',
};

function resolve(variables: AffiliateInvitationVariables): Resolved {
  const out = {} as Resolved;
  for (const [key, value] of Object.entries(variables)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    out[key as keyof AffiliateInvitationVariables] =
      trimmed || MARKERS[key] || `[${key.toUpperCase()}]`;
  }
  return out;
}

/**
 * §27.2: "Specific subject and campaign/product name."
 *
 * Names the product, because a Creator recruited to several campaigns needs to
 * tell two invitations apart in an inbox — and because support looking for
 * "the one about X" has to be able to find it.
 */
export function affiliateInvitationSubject(variables: AffiliateInvitationVariables): string {
  const productName = variables.productName?.trim() || MARKERS['productName']!;
  return `Your Proovd invitation for ${productName}`;
}

function AffiliateInvitationEmail({ v }: { v: Resolved }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${v.senderName} has invited you to review ${v.productName} on Proovd.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* §8 item 1 — the Founder and the product. */}
          <Text style={text}>Hi {v.recipientName},</Text>
          <Text style={text}>
            I would like to invite you to review {v.productName} by {v.founderName} on Proovd.
          </Text>

          {/* §8 item 2 — why this Creator and this channel. */}
          <Text style={label}>Why we came to you</Text>
          <Text style={text}>{v.whyRecruited}</Text>

          {/* §8 item 3 — which public presence Proovd reviewed. */}
          <Text style={label}>What we looked at</Text>
          <Text style={text}>{v.reviewedPresence}</Text>
          <Text style={text}>
            We reviewed what is publicly visible. If anything there is out of date, you can
            correct it when you create your account.
          </Text>

          {/* §8 item 4 — this campaign, and only this campaign. */}
          <Text style={label}>This invitation is for one campaign</Text>
          <Text style={text}>
            Signing up here creates your Proovd account and joins you to {v.productName} only.
            Proovd has no open signup — Creators join one campaign at a time, by invitation.
          </Text>

          {/* §8 item 5 — it may still be preparing. Fixed text. */}
          <Text style={text}>{PREPARING_NOTICE}</Text>

          {/* §8 item 6 — declining later does not harm standing. Fixed text. */}
          <Text style={text}>{DECLINE_NOTICE}</Text>

          {/* §8 item 7 / §27.2 — exactly one primary action. */}
          <Text style={text}>
            <Link href={v.claimUrl} style={action}>
              Review your invitation and create your account
            </Link>
          </Text>
          <Text style={text}>
            This link is personal to you and works once. If it stops working, reply to this
            email and we will send a new one.
          </Text>

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
          <Text style={quiet}>{NEVER_ASKS_NOTICE}</Text>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: Resolved): string {
  return [
    `Hi ${v.recipientName},`,
    '',
    `I would like to invite you to review ${v.productName} by ${v.founderName} on Proovd.`,
    '',
    'Why we came to you',
    v.whyRecruited,
    '',
    'What we looked at',
    v.reviewedPresence,
    'We reviewed what is publicly visible. If anything there is out of date, you can',
    'correct it when you create your account.',
    '',
    'This invitation is for one campaign',
    `Signing up here creates your Proovd account and joins you to ${v.productName} only.`,
    'Proovd has no open signup — Creators join one campaign at a time, by invitation.',
    '',
    PREPARING_NOTICE,
    '',
    DECLINE_NOTICE,
    '',
    'Review your invitation and create your account:',
    v.claimUrl,
    'This link is personal to you and works once. If it stops working, reply to this',
    'email and we will send a new one.',
    '',
    v.senderName,
    'Proovd',
    '',
    `Reply to this email, or write to ${v.senderEmail}.`,
    `For anything else, ${v.supportEmail} — we respond within one business day,`,
    'Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    NEVER_ASKS_NOTICE,
  ].join('\n');
}

export interface RenderedAffiliateInvitation {
  subject: string;
  html: string;
  text: string;
  /** Every bracketed marker still present. Non-empty ⇒ Send is unavailable. */
  unresolved: string[];
}

/**
 * Renders the invitation and reports what is still unresolved.
 *
 * The scan runs over the rendered subject, HTML, and text — not over the input
 * record — for the reason §7's gate documents: checking the inputs tests the
 * caller's list of required fields, while checking the output tests what the
 * Creator would actually receive.
 */
export async function renderAffiliateInvitation(
  variables: AffiliateInvitationVariables,
): Promise<RenderedAffiliateInvitation> {
  const resolved = resolve(variables);
  const subject = affiliateInvitationSubject(variables);
  const html = await render(<AffiliateInvitationEmail v={resolved} />);
  const text = plainText(resolved);

  const found = new Set<string>();
  for (const part of [subject, html, text]) {
    for (const marker of part.matchAll(PLACEHOLDER_PATTERN)) {
      found.add(marker[0]);
    }
  }

  return { subject, html, text, unresolved: [...found].sort() };
}

/* Inline styles keep the personal note readable across email clients. */

const body = { backgroundColor: '#FFFFFF', color: '#222222', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '20px 16px' };
const container = { maxWidth: '640px', margin: '0' };
const label = { fontSize: '16px', lineHeight: '24px', fontWeight: 700, color: '#222222', margin: '0 0 4px' };
const text = { fontSize: '16px', lineHeight: '24px', color: '#222222', margin: '0 0 16px' };
const quiet = { fontSize: '13px', lineHeight: '20px', color: '#555555', margin: '0 0 12px' };
const action = { color: '#166534', textDecoration: 'underline' };
