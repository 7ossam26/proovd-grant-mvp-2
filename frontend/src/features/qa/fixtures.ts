/**
 * One campaign, rendered through every principal flow — Phase 23a (§33.11).
 *
 * There is deliberately ONE campaign, ONE reward, ONE Founder, and ONE
 * pre-order across all of these fixtures rather than a plausible object per
 * surface. §33.11.5 is about seven renderings of the same facts agreeing, and a
 * fixture set where each surface invents its own title would make the frontend
 * sweep unable to notice the drift it exists to catch. The backend suite proves
 * agreement against real reads; this proves the surfaces render what they were
 * given without quietly rewording it.
 *
 * Every fixture is typed against the api module's own exported interface, so a
 * response shape that changes fails typecheck here before it reaches a test.
 */

import type { AdminIdentity, DraftLanding } from '../admin/api.js';
import type { ClaimView, VettingState } from '../../surfaces/draft/api.js';
import type {
  BuildState,
  CampaignHomeView,
  CampaignPreview,
  CreatorPostView,
  Day14ChecklistView,
  FounderPaymentStatusView,
  FounderReadiness,
  FounderBackersView,
  FounderSettingsView,
  FounderResultsView,
  FounderUpdatesView,
  FounderWrapView,
  FulfillmentStatusView,
  LatestReview,
  ListingState,
  RosterView,
  WorkspaceState,
} from '../../surfaces/founder/api.js';
import {
  COMPLETION_OUTCOMES,
  DO_NOT_FULFILL_LABEL,
  EDITABLE_FIELDS,
  FOUNDER_EXPORT_COLUMNS,
  FOUNDER_EXPORT_WITHHELD,
  PREPARE_WITHOUT_OPENING,
  RESOLUTION_IS_NOT_FULFILLMENT,
  THANK_YOU_ELIGIBILITY_FACTS,
} from '@proovd/shared';
import type { PayoutState } from '../../surfaces/payouts/PayoutOnboarding.js';
import type {
  CreatorCloseView,
  CreatorInvitationState,
  CreatorPartnership,
  CreatorPitchesView,
  FormalOpportunity,
  PitchContent,
  CreatorEarningsView as CreatorOwnEarningsView,
  CreatorHomeView,
  CreatorResourcesView,
  CreatorSettingsView,
} from '../../surfaces/creator/api.js';
import type { BackerPageData, BackerSupportView, CommentThread } from '../public/backer/api.js';
import type { LiveCampaignResponse } from '../public/campaign/api.js';
import type { Quote, PreorderSuccess } from '../public/checkout/api.js';
import type { DigestPreferenceView } from '../../surfaces/notifications/DigestPreference.js';
import type { HistoryEntry } from '../../surfaces/notifications/NotificationHistory.js';
import { qaSessionRole, type StubRoute } from './server.js';

/* ── The one campaign every surface is rendering ───────────────────────────── */

export const QA = {
  campaignId: 'camp-qa-1',
  associationId: 'assoc-qa-1',
  reservationId: 'res-qa-1',
  draftId: 'draft-qa-1',
  /** The PERSON — what the Admin Founder workspace is keyed on (§26.1, §9). */
  prospectId: 'prospect-qa-1',
  token: 'qa-token-value',
  title: 'The Bench Lamp',
  founderLegalName: 'Harlow Instruments LLC',
  founderDisplayName: 'Rae Harlow',
  rewardSku: 'BENCH-1',
  rewardTitle: 'Founding Edition — Walnut',
  rewardSubtotal: '120.00',
  salesTax: '9.90',
  totalAuthorized: '129.90',
  descriptor: 'PROOVD* BENCH LAMP',
  delivery: 'March 2027',
  closesAt: '2026-09-12T17:00:00.000Z',
  chargeTimeUtc: 'September 12, 2026, 5:00 PM UTC',
} as const;

export const QA_CHARGE_RULE =
  `Charged when the campaign closes on ${QA.chargeTimeUtc}, only if the order threshold is met.`;

/* ── §7 the invited Founder draft ──────────────────────────────────────────── */

const draftLanding: DraftLanding = {
  recipientName: 'Rae Harlow',
  recipientEmail: 'rae@harlow-instruments.example',
  productName: QA.title,
  whatWeUnderstood: 'A machined desk lamp for people who solder at their kitchen table.',
  senderName: 'Sam at Proovd',
  expectedSetupTime: 'About 20 minutes',
  // A recent discovery call, minted relative to the sweep's own run so the
  // landing renders the elapsed-time line rather than hiding it.
  lastContactAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  reference: 'PVD-QA100-QA200',
  processSummary: [
    'You answer three questions about the problem, your solution, and how you are positioned.',
    'A person at Proovd reads them and decides whether to continue.',
    'If it continues, you build the campaign page and pay the listing fee.',
  ],
  noGuarantee:
    'Proovd cannot promise acceptance, results, reward pricing, or that any particular Creator will take part.',
};

const vetting: VettingState = {
  draftId: QA.draftId,
  campaignId: QA.campaignId,
  selectedType: 'pre_launch',
  problem: 'Hobby electronics benches are lit by ceiling lights that cast a shadow over the board.',
  solution: 'A clamp lamp with a 96 CRI head and a magnetic arm that holds its position.',
  competition:
    'Ceiling lights and phone torches, mostly. The lamps sold for this cost four times as much and still cast a shadow across the board.',
  // Retired from collection on 2026-08-18. Kept on the fixture because a record
  // onboarded before then still carries one, and the Admin read still shows it.
  views: '10k_100k',
  provenance: {
    problem: {
      supplier: 'proovd',
      prefilledText: 'Hobby electronics benches are poorly lit.',
      prefilledAt: '2026-08-01T09:00:00.000Z',
      firstEditedAt: '2026-08-01T09:20:00.000Z',
      lastEditedAt: '2026-08-01T09:40:00.000Z',
    },
    solution: {
      supplier: 'founder',
      prefilledText: null,
      prefilledAt: null,
      firstEditedAt: '2026-08-01T09:25:00.000Z',
      lastEditedAt: '2026-08-01T09:41:00.000Z',
    },
    // Never anything else: there are no `competition_prefilled_*` columns and
    // §9 states twice that there never will be (§33.1.5).
    competition: {
      supplier: 'founder',
      prefilledText: null,
      prefilledAt: null,
      firstEditedAt: '2026-08-01T09:31:00.000Z',
      lastEditedAt: '2026-08-01T09:44:00.000Z',
    },
  },
  lastSavedAt: '2026-08-01T09:42:00.000Z',
  resumeStep: null,
  submittedAt: null,
  completeness: { problem: true, solution: true, competition: true },
  campaignStatus: 'vetting_in_progress',
  // Founder Flow v2 Session C. Track A everywhere today, so the Positioning
  // screen renders the named absence rather than a microphone that refuses.
  transcription: {
    available: false,
    absentBecause:
      'Dictation is not set up on this deployment, so we cannot turn a recording into text. Nothing was recorded and nothing was sent. Type your answer instead — it is the same box either way.',
  },
  lockedType: null,
  typeLockedAt: null,
};

const claim: ClaimView = {
  profile: {
    draftId: QA.draftId,
    campaignId: QA.campaignId,
    fields: {
      legalName: { value: 'Rae Harlow', supplier: 'proovd', prefilled: 'Rae Harlow', editedAt: null },
      preferredName: { value: 'Rae', supplier: 'founder', prefilled: null, editedAt: null },
      email: { value: 'rae@harlow.example', supplier: 'proovd', prefilled: 'rae@harlow.example', editedAt: null },
      phone: { value: null, supplier: null, prefilled: null, editedAt: null },
      dateOfBirth: { value: null, supplier: null, prefilled: null, editedAt: null },
      country: { value: 'US', supplier: 'founder', prefilled: null, editedAt: null },
      stateRegion: { value: 'NY', supplier: 'founder', prefilled: null, editedAt: null },
      businessName: { value: QA.founderLegalName, supplier: 'founder', prefilled: null, editedAt: null },
      businessEntityType: { value: 'llc', supplier: 'founder', prefilled: null, editedAt: null },
    },
    soleProprietor: false,
    emailOwnership: 'invited_link',
    phoneVerified: false,
    representations: { usPerson: true, age18Plus: true, sanctions: true },
    lastSavedAt: '2026-08-02T12:05:00.000Z',
    claimedAt: null,
  },
  policies: [
    { slug: 'terms', route: '/terms', title: 'Terms of Service', version: 'v1.0', status: 'draft' },
    { slug: 'founder-aup', route: '/founder-aup', title: 'Founder Acceptable Use Policy', version: 'v1.0', status: 'draft' },
    { slug: 'privacy', route: '/privacy', title: 'Privacy Policy', version: 'v1.0', status: 'draft' },
  ],
};

/* ── §12 the workspace, the interview, and the listing fee ─────────────────── */

const workspace: WorkspaceState = {
  campaignId: QA.campaignId,
  campaignStatus: 'account_claimed',
  listingPaid: false,
  items: [
    { item: 'visuals', complete: true, completedAt: '2026-08-03T10:00:00.000Z', decisionSource: 'objective_evidence', rejections: [], locked: false, invalidated: { at: null, explanation: null } },
    { item: 'branding', complete: false, completedAt: null, decisionSource: null, rejections: ['logo_missing'], locked: false, invalidated: { at: null, explanation: null } },
    { item: 'interview', complete: false, completedAt: null, decisionSource: null, rejections: ['booking_absent'], locked: false, invalidated: { at: null, explanation: null } },
    { item: 'story', complete: false, completedAt: null, decisionSource: null, rejections: ['not_approved'], locked: false, invalidated: { at: null, explanation: null } },
    { item: 'socials', complete: true, completedAt: '2026-08-03T10:05:00.000Z', decisionSource: 'objective_evidence', rejections: [], locked: false, invalidated: { at: null, explanation: null } },
  ],
  fee: {
    baseCents: '3500',
    itemDiscountCents: '200',
    maxDiscountCents: '1000',
    minSubtotalCents: '2500',
    completedItems: 2,
    discountLines: [
      { item: 'visuals', discountCents: '200' },
      { item: 'socials', discountCents: '200' },
    ],
    discountCents: '400',
    subtotalCents: '3100',
    // Three of the five optional answers are still open, and the server derives
    // what they would still take off (§12 applies a cap AND a floor, so it is
    // not `subtotal − floor`). Screen 20's discount control renders it.
    remainingDiscountCents: '600',
    calculatedAt: '2026-08-03T10:05:00.000Z',
    locked: false,
    separateStreamNote:
      'This is the one-off fee for listing your campaign, paid to Proovd. It is separate from the ' +
      '5% Proovd keeps from what your campaign actually collects — that is charged later, only on ' +
      'money you receive, and it is not part of this total.',
  },
  highEffort: {
    visualsCompleted: true,
    brandingCompleted: false,
    interviewScheduledOrConfirmed: false,
    highEffort: false,
    calculatedAt: '2026-08-03T10:05:00.000Z',
  },
  brand: { colors: null, typography: null, notes: null, approved: false, logos: [] },
  story: { text: 'We built the first one for our own bench.', approved: false },
  visuals: [
    {
      id: 'asset-1',
      filename: 'bench-lamp.jpg',
      contentType: 'image/jpeg',
      state: 'stored',
      rejection: null,
      approved: true,
      width: 1600,
      height: 1200,
      byteSize: '412000',
    },
  ],
  socials: [
    {
      id: 'social-1',
      url: 'https://example.com/harlow',
      platform: 'website',
      handle: 'harlow',
      accessible: true,
      rejection: null,
      controlsConfirmed: true,
      checkedAt: '2026-08-03T10:04:00.000Z',
    },
  ],
  interview: {
    bookable: false,
    missingSettings: ['interview_providers', 'interviewers'],
    providers: [],
    availability: null,
    embed: { available: false, eventTypeLink: null, reference: null },
    booking: null,
  },
  lastSavedAt: '2026-08-03T10:05:00.000Z',
  resumeStep: null,
  uploadsAvailable: false,
  // Track A4 on both counts, which is the state a §33.11 sweep should meet:
  // the surfaces render their named absences rather than dead controls.
  transcription: {
    available: false,
    absentBecause:
      'Dictation is not set up on this deployment, so we cannot turn a recording into text. Nothing was recorded and nothing was sent. Type your answer instead — it is the same box either way.',
  },
  vetting: {
    problem: 'Weekly build updates take an hour nobody has.',
    solution: 'A voice note becomes the update, in your own words.',
    competition: 'Notion templates and a shared doc. Doing nothing is the real one.',
    submittedAt: '2026-08-02T09:00:00.000Z',
  },
};

const listing: ListingState = {
  paid: false,
  onboardingState: 'complete',
  listingFeeEligible: true,
  taxAvailable: true,
  checkoutAvailable: true,
};

/**
 * §13's connected-account state — the shape both payout reads answer with.
 *
 * `{ payouts: PayoutState }`, which is what the routes return and what
 * `fetchPayouts` unwraps. Until Session E this fixture was a flat object with
 * different field names, so `result.payouts` was `undefined`, `PayoutOnboarding`
 * never mounted, and the sweep reported a surface it had not actually
 * rendered — the §33.11.1 failure that harness exists to catch, in the harness.
 */
const payoutState: PayoutState = {
  state: 'complete',
  stripeAccountId: 'acct_qa',
  missingRequirements: [],
  pendingVerification: [],
  disabledReason: null,
  canResume: false,
  onboardingAvailable: true,
  listingFeeEligible: true,
  linkActivationBlocked: false,
  paymentReceiptBlocked: false,
  campaignReviewBlocked: false,
  lastSyncedAt: '2026-08-10T10:00:00.000Z',
};

/* ── §14.4/§15 the build, the preview, and the review round ────────────────── */

const build: BuildState = {
  build: {
    title: QA.title,
    founderDisplayName: QA.founderDisplayName,
    founderEntityDisplay: QA.founderLegalName,
    founderCountry: 'US',
    founderProfileUrl: 'https://example.com/harlow',
    opensAt: '2026-08-20T15:00:00.000Z',
    closesAt: QA.closesAt,
    orderThreshold: 40,
    internalTargetCents: '500000',
    brandPerception: 'Precise, unfussy, built to be repaired.',
    brandVoice: 'Plain sentences. No superlatives.',
    requiredWording: 'Say that the arm is machined aluminium.',
    prohibitedClaims: 'Do not claim a delivery date earlier than March 2027.',
    communityUrl: 'https://example.com/harlow/community',
    heroPreference: 'The lamp on a working bench, not on white.',
    publicStory: 'We built the first one for our own bench and could not buy a better one.',
    deliveryWindow: QA.delivery,
    earlyProductDisclaimer: 'This is an early production run and the finish may vary.',
    risksAndChallenges: 'Anodising capacity is the schedule risk we have least control over.',
    refundPolicyText: 'Cancel any time before the charge date. After delivery, contact us within 30 days.',
    refundPolicyTitle: 'Harlow Instruments refund policy',
    refundPolicySourceUrl: 'https://example.com/harlow/refunds',
    refundPolicyVersion: 'v1',
    refundPolicyEffectiveDate: '2026-07-01',
    heroHeadline: 'A lamp that holds',
    heroHeadlineAccent: 'its position.',
    heroSubheadline: 'A bench lamp that holds its position.',
    founderPullQuote: 'We could not buy a better one, so we machined it.',
    platformLine: 'Proovd runs the pre-order. Harlow Instruments ships the lamp.',
    demoContextLabel: 'On the bench',
    benefitsHeading: 'Why this lamp',
    rewardsHeading: 'Choose your lamp',
    updatesHeading: 'Build updates',
    faqHeading: 'Questions',
  },
  rewardPackages: [
    {
      id: 'pkg-1',
      sku: QA.rewardSku,
      title: QA.rewardTitle,
      priceCents: '12000',
      contents: 'One lamp, one clamp base, one spare bulb.',
      fulfillmentCommitment: 'Shipped from New York with tracking.',
      delivery: QA.delivery,
      limitedQuantity: 250,
      badge: 'Lowest price',
      sortOrder: 1,
    },
  ],
  faqs: [{ id: 'faq-1', question: 'When will I get it?', answer: `We commit to ${QA.delivery}.` }],
  demoMoments: [
    {
      id: 'moment-1',
      timeLabel: '8:15',
      momentLabel: 'Morning',
      stateWord: 'Level',
      headline: 'The arm stays where you left it.',
      signalText: 'No drift overnight',
      isAction: false,
      actionLabel: null,
      sortOrder: 0,
    },
    {
      id: 'moment-2',
      timeLabel: '19:40',
      momentLabel: 'Evening',
      stateWord: 'Warm',
      headline: 'One turn changes the colour.',
      signalText: null,
      isAction: true,
      actionLabel: 'Warm the light',
      sortOrder: 1,
    },
  ],
  benefitCards: [
    { id: 'card-1', title: 'Holds its position', footerWord: 'Machined', visualVariant: 'bars', sortOrder: 0 },
    { id: 'card-2', title: 'Repairable', footerWord: 'Serviceable', visualVariant: 'check', sortOrder: 1 },
    { id: 'card-3', title: 'Even light', footerWord: 'Diffused', visualVariant: 'dots', sortOrder: 2 },
  ],
  buildStatus: 'complete',
  missing: [],
  campaignStatus: 'affiliate_response_and_build',
  model: 'product',
  reviewReadiness: { rosterStatus: 'launch_ready', buildStatus: 'complete', reviewReady: true },
};

const preview: CampaignPreview = {
  model: 'product',
  title: QA.title,
  tagline: 'A bench lamp that holds its position.',
  founder: {
    legalName: QA.founderLegalName,
    entity: QA.founderLegalName,
    country: 'US',
    profile: 'https://example.com/harlow',
  },
  opensAt: '2026-08-20T15:00:00.000Z',
  closesAt: QA.closesAt,
  rewards: [
    {
      id: 'pkg-1',
      sku: QA.rewardSku,
      title: QA.rewardTitle,
      priceCents: '12000',
      contents: ['One lamp', 'One clamp base', 'One spare bulb'],
      delivery: QA.delivery,
      fulfillment: 'Shipped from New York with tracking.',
      limitedQuantity: 250,
      badge: 'Lowest price',
    },
  ],
  featuredRewardSku: QA.rewardSku,
  example: { rewardSubtotalCents: '12000', salesTaxCents: '990', totalCents: '12990' },
  orderThreshold: 40,
  internalTargetCents: '500000',
  statementDescriptor: QA.descriptor,
  story: 'We built the first one for our own bench.',
  faq: [{ question: 'When will I get it?', answer: `We commit to ${QA.delivery}.` }],
  founderRefundPolicy: {
    title: 'Harlow Instruments refund policy',
    version: 'v1',
    effectiveDate: '2026-07-01',
    sourceUrl: 'https://example.com/harlow/refunds',
    text: 'Cancel any time before the charge date.',
  },
  earlyProductDisclaimer: 'This is an early production run and the finish may vary.',
  risksAndChallenges: 'Anodising capacity is the schedule risk.',
  heroHeadline: 'A lamp that holds',
  heroHeadlineAccent: 'its position.',
  founderPullQuote: 'We could not buy a better one, so we machined it.',
  platformLine: 'Proovd runs the pre-order. Harlow Instruments ships the lamp.',
  demoContextLabel: 'On the bench',
  benefitsHeading: 'Why this lamp',
  rewardsHeading: 'Choose your lamp',
  updatesHeading: 'Build updates',
  faqHeading: 'Questions',
  demoMoments: [
    {
      id: 'demo-1',
      timeLabel: '8:15',
      momentLabel: 'Morning',
      stateWord: 'Steady',
      headline: 'The arm is exactly where you left it.',
      signalText: 'No adjustment needed',
      isAction: false,
      actionLabel: null,
    },
  ],
  benefitCards: [
    {
      id: 'benefit-1',
      title: 'Holds its position',
      footerWord: 'Steady',
      visualVariant: 'bars',
    },
  ],
  isPreview: true,
};

const latestReview: LatestReview = {
  round: 1,
  outcome: 'changes_required',
  reviewer: 'Sam at Proovd',
  nextUpdateExpectation: 'We answer within one business day of your resubmission.',
  submittedAt: '2026-08-05T09:00:00.000Z',
  decidedAt: '2026-08-05T15:00:00.000Z',
  required: [
    {
      area: 'Reward package',
      body: 'Name what is in the box before naming the finish.',
      deepLink: `/campaigns/${QA.campaignId}/build`,
      owner: 'Founder',
      dueExpectation: 'Before you resubmit',
      enforcementInvolved: false,
    },
  ],
  optional: [
    {
      area: 'Story',
      body: 'The second paragraph repeats the first.',
      deepLink: `/campaigns/${QA.campaignId}/build`,
      owner: 'Founder',
      dueExpectation: null,
      enforcementInvolved: false,
    },
  ],
};

/* ── §14.5/§16 the roster and Creator readiness ────────────────────────────── */

const roster: RosterView = {
  responseDeadlineAt: '2026-08-08T10:00:00.000Z',
  fullRefundOutcome:
    'If no Creator accepts by the deadline, the campaign ends and your listing fee is refunded in full.',
  pendingProposalNote: 'A Creator has proposed different terms. Nothing is agreed until you both accept.',
  /* §14.3's cell, as the server resolves it from the §6 settings. A bid above
     base is high-effort-only, so the fixture is high-effort — otherwise the
     revision control is correctly absent and the sweep would never render it. */
  terms: {
    basePercent: 30,
    ceilingPercent: 50,
    bidAllowed: true,
    fixedPaymentAllowed: true,
    highEffort: true,
  },
  creators: [
    {
      associationId: QA.associationId,
      handle: '@solderandsawdust',
      channelType: 'youtube',
      audienceMetric: '48,000 subscribers',
      niche: 'Electronics workbench builds',
      bio: 'Weekly bench-build videos.',
      statusLabel: 'Reviewing your campaign',
      openProposal: {
        versionId: 'ver-1',
        versionNumber: 2,
        // Above the 30% base: `validateProposalAgainstCell` refuses anything at
        // or below it, so a fixture below base would be a state the product
        // cannot produce.
        awaitingYou: true,
        bidTotalPercent: 44,
        fixedPaymentRequestCents: '50000',
        note: 'Asked for 44% and a fixed Creator payment.',
      },
      lockedTerms: null,
      meetingRequest: null,
    },
    {
      // The other half of the chapter: somebody whose terms are LOCKED, which
      // is what renders the §14.3 bonus control and §16's readiness section,
      // plus deviation 1's answered request.
      associationId: 'assoc-qa-2',
      handle: '@benchtapes',
      channelType: 'newsletter_operator',
      audienceMetric: '9,200 subscribers',
      niche: 'Weekend electronics',
      bio: 'A Sunday newsletter about small builds.',
      statusLabel: 'Accepted',
      openProposal: null,
      lockedTerms: { totalPercent: 35, fixedPaymentCents: null },
      meetingRequest: {
        id: 'meet-qa-1',
        associationId: 'assoc-qa-2',
        status: 'accepted',
        message: 'Would love ten minutes on how you would introduce this.',
        requestedAt: '2026-08-06T09:00:00.000Z',
        respondedAt: '2026-08-06T15:30:00.000Z',
        responseNote: 'Happy to talk.',
      },
    },
  ],
};

const readiness: FounderReadiness = {
  campaignId: QA.campaignId,
  campaignStatus: 'creator_prep',
  campaignLiveAt: '2026-08-20T15:00:00.000Z',
  canAskToBegin: false,
  creators: [
    {
      associationId: QA.associationId,
      publicHandle: '@solderandsawdust',
      status: 'readiness_blocked',
      canBeginWork: false,
      fixedPayment: {
        applicable: true,
        status: 'awaiting_funding',
        label: 'Fixed Creator payment pending completion',
        amountCents: '50000',
        fundingDeadlineAt: '2026-08-15T17:00:00.000Z',
        fundedAt: null,
        canceledAt: null,
      },
      blockers: [
        { key: 'fixed_payment_funded', label: 'Fund the agreed fixed payment', owner: 'Founder' },
        { key: 'disclosure_confirmed', label: 'Creator confirms the disclosure wording', owner: 'Creator' },
      ],
      nextDate: '2026-08-15T17:00:00.000Z',
    },
  ],
};

/* ── §18/§20/§21/§22 the live campaign, results, and fulfillment ───────────── */

const updates: FounderUpdatesView = {
  updates: [
    {
      id: 'upd-1',
      audience: 'general_public',
      title: 'Anodising booked',
      body: 'The finish line is booked for the first week of February.',
      imageUrl: null,
      videoUrl: null,
      publishedAt: '2026-08-25T12:00:00.000Z',
      isMaterialDeliveryChange: false,
      priorCommitment: null,
      revisedCommitment: null,
    },
  ],
  canPost: true,
  campaignStatus: 'live',
  model: 'product',
};

/*
  §17's post submissions as the Founder sees them (Session D). Two rows, on
  purpose: one acknowledgeable and one under correction, so the sweep renders
  BOTH halves of deviation 2 — the control, and the sentence that replaces it
  when Proovd has asked for a change. In a fixed order that is not a metric,
  matching `explore.ts`'s own stated ordering (§30: no ranking).
*/
const creatorPosts: CreatorPostView[] = [
  {
    submissionId: 'post-qa-1',
    associationId: QA.associationId,
    publicHandle: '@solderandsawdust',
    postUrl: 'https://example.social/@solderandsawdust/p/1',
    channel: 'social',
    submittedAt: '2026-08-24T09:00:00.000Z',
    status: 'passed',
    acknowledgedAt: null,
    acknowledgeable: true,
  },
  {
    submissionId: 'post-qa-2',
    associationId: 'assoc-qa-2',
    publicHandle: '@nostanding',
    postUrl: 'https://example.social/@nostanding/p/7',
    channel: 'social',
    submittedAt: '2026-08-23T09:00:00.000Z',
    status: 'correction_needed',
    acknowledgedAt: null,
    acknowledgeable: false,
  },
];

const home: CampaignHomeView = {
  campaignId: QA.campaignId,
  status: 'live',
  glance: {
    activePreorderCount: 31,
    delta: { count: 4, since: '2026-08-26T09:00:00.000Z' },
    model: 'product',
    remainingToThreshold: 9,
    closesAt: QA.closesAt,
    notYetChargedNotice: 'No card has been charged. Cards are charged when the campaign closes.',
    activeCreators: 1,
    readAt: '2026-08-26T15:40:00.000Z',
    freshnessBasis: 'refresh',
    deliveryId: 'delivery-1',
    counts: {
      newCount: 35,
      canceledCount: 3,
      otherExits: 1,
      activeCount: 31,
      netChange: 4,
      uniqueActiveBackers: 31,
      everHadPreorder: true,
    },
  },
  act: {
    state: 'action',
    action: {
      kind: 'first_post_correction',
      rank: 2,
      label: 'A Creator’s first post needs a correction',
      detail: '@solderandsawdust was asked to add the disclosure line.',
      href: `/campaigns/${QA.campaignId}/creator-readiness`,
      sourceTable: 'creator_post_submissions',
      sourceId: 'post-1',
      occurredAt: '2026-08-26T11:00:00.000Z',
    },
    overridden: false,
    override: null,
    deferred: [],
  },
  explore: {
    sections: [
      {
        key: 'preorders',
        title: 'Pre-orders',
        definition: 'Every pre-order that is active right now, counted once per person.',
        data: { active: 31, canceled: 3 },
        awaiting: null,
      },
      {
        key: 'creator_earnings',
        title: 'Creator earnings',
        definition: 'What each Creator has provisionally earned on captured pre-orders.',
        data: null,
        awaiting: 'Nothing is captured until the campaign closes.',
      },
    ],
    readAt: '2026-08-26T15:40:00.000Z',
    freshnessBasis: 'refresh',
  },
  milestoneHistory: [
    { kind: 'first_preorder', occurredAt: '2026-08-20T16:00:00.000Z', acknowledgedAt: '2026-08-20T18:00:00.000Z' },
  ],
};

const results: FounderResultsView = {
  campaignId: QA.campaignId,
  campaignTitle: QA.title,
  model: 'product',
  state: 'ready',
  campaignStatus: 'closed_reconciling',
  closedAt: QA.closesAt,
  threshold: { required: 40, uniqueActiveBackers: 44, met: true },
  preorders: { placed: 47, captured: 44, canceled: 3, noCharge: 0 },
  uniqueBackers: 44,
  productTransactions: { transactions: 44, units: 44 },
  money: {
    rewardSubtotalCapturedCents: '528000',
    salesTaxCapturedCents: '43560',
    totalCapturedCents: '571560',
  },
  payments: { failed: 3, recovered: 2, dropped: 1 },
  /* §21's window, closed — the state a `closed_reconciling` campaign is in. */
  retryWindow: {
    state: 'closed',
    windowHours: 48,
    firstFailureAt: '2026-09-12T17:20:00.000Z',
    deadlineAt: '2026-09-14T17:20:00.000Z',
  },
  conversion: { clicks: 1840, placed: 47, conversionRate: '2.6%', canceled: 3, dropOffRate: '6.4%' },
  survey: {
    consentedCount: 28,
    totalPreorderCount: 47,
    averageRecommend: '8.4',
    reasons: ['I solder at a kitchen table', 'The arm holds its position'],
  },
  perCreator: [
    {
      associationId: QA.associationId,
      handle: '@solderandsawdust',
      clicks: 1840,
      attributedPlaced: 31,
      attributedCaptured: 29,
      capturedSubtotalCents: '348000',
      provisionalCents: '83520',
      lockedPercent: 24,
    },
  ],
  revenueBySource: {
    creatorAttributedCents: '348000',
    directCents: '180000',
    note: 'Direct means no tracking link decided the pre-order.',
  },
  bonuses: [{ associationId: QA.associationId, earnedPercent: 4, status: 'earned' }],
  finalization: {
    creatorEarnings: 'pending',
    note: 'Creator earnings are finalized after the retry window closes.',
    fixedPayments: [{ associationId: QA.associationId, status: 'funded' }],
  },
  narrative: {
    strongestSignal: '44 of 47 pre-orders captured on the first attempt.',
    weakestSignal: 'One pre-order dropped after the retry window.',
    leadingSurveyReason: 'I solder at a kitchen table',
    whatThisProves: 'People who already own a soldering iron will pay US$120 for better light.',
    whatThisDoesNotProve: 'Nothing here shows how a retail buyer would respond.',
    reviewedBy: 'Sam at Proovd',
    preparedAt: '2026-09-15T12:00:00.000Z',
  },
  preparing: null,
};

const founderPayments: FounderPaymentStatusView = {
  campaignId: QA.campaignId,
  model: 'product',
  campaignStatus: 'closed_reconciling',
  closedAt: QA.closesAt,
  currency: 'USD',
  applicable: true,
  notApplicableReason: null,
  w9: {
    state: 'verified',
    line: 'Your W-9 is verified.',
    action: 'No action needed',
    requestedAt: '2026-09-12T18:00:00.000Z',
    submittedAt: '2026-09-13T09:00:00.000Z',
    verifiedAt: '2026-09-13T15:00:00.000Z',
    returnReason: null,
    blocksPayments: false,
  },
  eligibleShare: {
    exact: true,
    amountCents: '418080',
    note: 'Captured pre-tax subtotal, less Proovd’s 5% and the finalized Creator compensation.',
    basis: {
      rewardSubtotalCapturedCents: '528000',
      proovdFeeCents: '26400',
      finalizedCreatorCompensationCents: '83520',
      causeBasedAdjustmentsCents: '0',
      stripeFeesAllocatedToFounderCents: '0',
    },
  },
  payments: [
    {
      kind: 'first_payment',
      label: 'First payment',
      percent: 40,
      amountCents: '167232',
      amountExact: true,
      status: 'released',
      blockers: [],
      secureAction: null,
      noActionNeeded: true,
      dueAt: '2026-09-15T17:00:00.000Z',
      releasedAt: '2026-09-15T17:30:00.000Z',
      releasedEarly: false,
    },
    {
      kind: 'remaining_payment',
      label: 'Remaining payment',
      percent: 60,
      amountCents: '250848',
      amountExact: true,
      status: 'eligible',
      blockers: [],
      secureAction: 'Proovd releases this after the Day 14 Progress Check.',
      noActionNeeded: true,
      dueAt: '2026-09-26T17:00:00.000Z',
      releasedAt: null,
      releasedEarly: false,
    },
  ],
  nextReviewDate: '2026-09-26T17:00:00.000Z',
  day14: { dueAt: '2026-09-26T17:00:00.000Z', line: 'The Day 14 Progress Check is due 26 September 2026.' },
  earlyRelease: {
    settingEnabled: false,
    evidence: null,
    pendingRequest: null,
    neverSkipsDay14: 'An early release never skips the Day 14 Progress Check.',
  },
};

const fulfillment: FulfillmentStatusView = {
  campaignId: QA.campaignId,
  campaignType: 'pre_launch',
  mechanism: 'physical_shipment',
  mechanismLabel: 'Physical shipment',
  accessInstructions: 'Tracking numbers are emailed as each unit ships.',
  deliveredAt: null,
  deliveryNotifiedAt: null,
  fulfilledAt: null,
  closeAt: QA.closesAt,
  chargedAt: '2026-09-12T17:05:00.000Z',
  obligations: [
    {
      key: 'close_confirmation',
      label: 'Confirm the outcome to Backers within 48 hours of close',
      evidence: 'campaign_updates',
      state: 'met',
      dueAt: '2026-09-14T17:00:00.000Z',
      detail: 'Posted 13 September 2026.',
    },
    {
      key: 'update_cadence',
      label: 'Post at least one update every 30 days until delivery',
      evidence: 'campaign_updates',
      state: 'due',
      dueAt: '2026-10-12T17:05:00.000Z',
      detail: 'Last update 13 September 2026.',
    },
  ],
  cadence: {
    state: 'due',
    nextDueAt: '2026-10-12T17:05:00.000Z',
    daysSinceLastCommunication: 21,
    silentDays: 21,
  },
  commitments: [
    {
      sequence: 1,
      deliveryMonth: '2027-03',
      deliveryDate: null,
      commitmentText: `We commit to ${QA.delivery}.`,
      reason: null,
      path: null,
      notifiedBackersAt: null,
      isOriginal: true,
    },
  ],
  changePath: 'admin_preapproval',
  pendingChangeRequest: null,
  mechanisms: [
    { key: 'physical_shipment', label: 'Physical shipment' },
    { key: 'digital_download', label: 'Digital download' },
  ],
  materialUpdateFields: [
    { key: 'proposedDeliveryMonth', label: 'The new delivery month' },
    { key: 'reason', label: 'Why it moved' },
  ],
  disclosedCommitmentSuggestion: `We commit to ${QA.delivery}.`,
};

const day14: Day14ChecklistView = {
  campaignId: QA.campaignId,
  campaignType: 'pre_launch',
  items: [
    {
      key: 'production_progress',
      label: 'Evidence of production progress',
      example: 'A photograph of the tooling with a date visible.',
      required: true,
    },
    {
      key: 'backer_communication',
      label: 'The update you sent Backers',
      example: 'A link to the update you posted after close.',
      required: true,
    },
  ],
  reviewOpen: true,
  outcome: 'pending',
  decisionDueAt: '2026-09-26T17:00:00.000Z',
  blocksAPayment: true,
  enforcementOnly: false,
  submissions: [],
  /*
    One open clarification, so the sweep renders the answer control Session E
    added. §22.4's five-business-day window has been on the surface since Phase
    21a with nothing to answer it — a fixture with an empty list would have
    swept a screen that never showed the gap.
  */
  clarifications: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      question: 'Which of the tooling photographs is the current one?',
      requestedAt: '2026-09-20T17:00:00.000Z',
      dueAt: '2026-09-27T17:00:00.000Z',
      respondedAt: null,
      responseNote: null,
      overdue: false,
    },
  ],
};

/* ── Chapter 4 and the Backers page (Session F) ────────────────────────────── */

/*
  §22.8's recorded completion, §22.9's ask, §22.11's resolution and §22.10's two
  gates. The SAME association `roster` and `results` describe — §33.11.5's rule.

  One Creator is completed and one is not, so the sweep renders both branches of
  the recap: the §22.9 ask is offered on the recorded status and nothing else,
  which is what keeps §22.8's decision out of a revenue figure (§33.10.6).
*/
const founderWrap: FounderWrapView = {
  campaignId: QA.campaignId,
  campaignStatus: 'closed_resolved',
  closedAt: QA.closesAt,
  resolution: {
    resolved: true,
    resolvedAt: '2026-09-20T12:00:00.000Z',
    fulfillmentNote: RESOLUTION_IS_NOT_FULFILLMENT,
    fulfillmentActive: true,
    fulfilledAt: null,
  },
  creators: [
    /* In the server's own order — by handle. `readFounderWrap` sorts, and the
       surface renders what it is given, so a fixture in a different order
       would be asserting the fixture rather than the surface. */
    {
      associationId: 'a1111111-1111-4111-8111-111111111111',
      publicHandle: '@benchnotes',
      subtype: 'newsletter_operator',
      audienceNiche: 'Weekly tools newsletter',
      adminBio: null,
      status: 'active',
      rosterMembership: 'included',
      completion: null,
      workAgain: { eligible: false, request: null },
    },
    {
      associationId: QA.associationId,
      publicHandle: '@solderandsawdust',
      subtype: 'social_creator',
      audienceNiche: 'Electronics workbench builds',
      adminBio: 'Builds and films bench tooling on a weekly cadence.',
      status: 'active',
      rosterMembership: 'included',
      completion: {
        status: 'successfully_completed',
        decidedAt: '2026-09-18T09:00:00.000Z',
        reason: null,
      },
      workAgain: { eligible: true, request: null },
    },
  ],
  nextCampaign: {
    cooldown: {
      months: 3,
      closedAt: QA.closesAt,
      earliestAt: '2026-12-12T17:00:00.000Z',
      elapsed: false,
      blocker: null,
    },
    adminReadiness: { decision: null, decidedAt: null, explanation: null },
    readyForNextCampaign: false,
    prepareNote: PREPARE_WITHOUT_OPENING,
  },
};

/*
  §19's operational share, and it is the only fixture in this file that carries
  a Backer's email — which is exactly what §19 makes mandatory and §25.7 scopes
  to fulfillment and support.

  One row is withdrawn, so the sweep renders the `do_not_fulfill` branch. That
  is the branch worth exercising: a row presented as deliverable when the money
  never moved is a Founder shipping to somebody who was never charged.
*/
const founderBackers: FounderBackersView = {
  campaignId: QA.campaignId,
  sharedCount: 2,
  activeCount: 1,
  doNotFulfillCount: 1,
  rows: [
    {
      preorderReference: QA.reservationId,
      backerEmail: 'rowan@example.com',
      rewardSku: QA.rewardSku,
      rewardTitle: QA.rewardTitle,
      fulfillmentState: 'active',
      doNotFulfillLabel: null,
      doNotFulfillAt: null,
      sharedAt: '2026-08-22T14:05:00.000Z',
      progressionStep: 'delivery_due',
      progressionLabel: 'Delivery due',
    },
    {
      preorderReference: 'r2222222-2222-4222-8222-222222222222',
      backerEmail: 'quietcancel@example.com',
      rewardSku: QA.rewardSku,
      rewardTitle: QA.rewardTitle,
      fulfillmentState: 'do_not_fulfill',
      doNotFulfillLabel: DO_NOT_FULFILL_LABEL,
      doNotFulfillAt: '2026-09-01T08:00:00.000Z',
      sharedAt: '2026-08-24T09:30:00.000Z',
      progressionStep: 'no_charge',
      progressionLabel: 'No charge',
    },
  ],
  exportColumns: [...FOUNDER_EXPORT_COLUMNS],
  exportWithheld: [...FOUNDER_EXPORT_WITHHELD],
  dataRequests: [],
};

/*
  §5.2's eleven settings, Session G.

  The account is CLAIMED and the campaign has closed with a charge, so the W-9
  block renders the resolver's own line rather than the not-yet sentence — the
  branch worth sweeping, since the other one has no state to get wrong. No
  deletion request is on file, so the ask renders as a control rather than as a
  receipt; the receipt branch is the surface suite's.
*/
const founderSettings: FounderSettingsView = {
  campaignId: QA.campaignId,
  campaignTitle: QA.title,
  signInEmail: 'nadia@example.com',
  accountCreatedAt: '2026-06-02T10:00:00.000Z',
  fields: [
    { id: 'preferred_name', value: 'Nadia', guarded: false },
    { id: 'phone', value: '+1 503 555 0134', guarded: false },
    { id: 'business_name', value: 'Solder & Sawdust LLC', guarded: false },
    { id: 'business_entity_type', value: 'LLC', guarded: false },
    { id: 'legal_name', value: 'Nadia Okonkwo', guarded: true },
    { id: 'email', value: 'nadia@example.com', guarded: true },
  ],
  representations: [
    { id: 'age_18_plus', label: 'I am 18 or older', confirmed: true },
    { id: 'us_person', label: 'I am a US person', confirmed: true },
    { id: 'sanctions', label: 'I am not on a sanctions list', confirmed: true },
  ],
  dateOfBirthOnFile: true,
  country: 'US',
  stateRegion: 'OR',
  soleProprietor: false,
  w9: {
    state: 'verified',
    line: 'Your W-9 is on file and verified.',
    action: 'No action needed',
    requestedAt: '2026-09-13T17:00:00.000Z',
    submittedAt: '2026-09-14T09:12:00.000Z',
    verifiedAt: '2026-09-15T11:40:00.000Z',
    returnReason: null,
    blocksPayments: false,
  },
  w9NotApplicableBecause: null,
  deletionRequestedAt: null,
};

/* ── §11/§14/§18/§21 the Creator's surfaces ────────────────────────────────── */

const creatorInvitation: CreatorInvitationState = {
  landing: {
    recipientName: 'Wren Castillo',
    publicHandle: '@solderandsawdust',
    founderName: QA.founderDisplayName,
    productName: QA.title,
    whyRecruited: 'Your bench-build videos are the closest audience this product has.',
    reviewedPresence: 'We watched four of your videos and read your channel description.',
    senderName: 'Sam at Proovd',
    reference: 'PVD-QA300-QA400',
  },
  profile: {
    associationId: QA.associationId,
    campaignId: QA.campaignId,
    fields: {
      legalName: { value: 'Wren Castillo', supplier: 'proovd', prefilled: 'Wren Castillo', editedAt: null },
      publicHandle: { value: '@solderandsawdust', supplier: 'proovd', prefilled: '@solderandsawdust', editedAt: null },
      email: { value: 'wren@example.com', supplier: 'proovd', prefilled: 'wren@example.com', editedAt: null },
      phone: { value: null, supplier: null, prefilled: null, editedAt: null },
      channelReference: { value: 'https://example.com/solderandsawdust', supplier: 'proovd', prefilled: 'https://example.com/solderandsawdust', editedAt: null },
      // The Creator's own tile (0055), and it AGREES with the recorded §5.3
      // subtype below — the disagreement banner is a real state and a fixture
      // that tripped it on every sweep would report a warning nobody has.
      channelType: { value: 'youtube', supplier: 'affiliate', prefilled: null, editedAt: null },
      audienceNiche: { value: 'Electronics workbench builds', supplier: 'proovd', prefilled: 'Electronics workbench builds', editedAt: null },
      nicheDescription: { value: 'Bench builds, wiring, and shop-made jigs.', supplier: 'affiliate', prefilled: null, editedAt: null },
      outreachPlan: { value: null, supplier: null, prefilled: null, editedAt: null },
      audienceSize: { value: '48000', supplier: 'proovd', prefilled: '48000', editedAt: null },
      bio: { value: 'Weekly bench-build videos.', supplier: 'affiliate', prefilled: null, editedAt: null },
      dateOfBirth: { value: null, supplier: null, prefilled: null, editedAt: null },
      country: { value: 'US', supplier: 'affiliate', prefilled: null, editedAt: null },
      stateRegion: { value: 'OR', supplier: 'affiliate', prefilled: null, editedAt: null },
    },
    // A real §5.3 subtype. It read `youtube_channel`, which is not one of the
    // seven and is not a value `affiliate_prospects.subtype` can hold — so
    // nothing keying off the register could ever have matched it.
    channelSubtype: 'social_creator',
    phoneVerified: false,
    confirmations: {
      age18Plus: false,
      usBased: false,
      actualOperator: false,
      noDuplicateAccounts: false,
      sanctionsEligible: false,
    },
    payout: { status: 'not_started', connectedAccountId: null, requirements: null, updatedAt: null },
    lastSavedAt: null,
    claimedAt: null,
  },
  conditional: {
    state: 'not_signed_up',
    campaignId: QA.campaignId,
    productName: QA.title,
    founderClaimedAt: '2026-08-02T12:10:00.000Z',
    listingPaidAt: null,
    payoutStatus: 'not_started',
    reviewAvailable: false,
  },
  policies: [
    { slug: 'terms', title: 'Terms of Service', version: 'v1.0', status: 'draft', route: '/terms' },
    { slug: 'affiliate-aup', title: 'Creator Acceptable Use Policy', version: 'v1.0', status: 'draft', route: '/affiliate-aup' },
  ],
  // 0055's two records (Session C). Both answered, because an unanswered one
  // is a real state and a fixture stuck in it would sweep every screen in its
  // empty shape and never render what a Creator coming back actually sees.
  voice: {
    tones: ['analytical', 'understated'],
    customTones: ['shop-floor'],
    flexible: false,
    recordedAt: '2026-08-03T09:30:00.000Z',
  },
  metrics: {
    values: { followers: '48,000', engagement: 'About 6% on a good week' },
    recordedAt: '2026-08-03T09:32:00.000Z',
  },
  // What §5.3 asks a `social_creator` for, of the nine. The server derives it;
  // this is the same answer, typed out, because a fixture that derived it would
  // be testing the derivation against itself.
  metricsAsked: ['followers', 'engagement'],
  // Track A4, and the flow renders a named absence for both uploads. `true`
  // here would sweep a state the deployment does not have.
  uploads: { available: false },
};

const opportunity: FormalOpportunity = {
  associationId: QA.associationId,
  campaignId: QA.campaignId,
  associationStatus: 'formal_decision_open',
  whyThisFitsYourAudience: 'Your viewers already own the iron this lamp is for.',
  campaignStateLabel: 'Waiting for your decision',
  responseDeadlineAt: '2026-08-08T10:00:00.000Z',
  highEffort: {
    result: false,
    basis: { visualsCompleted: true, brandingCompleted: false, interviewScheduledOrConfirmed: false },
  },
  compensation: {
    basePercent: 20,
    basePercentWithFixed: 15,
    bidAllowed: true,
    fixedPaymentAvailable: true,
    ceilingPercent: 50,
  },
  decisionsAvailable: true,
  versions: [
    {
      id: 'ver-1',
      versionNumber: 1,
      proposedBy: 'affiliate',
      bidTotalPercent: 24,
      fixedPaymentRequestCents: '50000',
      state: 'awaiting_founder',
      createdAt: '2026-08-06T10:00:00.000Z',
    },
  ],
  agreement: null,
  trackingLink: null,
};

/**
 * §14.1's material behind the pitch — Session E.
 *
 * Every `PITCH_RECAP_SECTIONS` entry whose source is `payload` resolves against
 * this, so a section that stopped being served fails the shared walk before the
 * sweep ever renders it.
 */
const pitchContent: PitchContent = {
  brief: {
    audience: null,
    productPromise: 'A clamp lamp that holds its position.',
    campaignType: 'Product Campaign',
    requiredPromotion:
      'One first post that Proovd verifies, then keep promoting through the channels you told us about until the campaign closes.',
    compensation:
      'A percentage of every captured, validly attributed pre-order, and — if you request one and the Founder accepts it — an optional fixed Creator payment beside it.',
    keyDate: '2026-09-12T17:00:00.000Z',
    mainRisk: 'The arm is machined to order, so a supplier delay moves the delivery month.',
  },
  founder: {
    displayName: QA.founderDisplayName,
    entity: QA.founderLegalName,
    soleProprietor: false,
    profileUrl: 'https://example.com/harlow',
    priorCampaigns: 1,
    payoutReadiness: 'ready',
  },
  positioning: {
    productName: QA.title,
    category: null,
    problem: 'Benches are badly lit.',
    solution: 'A clamp lamp that holds its position.',
    competition: 'Two incumbents at US$300.',
  },
  chargeRule: {
    campaignType: 'Product Campaign',
    rule: 'Backers save a card now and are charged when the campaign closes. There is no threshold to reach.',
  },
  materials: {
    story: 'Built on a bench with one bad lamp.',
    socials: [{ platform: 'youtube', url: 'https://youtube.com/@harlow' }],
    visuals: { count: 0, available: false, unavailableBecause: 'The Founder has not uploaded visuals for this campaign yet.' },
    interview: {
      status: 'confirmed',
      available: false,
      unavailableBecause:
        'Proovd records whether the Founder interview happened, and does not keep a recording of it.',
    },
  },
  rewards: [
    {
      title: 'The bench lamp',
      priceCents: '12000',
      contents: ['One lamp', 'One clamp'],
      delivery: 'March 2027',
      fulfillment: 'Shipped from Portland.',
      limitedQuantity: 40,
    },
  ],
  threshold: {
    label: 'The Founder’s internal target',
    value: '400000',
    note: 'The Founder’s own target. It is not a public number, it is not shown on the campaign page, and no charge depends on it.',
  },
  dates: { opensAt: '2026-08-12T17:00:00.000Z', closesAt: '2026-09-12T17:00:00.000Z', durationDays: 31 },
  brandNotes: { brandVoice: 'Plain sentences. No superlatives.', brandPerception: null },
  claims: {
    requiredWording: 'Say the arm is machined aluminium.',
    prohibitedClaims: 'Do not claim a delivery date earlier than March 2027.',
    unconfirmedClaimWarning:
      'Everything the Founder says about this product is the Founder’s own claim. Proovd has not tested it.',
  },
  refundPolicy: {
    applicable: true,
    title: 'Harlow returns policy',
    text: 'Thirty days from delivery.',
    note: 'This is the Founder’s own policy. It is snapshotted onto every pre-order at the moment it is placed.',
  },
  deliverables: {
    deliveryWindow: 'March 2027',
    obligations: [
      {
        key: 'disclosure',
        statement: 'Include the FTC disclosure on every post about this campaign.',
        enforcement: 'A post without it is a correction, and your link pauses until it is fixed.',
      },
    ],
  },
  midCampaign: null,
};

const creatorPitchList: CreatorPitchesView = {
  pitches: [
    {
      associationId: QA.associationId,
      campaignId: QA.campaignId,
      productName: QA.title,
      kind: 'opportunity',
      whyThisFitsYourAudience: 'Your viewers already own the iron this lamp is for.',
      highEffort: false,
      basePercent: 20,
      bidAllowed: true,
      fixedPaymentAvailable: true,
      ceilingPercent: 50,
      campaignType: 'pre_launch',
      responseDeadlineAt: '2026-08-08T10:00:00.000Z',
      invitedAt: '2026-08-05T10:00:00.000Z',
    },
  ],
  active: [
    {
      associationId: QA.associationId,
      campaignId: QA.campaignId,
      productName: QA.title,
      status: 'active',
      label: 'Active — your link is live',
      ready: true,
      trackingLinkUrl: 'abc123',
      trackingLinkActive: true,
      firstPostStatus: 'passed',
      destination: 'work',
    },
  ],
};

const partnership: CreatorPartnership = {
  associationId: QA.associationId,
  campaignId: QA.campaignId,
  status: 'active',
  joinedAt: '2026-08-07T10:00:00.000Z',
  rosterMembership: 'Required Creator',
  founder: { displayName: QA.founderDisplayName },
  product: {
    title: QA.title,
    model: 'product',
    publicUrl: `https://app.proovd.co/campaign/${QA.campaignId}`,
    closesAt: QA.closesAt,
  },
  trackingLink: {
    url: 'https://app.proovd.co/c/QA1234',
    testUrl: 'https://app.proovd.co/c/QA1234?proovd_link_test=1',
    active: true,
    activatedAt: '2026-08-20T15:00:00.000Z',
    pausedAt: null,
    disclosureText: 'Paid partnership with Harlow Instruments.',
  },
  brandRules: {
    requiredWording: 'Say that the arm is machined aluminium.',
    prohibitedClaims: 'Do not claim a delivery date earlier than March 2027.',
    brandPerception: 'Precise, unfussy, built to be repaired.',
    brandVoice: 'Plain sentences. No superlatives.',
  },
  rewards: [{ title: QA.rewardTitle, priceCents: '12000', delivery: QA.delivery }],
  compensation: {
    basePercent: 20,
    bidIncreasePercent: 4,
    totalPercent: 24,
    fixedPaymentCents: '50000',
  },
  fixedPayment: {
    applicable: true,
    status: 'funded',
    label: 'Fixed Creator payment pending completion',
    amountCents: '50000',
    fundedAt: '2026-08-14T12:00:00.000Z',
  },
  firstPost: {
    status: 'passed',
    submittedAt: '2026-08-21T09:00:00.000Z',
    verifiedAt: '2026-08-21T14:00:00.000Z',
    correctionDetail: null,
  },
  readiness: { state: 'ready', ready: true, label: 'Ready' },
  clicks: { total: 1840, attributed: 31 },
  // Session F: the §17 metrics are real records now, not a "not yet" block.
  performance: {
    attributedPreorders: 31,
    activePreorders: 24,
    capturedPreorders: 7,
    capturedSubtotalCents: '84000',
    conversionRate: 31 / 1840,
    attributionNote: 'These count only what came through your own link.',
  },
  bonus: {
    triggerUnit: 'unique_attributed_backers',
    thresholdValue: '50',
    additionalPercent: 5,
    maxCombinedPercent: 40,
    progressValue: '31',
    note: 'The bonus is decided when the campaign closes, on charges that actually went through.',
    earnedPercent: null,
  },
  materials: {
    available: false,
    unavailableBecause:
      'The campaign’s object storage is not configured in this deployment, so there is nothing stored to download yet.',
    assets: [],
  },
  obligations: [
    {
      key: 'disclosure',
      statement: 'Include the disclosure on every post.',
      enforcement: 'A post without it is a correction, and the link pauses until it is fixed.',
    },
  ],
  earnings: {
    state: 'estimated',
    label: 'Estimated',
    amountCents: null,
    reason: 'The campaign has not closed, so no charge has been captured yet.',
    owner: 'Proovd',
    nextUpdate: 'After the campaign closes',
    action: 'No action needed',
    actionRequired: false,
    statusBlock: null,
  },
  midCampaign: null,
  updatedAt: '2026-08-26T15:40:00.000Z',
};

/*
 * The Creator's home (Creator Flow v2 deviation 5, Session D).
 *
 * The richest state on purpose: a pitch waiting, a standing with a cohort
 * behind it, a work-again ask, and a referral — so the sweep renders every
 * block rather than the caught-up ending, which draws almost nothing. The
 * three states Home has to serve (pitches / none / no standing) are the unit
 * suite's, where they can be asserted rather than merely rendered.
 */
const creatorHome: CreatorHomeView = {
  firstName: 'Mohab',
  pitches: [
    {
      associationId: QA.associationId,
      campaignId: QA.campaignId,
      productName: QA.title,
      kind: 'opportunity',
    },
  ],
  standing: {
    score: 680,
    tier: 'gold',
    percentile: 82,
    inputs: {
      campaigns_completed: 3,
      posts_verified: 3,
      obligations_met: 3,
      evidence_verified: 1,
    },
    computedAt: '2026-08-18T09:15:00.000Z',
  },
  leaders: [
    { handle: '@rivera', score: 900, tier: 'platinum', isYou: false },
    { handle: '@mohabvlogs', score: 680, tier: 'gold', isYou: true },
  ],
  cohortMinimum: 10,
  trackRecord: { launched: 3, verified: 3, backedCents: '348000' },
  workAgain: [
    {
      requestId: 'a0000000-0000-4000-8000-0000000000a1',
      associationId: QA.associationId,
      productName: QA.title,
      message: 'We are starting a second campaign and would like you on it again.',
      requestedAt: '2026-08-17T12:00:00.000Z',
    },
  ],
  referrals: [
    {
      id: 'a0000000-0000-4000-8000-0000000000a2',
      referredName: 'J. Park',
      state: 'recorded',
      recordedAt: '2026-08-16T12:00:00.000Z',
    },
  ],
};

const creatorClose: CreatorCloseView = {
  associationId: QA.associationId,
  campaignId: QA.campaignId,
  campaignTitle: QA.title,
  campaignStatus: 'closed_reconciling',
  closedAt: QA.closesAt,
  contentVerified: { status: 'passed', line: 'Your first post was verified on 21 August 2026.' },
  attributed: { preorders: 31, captured: 29, capturedSubtotalCents: '348000' },
  earnings: {
    state: 'finalized',
    label: 'Finalized',
    lockedPercent: 24,
    estimatedCents: '83520',
    reason: 'Every captured pre-order attributed to your link has been counted.',
    nextUpdate: 'Proovd approves the transfer after the reconciliation completes.',
    action: 'No action needed',
    statusBlock:
      'Your earnings are finalized at US$835.20. The transfer is made no earlier than three days after close.',
    finalization: 'recorded',
    finalizationNote: 'Recorded on 15 September 2026.',
    final: {
      earnedPercent: 24,
      commissionCents: '83520',
      bonusCents: '0',
      eligibleFixedCents: '50000',
      totalCents: '133520',
    },
  },
  bonus: { recorded: 0, finalization: 'recorded', note: 'No bonus threshold was reached.' },
  fixedPayment: { applicable: true, status: 'funded', amountCents: '50000' },
  nextReviewAt: '2026-09-15T12:00:00.000Z',
  nextReviewLine: 'Proovd reviews Creator completion on 15 September 2026.',
  thankYou: 'Thank you for the work you put into this campaign.',
};

/*
 * Earnings, Resources and Settings (Creator Flow v2 Session F).
 *
 * The earnings list carries one CLOSED campaign, so the sweep renders a real
 * Appendix B.7 block rather than the waiting state — which is the half of the
 * surface with something in it. `creatorClose` is reused rather than a second
 * close view invented: §33.11.5's rule is one campaign across every fixture.
 */
const creatorOwnEarnings: CreatorOwnEarningsView = {
  lifetimeRecordedCents: '141200',
  recordedCampaigns: 1,
  rows: [
    {
      associationId: QA.associationId,
      campaignId: QA.campaignId,
      campaignTitle: QA.title,
      close: creatorClose,
      waitingOn: null,
    },
  ],
};

const creatorResources: CreatorResourcesView = { interested: ['best_practices'] };

const creatorSettings: CreatorSettingsView = {
  profileId: 'qa-profile',
  prospectId: 'qa-prospect',
  fields: [
    { id: 'public_handle', label: 'Public handle', value: '@harlow', supplier: 'affiliate', guarded: false },
    { id: 'phone', label: 'Phone', value: '+1 503 555 0142', supplier: 'proovd', guarded: false },
    { id: 'channel_reference', label: 'Channel link or handle', value: 'youtube.com/@harlow', supplier: 'proovd', guarded: false },
    { id: 'audience_niche', label: 'Audience niche', value: 'Woodworking', supplier: 'proovd', guarded: false },
    { id: 'audience_size', label: 'Audience size', value: 'About 40,000', supplier: 'affiliate', guarded: false },
    { id: 'bio', label: 'Bio', value: 'Builds furniture on camera.', supplier: 'proovd', guarded: false },
    { id: 'niche_description', label: 'What you cover', value: 'Hand tools and shop lighting.', supplier: null, guarded: false },
    { id: 'outreach_plan', label: 'How you reach your network', value: 'A weekly build video.', supplier: null, guarded: false },
    { id: 'legal_name', label: 'Legal name', value: 'Sam Okafor', supplier: 'proovd', guarded: true },
    { id: 'email', label: 'Email', value: 'sam@example.com', supplier: 'proovd', guarded: true },
  ],
  channelSubtype: 'social_creator',
  payout: { state: 'complete', payoutsEnabled: true, accountPresent: true },
  signed: [
    { label: 'terms', version: '1.0', acceptedAt: '2026-08-01T10:00:00.000Z' },
    { label: 'affiliate-aup', version: '1.0', acceptedAt: '2026-08-01T10:00:00.000Z' },
  ],
  deletionRequestedAt: null,
};

/* ── §18/§19/§20 the public campaign, the checkout, and the magic link ─────── */

const liveCampaign: LiveCampaignResponse = {
  campaign: {
    campaignId: QA.campaignId,
    model: 'product',
    title: QA.title,
    tagline: 'A bench lamp that holds its position.',
    founder: {
      legalName: QA.founderLegalName,
      entity: QA.founderLegalName,
      country: 'US',
      profile: 'https://example.com/harlow',
    },
    opensAt: '2026-08-20T15:00:00.000Z',
    closesAt: QA.closesAt,
    rewards: [
      {
        sku: QA.rewardSku,
        title: QA.rewardTitle,
        priceCents: '12000',
        contents: ['One lamp', 'One clamp base', 'One spare bulb'],
        delivery: QA.delivery,
        fulfillment: 'Shipped from New York with tracking.',
        badge: 'Lowest price',
        limitedQuantity: 250,
        remaining: 249,
      },
    ],
    featuredRewardSku: QA.rewardSku,
    orderThreshold: 40,
    statementDescriptor: QA.descriptor,
    story: 'We built the first one for our own bench.',
    faq: [{ question: 'When will I get it?', answer: `We commit to ${QA.delivery}.` }],
    refundSummary: [
      'Cancel free any time before the charge date.',
      'After delivery, the Founder’s own refund policy applies.',
    ],
    founderRefundPolicy: {
      title: 'Harlow Instruments refund policy',
      version: 'v1',
      effectiveDate: '2026-07-01',
      text: 'Cancel any time before the charge date.',
    },
    commentsEnabled: true,
    heroHeadline: 'A lamp that holds',
    heroHeadlineAccent: 'its position.',
    founderPullQuote: 'We could not buy a better one, so we machined it.',
    platformLine: 'Proovd runs the pre-order. Harlow Instruments ships the lamp.',
    demoContextLabel: 'On the bench',
    benefitsHeading: 'Why this lamp',
    rewardsHeading: 'Choose your lamp',
    updatesHeading: 'Build updates',
    faqHeading: 'Questions',
    demoMoments: [
      {
        id: 'moment-1',
        timeLabel: '8:15',
        momentLabel: 'Morning',
        stateWord: 'Level',
        headline: 'The arm stays where you left it.',
        signalText: 'No drift overnight',
        isAction: false,
        actionLabel: null,
      },
      {
        id: 'moment-2',
        timeLabel: '19:40',
        momentLabel: 'Evening',
        stateWord: 'Warm',
        headline: 'One turn changes the colour.',
        signalText: null,
        isAction: true,
        actionLabel: 'Warm the light',
      },
    ],
    benefitCards: [
      { id: 'card-1', title: 'Holds its position', footerWord: 'Machined', visualVariant: 'bars' },
      { id: 'card-2', title: 'Repairable', footerWord: 'Serviceable', visualVariant: 'check' },
      { id: 'card-3', title: 'Even light', footerWord: 'Diffused', visualVariant: 'dots' },
    ],
    preorderCounts: { uniqueActiveBackers: 1, activeCount: 1 },
  },
  ended: null,
  indexable: true,
  attribution: { handle: '@solderandsawdust', status: 'verified' },
  updates: [],
};

export const QA_QUOTE: Quote = {
  campaignTitle: QA.title,
  founderLegalName: QA.founderLegalName,
  rewardSku: QA.rewardSku,
  rewardTitle: QA.rewardTitle,
  rewardSubtotal: QA.rewardSubtotal,
  salesTax: QA.salesTax,
  totalAuthorized: QA.totalAuthorized,
  chargedToday: '0.00',
  chargeRule: QA_CHARGE_RULE,
  chargeTimeUtc: QA.chargeTimeUtc,
  delivery: QA.delivery,
  statementDescriptor: QA.descriptor,
  consentAppendix: 'A.4',
  consentText:
    'You are placing a founding-member pre-order.\n\nYour card will NOT be charged today.',
  marketingLabel: `I allow ${QA.founderLegalName} to contact me for marketing, research, surveys.`,
  sharingDisclosure:
    'Your email and purchase details are shared with the Founder immediately after you reserve.',
  cancellationPath: 'Cancel free any time before the charge date from your backer page.',
  capacity: null,
};

export const QA_PREORDER_SUCCESS: PreorderSuccess = {
  reservationId: QA.reservationId,
  campaignTitle: QA.title,
  founderLegalName: QA.founderLegalName,
  rewardTitle: QA.rewardTitle,
  rewardSubtotal: QA.rewardSubtotal,
  salesTax: QA.salesTax,
  totalAuthorized: QA.totalAuthorized,
  chargedToday: '0.00',
  chargeRule: QA_CHARGE_RULE,
  chargeTimeUtc: QA.chargeTimeUtc,
  delivery: QA.delivery,
  statementDescriptor: QA.descriptor,
  magicLinkUrl: `https://app.proovd.co/backer/${QA.token}`,
  suspectedDuplicate: false,
};

const backerPage: BackerPageData = {
  notChargedLead: 'Your card is saved. Nothing has been charged.',
  campaign: { campaign: { title: QA.title, model: 'product' } },
  transactions: [
    {
      reservationId: QA.reservationId,
      rewardTitle: QA.rewardTitle,
      delivery: QA.delivery,
      rewardSubtotal: QA.rewardSubtotal,
      salesTax: QA.salesTax,
      totalAuthorized: QA.totalAuthorized,
      status: 'active',
      statusLabel: 'Reserved',
      chargeOccurred: false,
      notChargedYet: true,
      statementDescriptor: QA.descriptor,
      canCancel: true,
      canChangeReward: false,
      recovery: null,
      refunds: [],
    },
  ],
};

const commentThread: CommentThread = {
  open: true,
  closedReason: null,
  comments: [
    {
      id: 'comment-1',
      updateId: null,
      authorDisplay: 'Backer 12',
      body: 'Does the arm hold at full extension?',
      postedAt: '2026-08-24T10:00:00.000Z',
      mine: false,
    },
  ],
};

const backerSupport: BackerSupportView = {
  topics: [
    { key: 'unknown_charge', label: 'I do not recognise a charge' },
    { key: 'delivery', label: 'A question about delivery' },
  ],
  cases: [
    {
      caseId: 'case-1',
      reference: 'PVD-QA500-QA600',
      topic: 'delivery',
      status: 'open',
      owner: 'Founder',
      openedAt: '2026-09-20T10:00:00.000Z',
      humanResponseDueAt: '2026-09-21T10:00:00.000Z',
      responded: false,
      escalatedAt: null,
      canEscalate: false,
      escalationOpensAt: '2026-10-04T10:00:00.000Z',
    },
  ],
  issuerRights:
    'Nothing here limits the rights you have with your card issuer, including the right to dispute a charge.',
};

/* ── §27.7 the digest preference and the notification history ──────────────── */

const digestPreference: DigestPreferenceView = {
  chosen: false,
  frequency: null,
  chosenAt: null,
  question: 'Would you like a summary email?',
  options: [
    { value: 'off', label: 'No summary email' },
    { value: 'daily', label: 'Once a day' },
    { value: 'weekly', label: 'Once a week' },
  ],
  transactionalNotice:
    'A summary never replaces the emails about your money, your deadlines, or your account.',
};

const notificationHistory: { entries: HistoryEntry[]; nextCursor: string | null } = {
  entries: [
    {
      id: 'nd-1',
      eventKey: 'founder_campaign_live',
      occurredAt: '2026-08-20T15:01:00.000Z',
      state: 'delivered',
      entityType: 'campaign',
      entityId: QA.campaignId,
    },
  ],
  nextCursor: null,
};

/* ── §26 the Admin panel ───────────────────────────────────────────────────── */

const adminIdentity: AdminIdentity = {
  id: 'admin-1',
  name: 'Sam Okafor',
  email: 'sam@proovd.co',
  sessionEstablishedAt: '2026-08-26T15:00:00.000Z',
  prerequisiteKeys: [],
  // §34: the shell renders the mode chip only from what the server reports, so
  // the sweep needs it present to exercise the branch that renders anything.
  environment: {
    stripeMode: 'test',
    stripeApiVersion: '2026-06-30',
    webhooksLastEventAt: '2026-08-26T13:58:00.000Z',
  },
};

/**
 * The same Founder as everywhere else in this file — Rae Harlow, running the
 * one campaign — seen through §26.1's two Admin addresses.
 *
 * Every value the surfaces render arrives resolved, because the payload
 * resolves it: the setup stage, the account standing, the payment-setup phrase,
 * and the attention line are the words the table shows. Nothing here is a code
 * the browser is expected to map, which is the contract `backend/src/founders/
 * types.ts` documents and the reason the fixtures can be this plain.
 */

/* ── The stub table ────────────────────────────────────────────────────────── */

/**
 * Every read the principal flows perform, most specific first.
 *
 * Order matters where one path is a prefix of another — `/api/founder/campaigns`
 * would otherwise answer `/api/founder/campaigns/:id/build`.
 */

/* ── Admin → Money & Fulfillment (§21, §22, §24), added 2026-08-19 ─────────── */

/*
  The same campaign, at the one moment where every tab has something on it: the
  batch has completed, one card failed and recovered inside the window, three of
  the four required reconciliation items are verified, one Creator is finalized
  and not yet transferred, the Founder's first payment is released, one refund is
  classified and one dispute is open.

  A fixture set where every tab was empty would render six panels of honest
  absences and prove nothing about the surface that shows money.
*/


export const QA_ROUTES: StubRoute[] = [
  /*
   * The session read, first — every Founder and Creator address is behind a
   * role guard, so a flow that cannot answer "who is signed in?" renders the
   * guard's waiting state instead of the flow, and §33.11.1's "a surface
   * showing its error state is not the flow" would be silently violated.
   *
   * The role is derived from the flow's own address rather than fixed, for the
   * same reason the rest of these fixtures share ONE campaign: a Creator flow
   * rendered against a Founder session would render a refusal and pass axe
   * with nothing on the page.
   *
   * Admin flows have their own `/api/admin/me` fixture further down; this is
   * the account-level read every role performs.
   */
  {
    match: /\/api\/account\/me$/,
    body: () => ({
      account: {
        role: qaSessionRole(),
        email: 'someone@example.com',
        name: 'Someone',
      },
    }),
  },

  /* Draft (§7, §9, §10) */
  { match: /\/api\/draft\/[^/]+\/vetting$/, body: vetting },
  { match: /\/api\/draft\/[^/]+\/claim$/, body: claim },
  { match: /\/api\/draft\/[^/]+$/, body: draftLanding },

  /* Founder (§12–§22) */
  { match: /\/api\/founder\/campaigns\/[^/]+\/workspace/, body: { workspace } },
  // Screen 16 (2026-08-21). A phone already on file and no date of birth, so
  // the sweep renders the field in both of its two colours — the prompt and a
  // value — rather than only the empty one.
  {
    match: /\/api\/founder\/campaigns\/[^/]+\/details$/,
    body: { details: { name: 'Ada Okafor', phone: '+1 (415) 555-0134', dateOfBirth: null } },
  },
  { match: /\/api\/founder\/campaigns\/[^/]+\/listing$/, body: { listing } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/roster$/, body: { roster } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/build$/, body: build },
  // Session F (§14.3): the openness read. A Product campaign, so the screen
  // renders its three answers rather than §14.3's Idea explanation — the sweep
  // needs the shape with the control on it.
  {
    match: /\/api\/founder\/campaigns\/[^/]+\/fixed-payment-openness$/,
    body: {
      openness: {
        applicable: true,
        campaignType: 'pre_launch',
        stance: null,
        recordedAt: null,
        standardBasePercent: 30,
        withFixedBasePercent: 20,
      },
    },
  },
  { match: /\/api\/founder\/campaigns\/[^/]+\/preview$/, body: { preview } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/review$/, body: { review: latestReview } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/creator-readiness$/, body: { readiness } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/updates$/, body: updates },
  /*
    The dashboard shell's rail (Founder Dashboard Session B). The SAME campaign
    every other fixture describes — §33.11.5's rule: a fixture set where each
    surface invents its own facts cannot notice a disagreement.

    `campaignLiveAt` is set because this campaign HAS been live, and it is what
    unlocks the Live chapter. A fixture that left it null would render a rail
    whose current chapter was locked.

    THE STATUS IS `closed_resolved`, NOT `live`, and that is a correction made
    twice. `founderChapterUnlocked` opens the chapters a campaign has REACHED,
    so with `live` the sweep's `founder_paid` address fell back to Chapter 2
    (Session E) and with `closed_reconciling` `founder_wrap` would have fallen
    back to Chapter 3 (Session F) — §33.11 reporting a chapter as swept while
    rendering a different one, which is §33.11.1's trap ("a surface showing
    something else is not the flow") in its quietest form: nothing errors,
    nothing 404s, and axe runs happily against the wrong page.

    Past chapters stay open, so all four render at their own addresses; the
    guard `qa.test.tsx` gained in Session E walks `PRINCIPAL_FLOWS` for every
    `?chapter=` it addresses and asserts each is unlocked on this fixture, so
    this cannot rot back — it is what caught the Session F case.
  */
  {
    match: /\/api\/founder\/campaigns\/[^/]+\/dashboard$/,
    body: {
      dashboard: {
        campaignId: QA.campaignId,
        status: 'closed_resolved',
        type: 'pre_launch',
        campaignLiveAt: '2026-08-20T17:00:00.000Z',
        campaignCloseAt: QA.closesAt,
        listingPaidAt: '2026-08-01T12:00:00.000Z',
        highEffort: false,
        title: QA.title,
      },
    },
  },
  /* Session D. `/home/explore` and `/home/posts` sit UNDER `/home`, and the
     `$` on that matcher is what keeps it from swallowing them — the ordering
     trap the money console's own comment records. */
  { match: /\/api\/founder\/campaigns\/[^/]+\/home\/explore$/, body: { explore: home.explore } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/home\/posts$/, body: { posts: creatorPosts } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/home$/, body: { home } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/home\/seen$/, body: { acknowledged: true, advanced: true } },
  /* §20's tier register, served exactly as the route serves it: the register
     itself, so the surface can never carry a second copy of which column a
     field is in. */
  { match: /\/api\/founder\/campaigns\/[^/]+\/live-edit\/fields$/, body: { fields: EDITABLE_FIELDS } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/live-edit\/history$/, body: { edits: [], requests: [] } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/results$/, body: { results } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/payments$/, body: { payments: founderPayments } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/fulfillment$/, body: fulfillment },
  { match: /\/api\/founder\/campaigns\/[^/]+\/day-14$/, body: day14 },
  /* Session F. `/backers/export` sits UNDER `/backers`, and the `$` on the
     second matcher is what keeps it from swallowing the first — the ordering
     trap `/home/explore` already records above. */
  { match: /\/api\/founder\/campaigns\/[^/]+\/backers\/export$/, body: '' },
  { match: /\/api\/founder\/campaigns\/[^/]+\/backers$/, body: { backers: founderBackers } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/wrap$/, body: { wrap: founderWrap } },
  /* Session G. Account-level: no campaign id in the path, and no overlap with
     the campaign-scoped matchers above it. */
  { match: /\/api\/founder\/settings$/, body: { settings: founderSettings } },
  { match: /\/api\/founder\/notifications\/preferences$/, body: { preference: digestPreference } },
  { match: /\/api\/founder\/notifications\/history/, body: { history: notificationHistory } },
  { match: /\/api\/founder\/campaigns$/, body: { campaigns: [{ campaignId: QA.campaignId, status: 'live', type: 'pre_launch', listingPaid: true, highEffort: false }] } },
  { match: /\/api\/founder\/payouts/, body: { payouts: payoutState } },

  /* Creator (§11, §14, §18, §21) */
  { match: /\/api\/affiliate-invitation\/[^/]+\/payout$/, body: { status: 'not_started', connectedAccountId: null, requirements: null, updatedAt: null, onboardingAvailable: false } },
  { match: /\/api\/affiliate-invitation\/[^/?]+(\?.*)?$/, body: creatorInvitation },
  { match: /\/api\/creator\/home$/, body: { home: creatorHome } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/opportunity$/, body: { opportunity, content: pitchContent } },
  { match: /\/api\/creator\/pitches(\?.*)?$/, body: { pitches: creatorPitchList, sort: 'deadline' } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/partnership$/, body: { partnership } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/close$/, body: { close: creatorClose } },
  { match: /\/api\/creator\/campaigns\/[^/?]+(\?.*)?$/, body: { kit: { associationId: QA.associationId, campaignId: QA.campaignId, campaignStatus: 'preparing', associationStatus: 'preparing', founder: { name: QA.founderDisplayName, entity: QA.founderLegalName, soleProprietor: false }, productName: QA.title, problem: 'Benches are badly lit.', solution: 'A clamp lamp that holds its position.', competition: 'Two incumbents at US$300.', campaignType: 'pre_launch', notYetAvailable: [{ item: 'Reward packages', because: 'The Founder has not built them yet.' }], workPermitted: false, decisionsAvailable: false } } },
  { match: /\/api\/creator\/campaigns$/, body: { campaigns: [{ associationId: QA.associationId, campaignId: QA.campaignId, productName: QA.title, status: 'active', revealedAt: '2026-08-03T10:00:00.000Z', revoked: false, reviewAvailable: true }] } },
  { match: /\/api\/creator\/earnings$/, body: { earnings: creatorOwnEarnings } },
  { match: /\/api\/creator\/resources$/, body: { resources: creatorResources } },
  { match: /\/api\/creator\/settings$/, body: { settings: creatorSettings } },
  { match: /\/api\/creator\/notifications\/preferences$/, body: { preference: digestPreference } },
  { match: /\/api\/creator\/notifications\/history/, body: { history: notificationHistory } },
  { match: /\/api\/creator\/payouts/, body: { payouts: { ...payoutState, stripeAccountId: 'acct_qa2' } } },

  /* Public campaign, checkout, and the magic link (§18, §19, §20) */
  { match: /\/api\/campaign\/[^/]+\/checkout\/quote$/, body: QA_QUOTE },
  { match: /\/api\/campaign\/[^/]+\/preorder$/, body: QA_PREORDER_SUCCESS },
  { match: /\/api\/campaign\/[^/?]+(\?.*)?$/, body: liveCampaign },
  { match: /\/api\/link\/[^/]+\/page$/, body: backerPage },
  { match: /\/api\/link\/[^/]+\/comments/, body: { thread: commentThread } },
  { match: /\/api\/link\/[^/]+\/support$/, body: backerSupport },
  { match: /\/api\/link\/[^/]+\/digest-preference$/, body: { preference: digestPreference } },

  { match: /\/api\/admin\/me$/, body: adminIdentity },
  /* The Tasks panel (2026-08-16) mounts inside AdminFrame, so EVERY Admin flow
     performs this read the moment the shell renders. One list, nothing in it —
     the launcher shows no badge and the sweep's flows are undisturbed. */
  {
    match: /\/api\/admin\/tasks$/,
    body: {
      lists: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          name: 'My tasks',
          createdBy: 'admin-1',
          createdByName: 'Alex Admin',
          openCount: 0,
        },
      ],
      tasks: [],
    },
  },
];
