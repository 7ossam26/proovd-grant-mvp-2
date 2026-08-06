/**
 * The §21 close batch — Spec §21, §4.1, §24.2, §33.7.4–§33.7.7, §33.7.12
 * (Phase 18a).
 *
 * At `campaign_close_at` the outcome is fixed, eligible cards are charged for
 * exactly the amount consented to, failures enter the one bounded recovery
 * window, and running any of it twice changes nothing. That last sentence is
 * the phase, and it is carried by mechanisms rather than care:
 *
 *  - the batch row is unique per campaign and claimed first — a second run
 *    resumes the first batch, it does not start a second;
 *  - every status move is a conditional UPDATE + history row, so a re-run
 *    matches nothing already moved;
 *  - every PaymentIntent is created under a stable per-reservation attempt key
 *    claimed BEFORE the provider call — a crash anywhere between the claim and
 *    the record retries as the SAME intent at Stripe (§33.7.7);
 *  - every message dedups on the reservation or the campaign (§27.2);
 *  - the Idea threshold is decided once, from the state at exactly close, and
 *    the database refuses to move it (§33.7.5).
 *
 * A worker crash mid-batch leaves the batch row visibly incomplete
 * (`completed_at` NULL) with reservations still locked in `pending_capture` —
 * the honest state §33.7.12 requires — and the sweep resumes it on the next
 * tick. Nothing here selects on `killed` or `suspended`, which is what makes
 * §26.7's "block future PaymentIntents" structural.
 */

import { and, eq, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { checkLiveMoneyPermitted } from '../live-mode/guard.js';
import {
  campaigns,
  campaignStatusHistory,
  campaignPaymentFlags,
  reservations,
  reservationStatusHistory,
  type Reservation,
} from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignCloseBatches, reservationCaptureAttempts, type CampaignCloseBatch } from '../db/schema/close.js';
import { deduplicationCases, founderOperationalShares } from '../db/schema/reservations.js';
import { releaseCapacity } from '../reservations/capacity.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import { campaignDescriptorSuffix } from '../payments/descriptors.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { findCampaignFounderUserId } from '../reservations/context.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import { readSettingValue } from '../settings/service.js';
import {
  classifyCaptureFailure,
  foldMergedIdentities,
  ideaCloseThresholdMet,
  validateCaptureUsability,
  TAX_UNUSABLE_REASON,
} from './logic.js';
import {
  applyCaptureDrop,
  applyCaptureFailure,
  applyCaptureSuccess,
} from './capture.js';
import { requestFounderW9 } from './founder-payments.js';
import {
  notifyBatchResult,
  notifyCampaignEnded,
  notifyCaptureDropped,
  notifyCaptureFailed,
  notifyChargeReceipt,
  notifyThresholdMissClosure,
  notifyCreatorsCampaignClosed,
  type CloseNotificationDeps,
} from './notifications.js';

export const CAPTURE_RETRY_WINDOW_SETTING_KEY = 'capture_retry_window_hours';

/** The stable §21 step 6 attempt key. Attempt 1 is the close batch's; the 18b
    retry window mints attempt 2 with its own key. */
export function captureAttemptKey(reservationId: string, attempt: number): string {
  return `reservation-capture:${reservationId}:${attempt}`;
}

export interface CloseBatchDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** The §21 messages. Absent (some tests) → state still moves, nothing sends. */
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

export interface CloseBatchSummary {
  status:
    | 'complete'
    | 'incomplete'
    | 'waiting_dedup_resolution'
    | 'blocked'
    | 'not_due'
    | 'not_closable'
    | 'not_found'
    | 'already_complete';
  campaignId: string;
  batch?: CampaignCloseBatch;
  captured: number;
  failed: number;
  dropped: number;
  noCharge: number;
  /** Attempts that errored at the transport — the batch stays incomplete. */
  errored: number;
  reason?: string;
}

function summary(
  status: CloseBatchSummary['status'],
  campaignId: string,
  partial: Partial<CloseBatchSummary> = {},
): CloseBatchSummary {
  return { status, campaignId, captured: 0, failed: 0, dropped: 0, noCharge: 0, errored: 0, ...partial };
}

function notificationDeps(deps: CloseBatchDeps): CloseNotificationDeps | null {
  if (!deps.notifier || !deps.context) return null;
  return { db: deps.db, notifier: deps.notifier, context: deps.context, tokens: deps.tokens };
}

/* ── The batch ─────────────────────────────────────────────────────────────── */

/**
 * Runs — or resumes — the close batch for one campaign. Independently
 * idempotent at every step; safe to call twice, concurrently, or after a
 * crash (§33.7.7, §33.7.12).
 */
export async function runCloseBatch(
  deps: CloseBatchDeps,
  input: { campaignId: string; actor: string; now?: Date },
): Promise<CloseBatchSummary> {
  const { db, audit } = deps;
  const now = input.now ?? new Date();
  const { campaignId } = input;

  // §34, §6 — before anything is locked or excluded. `blocked` rather than a
  // new status: the batch genuinely is blocked, the reason rides the summary,
  // and the sweep will pick it up again once live mode is enabled — which is
  // the right behaviour, because the close is still owed.
  const live = await checkLiveMoneyPermitted(db, deps.gateway.mode, campaignId);
  if (!live.permitted) return summary('blocked', campaignId, { reason: live.message });

  const [campaign] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      type: campaigns.type,
      campaignCloseAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return summary('not_found', campaignId);
  if (campaign.status !== 'live' && campaign.status !== 'closed_pending_capture') {
    // ended_no_charge / capture_retry_window / closed_reconciling mean a batch
    // already finished; killed/suspended mean §26.7 blocked future
    // PaymentIntents by the lifecycle itself — this select-and-refuse is that
    // enforcement.
    return summary(
      campaign.status === 'ended_no_charge' ||
        campaign.status === 'capture_retry_window' ||
        campaign.status === 'closed_reconciling'
        ? 'already_complete'
        : 'not_closable',
      campaignId,
      { reason: `campaign is ${campaign.status}` },
    );
  }
  if (!campaign.campaignCloseAt) {
    return summary('not_closable', campaignId, { reason: 'no campaign_close_at anchor (§21)' });
  }
  if (campaign.status === 'live' && campaign.campaignCloseAt.getTime() > now.getTime()) {
    return summary('not_due', campaignId);
  }
  if (!campaign.type) {
    return summary('not_closable', campaignId, { reason: 'campaign has no locked type' });
  }

  // The §6 hours in force NOW, stored on the batch so the promise never moves
  // (§29.6). Read before anything transitions.
  const hoursValue = await readSettingValue(db, CAPTURE_RETRY_WINDOW_SETTING_KEY);
  const retryWindowHours = typeof hoursValue === 'number' ? hoursValue : 48;

  /* ── Step 1–3: enter closed_pending_capture and claim the batch row ──────
     "Lock active reservations" and "stop cancellation/joining" are the close
     boundary itself: leaving `live` at the anchor ends both (the cancellation
     and mid-campaign services check the anchor independently, so the minutes
     between close_at and this sweep tick are covered either way). */
  const batch = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update')
      .limit(1);
    if (!locked) return null;

    await tx
      .insert(campaignCloseBatches)
      .values({
        campaignId,
        campaignType: campaign.type!,
        closeAt: campaign.campaignCloseAt!,
        retryWindowHours,
        actor: input.actor,
        startedAt: now,
      })
      .onConflictDoNothing();

    if (locked.status === 'live') {
      const moved = await tx
        .update(campaigns)
        .set({ status: 'closed_pending_capture', updatedAt: now })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'live')))
        .returning({ id: campaigns.id });
      if (moved.length === 1) {
        await tx.insert(campaignStatusHistory).values({
          campaignId,
          fromStatus: 'live',
          toStatus: 'closed_pending_capture',
          actor: input.actor,
        });
      }
    }

    const [row] = await tx
      .select()
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.campaignId, campaignId))
      .limit(1);
    return row ?? null;
  });
  if (!batch) return summary('not_found', campaignId);
  if (batch.completedAt) return summary('already_complete', campaignId, { batch });

  const notify = notificationDeps(deps);

  /* ── Step 4: the Idea threshold decision, once, from the state at close ── */
  let thresholdMet: boolean | null = batch.thresholdMet;
  if (campaign.type === 'pre_build' && !batch.thresholdDecidedAt) {
    const open = await db
      .select({ id: deduplicationCases.id })
      .from(deduplicationCases)
      .where(
        and(eq(deduplicationCases.campaignId, campaignId), eq(deduplicationCases.status, 'open')),
      );
    if (open.length > 0) {
      // §21 step 4 resolves duplicates BEFORE the count, and an open case is an
      // Admin decision that has not been made. The batch waits visibly rather
      // than inventing one (§1 rule 6, §1.3); the sweep retries after Admin
      // decides, and cancellation/joining stayed closed at the anchor.
      await db
        .update(campaignCloseBatches)
        .set({ status: 'waiting_dedup_resolution', updatedAt: now })
        .where(
          and(eq(campaignCloseBatches.id, batch.id), eq(campaignCloseBatches.status, 'in_progress')),
        );
      await audit({
        action: 'close.waiting_dedup_resolution',
        targetType: 'campaign',
        targetId: campaignId,
        internalReason:
          `the close batch cannot decide the Idea threshold: ${open.length} deduplication case(s) are ` +
          'still open (§4.1). Reservations stay locked; the batch resumes when Admin decides.',
        actorId: input.actor,
      });
      if (notify) {
        await notifyCampaignEnded(notify, {
          campaignId,
          closedAt: campaign.campaignCloseAt,
          outcomeLine: 'Your close results are being prepared and will follow separately.',
        });
      }
      return summary('waiting_dedup_resolution', campaignId, { batch });
    }

    const [buildRow] = await db
      .select({ orderThreshold: campaignBuild.orderThreshold })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, campaignId))
      .limit(1);
    const threshold = buildRow?.orderThreshold ?? null;
    if (threshold === null || threshold < 1) {
      await audit({
        action: 'close.missing_threshold',
        targetType: 'campaign',
        targetId: campaignId,
        internalReason:
          'an Idea campaign reached close with no disclosed order threshold; the batch is blocked for Admin (§1.4)',
        actorId: input.actor,
      });
      return summary('blocked', campaignId, { batch, reason: 'missing_threshold' });
    }

    const activeIdentities = await db
      .selectDistinct({ backerIdentityId: reservations.backerIdentityId })
      .from(reservations)
      .where(and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')));
    const merged = await db
      .select({
        primary: deduplicationCases.primaryBackerIdentityId,
        suspected: deduplicationCases.suspectedBackerIdentityId,
      })
      .from(deduplicationCases)
      .where(
        and(eq(deduplicationCases.campaignId, campaignId), eq(deduplicationCases.status, 'merged')),
      );

    const unique = foldMergedIdentities(
      activeIdentities.map((r) => r.backerIdentityId),
      merged.map((r) => [r.primary, r.suspected] as const),
    );
    thresholdMet = ideaCloseThresholdMet(unique, threshold);

    await db
      .update(campaignCloseBatches)
      .set({
        thresholdRequired: threshold,
        uniqueActiveBackers: unique,
        thresholdMet,
        thresholdDecidedAt: now,
        status: 'in_progress',
        updatedAt: now,
      })
      .where(
        and(
          eq(campaignCloseBatches.id, batch.id),
          sql`${campaignCloseBatches.thresholdDecidedAt} IS NULL`,
        ),
      );

    await audit({
      action: 'close.threshold_decided',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason:
        `Idea threshold ${thresholdMet ? 'met' : 'missed'} at close: ${unique} practical unique active ` +
        `Backer(s) (after ${merged.length} merged case(s)) against a threshold of ${threshold}. ` +
        'The decision is fixed; later payment failures never reverse it (§33.7.5).',
      newValue: { uniqueActiveBackers: unique, threshold, thresholdMet },
      actorId: input.actor,
    });
  }

  // Re-read the batch so resumed runs see the decided values.
  const [decided] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.id, batch.id))
    .limit(1);
  const currentBatch = decided ?? batch;
  thresholdMet = campaign.type === 'pre_build' ? currentBatch.thresholdMet : null;

  /* ── `Campaign ended` fires at close (§33.7.11) — outcome-aware, deduped ── */
  if (notify) {
    const outcomeLine =
      campaign.type === 'pre_launch'
        ? 'Every active pre-order is being charged the exact total its Backer authorized. Missing an internal target changes nothing — this campaign keeps what it raised.'
        : thresholdMet
          ? `Your campaign reached its order threshold — ${currentBatch.uniqueActiveBackers} unique backers against ${currentBatch.thresholdRequired} required — so eligible saved cards are being charged.`
          : `Your campaign closed below its order threshold — ${currentBatch.uniqueActiveBackers} of ${currentBatch.thresholdRequired} unique backers — so no cards are charged and every pre-order closed at US$0.`;
    await notifyCampaignEnded(notify, {
      campaignId,
      closedAt: campaign.campaignCloseAt,
      outcomeLine,
    });
  }

  /* ── Step 5: the threshold-miss path — no PaymentIntent, ever (§33.7.4) ── */
  if (campaign.type === 'pre_build' && thresholdMet === false) {
    return applyThresholdMiss(deps, { campaignId, batch: currentBatch, actor: input.actor, now });
  }

  /* ── Step 6: lock, validate, capture (§33.7.6, §33.7.7, §33.7.8) ────────── */
  return applyChargePath(deps, {
    campaignId,
    batchId: currentBatch.id,
    actor: input.actor,
    now,
  });
}

/* ── The miss path (§21 step 5) ────────────────────────────────────────────── */

async function applyThresholdMiss(
  deps: CloseBatchDeps,
  input: { campaignId: string; batch: CampaignCloseBatch; actor: string; now: Date },
): Promise<CloseBatchSummary> {
  const { db, audit } = deps;
  const { campaignId, actor, now } = input;

  // Reference-safe detach set, decided BEFORE anything closes so every
  // reservation is still `reserved_active` for the comparison (§33.7.2 — the
  // enforcement/cancellation shape).
  const active = await db
    .select({
      id: reservations.id,
      backerIdentityId: reservations.backerIdentityId,
      paymentMethodId: reservations.paymentMethodId,
    })
    .from(reservations)
    .where(and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')));

  const detachable: Array<{ reservationId: string; paymentMethodId: string }> = [];
  for (const row of active) {
    if (!row.paymentMethodId) continue;
    const [other] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.backerIdentityId, row.backerIdentityId),
          eq(reservations.paymentMethodId, row.paymentMethodId),
          eq(reservations.status, 'reserved_active'),
          sql`${reservations.id} <> ${row.id}`,
        ),
      )
      .limit(1);
    if (!other) detachable.push({ reservationId: row.id, paymentMethodId: row.paymentMethodId });
  }

  const applied = await db.transaction(async (tx) => {
    // §21 step 5: reservations close `threshold_not_met_no_charge` — a state
    // with no outgoing edge, so future-charge eligibility is removed by the
    // machine itself, not by a flag (§23.5).
    const closed = await tx
      .update(reservations)
      .set({ status: 'threshold_not_met_no_charge', updatedAt: now })
      .where(
        and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')),
      )
      .returning({ id: reservations.id, subtotal: reservations.rewardSubtotalCents });

    for (const row of closed) {
      await tx.insert(reservationStatusHistory).values({
        reservationId: row.id,
        fromStatus: 'reserved_active',
        toStatus: 'threshold_not_met_no_charge',
        actor,
      });
      await releaseCapacity(tx, campaignId, row.subtotal);
      await tx
        .update(founderOperationalShares)
        .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: now, deliveryStatus: 'do_not_fulfill' })
        .where(eq(founderOperationalShares.reservationId, row.id));
    }

    // §21 step 5: the campaign ends `ended_no_charge`.
    const moved = await tx
      .update(campaigns)
      .set({ status: 'ended_no_charge', updatedAt: now })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'closed_pending_capture')))
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId,
        fromStatus: 'closed_pending_capture',
        toStatus: 'ended_no_charge',
        actor,
      });
    }

    const [noChargeCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.campaignId, campaignId),
          eq(reservations.status, 'threshold_not_met_no_charge'),
        ),
      );

    // Complete the batch (guarded: a resumed run that finds it complete
    // returned earlier; the trigger refuses updates after completion).
    await tx
      .update(campaignCloseBatches)
      .set({
        status: 'complete',
        completedAt: now,
        noChargeReservationCount: Number(noChargeCount?.count ?? 0),
        lockedReservationCount: 0,
        updatedAt: now,
      })
      .where(
        and(eq(campaignCloseBatches.id, input.batch.id), sql`${campaignCloseBatches.completedAt} IS NULL`),
      );

    return { closed: closed.length, noCharge: Number(noChargeCount?.count ?? 0) };
  });

  // Detach after the commit; a provider refusal is recorded, never rolled back.
  let detached = 0;
  const founderUserId = await findCampaignFounderUserId(db, campaignId);
  const account = founderUserId
    ? await findAccountForOwner(db, {
        ownerUserId: founderUserId,
        role: 'founder_seller',
        mode: deps.gateway.mode,
      })
    : null;
  if (account) {
    for (const target of detachable) {
      try {
        await deps.gateway.detachPaymentMethod({
          paymentMethodId: target.paymentMethodId,
          connectedAccountId: account.stripeAccountId,
        });
        detached += 1;
      } catch (error) {
        await audit({
          action: 'close.detach_failed',
          targetType: 'reservation',
          targetId: target.reservationId,
          internalReason: `PaymentMethod detach failed after threshold-miss close: ${
            error instanceof Error ? error.message : String(error)
          }. The reservation is closed; the method can be detached on retry.`,
        });
      }
    }
  }

  await audit({
    action: 'close.threshold_miss_applied',
    targetType: 'campaign',
    targetId: campaignId,
    internalReason:
      `Idea threshold missed at close: ${applied.noCharge} reservation(s) closed threshold_not_met_no_charge, ` +
      `campaign ended_no_charge, ${detached} PaymentMethod(s) reference-safely detached. ` +
      'No PaymentIntent and no refund object were created — there was nothing to refund (§33.7.4).',
    actorId: actor,
  });

  // The US$0 closures, deduped per reservation — a resumed run re-sends none.
  const notify = notificationDeps(deps);
  if (notify) {
    const closedRows = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.campaignId, campaignId),
          eq(reservations.status, 'threshold_not_met_no_charge'),
        ),
      );
    for (const row of closedRows) {
      await notifyThresholdMissClosure(notify, row);
    }
    const [batchRow] = await db
      .select()
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.id, input.batch.id))
      .limit(1);
    if (batchRow) {
      await notifyBatchResult(notify, batchRow, {
        captured: 0,
        failed: 0,
        dropped: 0,
        noCharge: applied.noCharge,
      });
    }
    // §27.4 (18b): the campaign's charge outcome is final at the miss — the
    // Creator's factual close notice sends now, deduped on the association.
    await notifyCreatorsCampaignClosed(notify, { campaignId });
  }

  const [finalBatch] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.id, input.batch.id))
    .limit(1);
  return summary('complete', campaignId, {
    ...(finalBatch ? { batch: finalBatch } : {}),
    noCharge: applied.noCharge,
  });
}

/* ── The charge path (§21 step 6) ──────────────────────────────────────────── */

async function applyChargePath(
  deps: CloseBatchDeps,
  input: { campaignId: string; batchId: string; actor: string; now: Date },
): Promise<CloseBatchSummary> {
  const { db, audit } = deps;
  const { campaignId, actor, now } = input;
  const notify = notificationDeps(deps);

  // Lock eligible reservations (step 6's `pending_capture`). Conditional bulk
  // UPDATE: a resumed run matches only rows not yet locked. Canceled and
  // ineligible rows are excluded by the WHERE itself (step 2).
  await db.transaction(async (tx) => {
    const lockedNow = await tx
      .update(reservations)
      .set({ status: 'pending_capture', updatedAt: now })
      .where(
        and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'reserved_active')),
      )
      .returning({ id: reservations.id });
    for (const row of lockedNow) {
      await tx.insert(reservationStatusHistory).values({
        reservationId: row.id,
        fromStatus: 'reserved_active',
        toStatus: 'pending_capture',
        actor,
      });
    }
  });

  // The Founder's seller account — where the Customers and saved cards live
  // (§24.1). Without it no capture can happen; the batch stays incomplete.
  const founderUserId = await findCampaignFounderUserId(db, campaignId);
  const account = founderUserId
    ? await findAccountForOwner(db, {
        ownerUserId: founderUserId,
        role: 'founder_seller',
        mode: deps.gateway.mode,
      })
    : null;
  if (!account) {
    await audit({
      action: 'close.no_seller_account',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason:
        'the close batch found no Founder seller account for this campaign; reservations stay locked and the batch stays incomplete for Admin (§33.7.12)',
      actorId: actor,
    });
    return summary('incomplete', campaignId, { reason: 'no_seller_account' });
  }

  const pending = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'pending_capture')))
    .orderBy(reservations.createdAt, reservations.id);

  let captured = 0;
  let failed = 0;
  let dropped = 0;
  let errored = 0;

  for (const reservation of pending) {
    const outcome = await captureOne(deps, {
      reservation,
      connectedAccountId: account.stripeAccountId,
      actor,
      now,
    });
    if (outcome === 'captured') captured += 1;
    else if (outcome === 'failed') failed += 1;
    else if (outcome === 'dropped') dropped += 1;
    else errored += 1;
  }

  /* ── Completion: every locked reservation resolved (§33.7.12) ───────────── */
  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.campaignId, campaignId), eq(reservations.status, 'pending_capture')));
  if (Number(remaining?.count ?? 0) > 0) {
    await audit({
      action: 'close.batch_incomplete',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason:
        `${remaining!.count} reservation(s) remain pending_capture after this run (${errored} attempt(s) ` +
        'errored at the transport). The batch stays visibly incomplete and the sweep resumes it; retries reuse ' +
        'the same attempt keys, so no card can be charged twice (§33.7.7, §33.7.12).',
      actorId: actor,
    });
    return summary('incomplete', campaignId, { captured, failed, dropped, errored });
  }

  const [counts] = await db
    .select({
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      retrying: sql<number>`count(*) filter (where ${reservations.status} = 'capture_failed_retrying')::int`,
      dropped: sql<number>`count(*) filter (where ${reservations.status} = 'capture_failed_dropped')::int`,
    })
    .from(reservations)
    .where(eq(reservations.campaignId, campaignId));
  const totals = {
    captured: Number(counts?.captured ?? 0),
    retrying: Number(counts?.retrying ?? 0),
    dropped: Number(counts?.dropped ?? 0),
  };

  const completedBatch = await db.transaction(async (tx) => {
    const [batchRow] = await tx
      .select()
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.id, input.batchId))
      .for('update')
      .limit(1);
    if (!batchRow || batchRow.completedAt) return batchRow ?? null;

    await tx
      .update(campaignCloseBatches)
      .set({
        status: 'complete',
        completedAt: now,
        lockedReservationCount: totals.captured + totals.retrying + totals.dropped,
        updatedAt: now,
      })
      .where(eq(campaignCloseBatches.id, input.batchId));

    // §23.1: retryable failures → capture_retry_window; a clean batch →
    // closed_reconciling. Payment flags stay separate from the lifecycle
    // (§23.3): `retrying` is its own row, written once with the window facts.
    const nextStatus = totals.retrying > 0 ? 'capture_retry_window' : 'closed_reconciling';
    const moved = await tx
      .update(campaigns)
      .set({ status: nextStatus, updatedAt: now })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'closed_pending_capture')))
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId,
        fromStatus: 'closed_pending_capture',
        toStatus: nextStatus,
        actor,
      });
      if (totals.retrying > 0) {
        await tx.insert(campaignPaymentFlags).values({
          campaignId,
          flag: 'retrying',
          setAt: now,
          actor,
          evidence: {
            firstFailureAt: batchRow.firstFailureAt?.toISOString() ?? null,
            retryDeadlineAt: batchRow.retryDeadlineAt?.toISOString() ?? null,
            failedCount: totals.retrying,
          },
        });
      }
    }

    const [after] = await tx
      .select()
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.id, input.batchId))
      .limit(1);
    return after ?? null;
  });

  await audit({
    action: 'close.batch_complete',
    targetType: 'campaign',
    targetId: campaignId,
    internalReason:
      `close batch complete: ${totals.captured} captured, ${totals.retrying} in the retry window, ` +
      `${totals.dropped} dropped. ${totals.retrying > 0 ? 'The campaign entered capture_retry_window.' : 'The campaign entered closed_reconciling.'}`,
    newValue: totals,
    actorId: actor,
  });

  if (notify && completedBatch) {
    await notifyBatchResult(notify, completedBatch, {
      captured: totals.captured,
      failed: totals.retrying,
      dropped: totals.dropped,
      noCharge: 0,
    });
    // §27.4 (18b): a clean batch's outcomes are final at completion — the
    // Creator close notices send now. A batch that opened the retry window
    // sends them at the window's end instead, when the numbers are final;
    // the association-level dedup makes whichever path runs first the sender.
    if (totals.retrying === 0) {
      await notifyCreatorsCampaignClosed(notify, { campaignId });
    }
  }

  // §22.3 (19b): "Immediately after close, request W-9." After the batch
  // transaction, the 08c reveal shape: idempotent by the one-per-campaign
  // index, so a crash here costs a retry (the schedule sweep re-drives it),
  // never a duplicate. Only a campaign with captured money has a Founder
  // payment coming; a retry-window recovery is picked up by the sweep.
  if (totals.captured > 0) {
    await requestFounderW9(
      {
        db,
        audit,
        notifier: deps.notifier,
        ...(deps.context ? { context: deps.context } : {}),
      },
      { campaignId, actor, now },
    );
  }

  return summary('complete', campaignId, {
    ...(completedBatch ? { batch: completedBatch } : {}),
    captured,
    failed,
    dropped,
    errored,
  });
}

/* ── One reservation's capture (§21 step 6) ────────────────────────────────── */

type CaptureOneOutcome = 'captured' | 'failed' | 'dropped' | 'errored';

async function captureOne(
  deps: CloseBatchDeps,
  input: {
    reservation: Reservation;
    connectedAccountId: string;
    actor: string;
    now: Date;
  },
): Promise<CaptureOneOutcome> {
  const { db, audit } = deps;
  const { reservation, actor, now } = input;
  const notify = notificationDeps(deps);

  // §21 step 6: validate the stored tax calculation, the associations, the
  // expiry, and the exact amount — and record the answer (§25.2's
  // close-usability result).
  const usability = validateCaptureUsability({
    now,
    taxCalculationId: reservation.taxCalculationId,
    taxCalculatedAt: reservation.taxCalculatedAt,
    taxCalculationExpiresAt: reservation.taxCalculationExpiresAt,
    billingCountry: reservation.billingCountry,
    rewardSku: reservation.rewardSku,
    totalAuthorizedCents: reservation.totalAuthorizedCents,
    rewardSubtotalCents: reservation.rewardSubtotalCents,
    salesTaxCents: reservation.salesTaxCents,
    stripeCustomerId: reservation.stripeCustomerId,
    paymentMethodId: reservation.paymentMethodId,
  });

  if (!usability.usable) {
    const drop = await applyCaptureDrop(
      { db, audit },
      {
        reservationId: reservation.id,
        reason: TAX_UNUSABLE_REASON,
        detail: usability.reason,
        actor,
        now,
      },
    );
    if (drop.applied && notify && drop.reservation) {
      await notifyCaptureDropped(notify, drop.reservation);
    }
    return 'dropped';
  }

  await db
    .update(reservations)
    .set({ taxCloseUsable: true, updatedAt: now })
    .where(eq(reservations.id, reservation.id));

  // Claim the attempt BEFORE the provider call (§33.7.7). A concurrent worker
  // loses the insert race and reads the same row; a crashed run finds its own.
  const attemptNumber = 1;
  const idempotencyKey = captureAttemptKey(reservation.id, attemptNumber);
  const amountCents = reservation.totalAuthorizedCents!;
  await db
    .insert(reservationCaptureAttempts)
    .values({
      reservationId: reservation.id,
      campaignId: reservation.campaignId,
      attemptNumber,
      idempotencyKey,
      amountCents,
      requestedAt: now,
    })
    .onConflictDoNothing();
  const [attempt] = await db
    .select()
    .from(reservationCaptureAttempts)
    .where(
      and(
        eq(reservationCaptureAttempts.reservationId, reservation.id),
        eq(reservationCaptureAttempts.attemptNumber, attemptNumber),
      ),
    )
    .limit(1);
  if (!attempt) return 'errored';

  // One off-session PaymentIntent for the exact authorized total, under the
  // stable key. On a resumed run the same key returns the same intent.
  let result;
  try {
    result = await deps.gateway.createOffSessionPaymentIntent({
      connectedAccountId: input.connectedAccountId,
      customerId: reservation.stripeCustomerId!,
      paymentMethodId: reservation.paymentMethodId!,
      amountCents,
      idempotencyKey: attempt.idempotencyKey,
      // §24.12: the provider joins the account prefix to this SUFFIX with
      // `* `, so what is sent is the suffix derived from the stored display —
      // sending the whole display would render `PROOVD* PROOVD …` (§33.9.13).
      statementDescriptorSuffix: reservation.statementDescriptor
        ? campaignDescriptorSuffix(reservation.statementDescriptor)
        : undefined,
      metadata: {
        proovd_reservation_id: reservation.id,
        proovd_campaign_id: reservation.campaignId,
        proovd_attempt: String(attemptNumber),
      },
    });
  } catch (error) {
    // A transport error: whether the intent exists is unknown. The attempt row
    // stays (same key on retry — same intent at Stripe), the reservation stays
    // locked, and the batch stays incomplete (§33.7.7, §33.7.12).
    await db
      .update(reservationCaptureAttempts)
      .set({
        outcome: 'provider_error',
        failureMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(reservationCaptureAttempts.id, attempt.id));
    await audit({
      action: 'close.capture_attempt_errored',
      targetType: 'reservation',
      targetId: reservation.id,
      internalReason: `the off-session PaymentIntent call errored at the transport: ${
        error instanceof Error ? error.message : String(error)
      }. The reservation stays pending_capture; the retry reuses key ${attempt.idempotencyKey}.`,
      actorId: actor,
    });
    return 'errored';
  }

  // §32.4: store the PaymentIntent with its key, so a crashed batch is
  // matchable to the object it produced without asking the provider.
  await recordProviderObject(db, {
    mode: deps.gateway.mode,
    objectType: 'payment_intent',
    providerObjectId: result.id,
    accountContext: 'connected',
    stripeAccountId: input.connectedAccountId,
    campaignId: reservation.campaignId,
    reservationId: reservation.id,
    amountCents,
    status:
      result.status === 'succeeded'
        ? 'succeeded'
        : result.status === 'requires_action'
          ? 'requires_action'
          : 'requires_payment_method',
    idempotencyKey: attempt.idempotencyKey,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
    providerCreatedAt: now,
  });
  if (result.chargeId) {
    await recordProviderObject(db, {
      mode: deps.gateway.mode,
      objectType: 'charge',
      providerObjectId: result.chargeId,
      accountContext: 'connected',
      stripeAccountId: input.connectedAccountId,
      campaignId: reservation.campaignId,
      reservationId: reservation.id,
      amountCents,
      amountFeeCents: result.stripeFeeCents,
      status: result.status === 'succeeded' ? 'succeeded' : 'failed',
      providerCreatedAt: now,
    });
  }

  if (result.status === 'succeeded') {
    await db
      .update(reservationCaptureAttempts)
      .set({ paymentIntentId: result.id, resolvedAt: now })
      .where(eq(reservationCaptureAttempts.id, attempt.id));
    const applied = await applyCaptureSuccess(
      { db, audit },
      {
        reservationId: reservation.id,
        paymentIntentId: result.id,
        chargeId: result.chargeId,
        stripeFeeCents: result.stripeFeeCents,
        actor,
        now,
      },
    );
    if (applied.applied && notify) {
      await notifyChargeReceipt(notify, applied.reservation);
    }
    return 'captured';
  }

  // Decline or pending customer action — the §33.7.8 recovery.
  const kind = classifyCaptureFailure({
    status: result.status === 'requires_action' ? 'requires_action' : null,
    declineCode: result.declineCode,
  });
  await db
    .update(reservationCaptureAttempts)
    .set({
      paymentIntentId: result.id,
      outcome: kind,
      failureCode: result.declineCode ?? result.failureCode,
      failureMessage: result.failureMessage,
      resolvedAt: now,
    })
    .where(eq(reservationCaptureAttempts.id, attempt.id));

  const applied = await applyCaptureFailure(
    { db, audit },
    {
      reservationId: reservation.id,
      kind,
      paymentIntentId: result.id,
      failureCode: result.declineCode ?? result.failureCode,
      actor,
      now,
    },
  );
  if (applied.applied && notify) {
    await notifyCaptureFailed(notify, applied.reservation, {
      retryDeadlineAt: applied.retryDeadlineAt,
    });
  }
  return 'failed';
}

/* ── The sweep ─────────────────────────────────────────────────────────────── */

export interface CloseSweepResult {
  started: string[];
  resumed: string[];
  complete: string[];
  waiting: string[];
}

/**
 * Closes every live campaign whose `campaign_close_at` has arrived and resumes
 * every batch left incomplete by a crash, a transport error, or an open §4.1
 * case. Each batch is independently idempotent, so a sweep that runs twice,
 * overlaps itself, or dies mid-run charges nothing twice (§33.7.7).
 */
export async function sweepCampaignCloses(
  deps: CloseBatchDeps,
  now: Date = new Date(),
): Promise<{ result: CloseSweepResult; batches: CloseBatchSummary[] }> {
  const due = await deps.db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(
      or(
        and(eq(campaigns.status, 'live'), lte(campaigns.campaignCloseAt, now)),
        eq(campaigns.status, 'closed_pending_capture'),
      ),
    );

  const result: CloseSweepResult = { started: [], resumed: [], complete: [], waiting: [] };
  const batches: CloseBatchSummary[] = [];
  for (const row of due) {
    const wasLive = row.status === 'live';
    const outcome = await runCloseBatch(deps, {
      campaignId: row.id,
      actor: 'system:campaign-close',
      now,
    });
    batches.push(outcome);
    if (wasLive) result.started.push(row.id);
    else result.resumed.push(row.id);
    if (outcome.status === 'complete' || outcome.status === 'already_complete') {
      result.complete.push(row.id);
    } else if (outcome.status === 'waiting_dedup_resolution') {
      result.waiting.push(row.id);
    }
  }
  return { result, batches };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function findCloseBatch(
  db: Database,
  campaignId: string,
): Promise<CampaignCloseBatch | null> {
  const [row] = await db
    .select()
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

export async function listCaptureAttempts(db: Database, campaignId: string) {
  return db
    .select()
    .from(reservationCaptureAttempts)
    .where(eq(reservationCaptureAttempts.campaignId, campaignId))
    .orderBy(reservationCaptureAttempts.requestedAt);
}
