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

import type { Scoreboard } from '../admin/api.js';
import type { DraftLanding, PrerequisitePanel, FounderRow, AdminIdentity, SettingState, AffiliateRegistry, LedgerPageState, MoneyPanelState, RiskPanelState, SupportQueueState, CloseOperationsState, RefundQueueState, Day14QueueState, GhostBanQueueState, DisputeQueueState } from '../admin/api.js';
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
import type {
  CreatorCloseView,
  CreatorInvitationState,
  CreatorPartnership,
  FormalOpportunity,
} from '../../surfaces/creator/api.js';
import type { BackerPageData, BackerSupportView, CommentThread } from '../public/backer/api.js';
import type { LiveCampaignResponse } from '../public/campaign/api.js';
import type { Quote, PreorderSuccess } from '../public/checkout/api.js';
import type { DigestPreferenceView } from '../../surfaces/notifications/DigestPreference.js';
import type { HistoryEntry } from '../../surfaces/notifications/NotificationHistory.js';
import type { StubRoute } from './server.js';

/* ── The one campaign every surface is rendering ───────────────────────────── */

export const QA = {
  campaignId: 'camp-qa-1',
  associationId: 'assoc-qa-1',
  reservationId: 'res-qa-1',
  draftId: 'draft-qa-1',
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
  productName: QA.title,
  whatWeUnderstood: 'A machined desk lamp for people who solder at their kitchen table.',
  senderName: 'Sam at Proovd',
  expectedSetupTime: 'About 20 minutes',
  reference: 'PVD-QA100-QA200',
  processSummary: [
    'You answer four questions about the problem, your solution, and the competition.',
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
  competition: 'Two incumbents sell at US$300 and neither publishes a colour-rendering figure.',
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
    competition: {
      supplier: 'founder',
      prefilledText: null,
      prefilledAt: null,
      firstEditedAt: '2026-08-01T09:30:00.000Z',
      lastEditedAt: '2026-08-01T09:42:00.000Z',
    },
  },
  lastSavedAt: '2026-08-01T09:42:00.000Z',
  resumeStep: null,
  submittedAt: null,
  completeness: { campaign_path: true, problem: true, solution: true, competition: true },
  campaignStatus: 'vetting_in_progress',
  lockedType: null,
  typeLockedAt: null,
};

const creatorSignal: CreatorSignal = {
  status: 'available',
  count: 12,
  recordedAt: '2026-08-02T12:00:00.000Z',
  submittedAt: '2026-08-01T10:00:00.000Z',
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
};

const listing: ListingState = {
  paid: false,
  onboardingState: 'complete',
  listingFeeEligible: true,
  taxAvailable: true,
  checkoutAvailable: true,
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
      sortOrder: 1,
    },
  ],
  faqs: [{ id: 'faq-1', question: 'When will I get it?', answer: `We commit to ${QA.delivery}.` }],
  buildStatus: 'complete',
  missing: [],
  campaignStatus: 'affiliate_response_and_build',
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
      sku: QA.rewardSku,
      title: QA.rewardTitle,
      priceCents: '12000',
      contents: ['One lamp', 'One clamp base', 'One spare bulb'],
      delivery: QA.delivery,
      fulfillment: 'Shipped from New York with tracking.',
      limitedQuantity: 250,
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
      audienceNiche: { value: 'Electronics workbench builds', supplier: 'proovd', prefilled: 'Electronics workbench builds', editedAt: null },
      audienceSize: { value: '48000', supplier: 'proovd', prefilled: '48000', editedAt: null },
      bio: { value: 'Weekly bench-build videos.', supplier: 'affiliate', prefilled: null, editedAt: null },
      dateOfBirth: { value: null, supplier: null, prefilled: null, editedAt: null },
      country: { value: 'US', supplier: 'affiliate', prefilled: null, editedAt: null },
      stateRegion: { value: 'OR', supplier: 'affiliate', prefilled: null, editedAt: null },
    },
    channelSubtype: 'youtube_channel',
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
  pending: {
    available: false,
    note: 'Pre-order and earnings figures appear after the campaign closes.',
    fields: ['preorders', 'conversion', 'earnings', 'payout'],
  },
  updatedAt: '2026-08-26T15:40:00.000Z',
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
};

const settings: { settings: SettingState[] } = {
  settings: [
    {
      key: 'affiliate_response_window_hours',
      value: '72',
      kind: 'hours',
      provenance: 'specified',
      minimum: 1,
      maximum: 336,
      specRef: '§6',
      version: 1,
      editable: true,
      updatedBy: 'seed',
      updateReason: 'Initial value from §6.',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      key: 'interview_reminder_lead_hours',
      value: null,
      kind: 'hours',
      provenance: 'operator',
      minimum: 1,
      maximum: 168,
      specRef: '§6',
      version: 1,
      editable: true,
      updatedBy: 'seed',
      updateReason: '§6 names the setting and fixes no value.',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

const prerequisites: PrerequisitePanel = {
  blocking: true,
  unsatisfiedKeys: ['policies_published'],
  items: [
    {
      key: 'policies_published',
      label: 'All canonical policy documents are published',
      specRef: '§34',
      verification: 'automatic',
      requirement: 'Every §31.4 document is published, not draft.',
      satisfied: false,
      detail: 'Eight documents are in legal review.',
      subjectKeys: ['terms'],
      attestation: null,
    },
    {
      key: 'monitoring_owner',
      label: 'The pilot campaign has a named monitoring owner',
      specRef: '§34',
      verification: 'recorded',
      requirement: 'A named person records who is watching the pilot.',
      satisfied: true,
      detail: 'Recorded by Sam Okafor.',
      subjectKeys: [],
      attestation: {
        status: 'satisfied',
        recordedBy: 'Sam Okafor',
        recordedAt: '2026-08-01T10:00:00.000Z',
        note: 'Sam owns monitoring; Ada owns rollback.',
        evidenceLinks: ['https://example.com/runbook'],
      },
    },
  ],
};

const founders: { founders: FounderRow[] } = {
  founders: [
    {
      prospectId: 'prospect-1',
      draftId: QA.draftId,
      campaignId: QA.campaignId,
      legalName: 'Rae Harlow',
      email: 'rae@harlow.example',
      productName: QA.title,
      status: 'claimed',
      invitationSource: 'Sam Okafor',
      internalOwner: 'Sam Okafor',
      lastSentAt: '2026-08-01T09:00:00.000Z',
      retentionDueAt: '2026-09-30T09:00:00.000Z',
      claimedAt: '2026-08-02T12:10:00.000Z',
      anonymisedAt: null,
      createdAt: '2026-07-30T09:00:00.000Z',
    },
  ],
};

const affiliateRegistry: AffiliateRegistry = {
  subtypes: ['youtube_channel', 'newsletter'],
  requiredEvidence: { youtube_channel: ['channel_url', 'subscriber_count'] },
  verificationStatuses: ['unverified', 'verified'],
  fixedCopy: {
    preparingNotice: 'The opportunity may still be being prepared.',
    declineNotice: 'Declining later does not harm your standing with Proovd.',
    neverAsksNotice: 'Proovd never asks for your bank details by email.',
  },
};

const ledger: LedgerPageState = {
  dimensions: ['campaign', 'status', 'attribution'],
  rows: [
    {
      reservationId: QA.reservationId,
      campaignId: QA.campaignId,
      campaignType: 'pre_launch',
      status: 'captured',
      reservedAt: '2026-08-24T10:00:00.000Z',
      rewardSku: QA.rewardSku,
      rewardTitle: QA.rewardTitle,
      rewardSubtotalCents: '12000',
      salesTaxCents: '990',
      totalAuthorizedCents: '12990',
      totalCapturedCents: '12990',
      taxJurisdiction: 'NY',
      taxabilityReason: 'standard_rated',
      taxCalculationExpiresAt: '2026-09-20T10:00:00.000Z',
      taxCloseUsable: true,
      consentAppendix: 'A.4',
      consentVersion: 'v1',
      founderMarketingConsent: false,
      newsletterConsent: false,
      attributionSource: 'creator_link',
      attributionStatus: 'verified',
      linkActivatedAt: '2026-08-20T15:00:00.000Z',
      capResult: 'within_cap',
      duplicateCaseStatus: null,
      backerEmail: 'backer@example.com',
      backerPhone: '+14155550100',
    },
  ],
  total: 1,
  summary: {
    uniqueBackers: 44,
    transactions: 44,
    subtotalCents: '528000',
    taxCents: '43560',
    capturedCents: '571560',
  },
};

const moneyControls: MoneyPanelState = {
  campaignId: QA.campaignId,
  campaignStatus: 'closed_reconciling',
  lines: [
    {
      key: 'captured_total',
      amounts: { totalCapturedCents: '571560', rewardSubtotalCapturedCents: '528000' },
      populated: true,
      populatedBy: 'close batch',
      awaiting: null,
    },
    {
      key: 'thank_you',
      amounts: {},
      populated: false,
      populatedBy: 'thank_you_records',
      awaiting: 'No thank-you has been recorded for this campaign.',
    },
  ],
  provisionalReconciles: true,
  taxExcludedFromFees: true,
};

const riskPanel: RiskPanelState = {
  campaignId: QA.campaignId,
  signals: [
    {
      key: 'tax_not_collecting',
      severity: 'blocking',
      count: 0,
      instances: [],
      notYetObservable: false,
    },
    {
      key: 'radar_blocked_payments',
      severity: 'monitor',
      count: 0,
      instances: [],
      notYetObservable: true,
    },
  ],
  blockingKeys: [],
  sellerTaxReadiness: {
    recorded: true,
    ready: true,
    missingFacts: [],
    recordedBy: 'Sam Okafor',
    evidenceReference: 'https://example.com/tax-record',
    recordedAt: '2026-08-10T10:00:00.000Z',
  },
};

const supportQueue: SupportQueueState = {
  entries: [
    {
      caseId: 'case-1',
      reference: 'PVD-QA500-QA600',
      topic: 'delivery',
      owner: 'Founder',
      status: 'open',
      humanResponseDueAt: '2026-09-21T10:00:00.000Z',
      nextPromisedUpdateAt: null,
      founderFollowupDueAt: '2026-09-22T10:00:00.000Z',
      responseOverdue: true,
      promiseOverdue: false,
      founderFollowupOverdue: false,
      requesterEmail: 'backer@example.com',
      campaignId: QA.campaignId,
    },
  ],
  dueCount: 1,
  overdueCount: 1,
};

const closeOperations: CloseOperationsState = {
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
  reconciliationItems: [
    {
      key: 'batch_completeness',
      spec: '§21: every locked pre-order reached a terminal capture outcome.',
      evaluation: 'app',
      requiredForResults: true,
      waitsOn: null,
    },
  ],
  narrativeFields: [
    { key: 'strongestSignal', label: 'Strongest signal' },
    { key: 'whatThisDoesNotProve', label: 'What this does not prove' },
  ],
};

const refundQueue: RefundQueueState = {
  cases: [],
  unreconciled: [],
  bestEffortRecovery:
    'Recovery beyond the available balance is best effort and is never promised as certain.',
  causes: [
    {
      key: 'founder_caused',
      label: 'Founder-caused',
      allocation: 'founder_liability',
      permittedAffiliateTreatments: ['earnings_remain'],
      requiresMandate: false,
    },
  ],
  ideaExceptions: [{ key: 'duplicate_charge', label: 'A duplicate charge' }],
  proovdFeeTreatments: ['fee_returned', 'fee_retained'],
};

const disputeQueue: DisputeQueueState = {
  disputes: [],
  causes: refundQueue.causes,
  proovdFeeTreatments: refundQueue.proovdFeeTreatments,
  evidenceItems: [
    { key: 'consent_text', label: 'The exact consent the Backer agreed to', required: true },
    { key: 'refund_policy_snapshot', label: 'The refund policy as it stood', required: true },
  ],
  bestEffortRecovery:
    'Recovery beyond the available balance is best effort and is never promised as certain.',
};

const day14Queue: Day14QueueState = {
  queue: [],
  failureReasons: [
    { key: 'no_progress_evidence', label: 'No evidence of progress was provided' },
    { key: 'no_backer_communication', label: 'Backers were not told where things stand' },
  ],
};

const ghostBanQueue: GhostBanQueueState = {
  candidates: [],
  triggers: [{ key: 'failed_day_14', label: 'Failed the Day 14 Progress Check' }],
  requiredFields: [{ key: 'notice', label: 'The notice sent to the Founder' }],
  permanentSentence: 'A ghost ban is permanent and is recorded once.',
};

/* ── The stub table ────────────────────────────────────────────────────────── */

/**
 * Every read the principal flows perform, most specific first.
 *
 * Order matters where one path is a prefix of another — `/api/founder/campaigns`
 * would otherwise answer `/api/founder/campaigns/:id/build`.
 */
/* ── §31.9 the first-cohort scoreboard (Phase 23b) ─────────────────────────── */

/**
 * Deliberately a cohort-incomplete board.
 *
 * §33.12.6's state is the one a fresh deployment is actually in, and it is the
 * one worth sweeping: it renders the `not measured` label, the reason, and no
 * number at all. A fixture with four measured values would sweep a screen the
 * product cannot currently produce.
 */
const scoreboard: Scoreboard = {
  notMeasuredLabel: 'not measured',
  cohortSize: 10,
  invitedFounders: 3,
  baselineEstablished: false,
  metrics: [
    'time_to_first_magic',
    'founder_completion',
    'return_after_closure',
    'next_action_correction_rate',
  ].map((key) => ({
    key,
    value: {
      state: 'not_measured' as const,
      reason: 'cohort_incomplete' as const,
      invitedFounders: 3,
      cohortSize: 10,
    },
  })),
  secondary: [
    {
      key: 'autosave_failures',
      label: 'Autosave failures',
      count: null,
      absentBecause:
        'Autosave reports its own outcome to the Founder and retries; a client-side beacon to count failures is the analytics warehouse §31.9 forbids.',
    },
    { key: 'proposal_outcomes', label: 'Proposal outcomes', count: 0 },
    { key: 'support_sla_misses', label: 'Support SLA misses', count: 0 },
  ],
};

export const QA_ROUTES: StubRoute[] = [
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
  { match: /\/api\/founder\/payouts/, body: { status: 'complete', connectedAccountId: 'acct_qa', requirements: null, updatedAt: '2026-08-10T10:00:00.000Z', onboardingAvailable: false } },

  /* Creator (§11, §14, §18, §21) */
  { match: /\/api\/affiliate-invitation\/[^/]+\/payout$/, body: { status: 'not_started', connectedAccountId: null, requirements: null, updatedAt: null, onboardingAvailable: false } },
  { match: /\/api\/affiliate-invitation\/[^/?]+(\?.*)?$/, body: creatorInvitation },
  { match: /\/api\/creator\/campaigns\/[^/]+\/opportunity$/, body: { opportunity } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/partnership$/, body: { partnership } },
  { match: /\/api\/creator\/campaigns\/[^/]+\/close$/, body: { close: creatorClose } },
  { match: /\/api\/creator\/campaigns\/[^/?]+(\?.*)?$/, body: { kit: { associationId: QA.associationId, campaignId: QA.campaignId, campaignStatus: 'preparing', associationStatus: 'preparing', founder: { name: QA.founderDisplayName, entity: QA.founderLegalName, soleProprietor: false }, productName: QA.title, problem: 'Benches are badly lit.', solution: 'A clamp lamp that holds its position.', competition: 'Two incumbents at US$300.', campaignType: 'pre_launch', notYetAvailable: [{ item: 'Reward packages', because: 'The Founder has not built them yet.' }], workPermitted: false, decisionsAvailable: false } } },
  { match: /\/api\/creator\/campaigns$/, body: { campaigns: [{ associationId: QA.associationId, campaignId: QA.campaignId, productName: QA.title, status: 'active', revealedAt: '2026-08-03T10:00:00.000Z', revoked: false, reviewAvailable: true }] } },
  { match: /\/api\/creator\/notifications\/preferences$/, body: { preference: digestPreference } },
  { match: /\/api\/creator\/notifications\/history/, body: { history: notificationHistory } },
  { match: /\/api\/creator\/payouts/, body: { status: 'complete', connectedAccountId: 'acct_qa2', requirements: null, updatedAt: '2026-08-10T10:00:00.000Z', onboardingAvailable: false } },

  /* Public campaign, checkout, and the magic link (§18, §19, §20) */
  { match: /\/api\/campaign\/[^/]+\/checkout\/quote$/, body: QA_QUOTE },
  { match: /\/api\/campaign\/[^/]+\/preorder$/, body: QA_PREORDER_SUCCESS },
  { match: /\/api\/campaign\/[^/?]+(\?.*)?$/, body: liveCampaign },
  { match: /\/api\/link\/[^/]+\/page$/, body: backerPage },
  { match: /\/api\/link\/[^/]+\/comments/, body: { thread: commentThread } },
  { match: /\/api\/link\/[^/]+\/support$/, body: backerSupport },
  { match: /\/api\/link\/[^/]+\/digest-preference$/, body: { preference: digestPreference } },

  /* Admin (§26) */
  { match: /\/api\/admin\/me$/, body: adminIdentity },
  { match: /\/api\/admin\/settings$/, body: settings },
  { match: /\/api\/admin\/prerequisites$/, body: prerequisites },
  { match: /\/api\/admin\/founders$/, body: founders },
  { match: /\/api\/admin\/affiliates\/registry$/, body: affiliateRegistry },
  { match: /\/api\/admin\/affiliates(\?.*)?$/, body: { creators: [], slots: { used: 0, cap: 4 } } },
  { match: /\/api\/admin\/ledger/, body: ledger },
  { match: /\/api\/admin\/money\//, body: moneyControls },
  { match: /\/api\/admin\/risk/, body: riskPanel },
  { match: /\/api\/admin\/support\/queue$/, body: supportQueue },
  { match: /\/api\/admin\/close$/, body: closeOperations },
  { match: /\/api\/admin\/refunds(\?.*)?$/, body: refundQueue },
  { match: /\/api\/admin\/disputes(\?.*)?$/, body: disputeQueue },
  { match: /\/api\/admin\/fulfillment\/day-14$/, body: day14Queue },
  { match: /\/api\/admin\/fulfillment\/ghost-ban\/candidates$/, body: ghostBanQueue },
  { match: /\/api\/admin\/notifications\/catalog$/, body: { keys: [], deliberateAbsences: [] } },
  { match: /\/api\/admin\/notifications\/history/, body: { history: notificationHistory } },
  { match: /\/api\/admin\/measurement$/, body: scoreboard },
];
