/**
 * The general materiality/reacceptance machine — Spec §15, §33.4.2.
 *
 * §15's own words: "This machinery is reused verbatim for live editing in
 * Phase 17 — build it general." So this module knows nothing about *why* a
 * change is being made (a review round in 12b, a live edit in Phase 17); it
 * takes a classified change and does exactly what §15 requires:
 *
 *   non-material  → record it, preserve Creator readiness, manufacture NO
 *                   reacceptance task. §33.4.2's first half, and its trap:
 *                   "Manufacturing a reacceptance task for a typo fix trains
 *                   Creators to click through them."
 *   material      → record it with a new version, invalidate the affected
 *                   Creators' readiness, and create one reacceptance task per
 *                   affected Creator carrying the exact changed fields. Roster
 *                   readiness recomputes and drops until every affected Creator
 *                   accepts (§15 rule 6).
 *
 * The classification is an Admin judgement recorded with its reason (§15) — this
 * module never guesses it (§1 rule 6). "A Founder cannot publish a material
 * change directly" is enforced upstream: only Admin reaches `recordMaterialChange`,
 * and the Founder's build save refuses outside the build window (build/service).
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  materialChanges,
  materialChangeReacceptances,
  associationReadiness,
  type MaterialChange,
  type MaterialChangeReacceptance,
} from '../db/schema/build.js';
import type { AuditWriter } from '../auth/audit.js';
import { evaluateRosterReadiness, type RosterReadinessReport } from './readiness.js';

type MaterialityClass = 'non_material' | 'material';

export interface MaterialChangeInput {
  campaignId: string;
  reviewId?: string | undefined;
  classification: MaterialityClass;
  reason: string;
  /** The field names the change touches (§15). */
  affectedFields: string[];
  beforeValue?: unknown;
  afterValue?: unknown;
  /** For a material change: the associations whose terms this change affects. */
  affectedCreators?: string[];
  actor: string;
}

export interface MaterialChangeResult {
  ok: true;
  change: MaterialChange;
  reacceptances: MaterialChangeReacceptance[];
  readiness: RosterReadinessReport;
}

/**
 * Records a classified change and applies §15's consequence. Non-material
 * preserves readiness and creates no reacceptance task; material versions,
 * invalidates affected readiness, and creates the reacceptance tasks.
 */
export async function recordMaterialChange(
  db: Database,
  deps: { audit: AuditWriter },
  input: MaterialChangeInput,
): Promise<MaterialChangeResult> {
  const change = await db.transaction(async (tx) => {
    if (input.classification === 'non_material') {
      // §33.4.2: never versions, never manufactures a reacceptance task.
      const [row] = await tx
        .insert(materialChanges)
        .values({
          campaignId: input.campaignId,
          reviewId: input.reviewId ?? null,
          classification: 'non_material',
          reason: input.reason,
          affectedFields: input.affectedFields,
          beforeValue: input.beforeValue ?? null,
          afterValue: input.afterValue ?? null,
          reacceptanceState: 'not_required',
          actor: input.actor,
        })
        .returning();
      return { change: row!, reacceptances: [] as MaterialChangeReacceptance[] };
    }

    // Material: a new monotonic terms version for this campaign.
    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number>`coalesce(max(${materialChanges.newVersion}), 0)` })
      .from(materialChanges)
      .where(eq(materialChanges.campaignId, input.campaignId));
    const priorVersion = maxVersion ?? 0;
    const newVersion = priorVersion + 1;
    const affected = input.affectedCreators ?? [];

    const [row] = await tx
      .insert(materialChanges)
      .values({
        campaignId: input.campaignId,
        reviewId: input.reviewId ?? null,
        classification: 'material',
        reason: input.reason,
        affectedFields: input.affectedFields,
        beforeValue: input.beforeValue ?? null,
        afterValue: input.afterValue ?? null,
        priorVersion: priorVersion > 0 ? priorVersion : null,
        newVersion,
        affectedCreators: affected,
        // A material change with no affected Creator is complete on arrival —
        // it changed nobody's terms — but still versions (§15).
        reacceptanceState: affected.length > 0 ? 'pending' : 'complete',
        actor: input.actor,
      })
      .returning();

    const reacceptances: MaterialChangeReacceptance[] = [];
    for (const associationId of affected) {
      const [task] = await tx
        .insert(materialChangeReacceptances)
        .values({
          materialChangeId: row!.id,
          associationId,
          campaignId: input.campaignId,
          newVersion,
          changedFields: input.affectedFields,
        })
        .returning();
      reacceptances.push(task!);

      // §15: invalidate the affected Creator's readiness until they accept.
      await tx
        .insert(associationReadiness)
        .values({
          associationId,
          campaignId: input.campaignId,
          reacceptanceRequired: true,
        })
        .onConflictDoUpdate({
          target: associationReadiness.associationId,
          set: { reacceptanceRequired: true, updatedAt: new Date() },
        });
    }

    return { change: row!, reacceptances };
  });

  await deps.audit({
    action:
      input.classification === 'material'
        ? 'materiality.material_change_recorded'
        : 'materiality.non_material_change_recorded',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason:
      `${input.classification} change to [${input.affectedFields.join(', ')}]: ${input.reason}` +
      (input.classification === 'material'
        ? `; version ${change.change.newVersion}; ${change.reacceptances.length} reacceptance task(s)`
        : '; readiness preserved, no reacceptance task'),
    actorId: input.actor,
  });

  // Readiness recomputes: a material change drops the roster below launch_ready.
  const readiness = await evaluateRosterReadiness(db, input.campaignId);
  return { ok: true, change: change.change, reacceptances: change.reacceptances, readiness };
}

/* ── Reacceptance (§15: affected Creators accept or decline the new version) ── */

export type ReacceptanceOutcome =
  | { ok: true; decision: 'accepted' | 'declined'; readiness: RosterReadinessReport }
  | { ok: false; code: 'not_found' | 'already_decided'; message: string };

/**
 * One affected Creator's decision on the new version. On accept, if it was the
 * last pending reacceptance for the change, the change becomes `complete` and
 * the Creator's readiness is restored; the roster recomputes and can return to
 * `launch_ready`.
 */
export async function decideReacceptance(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    reacceptanceId: string;
    associationId: string;
    decision: 'accepted' | 'declined';
    actor: string;
  },
): Promise<ReacceptanceOutcome> {
  const result = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(materialChangeReacceptances)
      .where(
        and(
          eq(materialChangeReacceptances.id, input.reacceptanceId),
          eq(materialChangeReacceptances.associationId, input.associationId),
        ),
      )
      .for('update')
      .limit(1);
    if (!task) return { code: 'not_found' as const };
    if (task.decision !== 'pending') return { code: 'already_decided' as const };

    const now = new Date();
    await tx
      .update(materialChangeReacceptances)
      .set({ decision: input.decision, decidedAt: now })
      .where(eq(materialChangeReacceptances.id, task.id));

    if (input.decision === 'accepted') {
      // Readiness restored for this association only when it owes no other
      // pending reacceptance across any change.
      const [{ pending }] = await tx
        .select({ pending: sql<number>`count(*)` })
        .from(materialChangeReacceptances)
        .where(
          and(
            eq(materialChangeReacceptances.associationId, input.associationId),
            eq(materialChangeReacceptances.decision, 'pending'),
          ),
        );
      if (Number(pending ?? 0) === 0) {
        await tx
          .update(associationReadiness)
          .set({ reacceptanceRequired: false, updatedAt: now })
          .where(eq(associationReadiness.associationId, input.associationId));
      }

      // If the whole change is now accepted by everyone, mark it complete.
      const [{ stillPending }] = await tx
        .select({ stillPending: sql<number>`count(*)` })
        .from(materialChangeReacceptances)
        .where(
          and(
            eq(materialChangeReacceptances.materialChangeId, task.materialChangeId),
            eq(materialChangeReacceptances.decision, 'pending'),
          ),
        );
      if (Number(stillPending ?? 0) === 0) {
        await tx
          .update(materialChanges)
          .set({ reacceptanceState: 'complete' })
          .where(eq(materialChanges.id, task.materialChangeId));
      }
    }

    return { code: 'ok' as const, campaignId: task.campaignId };
  });

  if (result.code === 'not_found') {
    return { ok: false, code: 'not_found', message: 'That reacceptance task was not found.' };
  }
  if (result.code === 'already_decided') {
    return { ok: false, code: 'already_decided', message: 'That version was already answered.' };
  }

  await deps.audit({
    action: 'materiality.reacceptance_decided',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `Creator ${input.decision} the changed version`,
    actorId: input.actor,
  });

  const readiness = await evaluateRosterReadiness(db, result.campaignId);
  return { ok: true, decision: input.decision, readiness };
}

/** Pending reacceptance tasks for one Creator — what they must answer. */
export async function listPendingReacceptances(
  db: Database,
  associationId: string,
): Promise<MaterialChangeReacceptance[]> {
  return db
    .select()
    .from(materialChangeReacceptances)
    .where(
      and(
        eq(materialChangeReacceptances.associationId, associationId),
        eq(materialChangeReacceptances.decision, 'pending'),
      ),
    );
}
