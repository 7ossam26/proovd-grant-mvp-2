/**
 * The Backer's pre-order confirmation — Spec §19, Appendix B.2, §27.2, §27.5.
 *
 * The first message a Backer ever receives, and every surface in this phase
 * leads with the same words: `Pre-order saved — you were not charged`. §30
 * forbids anything that confuses a saved card with a charge, so there is no
 * celebration language, no "thank you for your purchase" — the lead line and the
 * `US$0 charged today` line are the whole tone.
 *
 * ── Verbatim lead, and the magic link ──────────────────────────────────────
 * `PREORDER_SAVED_LEAD` is the exact B.2 lead; it is a constant compared by
 * test, here and on the success page. The one primary action (§27.2) is the
 * magic link to the backer page — "Review or cancel pre-order" — because the
 * next thing a Backer might do is review or cancel, and the link is the only way
 * back in for an account-less Backer (§5.4).
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

/** Appendix B.2's exact lead. Tested here and on the success page. */
export const PREORDER_SAVED_LEAD = 'Pre-order saved — you were not charged';

export interface PreorderConfirmationVariables {
  campaignTitle: string;
  founderLegalName: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  chargeRule: string;
  chargeTimeUtc: string;
  delivery: string;
  statementDescriptor: string;
  magicLinkUrl: string;
  reference: string;
  supportEmail: string;
}

export function preorderConfirmationSubject(v: PreorderConfirmationVariables): string {
  return `${PREORDER_SAVED_LEAD} — ${v.campaignTitle}`;
}

function PreorderConfirmationEmail({ v }: { v: PreorderConfirmationVariables }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${PREORDER_SAVED_LEAD}. US$0 charged today for ${v.campaignTitle}.`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Proovd</Text>

          {/* Appendix B.2 lead, verbatim. */}
          <Heading style={heading}>{PREORDER_SAVED_LEAD}.</Heading>

          <Section style={section}>
            <Text style={big}>US$0 charged today</Text>
          </Section>

          <Section style={section}>
            <Text style={label}>Your pre-order</Text>
            <Text style={text}>Campaign: {v.campaignTitle}</Text>
            <Text style={text}>Seller: {v.founderLegalName}</Text>
            <Text style={text}>Reserved: {v.rewardTitle}</Text>
            <Text style={text}>Reward subtotal: US${v.rewardSubtotal}</Text>
            <Text style={text}>Sales tax: US${v.salesTax}</Text>
            <Text style={text}>Total authorized: US${v.totalAuthorized}</Text>
          </Section>

          <Section style={section}>
            <Text style={label}>When and whether you are charged</Text>
            <Text style={text}>{v.chargeRule}</Text>
            <Text style={text}>Charge time: {v.chargeTimeUtc}</Text>
            <Text style={text}>Expected statement: {v.statementDescriptor}</Text>
            <Text style={text}>Delivery: {v.delivery}</Text>
          </Section>

          <Section style={section}>
            <Button style={button} href={v.magicLinkUrl}>
              Review or cancel pre-order
            </Button>
            <Text style={quiet}>
              You can cancel free at any time before the charge date using this secure link.
            </Text>
          </Section>

          <Hr style={rule} />

          <Section style={section}>
            <Text style={quiet}>
              Questions about this campaign's product, delivery, or a refund go to {v.founderLegalName}
              {' '}through the support form on your backer page. For the Proovd platform itself,
              email {v.supportEmail} — we respond within one business day, Monday to Friday,
              excluding U.S. federal holidays.
            </Text>
            <Text style={quiet}>Reference: {v.reference}</Text>
            <Text style={quiet}>
              Proovd will never ask you for your card, bank details, password, or identity
              documents by email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(v: PreorderConfirmationVariables): string {
  return [
    `${PREORDER_SAVED_LEAD}.`,
    '',
    'US$0 charged today',
    '',
    'YOUR PRE-ORDER',
    `Campaign: ${v.campaignTitle}`,
    `Seller: ${v.founderLegalName}`,
    `Reserved: ${v.rewardTitle}`,
    `Reward subtotal: US$${v.rewardSubtotal}`,
    `Sales tax: US$${v.salesTax}`,
    `Total authorized: US$${v.totalAuthorized}`,
    '',
    'WHEN AND WHETHER YOU ARE CHARGED',
    v.chargeRule,
    `Charge time: ${v.chargeTimeUtc}`,
    `Expected statement: ${v.statementDescriptor}`,
    `Delivery: ${v.delivery}`,
    '',
    'REVIEW OR CANCEL YOUR PRE-ORDER',
    v.magicLinkUrl,
    'You can cancel free at any time before the charge date using this secure link.',
    '',
    '---',
    `Questions about this campaign go to ${v.founderLegalName} through the support form on your`,
    `backer page. For the Proovd platform itself, email ${v.supportEmail} — we respond within one`,
    'business day, Monday to Friday, excluding U.S. federal holidays.',
    '',
    `Reference: ${v.reference}`,
    '',
    'Proovd will never ask you for your card, bank details, password, or identity documents by email.',
  ].join('\n');
}

export interface RenderedPreorderConfirmation {
  subject: string;
  html: string;
  text: string;
}

export async function renderPreorderConfirmation(
  variables: PreorderConfirmationVariables,
): Promise<RenderedPreorderConfirmation> {
  return {
    subject: preorderConfirmationSubject(variables),
    html: await render(<PreorderConfirmationEmail v={variables} />),
    text: plainText(variables),
  };
}

/* ── Styles — proovd.css values written out by hand, as email requires ── */

const body = { backgroundColor: '#F1F3F2', fontFamily: 'Satoshi, Arial, Helvetica, sans-serif', margin: 0, padding: '24px 12px' };
const container = { backgroundColor: '#FAFAFA', maxWidth: '600px', margin: '0 auto', padding: '44px' };
const eyebrow = {
  fontSize: '0.875rem',
  fontWeight: 900,
  letterSpacing: '0.08em',
  color: '#012D10',
  textTransform: 'uppercase' as const,
  margin: '0 0 1.5rem',
};
const heading = { fontSize: '38px', lineHeight: '46px', fontWeight: 700, letterSpacing: '-0.03em', color: '#012D10', margin: '0 0 24px' };
const big = { fontSize: '1.25rem', fontWeight: 900, color: '#013F17', margin: '0' };
const section = { margin: '0 0 1.5rem' };
const label = { fontSize: '0.875rem', fontWeight: 700, color: '#669370', margin: '0 0 0.25rem' };
const text = { fontSize: '18px', lineHeight: '28px', fontWeight: 500, color: '#013F17', margin: '0 0 8px' };
const quiet = { fontSize: '0.875rem', lineHeight: 1.5, color: '#A2AFA8', margin: '0 0 0.5rem' };
const button = {
  backgroundColor: '#41ED98',
  color: '#E9FFE1',
  fontSize: '18px',
  fontWeight: 900,
  padding: '20px 44px',
  borderRadius: '1px',
  textDecoration: 'none',
};
const rule = { borderColor: '#41ED98', margin: '40px 0 30px' };
