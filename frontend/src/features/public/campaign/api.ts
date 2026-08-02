/**
 * The public campaign data client — Spec §18 (Phase 14b).
 *
 * `GET /api/campaign/:campaignId` returns the Backer-facing view, the ended
 * state, whether the page is indexable yet, and the attribution the visitor's
 * cookie resolves to. The request carries credentials so the first-party
 * attribution cookie reaches the server (it is HttpOnly and read there).
 */

import type { AttributionStatus } from '@proovd/shared';
import type { EndedKind, CampaignUpdate } from './types.js';

export interface PublicCampaignPayload {
  campaignId: string;
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
  }>;
  featuredRewardSku: string | null;
  orderThreshold: number | null;
  statementDescriptor: string;
  story: string | null;
  faq: Array<{ question: string; answer: string }>;
  refundSummary: string[];
  founderRefundPolicy: {
    title: string;
    version: string;
    effectiveDate: string;
    text: string | null;
  } | null;
  commentsEnabled: boolean;
}

export interface LiveCampaignResponse {
  campaign: PublicCampaignPayload;
  ended: { kind: EndedKind } | null;
  indexable: boolean;
  attribution: { handle: string | null; status: AttributionStatus } | null;
  updates: CampaignUpdate[];
}

/** The campaign, or null when there is no public page at this id (404). */
export async function fetchLiveCampaign(campaignId: string): Promise<LiveCampaignResponse | null> {
  const res = await fetch(`/api/campaign/${encodeURIComponent(campaignId)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`campaign_fetch_failed:${res.status}`);
  return (await res.json()) as LiveCampaignResponse;
}
