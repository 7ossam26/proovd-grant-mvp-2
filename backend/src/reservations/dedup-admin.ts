/**
 * The deduplication Admin queue — Spec §4.1, §25.3.
 *
 * Suspected duplicates (opened by the pre-order's §4.1 detection) enter a queue
 * an Admin resolves before close. An Admin may merge or separate only with a
 * recorded reason, evidence, prior value, new value, actor, and time — and a
 * decided case is final (the trigger in migration 0023 refuses a second
 * decision), so "threshold updates are idempotent after the decision" holds.
 *
 * Shared IP alone never opens a case, let alone a merge — that rule lives in the
 * §4.1 detection (`dedup.ts`), which only ever records email/phone/fingerprint
 * signals. This module decides cases that were legitimately opened.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { deduplicationCases, type DeduplicationCase } from '../db/schema/reservations.js';
import type { AuditWriter } from '../auth/audit.js';

export async function listDeduplicationCases(
  db: Pick<Database, 'select'>,
  input: { campaignId?: string; status?: 'open' | 'merged' | 'separated' } = {},
): Promise<DeduplicationCase[]> {
  const conditions = [];
  if (input.campaignId) conditions.push(eq(deduplicationCases.campaignId, input.campaignId));
  if (input.status) conditions.push(eq(deduplicationCases.status, input.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const query = db.select().from(deduplicationCases);
  return where ? query.where(where) : query;
}

export type DecideCaseOutcome =
  | { status: 'decided'; case: DeduplicationCase }
  | { status: 'not_found' }
  | { status: 'already_decided' };

/**
 * Records an Admin merge/separate decision with the full §4.1 evidence set. A
 * case already decided is refused by the database (the decided-immutable
 * trigger), so a retry does not overwrite the recorded reason (§4.1 idempotence).
 */
export async function decideDeduplicationCase(
  db: Database,
  audit: AuditWriter,
  input: {
    caseId: string;
    decision: 'merged' | 'separated';
    reason: string;
    evidence?: unknown;
    actor: string;
  },
): Promise<DecideCaseOutcome> {
  const [existing] = await db
    .select()
    .from(deduplicationCases)
    .where(eq(deduplicationCases.id, input.caseId))
    .limit(1);
  if (!existing) return { status: 'not_found' };
  if (existing.decidedAt) return { status: 'already_decided' };

  const now = new Date();
  let decided: DeduplicationCase;
  try {
    const [row] = await db
      .update(deduplicationCases)
      .set({
        status: input.decision,
        decidedReason: input.reason,
        decidedEvidence: (input.evidence ?? null) as DeduplicationCase['decidedEvidence'],
        priorValue: { status: existing.status } as DeduplicationCase['priorValue'],
        newValue: { status: input.decision } as DeduplicationCase['newValue'],
        decidedBy: input.actor,
        decidedAt: now,
      })
      .where(and(eq(deduplicationCases.id, input.caseId), eq(deduplicationCases.status, 'open')))
      .returning();
    if (!row) return { status: 'already_decided' };
    decided = row;
  } catch {
    // The decided-immutable trigger fired: someone decided it first.
    return { status: 'already_decided' };
  }

  await audit({
    action: 'deduplication.case_decided',
    targetType: 'deduplication_case',
    targetId: input.caseId,
    internalReason: `dedup case ${input.decision} by ${input.actor}: ${input.reason}`,
    priorValue: { status: existing.status },
    newValue: { status: input.decision },
    actorId: input.actor,
  });

  return { status: 'decided', case: decided };
}
