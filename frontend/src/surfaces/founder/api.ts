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

export const saveWorkspace = (
  campaignId: string,
  patch: WorkspacePatch,
): Promise<{ workspace: WorkspaceState }> =>
  call(`${base(campaignId)}/workspace`, { method: 'PATCH', body: JSON.stringify(patch) });

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
}

export interface RosterView {
  responseDeadlineAt: string | null;
  fullRefundOutcome: string;
  pendingProposalNote: string;
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
  sortOrder: number;
}

export interface ReviewReadiness {
  rosterStatus: string;
  buildStatus: string;
  reviewReady: boolean;
}

export interface BuildState {
  build: BuildFields | null;
  rewardPackages: RewardPackageView[];
  faqs: Array<{ id: string; question: string; answer: string }>;
  buildStatus: string;
  missing: string[];
  campaignStatus: string;
  reviewReadiness: ReviewReadiness;
}

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
  },
): Promise<{ package: RewardPackageView }> =>
  call(`${base(campaignId)}/build/rewards`, { method: 'PUT', body: JSON.stringify(reward) });

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
    sku: string;
    title: string;
    priceCents: string;
    contents: string[];
    delivery: string;
    fulfillment: string;
    limitedQuantity: number | null;
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
