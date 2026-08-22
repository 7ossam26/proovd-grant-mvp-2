/**
 * The campaign page's view model — Spec §18's campaign page content order and
 * campaign-type difference table.
 *
 * Approved live campaigns render from the database. Test-only fixtures use the
 * same contract so campaign-page verification exercises the production
 * component without shipping invented campaigns in the production route table.
 *
 * Naming is §3.1 throughout: `model` is `idea` / `product`, never
 * `pre_build` / `pre_launch`; a saved-card commitment
 * is a pre-order, never a reservation.
 */

import type { AttributionStatus, UpdateAudience } from '@proovd/shared';

export type CampaignModel = 'idea' | 'product';

/** §18 item 12 — a published campaign update, as the public page renders it. */
export interface CampaignUpdate {
  id: string;
  audience: UpdateAudience;
  title: string | null;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  /** ISO instant; rendered local-primary with UTC secondary (§27.1). */
  publishedAt: string;
  isMaterialDeliveryChange: boolean;
  priorCommitment: string | null;
  revisedCommitment: string | null;
  /**
   * The headline metric the rebuilt page renders beside the body (0049).
   *
   * Both halves or neither — a database CHECK, because a bare `86%` is nothing
   * to a screen reader and a label with no value is an empty promise. The page
   * renders the label as the number's own accessible name for that reason.
   */
  metricLabel?: string | null;
  metricValue?: string | null;
}

/**
 * §18/§33.9.9's ended-state kinds (Phase 20b widened them). A real campaign
 * renders one when it is no longer open; a sample or preview never does. The
 * page composes outcome-specific copy from the kind — §18 forbids one generic
 * "Campaign ended" message, and §33.9.9 requires a threshold miss, a natural
 * close, a pre-charge kill, and a post-charge suspension to be told apart.
 */
export type EndedKind =
  | 'closed'
  | 'threshold_not_met'
  | 'canceled_before_charge'
  | 'suspended_before_charge'
  | 'suspended_after_charge'
  | 'killed_before_charge'
  | 'killed_after_charge';

/** §18: "Creator-link arrival shows `You came through [handle]`." */
export interface AttributionBanner {
  handle: string | null;
  status: AttributionStatus;
}

export interface RewardPackage {
  /** §18 item 3: title/SKU. */
  sku: string;
  title: string;
  /** §18: pre-tax USD price, integer cents (§24.3). Tax is added at checkout. */
  priceCents: bigint;
  /** Exact contents. */
  contents: readonly string[];
  /**
   * §18 campaign-type table. Idea: a delivery window. Product: a specific
   * month and year.
   */
  delivery: string;
  /** How the digital reward actually reaches the Backer (§31.4 Fulfillment). */
  fulfillment: string;
  /** The tier badge — `Lowest price`, `Best value` (0049). Null renders none. */
  badge?: string | null;
  /**
   * §14.4's own field, which the public payload used to drop.
   *
   * Null means unlimited, and the page renders NO remaining line for it — never
   * the word "unlimited", which would be a scarcity signal invented where the
   * record has none (§30). `remaining` is null in exactly the same case, and a
   * `remaining` of 0 renders the reward visible and unavailable (§19), never
   * hidden.
   */
  limitedQuantity?: number | null;
  remaining?: number | null;
}

/**
 * One moment of the interactive demo stage (campaign page v2).
 *
 * A moment is a passive **signal** or one **action**, never both — a database
 * CHECK, because the two render differently and mean different things.
 */
export interface DemoMoment {
  id: string;
  timeLabel: string;
  momentLabel: string;
  stateWord: string;
  headline: string;
  signalText: string | null;
  isAction: boolean;
  actionLabel: string | null;
}

/** The three benefit-card treatments, named by shape rather than by copy (§30). */
export type BenefitVisualVariant = 'bars' | 'check' | 'dots';

export interface BenefitCard {
  id: string;
  title: string;
  footerWord: string;
  visualVariant: BenefitVisualVariant;
}

/** §18 item 2. */
export interface FounderIdentity {
  legalName: string;
  /** Entity name, or the literal `sole proprietor`. */
  entity: string;
  country: string;
  profile: string;
}

export interface StorySection {
  heading: string;
  paragraphs: readonly string[];
}

export interface FaqEntry {
  question: string;
  answer: string;
}

/** §18 item 5 — the campaign-specific Founder refund policy, Product only. */
export interface FounderRefundPolicy {
  title: string;
  version: string;
  /** ISO calendar date. */
  effectiveDate: string;
  /** In-page anchor where the preserved version is reproduced. */
  anchor: string;
  summary: readonly string[];
}

export interface CampaignView {
  /** The public campaign identifier. */
  slug: string;
  model: CampaignModel;
  title: string;
  tagline: string;
  founder: FounderIdentity;

  opensAt: Date;
  closesAt: Date;

  rewards: readonly RewardPackage[];
  /** The reward the consent preview is written against. */
  featuredRewardSku: string;
  /**
   * Sales tax on the featured reward, for the consent preview only. On a real
   * campaign this is calculated at checkout for the Backer's billing address
   * (§19); a sample has no Backer and no address, so this is sample data and is
   * labelled as such wherever it renders.
   */
  sampleSalesTaxCents: bigint;

  /** §18 item 6 — Idea Campaigns only; hidden entirely on a Product Campaign. */
  orderThreshold: number | null;
  /** Sample progress toward the threshold, in unique Backers. Idea only. */
  thresholdProgress: number | null;

  /**
   * §18: a Product Campaign hero may show unique Backers and units reserved.
   * Never a public dollar gate that suggests a refund threshold.
   */
  momentum: { uniqueBackers: number; unitsReserved: number } | null;

  /** §24.12 — the validated value, shown identically everywhere it appears. */
  statementDescriptor: string;

  story: readonly StorySection[];
  faq: readonly FaqEntry[];
  /** §18 item 5 of the difference table. */
  refundSummary: readonly string[];
  founderRefundPolicy: FounderRefundPolicy | null;

  commentsEnabled: boolean;

  /** Renders the permanent Appendix A.6 banner and mounts no payment field. */
  isSample: boolean;

  /* ── Real live campaigns only (Phase 14b). Absent on samples/preview ──────── */

  /**
   * §18's ended state, or null while the campaign is open. When set, the page
   * disables the pre-order action and renders outcome-specific ended copy.
   */
  ended?: EndedKind | null;
  /**
   * The Admin-recorded §26.7 customer explanation behind a suspension/kill —
   * the server refused it if it carried a raw provider code (§33.9.11). Null
   * for non-enforcement outcomes.
   */
  endedExplanation?: string | null;
  /** §18's attribution banner, or null when no Creator link is attributed. */
  attribution?: AttributionBanner | null;
  /**
   * §18 discovery: false renders the page `noindex` during Days 1–7. Absent on
   * samples (which are never indexable anyway) and the preview.
   */
  indexable?: boolean;
  /** §18 item 12 — the public updates. Absent on samples (which have none). */
  updates?: readonly CampaignUpdate[];

  /* ── The rebuilt page's own copy and content (campaign page v2) ───────────
   *
   * Every one is optional, and absent means the section it would have filled
   * does not render — never an empty heading and never a placeholder (§1.4,
   * §33.11.3). That is also why they are `?`-optional rather than
   * `| null`-required: the samples, the Founder preview, and the live page each
   * carry what they have, and nothing has to invent a null to satisfy a type.
   */
  heroHeadline?: string | null;
  heroHeadlineAccent?: string | null;
  founderPullQuote?: string | null;
  platformLine?: string | null;
  demoContextLabel?: string | null;
  benefitsHeading?: string | null;
  rewardsHeading?: string | null;
  updatesHeading?: string | null;
  faqHeading?: string | null;
  demoMoments?: readonly DemoMoment[];
  benefitCards?: readonly BenefitCard[];
  /**
   * §20's composed pre-order counts, for the threshold panel and the "N people
   * reserved" line.
   *
   * §30: rendered only where a real record produced it. Zero renders "Be the
   * first" — never a fabricated number and never a rounded-up one.
   */
  preorderCounts?: { uniqueActiveBackers: number; activeCount: number } | null;
}

export function findReward(campaign: CampaignView, sku: string): RewardPackage {
  const reward = campaign.rewards.find((r) => r.sku === sku);
  if (!reward) throw new Error(`campaign ${campaign.slug} has no reward ${sku}`);
  return reward;
}
