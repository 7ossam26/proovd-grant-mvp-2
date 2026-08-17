/**
 * The Founder record's read-and-route sections — Spec §14.4, §15, §18, §20,
 * §21, §22, §24.8, §26.7, §31.6 (Session C of the 2026-08-16 rebuild).
 *
 * ── This module reads; it owns nothing and decides nothing ──────────────────
 * Every fact below is composed from records other workspaces own: the build
 * and its review rounds, the reservation ledger, the click ledger, the
 * proposal versions with both parties' positions, the close batch, the ONE
 * §22.5 fulfillment resolver, the refund and dispute records, the support
 * cases, the §31.6 cancellation, and the enforcement actions. No write call
 * of any kind appears here (the suite scans for the three verbs), no new
 * table sits behind it, and no new route sits in front of it — the view rides
 * the existing detail GET, so the §33.12.5 partition is untouched by
 * construction.
 *
 * ── Bounded samples, honest counts ──────────────────────────────────────────
 * The reference's own panels show three comments and a "View all", so every
 * list here is a bounded sample beside its total, and the surface routes to
 * the workspace that owns the full list. §16a runs throughout: an unpopulated
 * fact names what it is waiting for, and a conversion over zero clicks is
 * null, never 0%.
 *
 * ── §25.6 on enforcement ────────────────────────────────────────────────────
 * Enforcement rows carry the reason CATEGORY and the customer explanation,
 * never the internal reason beside them — the Campaigns hub's posture,
 * applied to the same records.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { CommunicationsView, OperationsView, OpsFact } from './types.js';
import type { FounderContext } from './workspace.js';
import { campaignStatusLabel } from './logic.js';
import { formatDay, formatInstant } from './format.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import {
  campaignBuild,
  campaignFaqs,
  campaignRewardPackages,
  campaignReviews,
  reviewFeedbackItems,
  associationReadiness,
} from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';
import {
  campaignBackerNumbers,
  campaignComments,
  campaignCommentFlags,
} from '../db/schema/live-editing.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import {
  proposalVersions,
  associationCompensationAgreements,
} from '../db/schema/decisions.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { creatorCompletionStatuses, workAgainRequests } from '../db/schema/completion.js';
import {
  campaignCloseBatches,
  campaignReconciliations,
  campaignResults,
} from '../db/schema/close.js';
import { reservationRefunds } from '../db/schema/refunds.js';
import { paymentDisputes } from '../db/schema/disputes.js';
import { contractualRecoveryRecords } from '../db/schema/earnings.js';
import { supportCases, campaignEnforcementActions } from '../db/schema/support.js';
import { campaignCancellations } from '../db/schema/listing.js';
import { notificationDeliveries } from '../db/schema/integrity.js';
import { readFulfillmentStatus } from '../fulfillment/service.js';
import { adminAssociationStatusLabel } from '../affiliates/workspace/labels.js';
import { formatUsdCents } from '../payments/listing-notifications.js';

/* ── Small vocabularies (Admin record; §3.1 applies to customers) ──────────*/

const UPDATE_AUDIENCE_LABELS: Record<string, string> = {
  general_public: 'Public',
  backer_only: 'Backers only',
  milestone_progress: 'Milestone progress',
};

const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  awaiting_founder: 'Waiting on Founder',
  awaiting_customer: 'Waiting on customer',
  resolved: 'Resolved',
};

const CASE_OWNER_LABELS: Record<string, string> = {
  proovd: 'Proovd',
  founder_coordinated: 'Founder-coordinated',
};

const CANCELLATION_KIND_LABELS: Record<string, string> = {
  free_window: 'Within the 48-hour window',
  admin_review: 'Admin review',
};

const CANCELLATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending decision',
  canceled: 'Canceled',
  denied: 'Denied',
};

const ENFORCEMENT_ACTION_LABELS: Record<string, string> = {
  suspend: 'Suspension',
  kill: 'Kill',
};

const WORK_AGAIN_STATUS_LABELS: Record<string, string> = {
  requested: 'Requested — awaiting the Creator',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const COMPLETION_STATUS_LABELS: Record<string, string> = {
  successfully_completed: 'Successfully completed',
  disqualified: 'Disqualified',
};

const numberOrZero = (value: unknown): number => Number(value ?? 0);

/* ── The compose ───────────────────────────────────────────────────────────*/

export async function composeOperations(
  db: Database,
  ctx: FounderContext,
  now: Date,
): Promise<OperationsView | null> {
  const row = ctx.currentCampaign;
  if (!row) return null;
  const campaign = row.campaign;
  const campaignId = campaign.id;

  /* Build content, rewards, FAQs — §14.4, read-only (decision 18). */
  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  const rewards = await db
    .select()
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, campaignId))
    .orderBy(campaignRewardPackages.sortOrder);
  const faqs = await db
    .select()
    .from(campaignFaqs)
    .where(eq(campaignFaqs.campaignId, campaignId))
    .orderBy(campaignFaqs.sortOrder);

  /* Review rounds and the latest round's grouped feedback — §15 state. */
  const rounds = await db
    .select()
    .from(campaignReviews)
    .where(eq(campaignReviews.campaignId, campaignId))
    .orderBy(desc(campaignReviews.round));
  const latestRound = rounds[0] ?? null;
  const feedback = latestRound
    ? await db
        .select()
        .from(reviewFeedbackItems)
        .where(eq(reviewFeedbackItems.reviewId, latestRound.id))
    : [];

  /* The reservation ledger, partitioned by current status (one grouped read). */
  const statusRows = await db
    .select({
      status: reservations.status,
      count: sql<number>`count(*)`,
      subtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId))
    .groupBy(reservations.status);
  const byStatus = new Map(statusRows.map((r) => [String(r.status), r]));
  const countOf = (status: string) => numberOrZero(byStatus.get(status)?.count);
  const created = statusRows.reduce((total, r) => total + numberOrZero(r.count), 0);
  const active = countOf('reserved_active');
  const canceled = countOf('reserved_canceled');
  const activeSubtotalCents = BigInt(byStatus.get('reserved_active')?.subtotal ?? 0);

  /* The click ledger — §18's record of why each click earned what it did. */
  const clickRows = await db
    .select({ outcome: trackingLinkClicks.outcome, count: sql<number>`count(*)` })
    .from(trackingLinkClicks)
    .where(eq(trackingLinkClicks.campaignId, campaignId))
    .groupBy(trackingLinkClicks.outcome);
  const validClicks = numberOrZero(clickRows.find((r) => r.outcome === 'attributed')?.count);

  /* Updates and comments — bounded samples beside their totals. */
  const updates = await db
    .select()
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.publishedAt))
    .limit(3);
  const [updatesTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId));
  const comments = await db
    .select()
    .from(campaignComments)
    .where(eq(campaignComments.campaignId, campaignId))
    .orderBy(desc(campaignComments.postedAt))
    .limit(5);
  const [commentsTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(campaignComments)
    .where(eq(campaignComments.campaignId, campaignId));
  const [openFlags] = await db
    .select({ count: sql<number>`count(*)` })
    .from(campaignCommentFlags)
    .where(
      and(eq(campaignCommentFlags.campaignId, campaignId), eq(campaignCommentFlags.state, 'open')),
    );
  const flaggedCommentIds = new Set(
    (
      await db
        .select({ commentId: campaignCommentFlags.commentId })
        .from(campaignCommentFlags)
        .where(
          and(
            eq(campaignCommentFlags.campaignId, campaignId),
            eq(campaignCommentFlags.state, 'open'),
          ),
        )
    ).map((r) => r.commentId),
  );

  /* The roster — one row per association, everything read, linking out. */
  const associations = await db
    .select({
      association: campaignAffiliateAssociations,
      prospect: affiliateProspects,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(affiliateProspects.id, campaignAffiliateAssociations.affiliateId),
    )
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));
  const associationIds = associations.map((r) => r.association.id);

  const agreements = associationIds.length
    ? await db
        .select()
        .from(associationCompensationAgreements)
        .where(inArray(associationCompensationAgreements.associationId, associationIds))
    : [];
  const agreementByAssociation = new Map(agreements.map((a) => [a.associationId, a]));

  const versions = associationIds.length
    ? await db
        .select()
        .from(proposalVersions)
        .where(inArray(proposalVersions.associationId, associationIds))
        .orderBy(desc(proposalVersions.versionNumber))
    : [];
  const latestVersionByAssociation = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!latestVersionByAssociation.has(version.associationId)) {
      latestVersionByAssociation.set(version.associationId, version);
    }
  }

  const readinessRows = associationIds.length
    ? await db
        .select()
        .from(associationReadiness)
        .where(inArray(associationReadiness.associationId, associationIds))
    : [];
  const readinessByAssociation = new Map(readinessRows.map((r) => [r.associationId, r]));

  const completionRows = associationIds.length
    ? await db
        .select()
        .from(creatorCompletionStatuses)
        .where(
          and(
            inArray(creatorCompletionStatuses.associationId, associationIds),
            sql`${creatorCompletionStatuses.supersededAt} IS NULL`,
          ),
        )
    : [];
  const completionByAssociation = new Map(completionRows.map((r) => [r.associationId, r]));

  const workAgainRows = associationIds.length
    ? await db
        .select()
        .from(workAgainRequests)
        .where(inArray(workAgainRequests.associationId, associationIds))
        .orderBy(desc(workAgainRequests.requestedAt))
    : [];
  const workAgainByAssociation = new Map<string, (typeof workAgainRows)[number]>();
  for (const request of workAgainRows) {
    if (!workAgainByAssociation.has(request.associationId)) {
      workAgainByAssociation.set(request.associationId, request);
    }
  }

  /* Per-association attributed Backers and valid clicks, grouped. */
  const attributedRows = await db
    .select({
      associationId: reservations.attributionAssociationId,
      count: sql<number>`count(*)`,
    })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')),
    )
    .groupBy(reservations.attributionAssociationId);
  const backersByAssociation = new Map(
    attributedRows
      .filter((r) => r.associationId !== null)
      .map((r) => [r.associationId as string, numberOrZero(r.count)]),
  );
  const attributedActive = [...backersByAssociation.values()].reduce((a, b) => a + b, 0);

  const clicksByAssociationRows = await db
    .select({
      associationId: trackingLinkClicks.associationId,
      count: sql<number>`count(*)`,
    })
    .from(trackingLinkClicks)
    .where(
      and(
        eq(trackingLinkClicks.campaignId, campaignId),
        eq(trackingLinkClicks.outcome, 'attributed'),
      ),
    )
    .groupBy(trackingLinkClicks.associationId);
  const clicksByAssociation = new Map(
    clicksByAssociationRows
      .filter((r) => r.associationId !== null)
      .map((r) => [r.associationId as string, numberOrZero(r.count)]),
  );

  const prospectHandleByAssociation = new Map(
    associations.map((r) => [r.association.id, r.prospect.publicHandle]),
  );

  const termsSentence = (associationId: string): string => {
    const agreement = agreementByAssociation.get(associationId);
    if (agreement) return `${agreement.totalPercent}% locked`;
    const version = latestVersionByAssociation.get(associationId);
    if (!version) return 'No proposal yet';
    if (version.state === 'awaiting_founder' || version.state === 'awaiting_creator') {
      return `${version.bidTotalPercent}% proposed on v${version.versionNumber} · not locked`;
    }
    return `v${version.versionNumber} ${version.state.replace(/_/g, ' ')} · not locked`;
  };

  const roster = associations.map(({ association, prospect }) => {
    const readiness = readinessByAssociation.get(association.id);
    const completion = completionByAssociation.get(association.id);
    const workAgain = workAgainByAssociation.get(association.id);
    return {
      associationId: association.id,
      prospectId: prospect.id,
      name: prospect.legalName ?? prospect.publicHandle ?? 'Creator',
      handle: prospect.publicHandle,
      statusLabel: adminAssociationStatusLabel(association.status),
      terms: termsSentence(association.id),
      launchRequired: readiness ? readiness.launchRequired : null,
      backers: backersByAssociation.get(association.id) ?? 0,
      validClicks: clicksByAssociation.get(association.id) ?? 0,
      completion: completion
        ? (COMPLETION_STATUS_LABELS[completion.status] ?? completion.status)
        : null,
      workAgain: workAgain
        ? (WORK_AGAIN_STATUS_LABELS[workAgain.status] ?? workAgain.status)
        : null,
    };
  });

  /* §19 survey responses under consent labels — bounded, never exported. */
  const responseRows = await db
    .select({
      reservation: reservations,
      backerNumber: campaignBackerNumbers.backerNumber,
    })
    .from(reservations)
    .leftJoin(
      campaignBackerNumbers,
      and(
        eq(campaignBackerNumbers.campaignId, campaignId),
        eq(campaignBackerNumbers.backerIdentityId, reservations.backerIdentityId),
      ),
    )
    .where(
      and(eq(reservations.campaignId, campaignId), sql`${reservations.surveyWhy} IS NOT NULL`),
    )
    .orderBy(desc(reservations.createdAt))
    .limit(6);
  const [responsesTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, campaignId), sql`${reservations.surveyWhy} IS NOT NULL`),
    );

  /* The Backer rows — numbers only, matching the reference (decision 34). */
  const backerRows = await db
    .select({
      reservation: reservations,
      backerNumber: campaignBackerNumbers.backerNumber,
    })
    .from(reservations)
    .leftJoin(
      campaignBackerNumbers,
      and(
        eq(campaignBackerNumbers.campaignId, campaignId),
        eq(campaignBackerNumbers.backerIdentityId, reservations.backerIdentityId),
      ),
    )
    .where(eq(reservations.campaignId, campaignId))
    .orderBy(desc(reservations.createdAt))
    .limit(8);
  const reservationIds = backerRows.map((r) => r.reservation.id);
  const reservationCases = reservationIds.length
    ? await db
        .select({
          id: supportCases.id,
          reference: supportCases.reference,
          reservationId: supportCases.reservationId,
        })
        .from(supportCases)
        .where(inArray(supportCases.reservationId, reservationIds))
    : [];
  const caseByReservation = new Map(
    reservationCases
      .filter((c) => c.reservationId !== null)
      .map((c) => [c.reservationId as string, c]),
  );

  const backerLabel = (backerNumber: number | null): string =>
    backerNumber === null ? 'Backer' : `Backer ${backerNumber}`;

  const attributionLabel = (associationId: string | null): string => {
    if (!associationId) return 'Direct / organic';
    const handle = prospectHandleByAssociation.get(associationId);
    return handle ? `@${handle.replace(/^@/, '')}` : 'Creator link';
  };

  /* Close, capture, reconciliation, results — §21's records, read. */
  const [batch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);
  const reconciliationRows = await db
    .select()
    .from(campaignReconciliations)
    .where(eq(campaignReconciliations.campaignId, campaignId))
    .orderBy(desc(campaignReconciliations.recordedAt));
  const latestReconciliationByItem = new Map<string, (typeof reconciliationRows)[number]>();
  for (const item of reconciliationRows) {
    if (!latestReconciliationByItem.has(item.itemKey)) {
      latestReconciliationByItem.set(item.itemKey, item);
    }
  }
  const verifiedItems = [...latestReconciliationByItem.values()].filter(
    (r) => r.result === 'verified',
  ).length;
  const [results] = await db
    .select()
    .from(campaignResults)
    .where(eq(campaignResults.campaignId, campaignId))
    .limit(1);

  const captured = countOf('captured');
  const retrying = countOf('capture_failed_retrying');
  const dropped = countOf('capture_failed_dropped');
  const pendingCapture = countOf('pending_capture');
  const captureState = batch
    ? [
        `${captured} captured`,
        retrying ? `${retrying} retrying` : null,
        dropped ? `${dropped} dropped at US$0` : null,
        pendingCapture ? `${pendingCapture} pending` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Not due — the campaign has not closed';

  const batchOutcome = batch
    ? batch.campaignType === 'pre_build'
      ? batch.thresholdMet === null
        ? 'Threshold not yet decided'
        : batch.thresholdMet
          ? 'Threshold met — capture proceeded'
          : 'Threshold not met — no card was charged'
      : 'Capture proceeded'
    : 'Pending close';

  const isIdea = campaign.type === 'pre_build';
  const threshold = row.orderThreshold;

  /* Fulfillment — the ONE §22.5 resolver (decision 27). */
  const fulfillmentStatus = await readFulfillmentStatus(db, campaignId, now);

  /* Refunds, disputes, recovery — counts from the records themselves. */
  const refundRows = await db
    .select({ status: reservationRefunds.status, count: sql<number>`count(*)` })
    .from(reservationRefunds)
    .where(eq(reservationRefunds.campaignId, campaignId))
    .groupBy(reservationRefunds.status);
  const totalRefunds = refundRows.reduce((total, r) => total + numberOrZero(r.count), 0);
  const openRefunds = refundRows
    .filter((r) => r.status === 'requested' || r.status === 'submitted' || r.status === 'failed')
    .reduce((total, r) => total + numberOrZero(r.count), 0);
  const disputeRows = await db
    .select({ status: paymentDisputes.status, count: sql<number>`count(*)` })
    .from(paymentDisputes)
    .where(eq(paymentDisputes.campaignId, campaignId))
    .groupBy(paymentDisputes.status);
  const totalDisputes = disputeRows.reduce((total, r) => total + numberOrZero(r.count), 0);
  const openDisputes = disputeRows
    .filter((r) => r.status !== 'won' && r.status !== 'lost')
    .reduce((total, r) => total + numberOrZero(r.count), 0);
  const [recoveryCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contractualRecoveryRecords)
    .where(eq(contractualRecoveryRecords.campaignId, campaignId));

  /* Support cases — the history read's own scoping (campaigns + account). */
  const campaignIds = ctx.campaignRows.map((r) => r.campaign.id);
  const caseWhere = [];
  if (campaignIds.length) caseWhere.push(inArray(supportCases.campaignId, campaignIds));
  if (ctx.accountUserId) caseWhere.push(eq(supportCases.requesterUserId, ctx.accountUserId));
  const cases = caseWhere.length
    ? await db
        .select()
        .from(supportCases)
        .where(caseWhere.length === 1 ? caseWhere[0] : sql`${caseWhere[0]} OR ${caseWhere[1]}`)
        .orderBy(desc(supportCases.createdAt))
        .limit(8)
    : [];

  /* §31.6 cancellation — the latest request, read-only (decision 37). */
  const [cancellation] = await db
    .select()
    .from(campaignCancellations)
    .where(eq(campaignCancellations.campaignId, campaignId))
    .orderBy(desc(campaignCancellations.requestedAt))
    .limit(1);

  /* Enforcement — category + customer explanation, never the internal reason. */
  const enforcementRows = await db
    .select()
    .from(campaignEnforcementActions)
    .where(eq(campaignEnforcementActions.campaignId, campaignId))
    .orderBy(desc(campaignEnforcementActions.occurredAt));

  /* ── Assemble ────────────────────────────────────────────────────────────*/

  const liveAt = campaign.campaignLiveAt;
  const closeAt = campaign.campaignCloseAt;
  const isLive = liveAt !== null && liveAt.getTime() <= now.getTime();
  const campaignDay =
    isLive && liveAt
      ? Math.max(1, Math.floor((now.getTime() - liveAt.getTime()) / 86_400_000) + 1)
      : null;
  const discoveryOpen = campaign.discoveryOpenedAt;
  const discovery = !isLive
    ? 'Not live yet'
    : discoveryOpen && discoveryOpen.getTime() <= now.getTime()
      ? `Publicly discoverable since ${formatDay(discoveryOpen)}`
      : discoveryOpen
        ? `Known links only · public ${formatDay(discoveryOpen)}`
        : 'Known links only';

  const contentFields: OpsFact[] = [
    { label: 'Title', value: build?.title ?? null },
    {
      label: 'Dates',
      value:
        build?.opensAt || build?.closesAt
          ? `${formatDay(build?.opensAt) ?? 'Not set'} → ${formatDay(build?.closesAt) ?? 'Not set'}`
          : null,
    },
    ...(isIdea
      ? [
          {
            label: 'Unique active Backer threshold',
            value: threshold === null ? null : String(threshold),
          },
        ]
      : []),
    { label: 'Brand voice', value: build?.brandVoice ?? null },
    { label: 'Required wording', value: build?.requiredWording ?? null },
    {
      label: 'Prohibited claims',
      value:
        build && Array.isArray(build.prohibitedClaims) && build.prohibitedClaims.length
          ? (build.prohibitedClaims as string[]).join(' · ')
          : null,
    },
    { label: 'Community', value: build?.communityUrl ?? null },
    { label: 'Hero preference', value: build?.heroPreference ?? null },
    { label: 'Story', value: build?.publicStory ?? null },
    { label: 'Delivery window', value: build?.deliveryWindow ?? null },
    { label: 'Risks / challenges', value: build?.risksAndChallenges ?? null },
  ];

  const directActive = active - attributedActive;

  return {
    campaignId,
    campaignName: row.title ?? ctx.prospect.productName ?? 'Untitled campaign',
    typeLabel:
      campaign.typeLockedAt === null
        ? 'Proposed'
        : campaign.type === 'pre_build'
          ? 'Idea'
          : 'Product',
    statusLabel: campaignStatusLabel(campaign.status),

    content: {
      fields: contentFields,
      rewards: rewards.map((reward) => ({
        title: reward.title,
        price: formatUsdCents(reward.priceCents),
        contents: reward.contents,
        delivery: reward.delivery,
      })),
      faqs: faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
    },

    review: {
      buildStatus: campaign.campaignBuildStatus,
      rosterReadiness: campaign.affiliateRosterStatus,
      rounds: rounds.map((round) => ({
        round: round.round,
        outcome: round.outcome,
        submittedAt: formatInstant(round.submittedAt) ?? '',
        decidedAt: formatInstant(round.decidedAt),
      })),
      feedback: feedback.map((item) => ({ group: item.feedbackGroup, text: item.body })),
      approvedAt: formatInstant(rounds.find((round) => round.outcome === 'approved')?.decidedAt),
    },

    live: {
      isLive,
      liveAt: formatInstant(liveAt),
      campaignDay,
      closesAt: formatDay(closeAt),
      discovery,
      publicUrl: isLive ? `/campaign/${campaignId}` : null,
      created,
      active,
      canceled,
      validClicks,
      conversion: validClicks === 0 ? null : `${((active / validClicks) * 100).toFixed(1)}%`,
      reservedSubtotal: active === 0 ? null : formatUsdCents(activeSubtotalCents),
      updatesCount: numberOrZero(updatesTotal?.count),
      commentsCount: numberOrZero(commentsTotal?.count),
      threshold:
        isIdea && threshold !== null
          ? {
              required: threshold,
              active,
              remaining: Math.max(0, threshold - active),
              state: active >= threshold ? 'Reached' : 'Not reached',
            }
          : null,
    },

    page: {
      updates: updates.map((update) => ({
        title: update.title ?? 'Untitled update',
        audience: UPDATE_AUDIENCE_LABELS[update.audience] ?? update.audience,
        publishedAt: formatInstant(update.publishedAt) ?? '',
        body: update.body.length > 240 ? `${update.body.slice(0, 240)}…` : update.body,
        materialChange: update.isMaterialDeliveryChange,
      })),
      updatesCount: numberOrZero(updatesTotal?.count),
      comments: comments.map((comment) => ({
        author: comment.authorDisplay,
        body: comment.body.length > 200 ? `${comment.body.slice(0, 200)}…` : comment.body,
        postedAt: formatInstant(comment.postedAt) ?? '',
        state: comment.removedAt
          ? 'Removed'
          : flaggedCommentIds.has(comment.id)
            ? 'Flagged — open'
            : 'Visible',
      })),
      commentsCount: numberOrZero(commentsTotal?.count),
      openFlags: numberOrZero(openFlags?.count),
    },

    roster,
    rosterCounts: {
      total: associations.length,
      backersBroughtIn: attributedActive,
      validClicks,
    },

    workAgain: workAgainRows.map((request) => {
      const association = associations.find((a) => a.association.id === request.associationId);
      return {
        creatorName: association?.prospect.legalName ?? 'Creator',
        requestedAt: formatInstant(request.requestedAt) ?? '',
        status: WORK_AGAIN_STATUS_LABELS[request.status] ?? request.status,
        message: request.message,
        respondedAt: formatInstant(request.respondedAt),
        responseNote: request.responseNote,
      };
    }),

    demand: {
      split: [
        { label: 'Affiliate traffic', clicks: validClicks, backers: attributedActive },
        { label: 'Direct & organic', clicks: 0, backers: Math.max(0, directActive) },
      ],
    },

    responses: {
      total: numberOrZero(responsesTotal?.count),
      rows: responseRows.map(({ reservation, backerNumber }) => ({
        backer: backerLabel(backerNumber),
        reward: reservation.rewardTitle ?? '—',
        status: reservation.status === 'reserved_active' ? 'Active' : 'No longer active',
        why: reservation.surveyWhy,
        recommend: reservation.surveyRecommend,
        consent: reservation.founderMarketingConsent ? 'Founder research opt-in' : 'Aggregate only',
      })),
    },

    backerRows: {
      total: created,
      rows: backerRows.map(({ reservation, backerNumber }) => {
        const supportCase = caseByReservation.get(reservation.id);
        return {
          backer: backerLabel(backerNumber),
          reward: reservation.rewardTitle ?? '—',
          createdAt: formatDay(reservation.createdAt) ?? '',
          status: reservation.status.replace(/_/g, ' '),
          attribution: attributionLabel(reservation.attributionAssociationId),
          caseRef: supportCase?.reference ?? null,
          caseId: supportCase?.id ?? null,
        };
      }),
    },

    close: {
      scheduledClose: formatDay(closeAt),
      batch: batch
        ? {
            status: batch.status.replace(/_/g, ' '),
            startedAt: formatInstant(batch.startedAt) ?? '',
            completedAt: formatInstant(batch.completedAt),
            outcome: batchOutcome,
            thresholdDecidedAt: formatInstant(batch.thresholdDecidedAt),
          }
        : null,
      finalActive: batch ? batch.uniqueActiveBackers : null,
      canceledExcluded: batch ? canceled : null,
      captureState,
      retryWindow: batch?.retryDeadlineAt
        ? `Retry window until ${formatInstant(batch.retryDeadlineAt)}`
        : null,
      reconciliation:
        latestReconciliationByItem.size === 0
          ? batch
            ? 'Nothing recorded yet'
            : 'Waiting for close'
          : `${verifiedItems} of ${latestReconciliationByItem.size} recorded items verified`,
      resultsPreparedAt: formatInstant(results?.preparedAt ?? null),
      idea: isIdea
        ? {
            threshold,
            finalActive: batch ? batch.uniqueActiveBackers : null,
            state: batch
              ? batchOutcome
              : threshold === null
                ? 'No threshold recorded'
                : 'Not final',
          }
        : null,
    },

    fulfillment: fulfillmentStatus
      ? {
          available: true,
          waitingOn: null,
          mechanism: fulfillmentStatus.mechanismLabel,
          deliveredAt: fulfillmentStatus.deliveredAt,
          obligations: fulfillmentStatus.obligations.map((obligation) => ({
            label: obligation.label,
            state: obligation.state.replace(/_/g, ' '),
            dueAt: obligation.dueAt,
          })),
          commitments: fulfillmentStatus.commitments.map((commitment) => ({
            sequence: commitment.sequence,
            month: commitment.deliveryMonth,
            original: commitment.isOriginal,
            text: commitment.commitmentText,
          })),
          day14: null,
        }
      : {
          available: false,
          waitingOn:
            'Delivery evidence, the Day-14 review, and missed-commitment records exist only after the lifecycle reaches fulfillment.',
          mechanism: null,
          deliveredAt: null,
          obligations: [],
          commitments: [],
          day14: null,
        },

    refunds: {
      openRefunds,
      totalRefunds,
      openDisputes,
      totalDisputes,
      recoveryRecords: numberOrZero(recoveryCount?.count),
    },

    supportCases: cases.map((supportCase) => ({
      caseId: supportCase.id,
      reference: supportCase.reference,
      subject: supportCase.subject,
      status: CASE_STATUS_LABELS[supportCase.status] ?? supportCase.status,
      owner: CASE_OWNER_LABELS[supportCase.owner] ?? supportCase.owner,
      due: supportCase.resolvedAt
        ? `Resolved ${formatDay(supportCase.resolvedAt)}`
        : formatInstant(supportCase.humanResponseDueAt),
    })),

    cancellation: cancellation
      ? {
          state: CANCELLATION_STATUS_LABELS[cancellation.status] ?? cancellation.status,
          kind: CANCELLATION_KIND_LABELS[cancellation.kind] ?? cancellation.kind,
          requestedAt: formatInstant(cancellation.requestedAt),
          decidedAt: formatInstant(cancellation.decidedAt),
          customerExplanation: cancellation.customerExplanation,
        }
      : null,

    enforcement: {
      campaignActions: enforcementRows.map((action) => ({
        action: ENFORCEMENT_ACTION_LABELS[action.action] ?? action.action,
        phase: action.phase === 'pre_capture' ? 'Before capture' : 'After capture',
        occurredAt: formatInstant(action.occurredAt) ?? '',
        category: action.reasonCategory.replace(/_/g, ' '),
        customerExplanation: action.customerExplanation,
      })),
    },
  };
}

/**
 * The Communications rows — `notification_deliveries` for this Founder's
 * address, newest first, bounded. The row carries the §27 KEY; the label
 * resolves in the browser from the shared registry (22c's rule).
 */
export async function composeCommunications(
  db: Database,
  ctx: FounderContext,
): Promise<CommunicationsView> {
  const target = ctx.identity.email;
  if (!target) return { total: 0, rows: [] };

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.target, target));
  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.target, target))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(20);

  return {
    total: numberOrZero(total?.count),
    rows: rows.map((delivery) => ({
      eventKey: delivery.eventKey,
      target: delivery.target,
      at: formatInstant(delivery.deliveredAt ?? delivery.createdAt) ?? '',
      state: delivery.notificationId ? 'Delivered' : 'Recorded',
    })),
  };
}
