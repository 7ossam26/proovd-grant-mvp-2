/**
 * §22.11's campaign resolution — Spec §22.11, §23.1, §23.3, §33.10 (Phase 21b).
 *
 * ── `closed_resolved` and `fulfilled` are different states ──────────────────
 * The phase trap, and the one mistake here that would be invisible until a
 * Backer complained: "Money reconciled does not mean the product shipped."
 * §23.1 gives them separate lifecycle values and §23.3 gives fulfillment its
 * own independent flag row, so the two already cannot be the same column. What
 * this module adds is that resolution RECORDS whether fulfillment was still
 * active at the moment it happened — so the independence is a stored fact
 * rather than a convention someone could tidy away.
 *
 * Both directions are legal and both are ordinary: a campaign can resolve its
 * money while a reward is still being delivered, and can deliver everything
 * while a dispute keeps the money open. `resolveCampaign` therefore never
 * touches fulfillment and `markFulfilled` never touches resolution.
 *
 * ── Resolution is a conjunction over §21's register, not a new judgement ────
 * §22.11 names five areas; each maps onto reconciliation items §21 already
 * verifies with a result and a note. So this reads `campaign_reconciliations`
 * — latest row per item wins, exactly as `prepareResults` does — and refuses
 * by naming the areas that are short. There is no second verification surface
 * and no way to declare a campaign resolved past an unverified item.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignReconciliations } from '../db/schema/close.js';
import { campaignFulfillment } from '../db/schema/fulfillment.js';
import { campaignResolutions } from '../db/schema/completion.js';
import { campaignStatusHistory } from '../db/schema/domain.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  RESOLUTION_AREAS,
  resolutionComplete,
  unresolvedAreas,
  RESOLUTION_IS_NOT_FULFILLMENT,
  type ResolutionAreaKey,
} from './logic.js';

export interface ResolutionDeps {
  db: Database;
  audit: AuditWriter;
}

/** The reconciliation items currently verified on a campaign. Latest row wins. */
export async function verifiedReconciliationItems(
  db: Database,
  campaignId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      itemKey: campaignReconciliations.itemKey,
      result: campaignReconciliations.result,
      recordedAt: campaignReconciliations.recordedAt,
    })
    .from(campaignReconciliations)
    .where(eq(campaignReconciliations.campaignId, campaignId))
    .orderBy(desc(campaignReconciliations.recordedAt));

  // Latest per item — a discrepancy later resolved gets a new row and the
  // earlier answer survives (18b's rule), so only the newest one counts.
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!latest.has(row.itemKey)) latest.set(row.itemKey, row.result);
  }
  return [...latest.entries()].filter(([, result]) => result === 'verified').map(([item]) => item);
}

export interface ResolutionView {
  campaignId: string;
  /** The five §22.11 areas with what each is waiting on. */
  areas: Array<{
    key: ResolutionAreaKey;
    spec: string;
    complete: boolean;
    outstandingItems: string[];
  }>;
  complete: boolean;
  resolvedAt: string | null;
  /** §22.11: tracked separately, and said so on every read. */
  fulfillment: {
    active: boolean;
    fulfilledAt: string | null;
    note: string;
  };
}

/** What §22.11 says about one campaign right now. */
export async function readResolution(
  db: Database,
  campaignId: string,
): Promise<ResolutionView> {
  const verified = new Set(await verifiedReconciliationItems(db, campaignId));

  const [existing] = await db
    .select({ resolvedAt: campaignResolutions.resolvedAt })
    .from(campaignResolutions)
    .where(eq(campaignResolutions.campaignId, campaignId))
    .limit(1);

  const [fulfillment] = await db
    .select({
      deliveredAt: campaignFulfillment.deliveryNotifiedAt,
      fulfilledAt: campaignFulfillment.fulfilledAt,
    })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, campaignId))
    .limit(1);

  return {
    campaignId,
    areas: RESOLUTION_AREAS.map((area) => ({
      key: area.key,
      spec: area.spec,
      complete: area.reconciliationItems.every((item) => verified.has(item)),
      outstandingItems: area.reconciliationItems.filter((item) => !verified.has(item)),
    })),
    complete: resolutionComplete([...verified]),
    resolvedAt: existing?.resolvedAt?.toISOString() ?? null,
    fulfillment: {
      // Active means a delivery is owed or in progress — not yet fulfilled.
      active: fulfillment !== undefined && fulfillment.fulfilledAt == null,
      fulfilledAt: fulfillment?.fulfilledAt?.toISOString() ?? null,
      note: RESOLUTION_IS_NOT_FULFILLMENT,
    },
  };
}

export type ResolveRefusal = 'not_found' | 'not_reconciled' | 'already_resolved' | 'note_required';

export type ResolveOutcome =
  | { ok: true; resolutionId: string; fulfillmentActive: boolean }
  | { ok: false; code: ResolveRefusal; message: string; unresolved?: ResolutionAreaKey[] };

/**
 * Records §22.11's resolution and moves the campaign to `closed_resolved`.
 *
 * Touches nothing about fulfillment. A campaign that resolves while a reward is
 * still in flight stays in flight, and the resolution row records that it was —
 * which is the whole of "fulfillment may remain active separately".
 */
export async function resolveCampaign(
  deps: ResolutionDeps,
  input: { campaignId: string; resolvedBy: string; note: string },
): Promise<ResolveOutcome> {
  const { db } = deps;

  if (!input.note.trim()) {
    return {
      ok: false,
      code: 'note_required',
      message: 'Say what you reconciled. A resolution with no note is not a record (§25.6).',
    };
  }

  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { ok: false, code: 'not_found', message: 'No such campaign.' };

  const [existing] = await db
    .select({ id: campaignResolutions.id })
    .from(campaignResolutions)
    .where(eq(campaignResolutions.campaignId, input.campaignId))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      code: 'already_resolved',
      message: 'This campaign is already resolved.',
    };
  }

  const verified = await verifiedReconciliationItems(db, input.campaignId);
  if (!resolutionComplete(verified)) {
    const unresolved = unresolvedAreas(verified);
    return {
      ok: false,
      code: 'not_reconciled',
      message: `§22.11 needs every area reconciled. Still outstanding: ${unresolved.join(', ')}.`,
      unresolved,
    };
  }

  const [fulfillment] = await db
    .select({ fulfilledAt: campaignFulfillment.fulfilledAt })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, input.campaignId))
    .limit(1);
  const fulfillmentActive = fulfillment !== undefined && fulfillment.fulfilledAt == null;

  const resolutionId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaignResolutions)
      .values({
        campaignId: input.campaignId,
        resolvedBy: input.resolvedBy,
        verifiedItems: verified,
        fulfillmentActive,
        note: input.note.trim(),
      })
      .returning({ id: campaignResolutions.id });

    // Conditional, on the status we read. A campaign that moved underneath us
    // keeps its own history and the resolution record still stands.
    const moved = await tx
      .update(campaigns)
      .set({ status: 'closed_resolved', updatedAt: new Date() })
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, campaign.status)))
      .returning({ id: campaigns.id });

    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: campaign.status,
        toStatus: 'closed_resolved',
        actor: input.resolvedBy,
      });
    }

    return row!.id;
  });

  await deps.audit({
    action: 'campaign.resolved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§22.11 resolved: ${input.note}. Fulfillment ${
      fulfillmentActive ? 'remains active' : 'is complete'
    } — the two are tracked separately.`,
    newValue: { resolutionId, verified, fulfillmentActive },
    actorId: input.resolvedBy,
  });

  return { ok: true, resolutionId, fulfillmentActive };
}

/**
 * §23.1's `fulfilled`, recorded independently of resolution.
 *
 * 21a writes `campaign_fulfillment.fulfilled_at` when delivery completes; this
 * is the lifecycle move that follows it, and it deliberately does NOT check
 * whether the money reconciled. A shipped product is shipped.
 */
export async function markFulfilled(
  deps: ResolutionDeps,
  input: { campaignId: string; actor: string },
): Promise<{ ok: boolean; moved: boolean }> {
  const [campaign] = await deps.db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { ok: false, moved: false };

  const [fulfillment] = await deps.db
    .select({ fulfilledAt: campaignFulfillment.fulfilledAt })
    .from(campaignFulfillment)
    .where(eq(campaignFulfillment.campaignId, input.campaignId))
    .limit(1);
  if (!fulfillment?.fulfilledAt) return { ok: false, moved: false };

  const moved = await deps.db.transaction(async (tx) => {
    const updated = await tx
      .update(campaigns)
      .set({ status: 'fulfilled', updatedAt: new Date() })
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, campaign.status)))
      .returning({ id: campaigns.id });
    if (updated.length !== 1) return false;
    await tx.insert(campaignStatusHistory).values({
      campaignId: input.campaignId,
      fromStatus: campaign.status,
      toStatus: 'fulfilled',
      actor: input.actor,
    });
    return true;
  });

  if (moved) {
    await deps.audit({
      action: 'campaign.fulfilled',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason:
        '§23.1 fulfilled. Independent of §22.11 resolution — the reward shipped, whatever the money is doing.',
      actorId: input.actor,
    });
  }

  return { ok: true, moved };
}

/** Counts, for the §26 surfaces. Cheap enough to run on a queue read. */
export async function countUnresolved(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(
      and(
        sql`${campaigns.status}::text = 'closed_reconciling'`,
        sql`not exists (select 1 from campaign_resolutions r where r.campaign_id = ${campaigns.id})`,
      ),
    );
  return row?.n ?? 0;
}
