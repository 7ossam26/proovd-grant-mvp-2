/**
 * The Support workspace writes — §25.6, §26.7, §26.8, §27.8.
 *
 * Every one of these records who did it and, where the act is a judgement,
 * why. §1.3: manual work is valid only when the app records it, and a support
 * queue is almost entirely manual work.
 *
 * ── What is NOT here, and where it lives instead ────────────────────────────
 * Replying, adding an internal note, and moving accountability between Proovd
 * and the Founder are `support/cases.ts`'s `addCaseMessage` and
 * `transferCaseOwnership`, unchanged. They already carry the §33.9.11 refusal
 * and the §26.8 four-fact handoff gate; a second path to either would be a
 * second set of rules, and the one that gets forgotten is always the newer one.
 *
 * ── The actor is the session, never the body ────────────────────────────────
 * The reference prototype hardcodes a current user. Every function here takes
 * an `actor` the route derives from `req.authUser`, and `assignCase` takes the
 * assignee's user id but validates it is a real Admin account — a caller that
 * could name its own actor could attribute a decision to somebody else, which
 * is the identity mistake `routes/vetting.ts` records.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { user } from '../../db/schema/auth.js';
import { auditEvents } from '../../db/schema/integrity.js';
import {
  supportCases,
  supportCaseAssignments,
  supportCaseEvidence,
  supportCaseContacts,
  supportCaseReopens,
} from '../../db/schema/support.js';
import { containsRawProviderCode } from '../../admin/logic.js';
import { FOUNDER_FOLLOWUP_HOURS, SUPPORT_TOPICS, type SupportTopic } from '../logic.js';
import {
  SUPPORT_TRIAGE_LEVELS,
  SUPPORT_WAITING_PARTIES,
  SUPPORT_EVIDENCE_KINDS,
  SUPPORT_LINKED_RECORD_KINDS,
  SUPPORT_CONTACT_PARTIES,
  statusForWaitingParty,
  type SupportTriageLevel,
  type SupportWaitingParty,
  type SupportEvidenceKind,
  type SupportLinkedRecordKind,
  type SupportContactParty,
} from './logic.js';

/**
 * The shape every write answers with.
 *
 * The default is `Record<never, never>` — an empty object — rather than
 * `Record<string, never>`, which reads as "an object whose every key maps to
 * `never`" and therefore rejects `ok: true` itself. The distinction is invisible
 * until a success value fails to typecheck against its own success type.
 */
export type MutationOutcome<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string };

interface AuditContext {
  actor: string;
  mfaContext: string;
  reauthContext: string;
}

/**
 * One audit row per act, in the same transaction as the change.
 *
 * `internal_reason` is NOT NULL on `audit_events`, so every caller supplies
 * one — which is the point: an act with no recorded reason is an act nobody can
 * review. `customer_explanation` stays separate because §25.6 keeps internal
 * wording out of customer copy, and it is what the case history renders.
 */
async function audit(
  tx: Database,
  input: AuditContext & {
    caseId: string;
    action: string;
    internalReason: string;
    customerExplanation?: string | null;
    priorValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  await tx.insert(auditEvents).values({
    actor: input.actor,
    mfaContext: input.mfaContext,
    reauthContext: input.reauthContext,
    targetType: 'support_case',
    targetId: input.caseId,
    action: input.action,
    internalReason: input.internalReason,
    customerExplanation: input.customerExplanation ?? null,
    priorValue: (input.priorValue ?? null) as never,
    newValue: (input.newValue ?? null) as never,
  });
}

/* ── Assignment ────────────────────────────────────────────────────────────*/

/**
 * Give the case a named Admin.
 *
 * §26.7 makes support a human activity with a named owner; the reference's
 * "Assign to me" and "Reassign" are the same act with different arguments, so
 * they are one function and there is no separate self-assign path that could
 * skip the record.
 *
 * The assignee must be a real `role = 'admin'` account, checked here rather
 * than trusted from the body: the same boundary `requireAdmin` decides on for
 * every request, so the control cannot name somebody the server would refuse.
 */
export async function assignCase(
  db: Database,
  input: AuditContext & { caseId: string; toUserId: string; reason?: string | null },
): Promise<MutationOutcome<{ assignmentId: string }>> {
  const reason = input.reason?.trim() || null;

  const [assignee] = await db
    .select({ id: user.id, name: user.name, role: user.role })
    .from(user)
    .where(eq(user.id, input.toUserId))
    .limit(1);

  if (!assignee || assignee.role !== 'admin') {
    return {
      ok: false,
      code: 'not_an_admin',
      message: 'A case can only be assigned to an Admin account. Nothing has changed.',
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);

    if (!existing) {
      return { ok: false as const, code: 'not_found', message: 'No such case.' };
    }
    if (existing.assigneeUserId === input.toUserId) {
      return {
        ok: false as const,
        code: 'already_assigned',
        message: 'That Admin already owns this case. Nothing has changed.',
      };
    }

    const now = new Date();
    const [assignment] = await tx
      .insert(supportCaseAssignments)
      .values({
        caseId: input.caseId,
        fromUserId: existing.assigneeUserId,
        toUserId: input.toUserId,
        reason,
        actor: input.actor,
        occurredAt: now,
      })
      .returning({ id: supportCaseAssignments.id });

    await tx
      .update(supportCases)
      .set({ assigneeUserId: input.toUserId, assignedAt: now, updatedAt: now })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_assigned',
      internalReason: reason ?? 'Owner set from the Support workspace.',
      priorValue: existing.assigneeUserId,
      newValue: input.toUserId,
    });

    return { ok: true as const, assignmentId: assignment!.id };
  });
}

/* ── Classification ────────────────────────────────────────────────────────*/

/**
 * Change the §26.7 topic, its free-text subcategory, and the internal reason.
 *
 * The topic list is §26.7's ten and not the reference's thirteen (§1.8): a case
 * opened by a Backer through §29.9 and a case opened here by an Admin must be
 * classifiable on one list, or the queue is counting two different things.
 *
 * The internal reason may carry a provider code — §26.8 permits exactly that as
 * secondary support detail in the Admin view — and there is no refusal on it
 * for the same reason `addCaseMessage` only refuses on the customer-facing
 * branch: pushing an Admin to paraphrase a decline code loses the one fact that
 * identifies the transaction.
 */
export async function classifyCase(
  db: Database,
  input: AuditContext & {
    caseId: string;
    topic: SupportTopic;
    subcategory?: string | null;
    internalReason?: string | null;
  },
): Promise<MutationOutcome> {
  if (!SUPPORT_TOPICS.includes(input.topic)) {
    return {
      ok: false,
      code: 'unknown_topic',
      message: 'That is not one of the support topics (§26.7). Nothing has changed.',
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };

    await tx
      .update(supportCases)
      .set({
        topic: input.topic,
        subcategory: input.subcategory?.trim() || null,
        internalReason: input.internalReason?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_classified',
      internalReason: `Reclassified as ${input.topic}.`,
      priorValue: { topic: existing.topic, subcategory: existing.subcategory },
      newValue: { topic: input.topic, subcategory: input.subcategory?.trim() || null },
    });

    return { ok: true as const };
  });
}

/**
 * Set the triage level.
 *
 * It writes exactly one column and touches no deadline. §27.8 publishes one
 * response promise for every case, and `human_response_due_at` is immutable by
 * the 0025 trigger anyway — so wiring triage to the SLA would take deleting a
 * trigger, which is a visible edit rather than a quiet one.
 */
export async function setCaseTriage(
  db: Database,
  input: AuditContext & { caseId: string; triage: SupportTriageLevel },
): Promise<MutationOutcome> {
  if (!SUPPORT_TRIAGE_LEVELS.includes(input.triage)) {
    return { ok: false, code: 'unknown_triage', message: 'That is not a triage level.' };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ triagePriority: supportCases.triagePriority })
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };

    await tx
      .update(supportCases)
      .set({ triagePriority: input.triage, updatedAt: new Date() })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_triaged',
      internalReason: `Triage set to ${input.triage}. Queue order only — the response promise is unchanged.`,
      priorValue: existing.triagePriority,
      newValue: input.triage,
    });

    return { ok: true as const };
  });
}

/* ── Who this is waiting on ────────────────────────────────────────────────*/

/**
 * Name the party that owes the next move, and what they owe.
 *
 * §27.1's second and third questions — what next, and who owns it — are one
 * act here because answering only one of them is what produces a case that is
 * "blocked" with nobody named. The next action is REQUIRED for that reason: the
 * reference's own lede says a ticket is never simply blocked, and this is where
 * that is enforced rather than merely written.
 *
 * `status` is derived through `statusForWaitingParty` and never taken from the
 * caller, so the 0045 CHECK that pins the two together cannot be violated by a
 * request body.
 */
export async function setCaseWaiting(
  db: Database,
  input: AuditContext & {
    caseId: string;
    waitingOn: SupportWaitingParty;
    nextAction: string;
    nextPromisedUpdateAt?: Date | null;
  },
): Promise<MutationOutcome> {
  if (!SUPPORT_WAITING_PARTIES.includes(input.waitingOn)) {
    return { ok: false, code: 'unknown_party', message: 'That is not a party a case can wait on.' };
  }
  if (!input.nextAction.trim()) {
    return {
      ok: false,
      code: 'next_action_required',
      message:
        'Say exactly what the waiting party owes. A case is never simply blocked (§27.1). Nothing has changed.',
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };

    if (existing.status === 'resolved') {
      return {
        ok: false as const,
        code: 'case_finished',
        message:
          'This case is resolved. Reopen it before changing who it is waiting on — reopening records why.',
      };
    }

    const now = new Date();
    const status = statusForWaitingParty({
      waitingOn: input.waitingOn,
      requesterKind: existing.requesterKind,
      owner: existing.owner as 'proovd_support' | 'founder_coordinated',
    });

    // §27.8's 48-hour clock belongs to the state where the Founder is the
    // accountable party. It starts when the case ENTERS that state and clears
    // when it leaves — a clock left running against a Founder who no longer
    // owes anything is a breach the queue would report forever.
    const founderFollowupDueAt =
      status === 'awaiting_founder'
        ? (existing.founderFollowupDueAt ??
          new Date(now.getTime() + FOUNDER_FOLLOWUP_HOURS * 3_600_000))
        : null;

    await tx
      .update(supportCases)
      .set({
        status,
        waitingOn: input.waitingOn,
        nextAction: input.nextAction.trim(),
        founderFollowupDueAt,
        ...(input.nextPromisedUpdateAt !== undefined
          ? { nextPromisedUpdateAt: input.nextPromisedUpdateAt }
          : {}),
        updatedAt: now,
      })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_status_changed',
      internalReason: `Waiting on ${input.waitingOn}: ${input.nextAction.trim()}`,
      priorValue: { status: existing.status, waitingOn: existing.waitingOn },
      newValue: { status, waitingOn: input.waitingOn },
    });

    return { ok: true as const };
  });
}

/**
 * Set the time the customer was promised an update.
 *
 * §27.8: "Even without resolution, send an update at the promised checkpoint."
 * This is the promise; `support/promises.ts` is what notices it lapsing. The
 * two are deliberately separate — a promise that scheduled its own message
 * would be an automated check-in (§30, §33.6.11).
 */
export async function setNextUpdateDue(
  db: Database,
  input: AuditContext & { caseId: string; at: Date },
): Promise<MutationOutcome> {
  if (Number.isNaN(input.at.getTime())) {
    return { ok: false, code: 'invalid_date', message: 'That is not a date and time.' };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ nextPromisedUpdateAt: supportCases.nextPromisedUpdateAt })
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };

    await tx
      .update(supportCases)
      .set({ nextPromisedUpdateAt: input.at, updatedAt: new Date() })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_update_promised',
      internalReason: `Next customer update promised for ${input.at.toISOString()}.`,
      priorValue: existing.nextPromisedUpdateAt?.toISOString() ?? null,
      newValue: input.at.toISOString(),
    });

    return { ok: true as const };
  });
}

/* ── Finishing, and un-finishing ───────────────────────────────────────────*/

/**
 * Record what actually fixed it.
 *
 * The resolution is customer-readable by intent — the reference's own lede says
 * "in words the customer could read" — so §33.9.11's refusal applies to it. A
 * resolution carrying a decline code is one an Admin will paste into a reply.
 *
 * This supersedes `resolveCase` for the workspace path: that one takes no
 * resolution text and stays for the routes that already call it, but a case
 * finished here always says why.
 */
export async function resolveCaseWithResolution(
  db: Database,
  input: AuditContext & { caseId: string; resolution: string; operationalNote?: string | null },
): Promise<MutationOutcome> {
  const resolution = input.resolution.trim();
  if (!resolution) {
    return {
      ok: false,
      code: 'resolution_required',
      message: 'Record what resolved the issue. Nothing has changed.',
    };
  }
  if (containsRawProviderCode(resolution)) {
    return {
      ok: false,
      code: 'raw_provider_code',
      message:
        'That resolution contains a raw provider or fraud code. The resolution is written to be readable by the customer — put the code in an internal note instead (§26.8, §33.9.11).',
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };
    if (existing.status === 'resolved') {
      return {
        ok: false as const,
        code: 'already_resolved',
        message: 'This case is already resolved. Nothing has changed.',
      };
    }

    const now = new Date();
    await tx
      .update(supportCases)
      .set({
        status: 'resolved',
        // The 0045 CHECK pins these together: resolved has no waiting party.
        waitingOn: null,
        nextAction: null,
        resolution,
        resolvedBy: input.actor,
        resolvedAt: now,
        founderFollowupDueAt: null,
        updatedAt: now,
      })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_resolved',
      internalReason: input.operationalNote?.trim()
        ? `${resolution} — operational action: ${input.operationalNote.trim()}`
        : resolution,
      customerExplanation: resolution,
      priorValue: existing.status,
      newValue: 'resolved',
    });

    return { ok: true as const };
  });
}

/**
 * Close a resolved case.
 *
 * Closing keeps everything: the 0045 CHECK requires the case to already be
 * resolved with a recorded resolution, and the grants make every attached
 * record insert-only. There is no delete anywhere in this module.
 */
export async function closeCase(
  db: Database,
  input: AuditContext & { caseId: string },
): Promise<MutationOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };
    if (existing.status !== 'resolved') {
      return {
        ok: false as const,
        code: 'not_resolved',
        message: 'Record how this was resolved before closing it. Nothing has changed.',
      };
    }
    if (existing.closedAt) {
      return { ok: false as const, code: 'already_closed', message: 'This case is already closed.' };
    }

    const now = new Date();
    await tx
      .update(supportCases)
      .set({ closedAt: now, updatedAt: now })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_closed',
      internalReason: 'Case closed from the Support workspace. Nothing was deleted.',
      priorValue: null,
      newValue: now.toISOString(),
    });

    return { ok: true as const };
  });
}

/**
 * Reopen a finished case.
 *
 * The prior resolution is COPIED onto the reopen row before it is cleared, so
 * reopening never destroys the answer that was given — §26.8's "nothing is
 * deleted" applied to the one operation whose job is to undo something. The
 * case comes back waiting on Proovd, because Proovd is who just decided it was
 * not finished.
 */
export async function reopenCase(
  db: Database,
  input: AuditContext & { caseId: string; reason: string },
): Promise<MutationOutcome<{ reopenId: string }>> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      code: 'reason_required',
      message: 'Say why this case is being reopened. Nothing has changed.',
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!existing) return { ok: false as const, code: 'not_found', message: 'No such case.' };
    if (existing.status !== 'resolved') {
      return {
        ok: false as const,
        code: 'not_finished',
        message: 'This case is still open. Nothing has changed.',
      };
    }

    const now = new Date();
    const [reopen] = await tx
      .insert(supportCaseReopens)
      .values({
        caseId: input.caseId,
        reason,
        priorResolution: existing.resolution,
        priorResolvedAt: existing.resolvedAt,
        priorClosedAt: existing.closedAt,
        actor: input.actor,
        occurredAt: now,
      })
      .returning({ id: supportCaseReopens.id });

    await tx
      .update(supportCases)
      .set({
        status: 'open',
        waitingOn: 'proovd',
        nextAction: `${existing.assigneeUserId ? 'The assigned Admin' : 'Proovd'} must pick this case back up and respond.`,
        // Cleared TOGETHER, which is the one combination the 0045 closure
        // trigger permits — editing a resolution in place is refused, and
        // reopening is the recorded path that replaces it.
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
        closedAt: null,
        updatedAt: now,
      })
      .where(eq(supportCases.id, input.caseId));

    await audit(tx as unknown as Database, {
      ...input,
      action: 'support.case_reopened',
      internalReason: reason,
      priorValue: { status: existing.status, resolution: existing.resolution },
      newValue: { status: 'open' },
    });

    return { ok: true as const, reopenId: reopen!.id };
  });
}

/* ── Evidence ──────────────────────────────────────────────────────────────*/

/**
 * Attach a reference to the record the evidence came from.
 *
 * Not a file: §12's object storage is Track A4 and unconfigured, so there is no
 * upload path and `EVIDENCE_IS_A_REFERENCE` says so on the control rather than
 * leaving an Admin to discover it (§1.4).
 */
export async function addCaseEvidence(
  db: Database,
  input: AuditContext & {
    caseId: string;
    kind: SupportEvidenceKind;
    description: string;
    linkedKind?: SupportLinkedRecordKind;
    linkedReference?: string | null;
  },
): Promise<MutationOutcome<{ evidenceId: string }>> {
  if (!SUPPORT_EVIDENCE_KINDS.includes(input.kind)) {
    return { ok: false, code: 'unknown_kind', message: 'That is not an evidence type.' };
  }
  const description = input.description.trim();
  if (!description) {
    return {
      ok: false,
      code: 'description_required',
      message: 'Describe what this evidence shows. Nothing has been attached.',
    };
  }

  const linkedKind = input.linkedKind ?? 'none';
  if (!SUPPORT_LINKED_RECORD_KINDS.includes(linkedKind)) {
    return { ok: false, code: 'unknown_link', message: 'That is not a kind of linked record.' };
  }
  const linkedReference = input.linkedReference?.trim() || null;
  if (linkedKind !== 'none' && !linkedReference) {
    return {
      ok: false,
      code: 'link_incomplete',
      message:
        'Name the record this points at, or record it with no linked record. Evidence pointing at nothing looks complete and proves nothing.',
    };
  }
  if (linkedKind === 'none' && linkedReference) {
    return {
      ok: false,
      code: 'link_incomplete',
      message: 'Choose which kind of record that reference belongs to.',
    };
  }

  const [existing] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(eq(supportCases.id, input.caseId))
    .limit(1);
  if (!existing) return { ok: false, code: 'not_found', message: 'No such case.' };

  const [row] = await db
    .insert(supportCaseEvidence)
    .values({
      caseId: input.caseId,
      kind: input.kind,
      description,
      linkedKind,
      linkedReference,
      addedBy: input.actor,
    })
    .returning({ id: supportCaseEvidence.id });

  return { ok: true, evidenceId: row!.id };
}

/* ── Coordination outside the thread ───────────────────────────────────────*/

/**
 * Record that a party was contacted.
 *
 * It does NOT send. §27 defines four support notification keys and none of them
 * is "an Admin contacted a party about a case"; inventing a fifth would be §1
 * rule 6 applied to a message. `CONTACT_IS_RECORDED_NOT_SENT` is the consequence
 * line on the control, so the Admin knows they are the one sending it.
 */
export async function recordCaseContact(
  db: Database,
  input: AuditContext & {
    caseId: string;
    partyKind: SupportContactParty;
    partyLabel: string;
    message: string;
    expectedResponseAt?: Date | null;
  },
): Promise<MutationOutcome<{ contactId: string }>> {
  if (!SUPPORT_CONTACT_PARTIES.includes(input.partyKind)) {
    return { ok: false, code: 'unknown_party', message: 'That is not a party this case can contact.' };
  }
  const message = input.message.trim();
  const partyLabel = input.partyLabel.trim();
  if (!message || !partyLabel) {
    return {
      ok: false,
      code: 'message_required',
      message: 'Say who you contacted and what you asked for. Nothing has been recorded.',
    };
  }

  const [existing] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(eq(supportCases.id, input.caseId))
    .limit(1);
  if (!existing) return { ok: false, code: 'not_found', message: 'No such case.' };

  const [row] = await db
    .insert(supportCaseContacts)
    .values({
      caseId: input.caseId,
      partyKind: input.partyKind,
      partyLabel,
      message,
      expectedResponseAt: input.expectedResponseAt ?? null,
      recordedBy: input.actor,
    })
    .returning({ id: supportCaseContacts.id });

  return { ok: true, contactId: row!.id };
}

/**
 * Record what came back.
 *
 * Write-once, at the service and again at the 0045 trigger: §25.6's posture is
 * that a correction is a new record rather than a rewrite, and the conditional
 * `WHERE outcome IS NULL` means two Admins recording an outcome at the same
 * moment produce one answer rather than a silent overwrite.
 */
export async function recordContactOutcome(
  db: Database,
  input: AuditContext & { caseId: string; contactId: string; outcome: string },
): Promise<MutationOutcome> {
  const outcome = input.outcome.trim();
  if (!outcome) {
    return { ok: false, code: 'outcome_required', message: 'Record what came back.' };
  }

  const moved = await db
    .update(supportCaseContacts)
    .set({ outcome, outcomeRecordedAt: new Date() })
    .where(
      and(
        eq(supportCaseContacts.id, input.contactId),
        eq(supportCaseContacts.caseId, input.caseId),
        isNull(supportCaseContacts.outcome),
      ),
    )
    .returning({ id: supportCaseContacts.id });

  if (moved.length !== 1) {
    return {
      ok: false,
      code: 'already_recorded',
      message:
        'An outcome is already recorded for that contact, or it belongs to another case. A correction is a new contact record (§25.6).',
    };
  }

  return { ok: true };
}

/* ── Opening a case from the workspace ─────────────────────────────────────*/

/** The topic list, so a caller validates against §26.7's ten and not a copy. */
export { SUPPORT_TOPICS };

/**
 * Set a subject on a case.
 *
 * Separate from `openSupportCase` because that service is shared with §29.9's
 * Backer path, where there is no subject to give — the person writes a message,
 * not a title. Rather than widen a signature five callers depend on, the
 * workspace sets it as its own act.
 */
export async function setCaseSubject(
  db: Database,
  input: { caseId: string; subject: string },
): Promise<MutationOutcome> {
  const subject = input.subject.trim();
  if (!subject) {
    return { ok: false, code: 'subject_required', message: 'Give the case a subject.' };
  }
  const moved = await db
    .update(supportCases)
    .set({ subject, updatedAt: new Date() })
    .where(eq(supportCases.id, input.caseId))
    .returning({ id: supportCases.id });
  if (moved.length !== 1) return { ok: false, code: 'not_found', message: 'No such case.' };
  return { ok: true };
}
