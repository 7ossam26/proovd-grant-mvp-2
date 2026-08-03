/**
 * The live campaign page — Spec §18, §33.6 (Phase 14b).
 *
 * `/campaign/:campaignId` for an approved, live (or ended) campaign. It fetches
 * the Backer-facing view from the public endpoint, assembles the same
 * `CampaignView` the samples render, and hands it to the one `CampaignPage`
 * component — so a real campaign and a sample render through identical code, and
 * the attribution banner, the ended state, and the noindex switch ride along on
 * the view.
 *
 * A visitor arriving through a Creator's link was redirected here by `/c/:code`
 * *after* the winner cookie was set, so the fetch below already carries it and
 * the endpoint resolves "You came through [handle]".
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CampaignPage } from './CampaignPage.js';
import { NotFoundSurface, PageLoading } from '../states.js';
import { fetchLiveCampaign, type LiveCampaignResponse } from './api.js';
import type { CampaignView } from './types.js';

/** Assembles the `CampaignView` from the public payload, or null if incomplete. */
function toCampaignView(res: LiveCampaignResponse): CampaignView | null {
  const p = res.campaign;
  // A live campaign always has dates and at least one reward (launch requires a
  // close date, and review requires rewards). If any is missing, there is no
  // coherent page to render.
  if (!p.opensAt || !p.closesAt || p.rewards.length === 0) return null;
  const featuredRewardSku = p.featuredRewardSku ?? p.rewards[0]!.sku;

  const founderRefundPolicy =
    p.model === 'product' && p.founderRefundPolicy && p.founderRefundPolicy.title && p.founderRefundPolicy.effectiveDate
      ? {
          title: p.founderRefundPolicy.title,
          version: p.founderRefundPolicy.version,
          effectiveDate: p.founderRefundPolicy.effectiveDate,
          anchor: '#founder-refund-policy',
          summary: p.founderRefundPolicy.text ? [p.founderRefundPolicy.text] : [],
        }
      : null;

  return {
    slug: p.campaignId,
    model: p.model,
    title: p.title,
    tagline: p.tagline,
    founder: p.founder,
    opensAt: new Date(p.opensAt),
    closesAt: new Date(p.closesAt),
    rewards: p.rewards.map((r) => ({
      sku: r.sku,
      title: r.title,
      priceCents: BigInt(r.priceCents),
      contents: r.contents,
      delivery: r.delivery,
      fulfillment: r.fulfillment,
    })),
    featuredRewardSku,
    // Real tax is calculated at checkout for the Backer's address (Phase 15);
    // the real page renders no consent-with-amounts, so this is unused.
    sampleSalesTaxCents: 0n,
    orderThreshold: p.orderThreshold,
    // Live threshold progress needs reservation counts (Phase 15); null renders
    // the requirement without a count rather than a fabricated one.
    thresholdProgress: null,
    momentum: null,
    statementDescriptor: p.statementDescriptor,
    story: p.story
      ? [{ heading: 'The story', paragraphs: p.story.split('\n\n').filter((s) => s.trim().length > 0) }]
      : [],
    faq: p.faq,
    refundSummary: p.refundSummary,
    founderRefundPolicy,
    commentsEnabled: p.commentsEnabled,
    isSample: false,
    ended: res.ended?.kind ?? null,
    attribution: res.attribution,
    indexable: res.indexable,
    updates: res.updates,
  };
}

export function LiveCampaignPage() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'not_found' }
    | { status: 'ready'; view: CampaignView }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetchLiveCampaign(campaignId);
        if (cancelled) return;
        const view = res ? toCampaignView(res) : null;
        setState(view ? { status: 'ready', view } : { status: 'not_found' });
      } catch {
        if (cancelled) return;
        setState({ status: 'not_found' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (state.status === 'loading') return <PageLoading />;
  if (state.status === 'not_found') return <NotFoundSurface />;
  // §19: a real live campaign gets the pre-order checkout. Samples never do.
  return <CampaignPage campaign={state.view} checkout={{ campaignId }} />;
}
