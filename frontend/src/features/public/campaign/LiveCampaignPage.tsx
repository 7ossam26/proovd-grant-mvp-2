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
import { MagicLinkRequest } from './MagicLinkRequest.js';
import { Section, Measure } from '../../../components/index.js';
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
      badge: r.badge,
      limitedQuantity: r.limitedQuantity,
      remaining: r.remaining,
    })),
    featuredRewardSku,
    // Real tax is calculated at checkout for the Backer's address (Phase 15);
    // the real page renders no consent-with-amounts, so this is unused.
    sampleSalesTaxCents: 0n,
    orderThreshold: p.orderThreshold,
    // §21's own threshold measure — distinct Backers behind the active
    // pre-orders — composed from the append-only transition history (17a).
    //
    // This was hardcoded `null` from Phase 14b with the comment "needs
    // reservation counts (Phase 15)". Phase 15 shipped, and the null stayed:
    // no real Idea campaign has ever drawn a progress bar, and the threshold
    // panel is the largest single section of the rebuilt page.
    thresholdProgress: p.model === 'idea' ? p.preorderCounts.uniqueActiveBackers : null,
    // §18's Product hero: unique Backers and units reserved, never a public
    // dollar gate. `activeCount` is units; `uniqueActiveBackers` is people, and
    // they differ because a Product Backer may hold several transactions (§4.2).
    // Null on an Idea campaign, which has the threshold panel instead.
    momentum:
      p.model === 'product'
        ? {
            uniqueBackers: p.preorderCounts.uniqueActiveBackers,
            unitsReserved: p.preorderCounts.activeCount,
          }
        : null,
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
    endedExplanation: res.ended?.explanation ?? null,
    attribution: res.attribution,
    indexable: res.indexable,
    updates: res.updates,
    // The rebuilt page's own copy. Absent means the section does not render.
    heroHeadline: p.heroHeadline,
    heroHeadlineAccent: p.heroHeadlineAccent,
    founderPullQuote: p.founderPullQuote,
    platformLine: p.platformLine,
    demoContextLabel: p.demoContextLabel,
    benefitsHeading: p.benefitsHeading,
    rewardsHeading: p.rewardsHeading,
    updatesHeading: p.updatesHeading,
    faqHeading: p.faqHeading,
    demoMoments: p.demoMoments,
    benefitCards: p.benefitCards.map((c) => ({
      ...c,
      visualVariant: c.visualVariant as 'bars' | 'check' | 'dots',
    })),
    preorderCounts: p.preorderCounts,
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
  return (
    <>
      <CampaignPage campaign={state.view} checkout={{ campaignId }} />
      {/*
        §5.5 (Phase 22b). The recovery path for a Backer whose magic link
        expired — on the campaign page because the campaign is the one thing
        they can always find again, and because `/link-unavailable` is shared
        by every token kind and deliberately varies on nothing. Present on an
        ended campaign too: a Backer whose charge failed needs it most there.
      */}
      <Section breathe>
        <Measure>
          <MagicLinkRequest campaignId={campaignId} />
        </Measure>
      </Section>
    </>
  );
}
