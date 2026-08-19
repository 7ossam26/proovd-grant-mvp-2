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

import {
  CREATOR_MATCH_CAVEAT,
  IDENTITY_CHECK_HELPER,
  SUMMARY_IS_NOT_ADMIN_WRITABLE,
  SUMMARY_NOT_CHOSEN_LABEL,
} from '@proovd/shared';
import type {
  AdminIdentity,
  DraftLanding,
  FounderListRow,
  FounderWorkspaceDetail,
} from '../admin/api.js';
import type { ClaimView, CreatorSignal, VettingState } from '../../surfaces/draft/api.js';
import type {
  BuildState,
  CampaignHomeView,
  CampaignPreview,
  Day14ChecklistView,
  FounderPaymentStatusView,
  FounderReadiness,
  FounderResultsView,
  FounderUpdatesView,
  FulfillmentStatusView,
  LatestReview,
  ListingState,
  RosterView,
  WorkspaceState,
} from '../../surfaces/founder/api.js';
import {
  APPENDIX_C_STEP_KEYS,
  BEST_EFFORT_RECOVERY_SENTENCE,
  COMPLETION_OUTCOMES,
  DISPUTE_EVIDENCE_ITEMS,
  EARLY_RELEASE_EVIDENCE_FACTS,
  FOUNDER_PAYMENT_STATUS_FACTS,
  IDEA_REFUND_EXCEPTIONS,
  LIVE_MODE_CONDITIONS,
  PROOVD_FEE_TREATMENTS,
  RECONCILIATION_ITEMS,
  REFUND_CAUSES,
  RESULTS_NARRATIVE_FIELDS,
  THANK_YOU_ELIGIBILITY_FACTS,
  TODAY_SOURCES,
} from '@proovd/shared';
import type { PayoutState } from '../../surfaces/payouts/PayoutOnboarding.js';
import type {
  CreatorCloseView,
  CreatorInvitationState,
  CreatorPartnership,
  FormalOpportunity,
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
import type {
  CloseQueueView,
  CloseRecordView,
  CreatorEarningsView,
  Day14QueueView,
  DisputeQueueView,
  FulfillmentView as MoneyFulfillmentView,
  RefundQueueView,
} from '../admin/money/api.js';
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

/**
 * §10's relevance signal (Founder Flow v2 Session C).
 *
 * `available` with a positive count, because the sweep has to render the hero
 * and the six disclosures. The other state — zero AND unrecorded, which the
 * server collapses into one answer before serializing — is asserted in the
 * flow suite by comparing the two rendered outputs.
 */
const creatorSignal: CreatorSignal = {
  status: 'available',
  count: 3,
  recordedAt: '2026-08-05T09:10:00.000Z',
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
        awaitingYou: true,
        bidTotalPercent: 24,
        fixedPaymentRequestCents: '50000',
        note: 'Asked for 24% and a fixed payment.',
      },
      lockedTerms: null,
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
  outcome: 'open',
  decisionDueAt: '2026-09-26T17:00:00.000Z',
  blocksAPayment: true,
  enforcementOnly: false,
  submissions: [],
  clarifications: [],
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
const founderRow: FounderListRow = {
  prospectId: QA.prospectId,
  recordReference: 'F-7K3MQ',
  legalName: 'Rae Harlow',
  preferredName: 'Rae',
  email: 'rae@harlow.example',
  productName: QA.title,
  businessName: QA.founderLegalName,
  owner: 'Sam Okafor',
  typeLabel: 'Product',
  lifecycle: 'Live · Day 6',
  adminAction: {
    kind: 'due',
    label: 'Payment setup is complete, but the W-9 has not been requested for this campaign yet.',
  },
  founderAction: { kind: 'none', label: 'Waiting on Proovd' },
  filters: ['all', 'needs_admin', 'live'],
  searchText: 'rae harlow rae@harlow.example the bench lamp sam okafor live',
  setup: { stage: 'Setup complete', detail: null },
  account: 'Active',
  paymentSetup: 'Complete',
  currentCampaign: { campaignId: QA.campaignId, name: QA.title, status: 'Live' },
  attention: {
    needed: true,
    text: 'Payment setup is complete, but the W-9 has not been requested for this campaign yet.',
    action: { label: 'Open the money record', act: 'jump-money' },
  },
};

const founderWorkspace: FounderWorkspaceDetail = {
  header: {
    prospectId: QA.prospectId,
    legalName: 'Rae Harlow',
    preferredName: 'Rae',
    businessName: QA.founderLegalName,
    website: 'https://example.com/harlow',
    email: 'rae@harlow.example',
    phone: '+1 555 0100',
    phoneVerified: false,
    state: 'NY',
    country: 'US',
    sticker: 7,
    recordReference: 'F-7K3MQ',
    typeChip: 'Product · locked',
    lifecycle: 'Live · Day 6',
    adminAction: founderRow.adminAction,
    founderAction: founderRow.founderAction,
    account: 'Active',
    setup: { stage: 'Setup complete', detail: null },
    paymentSetup: 'Complete',
    currentCampaign: { campaignId: QA.campaignId, name: QA.title, status: 'Live' },
    attention: founderRow.attention,
    availableActions: ['edit', 'newinvite', 'cancelinvite', 'suspend', 'ban'],
  },
  overview: {
    invitation: {
      state: 'Invite accepted',
      stateAt: 'Accepted Aug 2, 2026 · 12:10 PM',
      meaning: 'Rae used the invitation and completed the account-claim step.',
      invitedBy: 'Sam Okafor',
      source: 'Proovd research',
      owner: 'Sam Okafor',
      overrides: [
        {
          key: 'recipientName',
          label: 'Recipient name',
          value: 'Rae Harlow',
          profileValue: 'Rae Harlow',
          overridden: false,
          helper: 'Automatically filled from Rae’s Founder profile.',
        },
        {
          key: 'recipientEmail',
          label: 'Recipient email',
          value: 'rae@harlow.example',
          profileValue: 'rae@harlow.example',
          overridden: false,
          helper: 'Automatically filled from Rae’s Founder profile.',
        },
        {
          key: 'product',
          label: 'Product',
          value: QA.title,
          profileValue: QA.title,
          overridden: false,
          helper: 'Automatically filled from Rae’s Founder profile.',
        },
      ],
      content: [
        {
          key: 'invKnow',
          label: 'What we know so far',
          value: 'A machined desk lamp for people who solder at their kitchen table.',
          helper: null,
        },
        {
          key: 'invFit',
          label: 'Why we think they could be a fit',
          value: 'They already sell direct and answer their own support email.',
          helper: null,
        },
        {
          key: 'invTime',
          label: 'Estimated time to get started',
          value: 'About 20 minutes',
          helper: 'This must reflect the actual expected effort.',
        },
      ],
      fixedContent: [
        {
          key: 'invNext',
          label: 'What happens next',
          value:
            'You answer four questions, a person at Proovd reads them, and we tell you either way.',
        },
        {
          key: 'invSupport',
          label: 'Support contact',
          value: 'support@proovd.co',
        },
      ],
      unresolvedMarkers: [],
      missingBeforeSend: [],
      canSend: false,
      history: [
        {
          at: 'Aug 1, 2026 · 9:00 AM',
          title: 'Invitation sent',
          body: 'Sent to rae@harlow.example by Sam Okafor.',
        },
      ],
      technical:
        'Token version 1 · expires Aug 15, 2026. The link value itself is never stored and cannot be shown again.',
      facts: {
        sendCount: 1,
        tokenVersion: 1,
        expiration: 'Link inactive',
        claimed: 'Recorded Aug 2, 2026 · 12:10 PM',
        revoked: false,
      },
    },
    vetting: {
      progress: [
        { label: 'Problem', done: true },
        { label: 'Solution', done: true },
        { label: 'Amount of views', done: true },
      ],
      progressStatus: '3 of 3 questions completed',
      campaignType: 'Product Campaign',
      campaignTypeAt: 'Aug 1, 2026 · 10:00 AM',
      campaignTypeSelected: 'Product Campaign',
      campaignTypeSelectedRaw: 'pre_launch',
      campaignTypeEditable: false,
      draftId: QA.draftId,
      answers: [
        {
          key: 'problem',
          label: 'Problem',
          text: 'Hobby electronics benches are lit by ceiling lights that cast a shadow over the board.',
          provenance: 'Originally prepared by Proovd · Last edited by Rae',
          editable: false,
        },
        {
          key: 'solution',
          label: 'Solution',
          text: 'A clamp lamp with a 96 CRI head and a magnetic arm that holds its position.',
          provenance: 'Written by Rae',
          editable: false,
        },
        {
          key: 'views',
          label: 'Amount of views',
          text: '10,000 – 100,000',
          provenance: 'Chosen by Rae',
          editable: false,
        },
      ],
      lastSaved: 'Aug 1, 2026 · 9:42 AM',
      creatorMatches: { count: 12, recordedAt: 'Aug 2, 2026 · 12:00 PM' },
    },
    accountCreatedAt: 'Aug 2, 2026 · 12:10 PM',
    signInMethod: 'Email and password',
  },
  details: {
    personal: [
      { key: 'preferred', label: 'Preferred name', value: 'Rae', helper: null, editable: true },
      { key: 'legal', label: 'Legal name', value: 'Rae Harlow', helper: null, editable: true },
      { key: 'email', label: 'Email', value: 'rae@harlow.example', helper: null, editable: true },
      {
        key: 'phone',
        label: 'Phone',
        value: '+1 555 0100',
        helper: 'Phone number has not been verified, and the MVP has no way to verify one.',
        editable: true,
      },
      { key: 'state', label: 'State', value: 'NY', helper: null, editable: true },
    ],
    business: [
      {
        key: 'bizLegal',
        label: 'Legal business name',
        value: QA.founderLegalName,
        helper:
          'Auto-fills invitations and campaigns. Sent and accepted records keep the wording they used.',
        editable: true,
      },
      { key: 'bizType', label: 'Business type', value: 'LLC', helper: null, editable: true },
      { key: 'product', label: 'Product / startup name', value: QA.title, helper: null, editable: true },
      {
        key: 'website',
        label: 'Website',
        value: 'https://example.com/harlow',
        helper: null,
        editable: true,
      },
    ],
    preferences: [
      {
        key: 'summary',
        label: 'Activity summary',
        value: SUMMARY_NOT_CHOSEN_LABEL,
        helper: SUMMARY_IS_NOT_ADMIN_WRITABLE,
        editable: false,
      },
    ],
    standing: {
      value: 'Active',
      detail: 'No enforcement action has ever been recorded against this Founder.',
      owner: null,
      startedAt: null,
      nextReviewAt: null,
    },
    ban: null,
    deletionRequest: null,
  },
  campaigns: {
    current: {
      campaignId: QA.campaignId,
      name: QA.title,
      type: 'Product Campaign',
      status: 'Live',
      rawStatus: 'live',
      buildStatus: 'Complete',
      rosterReadiness: 'Ready to launch',
      review: { outcome: 'Approved', why: null },
      listing: 'Listing fee paid Aug 5, 2026',
      opensAt: 'Aug 20, 2026 · 3:00 PM',
      closesAt: 'Sep 12, 2026 · 5:00 PM',
      issue: null,
    },
    previous: [],
    next: null,
  },
  money: {
    setup: {
      value: 'Complete',
      body: 'Stripe has everything it needs to charge Backers on Rae’s account and to pay Rae.',
      action: null,
    },
    identity: { value: 'Verified by Stripe', helper: IDENTITY_CHECK_HELPER },
    stripe: {
      accountId: 'acct_qa_founder',
      requirements: 'Nothing outstanding',
      lastUpdated: 'Aug 10, 2026 · 10:00 AM',
      capability: 'Charges and payouts enabled',
    },
    listings: [
      {
        campaignId: QA.campaignId,
        campaignName: QA.title,
        lines: [
          { label: 'Base listing fee', amount: 'US$35.00', sub: false },
          { label: 'Optional item discount', amount: '−US$4.00', sub: true },
          { label: 'Sales tax', amount: 'US$2.56', sub: true },
          { label: 'Charged', amount: 'US$33.56', sub: false },
        ],
        status: 'Paid Aug 5, 2026',
      },
    ],
    w9: {
      value: 'Not requested yet',
      line: 'A W-9 is requested once the campaign closes and something has actually been captured.',
      action: null,
    },
    payments: {
      populated: false,
      waitingOn: 'The campaign has not closed, so no Founder payment exists to show.',
      value: null,
    },
    blockers: [],
    pricing: null,
  },
  history: [
    {
      category: 'invite',
      at: 'Aug 1, 2026 · 9:00 AM',
      occurredAt: '2026-08-01T09:00:00.000Z',
      title: 'Invitation sent',
      body: 'Sent to rae@harlow.example by Sam Okafor.',
      reason: null,
      audit: null,
      source: 'campaign_invitation_sends',
    },
    {
      category: 'account',
      at: 'Aug 2, 2026 · 12:10 PM',
      occurredAt: '2026-08-02T12:10:00.000Z',
      title: 'Founder account created',
      body: 'Rae accepted the Terms, the Founder Acceptable Use Policy, and the Privacy Policy.',
      reason: null,
      audit: null,
      source: 'policy_consents',
    },
    {
      category: 'admin',
      at: 'Aug 2, 2026 · 12:00 PM',
      occurredAt: '2026-08-02T12:00:00.000Z',
      title: 'Creator relevance signal recorded',
      body: CREATOR_MATCH_CAVEAT,
      reason: 'Recorded after reviewing twelve channels in this niche.',
      audit: {
        by: 'Sam Okafor',
        field: 'possible_creator_results.count',
        priorValue: 'Not recorded',
        newValue: '12',
        reason: 'Recorded after reviewing twelve channels in this niche.',
        evidence: 'Research notes filed with the prospect record.',
        at: '2026-08-02T12:00:00.000Z',
      },
      source: 'possible_creator_results',
    },
  ],
  discovery: {
    fields: [
      { key: 'invitationSource', label: 'Discovery source', value: 'Proovd research', helper: null },
      { key: 'internalOwner', label: 'Internal owner', value: 'Sam Okafor', helper: null },
      { key: 'adminNotes', label: 'Internal notes', value: null, helper: null },
      { key: null, label: 'Last contact', value: null, helper: 'A record, never a schedule (§30).' },
    ],
    research: [],
    meetingNotes: [],
  },
  eligibility: {
    claim: {
      inviteClaimed: true,
      claimedAt: 'Aug 2, 2026 · 12:10 PM',
      accountCreatedAt: 'Aug 2, 2026 · 12:10 PM',
      completion: 'Complete',
      connectedRecord: 'F-7K3MQ',
    },
    facts: {
      dobSupplied: true,
      age18Plus: true,
      usPerson: true,
      location: 'NY · US',
      sanctionsClear: true,
    },
    acknowledgements: [
      { label: 'Terms of Service', version: 'v1.0', acceptedAt: 'Aug 2, 2026 · 12:10 PM' },
      {
        label: 'Founder Acceptable Use Policy',
        version: 'v1.0',
        acceptedAt: 'Aug 2, 2026 · 12:10 PM',
      },
    ],
    acknowledgementsAbsent: null,
  },
  campaignFacts: {
    campaignId: QA.campaignId,
    campaignDay: 6,
    liveAt: 'Aug 7, 2026 · 4:00 PM UTC',
    closesAt: QA.chargeTimeUtc,
    discoveryOpenedAt: null,
    activeBackers: 105,
    threshold: null,
    activeAffiliates: 2,
    publicUrl: `/campaign/${QA.campaignId}`,
  },
  operations: {
    campaignId: QA.campaignId,
    campaignName: QA.title,
    typeLabel: 'Product',
    statusLabel: 'Live',
    content: {
      fields: [
        { label: 'Title', value: QA.title },
        { label: 'Dates', value: 'Aug 7, 2026 → Aug 20, 2026' },
        { label: 'Brand voice', value: 'Direct, calm, specific.' },
        { label: 'Required wording', value: 'Pre-order saved — you were not charged.' },
        { label: 'Prohibited claims', value: null },
        { label: 'Community', value: null },
        { label: 'Hero preference', value: 'Product interface in use' },
        { label: 'Story', value: 'A field synth built for quiet rooms.' },
        { label: 'Delivery window', value: 'November 2026' },
        { label: 'Risks / challenges', value: 'Early workflows may change.' },
      ],
      rewards: [
        {
          title: QA.rewardTitle,
          price: 'US$120.00',
          contents: 'Early access to the instrument',
          delivery: 'November 2026',
        },
      ],
      faqs: [{ question: 'Can I cancel?', answer: 'Yes, at any time before close.' }],
    },
    review: {
      buildStatus: 'complete',
      rosterReadiness: 'launch_ready',
      rounds: [
        { round: 1, outcome: 'approved', submittedAt: 'Aug 1, 2026 · 9:00 AM UTC', decidedAt: 'Aug 2, 2026 · 3:00 PM UTC' },
      ],
      feedback: [],
      approvedAt: 'Aug 2, 2026 · 3:00 PM UTC',
    },
    live: {
      isLive: true,
      liveAt: 'Aug 7, 2026 · 4:00 PM UTC',
      campaignDay: 6,
      closesAt: 'Aug 20, 2026',
      discovery: 'Known links only',
      publicUrl: `/campaign/${QA.campaignId}`,
      created: 110,
      active: 105,
      canceled: 5,
      validClicks: 2835,
      conversion: '3.7%',
      reservedSubtotal: 'US$12,600.00',
      updatesCount: 2,
      commentsCount: 3,
      threshold: null,
    },
    page: {
      updates: [
        {
          title: 'Week one: what we learned',
          audience: 'Public',
          publishedAt: 'Aug 12, 2026 · 12:40 PM UTC',
          body: '105 people have reserved so far.',
          materialChange: false,
        },
      ],
      updatesCount: 2,
      comments: [
        {
          author: 'Backer 427',
          body: 'Would a browser extension be in the first release?',
          postedAt: 'Aug 12, 2026 · 1:00 PM UTC',
          state: 'Visible',
        },
      ],
      commentsCount: 3,
      openFlags: 0,
    },
    roster: [
      {
        associationId: 'assoc-qa-1',
        prospectId: 'creator-prospect-qa-1',
        name: 'Open Field Notes',
        handle: 'openfieldnotes',
        statusLabel: 'Active',
        terms: '35% locked',
        launchRequired: true,
        backers: 41,
        validClicks: 1758,
        completion: null,
        workAgain: null,
      },
    ],
    rosterCounts: { total: 1, backersBroughtIn: 41, validClicks: 2835 },
    workAgain: [],
    demand: {
      split: [
        { label: 'Affiliate traffic', clicks: 2835, backers: 41 },
        { label: 'Direct & organic', clicks: 0, backers: 64 },
      ],
    },
    responses: {
      total: 82,
      rows: [
        {
          backer: 'Backer 427',
          reward: QA.rewardTitle,
          status: 'Active',
          why: 'I need a calmer place for unfinished research threads.',
          recommend: 4,
          consent: 'Aggregate only',
        },
      ],
    },
    backerRows: {
      total: 110,
      rows: [
        {
          backer: 'Backer 427',
          reward: QA.rewardTitle,
          createdAt: 'Aug 12, 2026',
          status: 'reserved active',
          attribution: '@openfieldnotes',
          caseRef: null,
          caseId: null,
        },
      ],
    },
    close: {
      scheduledClose: 'Aug 20, 2026',
      batch: null,
      finalActive: null,
      canceledExcluded: null,
      captureState: 'Not due — the campaign has not closed',
      retryWindow: null,
      reconciliation: 'Waiting for close',
      resultsPreparedAt: null,
      idea: null,
    },
    fulfillment: {
      available: false,
      waitingOn:
        'Delivery evidence, the Day-14 review, and missed-commitment records exist only after the lifecycle reaches fulfillment.',
      mechanism: null,
      deliveredAt: null,
      obligations: [],
      commitments: [],
      day14: null,
    },
    refunds: {
      openRefunds: 0,
      totalRefunds: 0,
      openDisputes: 0,
      totalDisputes: 0,
      recoveryRecords: 0,
    },
    supportCases: [],
    cancellation: null,
    enforcement: { campaignActions: [] },
  },
  communications: {
    total: 2,
    rows: [
      {
        eventKey: 'founder_invitation',
        target: 'rae@harlow.example',
        at: 'Jul 22, 2026 · 3:10 PM UTC',
        state: 'Delivered',
      },
      {
        eventKey: 'founder_listing_fee_receipt',
        target: 'rae@harlow.example',
        at: 'Aug 4, 2026 · 1:22 PM UTC',
        state: 'Delivered',
      },
    ],
  },
  historyCounts: { invite: 1, account: 1, campaign: 0, money: 0, support: 0, admin: 1, enforcement: 0 },
};

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

const closeQueue: CloseQueueView = {
  operations: {
    incomplete: [],
    retryWindow: [],
    reconciling: [
      {
        campaignId: QA.campaignId,
        campaignStatus: 'closed_reconciling',
        requiredItemsVerified: 3,
        requiredItemsTotal: 4,
        resultsPrepared: false,
      },
    ],
  },
  reconciliationItems: RECONCILIATION_ITEMS.map((item) => ({
    key: item.key,
    spec: item.spec,
    evaluation: item.evaluation,
    requiredForResults: item.requiredForResults,
    waitsOn: item.waitsOn,
  })),
  narrativeFields: RESULTS_NARRATIVE_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
  })),
};

const closeRecord: CloseRecordView = {
  detail: {
    campaignId: QA.campaignId,
    campaignStatus: 'closed_reconciling',
    batch: {
      status: 'completed',
      startedAt: QA.closesAt,
      completedAt: '2026-09-12T17:04:00.000Z',
      thresholdDecision: { met: true, unique: 44, required: 40 },
      retryWindowHours: 48,
      firstFailureAt: '2026-09-12T17:02:00.000Z',
      retryDeadlineAt: '2026-09-14T17:02:00.000Z',
    },
    reservationsByStatus: { captured: 43, capture_failed_dropped: 1 },
    attempts: [
      {
        reservationId: QA.reservationId,
        attemptNumber: 1,
        idempotencyKey: `reservation-capture:${QA.reservationId}:1`,
        amountCents: '12990',
        outcome: 'succeeded',
        paymentIntentId: 'pi_qa_1',
        requestedAt: QA.closesAt,
        resolvedAt: '2026-09-12T17:00:04.000Z',
      },
    ],
  },
  reconciliation: {
    campaignId: QA.campaignId,
    campaignStatus: 'closed_reconciling',
    open: true,
    openReason: null,
    items: RECONCILIATION_ITEMS.map((item, index) => ({
      key: item.key,
      spec: item.spec,
      evaluation: item.evaluation,
      requiredForResults: item.requiredForResults,
      derived: item.evaluation === 'app' ? { captured: 43, dropped: 1 } : null,
      waitsOn: item.waitsOn,
      latest:
        item.requiredForResults && index < 3
          ? {
              result: 'verified',
              note: 'Compared the capture ledger against the batch record; the counts agree.',
              actor: 'user:admin-1',
              recordedAt: '2026-09-15T09:00:00.000Z',
            }
          : null,
      history: [],
    })),
    resultsPrepared: false,
  },
};

const creatorEarnings: CreatorEarningsView = {
  creators: [
    {
      associationId: QA.associationId,
      associationStatus: 'active',
      publicHandle: '@maren.builds',
      email: 'maren@example.com',
      attributedCaptured: 12,
      validSubtotalCents: '144000',
      latestDecision: {
        id: 'decision-qa-1',
        outcome: 'complete_verified',
        deliverablesNote: 'Three compliant posts, all with the disclosure, verified against the ledger.',
        decidedBy: 'user:admin-1',
        decidedAt: '2026-09-15T10:00:00.000Z',
      },
      earnings: {
        id: 'earnings-qa-1',
        state: 'approved_for_transfer',
        earnedPercent: 20,
        commissionCents: '28800',
        bonusCents: '0',
        eligibleFixedCents: '0',
        provisionalTotalCents: '36000',
        earnedTotalCents: '28800',
        unearnedReturnedCents: '7200',
        approvedBy: 'user:admin-1',
      },
      transfer: null,
      allocation: null,
      thankYou: [],
      transferEarliestAt: '2026-09-15T17:00:00.000Z',
    },
  ],
  completionOutcomes: COMPLETION_OUTCOMES.map((outcome) => ({
    key: outcome.key,
    spec: outcome.spec,
    fixedDisposition: outcome.fixedDisposition,
    commissionDisposition: outcome.commissionDisposition,
  })),
  thankYouEligibilityFacts: THANK_YOU_ELIGIBILITY_FACTS.map((fact) => ({
    key: fact.key,
    label: fact.label,
  })),
};

const refundQueue: RefundQueueView = {
  cases: [
    {
      refundId: 'refund-qa-1',
      reference: 'RF-QA123-456XY',
      reservationId: QA.reservationId,
      campaignId: QA.campaignId,
      status: 'succeeded',
      amountCents: '12990',
      ideaExceptionReason: null,
      cause: 'founder_or_product',
      affiliateTreatment: 'earnings_remain',
      proovdFeeTreatment: 'retained',
      affiliateInvalidCents: null,
      founderLiabilityCents: '12990',
      evidence: 'The Founder confirmed the walnut finish was unavailable for this order.',
      mandate: null,
      recoveryNote: null,
      decidedBy: 'user:admin-1',
      failureMessage: null,
      providerRefundId: 're_qa_1',
      createdAt: '2026-09-16T11:00:00.000Z',
    },
  ],
  unreconciled: [],
  bestEffortRecovery: BEST_EFFORT_RECOVERY_SENTENCE,
  causes: REFUND_CAUSES.map((cause) => ({
    key: cause.key,
    label: cause.label,
    specRef: cause.specRef,
    allocation: cause.allocation,
    permittedAffiliateTreatments: cause.permittedAffiliateTreatments,
    requiresMandate: cause.requiresMandate,
  })),
  ideaExceptions: IDEA_REFUND_EXCEPTIONS.map((entry) => ({
    key: entry.key,
    label: entry.label,
  })),
  proovdFeeTreatments: [...PROOVD_FEE_TREATMENTS],
};

const disputeQueue: DisputeQueueView = {
  disputes: [
    {
      disputeId: 'dispute-qa-1',
      providerDisputeId: 'dp_qa_1',
      campaignId: QA.campaignId,
      reservationId: QA.reservationId,
      status: 'needs_response',
      amountCents: '12990',
      reasonCode: 'product_not_received',
      openedAt: '2026-09-17T08:00:00.000Z',
      taskDueAt: '2026-09-18T08:00:00.000Z',
      taskOverdue: false,
      providerEvidenceDueBy: '2026-09-24T08:00:00.000Z',
      classified: false,
      allocationId: null,
      evidenceAssembledAt: null,
      closedAt: null,
    },
  ],
  evidenceItems: DISPUTE_EVIDENCE_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    required: item.required,
  })),
  causes: refundQueue.causes,
  proovdFeeTreatments: refundQueue.proovdFeeTreatments,
  bestEffortRecovery: BEST_EFFORT_RECOVERY_SENTENCE,
};

const moneyFulfillment: MoneyFulfillmentView = {
  fulfillment,
  day14,
  ghostBan: {
    triggersMet: [],
    labels: {},
    alreadyBanned: false,
    requiredFields: ['trigger', 'evidence', 'notice', 'decidedBy', 'decidedAt'],
    permanentSentence: 'A ghost ban is permanent. There is no path that lifts it.',
    triggers: [
      { key: 'failed_day_14', label: 'The Day 14 Progress Check failed', met: false },
      { key: 'no_delivery_no_communication', label: 'No delivery and no communication', met: false },
    ],
  },
};

const day14Queue: Day14QueueView = {
  queue: [
    {
      campaignId: QA.campaignId,
      campaignTitle: QA.title,
      campaignType: 'pre_launch',
      reviewId: 'review-qa-1',
      dueAt: '2026-09-26T17:00:00.000Z',
      overdue: false,
      outcome: 'open',
      submissionCount: 1,
      latestSubmissionAt: '2026-09-25T12:00:00.000Z',
      openClarifications: 0,
      overdueClarifications: 0,
      daysSinceLastUpdate: 2,
      noSubstantiveUpdateInSevenDays: false,
      blocksAPayment: true,
    },
  ],
  failureReasons: [
    { key: 'no_adequate_progress', label: 'No adequate progress evidence' },
    { key: 'no_required_communication', label: 'The required communication was not sent' },
  ],
};

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
  { match: /\/api\/draft\/[^/]+\/creator-signal$/, body: creatorSignal },
  { match: /\/api\/draft\/[^/]+\/claim$/, body: claim },
  { match: /\/api\/draft\/[^/]+$/, body: draftLanding },

  /* Founder (§12–§22) */
  { match: /\/api\/founder\/campaigns\/[^/]+\/workspace/, body: { workspace } },
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
  { match: /\/api\/founder\/campaigns\/[^/]+\/home$/, body: { home } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/home\/seen$/, body: { acknowledged: true, advanced: true } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/results$/, body: { results } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/payments$/, body: { payments: founderPayments } },
  { match: /\/api\/founder\/campaigns\/[^/]+\/fulfillment$/, body: fulfillment },
  { match: /\/api\/founder\/campaigns\/[^/]+\/day-14$/, body: day14 },
  { match: /\/api\/founder\/notifications\/preferences$/, body: { preference: digestPreference } },
  { match: /\/api\/founder\/notifications\/history/, body: { history: notificationHistory } },
  { match: /\/api\/founder\/campaigns$/, body: { campaigns: [{ campaignId: QA.campaignId, status: 'live', type: 'pre_launch', listingPaid: true, highEffort: false }] } },
  { match: /\/api\/founder\/payouts/, body: { payouts: payoutState } },

  /* Creator (§11, §14, §18, §21) */
  { match: /\/api\/affiliate-invitation\/[^/]+\/payout$/, body: { status: 'not_started', connectedAccountId: null, requirements: null, updatedAt: null, onboardingAvailable: false } },
  { match: /\/api\/affiliate-invitation\/[^/?]+(\?.*)?$/, body: creatorInvitation },
  { match: /\/api\/creator\/home$/, body: { home: creatorHome } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/opportunity$/, body: { opportunity } },
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

  /* Today (§26) — the overview, in the state that renders every row: two
     lapsed deadlines and two pieces of open work nobody is late for. A cleared
     fixture would sweep the done-moment and never render a count. */
  {
    match: /\/api\/admin\/today$/,
    body: {
      counts: [
        { key: 'support_overdue', count: 2, kind: 'overdue' },
        { key: 'dispute_tasks', count: 1, kind: 'overdue' },
        { key: 'close_incomplete', count: 0, kind: 'overdue' },
        { key: 'retry_window', count: 1, kind: 'waiting' },
        { key: 'day_14_overdue', count: 0, kind: 'overdue' },
        { key: 'reconciling', count: 3, kind: 'waiting' },
      ],
      clear: false,
      overdueTotal: 3,
      sourceKeys: TODAY_SOURCES.map((s) => s.key),
    },
  },

  /* Admin (§26.1) — the session, every Founder, and one Founder's workspace */
  { match: /\/api\/admin\/me$/, body: adminIdentity },
  { match: /\/api\/admin\/founders\/[^/?]+(\?.*)?$/, body: founderWorkspace },
  { match: /\/api\/admin\/founders(\?.*)?$/, body: { founders: [founderRow] } },
  /* §34's gate, in the state this product is actually in: shut, with ten of
     eleven conditions unsatisfied and no pilot. The sweep asserts there is no
     control on the page that could open it, so the shut state is the one that
     has to render. */
  {
    match: /\/api\/admin\/live-mode$/,
    body: {
      gate: {
        open: false,
        blockingKeys: LIVE_MODE_CONDITIONS.filter((c) => c.key !== 'key_separation').map(
          (c) => c.key,
        ),
        conditions: LIVE_MODE_CONDITIONS.map((c) => ({
          key: c.key,
          verification: c.verification,
          satisfied: c.key === 'key_separation',
          detail:
            c.key === 'key_separation'
              ? 'The environment separates test from live, and this process is in test mode.'
              : 'No answer has been filed for this condition. An unanswered condition is unsatisfied.',
          filedAnswer: null,
        })),
      },
      pilot: null,
      appendixC: { passed: [], failed: [], unwalked: [...APPENDIX_C_STEP_KEYS] },
      stripeMode: 'test',
      approvalCopyState: 'conditional_copy_is_correct',
    },
  },
  /* The §21/§22/§24 money console (2026-08-19). Specific paths first: the
     record's own reads sit UNDER `/api/admin/close/:id`, so a bare
     `/api/admin/close` matcher placed above them would swallow every one. */
  { match: /\/api\/admin\/close\/[^/?]+\/earnings$/, body: creatorEarnings },
  { match: /\/api\/admin\/close\/[^/?]+\/founder-payments$/, body: { status: founderPayments, requests: [], evidenceFacts: EARLY_RELEASE_EVIDENCE_FACTS, statusFacts: FOUNDER_PAYMENT_STATUS_FACTS } },
  { match: /\/api\/admin\/close\/[^/?]+$/, body: closeRecord },
  { match: /\/api\/admin\/close$/, body: closeQueue },
  { match: /\/api\/admin\/refunds(\?.*)?$/, body: refundQueue },
  { match: /\/api\/admin\/disputes(\?.*)?$/, body: disputeQueue },
  { match: /\/api\/admin\/fulfillment\/day-14$/, body: day14Queue },
  { match: /\/api\/admin\/fulfillment\/campaigns\/[^/?]+$/, body: moneyFulfillment },
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
