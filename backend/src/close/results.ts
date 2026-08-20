/**
 * Results preparation — Spec §21, §33.7.11 (Phase 18b).
 *
 * ── The numbers are computed, the narrative is recorded ─────────────────────
 * Every §21 results number is read from the rows that already carry it — the
 * reservation ledger, the status history, the capture attempts, the
 * attribution ledger, the batch's threshold decision. A snapshot table would
 * be the second event store that drifts (§26.8's trap), except a Founder would
 * act on the drift. The one thing that IS stored is the §21 plain-language
 * narrative — strongest signal, weakest signal, leading survey reason, and
 * what the result does/does not prove — because §1 rule 6 forbids the product
 * inventing a causal story: a named Admin authors it, and recording it is what
 * "reviewed by Admin to avoid false causality" means (§1.3).
 *
 * ── `Results ready` is a gate with three conditions (§33.7.11) ──────────────
 * The campaign's charge/retry outcomes are final (`closed_reconciling` or
 * `ended_no_charge` — "reconciliation begins only after the window closes"),
 * the four charge/retry reconciliation items are verified, and the narrative
 * is recorded. `prepareResults` is the ONE sender of `founder_results_ready`,
 * writes the §23.3 `results_ready` payment flag in the same transaction, and
 * is idempotent by the unique results row.
 *
 * ── The Founder boundary holds (§11) ────────────────────────────────────────
 * Per-Creator performance is public handles only. Survey answers appear only
 * where the Backer gave the optional Founder consent (§25.2) — a withheld
 * answer is not in the payload at all.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  campaignPaymentFlags,
  reservations,
  reservationStatusHistory,
} from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  trackingLinks,
  associationCompensationAgreements,
  creatorBonuses,
} from '../db/schema/decisions.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { creatorPaymentAllocations } from '../db/schema/creator-payment.js';
import {
  campaignCloseBatches,
  campaignReconciliations,
  campaignResults,
  type CampaignResults,
} from '../db/schema/close.js';
import type { AuditWriter } from '../auth/audit.js';
import { RECONCILIATION_ITEMS, RESULTS_NARRATIVE_FIELDS } from './logic.js';
import {
  notifyResultsReady,
  type CloseNotificationDeps,
} from './notifications.js';

/* ── The Founder results read (§21) ────────────────────────────────────────── */

export interface FounderResults {
  campaignId: string;
  campaignTitle: string;
  model: 'idea' | 'product';
  /** `preparing` until `prepareResults` has run; the surface renders waiting. */
  state: 'preparing' | 'ready';
  campaignStatus: string;
  closedAt: string | null;

  /** The Idea threshold decision, from the batch row — fixed at close (§33.7.5). */
  threshold: { required: number; uniqueActiveBackers: number; met: boolean } | null;

  preorders: {
    placed: number;
    captured: number;
    canceled: number;
    noCharge: number;
  };
  /** Idea: the close decision's folded count. Product: distinct captured Backers. */
  uniqueBackers: number;
  /** Product only — §25.2: quantity is one per transaction. */
  productTransactions: { transactions: number; units: number } | null;

  /** §21: reward subtotal, tax, and total captured — separately. */
  money: {
    rewardSubtotalCapturedCents: string;
    salesTaxCapturedCents: string;
    totalCapturedCents: string;
  };

  /** §21: failed, recovered, and dropped payments. */
  payments: { failed: number; recovered: number; dropped: number };

  /**
   * §21's one recovery window, READ from the batch row (Founder Dashboard
   * Session E). Every field here is stored: the hours were read from the §6
   * `capture_retry_window_hours` setting at batch start and written onto the
   * row, `first_failure_at` is anchored once by a conditional UPDATE, and
   * `retry_deadline_at` is CHECK-pinned to the two of them and refused any
   * later edit by trigger (0028).
   *
   * It exists because until now the Founder's own read carried nothing about
   * it. `prepareResults` refuses while the window is open and names the
   * deadline in ITS refusal, which only an Admin ever sees — so the Founder
   * waiting on their results was told reconciliation was happening with no
   * instant attached, which is §27.1's "when's the next update" unanswered on
   * the one screen where the answer is a stored, immutable fact.
   *
   * `null` when no close batch has run. `not_opened` is a batch that closed
   * with nothing failing — deliberately distinct from `closed`, because "no
   * card ever failed" and "the window ran and ended" are different facts about
   * a campaign (§16a: not yet populated is not zero).
   */
  retryWindow: {
    state: 'not_opened' | 'open' | 'closed';
    windowHours: number;
    firstFailureAt: string | null;
    deadlineAt: string | null;
  } | null;

  /** §21: conversion and drop-off. A rate over zero clicks is null, never 0%. */
  conversion: {
    clicks: number;
    placed: number;
    conversionRate: string | null;
    canceled: number;
    dropOffRate: string | null;
  };

  /** §21: survey answers according to consent — consented Backers only (§25.2). */
  survey: {
    consentedCount: number;
    totalPreorderCount: number;
    averageRecommend: string | null;
    reasons: string[];
  };

  /** §21: per-Creator performance — public handles only (§11). */
  perCreator: Array<{
    associationId: string;
    handle: string | null;
    clicks: number;
    attributedPlaced: number;
    attributedCaptured: number;
    capturedSubtotalCents: string;
    provisionalCents: string;
    lockedPercent: number | null;
  }>;

  /** §21: Creator-attributed versus direct revenue, from captured charges. */
  revenueBySource: {
    creatorAttributedCents: string;
    directCents: string;
    note: string;
  };

  /** §21: Creator-specific bonus results — honestly pending until Phase 19. */
  bonuses: Array<{
    associationId: string;
    earnedPercent: number | null;
    status: 'pending_finalization' | 'recorded';
  }>;

  /** §21: finalized Creator percentage and fixed-payment status. */
  finalization: {
    creatorEarnings: 'pending';
    note: string;
    fixedPayments: Array<{ associationId: string; status: string }>;
  };

  /** The Admin-reviewed §21 narrative — null while `preparing`. */
  narrative: {
    strongestSignal: string;
    weakestSignal: string;
    leadingSurveyReason: string;
    whatThisProves: string;
    whatThisDoesNotProve: string;
    reviewedBy: string;
    preparedAt: string;
  } | null;

  /** The six-question waiting facts while `preparing` (§27.1). */
  preparing: { whatHappened: string; whatNext: string; owner: string } | null;
}

function rate(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export async function readFounderResults(
  db: Database,
  input: {
    campaignId: string;
    /**
     * §31.9's "opening Results ready", stamped once (Phase 23b).
     *
     * Passed only by the Founder's own route. `prepared_at` records when the
     * results became ready, which is a different question from whether anyone
     * came back to read them — and "return after closure" is the second one.
     * An Admin opening the queue is not the Founder returning.
     */
    stampViewed?: boolean;
  },
): Promise<FounderResults | null> {
  const { campaignId } = input;
  const [campaign] = await db
    .select({
      status: campaigns.status,
      type: campaigns.type,
      closeAt: campaigns.campaignCloseAt,
      rewardSubtotal: campaigns.rewardSubtotalCapturedCents,
      salesTax: campaigns.salesTaxCapturedCents,
      total: campaigns.totalCapturedCents,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign || !campaign.type) return null;

  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);

  const [batch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);

  const [statusCounts] = await db
    .select({
      placed: sql<number>`count(*)::int`,
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      canceled: sql<number>`count(*) filter (where ${reservations.status} = 'reserved_canceled')::int`,
      noCharge: sql<number>`count(*) filter (where ${reservations.status} = 'threshold_not_met_no_charge')::int`,
      dropped: sql<number>`count(*) filter (where ${reservations.status} = 'capture_failed_dropped')::int`,
      distinctCapturedBackers: sql<number>`count(distinct ${reservations.backerIdentityId}) filter (where ${reservations.status} = 'captured')::int`,
      creatorSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} = 'captured' and ${reservations.attributionSource} = 'creator'), 0)::text`,
      directSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} = 'captured' and (${reservations.attributionSource} is null or ${reservations.attributionSource} <> 'creator')), 0)::text`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId));

  // Failed = ever entered the recovery window; recovered = those now captured.
  // The append-only history is the record (§23.5) — never a recomputation.
  const [paymentCounts] = await db
    .select({
      failed: sql<number>`count(distinct ${reservationStatusHistory.reservationId}) filter (where ${reservationStatusHistory.toStatus} = 'capture_failed_retrying')::int`,
      recovered: sql<number>`count(distinct ${reservationStatusHistory.reservationId}) filter (where ${reservationStatusHistory.fromStatus} = 'capture_failed_retrying' and ${reservationStatusHistory.toStatus} = 'captured')::int`,
    })
    .from(reservationStatusHistory)
    .innerJoin(reservations, eq(reservations.id, reservationStatusHistory.reservationId))
    .where(eq(reservations.campaignId, campaignId));

  const [clickCount] = await db
    .select({
      clicks: sql<number>`count(*) filter (where ${trackingLinkClicks.linkTest} = false)::int`,
    })
    .from(trackingLinkClicks)
    .innerJoin(trackingLinks, eq(trackingLinks.id, trackingLinkClicks.trackingLinkId))
    .where(eq(trackingLinks.campaignId, campaignId));

  // §25.2: survey answers reach the Founder only under the optional consent.
  const surveyRows = await db
    .select({
      why: reservations.surveyWhy,
      recommend: reservations.surveyRecommend,
    })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, campaignId), eq(reservations.founderMarketingConsent, true)),
    );
  const recommends = surveyRows
    .map((r) => r.recommend)
    .filter((n): n is number => typeof n === 'number');

  const creatorRows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      handle: affiliateSignupProfiles.publicHandle,
      lockedPercent: associationCompensationAgreements.totalPercent,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .leftJoin(
      associationCompensationAgreements,
      eq(associationCompensationAgreements.associationId, campaignAffiliateAssociations.id),
    )
    .innerJoin(trackingLinks, eq(trackingLinks.associationId, campaignAffiliateAssociations.id))
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const perCreator: FounderResults['perCreator'] = [];
  for (const row of creatorRows) {
    const [clicks] = await db
      .select({
        total: sql<number>`count(*) filter (where ${trackingLinkClicks.linkTest} = false)::int`,
      })
      .from(trackingLinkClicks)
      .where(eq(trackingLinkClicks.associationId, row.associationId));
    const [attributed] = await db
      .select({
        placed: sql<number>`count(*)::int`,
        captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
        capturedSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} = 'captured'), 0)::text`,
        provisional: sql<string>`coalesce(sum(${reservations.affiliateProvisionalCents}) filter (where ${reservations.status} = 'captured'), 0)::text`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.campaignId, campaignId),
          eq(reservations.attributionAssociationId, row.associationId),
        ),
      );
    perCreator.push({
      associationId: row.associationId,
      handle: row.handle ?? null,
      clicks: Number(clicks?.total ?? 0),
      attributedPlaced: Number(attributed?.placed ?? 0),
      attributedCaptured: Number(attributed?.captured ?? 0),
      capturedSubtotalCents: attributed?.capturedSubtotal ?? '0',
      provisionalCents: attributed?.provisional ?? '0',
      lockedPercent: row.lockedPercent ?? null,
    });
  }

  const bonusRows = await db
    .select({
      associationId: creatorBonuses.associationId,
      earnedPercent: creatorBonuses.earnedPercent,
      earnedRecordedAt: creatorBonuses.earnedRecordedAt,
    })
    .from(creatorBonuses)
    .where(eq(creatorBonuses.campaignId, campaignId));

  const fixedRows = await db
    .select({
      associationId: creatorPaymentAllocations.associationId,
      status: creatorPaymentAllocations.status,
    })
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.campaignId, campaignId));

  const [recorded] = await db
    .select()
    .from(campaignResults)
    .where(eq(campaignResults.campaignId, campaignId))
    .limit(1);

  if (input.stampViewed && recorded && !recorded.firstViewedAt) {
    // `coalesce` in SQL, not a read-then-write: two tabs opening the results
    // at once must not race to be the first. The 0037 trigger refuses a move
    // regardless — this keeps it off the error path.
    await db
      .update(campaignResults)
      .set({ firstViewedAt: sql`coalesce(${campaignResults.firstViewedAt}, now())` })
      .where(eq(campaignResults.id, recorded.id));
  }

  const placed = Number(statusCounts?.placed ?? 0);
  const canceled = Number(statusCounts?.canceled ?? 0);
  const clicks = Number(clickCount?.clicks ?? 0);
  const model: 'idea' | 'product' = campaign.type === 'pre_build' ? 'idea' : 'product';

  return {
    campaignId,
    campaignTitle: build?.title ?? 'your campaign',
    model,
    state: recorded ? 'ready' : 'preparing',
    campaignStatus: campaign.status,
    closedAt: campaign.closeAt?.toISOString() ?? null,
    threshold:
      batch && batch.thresholdDecidedAt
        ? {
            required: batch.thresholdRequired!,
            uniqueActiveBackers: batch.uniqueActiveBackers!,
            met: batch.thresholdMet!,
          }
        : null,
    preorders: {
      placed,
      captured: Number(statusCounts?.captured ?? 0),
      canceled,
      noCharge: Number(statusCounts?.noCharge ?? 0),
    },
    uniqueBackers:
      model === 'idea' && batch?.uniqueActiveBackers != null
        ? batch.uniqueActiveBackers
        : Number(statusCounts?.distinctCapturedBackers ?? 0),
    productTransactions:
      model === 'product'
        ? {
            transactions: Number(statusCounts?.captured ?? 0),
            // §25.2: quantity is one per transaction, so units = transactions.
            units: Number(statusCounts?.captured ?? 0),
          }
        : null,
    money: {
      rewardSubtotalCapturedCents: (campaign.rewardSubtotal ?? 0n).toString(),
      salesTaxCapturedCents: (campaign.salesTax ?? 0n).toString(),
      totalCapturedCents: (campaign.total ?? 0n).toString(),
    },
    payments: {
      failed: Number(paymentCounts?.failed ?? 0),
      recovered: Number(paymentCounts?.recovered ?? 0),
      dropped: Number(statusCounts?.dropped ?? 0),
    },
    retryWindow: batch
      ? {
          // The campaign's own lifecycle decides `open`, not a comparison of
          // the deadline against this process's clock: `endRetryWindow` is
          // what moves the campaign out, and a window whose deadline has
          // passed but whose sweep has not run yet is still open — that is
          // exactly when an in-flight attempt is resolved under its own key.
          state:
            campaign.status === 'capture_retry_window'
              ? 'open'
              : batch.firstFailureAt
                ? 'closed'
                : 'not_opened',
          windowHours: batch.retryWindowHours,
          firstFailureAt: batch.firstFailureAt?.toISOString() ?? null,
          deadlineAt: batch.retryDeadlineAt?.toISOString() ?? null,
        }
      : null,
    conversion: {
      clicks,
      placed,
      conversionRate: rate(placed, clicks),
      canceled,
      dropOffRate: rate(canceled, placed),
    },
    survey: {
      consentedCount: surveyRows.length,
      totalPreorderCount: placed,
      averageRecommend:
        recommends.length > 0
          ? (recommends.reduce((sum, n) => sum + n, 0) / recommends.length).toFixed(1)
          : null,
      reasons: surveyRows.map((r) => r.why).filter((w): w is string => Boolean(w?.trim())),
    },
    perCreator,
    revenueBySource: {
      creatorAttributedCents: statusCounts?.creatorSubtotal ?? '0',
      directCents: statusCounts?.directSubtotal ?? '0',
      note: 'Creator-attributed revenue is captured pre-tax subtotal from charges whose winning click was a Creator link (§18). Direct is everything else; Proovd does not subdivide it further, because no record distinguishes organic from house traffic on a charge.',
    },
    bonuses: bonusRows.map((b) => ({
      associationId: b.associationId,
      earnedPercent: b.earnedPercent,
      status: b.earnedRecordedAt === null ? 'pending_finalization' : 'recorded',
    })),
    finalization: {
      creatorEarnings: 'pending',
      note: 'Creator percentages and bonuses finalize during earnings verification after the payment window (§22.1) — the provisional amounts above are the maximum that could be owed, never a promise.',
      fixedPayments: fixedRows.map((f) => ({ associationId: f.associationId, status: f.status })),
    },
    narrative: recorded
      ? {
          strongestSignal: recorded.strongestSignal,
          weakestSignal: recorded.weakestSignal,
          leadingSurveyReason: recorded.leadingSurveyReason,
          whatThisProves: recorded.whatThisProves,
          whatThisDoesNotProve: recorded.whatThisDoesNotProve,
          reviewedBy: recorded.reviewedBy,
          preparedAt: recorded.preparedAt.toISOString(),
        }
      : null,
    preparing: recorded
      ? null
      : {
          whatHappened: 'Your campaign closed and its charge outcomes are being reconciled.',
          whatNext:
            'Proovd verifies the charge, retry, and reconciliation records, then prepares your results. You will receive a separate `Results ready` message — this is different from the `Campaign ended` notice you already have.',
          owner: 'Proovd',
        },
  };
}

/* ── Results preparation (§21, §33.7.11) ───────────────────────────────────── */

export interface NarrativeInput {
  strongestSignal: string;
  weakestSignal: string;
  leadingSurveyReason: string;
  whatThisProves: string;
  whatThisDoesNotProve: string;
}

export type PrepareResultsOutcome =
  | { status: 'prepared'; results: CampaignResults }
  | { status: 'already_prepared' }
  | { status: 'retry_window_open'; deadline: Date | null }
  | { status: 'charge_retry_incomplete'; current: string }
  | { status: 'reconciliation_incomplete'; missing: string[] }
  | { status: 'narrative_incomplete'; missing: string[] }
  | { status: 'not_found' };

export interface PrepareResultsDeps {
  db: Database;
  audit: AuditWriter;
  notifications?: CloseNotificationDeps | undefined;
}

/**
 * Records the Admin-reviewed narrative, sets the §23.3 `results_ready` flag,
 * and sends `Results ready` — the one sender of that event (§33.7.11).
 */
export async function prepareResults(
  deps: PrepareResultsDeps,
  input: { campaignId: string; narrative: NarrativeInput; actor: string; now?: Date },
): Promise<PrepareResultsOutcome> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();
  const { campaignId } = input;

  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { status: 'not_found' };

  // §21: "Reconciliation begins only after the window closes" — and results
  // only after reconciliation. The anchor gates; the state is the evidence.
  if (campaign.status === 'capture_retry_window') {
    const [batch] = await db
      .select({ deadline: campaignCloseBatches.retryDeadlineAt })
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.campaignId, campaignId))
      .limit(1);
    return { status: 'retry_window_open', deadline: batch?.deadline ?? null };
  }
  if (campaign.status !== 'closed_reconciling' && campaign.status !== 'ended_no_charge') {
    return { status: 'charge_retry_incomplete', current: campaign.status };
  }

  // The four charge/retry items must be verified — latest row per item wins,
  // so a discrepancy later re-verified counts and the earlier answer survives.
  const requiredKeys = RECONCILIATION_ITEMS.filter((i) => i.requiredForResults).map((i) => i.key);
  const missing: string[] = [];
  for (const key of requiredKeys) {
    const [latest] = await db
      .select({ result: campaignReconciliations.result })
      .from(campaignReconciliations)
      .where(
        and(
          eq(campaignReconciliations.campaignId, campaignId),
          eq(campaignReconciliations.itemKey, key),
        ),
      )
      .orderBy(desc(campaignReconciliations.recordedAt))
      .limit(1);
    if (!latest || latest.result !== 'verified') missing.push(key);
  }
  if (missing.length > 0) return { status: 'reconciliation_incomplete', missing };

  const blankFields = RESULTS_NARRATIVE_FIELDS.filter((f) => {
    const value = {
      strongest_signal: input.narrative.strongestSignal,
      weakest_signal: input.narrative.weakestSignal,
      leading_survey_reason: input.narrative.leadingSurveyReason,
      what_this_proves: input.narrative.whatThisProves,
      what_this_does_not_prove: input.narrative.whatThisDoesNotProve,
    }[f.key];
    return !value?.trim();
  }).map((f) => f.key);
  if (blankFields.length > 0) return { status: 'narrative_incomplete', missing: blankFields };

  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(campaignResults)
      .values({
        campaignId,
        strongestSignal: input.narrative.strongestSignal.trim(),
        weakestSignal: input.narrative.weakestSignal.trim(),
        leadingSurveyReason: input.narrative.leadingSurveyReason.trim(),
        whatThisProves: input.narrative.whatThisProves.trim(),
        whatThisDoesNotProve: input.narrative.whatThisDoesNotProve.trim(),
        reviewedBy: input.actor,
        preparedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length !== 1) return null;

    // §23.3: `results_ready` is a payment/reconciliation flag, its own row —
    // never a campaign lifecycle value.
    await tx.insert(campaignPaymentFlags).values({
      campaignId,
      flag: 'results_ready',
      setAt: now,
      actor: input.actor,
      evidence: { resultsId: inserted[0]!.id },
    });

    return inserted[0]!;
  });
  if (!outcome) return { status: 'already_prepared' };

  await audit({
    action: 'close.results_prepared',
    targetType: 'campaign',
    targetId: campaignId,
    internalReason:
      'campaign results prepared: the §21 narrative was recorded by a named Admin, the charge/retry ' +
      'reconciliation items are verified, and the results_ready flag is set. `Results ready` sends now, ' +
      'separately from `Campaign ended` (§33.7.11).',
    newValue: { resultsId: outcome.id },
    actorId: input.actor,
  });

  if (deps.notifications) {
    await notifyResultsReady(deps.notifications, { campaignId });
  }

  return { status: 'prepared', results: outcome };
}
