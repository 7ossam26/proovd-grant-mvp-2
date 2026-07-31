/**
 * Appendix A.2, A.3, and A.4 — exact customer copy.
 *
 * These three blocks are exact-text mandatory. Appendix A's own preamble:
 * "Variables must come from the same versioned domain records used by the
 * ledger." Every `[VARIABLE]` below is substituted from the campaign view
 * model, and nothing else in the text is altered — not a word, not a comma, not
 * the capitalised NOT in "Your card will NOT be charged today."
 *
 * They are structured rather than kept as one string so that a 320px screen can
 * wrap them (§28.5: no clipped amount, date, or action) and a screen reader can
 * navigate the bullet list. Reading the rendered text back in document order
 * reproduces the Appendix block; `public-site.test.tsx` asserts exactly that.
 *
 * On a sample campaign this renders as a preview and nothing more: §18 and §34
 * require the samples to prove no-charge-today consent while collecting no
 * card, so there is no input, no Stripe Elements mount, and no submit path
 * anywhere in this file or the component that renders it.
 */

import { formatUsd } from '@proovd/shared';
import { formatUtcInstant, formatCalendarDate } from './format.js';
import { findReward, type CampaignView } from './types.js';

export interface ConsentAmount {
  label: string;
  value: string;
}

export interface ConsentCheckbox {
  required: boolean;
  text: string;
}

export interface ConsentPreview {
  /** Appendix reference this block reproduces. */
  appendix: 'A.3' | 'A.4';
  intro: string;
  amounts: readonly ConsentAmount[];
  leadIn: string;
  bullets: readonly string[];
  agreement: string;
  checkboxes: readonly ConsentCheckbox[];
  actionLabel: string;
}

const SHARED_LEAD_IN = 'By clicking Authorize, you agree that:';

const NOT_CHARGED_TODAY = 'Your card will NOT be charged today.';

const TAX_BULLET =
  'The total above includes the sales tax calculated when you authorize. ' +
  'The later charge will occur only if that same tax calculation remains ' +
  'usable for the exact total shown above. If it is not usable, you will ' +
  'not be charged; Proovd will not substitute a different total.';

function statementBullet(descriptor: string): string {
  return (
    `Your card statement is expected to show "${descriptor}". ` +
    'Contact support@proovd.co with any questions.'
  );
}

function sharingBullet(founderLegalName: string): string {
  return (
    `Your email and purchase details will be shared with ${founderLegalName} ` +
    'immediately after you reserve, even though you are not charged today, ' +
    'only so they can prepare fulfillment and provide purchase support. If ' +
    'you cancel, the Founder will be told not to fulfill your order; ' +
    'cancellation cannot retract information already shared.'
  );
}

const AGREEMENT =
  "By reserving this pre-order, you also agree to Proovd's Terms of Service, " +
  'Acceptable Use Policy, Refund Policy, Fulfillment Policy, and Privacy Policy.';

function checkboxes(founderLegalName: string): readonly ConsentCheckbox[] {
  return [
    {
      required: true,
      text:
        'I confirm that I am at least 18 years old and that my billing ' +
        'location is in the United States.',
    },
    {
      required: false,
      text:
        `I allow ${founderLegalName} to contact me for marketing, research, ` +
        'surveys, and other messages not required to fulfill or support this ' +
        'purchase, and to see my identifiable survey answers.',
    },
    {
      required: false,
      text: "Send me Proovd's monthly newsletter about new campaigns.",
    },
  ];
}

function amounts(campaign: CampaignView): readonly ConsentAmount[] {
  const reward = findReward(campaign, campaign.featuredRewardSku);
  const total = reward.priceCents + campaign.sampleSalesTaxCents;
  return [
    { label: 'Reward', value: reward.title },
    { label: 'Reward subtotal', value: formatUsd(reward.priceCents) },
    { label: 'Sales tax', value: formatUsd(campaign.sampleSalesTaxCents) },
    { label: 'Total authorized', value: formatUsd(total) },
  ];
}

/** Appendix A.3 — Idea Campaign consent. */
function ideaConsent(campaign: CampaignView): ConsentPreview {
  const reward = findReward(campaign, campaign.featuredRewardSku);
  const founder = campaign.founder.legalName;
  const total = formatUsd(reward.priceCents + campaign.sampleSalesTaxCents);
  const closeDate = formatUtcInstant(campaign.closesAt);
  const threshold = campaign.orderThreshold;
  if (threshold === null) {
    throw new Error(`Idea campaign ${campaign.slug} has no order threshold`);
  }

  return {
    appendix: 'A.3',
    intro:
      `You are reserving a pre-order on the campaign "${campaign.title}" ` +
      `operated by ${founder} (the merchant of record).`,
    amounts: amounts(campaign),
    leadIn: SHARED_LEAD_IN,
    bullets: [
      NOT_CHARGED_TODAY,
      `You are authorizing ${founder} and Proovd LLC (acting as the Stripe ` +
        `Connect platform on behalf of ${founder}) to charge your saved card ` +
        `a single off-session payment of exactly ${total} on or shortly after ` +
        `${closeDate}, if and only if the campaign reaches its order threshold ` +
        `of ${threshold} unique Backers with active pre-orders at ${closeDate}. ` +
        'The threshold measures valid purchase commitments at close; it does ' +
        'not guarantee that every saved card will later succeed.',
      TAX_BULLET,
      `If the campaign does not reach the threshold by ${closeDate}, no charge ` +
        'will occur, your saved card will lose future-charge eligibility for ' +
        'this campaign, and you will not be billed.',
      `You may cancel this pre-order at any time before ${closeDate} at no ` +
        'cost by clicking "Cancel pre-order" on your backer page using the ' +
        'magic link in your confirmation email.',
      'I understand this product is still in development, may face delays, ' +
        'and — in rare cases where the founder is unable to complete the ' +
        'project — may not be delivered. I accept that risk as part of ' +
        'supporting an early-stage product. After a valid charge there is no ' +
        "voluntary/change-of-mind refund. Proovd's Refund Policy at " +
        'proovd.co/refunds explains the exceptions for duplicate, wrong, ' +
        'canceled, unauthorized, materially misrepresented, applicable ' +
        'non-delivery, serious-violation, legal, Stripe, and card-issuer cases.',
      statementBullet(campaign.statementDescriptor),
      sharingBullet(founder),
    ],
    agreement: AGREEMENT,
    checkboxes: checkboxes(founder),
    actionLabel: 'Authorize pre-order',
  };
}

/** Appendix A.4 — Product Campaign consent. */
function productConsent(campaign: CampaignView): ConsentPreview {
  const reward = findReward(campaign, campaign.featuredRewardSku);
  const founder = campaign.founder.legalName;
  const total = formatUsd(reward.priceCents + campaign.sampleSalesTaxCents);
  const closeDate = formatUtcInstant(campaign.closesAt);
  const policy = campaign.founderRefundPolicy;
  if (!policy) {
    throw new Error(`Product campaign ${campaign.slug} has no Founder refund policy`);
  }
  const preservedPolicy =
    `${policy.title} / version ${policy.version} / effective ` +
    `${formatCalendarDate(policy.effectiveDate)}`;

  return {
    appendix: 'A.4',
    intro:
      `You are placing a founding-member pre-order on the campaign ` +
      `"${campaign.title}" operated by ${founder} (the merchant of record).`,
    amounts: amounts(campaign),
    leadIn: SHARED_LEAD_IN,
    bullets: [
      NOT_CHARGED_TODAY,
      `You are authorizing ${founder} and Proovd LLC (acting as the Stripe ` +
        `Connect platform on behalf of ${founder}) to charge your saved card ` +
        `a single off-session payment of exactly ${total} on ${closeDate} for ` +
        `the reward package "${reward.title}" described on the campaign page ` +
        'above.',
      TAX_BULLET,
      `Expected delivery of "${reward.title}" is ${reward.delivery}. If this ` +
        `expected delivery window changes, ${founder} will notify you by email.`,
      `You may cancel this pre-order at any time before ${closeDate} at no ` +
        'cost by clicking "Cancel pre-order" on your backer page using the ' +
        `magic link in your confirmation email. After ${closeDate}, refund ` +
        'eligibility is governed by the campaign-specific Founder refund ' +
        `policy ${preservedPolicy} at ${policy.anchor} and Proovd's Refund ` +
        'Policy at proovd.co/refunds, subject to applicable law, Stripe, and ' +
        'card-issuer rules.',
      'I understand this is a pre-order for an early-stage product or feature ' +
        'launch. Delivery is on the disclosed timeline above; in the uncommon ' +
        'event of material delay or the rare event of non-delivery, the refund ' +
        'mechanisms defined in the preserved policy version above apply.',
      statementBullet(campaign.statementDescriptor),
      sharingBullet(founder),
    ],
    agreement: AGREEMENT,
    checkboxes: checkboxes(founder),
    actionLabel: 'Authorize pre-order',
  };
}

export function consentPreview(campaign: CampaignView): ConsentPreview {
  return campaign.model === 'idea' ? ideaConsent(campaign) : productConsent(campaign);
}

/**
 * Appendix A.2 — the expanded campaign merchant-of-record block, shown behind
 * the always-visible §18 disclosure line.
 */
export function expandedMorBlock(campaign: CampaignView): readonly string[] {
  const founder = campaign.founder.legalName;
  return [
    `${founder} is the merchant of record for every transaction on this ` +
      'campaign and is solely responsible for delivering the rewards described ' +
      'above and complying with all applicable laws in their jurisdiction.',
    'Payments are processed by Stripe through Stripe Connect using the ' +
      'production configuration approved for this campaign. Proovd LLC acts ' +
      'only as the software platform that hosts this campaign; Proovd LLC is ' +
      'not the merchant of record and does not take title to any digital ' +
      'reward sold on this campaign.',
    'How customer service works on Proovd:',
    "Once you've reserved a pre-order, you'll get a magic link to your backer " +
      `page. From there you can message ${founder} about the product, ` +
      'delivery, or refunds through a built-in support form. We send an ' +
      'immediate automated acknowledgement, provide a human response within ' +
      'one business day, pass product/delivery/refund questions to the ' +
      "founder, and follow up if you haven't heard back within 48 hours.",
    'For questions about the Proovd platform itself — not about this ' +
      "campaign's product — email support@proovd.co.",
  ];
}

/** Appendix A.6 — the permanent sample banner, verbatim. */
export const SAMPLE_BANNER =
  'Sample campaign — for platform demonstration. No payment information is collected.';

/** §18: the compact summary that sits beside the primary action. */
export function chargeRule(campaign: CampaignView): string {
  return campaign.model === 'idea'
    ? 'Charged only if the campaign reaches its order threshold at the close date'
    : 'Every active pre-order is charged on the close date';
}
