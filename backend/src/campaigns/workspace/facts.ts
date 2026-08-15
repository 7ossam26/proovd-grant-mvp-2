/**
 * Everything the Campaigns hub knows about a set of campaigns, in ten batched
 * queries — Spec §26.1, §26.8.
 *
 * ── This module owns no data, and that is the design ────────────────────────
 * Campaigns is a hub over five domains: the Founder's setup and review, the
 * Creator roster, the money, the pre-orders, and support. Every number it shows
 * is READ from the domain that owns it. Nothing is copied onto the campaign row
 * and nothing is cached, because a second copy of a number somebody is paid is
 * how the two come to disagree — the rule `founders/workspace.ts` has recorded
 * since the Founder workspace was built.
 *
 * ── Batched from the first line ─────────────────────────────────────────────
 * Ten queries for the whole directory, `inArray` fan-out over the campaign ids,
 * and nothing inside a loop. A per-row subquery is what falls over first on a
 * page that summarises five domains at once, and `affiliates/workspace/
 * directory.ts` established the shape.
 *
 * ── The single-record read is one row of the list ───────────────────────────
 * `gatherCampaignFacts` takes an array and the record read passes an array of
 * one. Two composers deriving "is this blocked" separately is exactly how a
 * list and a detail page come to disagree about the same campaign.
 */

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  reservations,
} from '../../db/schema/domain.js';
import { campaignBuild, campaignReviews } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { founderClaimProfiles } from '../../db/schema/vetting.js';
import { listingFeePayments } from '../../db/schema/listing.js';
import { campaignCloseBatches, campaignResults } from '../../db/schema/close.js';
import { campaignFulfillment } from '../../db/schema/fulfillment.js';
import { campaignEnforcementActions, supportCases } from '../../db/schema/support.js';
import { requiredCreatorFailures } from '../../db/schema/launch.js';

/** The campaign row plus the four records that name it. */
export interface CampaignFacts {
  campaignId: string;
  campaign: typeof campaigns.$inferSelect;

  /* Identity — §14.4's build is the campaign's own name; the prospect is the
     fallback, exactly as `founders/workspace.ts` resolves it. */
  buildTitle: string | null;
  buildEntity: string | null;
  orderThreshold: number | null;
  buildOpensAt: Date | null;
  buildClosesAt: Date | null;

  prospectId: string | null;
  productName: string | null;
  founderName: string | null;
  companyName: string | null;

  /* §15 — the latest review round. */
  review: { round: number; outcome: string; decidedAt: Date | null } | null;

  /* §14/§15 — the roster, counted by status rather than listed. */
  associationCounts: Map<string, number>;
  associationTotal: number;

  /* §26.7 — open support cases on this campaign. */
  openSupportCases: number;

  /* §13/§24.6 — the listing fee. */
  listingPaidAt: Date | null;

  /* §19/§21 — the pre-orders, counted by status, with the active subtotal. */
  reservationCounts: Map<string, number>;
  activeSubtotalCents: bigint;

  /* §21 — the close batch and its immutable threshold decision. */
  closeBatch: {
    status: string;
    thresholdRequired: number | null;
    uniqueActiveBackers: number | null;
    thresholdMet: boolean | null;
    completedAt: Date | null;
    retryDeadlineAt: Date | null;
  } | null;

  /* §21 — `Results ready`. */
  resultsPreparedAt: Date | null;

  /* §22.5 — delivery. */
  fulfillment: { deliveredAt: Date | null; fulfilledAt: Date | null } | null;

  /* §26.7 — the latest enforcement action and its customer explanation. */
  enforcement: { action: string; customerExplanation: string; occurredAt: Date } | null;

  /* §29.6 — the non-resettable replacement deadline. */
  creatorFailure: { replacementDueAt: Date; resolvedAt: Date | null } | null;

  /* §22.3 — which payment flags this campaign has ever carried. */
  paymentFlags: Set<string>;
}

function emptyFacts(row: typeof campaigns.$inferSelect): CampaignFacts {
  return {
    campaignId: row.id,
    campaign: row,
    buildTitle: null,
    buildEntity: null,
    orderThreshold: null,
    buildOpensAt: null,
    buildClosesAt: null,
    prospectId: null,
    productName: null,
    founderName: null,
    companyName: null,
    review: null,
    associationCounts: new Map(),
    associationTotal: 0,
    openSupportCases: 0,
    listingPaidAt: null,
    reservationCounts: new Map(),
    activeSubtotalCents: 0n,
    closeBatch: null,
    resultsPreparedAt: null,
    fulfillment: null,
    enforcement: null,
    creatorFailure: null,
    paymentFlags: new Set(),
  };
}

/**
 * Loads the shared facts for a set of campaigns.
 *
 * Empty in, empty out — an `inArray` over an empty list is a query that returns
 * everything in some drivers and nothing in others, and neither is what the
 * caller meant.
 */
export async function gatherCampaignFacts(
  db: Database,
  campaignIds: readonly string[],
): Promise<Map<string, CampaignFacts>> {
  const facts = new Map<string, CampaignFacts>();
  if (campaignIds.length === 0) return facts;
  const ids = [...campaignIds];

  /* 1 — the campaign, its build, and the person behind it. LEFT JOINs
     throughout: a campaign created at invitation has no build and no claim, and
     an INNER JOIN here would silently drop every campaign that has not started.

     `founder_claim_profiles` wins over `founder_prospects` where it has a
     value, which is the prospect-then-claim precedence every other workspace
     uses (`founders/workspace.ts`). */
  const rows = await db
    .select({
      campaign: campaigns,
      buildTitle: campaignBuild.title,
      buildEntity: campaignBuild.founderEntityDisplay,
      orderThreshold: campaignBuild.orderThreshold,
      buildOpensAt: campaignBuild.opensAt,
      buildClosesAt: campaignBuild.closesAt,
      prospectId: founderProspects.id,
      productName: founderProspects.productName,
      prospectPreferred: founderProspects.preferredName,
      prospectLegal: founderProspects.legalName,
      prospectBusiness: founderProspects.businessName,
      claimPreferred: founderClaimProfiles.preferredName,
      claimLegal: founderClaimProfiles.legalName,
      claimBusiness: founderClaimProfiles.businessName,
    })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .where(inArray(campaigns.id, ids));

  for (const row of rows) {
    const entry = emptyFacts(row.campaign);
    entry.buildTitle = row.buildTitle;
    entry.buildEntity = row.buildEntity;
    entry.orderThreshold = row.orderThreshold;
    entry.buildOpensAt = row.buildOpensAt;
    entry.buildClosesAt = row.buildClosesAt;
    entry.prospectId = row.prospectId;
    entry.productName = row.productName;
    entry.founderName =
      row.claimPreferred ?? row.prospectPreferred ?? row.claimLegal ?? row.prospectLegal ?? null;
    entry.companyName = row.buildEntity ?? row.claimBusiness ?? row.prospectBusiness ?? null;
    facts.set(row.campaign.id, entry);
  }

  /* 2 — the latest review round per campaign. Ordered rather than aggregated so
     the outcome comes from the same row as the round; a MAX(round) with a
     separate MAX(outcome) would pair a round with somebody else's decision. */
  const reviews = await db
    .select({
      campaignId: campaignReviews.campaignId,
      round: campaignReviews.round,
      outcome: sql<string>`${campaignReviews.outcome}::text`,
      decidedAt: campaignReviews.decidedAt,
    })
    .from(campaignReviews)
    .where(inArray(campaignReviews.campaignId, ids))
    .orderBy(campaignReviews.campaignId, desc(campaignReviews.round));
  for (const review of reviews) {
    const entry = facts.get(review.campaignId);
    if (!entry || entry.review) continue;
    entry.review = { round: review.round, outcome: review.outcome, decidedAt: review.decidedAt };
  }

  /* 3 — the roster, counted by §23.4 status. */
  const associations = await db
    .select({
      campaignId: campaignAffiliateAssociations.campaignId,
      status: sql<string>`${campaignAffiliateAssociations.status}::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignAffiliateAssociations)
    .where(inArray(campaignAffiliateAssociations.campaignId, ids))
    .groupBy(campaignAffiliateAssociations.campaignId, sql`${campaignAffiliateAssociations.status}::text`);
  for (const row of associations) {
    const entry = facts.get(row.campaignId);
    if (!entry) continue;
    entry.associationCounts.set(row.status, row.count);
    entry.associationTotal += row.count;
  }

  /* 4 — open support cases. `status <> 'resolved'` is what five other modules
     read to mean "still open"; §26.7's workspace deliberately keeps `closed` as
     a stamp on a resolved case rather than a fifth status, so this one
     condition is the whole definition. */
  const cases = await db
    .select({
      campaignId: supportCases.campaignId,
      count: sql<number>`count(*)::int`,
    })
    .from(supportCases)
    .where(
      and(
        inArray(supportCases.campaignId, ids),
        ne(sql`${supportCases.status}::text`, 'resolved'),
      ),
    )
    .groupBy(supportCases.campaignId);
  for (const row of cases) {
    if (!row.campaignId) continue;
    const entry = facts.get(row.campaignId);
    if (entry) entry.openSupportCases = row.count;
  }

  /* 5 — the listing fee. `campaigns.listing_paid_at` is the §21 anchor and is
     what everything else keys on; the payment row is read for the history. */
  const listings = await db
    .select({ campaignId: listingFeePayments.campaignId, paidAt: listingFeePayments.paidAt })
    .from(listingFeePayments)
    .where(inArray(listingFeePayments.campaignId, ids));
  for (const row of listings) {
    const entry = facts.get(row.campaignId);
    if (entry) entry.listingPaidAt = row.paidAt;
  }

  /* 6 — the pre-orders. One grouped query gives both the counts and the active
     subtotal, so the "Reserved before tax" figure and the "active pre-orders"
     count can never be computed from different reads of the same table. */
  const preorders = await db
    .select({
      campaignId: reservations.campaignId,
      status: sql<string>`${reservations.status}::text`,
      count: sql<number>`count(*)::int`,
      subtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)::text`,
    })
    .from(reservations)
    .where(inArray(reservations.campaignId, ids))
    .groupBy(reservations.campaignId, sql`${reservations.status}::text`);
  for (const row of preorders) {
    const entry = facts.get(row.campaignId);
    if (!entry) continue;
    entry.reservationCounts.set(row.status, row.count);
    if (row.status === 'reserved_active') {
      entry.activeSubtotalCents = BigInt(row.subtotal);
    }
  }

  /* 7 — the close batch. One per campaign by unique index (§21). */
  const batches = await db
    .select({
      campaignId: campaignCloseBatches.campaignId,
      status: campaignCloseBatches.status,
      thresholdRequired: campaignCloseBatches.thresholdRequired,
      uniqueActiveBackers: campaignCloseBatches.uniqueActiveBackers,
      thresholdMet: campaignCloseBatches.thresholdMet,
      completedAt: campaignCloseBatches.completedAt,
      retryDeadlineAt: campaignCloseBatches.retryDeadlineAt,
    })
    .from(campaignCloseBatches)
    .where(inArray(campaignCloseBatches.campaignId, ids));
  for (const row of batches) {
    const entry = facts.get(row.campaignId);
    if (!entry) continue;
    entry.closeBatch = {
      status: row.status,
      thresholdRequired: row.thresholdRequired,
      uniqueActiveBackers: row.uniqueActiveBackers,
      thresholdMet: row.thresholdMet,
      completedAt: row.completedAt,
      retryDeadlineAt: row.retryDeadlineAt,
    };
  }

  /* 8 — `Results ready`, delivery, and the payment flags, in three small reads
     over tables that carry at most one row per campaign (the flags excepted). */
  const results = await db
    .select({ campaignId: campaignResults.campaignId, preparedAt: campaignResults.preparedAt })
    .from(campaignResults)
    .where(inArray(campaignResults.campaignId, ids));
  for (const row of results) {
    const entry = facts.get(row.campaignId);
    if (entry) entry.resultsPreparedAt = row.preparedAt;
  }

  const fulfillments = await db
    .select({
      campaignId: campaignFulfillment.campaignId,
      deliveredAt: campaignFulfillment.deliveredAt,
      fulfilledAt: campaignFulfillment.fulfilledAt,
    })
    .from(campaignFulfillment)
    .where(inArray(campaignFulfillment.campaignId, ids));
  for (const row of fulfillments) {
    const entry = facts.get(row.campaignId);
    if (entry) entry.fulfillment = { deliveredAt: row.deliveredAt, fulfilledAt: row.fulfilledAt };
  }

  const flags = await db
    .select({
      campaignId: campaignPaymentFlags.campaignId,
      flag: sql<string>`${campaignPaymentFlags.flag}::text`,
    })
    .from(campaignPaymentFlags)
    .where(inArray(campaignPaymentFlags.campaignId, ids));
  for (const row of flags) {
    const entry = facts.get(row.campaignId);
    if (entry) entry.paymentFlags.add(row.flag);
  }

  /* 9 — the latest §26.7 enforcement action, with its recorded customer
     explanation. Never the internal reason: §25.6 keeps them in two columns so
     the internal wording cannot leak, and this page is one an Admin reads aloud
     on a support call. */
  const enforcement = await db
    .select({
      campaignId: campaignEnforcementActions.campaignId,
      action: campaignEnforcementActions.action,
      customerExplanation: campaignEnforcementActions.customerExplanation,
      occurredAt: campaignEnforcementActions.occurredAt,
    })
    .from(campaignEnforcementActions)
    .where(inArray(campaignEnforcementActions.campaignId, ids))
    .orderBy(campaignEnforcementActions.campaignId, desc(campaignEnforcementActions.occurredAt));
  for (const row of enforcement) {
    const entry = facts.get(row.campaignId);
    if (!entry || entry.enforcement) continue;
    entry.enforcement = {
      action: row.action,
      customerExplanation: row.customerExplanation,
      occurredAt: row.occurredAt,
    };
  }

  /* 10 — §29.6's replacement window. The stored deadline is read, never
     recomputed: 14a's whole guarantee is that it is non-resettable. */
  const failures = await db
    .select({
      campaignId: requiredCreatorFailures.campaignId,
      replacementDueAt: requiredCreatorFailures.dueAt,
      resolvedAt: requiredCreatorFailures.resolvedAt,
    })
    .from(requiredCreatorFailures)
    .where(inArray(requiredCreatorFailures.campaignId, ids));
  for (const row of failures) {
    const entry = facts.get(row.campaignId);
    if (entry) {
      entry.creatorFailure = {
        replacementDueAt: row.replacementDueAt,
        resolvedAt: row.resolvedAt,
      };
    }
  }

  return facts;
}

/**
 * Every campaign an Admin may see, newest anchor first.
 *
 * Archived campaigns (§9's wrong-type path) are excluded: the replacement row
 * is the live record and showing both would put two rows for one setup in a
 * directory that is meant to answer "where does each campaign stand". The
 * Founder workspace still lists the archived one under previous campaigns,
 * which is where the history of a restart belongs.
 */
export async function listCampaignIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.archivedAt} is null`)
    /*
       Ordered on the three §21 anchors and on nothing else.
       `campaigns.created_at` and `campaigns.updated_at` are never read here —
       §33.12.1's scan treats reading either AT ALL as the failure, on the
       ground that nothing in the product legitimately needs one, and the first
       draft of this query used `createdAt` as a tiebreak and was caught.
       Respecting the check rather than exempting it is the point: a silenced
       check is worse than none.

       The consequence is real and small: a campaign with no anchor at all has
       never started, so there is no instant that orders it against another one.
       Those sort last, deterministically by id, and an operator looking for
       them uses the `Waiting` filter rather than the top of the list. */
    .orderBy(
      desc(
        sql`coalesce(${campaigns.campaignCloseAt}, ${campaigns.campaignLiveAt}, ${campaigns.listingPaidAt})`,
      ),
      campaigns.id,
    );
  return rows.map((row) => row.id);
}
