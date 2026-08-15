/**
 * A campaign's major events, composed across the records that already hold
 * them — Spec §26.8, §26.1.
 *
 * ── There is no `campaign_events` table and there must never be one ─────────
 * §26.8's trap, unchanged since Phase 16b: a second event store that drifts
 * from the first is worse than no timeline. This page reads five domains at
 * once, which is exactly the condition under which somebody proposes caching
 * them — so every entry names the table it was READ FROM, and the claim that
 * this composes rather than duplicates is checkable from the response. A test
 * asserts this module contains no `.insert(`, `.update(` or `.delete(`.
 *
 * ── This is the MAJOR-changes feed, not §26.8's operational timeline ────────
 * `support/timeline.ts` composes twelve sources including audit rows, override
 * records and notification deliveries, and it is the read an Admin opens when
 * they need everything. The reference asks for something else: the handful of
 * moments a person would name if they were describing what happened to this
 * campaign. So this reads ten sources at a headline level and links out, which
 * is what a hub does.
 *
 * ── An internal reason never reaches it ─────────────────────────────────────
 * §26.7's enforcement rows carry both an internal reason and a customer
 * explanation in separate columns (§25.6). Only the customer half is read here,
 * for the reason the support history records: a history is exactly the view
 * that gets pasted into a customer message (§33.9.11).
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  campaignStatusHistory,
  associationStatusHistory,
} from '../../db/schema/domain.js';
import { campaignReviews } from '../../db/schema/build.js';
import { listingFeePayments } from '../../db/schema/listing.js';
import { campaignCloseBatches } from '../../db/schema/close.js';
import { campaignEnforcementActions, supportCases } from '../../db/schema/support.js';
import { campaignUpdates } from '../../db/schema/updates.js';
import { campaignFulfillment } from '../../db/schema/fulfillment.js';
import { campaignStatusLabel } from '../../founders/logic.js';
import { formatInstant, isoOf } from '../../founders/format.js';
import { formatUsdCents } from '../../payments/listing-notifications.js';
import type { CampaignHistoryEntry } from './types.js';
import type { CampaignHistorySource, CampaignHistoryTag } from './logic.js';

/** How many entries a campaign's feed carries. Bounded, and the surface says so. */
export const CAMPAIGN_HISTORY_LIMIT = 60;

function entry(
  id: string,
  at: Date,
  headline: string,
  detail: string,
  tag: CampaignHistoryTag,
  source: CampaignHistorySource,
): CampaignHistoryEntry {
  return {
    id,
    at: isoOf(at) ?? at.toISOString(),
    atLabel: formatInstant(at) ?? '',
    headline,
    detail,
    tag,
    source,
  };
}

export async function composeCampaignHistory(
  db: Database,
  campaignId: string,
): Promise<CampaignHistoryEntry[]> {
  const entries: CampaignHistoryEntry[] = [];

  /* 1 — §23.1's own append-only lifecycle history. The spine of the feed: every
     other source explains one of these moves. */
  const lifecycle = await db
    .select({
      id: campaignStatusHistory.id,
      from: sql<string | null>`${campaignStatusHistory.fromStatus}::text`,
      to: sql<string>`${campaignStatusHistory.toStatus}::text`,
      occurredAt: campaignStatusHistory.occurredAt,
    })
    .from(campaignStatusHistory)
    .where(eq(campaignStatusHistory.campaignId, campaignId))
    .orderBy(desc(campaignStatusHistory.occurredAt))
    .limit(CAMPAIGN_HISTORY_LIMIT);
  for (const row of lifecycle) {
    entries.push(
      entry(
        `status:${row.id}`,
        row.occurredAt,
        campaignStatusLabel(row.to),
        row.from
          ? `Moved from “${campaignStatusLabel(row.from)}”.`
          : 'The campaign record was created.',
        'Proovd',
        'campaign_status_history',
      ),
    );
  }

  /* 2 — §15's review rounds. Submission and decision are two moments and are
     recorded as two, because "sent for review" and "sent back" are the pair an
     operator is trying to reconstruct. */
  const reviews = await db
    .select({
      id: campaignReviews.id,
      round: campaignReviews.round,
      outcome: sql<string>`${campaignReviews.outcome}::text`,
      submittedAt: campaignReviews.submittedAt,
      decidedAt: campaignReviews.decidedAt,
    })
    .from(campaignReviews)
    .where(eq(campaignReviews.campaignId, campaignId))
    .orderBy(desc(campaignReviews.round));
  for (const row of reviews) {
    entries.push(
      entry(
        `review-in:${row.id}`,
        row.submittedAt,
        'Campaign sent for review',
        `Review round ${row.round} was opened.`,
        'Founder Admin',
        'campaign_reviews',
      ),
    );
    if (row.decidedAt) {
      entries.push(
        entry(
          `review-out:${row.id}`,
          row.decidedAt,
          row.outcome === 'approved' ? 'Campaign approved' : 'Campaign sent back to the Founder',
          row.outcome === 'approved'
            ? 'The approved build was snapshotted and the campaign can be scheduled.'
            : 'Proovd recorded the changes required before it can be resubmitted.',
          'Founder Admin',
          'campaign_reviews',
        ),
      );
    }
  }

  /* 3 — the roster. Only the arrivals that MATTER at campaign level: a
     Creator accepting and a Creator going active. Every association transition
     would bury the feed under readiness churn, which is the same judgement
     `affiliates/roster-notifications.ts` makes about which moves earn a
     message. */
  const roster = await db
    .select({
      id: associationStatusHistory.id,
      to: sql<string>`${associationStatusHistory.toStatus}::text`,
      occurredAt: associationStatusHistory.occurredAt,
    })
    .from(associationStatusHistory)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, associationStatusHistory.associationId),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, campaignId),
        inArray(sql`${associationStatusHistory.toStatus}::text`, [
          'accepted',
          'active',
          'removed',
        ]),
      ),
    )
    .orderBy(desc(associationStatusHistory.occurredAt))
    .limit(CAMPAIGN_HISTORY_LIMIT);
  for (const row of roster) {
    entries.push(
      entry(
        `roster:${row.id}`,
        row.occurredAt,
        row.to === 'accepted'
          ? 'A Creator accepted the campaign'
          : row.to === 'active'
            ? 'A Creator went live'
            : 'A Creator was removed',
        'The relationship details stay in Affiliate Admin.',
        'Affiliate Admin',
        'association_status_history',
      ),
    );
  }

  /* 4 — §24.6's listing fee. The one charge on which Proovd is merchant of
     record, and the moment the two §14 tracks open. */
  const listings = await db
    .select({
      id: listingFeePayments.id,
      totalCents: listingFeePayments.totalCents,
      paidAt: listingFeePayments.paidAt,
    })
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, campaignId));
  for (const row of listings) {
    entries.push(
      entry(
        `listing:${row.id}`,
        row.paidAt,
        'Listing fee paid',
        `${formatUsdCents(row.totalCents)} recorded.`,
        'Money',
        'listing_fee_payments',
      ),
    );
  }

  /* 5 — §23.3's payment flags. Independent rows with their own amount and
     actor, which is why the amount is READ rather than recomputed here. */
  const flags = await db
    .select({
      id: campaignPaymentFlags.id,
      flag: sql<string>`${campaignPaymentFlags.flag}::text`,
      amountCents: campaignPaymentFlags.amountCents,
      setAt: campaignPaymentFlags.setAt,
    })
    .from(campaignPaymentFlags)
    .where(eq(campaignPaymentFlags.campaignId, campaignId))
    .orderBy(desc(campaignPaymentFlags.setAt))
    .limit(CAMPAIGN_HISTORY_LIMIT);
  for (const row of flags) {
    entries.push(
      entry(
        `flag:${row.id}`,
        row.setAt,
        PAYMENT_FLAG_HEADLINES[row.flag] ?? 'Payment record updated',
        row.amountCents === null
          ? 'Recorded against the campaign.'
          : `${formatUsdCents(row.amountCents)} recorded.`,
        'Money',
        'campaign_payment_flags',
      ),
    );
  }

  /* 6 — §21's close batch. Its threshold decision is immutable at close, so
     this entry can never be contradicted by a later recount. */
  const batches = await db
    .select({
      id: campaignCloseBatches.id,
      thresholdMet: campaignCloseBatches.thresholdMet,
      thresholdRequired: campaignCloseBatches.thresholdRequired,
      uniqueActiveBackers: campaignCloseBatches.uniqueActiveBackers,
      thresholdDecidedAt: campaignCloseBatches.thresholdDecidedAt,
      completedAt: campaignCloseBatches.completedAt,
    })
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId));
  for (const row of batches) {
    if (row.thresholdDecidedAt) {
      entries.push(
        entry(
          `threshold:${row.id}`,
          row.thresholdDecidedAt,
          row.thresholdMet ? 'Backer threshold met' : 'Backer threshold not met',
          `${row.uniqueActiveBackers ?? 0} of ${row.thresholdRequired ?? 0} Backers at close. This decision is fixed and later payment failures do not change it.`,
          'Money',
          'campaign_close_batches',
        ),
      );
    }
    if (row.completedAt) {
      entries.push(
        entry(
          `batch:${row.id}`,
          row.completedAt,
          'Close batch finished',
          'Charges, payments, and refunds stay in their own admin pages.',
          'Money',
          'campaign_close_batches',
        ),
      );
    }
  }

  /* 7 — §26.7 enforcement. The CUSTOMER explanation only. */
  const enforcement = await db
    .select({
      id: campaignEnforcementActions.id,
      action: campaignEnforcementActions.action,
      customerExplanation: campaignEnforcementActions.customerExplanation,
      occurredAt: campaignEnforcementActions.occurredAt,
    })
    .from(campaignEnforcementActions)
    .where(eq(campaignEnforcementActions.campaignId, campaignId))
    .orderBy(desc(campaignEnforcementActions.occurredAt));
  for (const row of enforcement) {
    entries.push(
      entry(
        `enforce:${row.id}`,
        row.occurredAt,
        row.action === 'suspend' ? 'Campaign suspended' : 'Campaign stopped by Proovd',
        row.customerExplanation,
        'Proovd',
        'campaign_enforcement_actions',
      ),
    );
  }

  /* 8 — §26.7 support cases, by their opening. The thread itself never appears:
     a case body is customer correspondence, and this feed is the one an Admin
     copies out of. */
  const cases = await db
    .select({
      id: supportCases.id,
      reference: supportCases.reference,
      topic: supportCases.topic,
      status: sql<string>`${supportCases.status}::text`,
      createdAt: supportCases.createdAt,
    })
    .from(supportCases)
    .where(eq(supportCases.campaignId, campaignId))
    .orderBy(desc(supportCases.createdAt))
    .limit(CAMPAIGN_HISTORY_LIMIT);
  for (const row of cases) {
    entries.push(
      entry(
        `case:${row.id}`,
        row.createdAt,
        'Support case opened',
        `${row.reference} — ${row.status === 'resolved' ? 'resolved' : 'still open'}. The conversation stays in Support Admin.`,
        'Support Admin',
        'support_cases',
      ),
    );
  }

  /* 9 — §18 updates. The Founder speaking to Backers is a campaign event; the
     body is not read, because §18 makes it public content with its own page. */
  const updates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      isMaterialDeliveryChange: campaignUpdates.isMaterialDeliveryChange,
      publishedAt: campaignUpdates.publishedAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt))
    .limit(CAMPAIGN_HISTORY_LIMIT);
  for (const row of updates) {
    entries.push(
      entry(
        `update:${row.id}`,
        row.publishedAt,
        row.isMaterialDeliveryChange ? 'Delivery change published' : 'Founder posted an update',
        row.title ?? 'The update is on the public campaign page.',
        'Founder Admin',
        'campaign_updates',
      ),
    );
  }

  /* 10 — §22.5 delivery. */
  const fulfillment = await db
    .select({
      id: campaignFulfillment.id,
      deliveredAt: campaignFulfillment.deliveredAt,
      fulfilledAt: campaignFulfillment.fulfilledAt,
    })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, campaignId));
  for (const row of fulfillment) {
    if (row.deliveredAt) {
      entries.push(
        entry(
          `delivered:${row.id}`,
          row.deliveredAt,
          'Reward delivered to Backers',
          'Delivery evidence and the Day 14 check stay in their own admin page.',
          'Money',
          'campaign_fulfillment',
        ),
      );
    }
    if (row.fulfilledAt) {
      entries.push(
        entry(
          `fulfilled:${row.id}`,
          row.fulfilledAt,
          'Delivery complete',
          'Money reconciliation is a separate record from delivery.',
          'Money',
          'campaign_fulfillment',
        ),
      );
    }
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries.slice(0, CAMPAIGN_HISTORY_LIMIT);
}

/**
 * §23.3's eight flags, in the plain register §3.1 asks for.
 *
 * Total over the `payment_flag` enum — a ninth flag added without a headline
 * falls through to the generic sentence rather than rendering its raw enum
 * value into a feed an Admin reads aloud.
 */
const PAYMENT_FLAG_HEADLINES: Record<string, string> = {
  retrying: 'Card retry window opened',
  founder_payment_eligible: 'Founder payment became eligible',
  founder_payment_paid: 'Founder payment released',
  affiliate_earnings_adjusted: 'Creator earnings adjusted',
  affiliate_transfer_eligible: 'Creator payment became eligible',
  affiliate_transfer_paid: 'Creator payment sent',
  results_ready: 'Results became ready',
  fulfillment_active: 'Delivery started',
};
