/**
 * §22.8's Creator completion status — Spec §22.8, §23.4, §25.6, §33.10.5,
 * §33.10.6 (Phase 21b).
 *
 * ── The five criteria are evaluated, never asserted ─────────────────────────
 * §22.8 says "Only Admin can assign it … when all five hold", which is two
 * separate rules that are easy to collapse into one. The Admin makes the
 * decision; the *criteria* are read from records earlier phases wrote. So
 * `gatherCompletionFindings` takes no judgement from the caller and
 * `assignCompletionStatus` refuses a `successfully_completed` whose findings
 * are not all met — by name, so the Admin reads which criterion is missing.
 *
 * The findings are then STORED on the decision row. §22.8 asks for the
 * evidence, and a decision that pointed at a live read would silently change
 * its own justification the next time a record moved.
 *
 * ── Sales performance is not a criterion, and cannot become one ─────────────
 * §33.10.6: "Zero sales does not block completion when work was valid." There
 * is no sales term in the register, no revenue column read anywhere in this
 * file, and the suite asserts a Creator with zero captured attributed
 * transactions completes. That is the trap the phase names, and the defence is
 * that the number is never fetched rather than fetched and ignored.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { associationReadiness } from '../db/schema/build.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import {
  creatorCompletionDecisions,
  creatorEarnings,
  affiliateTransfers,
} from '../db/schema/earnings.js';
import { creatorPaymentAllocations } from '../db/schema/creator-payment.js';
import { affiliateEnforcementActions } from '../db/schema/enforcement.js';
import { day14Reviews } from '../db/schema/fulfillment.js';
import { creatorCompletionStatuses } from '../db/schema/completion.js';
import type { AuditWriter } from '../auth/audit.js';
import { transitionAssociation } from '../affiliates/recruitment.js';
import {
  COMPLETION_CRITERION_KEYS,
  completionEligible,
  unmetCriteria,
  type CriterionFinding,
  type CompletionStatus,
} from './logic.js';

export interface CompletionDeps {
  db: Database;
  audit: AuditWriter;
}

/**
 * The five §22.8 criteria, read from the records that hold them.
 *
 * Returns a finding per criterion in register order, so a caller cannot
 * receive a partial answer that looks complete. Each `detail` says what is
 * missing in words an Admin can act on rather than a table name.
 */
export async function gatherCompletionFindings(
  db: Database,
  associationId: string,
): Promise<CriterionFinding[]> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!association) throw new Error('no such association');

  /* 1 — readiness cleared BEFORE work (§16). */
  const [readiness] = await db
    .select({ confirmedAt: associationReadiness.readinessConfirmedAt })
    .from(associationReadiness)
    .where(eq(associationReadiness.associationId, associationId))
    .limit(1);

  /* 2 — at least one post verified `passed` (§17). */
  const [passed] = await db
    .select({ id: creatorPostSubmissions.id })
    .from(creatorPostSubmissions)
    .where(
      and(
        eq(creatorPostSubmissions.associationId, associationId),
        eq(creatorPostSubmissions.status, 'passed'),
      ),
    )
    .limit(1);

  /* 3 — deliverables verified or waived by BOTH parties (§22.1). */
  const [decision] = await db
    .select({
      outcome: creatorCompletionDecisions.outcome,
      waiver: creatorCompletionDecisions.waiver,
      byFounder: creatorCompletionDecisions.waiverAgreedByFounder,
      byAdmin: creatorCompletionDecisions.waiverAgreedByAdmin,
    })
    .from(creatorCompletionDecisions)
    .where(eq(creatorCompletionDecisions.associationId, associationId))
    .orderBy(desc(creatorCompletionDecisions.decidedAt))
    .limit(1);

  const deliverablesMet =
    decision?.outcome === 'complete_verified' ||
    (decision?.waiver !== null &&
      decision?.waiver !== undefined &&
      decision.byFounder === true &&
      decision.byAdmin === true);

  /* 4 — no unresolved enforcement or review case (§29, §22.4). */
  const [openEnforcement] = await db
    .select({ kind: affiliateEnforcementActions.actionKind })
    .from(affiliateEnforcementActions)
    .where(
      and(
        eq(affiliateEnforcementActions.associationId, associationId),
        // A warning is a recorded fact, not an open case. A pause or removal is
        // the campaign saying this Creator's participation was stopped, which
        // is exactly the "material breach" §22.8.4 means.
        sql`${affiliateEnforcementActions.actionKind} <> 'warning'`,
      ),
    )
    .limit(1);

  const [failedReview] = await db
    .select({ outcome: day14Reviews.outcome })
    .from(day14Reviews)
    .where(and(eq(day14Reviews.campaignId, association.campaignId), eq(day14Reviews.outcome, 'fail')))
    .limit(1);

  /* 5 — money resolved or recorded (§22.1, §24.7). */
  const [earnings] = await db
    .select({ state: creatorEarnings.state })
    .from(creatorEarnings)
    .where(eq(creatorEarnings.associationId, associationId))
    .limit(1);

  const [transfer] = await db
    .select({ status: affiliateTransfers.status })
    .from(affiliateTransfers)
    .where(eq(affiliateTransfers.associationId, associationId))
    .limit(1);

  const [allocation] = await db
    .select({ status: creatorPaymentAllocations.status })
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.associationId, associationId))
    .limit(1);

  /*
   * §22.8.5 says "resolved OR RECORDED", which is the looser of the two and
   * deliberately so: a Creator owed nothing has no Transfer to resolve, and
   * requiring one would disqualify exactly the Creator §33.10.6 protects. So
   * the test is that the earnings record exists and has left the provisional
   * state — a US$0 finalization is a resolved fact, not a missing one.
   */
  const moneyResolved =
    earnings !== undefined &&
    earnings.state !== 'estimated' &&
    // A fixed allocation that exists must have reached a terminal state; one
    // that does not exist is the "no fixed arrangement" case (§22.1).
    (allocation === undefined ||
      allocation.status === 'paid' ||
      allocation.status === 'returned') &&
    // A Transfer that was attempted must not be sitting failed.
    (transfer === undefined || transfer.status !== 'failed');

  const findings: CriterionFinding[] = [
    {
      key: 'readiness_cleared',
      met: readiness?.confirmedAt != null,
      detail: readiness?.confirmedAt != null ? '' : 'The §16 readiness checklist was never confirmed for this Creator.',
    },
    {
      key: 'valid_post_verified',
      met: passed !== undefined,
      detail: passed !== undefined ? '' : 'No first post has been submitted and verified as passing.',
    },
    {
      key: 'deliverables_resolved',
      met: deliverablesMet,
      detail: deliverablesMet
        ? ''
        : decision === undefined
          ? 'No §22.1 completion decision has been recorded for this Creator.'
          : 'The deliverables were neither verified complete nor waived by both the Founder and Admin with a reason.',
    },
    {
      key: 'no_unresolved_case',
      met: openEnforcement === undefined && failedReview === undefined,
      detail:
        openEnforcement !== undefined
          ? `An enforcement action (${openEnforcement.kind}) stands against this Creator.`
          : failedReview !== undefined
            ? 'This campaign failed its Day 14 Progress Check and the outcome is unresolved.'
            : '',
    },
    {
      key: 'money_resolved',
      met: moneyResolved,
      detail: moneyResolved
        ? ''
        : earnings === undefined
          ? 'Earnings have not been finalized for this Creator.'
          : 'Earnings, the fixed payment, or the Transfer is still unresolved.',
    },
  ];

  // The register decides the order and the count; a missing key here would be a
  // finding set that passes `completionEligible` by being short.
  if (findings.length !== COMPLETION_CRITERION_KEYS.length) {
    throw new Error('the §22.8 findings do not cover every criterion');
  }
  return findings;
}

export type AssignRefusal =
  | 'not_found'
  | 'campaign_not_ended'
  | 'criteria_not_met'
  | 'already_decided'
  | 'reason_required';

export type AssignOutcome =
  | { ok: true; statusId: string; status: CompletionStatus; findings: CriterionFinding[] }
  | { ok: false; code: AssignRefusal; message: string; unmet?: CriterionFinding[] };

/** §22.8: "after campaign end". The lifecycle states that mean the campaign ended. */
const ENDED_STATUSES = [
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
  'refunded_no_creator',
  'suspended',
  'killed',
] as const;

/**
 * Records the §22.8 decision and moves the association to its §23.4 status.
 *
 * A `successfully_completed` is refused unless every criterion is met — the
 * Admin decides, and the criteria decide whether the decision is available.
 * A disqualification is always available, because §22.8 asks for the
 * disqualifying reason to be recorded rather than for the Creator to be left
 * in an unexplained limbo.
 */
export async function assignCompletionStatus(
  deps: CompletionDeps,
  input: {
    associationId: string;
    status: CompletionStatus;
    decidedBy: string;
    evidenceNote: string;
    disqualifyingReason?: string | undefined;
  },
): Promise<AssignOutcome> {
  const { db } = deps;

  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      campaignStatus: campaigns.status,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) {
    return { ok: false, code: 'not_found', message: 'No such Creator on any campaign.' };
  }

  if (!(ENDED_STATUSES as readonly string[]).includes(association.campaignStatus)) {
    return {
      ok: false,
      code: 'campaign_not_ended',
      message:
        '§22.8 assigns a completion status only after the campaign has ended. This one is still running.',
    };
  }

  if (input.status === 'completion_disqualified' && !input.disqualifyingReason?.trim()) {
    return {
      ok: false,
      code: 'reason_required',
      message:
        '§22.8 requires the disqualifying reason. Name the actual behaviour — "policy violation" is not a reason (§29.4).',
    };
  }

  const [live] = await db
    .select({ id: creatorCompletionStatuses.id })
    .from(creatorCompletionStatuses)
    .where(
      and(
        eq(creatorCompletionStatuses.associationId, input.associationId),
        isNull(creatorCompletionStatuses.supersededAt),
      ),
    )
    .limit(1);
  if (live) {
    return {
      ok: false,
      code: 'already_decided',
      message:
        'This Creator already has a completion status. Record a correction, which supersedes it and keeps the history (§22.9).',
    };
  }

  const findings = await gatherCompletionFindings(db, input.associationId);

  if (input.status === 'successfully_completed' && !completionEligible(findings)) {
    const unmet = unmetCriteria(findings);
    return {
      ok: false,
      code: 'criteria_not_met',
      message: `§22.8 needs all five criteria. Still unmet: ${unmet.map((u) => u.key).join(', ')}.`,
      unmet,
    };
  }

  const statusId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(creatorCompletionStatuses)
      .values({
        associationId: input.associationId,
        campaignId: association.campaignId,
        status: input.status,
        decidedBy: input.decidedBy,
        criteriaFindings: findings,
        evidenceNote: input.evidenceNote,
        disqualifyingReason:
          input.status === 'completion_disqualified'
            ? (input.disqualifyingReason?.trim() ?? null)
            : null,
      })
      .returning({ id: creatorCompletionStatuses.id });

    /*
     * §23.4's own states. The transition is conditional on the association's
     * current status, so a Creator who was already removed or ended keeps that
     * history — the completion record stands either way, because §22.8 asks
     * for the decision to be stored regardless of where the relationship
     * finished.
     */
    await transitionAssociation(
      input.associationId,
      association.status as 'active',
      input.status,
      input.decidedBy,
      tx,
    );

    return row!.id;
  });

  await deps.audit({
    action: 'completion.status_assigned',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.8 ${input.status}: ${input.evidenceNote}`,
    customerExplanation:
      input.status === 'successfully_completed'
        ? 'Completed successfully.'
        : (input.disqualifyingReason ?? null),
    newValue: { statusId, findings },
    actorId: input.decidedBy,
  });

  return { ok: true, statusId, status: input.status, findings };
}

/**
 * §22.9: "a later correction to completion status changes eligibility without
 * deleting history."
 *
 * The correction is a NEW row; the old one is marked superseded and points at
 * its successor. Work-again requests keep citing the row they were made
 * against, so a correction changes what may be asked NEXT without rewriting
 * what was already asked.
 */
export async function correctCompletionStatus(
  deps: CompletionDeps,
  input: {
    associationId: string;
    status: CompletionStatus;
    decidedBy: string;
    evidenceNote: string;
    disqualifyingReason?: string | undefined;
  },
): Promise<AssignOutcome> {
  const { db } = deps;

  const [live] = await db
    .select({ id: creatorCompletionStatuses.id, campaignId: creatorCompletionStatuses.campaignId })
    .from(creatorCompletionStatuses)
    .where(
      and(
        eq(creatorCompletionStatuses.associationId, input.associationId),
        isNull(creatorCompletionStatuses.supersededAt),
      ),
    )
    .limit(1);
  if (!live) {
    return {
      ok: false,
      code: 'not_found',
      message: 'There is no completion status to correct. Assign one first.',
    };
  }

  if (input.status === 'completion_disqualified' && !input.disqualifyingReason?.trim()) {
    return {
      ok: false,
      code: 'reason_required',
      message: '§22.8 requires the disqualifying reason, naming the actual behaviour (§29.4).',
    };
  }

  const findings = await gatherCompletionFindings(db, input.associationId);

  const statusId = await db.transaction(async (tx) => {
    /*
     * Retire FIRST, then insert. `completion_status_one_live_idx` is a partial
     * unique index over the un-superseded rows, so the old one must stop being
     * live before the new one can exist — the 12a supersession shape, and the
     * reason that one needed a DEFERRABLE FK while this does not: nothing here
     * has to point forward at a row that does not exist yet.
     */
    // Pre-minted so the retiring UPDATE can point at its successor in the same
    // statement that retires it — the immutability trigger refuses any later
    // write to a superseded row, which is what makes the pointer honest.
    const nextId = randomUUID();

    await tx
      .update(creatorCompletionStatuses)
      .set({ supersededAt: new Date(), supersededById: nextId })
      .where(eq(creatorCompletionStatuses.id, live.id));

    const [row] = await tx
      .insert(creatorCompletionStatuses)
      .values({
        id: nextId,
        associationId: input.associationId,
        campaignId: live.campaignId,
        status: input.status,
        decidedBy: input.decidedBy,
        criteriaFindings: findings,
        evidenceNote: input.evidenceNote,
        disqualifyingReason:
          input.status === 'completion_disqualified'
            ? (input.disqualifyingReason?.trim() ?? null)
            : null,
      })
      .returning({ id: creatorCompletionStatuses.id });

    return row!.id;
  });

  await deps.audit({
    action: 'completion.status_corrected',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `§22.9 correction to ${input.status}: ${input.evidenceNote}`,
    priorValue: { statusId: live.id },
    newValue: { statusId, findings },
    actorId: input.decidedBy,
  });

  return { ok: true, statusId, status: input.status, findings };
}

/** The live completion status for one association, or null. */
export async function readCompletionStatus(db: Database, associationId: string) {
  const [row] = await db
    .select()
    .from(creatorCompletionStatuses)
    .where(
      and(
        eq(creatorCompletionStatuses.associationId, associationId),
        isNull(creatorCompletionStatuses.supersededAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
