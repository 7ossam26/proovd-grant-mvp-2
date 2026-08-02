/**
 * The campaign page's view model — Spec §18's campaign page content order and
 * campaign-type difference table.
 *
 * Phase 05 renders two samples from static fixtures; Phase 14 renders approved
 * live campaigns from the database. The shape is defined here now, in §18's own
 * terms, so Phase 14 inherits a structure that already carries every required
 * element rather than growing one field at a time.
 *
 * Naming is §3.1 throughout: the URLs may keep `sample-pre-build` and
 * `sample-pre-launch`, but nothing in the rendered model does. `model` is
 * `idea` / `product`, never `pre_build` / `pre_launch`; a saved-card commitment
 * is a pre-order, never a reservation.
 */

import type { AttributionStatus } from '@proovd/shared';

export type CampaignModel = 'idea' | 'product';

/**
 * §18's ended-state kinds. A real campaign renders one when it is no longer
 * open; a sample or preview never does. The page composes outcome-specific copy
 * from the kind — §18 forbids one generic "Campaign ended" message.
 */
export type EndedKind = 'closed' | 'no_charge' | 'suspended' | 'killed';

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
  /** The route slug. §3.1 permits `sample-pre-build` / `sample-pre-launch` here. */
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
  /** §18's attribution banner, or null when no Creator link is attributed. */
  attribution?: AttributionBanner | null;
  /**
   * §18 discovery: false renders the page `noindex` during Days 1–7. Absent on
   * samples (which are never indexable anyway) and the preview.
   */
  indexable?: boolean;
}

export function findReward(campaign: CampaignView, sku: string): RewardPackage {
  const reward = campaign.rewards.find((r) => r.sku === sku);
  if (!reward) throw new Error(`campaign ${campaign.slug} has no reward ${sku}`);
  return reward;
}
