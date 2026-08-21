/**
 * The signed-in Founder client — Spec §12.
 *
 * Separate from the draft client and the Creator client for the reason both of
 * those document: those carry a raw token in the URL and no session cookie,
 * this carries a session cookie and no token. One module doing both would
 * eventually send one to the other's routes.
 *
 * ── Nothing here computes money ─────────────────────────────────────────────
 * Every amount arrives as a decimal string of integer cents and is rendered
 * with `shared/money`'s USD formatter. Phase 09's trap: "Don't recalculate in
 * the UI. The fee and high-effort come from `shared/money`. A second
 * implementation in a React component is how the preview and the charge
 * diverge." There is no arithmetic on a fee anywhere in this surface — the
 * server sends the base line, each saving, and the total, and the browser lays
 * them out.
 *
 * ── Uploads go to R2, not here ──────────────────────────────────────────────
 * `requestUpload` returns a presigned URL and the headers the browser must
 * send; `putToStorage` PUTs the file straight to the bucket. No file body ever
 * reaches Proovd's own server (tech-stack §9), and there is no route that would
 * accept one.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';

export { AdminRequestError as FounderRequestError };
export type { AdminError as FounderError };

function opaque(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so nothing was saved and nothing was changed.'
        : `The server answered ${status} with no explanation, so it is not certain whether the change was applied.`,
    next:
      status === 0
        ? 'Check your connection and try again. Everything you have typed is still on this page.'
        : 'Reload to see what is stored before trying again.',
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaque(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title ? { ...(body as AdminError), status: response.status } : opaque(response.status),
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export type OptionalItemKey = 'visuals' | 'branding' | 'interview' | 'story' | 'socials';

export interface ItemState {
  item: OptionalItemKey;
  complete: boolean;
  completedAt: string | null;
  decisionSource: string | null;
  rejections: string[];
  locked: boolean;
  invalidated: { at: string | null; explanation: string | null };
}

export interface FeeState {
  baseCents: string;
  itemDiscountCents: string;
  maxDiscountCents: string;
  minSubtotalCents: string;
  completedItems: number;
  discountLines: Array<{ item: OptionalItemKey; discountCents: string }>;
  discountCents: string;
  subtotalCents: string;
  calculatedAt: string | null;
  locked: boolean;
  /** §24.6. The server owns this sentence — it is a commercial statement. */
  separateStreamNote: string;
}

export interface HighEffortState {
  visualsCompleted: boolean;
  brandingCompleted: boolean;
  interviewScheduledOrConfirmed: boolean;
  highEffort: boolean;
  calculatedAt: string | null;
}

export interface AssetState {
  id: string;
  filename: string | null;
  contentType: string;
  state: 'pending' | 'stored' | 'rejected';
  rejection: string | null;
  approved: boolean;
  width: number | null;
  height: number | null;
  byteSize: string | null;
}

export interface SocialState {
  id: string;
  url: string;
  platform: string | null;
  handle: string | null;
  accessible: boolean | null;
  rejection: string | null;
  controlsConfirmed: boolean;
  checkedAt: string | null;
}

export interface WorkspaceState {
  campaignId: string;
  campaignStatus: string;
  listingPaid: boolean;
  items: ItemState[];
  fee: FeeState | null;
  highEffort: HighEffortState | null;
  brand: {
    colors: string | null;
    typography: string | null;
    notes: string | null;
    approved: boolean;
    logos: AssetState[];
  };
  story: { text: string | null; approved: boolean };
  visuals: AssetState[];
  socials: SocialState[];
  interview: {
    bookable: boolean;
    missingSettings: string[];
    providers: string[];
    availability: string | null;
    /** Phase 09b. `available` is false while §6 or Track A4 is outstanding. */
    embed: {
      available: boolean;
      eventTypeLink: string | null;
      reference: string | null;
    };
    booking: {
      id: string;
      status: string;
      scheduledAt: string | null;
      timezone: string | null;
      provider: string | null;
      link: string | null;
      interviewer: string | null;
    } | null;
  };
  lastSavedAt: string | null;
  resumeStep: string | null;
  uploadsAvailable: boolean;
  /** Founder Flow v2 Session D. A deployment fact, carried with the read. */
  transcription: { available: true } | { available: false; absentBecause: string };
  /** Session D. §9's three answers, read-only — Last look renders all eight. */
  vetting: {
    problem: string | null;
    solution: string | null;
    competition: string | null;
    submittedAt: string | null;
  };
}

export interface WorkspacePatch {
  brandColors?: string | null;
  brandTypography?: string | null;
  brandNotes?: string | null;
  storyText?: string | null;
  resumeStep?: string;
  brandApproved?: boolean;
  storyApproved?: boolean;
}

const base = (campaignId: string) => `/api/founder/campaigns/${encodeURIComponent(campaignId)}`;

/* ── Calls ────────────────────────────────────────────────────────────────── */

export const listCampaigns = (): Promise<{
  campaigns: Array<{
    campaignId: string;
    status: string;
    type: string | null;
    listingPaid: boolean;
    highEffort: boolean | null;
  }>;
}> => call('/api/founder/campaigns');

export const fetchWorkspace = (campaignId: string): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/workspace`);

/**
 * Dictation on the Story step (deviation 2, Session D).
 *
 * The audio is the body; there is no JSON envelope and no metadata field, so
 * there is nothing to carry a title, a prompt, or an instruction. The response
 * is the transcript and nothing derived from it.
 */
export const transcribeStory = (campaignId: string, audio: Blob): Promise<{ text: string }> =>
  call(`${base(campaignId)}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': audio.type || 'audio/webm' },
    body: audio,
  });

export const saveWorkspace = (
  campaignId: string,
  patch: WorkspacePatch,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/workspace`, { method: 'PATCH', body: JSON.stringify(patch) });

/* ── Your details (screen 16) ─────────────────────────────────────────────── */

export interface FounderDetails {
  /** Shown back, never written from that screen. */
  name: string | null;
  phone: string | null;
  /** `YYYY-MM-DD`, or null. A date, never an age. */
  dateOfBirth: string | null;
}

export interface FounderDetailsPatch {
  phone?: string | null;
  dateOfBirth?: string | null;
}

export const fetchFounderDetails = (
  campaignId: string,
): Promise<{ details: FounderDetails }> => call(`${base(campaignId)}/details`);

export const saveFounderDetails = (
  campaignId: string,
  patch: FounderDetailsPatch,
): Promise<{ details: FounderDetails }> =>
  call(`${base(campaignId)}/details`, { method: 'PATCH', body: JSON.stringify(patch) });

/* ── Uploads ──────────────────────────────────────────────────────────────── */

export interface PresignedUpload {
  assetId: string;
  url: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/**
 * The SHA-256 of the file, computed in the browser.
 *
 * §12 rejects duplicate uploads and the server confirms this value against the
 * bytes it reads back, so a wrong one costs the upload rather than defeating
 * the rule. Computing it here means the duplicate is caught before a 20 MB
 * video is transferred.
 */
export async function fileChecksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const requestUpload = (
  campaignId: string,
  input: { purpose: 'visual' | 'logo'; contentType: string; byteSize: number; checksumSha256: string; filename: string },
): Promise<PresignedUpload> =>
  call(`${base(campaignId)}/uploads`, { method: 'POST', body: JSON.stringify(input) });

/**
 * PUTs the file to R2. The headers are part of the signature, so they are sent
 * exactly as issued — changing either would invalidate the URL, which is the
 * point of signing them.
 */
export async function putToStorage(
  upload: PresignedUpload,
  file: File,
): Promise<void> {
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.requiredHeaders,
    body: file,
  });
  if (!response.ok) {
    throw new AdminRequestError({
      error: 'upload_failed',
      status: response.status,
      title: 'That file did not finish uploading',
      whatHappened: 'The file was not stored, so it has not been added to your campaign.',
      next: 'Try again. Nothing else on this page has changed.',
    });
  }
}

export const verifyUpload = (
  campaignId: string,
  assetId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const setAssetApproval = (
  campaignId: string,
  assetId: string,
  approved: boolean,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });

export const removeAsset = (
  campaignId: string,
  assetId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' });

/* ── Socials ──────────────────────────────────────────────────────────────── */

export const addSocial = (
  campaignId: string,
  input: { url: string; controlsConfirmed: boolean },
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials`, { method: 'POST', body: JSON.stringify(input) });

export const recheckSocial = (
  campaignId: string,
  socialId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}/recheck`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const confirmSocialControl = (
  campaignId: string,
  socialId: string,
  confirmed: boolean,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}/control`, {
    method: 'POST',
    body: JSON.stringify({ confirmed }),
  });

export const removeSocial = (
  campaignId: string,
  socialId: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/socials/${encodeURIComponent(socialId)}`, { method: 'DELETE' });

/* ── The listing fee (§13, §24.6, §31.6 — Phase 11) ───────────────────────── */

/** §13's pre-payment state, or §24.6's record once the fee is paid. */
export interface ListingState {
  paid: boolean;
  /* Before payment. */
  onboardingState?: string;
  listingFeeEligible?: boolean;
  taxAvailable?: boolean;
  checkoutAvailable?: boolean;
  /* After payment — every amount a string of integer cents. */
  payment?: {
    baseCents: string;
    discountLines: Array<{ item: OptionalItemKey; discountCents: string }>;
    discountCents: string;
    promotionCents: string;
    subtotalCents: string;
    taxCents: string;
    totalCents: string;
    descriptor: string;
    receiptUrl: string | null;
    paidAt: string;
    responseDeadlineAt: string;
    freeCancellationDeadlineAt: string;
  };
  refund?: {
    status: string;
    trigger: string;
    totalRefundedCents: string;
    explanation: string;
  } | null;
  cancellation?: { status: string; kind: string; explanation: string } | null;
}

/**
 * What the Checkout call returns: the session to send the Founder to, and the
 * exact amounts A.5's consent named. The browser formats them and computes
 * nothing (Phase 09's rule).
 */
export interface CheckoutQuote {
  url: string;
  sessionId: string;
  baseCents: string;
  discountLines: Array<{ item: OptionalItemKey; discountCents: string }>;
  discountCents: string;
  subtotalCents: string;
  taxCents: string;
  totalCents: string;
  descriptor: string;
}

export interface BillingAddress {
  postalCode: string;
  country?: string;
  state?: string;
  city?: string;
  line1?: string;
}

export const fetchListing = (campaignId: string): Promise<{ listing: ListingState }> =>
  call(`${base(campaignId)}/listing`);

export const openListingCheckout = (
  campaignId: string,
  input: { address: BillingAddress; newsletterOptIn: boolean },
): Promise<{ checkout: CheckoutQuote }> =>
  call(`${base(campaignId)}/listing/checkout`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const cancelListing = (
  campaignId: string,
  reason: string,
): Promise<{ cancellation: { status: string; refund?: string; explanation: string } }> =>
  call(`${base(campaignId)}/listing/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/* ── The interview ────────────────────────────────────────────────────────── */

/**
 * Records a chosen slot — `POST .../interview`, Phase 09a.
 *
 * The route has existed since Phase 09a, is driven by the backend suite, and
 * until this screen was rebuilt to the reference it had NO frontend caller at
 * all: `recordBooking` was reachable only from Admin. It is the SELECTION half
 * of the two-step model §12 describes — it always writes `selected`, never
 * `confirmed`, because §12 is explicit that a slot somebody picked and nobody
 * confirmed does not complete the item. Confirmation still arrives from the
 * Cal.com webhook or from an Admin reconciling a missed delivery (tech-stack
 * §12), and nothing on this path can produce it.
 *
 * `timezone` is the browser's own IANA zone, because the record stores the
 * Founder's zone beside the instant and `scheduledAt` alone cannot carry it.
 */
export const bookInterview = (
  campaignId: string,
  input: { meetingProvider: string; scheduledAt: string; timezone: string },
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/interview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const cancelInterview = (
  campaignId: string,
  bookingId: string,
  reason: string,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/interview/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/* ── The §14.5 roster view and the Founder's proposal responses (Phase 12a) ── */

export interface RosterCreator {
  associationId: string;
  handle: string | null;
  channelType: string | null;
  audienceMetric: string | null;
  niche: string | null;
  bio: string | null;
  statusLabel: string;
  openProposal: {
    versionId: string;
    versionNumber: number;
    awaitingYou: boolean;
    bidTotalPercent: number | null;
    fixedPaymentRequestCents: string | null;
    note: string;
  } | null;
  lockedTerms: { totalPercent: number; fixedPaymentCents: string | null } | null;
  /** Deviation 1's latest ask, or null (Founder Dashboard Session C). */
  meetingRequest: MeetingRequestView | null;
}

/**
 * Deviation 1's record, as it reaches the browser. There is no time, no
 * duration, no platform and no calendar link, because the record holds none —
 * §12's Cal.com booking is the one scheduler (§30, tech-stack §12).
 */
export interface MeetingRequestView {
  id: string;
  associationId: string;
  status: string;
  message: string;
  requestedAt: string;
  respondedAt: string | null;
  responseNote: string | null;
}

/**
 * §14.3's cell for this campaign, read from the §6 settings by the server. The
 * surface bounds its revision control with these and decides nothing — a second
 * copy of the matrix in the browser is a second answer to what the base is.
 */
export interface RosterTerms {
  basePercent: number;
  ceilingPercent: number;
  bidAllowed: boolean;
  fixedPaymentAllowed: boolean;
  highEffort: boolean;
}

export interface RosterView {
  responseDeadlineAt: string | null;
  fullRefundOutcome: string;
  pendingProposalNote: string;
  terms: RosterTerms;
  creators: RosterCreator[];
}

export const fetchRoster = (campaignId: string): Promise<{ roster: RosterView }> =>
  call(`${base(campaignId)}/roster`);

export const respondToProposal = (
  versionId: string,
  body:
    | { action: 'accept' }
    | { action: 'decline' }
    | { action: 'revise'; bidTotalPercent?: number; fixedPaymentRequestCents?: string },
): Promise<{ response: { outcome: string } }> =>
  call(`/api/founder/proposals/${encodeURIComponent(versionId)}/respond`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** §14.3's Creator-specific bonus, offered once terms are locked. */
export const offerCreatorBonus = (
  campaignId: string,
  associationId: string,
  body: {
    triggerUnit: 'attributed_subtotal_cents' | 'unique_attributed_backers';
    threshold: string;
    additionalPercent: number;
  },
): Promise<{ bonus: { id: string; additionalPercent: number; maxCombinedPercent: number } }> =>
  call(`${base(campaignId)}/roster/${encodeURIComponent(associationId)}/bonus`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * Deviation 1. The body carries exactly one field — there is no `when`, no
 * `slot` and no `duration` to send, which is what keeps this a request rather
 * than the scheduler §30 defers.
 */
export const requestMeeting = (
  campaignId: string,
  associationId: string,
  message: string,
): Promise<{ meetingRequest: MeetingRequestView }> =>
  call(`${base(campaignId)}/roster/${encodeURIComponent(associationId)}/meeting`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

/* ── Campaign building, preview, and review (§14.4, §15) — Phase 12b ─────────── */

export interface BuildFields {
  title: string | null;
  founderDisplayName: string | null;
  founderEntityDisplay: string | null;
  founderCountry: string | null;
  founderProfileUrl: string | null;
  opensAt: string | null;
  closesAt: string | null;
  orderThreshold: number | null;
  internalTargetCents: string | null;
  brandPerception: string | null;
  brandVoice: string | null;
  requiredWording: string | null;
  prohibitedClaims: string | null;
  communityUrl: string | null;
  heroPreference: string | null;
  publicStory: string | null;
  deliveryWindow: string | null;
  earlyProductDisclaimer: string | null;
  risksAndChallenges: string | null;
  refundPolicyText: string | null;
  refundPolicyTitle: string | null;
  refundPolicySourceUrl: string | null;
  refundPolicyVersion: string | null;
  refundPolicyEffectiveDate: string | null;
  /* The rebuilt campaign page's own copy (0049). All optional — none of them is
     in a `REQUIRED_*` register, so none can hold a build below `complete`. */
  heroHeadline: string | null;
  heroHeadlineAccent: string | null;
  heroSubheadline: string | null;
  founderPullQuote: string | null;
  platformLine: string | null;
  demoContextLabel: string | null;
  benefitsHeading: string | null;
  rewardsHeading: string | null;
  updatesHeading: string | null;
  faqHeading: string | null;
}

export interface RewardPackageView {
  id: string;
  sku: string;
  title: string;
  priceCents: string;
  contents: string;
  fulfillmentCommitment: string;
  delivery: string;
  limitedQuantity: number | null;
  badge: string | null;
  sortOrder: number;
}

export interface DemoMomentView {
  id: string;
  timeLabel: string;
  momentLabel: string;
  stateWord: string;
  headline: string;
  signalText: string | null;
  isAction: boolean;
  actionLabel: string | null;
  sortOrder: number;
}

export interface BenefitCardView {
  id: string;
  title: string;
  footerWord: string;
  visualVariant: string;
  sortOrder: number;
}

export interface FaqView {
  id: string;
  question: string;
  answer: string;
}

export interface ReviewReadiness {
  rosterStatus: string;
  buildStatus: string;
  reviewReady: boolean;
}

export interface BuildState {
  build: BuildFields | null;
  rewardPackages: RewardPackageView[];
  faqs: FaqView[];
  demoMoments: DemoMomentView[];
  benefitCards: BenefitCardView[];
  buildStatus: string;
  missing: string[];
  campaignStatus: string;
  /** §14.4's type-specific ingredients differ, so the surface renders one set. */
  model: 'idea' | 'product';
  reviewReadiness: ReviewReadiness;
}

/* ── The fixed-payment openness (screen 18, Session F) ───────────────────────
 *
 * §16 makes the optional fixed Creator payment the CREATOR's request, accepted
 * bilaterally through one §14.2 version. What this carries is an OPENNESS: no
 * amount, no percentage, no proposal reference — and the record behind it has
 * no column for any of them.
 */

export interface OpennessState {
  /** False on an Idea Campaign: §14.3 prohibits the payment, so nothing to ask. */
  applicable: boolean;
  campaignType: 'pre_build' | 'pre_launch';
  stance: 'open' | 'not_open' | 'undecided' | null;
  recordedAt: string | null;
  /** §14.3's two base percentages, from the §6 settings in force. */
  standardBasePercent: number;
  withFixedBasePercent: number;
}

export const fetchOpenness = (campaignId: string): Promise<{ openness: OpennessState }> =>
  call(`${base(campaignId)}/fixed-payment-openness`);

export const recordOpenness = (
  campaignId: string,
  stance: 'open' | 'not_open' | 'undecided',
): Promise<{ openness: OpennessState }> =>
  call(`${base(campaignId)}/fixed-payment-openness`, {
    method: 'PUT',
    body: JSON.stringify({ stance }),
  });

export const fetchBuild = (campaignId: string): Promise<BuildState> =>
  call(`${base(campaignId)}/build`);

export const saveBuild = (
  campaignId: string,
  patch: Partial<BuildFields>,
): Promise<{ buildStatus: string; missing: string[]; build: BuildFields | null }> =>
  call(`${base(campaignId)}/build`, { method: 'PATCH', body: JSON.stringify(patch) });

export const saveRewardPackage = (
  campaignId: string,
  reward: {
    packageId?: string;
    sku: string;
    title: string;
    priceCents: string;
    contents: string;
    fulfillmentCommitment: string;
    delivery: string;
    limitedQuantity?: number | null;
    badge?: string | null;
    sortOrder?: number;
  },
): Promise<{ package: RewardPackageView }> =>
  call(`${base(campaignId)}/build/rewards`, { method: 'PUT', body: JSON.stringify(reward) });

export const removeRewardPackage = (
  campaignId: string,
  packageId: string,
): Promise<{ removed: true }> =>
  call(`${base(campaignId)}/build/rewards/${encodeURIComponent(packageId)}`, {
    method: 'DELETE',
  });

/* ── FAQs, the demo stage, and the benefit cards ─────────────────────────────
 *
 * `campaign_faqs` had no production writer until now: the §14.4 read shipped in
 * Phase 12b and the write never did, so a Founder could see the section on
 * their own preview and had nowhere to fill it.
 */

export const saveFaq = (
  campaignId: string,
  faq: { faqId?: string; question: string; answer: string; sortOrder?: number },
): Promise<{ faq: FaqView }> =>
  call(`${base(campaignId)}/build/faqs`, { method: 'PUT', body: JSON.stringify(faq) });

export const removeFaq = (campaignId: string, faqId: string): Promise<{ removed: true }> =>
  call(`${base(campaignId)}/build/faqs/${encodeURIComponent(faqId)}`, { method: 'DELETE' });

export const saveDemoMoment = (
  campaignId: string,
  moment: {
    momentId?: string;
    timeLabel: string;
    momentLabel: string;
    stateWord: string;
    headline: string;
    signalText?: string | null;
    isAction?: boolean;
    actionLabel?: string | null;
    sortOrder?: number;
  },
): Promise<{ moment: DemoMomentView }> =>
  call(`${base(campaignId)}/build/demo-moments`, { method: 'PUT', body: JSON.stringify(moment) });

export const removeDemoMoment = (
  campaignId: string,
  momentId: string,
): Promise<{ removed: true }> =>
  call(`${base(campaignId)}/build/demo-moments/${encodeURIComponent(momentId)}`, {
    method: 'DELETE',
  });

export const saveBenefitCard = (
  campaignId: string,
  card: {
    cardId?: string;
    title: string;
    footerWord: string;
    visualVariant: string;
    sortOrder?: number;
  },
): Promise<{ card: BenefitCardView }> =>
  call(`${base(campaignId)}/build/benefit-cards`, { method: 'PUT', body: JSON.stringify(card) });

export const removeBenefitCard = (campaignId: string, cardId: string): Promise<{ removed: true }> =>
  call(`${base(campaignId)}/build/benefit-cards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
  });

export const submitForReview = (
  campaignId: string,
): Promise<{ review: { id: string; round: number; status: string } }> =>
  call(`${base(campaignId)}/submit`, { method: 'POST' });

export interface CampaignPreview {
  model: 'idea' | 'product';
  title: string;
  tagline: string;
  founder: { legalName: string; entity: string; country: string; profile: string };
  opensAt: string | null;
  closesAt: string | null;
  rewards: Array<{
    id: string;
    sku: string;
    title: string;
    priceCents: string;
    contents: string[];
    delivery: string;
    fulfillment: string;
    limitedQuantity: number | null;
    badge: string | null;
  }>;
  featuredRewardSku: string | null;
  example: { rewardSubtotalCents: string; salesTaxCents: string; totalCents: string } | null;
  orderThreshold: number | null;
  internalTargetCents: string | null;
  statementDescriptor: string;
  story: string | null;
  faq: Array<{ question: string; answer: string }>;
  founderRefundPolicy: {
    title: string | null;
    version: string | null;
    effectiveDate: string | null;
    sourceUrl: string | null;
    text: string | null;
  } | null;
  earlyProductDisclaimer: string | null;
  risksAndChallenges: string | null;
  /* The rebuilt page's own copy (0049). The preview renders exactly what the
     public page will, so it carries exactly what the public payload carries. */
  heroHeadline: string | null;
  heroHeadlineAccent: string | null;
  founderPullQuote: string | null;
  platformLine: string | null;
  demoContextLabel: string | null;
  benefitsHeading: string | null;
  rewardsHeading: string | null;
  updatesHeading: string | null;
  faqHeading: string | null;
  // The preview renders what a Backer will see, so these carry no `sortOrder`:
  // the order IS the array, and a position a surface could disagree with the
  // array about is a second answer to the same question.
  demoMoments: Array<Omit<DemoMomentView, 'sortOrder'>>;
  benefitCards: Array<Omit<BenefitCardView, 'sortOrder'>>;
  isPreview: true;
}

export const fetchPreview = (campaignId: string): Promise<{ preview: CampaignPreview | null }> =>
  call(`${base(campaignId)}/preview`);

export interface ReviewFeedback {
  area: string;
  body: string;
  deepLink: string;
  owner: string;
  dueExpectation: string | null;
  enforcementInvolved: boolean;
}

export interface LatestReview {
  round: number;
  outcome: string;
  reviewer: string | null;
  nextUpdateExpectation: string | null;
  submittedAt: string;
  decidedAt: string | null;
  required: ReviewFeedback[];
  optional: ReviewFeedback[];
}

export const fetchLatestReview = (
  campaignId: string,
): Promise<{ review: LatestReview | null }> => call(`${base(campaignId)}/review`);

/* ── Creator readiness and fixed-payment funding (§16) — Phase 13 ───────────── */

export interface FounderFixedPayment {
  applicable: boolean;
  status?: string;
  label?: string;
  amountCents?: string;
  fundingDeadlineAt?: string | null;
  fundedAt?: string | null;
  canceledAt?: string | null;
}

export interface FounderReadinessCreator {
  associationId: string;
  publicHandle: string | null;
  status: string;
  canBeginWork: boolean;
  fixedPayment: FounderFixedPayment;
  /** The applicable incomplete §16 items, with their owner. */
  blockers: Array<{ key: string; label: string; owner: string }>;
  nextDate: string | null;
}

export interface FounderReadiness {
  campaignId: string;
  campaignStatus: string;
  campaignLiveAt: string | null;
  /** §16: the Founder cannot ask a Creator to begin early. Always false. */
  canAskToBegin: boolean;
  creators: FounderReadinessCreator[];
}

export const fetchCreatorReadiness = (
  campaignId: string,
): Promise<{ readiness: FounderReadiness }> => call(`${base(campaignId)}/creator-readiness`);

export const fundSecuredPayment = (
  campaignId: string,
  associationId: string,
): Promise<{ funding: { url: string; sessionId: string; amountCents: string; descriptor: string } }> =>
  call(`${base(campaignId)}/creators/${encodeURIComponent(associationId)}/fund`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/* ── Updates (§18, Phase 14c) ─────────────────────────────────────────────── */

export interface FounderUpdate {
  id: string;
  audience: 'general_public' | 'backer_only' | 'milestone_progress';
  title: string | null;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  publishedAt: string;
  isMaterialDeliveryChange: boolean;
  priorCommitment: string | null;
  revisedCommitment: string | null;
}

export interface FounderUpdatesView {
  updates: FounderUpdate[];
  canPost: boolean;
  campaignStatus: string;
  model: 'idea' | 'product';
}

export interface PostUpdateBody {
  audience: FounderUpdate['audience'];
  title?: string;
  body: string;
  imageUrl?: string;
  videoUrl?: string;
  deliveryChange?: { prior: string; revised: string };
}

export const fetchUpdates = (campaignId: string): Promise<FounderUpdatesView> =>
  call(`${base(campaignId)}/updates`);

export const postUpdate = (
  campaignId: string,
  update: PostUpdateBody,
): Promise<{ update: FounderUpdate }> =>
  call(`${base(campaignId)}/updates`, { method: 'POST', body: JSON.stringify(update) });

/* ── The live campaign home (§20, Phase 17a) ───────────────────────────────── */

export interface HomeDelta {
  count: number;
  since: string;
}

export interface GlanceView {
  activePreorderCount: number;
  delta: HomeDelta | null;
  model: 'idea' | 'product';
  remainingToThreshold: number | null;
  closesAt: string | null;
  notYetChargedNotice: string;
  activeCreators: number | null;
  readAt: string;
  freshnessBasis: 'refresh';
  /** §33.6.6: the receipt this render must acknowledge once it succeeded. */
  deliveryId: string;
  counts: {
    newCount: number;
    canceledCount: number;
    otherExits: number;
    activeCount: number;
    netChange: number;
    uniqueActiveBackers: number;
    everHadPreorder: boolean;
  };
}

export interface ActCandidate {
  kind: string;
  rank: 1 | 2 | 3 | 4 | 5;
  label: string;
  detail: string;
  href: string;
  sourceTable: string;
  sourceId: string;
  occurredAt: string;
}

export type ActView =
  | {
      state: 'action';
      action: ActCandidate;
      overridden: boolean;
      override: { reason: string; actor: string; recordedAt: string } | null;
      deferred: ActCandidate[];
    }
  | { state: 'caught_up'; closesAt: string | null };

export interface ExploreSection {
  key: string;
  title: string;
  definition: string;
  data: Record<string, unknown> | null;
  awaiting: string | null;
}

export interface ExploreView {
  sections: ExploreSection[];
  readAt: string;
  freshnessBasis: 'refresh';
}

export interface CampaignHomeView {
  campaignId: string;
  status: string;
  glance: GlanceView;
  act: ActView;
  explore: ExploreView;
  milestoneHistory: { kind: string; occurredAt: string; acknowledgedAt: string | null }[];
}

/**
 * The dashboard shell's five facts — Founder Dashboard Session B.
 *
 * Its own read rather than a slice of `fetchCampaignHome`, because that one
 * issues a §33.6.6 delivery receipt and the shell re-reads on every chapter
 * change. See `backend/src/founder-dashboard/service.ts`.
 */
export interface FounderDashboardView {
  campaignId: string;
  status: string;
  type: string | null;
  campaignLiveAt: string | null;
  campaignCloseAt: string | null;
  listingPaidAt: string | null;
  highEffort: boolean;
  title: string | null;
}

export const fetchFounderDashboard = (
  campaignId: string,
): Promise<{ dashboard: FounderDashboardView }> => call(`${base(campaignId)}/dashboard`);

export const fetchCampaignHome = (campaignId: string): Promise<{ home: CampaignHomeView }> =>
  call(`${base(campaignId)}/home`);

/**
 * §33.6.6. Called only after the render succeeded — a failed render must never
 * advance the last-seen position, or the Founder loses a delta permanently.
 */
export const acknowledgeHomeDelivery = (
  campaignId: string,
  deliveryId: string,
): Promise<{ acknowledged: boolean; advanced: boolean }> =>
  call(`${base(campaignId)}/home/seen`, {
    method: 'POST',
    body: JSON.stringify({ deliveryId }),
  });

export const acknowledgeMilestone = (
  campaignId: string,
  kind: string,
): Promise<{ movedToHistory: boolean }> =>
  call(`${base(campaignId)}/home/milestones/${encodeURIComponent(kind)}/seen`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export interface ActCorrectionBody {
  actionKind: string;
  correctionKind: 'correction' | 'dismissal' | 'reclassification' | 'safety_override';
  priorRank: number;
  newRank?: number;
  reason: string;
  sourceTable?: string;
  sourceId?: string;
}

export const recordActCorrection = (
  campaignId: string,
  body: ActCorrectionBody,
): Promise<{ correction: unknown }> =>
  call(`${base(campaignId)}/home/act/corrections`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * Explore on its own — Founder Dashboard Session D.
 *
 * §33.6.6: `GET .../home` issues a `campaign_home_deliveries` receipt carrying
 * the count it rendered. This route exists so a refresh AFTER a mutation does
 * not mint a second one: the chapter fetches `home` once when it mounts, and
 * every later refresh comes through here. The route has existed since Phase 17a
 * and had no caller until now.
 */
export const fetchExplore = (campaignId: string): Promise<{ explore: ExploreView }> =>
  call(`${base(campaignId)}/home/explore`);

/* ── §17's posts, and deviation 2's acknowledgement (Session D) ────────────── */

export interface CreatorPostView {
  submissionId: string;
  associationId: string;
  /** §11: the public handle, never the person behind it. */
  publicHandle: string | null;
  postUrl: string;
  channel: string | null;
  submittedAt: string;
  status: string;
  acknowledgedAt: string | null;
  /** False while §17 has an open correction or an enforcement on this post. */
  acknowledgeable: boolean;
}

export const fetchCreatorPosts = (campaignId: string): Promise<{ posts: CreatorPostView[] }> =>
  call(`${base(campaignId)}/home/posts`);

/**
 * Founder Dashboard Session D, deviation 2 — a RECORDED deviation from §1
 * rule 6, by explicit product direction.
 *
 * It takes a submission id and NOTHING else. There is no note parameter here,
 * no column behind one, and the route ignores the body — a free-text field
 * would be the direct Founder–Affiliate messaging §30 defers wearing a smaller
 * control. `created` is false on a repeat, and no second message is sent.
 */
export const acknowledgeCreatorPost = (
  campaignId: string,
  submissionId: string,
): Promise<{ acknowledged: boolean; created: boolean; acknowledgedAt: string }> =>
  call(`${base(campaignId)}/home/posts/${encodeURIComponent(submissionId)}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/* ── §20's three live-editing tiers (Phase 17b's API, Session D's first UI) ── */

export interface EditableFieldView {
  field: string;
  tier: 'direct_versioned' | 'requires_review' | 'never_direct';
  label: string;
  surface:
    | 'build'
    | 'faq'
    | 'reward_package'
    | 'reservation'
    | 'agreement'
    | 'campaign'
    | 'demo_moment'
    | 'benefit_card';
  reason: string;
  specRef: string;
}

export interface LiveEditRow {
  id: string;
  surface: string;
  field: string;
  priorValue: unknown;
  newValue: unknown;
  targetId: string | null;
  occurredAt: string;
}

export interface ChangeRequestRow {
  id: string;
  surface: string;
  field: string;
  targetId: string | null;
  currentValue: unknown;
  requestedValue: unknown;
  reason: string;
  status: string;
  decisionReason: string | null;
  createdAt: string;
}

export type LiveEditApplied =
  | { ok: true; tier: 'direct_versioned'; edit: LiveEditRow }
  | {
      ok: true;
      tier: 'requires_review';
      request: ChangeRequestRow;
      /**
       * Named when a COLUMN-ONE edit was redirected here by §20's loophole
       * check. `faq_commitment` is §20's own example; `field_commitment` is the
       * same rule on another column-one free-text field.
       */
      redirectedBy: 'faq_commitment' | 'field_commitment' | null;
      commitments: string[];
    };

export interface LiveEditHistory {
  edits: LiveEditRow[];
  requests: ChangeRequestRow[];
}

export const fetchEditableFields = (
  campaignId: string,
): Promise<{ fields: EditableFieldView[] }> => call(`${base(campaignId)}/live-edit/fields`);

/**
 * The ONE Founder edit route (§20). There is deliberately no `tier` in the body
 * and none in this signature: the field's own tier decides whether the value is
 * written, routed to Admin review, or refused. A route per tier — or a tier
 * parameter — would let a caller choose which rules apply to their edit by
 * choosing what to send, which is exactly what §20's three columns exist to
 * prevent (§15: materiality is an Admin judgement, never the Founder's).
 */
export const applyLiveEdit = (
  campaignId: string,
  body: {
    surface: EditableFieldView['surface'];
    field: string;
    value: unknown;
    targetId?: string;
    reason?: string;
  },
): Promise<LiveEditApplied> =>
  call(`${base(campaignId)}/live-edit`, { method: 'POST', body: JSON.stringify(body) });

export const fetchLiveEditHistory = (campaignId: string): Promise<LiveEditHistory> =>
  call(`${base(campaignId)}/live-edit/history`);

/* ── §21 Founder results (Phase 18b) ───────────────────────────────────────── */

export interface FounderResultsView {
  campaignId: string;
  campaignTitle: string;
  model: 'idea' | 'product';
  state: 'preparing' | 'ready';
  campaignStatus: string;
  closedAt: string | null;
  threshold: { required: number; uniqueActiveBackers: number; met: boolean } | null;
  preorders: { placed: number; captured: number; canceled: number; noCharge: number };
  uniqueBackers: number;
  productTransactions: { transactions: number; units: number } | null;
  money: {
    rewardSubtotalCapturedCents: string;
    salesTaxCapturedCents: string;
    totalCapturedCents: string;
  };
  payments: { failed: number; recovered: number; dropped: number };
  /**
   * §21's one recovery window, read from the close batch (Session E). Every
   * field is stored and immutable — the surface renders the deadline, never a
   * duration it worked out from a start time.
   */
  retryWindow: {
    state: 'not_opened' | 'open' | 'closed';
    windowHours: number;
    firstFailureAt: string | null;
    deadlineAt: string | null;
  } | null;
  conversion: {
    clicks: number;
    placed: number;
    conversionRate: string | null;
    canceled: number;
    dropOffRate: string | null;
  };
  survey: {
    consentedCount: number;
    totalPreorderCount: number;
    averageRecommend: string | null;
    reasons: string[];
  };
  perCreator: Array<{
    associationId: string;
    handle: string | null;
    clicks: number;
    attributedPlaced: number;
    attributedCaptured: number;
    capturedSubtotalCents: string;
    provisionalCents: string;
    lockedPercent: number | null;
  }>;
  revenueBySource: { creatorAttributedCents: string; directCents: string; note: string };
  bonuses: Array<{ associationId: string; earnedPercent: number | null; status: string }>;
  finalization: {
    creatorEarnings: 'pending';
    note: string;
    fixedPayments: Array<{ associationId: string; status: string }>;
  };
  narrative: {
    strongestSignal: string;
    weakestSignal: string;
    leadingSurveyReason: string;
    whatThisProves: string;
    whatThisDoesNotProve: string;
    reviewedBy: string;
    preparedAt: string;
  } | null;
  preparing: { whatHappened: string; whatNext: string; owner: string } | null;
}

export const fetchCampaignResults = (
  campaignId: string,
): Promise<{ results: FounderResultsView }> => call(`${base(campaignId)}/results`);

/* ── §22.3 Founder payment status (Phase 19b) ──────────────────────────────── */

export interface FounderPaymentLineView {
  kind: 'single_payment' | 'first_payment' | 'remaining_payment';
  label: string;
  percent: number;
  amountCents: string;
  amountExact: boolean;
  status: 'blocked' | 'eligible' | 'released';
  blockers: string[];
  secureAction: string | null;
  noActionNeeded: boolean;
  dueAt: string;
  releasedAt: string | null;
  releasedEarly: boolean;
}

export interface FounderPaymentStatusView {
  campaignId: string;
  model: 'idea' | 'product';
  campaignStatus: string;
  closedAt: string | null;
  currency: 'USD';
  applicable: boolean;
  notApplicableReason: string | null;
  w9: {
    state: 'not_requested' | 'requested' | 'submitted' | 'verified';
    line: string;
    action: string;
    requestedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    returnReason: string | null;
    blocksPayments: boolean;
  };
  eligibleShare: {
    exact: boolean;
    amountCents: string;
    note: string;
    basis: {
      rewardSubtotalCapturedCents: string;
      proovdFeeCents: string;
      finalizedCreatorCompensationCents: string;
      causeBasedAdjustmentsCents: string;
      stripeFeesAllocatedToFounderCents: string;
    };
  };
  payments: FounderPaymentLineView[];
  nextReviewDate: string | null;
  day14: { dueAt: string; line: string } | null;
  earlyRelease: {
    settingEnabled: boolean;
    evidence: { id: string; recordedAt: string; missingFacts: string[] } | null;
    pendingRequest: { id: string; createdAt: string } | null;
    neverSkipsDay14: string;
  } | null;
}

export const fetchFounderPayments = (
  campaignId: string,
): Promise<{ payments: FounderPaymentStatusView }> => call(`${base(campaignId)}/payments`);

export const requestEarlyRemainingRelease = (
  campaignId: string,
  message: string,
): Promise<{ request: { id: string } }> =>
  call(`${base(campaignId)}/early-remaining-request`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

/* ── Phase 21a (§22.4–§22.6) — fulfillment, delivery changes, Day 14 ───────── */

export interface ObligationStatusView {
  key: string;
  label: string;
  evidence: string;
  state: 'met' | 'due' | 'overdue' | 'not_applicable';
  dueAt: string | null;
  detail: string;
}

export interface DeliveryCommitmentView {
  sequence: number;
  deliveryMonth: string;
  deliveryDate: string | null;
  commitmentText: string;
  reason: string | null;
  path: string | null;
  notifiedBackersAt: string | null;
  isOriginal: boolean;
}

export interface FulfillmentStatusView {
  campaignId: string;
  campaignType: 'pre_build' | 'pre_launch';
  mechanism: string | null;
  mechanismLabel: string | null;
  accessInstructions: string | null;
  deliveredAt: string | null;
  deliveryNotifiedAt: string | null;
  fulfilledAt: string | null;
  closeAt: string | null;
  chargedAt: string | null;
  obligations: ObligationStatusView[];
  cadence: {
    state: 'met' | 'due' | 'overdue' | 'not_applicable';
    nextDueAt: string | null;
    daysSinceLastCommunication: number | null;
    silentDays: number;
  };
  commitments: DeliveryCommitmentView[];
  changePath: 'admin_preapproval' | 'notice_before_original_month';
  pendingChangeRequest: {
    id: string;
    reviewDueAt: string;
    proposedDeliveryMonth: string;
  } | null;
  mechanisms: { key: string; label: string }[];
  materialUpdateFields: { key: string; label: string }[];
  disclosedCommitmentSuggestion: string | null;
}

export interface Day14ChecklistView {
  campaignId: string;
  campaignType: 'pre_build' | 'pre_launch';
  items: { key: string; label: string; example: string; required: boolean }[];
  reviewOpen: boolean;
  outcome: string;
  decisionDueAt: string | null;
  blocksAPayment: boolean;
  enforcementOnly: boolean;
  submissions: {
    id: string;
    reference: string;
    submittedAt: string;
    submittedBy: string;
    decisionDueAt: string;
    items: { itemKey: string; label: string; detail: string; url: string | null }[];
  }[];
  clarifications: {
    id: string;
    question: string;
    requestedAt: string;
    dueAt: string;
    respondedAt: string | null;
    responseNote: string | null;
    overdue: boolean;
  }[];
}

export const fetchFulfillment = (
  campaignId: string,
): Promise<FulfillmentStatusView> => call(`${base(campaignId)}/fulfillment`);

export const recordOriginalCommitment = (
  campaignId: string,
  body: { deliveryMonth: string; deliveryDate?: string | null; commitmentText: string },
): Promise<{ status: string }> =>
  call(`${base(campaignId)}/fulfillment/commitment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const setDeliveryMechanism = (
  campaignId: string,
  body: { mechanism: string; accessInstructions: string },
): Promise<{ status: string }> =>
  call(`${base(campaignId)}/fulfillment/mechanism`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const recordDelivery = (
  campaignId: string,
): Promise<{ status: string; notified: number }> =>
  call(`${base(campaignId)}/fulfillment/deliver`, { method: 'POST', body: JSON.stringify({}) });

export interface DeliveryChangeBody {
  proposedDeliveryMonth: string;
  proposedDeliveryDate?: string | null;
  reason: string;
  unchangedObligations: string;
  nextUpdateDate: string;
  supportRefundRoute: string;
}

export const requestDeliveryChange = (
  campaignId: string,
  body: DeliveryChangeBody,
): Promise<{ status: string; requestId?: string; reviewDueAt?: string }> =>
  call(`${base(campaignId)}/delivery-change`, { method: 'POST', body: JSON.stringify(body) });

export const applyDeliveryRevision = (
  campaignId: string,
  body: DeliveryChangeBody & { commitmentText: string; changeRequestId?: string | null },
): Promise<{ status: string; commitmentId?: string }> =>
  call(`${base(campaignId)}/delivery-revision`, { method: 'POST', body: JSON.stringify(body) });

export const fetchDay14 = (campaignId: string): Promise<Day14ChecklistView> =>
  call(`${base(campaignId)}/day-14`);

export const submitDay14Evidence = (
  campaignId: string,
  items: { itemKey: string; detail: string; url?: string | null }[],
): Promise<{ status: string; reference?: string; decisionDueAt?: string }> =>
  call(`${base(campaignId)}/day-14/evidence`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });

/**
 * §22.4's clarification answer (Founder Dashboard Session E).
 *
 * `POST …/day-14/clarification` has been mounted and driven by Phase 21a's own
 * suite since it was built; it had no client and no control anywhere. The
 * fulfillment surface rendered the question, told the Founder that not
 * answering within five business days is one of the things that fails the
 * review, and offered nothing to answer with — on a review whose failure
 * blocks a payment.
 */
export const respondToDay14Clarification = (
  campaignId: string,
  requestId: string,
  responseNote: string,
): Promise<{ status: string }> =>
  call(`${base(campaignId)}/day-14/clarification`, {
    method: 'POST',
    body: JSON.stringify({ requestId, responseNote }),
  });

/* ── Chapter 4, Wrap, and the Backers page (Session F) ─────────────────────── */

export interface WrapCreatorRow {
  associationId: string;
  publicHandle: string | null;
  subtype: string | null;
  audienceNiche: string | null;
  adminBio: string | null;
  status: string;
  rosterMembership: string;
  completion: {
    status: 'successfully_completed' | 'completion_disqualified';
    decidedAt: string;
    reason: string | null;
  } | null;
  workAgain: {
    eligible: boolean;
    request: {
      id: string;
      status: string;
      requestedAt: string;
      responseNote: string | null;
    } | null;
  };
}

export interface FounderWrapView {
  campaignId: string;
  campaignStatus: string;
  closedAt: string | null;
  resolution: {
    resolved: boolean;
    resolvedAt: string | null;
    fulfillmentNote: string;
    fulfillmentActive: boolean;
    fulfilledAt: string | null;
  };
  creators: WrapCreatorRow[];
  nextCampaign: {
    cooldown: {
      months: number | null;
      closedAt: string | null;
      earliestAt: string | null;
      elapsed: boolean;
      blocker: string | null;
    };
    adminReadiness: {
      decision: 'ready' | 'not_ready' | null;
      decidedAt: string | null;
      explanation: string | null;
    };
    readyForNextCampaign: boolean;
    prepareNote: string;
  };
}

export const fetchFounderWrap = (campaignId: string): Promise<{ wrap: FounderWrapView }> =>
  call(`${base(campaignId)}/wrap`);

/** §22.9's ask, on the Creator recap. `WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING` rides the answer. */
export const requestWorkAgain = (
  campaignId: string,
  associationId: string,
  message: string,
): Promise<{ requestId: string; grantsNothing: readonly string[] }> =>
  call(`/api/founder/campaigns/${encodeURIComponent(campaignId)}/work-again`, {
    method: 'POST',
    body: JSON.stringify({ associationId, message }),
  });

export interface FounderBackerRow {
  preorderReference: string;
  backerEmail: string;
  rewardSku: string;
  rewardTitle: string;
  fulfillmentState: 'active' | 'do_not_fulfill';
  doNotFulfillLabel: string | null;
  doNotFulfillAt: string | null;
  sharedAt: string;
  progressionStep: string;
  progressionLabel: string;
}

export interface BackerDataRequestRow {
  id: string;
  purpose: string;
  detail: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface FounderBackersView {
  campaignId: string;
  sharedCount: number;
  activeCount: number;
  doNotFulfillCount: number;
  rows: FounderBackerRow[];
  exportColumns: { key: string; header: string; definition: string }[];
  exportWithheld: { header: string; reason: string }[];
  dataRequests: BackerDataRequestRow[];
}

export const fetchFounderBackers = (
  campaignId: string,
): Promise<{ backers: FounderBackersView }> => call(`${base(campaignId)}/backers`);

/**
 * §25.7's ask. The purpose is one of §25.7's two; marketing and community are
 * refused before the request is composed, and refused again by a 0058 CHECK.
 */
export const requestBackerData = (
  campaignId: string,
  purpose: string,
  detail: string,
): Promise<{ requestId: string }> =>
  call(`${base(campaignId)}/backer-data-request`, {
    method: 'POST',
    body: JSON.stringify({ purpose, detail }),
  });

/**
 * §20's Explore section 10. The address is a plain GET the browser follows —
 * the CSV is composed on the SERVER from `FOUNDER_EXPORT_COLUMNS`, so there is
 * nothing here that could choose a column, and no client-side assembly that
 * could quietly include one the register withholds.
 */
export const founderBackerExportPath = (campaignId: string): string =>
  `${base(campaignId)}/backers/export`;

/* ── Session G: §5.2's account-level settings ─────────────────────────────── */

export interface FounderSettingsFieldValue {
  id: string;
  value: string | null;
  guarded: boolean;
}

export interface FounderSettingsView {
  campaignId: string;
  campaignTitle: string | null;
  signInEmail: string | null;
  accountCreatedAt: string | null;
  fields: FounderSettingsFieldValue[];
  representations: { id: string; label: string; confirmed: boolean }[];
  dateOfBirthOnFile: boolean;
  country: string | null;
  stateRegion: string | null;
  soleProprietor: boolean | null;
  w9: {
    state: string;
    line: string;
    action: string;
    requestedAt: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    returnReason: string | null;
    blocksPayments: boolean;
  } | null;
  w9NotApplicableBecause: string | null;
  deletionRequestedAt: string | null;
}

/**
 * Account-level, so no campaign id anywhere in the path.
 *
 * A Founder with two campaigns has two `founder_claim_profiles` rows; the
 * server picks the most recent, which is the same row the Admin workspace
 * edits. A campaign parameter here would let the two disagree about which
 * record a phone number lives on.
 */
export const fetchFounderSettings = (): Promise<{ settings: FounderSettingsView }> =>
  call('/api/founder/settings');

/**
 * One registered field, with the reason §25.6 requires on a claimed account.
 *
 * The field id is in the path and the server validates it against the register
 * — there is no way to name a column from here, which is 16a's rule applied to
 * a customer-facing correction.
 */
export const correctFounderField = (
  fieldId: string,
  value: string | null,
  reason: string,
): Promise<{ settings: FounderSettingsView }> =>
  call(`/api/founder/settings/fields/${encodeURIComponent(fieldId)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });

/**
 * §5.2's password, through the wrapper that forces `revokeOtherSessions` and
 * writes the §25.6 row. The browser never calls `/api/auth/change-password`
 * directly, and it never calls `update-user` at all.
 */
export const changeFounderPassword = (
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true }> =>
  call('/api/founder/settings/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

/**
 * §5.2's delete-account request. It records an ask onto 0040's insert-only
 * record and erases nothing — there is no approval state to poll and no purge
 * date to render, because neither exists.
 */
export const requestFounderDeletion = (
  requestDetail: string,
): Promise<{ settings: FounderSettingsView }> =>
  call('/api/founder/settings/deletion-request', {
    method: 'POST',
    body: JSON.stringify({ requestDetail }),
  });

/**
 * The password, chosen at the END of the onboarding flow (2026-08-20).
 *
 * Not `changeFounderPassword`: there is no current password to present. The
 * account was created by submitting the §9 answers — §13's Stripe account is
 * keyed to a real user, so it could not wait for a credential — and the one it
 * holds until this call is random bytes the server generated and discarded.
 * `backend/src/vetting/claim.ts` records why in full.
 */
export const setInitialPassword = (
  campaignId: string,
  password: string,
): Promise<{ ok: true }> =>
  call('/api/founder/settings/initial-password', {
    method: 'POST',
    body: JSON.stringify({ campaignId, password }),
  });
