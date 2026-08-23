/**
 * The audit writer the token service was built to be handed (§25.6).
 *
 * `audit_events` is insert-only — UPDATE and DELETE are revoked from the
 * application role in migration 0001, so this module has no update path to
 * offer. Every issue, rotation, revocation, claim, and *failed verification*
 * lands here, because this is the only place the real reason for a rejection is
 * allowed to exist: the caller receives an opaque `TOKEN_INVALID` and can never
 * learn which of the seven failure modes it hit (§5.5).
 *
 * Nothing written here may contain a raw token (§28.1). The service passes
 * identifiers and reasons; it never passes the value from the URL.
 */

import { auditEvents } from '../db/schema/integrity.js';
import type { Database } from '../db/client.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Used when a rejection cannot be attributed to a stored row — the "no matching
 * hash" case, where by definition there is no target. §25.6 still wants the
 * event, so the row is written with the target named honestly rather than
 * dropped.
 */
const UNRESOLVED_TARGET = 'unresolved';

/** No signed-in actor: the caller is whoever holds a link. */
const ANONYMOUS_ACTOR = 'system:token-service';

export interface AuditEventInput {
  action: string;
  targetType: string;
  targetId: string | null;
  internalReason: string;
  /** §25.6 keeps this in its own column — internal wording never doubles as
   *  customer wording, because internal vocabulary must not leak (§3.1). */
  customerExplanation?: string | null;
  priorValue?: unknown;
  newValue?: unknown;
  actorId?: string | null;
  mfaContext?: string | null;
  reauthContext?: string | null;
  /* §25.6's money columns, first used by Phase 11's listing payment. The
     columns have existed since migration 0001; an event that moves money states
     the amount and the provider objects it moved through. */
  amountCents?: bigint | null;
  currency?: string | null;
  providerObjectIds?: Record<string, unknown> | null;
  evidenceLinks?: Record<string, unknown> | null;
}

export type AuditExecutor = Pick<NodePgDatabase<Record<string, unknown>>, 'insert'>;

export type AuditWriter = (event: AuditEventInput, executor?: AuditExecutor) => Promise<void>;

export function createAuditWriter(db: Database): AuditWriter {
  return async function audit(event, executor) {
    await (executor ?? db).insert(auditEvents).values({
      actor: event.actorId ? `user:${event.actorId}` : ANONYMOUS_ACTOR,
      mfaContext: event.mfaContext ?? null,
      reauthContext: event.reauthContext ?? null,
      targetType: event.targetType,
      targetId: event.targetId ?? UNRESOLVED_TARGET,
      action: event.action,
      internalReason: event.internalReason,
      customerExplanation: event.customerExplanation ?? null,
      priorValue: event.priorValue ?? null,
      newValue: event.newValue ?? null,
      amountCents: event.amountCents ?? null,
      currency: event.currency ?? null,
      providerObjectIds: event.providerObjectIds ?? null,
      evidenceLinks: event.evidenceLinks ?? null,
    });
  };
}
