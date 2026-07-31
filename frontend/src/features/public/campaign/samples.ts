/**
 * The two sample campaigns — Spec §18 "Sample campaigns", §34.
 *
 * §18: `sample-pre-build` renders a realistic safe Idea Campaign,
 * `sample-pre-launch` a realistic safe Product Campaign, both showing the
 * complete campaign, rewards, delivery, merchant-of-record disclosure, and a
 * correct consent preview; both permanently display the Appendix A.6 banner;
 * neither accepts real card data. §34 gates live mode on proving that last
 * point, so nothing in this file or the component that renders it touches a
 * payment method.
 *
 * Everything here is invented data on an obviously-labelled demonstration
 * page — the founder is called Sample Founder, the entities are Sample Labs
 * and Sample Works, and every count is tagged as sample data where it renders.
 * §30 forbids fabricated popularity; a number on a page that announces itself
 * as a sample in a permanent banner is a demonstration, and it is labelled
 * again at the point of display so it cannot be mistaken for a real campaign's.
 *
 * The dates are fixed rather than computed from the clock. A sample whose close
 * date moves every day is a sample whose consent text moves every day, and
 * Appendix A.3/A.4 render that date into a sentence a Backer would be agreeing
 * to.
 */

import type { CampaignView } from './types.js';

const SAMPLE_FOUNDER_PROFILE =
  'A demonstration Founder profile. On a real campaign this is the reviewed ' +
  'identity of the person or company selling the reward, with their own ' +
  'account, their own Stripe Connect onboarding, and their own support inbox.';

export const SAMPLE_IDEA_CAMPAIGN: CampaignView = {
  slug: 'sample-pre-build',
  model: 'idea',
  title: 'Loopnote — voice notes that write your weekly update',
  tagline:
    'Record a two-minute voice note after each work session. Loopnote turns the ' +
    'week into the update your team actually reads.',
  founder: {
    legalName: 'Sample Founder',
    entity: 'Sample Labs LLC',
    country: 'United States',
    profile: SAMPLE_FOUNDER_PROFILE,
  },

  opensAt: new Date('2026-09-01T15:00:00Z'),
  closesAt: new Date('2026-09-30T23:00:00Z'),

  rewards: [
    {
      sku: 'LOOP-EARLY',
      title: 'Early supporter',
      priceCents: 1900n,
      contents: [
        'Loopnote for one person for six months, at the founding price',
        'Your name in the release credits, if you want it there',
      ],
      delivery: 'March–April 2027',
      fulfillment: 'An email invitation with a redemption code for your account.',
    },
    {
      sku: 'LOOP-YEAR',
      title: 'Founding year',
      priceCents: 4900n,
      contents: [
        'Loopnote for one person for twelve months, at the founding price',
        'The founding-member channel, where build decisions get argued out',
        'Your name in the release credits, if you want it there',
      ],
      delivery: 'March–April 2027',
      fulfillment: 'An email invitation with a redemption code for your account.',
    },
    {
      sku: 'LOOP-WORKSHOP',
      title: 'Founding year and onboarding workshop',
      priceCents: 14900n,
      contents: [
        'Everything in Founding year',
        'A live 90-minute onboarding workshop for up to five people on your team',
        'A written summary of the workshop you can keep',
      ],
      delivery: 'April 2027',
      fulfillment:
        'The redemption code by email, then a scheduling link for the workshop.',
    },
  ],
  featuredRewardSku: 'LOOP-YEAR',
  sampleSalesTaxCents: 404n,

  orderThreshold: 250,
  thresholdProgress: 168,
  momentum: null,

  statementDescriptor: 'PROOVD SAMPLE LABS',

  story: [
    {
      heading: 'The problem',
      paragraphs: [
        'Every team says they want a weekly update and almost nobody writes one. ' +
          'The work is remembering what happened, and by Friday it is gone.',
        'The tools that exist ask you to write the summary. That is the part ' +
          'that does not happen.',
      ],
    },
    {
      heading: 'What exists today',
      paragraphs: [
        'A working prototype that transcribes voice notes and groups them by ' +
          'project. It is not a product yet: there is no account system, no ' +
          'sharing, and no integrations.',
        'That is why this is an Idea Campaign. The order threshold is how we ' +
          'find out whether it is worth six more months.',
      ],
    },
    {
      heading: 'What we would build',
      paragraphs: [
        'Accounts and teams, a shareable weekly digest, and a Slack posting ' +
          'step. Nothing else until those three are good.',
      ],
    },
  ],

  faq: [
    {
      question: 'When am I charged?',
      answer:
        'Only if this campaign reaches its order threshold of 250 unique ' +
        'Backers with active pre-orders at the close date. If it does not, no ' +
        'charge is created and your saved card loses future-charge eligibility ' +
        'for this campaign.',
    },
    {
      question: 'What if the product is late?',
      answer:
        'It might be. This is an early-stage product with a delivery window, ' +
        'not a shipping date. The Founder tells every Backer by email if the ' +
        'window changes, and shows the previous and revised commitment together.',
    },
    {
      question: 'Can I change my reward?',
      answer:
        'Yes. On an Idea Campaign you have one active pre-order and you can ' +
        'change which reward package it is for at any time before the close date.',
    },
    {
      question: 'Can I cancel?',
      answer:
        'Yes, free, any time before the close date, from the link in your ' +
        'confirmation email.',
    },
  ],

  refundSummary: [
    'If the campaign does not reach its order threshold, no card is charged at all.',
    'You can cancel free at any time before the close date.',
    'After a valid charge there is no change-of-mind refund on an Idea ' +
      'Campaign. The defined exceptions — duplicate, wrong, cancelled, ' +
      'unauthorized, materially misrepresented, applicable non-delivery, ' +
      'serious-violation, legal, Stripe, and card-issuer cases — still apply.',
  ],
  founderRefundPolicy: null,

  commentsEnabled: true,
  isSample: true,
};

export const SAMPLE_PRODUCT_CAMPAIGN: CampaignView = {
  slug: 'sample-pre-launch',
  model: 'product',
  title: 'Fernpost — the changelog your customers actually read',
  tagline:
    'Write the release note once. Fernpost turns it into the in-app notice, the ' +
    'email, and the public page, and tells you which customers read it.',
  founder: {
    legalName: 'Sample Founder',
    entity: 'Sample Works LLC',
    country: 'United States',
    profile: SAMPLE_FOUNDER_PROFILE,
  },

  opensAt: new Date('2026-08-10T15:00:00Z'),
  closesAt: new Date('2026-09-08T23:00:00Z'),

  rewards: [
    {
      sku: 'FERN-SOLO',
      title: 'Founding member',
      priceCents: 3900n,
      contents: [
        'Fernpost for one workspace for twelve months, at the founding price',
        'The founding-member badge on your public changelog page',
      ],
      delivery: 'October 2026',
      fulfillment: 'A login invitation by email on the delivery date.',
    },
    {
      sku: 'FERN-TEAM',
      title: 'Founding team, five seats',
      priceCents: 14900n,
      contents: [
        'Fernpost for one workspace and five seats for twelve months',
        'The founding-member badge on your public changelog page',
        'Priority on integration requests for the first year',
      ],
      delivery: 'October 2026',
      fulfillment: 'A login invitation by email on the delivery date.',
    },
    {
      sku: 'FERN-WORKSHOP',
      title: 'Founding team and launch workshop',
      priceCents: 24900n,
      contents: [
        'Everything in Founding team, five seats',
        'A live 90-minute workshop on release communication for your team',
        'A review of your first three release notes, in writing',
      ],
      delivery: 'November 2026',
      fulfillment:
        'The login invitation by email, then a scheduling link for the workshop.',
    },
  ],
  featuredRewardSku: 'FERN-SOLO',
  sampleSalesTaxCents: 322n,

  orderThreshold: null,
  thresholdProgress: null,
  momentum: { uniqueBackers: 312, unitsReserved: 418 },

  statementDescriptor: 'PROOVD SAMPLE WORKS',

  story: [
    {
      heading: 'What this is',
      paragraphs: [
        'Fernpost is live. Around 900 workspaces use it to publish release ' +
          'notes, and this campaign is a founding-member pre-sale for the ' +
          'version with in-app notices and read tracking.',
        'This is a Product Campaign, so there is no threshold: every active ' +
          'pre-order is charged on the close date.',
      ],
    },
    {
      heading: 'What founding members get',
      paragraphs: [
        'The founding price for twelve months, the badge, and a direct line ' +
          'into what gets built in the first quarter after launch.',
      ],
    },
  ],

  faq: [
    {
      question: 'When am I charged?',
      answer:
        'On the close date shown above. There is no threshold on a Product ' +
        'Campaign — every active pre-order is charged then.',
    },
    {
      question: 'When do I get access?',
      answer:
        'On the delivery month stated on the reward package you chose. If that ' +
        'changes, the Founder emails every Backer and shows the previous and ' +
        'revised commitment together.',
    },
    {
      question: 'Can I cancel?',
      answer:
        'Yes, free, any time before the close date. After the close date, the ' +
        "Founder's refund policy below applies, along with Proovd's Refund " +
        'Policy and applicable law, Stripe, and card-issuer rules.',
    },
  ],

  refundSummary: [
    'You can cancel free at any time before the close date.',
    'After the close date the campaign-specific Founder refund policy applies, ' +
      'at the exact version disclosed to you when you pre-ordered.',
    "Proovd's Refund Policy, applicable law, Stripe rules, and card-issuer " +
      'rules apply on top of it and cannot be signed away.',
  ],
  founderRefundPolicy: {
    title: 'Sample Works LLC Refund Policy',
    version: '1.0',
    effectiveDate: '2026-08-01',
    // Appendix A.4 renders this as `[PRESERVED POLICY URL]` inside the consent
    // text. On a live campaign it is the preserved policy's own address; on the
    // sample the preserved version is reproduced on this page, so the fragment
    // is the correct and complete URL. It is also the only form that keeps the
    // internal slug out of rendered copy — §3.1 permits `sample-pre-launch` in
    // a URL bar, not in a sentence a Backer reads.
    anchor: '#founder-refund-policy',
    summary: [
      'A refund is available within 14 days of delivery if the workspace has ' +
        'published fewer than three release notes.',
      'A workspace that has not been activated 30 days after delivery may ask ' +
        'for a full refund.',
      'A material delay to the delivery month entitles you to a full refund on ' +
        'request, at any time before delivery.',
    ],
  },

  commentsEnabled: true,
  isSample: true,
};

export const SAMPLE_CAMPAIGNS: readonly CampaignView[] = [
  SAMPLE_IDEA_CAMPAIGN,
  SAMPLE_PRODUCT_CAMPAIGN,
];
