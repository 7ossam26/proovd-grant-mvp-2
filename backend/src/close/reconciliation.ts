/**
 * Admin reconciliation and the visibly-recoverable batch — Spec §21, §33.7.12
 * (Phase 18b).
 *
 * ── The recoverable batch was always a fact; this renders and operates it ───
 * 18a left an interrupted batch as a row with `completed_at` NULL, reservations
 * locked in `pending_capture`, and unresolved attempt rows under stable keys.
 * `readCloseOperations` is the queue that makes that visible (§33.7.12), and
 * the resume action is `runCloseBatch` itself — the same idempotent machine the
 * sweep runs, because a recovery path that differed from the normal path would
 * be a second batch implementation waiting to double-charge.
 *
 * ── Verification is derived facts + a recorded judgement (§34's shape) ──────
 * For each §21 item the app derives what its records can prove; the Admin
 * records the verification with a note (§1.3). "Reconciliation begins only
 * after the window closes" is enforced at the write: a campaign still in
 * `capture_retry_window` refuses the record by name.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import {
  campaignCloseBatches,
  campaignReconciliations,
  campaignResults,
  reservationCaptureAttempts,
  type CampaignReconciliation,
} from '../db/schema/close.js';
import { deduplicationCases } from '../db/schema/reservations.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { trackingLinks } from '../db/schema/decisions.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  RECONCILIATION_ITEMS,
  RECONCILIATION_RESULTS,
  type ReconciliationItemKey,
  type ReconciliationResult,
} from './logic.js';

/* ── The close operations queue (§33.7.12) ─────────────────────────────────── */

export interface CloseOperations {
  /** Batches with `completed_at` NULL — the §33.7.12 recoverable set, first. */
  incomplete: Array<{
    campaignId: string;
    batchStatus: string;
    campaignStatus: string;
    startedAt: string;
    /** Reservations still locked in `pending_capture` — the honest state. */
    lockedReservations: number;
    /** Attempts claimed but unresolved — retried under the SAME key on resume. */
    unresolvedAttempts: number;
    /** Open §4.1 cases parking the threshold decision, when any. */
    openDedupCases: number;
    recovery: string;
  }>;
  /** Campaigns inside the one 48-hour window. */
  retryWindow: Array<{
    campaignId: string;
    firstFailureAt: string | null;
    retryDeadlineAt: string | null;
    retrying: number;
  }>;
  /** Charge outcomes final; reconciliation and results preparation due. */
  reconciling: Array<{
    campaignId: string;
    campaignStatus: string;
    requiredItemsVerified: number;
    requiredItemsTotal: number;
    resultsPrepared: boolean;
  }>;
}

export async function readCloseOperations(db: Database): Promise<CloseOperations> {
  const batches = await db
    .select({
      id: campaignCloseBatches.id,
      campaignId: campaignCloseBatches.campaignId,
      status: campaignCloseBatches.status,
      startedAt: campaignCloseBatches.startedAt,
      completedAt: campaignCloseBatches.completedAt,
      firstFailureAt: campaignCloseBatches.firstFailureAt,
      retryDeadlineAt: campaignCloseBatches.retryDeadlineAt,
      campaignStatus: campaigns.status,
    })
    .from(campaignCloseBatches)
    .innerJoin(campaigns, eq(campaigns.id, campaignCloseBatches.campaignId))
    .orderBy(campaignCloseBatches.startedAt);

  const incomplete: CloseOperations['incomplete'] = [];
  const retryWindow: CloseOperations['retryWindow'] = [];
  const reconciling: CloseOperations['reconciling'] = [];

  const requiredKeys = RECONCILIATION_ITEMS.filter((i) => i.requiredForResults).map((i) => i.key);

  for (const batch of batches) {
    if (!batch.completedAt) {
      const [locked] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .where(
          and(
            eq(reservations.campaignId, batch.campaignId),
            eq(reservations.status, 'pending_capture'),
          ),
        );
      const [unresolved] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reservationCaptureAttempts)
        .where(
          and(
            eq(reservationCaptureAttempts.campaignId, batch.campaignId),
            sql`${reservationCaptureAttempts.outcome} IS NULL OR ${reservationCaptureAttempts.outcome} = 'provider_error'`,
          ),
        );
      const [openCases] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deduplicationCases)
        .where(
          and(
            eq(deduplicationCases.campaignId, batch.campaignId),
            eq(deduplicationCases.status, 'open'),
          ),
        );
      incomplete.push({
        campaignId: batch.campaignId,
        batchStatus: batch.status,
        campaignStatus: batch.campaignStatus,
        startedAt: batch.startedAt.toISOString(),
        lockedReservations: Number(locked?.count ?? 0),
        unresolvedAttempts: Number(unresolved?.count ?? 0),
        openDedupCases: Number(openCases?.count ?? 0),
        recovery:
          batch.status === 'waiting_dedup_resolution'
            ? 'Decide the open duplicate case(s); the batch resumes on the next sweep or with Resume.'
            : 'Resume the batch — every retry reuses the same stable attempt keys, so no card can be charged twice (§33.7.7).',
      });
      continue;
    }

    if (batch.campaignStatus === 'capture_retry_window') {
      const [retrying] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .where(
          and(
            eq(reservations.campaignId, batch.campaignId),
            eq(reservations.status, 'capture_failed_retrying'),
          ),
        );
      retryWindow.push({
        campaignId: batch.campaignId,
        firstFailureAt: batch.firstFailureAt?.toISOString() ?? null,
        retryDeadlineAt: batch.retryDeadlineAt?.toISOString() ?? null,
        retrying: Number(retrying?.count ?? 0),
      });
      continue;
    }

    if (batch.campaignStatus === 'closed_reconciling' || batch.campaignStatus === 'ended_no_charge') {
      let verified = 0;
      for (const key of requiredKeys) {
        const [latest] = await db
          .select({ result: campaignReconciliations.result })
          .from(campaignReconciliations)
          .where(
            and(
              eq(campaignReconciliations.campaignId, batch.campaignId),
              eq(campaignReconciliations.itemKey, key),
            ),
          )
          .orderBy(desc(campaignReconciliations.recordedAt))
          .limit(1);
        if (latest?.result === 'verified') verified += 1;
      }
      const [prepared] = await db
        .select({ id: campaignResults.id })
        .from(campaignResults)
        .where(eq(campaignResults.campaignId, batch.campaignId))
        .limit(1);
      reconciling.push({
        campaignId: batch.campaignId,
        campaignStatus: batch.campaignStatus,
        requiredItemsVerified: verified,
        requiredItemsTotal: requiredKeys.length,
        resultsPrepared: Boolean(prepared),
      });
    }
  }

  return { incomplete, retryWindow, reconciling };
}

/* ── The per-campaign reconciliation read (§21) ────────────────────────────── */

export interface ReconciliationItemView {
  key: ReconciliationItemKey;
  spec: string;
  evaluation: 'app' | 'admin';
  requiredForResults: boolean;
  /** What the app's own records show for this item, when it can derive them. */
  derived: Record<string, unknown> | null;
  /** Named when the item cannot complete until a later phase (§1.4). */
  waitsOn: string | null;
  /** The latest recorded verification, when one exists. */
  latest: { result: string; note: string; actor: string; recordedAt: string } | null;
  history: Array<{ result: string; note: string; actor: string; recordedAt: string }>;
}

export interface ReconciliationView {
  campaignId: string;
  campaignStatus: string;
  /** §21: reconciliation begins only after the window closes. */
  open: boolean;
  openReason: string | null;
  items: ReconciliationItemView[];
  resultsPrepared: boolean;
}

export async function readReconciliation(
  db: Database,
  campaignId: string,
): Promise<ReconciliationView | null> {
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const open = campaign.status === 'closed_reconciling' || campaign.status === 'ended_no_charge';
  const openReason = open
    ? null
    : campaign.status === 'capture_retry_window'
      ? 'The 48-hour retry window is still open — reconciliation begins only after it closes (§21).'
      : campaign.status === 'closed_pending_capture'
        ? 'The close batch has not completed — resume it first.'
        : `The campaign is ${campaign.status}; there is nothing to reconcile yet.`;

  const rows = await db
    .select()
    .from(campaignReconciliations)
    .where(eq(campaignReconciliations.campaignId, campaignId))
    .orderBy(desc(campaignReconciliations.recordedAt));

  const [batch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);

  const [statusCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${reservations.status} in ('pending_capture', 'capture_failed_retrying'))::int`,
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      dropped: sql<number>`count(*) filter (where ${reservations.status} = 'capture_failed_dropped')::int`,
      exactAmount: sql<number>`count(*) filter (where ${reservations.status} = 'captured' and ${reservations.totalCapturedCents} = ${reservations.totalAuthorizedCents})::int`,
      taxUsable: sql<number>`count(*) filter (where ${reservations.status} = 'captured' and ${reservations.taxCloseUsable} = true)::int`,
      attributedCaptured: sql<number>`count(*) filter (where ${reservations.status} = 'captured' and ${reservations.attributionAssociationId} is not null)::int`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId));

  // §21: attribution validity leans on §17's post verification — how many
  // attributed captures point at an association whose first post passed.
  const attributedAssociations = await db
    .selectDistinct({ associationId: reservations.attributionAssociationId })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, campaignId),
        eq(reservations.status, 'captured'),
        sql`${reservations.attributionAssociationId} is not null`,
      ),
    );
  let passedAssociations = 0;
  for (const row of attributedAssociations) {
    const [passed] = await db
      .select({ id: creatorPostSubmissions.id })
      .from(creatorPostSubmissions)
      .where(
        and(
          eq(creatorPostSubmissions.associationId, row.associationId!),
          eq(creatorPostSubmissions.status, 'passed'),
        ),
      )
      .limit(1);
    if (passed) passedAssociations += 1;
  }
  const [pausedLinks] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trackingLinks)
    .where(and(eq(trackingLinks.campaignId, campaignId), sql`${trackingLinks.pausedAt} is not null`));

  const derivedByKey: Partial<Record<ReconciliationItemKey, Record<string, unknown>>> = {
    batch_completeness: {
      batchComplete: Boolean(batch?.completedAt),
      reservations: Number(statusCounts?.total ?? 0),
      stillPending: Number(statusCounts?.pending ?? 0),
      captured: Number(statusCounts?.captured ?? 0),
      dropped: Number(statusCounts?.dropped ?? 0),
      thresholdDecision:
        batch?.thresholdDecidedAt != null
          ? { met: batch.thresholdMet, unique: batch.uniqueActiveBackers, required: batch.thresholdRequired }
          : null,
    },
    tax_charge_reconciliation: {
      captured: Number(statusCounts?.captured ?? 0),
      chargedExactAuthorizedTotal: Number(statusCounts?.exactAmount ?? 0),
      taxCloseUsable: Number(statusCounts?.taxUsable ?? 0),
    },
    attribution_post_verification: {
      attributedCaptures: Number(statusCounts?.attributedCaptured ?? 0),
      attributedAssociations: attributedAssociations.length,
      associationsWithPassedFirstPost: passedAssociations,
      pausedLinks: Number(pausedLinks?.count ?? 0),
    },
  };

  const items: ReconciliationItemView[] = RECONCILIATION_ITEMS.map((item) => {
    const history = rows
      .filter((r) => r.itemKey === item.key)
      .map((r) => ({
        result: r.result,
        note: r.note,
        actor: r.actor,
        recordedAt: r.recordedAt.toISOString(),
      }));
    return {
      key: item.key,
      spec: item.spec,
      evaluation: item.evaluation,
      requiredForResults: item.requiredForResults,
      derived: derivedByKey[item.key] ?? null,
      waitsOn: item.waitsOn,
      latest: history[0] ?? null,
      history,
    };
  });

  const [prepared] = await db
    .select({ id: campaignResults.id })
    .from(campaignResults)
    .where(eq(campaignResults.campaignId, campaignId))
    .limit(1);

  return {
    campaignId,
    campaignStatus: campaign.status,
    open,
    openReason,
    items,
    resultsPrepared: Boolean(prepared),
  };
}

/* ── Recording one verification (§21, §1.3) ────────────────────────────────── */

export type RecordReconciliationOutcome =
  | { status: 'recorded'; record: CampaignReconciliation }
  | { status: 'unknown_item'; itemKey: string }
  | { status: 'invalid_result'; result: string }
  | { status: 'retry_window_open' }
  | { status: 'batch_incomplete' }
  | { status: 'not_reconcilable'; current: string }
  | { status: 'not_found' };

export async function recordReconciliationItem(
  deps: { db: Database; audit: AuditWriter },
  input: {
    campaignId: string;
    itemKey: string;
    result: string;
    note: string;
    actor: string;
    now?: Date;
  },
): Promise<RecordReconciliationOutcome> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();

  // The register decides what exists — a free-string item would record a
  // verification of nothing (16a's overridable-field reasoning).
  if (!RECONCILIATION_ITEMS.some((i) => i.key === input.itemKey)) {
    return { status: 'unknown_item', itemKey: input.itemKey };
  }
  if (!(RECONCILIATION_RESULTS as readonly string[]).includes(input.result)) {
    return { status: 'invalid_result', result: input.result };
  }

  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { status: 'not_found' };
  if (campaign.status === 'capture_retry_window') return { status: 'retry_window_open' };
  if (campaign.status === 'closed_pending_capture') return { status: 'batch_incomplete' };
  if (campaign.status !== 'closed_reconciling' && campaign.status !== 'ended_no_charge') {
    return { status: 'not_reconcilable', current: campaign.status };
  }

  const [record] = await db
    .insert(campaignReconciliations)
    .values({
      campaignId: input.campaignId,
      itemKey: input.itemKey,
      result: input.result as ReconciliationResult,
      note: input.note,
      actor: input.actor,
      recordedAt: now,
    })
    .returning();

  await audit({
    action: 'close.reconciliation_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§21 reconciliation item "${input.itemKey}" recorded as ${input.result}: ${input.note}`,
    newValue: { itemKey: input.itemKey, result: input.result },
    actorId: input.actor,
  });

  return { status: 'recorded', record: record! };
}

/* ── The batch detail read (§33.7.12) ──────────────────────────────────────── */

export interface CloseBatchDetail {
  campaignId: string;
  campaignStatus: string;
  batch: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    thresholdDecision: { met: boolean; unique: number; required: number } | null;
    retryWindowHours: number;
    firstFailureAt: string | null;
    retryDeadlineAt: string | null;
  } | null;
  reservationsByStatus: Record<string, number>;
  attempts: Array<{
    reservationId: string;
    attemptNumber: number;
    idempotencyKey: string;
    amountCents: string;
    outcome: string | null;
    paymentIntentId: string | null;
    requestedAt: string;
    resolvedAt: string | null;
  }>;
}

export async function readCloseBatchDetail(
  db: Database,
  campaignId: string,
): Promise<CloseBatchDetail | null> {
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const [batch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);

  const counts = await db
    .select({ status: reservations.status, count: sql<number>`count(*)::int` })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId))
    .groupBy(reservations.status);

  const attempts = await db
    .select()
    .from(reservationCaptureAttempts)
    .where(eq(reservationCaptureAttempts.campaignId, campaignId))
    .orderBy(reservationCaptureAttempts.requestedAt);

  return {
    campaignId,
    campaignStatus: campaign.status,
    batch: batch
      ? {
          status: batch.status,
          startedAt: batch.startedAt.toISOString(),
          completedAt: batch.completedAt?.toISOString() ?? null,
          thresholdDecision:
            batch.thresholdDecidedAt != null
              ? {
                  met: batch.thresholdMet!,
                  unique: batch.uniqueActiveBackers!,
                  required: batch.thresholdRequired!,
                }
              : null,
          retryWindowHours: batch.retryWindowHours,
          firstFailureAt: batch.firstFailureAt?.toISOString() ?? null,
          retryDeadlineAt: batch.retryDeadlineAt?.toISOString() ?? null,
        }
      : null,
    reservationsByStatus: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])),
    attempts: attempts.map((a) => ({
      reservationId: a.reservationId,
      attemptNumber: a.attemptNumber,
      idempotencyKey: a.idempotencyKey,
      amountCents: a.amountCents.toString(),
      outcome: a.outcome,
      paymentIntentId: a.paymentIntentId,
      requestedAt: a.requestedAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
    })),
  };
}
