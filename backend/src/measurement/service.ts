/**
 * The first-cohort scoreboard — Spec §31.9, §33.12.6, §33.12.7 (Phase 23b).
 *
 * ── Every number here is a query over a table some other phase needed ───────
 * §31.9's first sentence forbids a general analytics warehouse. So this module
 * owns no table, writes nothing, and emits no event: it is a read across
 * `secure_tokens`, `possible_creator_results`, `listing_fee_payments`,
 * `stripe_connected_accounts`, `campaign_results`, `act_rank_corrections`, and
 * `campaign_home_deliveries`, every one of which exists because a Founder,
 * Creator, or Backer did something the product had to record.
 *
 * The three `first_*` columns 0037 added are the exception that proves it —
 * they record the FIRST occurrence of a thing already being recorded, because
 * `last_used_at` is the wrong tense for a duration. Nothing new happens; a
 * moment that was being overwritten is now also kept.
 *
 * ── The cohort gate is one function and every metric goes through it ────────
 * §33.12.6: "no invented baseline exists". A scoreboard rendering `0%` before
 * anybody was invited has invented one — it is indistinguishable from a cohort
 * that completed and failed. `gateOnCohort` refuses to run the computation at
 * all below ten invited Founders, so there is no number for a later refactor to
 * start rendering.
 *
 * ── Nothing is excluded to make a number look better ────────────────────────
 * §31.9's closing sentence, and §33.12.7. Every denominator below keeps
 * cancellations, support-touched journeys, and failed payments in. `founder_completion`
 * is the one where the temptation is real: dropping the Founders who canceled
 * inside the §31.6 window would raise it immediately, and the query has no
 * status filter at all for exactly that reason.
 */

import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignDrafts, campaignInvitationSends } from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import { founderClaimProfiles, possibleCreatorResults } from '../db/schema/vetting.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignResults } from '../db/schema/close.js';
import { actRankCorrections, campaignHomeDeliveries } from '../db/schema/live.js';
import { campaignFulfillment, day14EvidenceSubmissions, deliveryCommitments } from '../db/schema/fulfillment.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { workAgainRequests } from '../db/schema/completion.js';
import { supportCases } from '../db/schema/support.js';
import { paymentDisputes } from '../db/schema/disputes.js';
import { backerSatisfactionResponses } from '../db/schema/completion.js';
import { proposalVersions } from '../db/schema/decisions.js';
import { auditEvents, notificationDeliveries } from '../db/schema/integrity.js';
import { reservationCaptureAttempts } from '../db/schema/close.js';
import {
  COHORT_BASELINE_SIZE,
  CORRECTION_KINDS_COUNTED,
  NOT_MEASURED_LABEL,
  RETURN_WINDOW_DAYS,
  SCOREBOARD_METRIC_KEYS,
  type ScoreboardMetricKey,
} from './logic.js';

/* ── The shape the surface renders ────────────────────────────────────────── */

export type NotMeasuredReason = 'cohort_incomplete' | 'no_observations' | 'input_not_recorded';

export type MetricValue =
  | {
      state: 'not_measured';
      reason: NotMeasuredReason;
      invitedFounders: number;
      cohortSize: number;
      missingInput?: string;
    }
  | { state: 'measured'; unit: 'median_hours'; value: number; observations: number }
  | { state: 'measured'; unit: 'rate'; numerator: number; denominator: number; value: number };

export interface ScoreboardEntry {
  key: ScoreboardMetricKey;
  value: MetricValue;
}

export interface SecondaryEntry {
  key: string;
  label: string;
  /** An observed count. Null only where the input is not recorded at all. */
  count: number | null;
  absentBecause?: string;
}

export interface Scoreboard {
  /** §33.12.6's label, sent to the surface rather than composed there. */
  notMeasuredLabel: string;
  cohortSize: number;
  invitedFounders: number;
  /** True once the first cohort is whole. The surface says which state it is in. */
  baselineEstablished: boolean;
  metrics: ScoreboardEntry[];
  secondary: SecondaryEntry[];
}

/* ── The cohort gate ──────────────────────────────────────────────────────── */

function gate(
  invitedFounders: number,
  compute: () => Extract<MetricValue, { state: 'measured' }> | null,
): MetricValue {
  if (invitedFounders < COHORT_BASELINE_SIZE) {
    return {
      state: 'not_measured',
      reason: 'cohort_incomplete',
      invitedFounders,
      cohortSize: COHORT_BASELINE_SIZE,
    };
  }
  const measured = compute();
  if (measured === null) {
    return {
      state: 'not_measured',
      reason: 'no_observations',
      invitedFounders,
      cohortSize: COHORT_BASELINE_SIZE,
    };
  }
  return measured;
}

function medianHours(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const ms =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return ms / 3_600_000;
}

function rate(numerator: number, denominator: number): Extract<MetricValue, { unit: 'rate' }> | null {
  // A rate over a zero denominator is never 0 — that is `no_observations`, and
  // §16a's "not yet populated is not zero" is the same rule in another surface.
  if (denominator === 0) return null;
  return { state: 'measured', unit: 'rate', numerator, denominator, value: numerator / denominator };
}

async function count(db: Database, query: Promise<Array<{ n: number }>>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

/* ── The scoreboard ───────────────────────────────────────────────────────── */

export async function readScoreboard(db: Database): Promise<Scoreboard> {
  /**
   * §31.9's cohort: "the first 10 INVITED Founders". A prospect with no send
   * has not been invited, and counting them would let the baseline be declared
   * complete by adding rows to a table nobody emailed.
   */
  const invitedFounders = await count(
    db,
    db
      .select({ n: sql<number>`count(DISTINCT ${campaignDrafts.prospectId})::int` })
      .from(campaignInvitationSends)
      .innerJoin(campaignDrafts, eq(campaignDrafts.id, campaignInvitationSends.draftId)),
  );

  /* ── 1. Time to first magic ───────────────────────────────────────────── */
  // Two stamped instants on one campaign. The draft token reaches the campaign
  // through `campaign_drafts`, which is the only binding §7 gives it.
  const magicRows = await db
    .select({
      openedAt: secureTokens.firstUsedAt,
      renderedAt: possibleCreatorResults.firstRenderedAt,
    })
    .from(secureTokens)
    .innerJoin(campaignDrafts, eq(campaignDrafts.id, secureTokens.campaignDraftId))
    .innerJoin(
      possibleCreatorResults,
      eq(possibleCreatorResults.campaignId, campaignDrafts.campaignId),
    )
    .where(
      and(
        eq(secureTokens.scope, 'founder_draft'),
        isNotNull(secureTokens.firstUsedAt),
        isNotNull(possibleCreatorResults.firstRenderedAt),
      ),
    );

  const magicDurations = magicRows
    .map((row) => (row.renderedAt as Date).getTime() - (row.openedAt as Date).getTime())
    // A rendering that precedes the open is not a duration. It cannot happen
    // through the two services that stamp these, and dropping it silently would
    // be worse than the alternative only if it could — so the filter is here
    // and the count of observations reports what actually contributed.
    .filter((ms) => ms >= 0);

  const timeToFirstMagic = gate(invitedFounders, () => {
    const median = medianHours(magicDurations);
    if (median === null) return null;
    return {
      state: 'measured',
      unit: 'median_hours',
      value: median,
      observations: magicDurations.length,
    };
  });

  /* ── 2. Founder completion ────────────────────────────────────────────── */
  // Denominator: invitations that were opened. Numerator: of those, the ones
  // that reached a paid listing fee AND a complete Founder connected account.
  // No status filter anywhere — a campaign that was canceled, refunded, or
  // killed stays in the denominator (§33.12.7).
  const openedCampaigns = await db
    .select({ campaignId: campaignDrafts.campaignId })
    .from(secureTokens)
    .innerJoin(campaignDrafts, eq(campaignDrafts.id, secureTokens.campaignDraftId))
    .where(and(eq(secureTokens.scope, 'founder_draft'), isNotNull(secureTokens.firstUsedAt)));

  const openedIds = [...new Set(openedCampaigns.map((row) => row.campaignId))];

  let completedCount = 0;
  if (openedIds.length > 0) {
    const completed = await db
      .select({ n: sql<number>`count(DISTINCT ${listingFeePayments.campaignId})::int` })
      .from(listingFeePayments)
      .innerJoin(
        founderClaimProfiles,
        eq(founderClaimProfiles.campaignId, listingFeePayments.campaignId),
      )
      .innerJoin(
        stripeConnectedAccounts,
        and(
          eq(stripeConnectedAccounts.ownerUserId, founderClaimProfiles.claimedUserId),
          eq(stripeConnectedAccounts.role, 'founder_seller'),
          eq(stripeConnectedAccounts.state, 'complete'),
        ),
      )
      .where(inArray(listingFeePayments.campaignId, openedIds));
    completedCount = Number(completed[0]?.n ?? 0);
  }

  const founderCompletion = gate(invitedFounders, () => rate(completedCount, openedIds.length));

  /* ── 3. Return after closure ──────────────────────────────────────────── */
  const resultsRows = await db
    .select({
      campaignId: campaignResults.campaignId,
      preparedAt: campaignResults.preparedAt,
      firstViewedAt: campaignResults.firstViewedAt,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaignResults)
    .innerJoin(campaigns, eq(campaigns.id, campaignResults.campaignId));

  const windowMs = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const openedInWindow = resultsRows.filter(
    (row) =>
      row.firstViewedAt !== null &&
      row.firstViewedAt.getTime() - row.preparedAt.getTime() <= windowMs,
  );

  let returned = 0;
  if (openedInWindow.length > 0) {
    const ids = openedInWindow.map((row) => row.campaignId);
    const acted = new Set<string>();
    // Each source is a record that exists only because the Founder did
    // something after the campaign closed. Opening the results page is
    // deliberately not one of them — it is already the first half of this
    // metric, and counting it would make the numerator measure the denominator.
    const sources: Array<Promise<Array<{ campaignId: string }>>> = [
      db
        .select({ campaignId: campaignFulfillment.campaignId })
        .from(campaignFulfillment)
        .where(inArray(campaignFulfillment.campaignId, ids)),
      db
        .select({ campaignId: deliveryCommitments.campaignId })
        .from(deliveryCommitments)
        .where(and(inArray(deliveryCommitments.campaignId, ids), gte(deliveryCommitments.sequence, 2))),
      db
        .select({ campaignId: day14EvidenceSubmissions.campaignId })
        .from(day14EvidenceSubmissions)
        .where(inArray(day14EvidenceSubmissions.campaignId, ids)),
      db
        .select({ campaignId: workAgainRequests.originalCampaignId })
        .from(workAgainRequests)
        .where(inArray(workAgainRequests.originalCampaignId, ids)),
    ];
    for (const rows of await Promise.all(sources)) {
      for (const row of rows) acted.add(row.campaignId);
    }
    // A post-close campaign update is an action too, but only when it was
    // posted after the close — an update from the live campaign is not a return.
    const closeById = new Map(resultsRows.map((row) => [row.campaignId, row.closeAt]));
    const updates = await db
      .select({ campaignId: campaignUpdates.campaignId, postedAt: campaignUpdates.publishedAt })
      .from(campaignUpdates)
      .where(inArray(campaignUpdates.campaignId, ids));
    for (const row of updates) {
      const closeAt = closeById.get(row.campaignId);
      if (closeAt && row.postedAt > closeAt) acted.add(row.campaignId);
    }
    returned = openedInWindow.filter((row) => acted.has(row.campaignId)).length;
  }

  const returnAfterClosure = gate(invitedFounders, () => rate(returned, resultsRows.length));

  /* ── 4. Next-action correction rate ───────────────────────────────────── */
  const corrections = await count(
    db,
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(actRankCorrections)
      .where(inArray(actRankCorrections.correctionKind, [...CORRECTION_KINDS_COUNTED])),
  );
  const deliveries = await count(
    db,
    db.select({ n: sql<number>`count(*)::int` }).from(campaignHomeDeliveries),
  );

  const correctionRate = gate(invitedFounders, () => rate(corrections, deliveries));

  const metrics: ScoreboardEntry[] = [
    { key: 'time_to_first_magic', value: timeToFirstMagic },
    { key: 'founder_completion', value: founderCompletion },
    { key: 'return_after_closure', value: returnAfterClosure },
    { key: 'next_action_correction_rate', value: correctionRate },
  ];

  // The register decides the order and the membership; a metric added to shared
  // and not computed here fails the suite rather than quietly disappearing.
  const computedKeys = metrics.map((entry) => entry.key);
  for (const key of SCOREBOARD_METRIC_KEYS) {
    if (!computedKeys.includes(key)) {
      throw new Error(`§31.9 scoreboard metric not computed: ${key}`);
    }
  }

  return {
    notMeasuredLabel: NOT_MEASURED_LABEL,
    cohortSize: COHORT_BASELINE_SIZE,
    invitedFounders,
    baselineEstablished: invitedFounders >= COHORT_BASELINE_SIZE,
    metrics,
    secondary: await readSecondary(db),
  };
}

/* ── The secondary set ────────────────────────────────────────────────────── */

/**
 * §31.9's "also track" list, as observed counts.
 *
 * Deliberately NOT cohort-gated: §33.12.6's baseline rule names "the four
 * Founder scoreboard metrics", and these are counts of things that did or did
 * not happen rather than a baseline anyone would compare against. A count of
 * three is a true statement about three events; a completion rate over four
 * Founders is a claim about a cohort that does not exist yet.
 *
 * Two entries are `null` with the reason, never approximated — see the shared
 * register for why an autosave-failure counter and an email-open pixel are both
 * the thing §31.9 forbids rather than a gap to fill.
 */
async function readSecondary(db: Database): Promise<SecondaryEntry[]> {
  const byTopic = async (topics: string[]) =>
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(supportCases)
        .where(inArray(supportCases.topic, topics)),
    );

  const [
    listingFeeContacts,
    proposalOutcomes,
    compensationQuestions,
    preorderFailures,
    reminderDeliveries,
    supportFreeCancellations,
    paymentRecoveries,
    unknownChargeContacts,
    disputes,
    slaMisses,
    satisfactionResponses,
    duplicatesSuppressed,
    messagesSent,
    firstCreatorResponses,
  ] = await Promise.all([
    byTopic(['payment_failed', 'refund']),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(proposalVersions)
        .where(inArray(proposalVersions.state, ['locked', 'declined', 'superseded'])),
    ),
    byTopic(['campaign_question']),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'reservation.create_failed')),
    ),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.eventKey, 'backer_precharge_reminder')),
    ),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'reservation.canceled')),
    ),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(reservationCaptureAttempts)
        .where(gte(reservationCaptureAttempts.attemptNumber, 2)),
    ),
    byTopic(['unknown_charge']),
    count(db, db.select({ n: sql<number>`count(*)::int` }).from(paymentDisputes)),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(supportCases)
        .where(
          and(
            eq(supportCases.status, 'open'),
            lte(supportCases.humanResponseDueAt, new Date()),
          ),
        ),
    ),
    count(db, db.select({ n: sql<number>`count(*)::int` }).from(backerSatisfactionResponses)),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'notification.duplicate_suppressed')),
    ),
    count(db, db.select({ n: sql<number>`count(*)::int` }).from(notificationDeliveries)),
    count(
      db,
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(proposalVersions)
        // The Creator's own recorded answer to a formal proposal — §14.2's
        // decision, not the Founder's, and not the version merely existing.
        .where(isNotNull(proposalVersions.affiliateDecidedAt)),
    ),
  ]);

  return [
    {
      key: 'autosave_failures',
      label: 'Autosave failures',
      count: null,
      absentBecause:
        '§9 autosave reports its own outcome to the Founder and retries; nothing records a failure count, and a client-side beacon to produce one is the analytics warehouse §31.9 forbids.',
    },
    {
      key: 'listing_fee_support_contacts',
      label: 'Listing-fee support contacts',
      count: listingFeeContacts,
    },
    {
      key: 'time_to_first_creator_response',
      label: 'Formal Creator responses recorded',
      count: firstCreatorResponses,
    },
    { key: 'proposal_outcomes', label: 'Proposal outcomes', count: proposalOutcomes },
    {
      key: 'compensation_questions',
      label: 'Compensation questions',
      count: compensationQuestions,
    },
    {
      key: 'reservation_failure_step',
      label: 'Pre-order failures recorded',
      count: preorderFailures,
    },
    {
      key: 'reminder_delivery_and_cancel',
      label: 'Pre-charge reminders delivered',
      count: reminderDeliveries,
      absentBecause:
        '§27 ships no tracking pixel, so the open half of §31.9’s "delivery/open/cancel" has no source. Delivery and cancellation are both recorded.',
    },
    {
      key: 'support_free_cancellation',
      label: 'Cancellations recorded',
      count: supportFreeCancellations,
    },
    { key: 'payment_recovery', label: 'Capture retries attempted', count: paymentRecoveries },
    {
      key: 'unknown_charge_contacts_and_disputes',
      label: 'Unknown-charge contacts and disputes',
      count: unknownChargeContacts + disputes,
    },
    { key: 'support_sla_misses', label: 'Support SLA misses', count: slaMisses },
    {
      key: 'delivery_satisfaction_and_followup',
      label: 'Satisfaction responses',
      count: satisfactionResponses,
    },
    {
      key: 'duplicate_messages_suppressed_vs_sent',
      label: 'Duplicate messages suppressed / messages sent',
      count: duplicatesSuppressed,
    },
    { key: 'messages_sent', label: 'Messages sent', count: messagesSent },
  ];
}
