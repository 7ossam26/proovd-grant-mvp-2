/**
 * §20 Explore — the complete supporting data — Spec §20, §33.6.8 (Phase 17a).
 *
 * DNA §5.2: "moving something to Explore is not hiding it. Explore is a
 * first-class space where power users live." So this is not a leftovers bin and
 * it is not a widget grid — it is §20's eleven bullets, in §20's order, each one
 * carrying the definition of what its numbers count and the time they were read.
 *
 * ── Why every section states a definition ───────────────────────────────────
 * §20's last Explore bullet is "Data definitions and freshness", which is easy to
 * read as one extra panel at the bottom. Making it a field on every section
 * instead is the difference between a page that has definitions somewhere and a
 * page where no number can be read without one. Two people reading "conversion"
 * differently is the ordinary failure of a metrics screen.
 *
 * ── Not yet populated is not zero (§1.4) ────────────────────────────────────
 * The 16a rule, applied here. A section whose phase has not run says so and names
 * what it is waiting for — earnings and payouts are Phase 19's, comments are
 * 17b's. A zero would be indistinguishable from a real zero, and only one of the
 * two is a fact.
 *
 * ── What Explore may hand out is not what it may show (§25.7) ───────────────
 * The Founder is not Admin, and §11's boundary still holds: the roster projection
 * carries public handles and never an email, legal name, quality tier, or
 * verification evidence. Survey answers appear only where the Backer consented
 * (§19 step 8). The export section names the withheld columns before anything is
 * downloaded, exactly as 16a's ledger export does.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { readPreorderCounts, type PreorderCounts } from './counts.js';
import { EXPLORE_SECTION_KEYS, type ExploreSectionKey } from './logic.js';

export interface ExploreSection {
  key: ExploreSectionKey;
  title: string;
  /** §20's last bullet, made structural: what these numbers count. */
  definition: string;
  /**
   * `null` when the phase that fills this section has not run. Named rather than
   * zeroed — §1.4 forbids implying an answer the system does not have.
   */
  data: Record<string, unknown> | null;
  /** When `data` is null, what it is waiting for. */
  awaiting: string | null;
}

export interface ExploreView {
  sections: ExploreSection[];
  /** §20: freshness. The surface renders `Updated 3:40 PM`. Never "real time". */
  readAt: string;
  freshnessBasis: 'refresh';
}

const TITLES: Readonly<Record<ExploreSectionKey, string>> = {
  clicks: 'Clicks',
  preorder_counts: 'Active, new, and canceled pre-orders',
  reserved_totals: 'Reserved totals',
  conversion_and_time: 'Conversion and time remaining',
  creator_results: 'Creator results',
  survey_answers: 'Backer answers',
  funnel: 'Funnel and drop-off',
  attribution_breakdown: 'Where pre-orders came from',
  comments_and_updates: 'Comments and updates',
  exports: 'Exports',
  definitions_and_freshness: 'Definitions and freshness',
};

const DEFINITIONS: Readonly<Record<ExploreSectionKey, string>> = {
  clicks:
    'Every recorded click on a Creator tracking link for this campaign, including the ones that earned nothing and the reason each did not.',
  preorder_counts:
    'New counts every pre-order ever placed, canceled counts every one the Backer ended, and net change is new minus canceled.',
  reserved_totals:
    'Pre-tax reserved subtotal, estimated sales tax, and the exact totals Backers authorized. Nothing here has been charged.',
  conversion_and_time:
    'Conversion is active pre-orders divided by recorded clicks. Days remaining counts to the close time on your campaign record.',
  creator_results:
    'Each Creator on this campaign, whether their link is activated, and whether their first post was verified.',
  survey_answers:
    'The demand-survey answers Backers gave, shown only where the Backer consented to share them with you.',
  funnel: 'How many recorded clicks reached a pre-order, and where the rest stopped.',
  attribution_breakdown:
    'Direct, organic, Proovd-house, and Creator-attributed pre-orders, decided by the attribution recorded at the time of each pre-order.',
  comments_and_updates: 'The updates you have posted and the comments on this campaign.',
  exports:
    'What you may download, and which columns are withheld from it before you press the button.',
  definitions_and_freshness:
    'What every number on this page counts, and the time the page last read them. This page refreshes when you load it.',
};

function section(
  key: ExploreSectionKey,
  data: Record<string, unknown> | null,
  awaiting: string | null = null,
): ExploreSection {
  return { key, title: TITLES[key], definition: DEFINITIONS[key], data, awaiting };
}

export async function readExplore(
  db: Database,
  input: { campaignId: string; counts?: PreorderCounts | undefined },
): Promise<ExploreView | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      campaignCloseAt: campaigns.campaignCloseAt,
      discoveryOpenedAt: campaigns.discoveryOpenedAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return null;

  const counts = input.counts ?? (await readPreorderCounts(db, input.campaignId));

  /* 1 — clicks, including the ones that earned nothing and why (§18). */
  const clickRows = await db
    .select({
      outcome: trackingLinkClicks.outcome,
      ignoredReason: trackingLinkClicks.ignoredReason,
      n: sql<number>`count(*)::int`,
    })
    .from(trackingLinkClicks)
    .where(
      and(
        eq(trackingLinkClicks.campaignId, input.campaignId),
        eq(trackingLinkClicks.linkTest, false),
      ),
    )
    .groupBy(trackingLinkClicks.outcome, trackingLinkClicks.ignoredReason);

  const attributedClicks = clickRows
    .filter((row) => row.outcome === 'attributed')
    .reduce((sum, row) => sum + Number(row.n), 0);
  const ignoredClicks = clickRows
    .filter((row) => row.outcome === 'ignored')
    .map((row) => ({ reason: row.ignoredReason ?? 'unknown', count: Number(row.n) }));
  const totalClicks = attributedClicks + ignoredClicks.reduce((sum, row) => sum + row.count, 0);

  /* 3 — reserved totals, pre-tax and authorized, over active reservations only. */
  const [totals] = await db
    .select({
      subtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)::text`,
      tax: sql<string>`coalesce(sum(${reservations.salesTaxCents}), 0)::text`,
      authorized: sql<string>`coalesce(sum(${reservations.totalAuthorizedCents}), 0)::text`,
    })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, input.campaignId), eq(reservations.status, 'reserved_active')),
    );

  /* 5 — Creator results, through §11's public-handle projection only. */
  const creators = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      status: campaignAffiliateAssociations.status,
      publicHandle: affiliateProspects.publicHandle,
      subtype: affiliateProspects.subtype,
      activatedAt: trackingLinks.activatedAt,
      pausedAt: trackingLinks.pausedAt,
      firstPostStatus: creatorPostSubmissions.status,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateProspects,
      eq(affiliateProspects.id, campaignAffiliateAssociations.prospectId),
    )
    .leftJoin(trackingLinks, eq(trackingLinks.associationId, campaignAffiliateAssociations.id))
    .leftJoin(
      creatorPostSubmissions,
      eq(creatorPostSubmissions.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, input.campaignId))
    /*
      A STATED order, and deliberately not a metric.

      §30 defers public leaderboards and the Creator close view ships with no
      rank on that basis; the supplied Founder Dashboard reference (2026-08-19)
      sorts this list by backers and calls the first entry "leading". Removing
      the crown and keeping the sort would still be a ranking — the order IS the
      claim. No ORDER BY at all is not the answer either: Postgres would then
      pick one, and an arbitrary order that happens to look sorted is worse than
      a stated one nobody can read anything into. Alphabetical by public handle
      is transparently not about performance.
    */
    .orderBy(asc(affiliateProspects.publicHandle));

  /* 6 — survey answers, only where the Backer consented (§19 step 8). */
  const surveys = await db
    .select({
      surveyWhy: reservations.surveyWhy,
      surveyRecommend: reservations.surveyRecommend,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, input.campaignId),
        eq(reservations.status, 'reserved_active'),
        eq(reservations.founderMarketingConsent, true),
      ),
    );

  /* 8 — where pre-orders came from, from the attribution stored at pre-order. */
  const sources = await db
    .select({
      source: reservations.attributionSource,
      n: sql<number>`count(*)::int`,
    })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, input.campaignId), eq(reservations.status, 'reserved_active')),
    )
    .groupBy(reservations.attributionSource);

  const breakdown: Record<string, number> = { direct: 0, organic: 0, house: 0, creator: 0 };
  for (const row of sources) {
    const key = row.source ?? 'direct';
    breakdown[key] = (breakdown[key] ?? 0) + Number(row.n);
  }

  /* 9 — updates posted. Comments are 17b's, and this says so rather than 0. */
  const [updateCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, input.campaignId));

  const now = new Date();
  const closesAt = campaign.campaignCloseAt;
  const daysRemaining = closesAt
    ? Math.max(0, Math.ceil((closesAt.getTime() - now.getTime()) / 86_400_000))
    : null;

  const sections: ExploreSection[] = [
    section('clicks', {
      total: totalClicks,
      attributed: attributedClicks,
      ignored: ignoredClicks,
    }),
    section('preorder_counts', {
      active: counts.activeCount,
      new: counts.newCount,
      canceled: counts.canceledCount,
      netChange: counts.netChange,
      otherExits: counts.otherExits,
      uniqueActiveBackers: counts.uniqueActiveBackers,
    }),
    section('reserved_totals', {
      reservedSubtotalCents: totals?.subtotal ?? '0',
      estimatedTaxCents: totals?.tax ?? '0',
      authorizedTotalCents: totals?.authorized ?? '0',
      charged: false,
    }),
    section('conversion_and_time', {
      // A conversion rate over zero clicks is not zero — it is undefined, and
      // rendering 0% would state a result nobody measured (§1.4).
      conversionRate: totalClicks > 0 ? counts.activeCount / totalClicks : null,
      recordedClicks: totalClicks,
      activePreorders: counts.activeCount,
      daysRemaining,
      closesAt: closesAt?.toISOString() ?? null,
    }),
    section('creator_results', {
      creators: creators.map((creator) => ({
        associationId: creator.associationId,
        // §11: the Founder projection carries the public handle and nothing
        // that identifies the person behind it.
        publicHandle: creator.publicHandle,
        subtype: creator.subtype,
        status: creator.status,
        linkActivatedAt: creator.activatedAt?.toISOString() ?? null,
        linkPaused: creator.pausedAt !== null,
        firstPostStatus: creator.firstPostStatus ?? 'not_submitted',
      })),
    }),
    section('survey_answers', {
      consentedCount: surveys.length,
      answers: surveys.map((row) => ({
        why: row.surveyWhy,
        recommend: row.surveyRecommend,
      })),
    }),
    section('funnel', {
      recordedClicks: totalClicks,
      attributedClicks,
      preordersPlaced: counts.newCount,
      stillActive: counts.activeCount,
      canceled: counts.canceledCount,
      clicksWithoutPreorder: Math.max(0, totalClicks - counts.newCount),
    }),
    section('attribution_breakdown', {
      ...breakdown,
      discoveryOpenedAt: campaign.discoveryOpenedAt?.toISOString() ?? null,
    }),
    section(
      'comments_and_updates',
      { updatesPosted: Number(updateCount?.n ?? 0), comments: null },
      'Comments open with the Backer comment thread. Update counts are live now.',
    ),
    section(
      'exports',
      {
        available: [],
        withheldColumns: [
          'backer email',
          'backer phone',
          'billing address',
          'card fingerprint',
          'survey answers without consent',
        ],
      },
      'Founder exports arrive with the campaign results. The withheld columns above already apply.',
    ),
    section('definitions_and_freshness', {
      definitions: EXPLORE_SECTION_KEYS.map((key) => ({
        key,
        title: TITLES[key],
        definition: DEFINITIONS[key],
      })),
      basis: 'This page reads the record when you load it.',
    }),
  ];

  return { sections, readAt: now.toISOString(), freshnessBasis: 'refresh' };
}
