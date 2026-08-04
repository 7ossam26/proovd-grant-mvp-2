/**
 * §20 Act — the one ranked action — Spec §20, §31.9, §33.6.7 (Phase 17a).
 *
 * ── Every candidate comes from a record ─────────────────────────────────────
 * §20: "When no real action exists, show no manufactured CTA." DNA §5.4 calls the
 * caught-up ending a designed done-moment, not an empty state to be filled. So
 * `gatherActCandidates` reads five existing tables and returns only what it
 * found. There is no branch that produces a candidate from a date, a duration, or
 * an absence — which also means there is no place for a "you haven't posted in a
 * while" nudge to be added later without deleting a comment that says not to.
 *
 * The five sources, in §20's own order:
 *
 *   1  `campaign_enforcement_actions`   an active suspension (§26.7). A campaign
 *                                       Proovd has stopped is the definition of a
 *                                       safety or compliance blocker.
 *   2  `campaign_reviews`               an open round the Founder must answer,
 *      `material_changes`               and a classified material change to
 *                                       delivery, dates, or refund terms whose
 *                                       reacceptance is still pending (§15).
 *   3  `support_cases`                  a case awaiting the Founder whose last
 *                                       message came from the customer.
 *   4  `material_changes`               a recorded material delivery change with
 *      `campaign_updates`               no update pairing prior and revised
 *                                       commitments yet (§18).
 *   5  `campaign_milestones`            a milestone that actually happened and
 *                                       has not been moved to history.
 *
 * ── Rank 4 is not a cadence, deliberately ───────────────────────────────────
 * §20 names "Required campaign update due" and neither §6 nor §14.4 states an
 * update cadence anywhere. §1 rule 6 forbids inventing one, and §33.6.11 forbids
 * the thing an invented cadence becomes. So an update is *required* only when a
 * material delivery change has been recorded and §18's prior/revised pairing has
 * not been published — a real consequence, with a real record behind it. A
 * campaign where nothing changed owes no update, and says so by not showing one.
 */

import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignEnforcementActions, supportCases, supportCaseMessages } from '../db/schema/support.js';
import { campaignReviews, materialChanges, materialChangeReacceptances } from '../db/schema/build.js';
import { campaignUpdates } from '../db/schema/updates.js';
import { campaignMilestones, actRankCorrections, type ActRankCorrection } from '../db/schema/live.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  ACT_LABELS,
  ACT_RANK_BY_KIND,
  MILESTONE_LABELS,
  type ActActionKind,
  type ActCorrectionKind,
  type MilestoneKind,
} from './logic.js';

export interface ActCandidate {
  kind: ActActionKind;
  rank: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** Composed from the record. Never a template default (§1.4). */
  detail: string;
  href: string;
  sourceTable: string;
  sourceId: string;
  occurredAt: string;
}

export type ActView =
  | {
      state: 'action';
      action: ActCandidate;
      /** True when a documented safety override chose this over the natural rank. */
      overridden: boolean;
      override: { reason: string; actor: string; recordedAt: string } | null;
      /** Everything else that is real, in rank order. Explore renders these. */
      deferred: ActCandidate[];
    }
  | { state: 'caught_up'; closesAt: string | null };

/** §26.7 categories that mean the campaign is stopped rather than merely flagged. */
const ACTIVE_SUSPENSION_STATUSES = ['suspended'] as const;

/**
 * §15's material classes that make an edit a delivery, refund, or date matter.
 * Matched against `material_changes.affected_fields`, which the classification
 * recorded — never inferred from the text of the change.
 */
const DELIVERY_TERM_FIELDS = [
  'deliveryWindow',
  'delivery',
  'fulfillmentCommitment',
  'closesAt',
  'opensAt',
  'refundPolicyText',
  'refundPolicyVersion',
  'rewardDelivery',
] as const;

function touchesDeliveryTerms(affectedFields: unknown): boolean {
  if (!Array.isArray(affectedFields)) return false;
  return affectedFields.some(
    (field) => typeof field === 'string' && (DELIVERY_TERM_FIELDS as readonly string[]).includes(field),
  );
}

function candidate(
  kind: ActActionKind,
  input: { detail: string; href: string; sourceTable: string; sourceId: string; occurredAt: Date },
): ActCandidate {
  return {
    kind,
    rank: ACT_RANK_BY_KIND[kind],
    label: ACT_LABELS[kind],
    detail: input.detail,
    href: input.href,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    occurredAt: input.occurredAt.toISOString(),
  };
}

/**
 * Reads the five sources and returns only real candidates.
 *
 * `campaignStatus` is passed rather than re-read so the caller's single view of
 * the campaign decides — two reads a moment apart could disagree about whether a
 * campaign is suspended, and the Act panel and the Glance panel disagreeing is
 * the sort of thing a Founder reports as the product being broken.
 */
export async function gatherActCandidates(
  db: Database,
  input: { campaignId: string; campaignStatus: string },
): Promise<ActCandidate[]> {
  const found: ActCandidate[] = [];

  /* 1 — an active suspension (§26.7). */
  if ((ACTIVE_SUSPENSION_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    const [action] = await db
      .select()
      .from(campaignEnforcementActions)
      .where(
        and(
          eq(campaignEnforcementActions.campaignId, input.campaignId),
          eq(campaignEnforcementActions.action, 'suspend'),
        ),
      )
      .orderBy(desc(campaignEnforcementActions.occurredAt))
      .limit(1);
    if (action) {
      found.push(
        candidate('safety_compliance_blocker', {
          // The customer explanation, not the internal reason — §25.6 keeps them
          // in separate columns and a Founder reads the customer-facing one.
          detail: action.customerExplanation,
          href: '/support',
          sourceTable: 'campaign_enforcement_actions',
          sourceId: action.id,
          occurredAt: action.occurredAt,
        }),
      );
    }
  }

  /* 2 — an open review round, and a pending change to delivery/refund/date terms. */
  const [review] = await db
    .select()
    .from(campaignReviews)
    .where(
      and(
        eq(campaignReviews.campaignId, input.campaignId),
        eq(campaignReviews.outcome, 'changes_required'),
      ),
    )
    .orderBy(desc(campaignReviews.round))
    .limit(1);
  if (review) {
    found.push(
      candidate('delivery_refund_date_review', {
        detail:
          review.nextUpdateExpectation ??
          'A reviewer asked for changes before this campaign can continue.',
        href: `/campaigns/${input.campaignId}/build`,
        sourceTable: 'campaign_reviews',
        sourceId: review.id,
        occurredAt: review.decidedAt ?? review.submittedAt,
      }),
    );
  }

  const pendingChanges = await db
    .select({
      id: materialChanges.id,
      reason: materialChanges.reason,
      affectedFields: materialChanges.affectedFields,
      createdAt: materialChanges.createdAt,
    })
    .from(materialChanges)
    .where(
      and(
        eq(materialChanges.campaignId, input.campaignId),
        eq(materialChanges.classification, 'material'),
        eq(materialChanges.reacceptanceState, 'pending'),
      ),
    )
    .orderBy(materialChanges.createdAt);

  for (const change of pendingChanges) {
    if (!touchesDeliveryTerms(change.affectedFields)) continue;
    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(materialChangeReacceptances)
      .where(
        and(
          eq(materialChangeReacceptances.materialChangeId, change.id),
          eq(materialChangeReacceptances.decision, 'pending'),
        ),
      );
    if (Number(pending?.n ?? 0) === 0) continue;
    found.push(
      candidate('delivery_refund_date_review', {
        detail: `${Number(pending?.n ?? 0)} Creator(s) have not yet accepted the changed terms: ${change.reason}`,
        href: `/campaigns/${input.campaignId}/roster`,
        sourceTable: 'material_changes',
        sourceId: change.id,
        occurredAt: change.createdAt,
      }),
    );
  }

  /* 3 — a Backer question waiting on the Founder. */
  const founderCases = await db
    .select({
      id: supportCases.id,
      reference: supportCases.reference,
      topic: supportCases.topic,
      createdAt: supportCases.createdAt,
      lastResponseAt: supportCases.lastResponseAt,
    })
    .from(supportCases)
    .where(
      and(
        eq(supportCases.campaignId, input.campaignId),
        eq(supportCases.status, 'awaiting_founder'),
        eq(supportCases.requesterKind, 'backer'),
      ),
    )
    .orderBy(supportCases.createdAt);

  for (const supportCase of founderCases) {
    // Unanswered means the last thing that happened was the customer writing. An
    // internal note does not answer anybody — the same rule 16b's queue applies
    // to the SLA breach, for the same reason.
    const [latest] = await db
      .select({
        direction: supportCaseMessages.direction,
        occurredAt: supportCaseMessages.occurredAt,
      })
      .from(supportCaseMessages)
      .where(
        and(
          eq(supportCaseMessages.caseId, supportCase.id),
          eq(supportCaseMessages.customerFacing, true),
        ),
      )
      .orderBy(desc(supportCaseMessages.occurredAt))
      .limit(1);
    if (latest && latest.direction !== 'inbound') continue;
    found.push(
      candidate('unanswered_backer_question', {
        detail: `Case ${supportCase.reference} is waiting on you.`,
        href: `/support/cases/${supportCase.id}`,
        sourceTable: 'support_cases',
        sourceId: supportCase.id,
        occurredAt: latest?.occurredAt ?? supportCase.createdAt,
      }),
    );
  }

  /* 4 — a material delivery change with no §18 update pairing it yet. */
  const deliveryChanges = await db
    .select({
      id: materialChanges.id,
      reason: materialChanges.reason,
      affectedFields: materialChanges.affectedFields,
      createdAt: materialChanges.createdAt,
    })
    .from(materialChanges)
    .where(
      and(
        eq(materialChanges.campaignId, input.campaignId),
        eq(materialChanges.classification, 'material'),
      ),
    )
    .orderBy(materialChanges.createdAt);

  for (const change of deliveryChanges) {
    if (!touchesDeliveryTerms(change.affectedFields)) continue;
    const [paired] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignUpdates)
      .where(
        and(
          eq(campaignUpdates.campaignId, input.campaignId),
          eq(campaignUpdates.isMaterialDeliveryChange, true),
          gt(campaignUpdates.publishedAt, change.createdAt),
        ),
      );
    if (Number(paired?.n ?? 0) > 0) continue;
    found.push(
      candidate('required_campaign_update', {
        detail: `Backers have not been told about this change yet: ${change.reason}`,
        href: `/campaigns/${input.campaignId}/updates`,
        sourceTable: 'material_changes',
        sourceId: change.id,
        occurredAt: change.createdAt,
      }),
    );
  }

  /* 5 — a milestone that happened and has not moved to history. */
  const openMilestones = await db
    .select()
    .from(campaignMilestones)
    .where(
      and(
        eq(campaignMilestones.campaignId, input.campaignId),
        isNull(campaignMilestones.acknowledgedAt),
      ),
    )
    .orderBy(campaignMilestones.occurredAt);

  for (const milestone of openMilestones) {
    found.push(
      candidate('optional_milestone_update', {
        detail: MILESTONE_LABELS[milestone.kind as MilestoneKind] ?? milestone.kind,
        href: `/campaigns/${input.campaignId}/updates`,
        sourceTable: 'campaign_milestones',
        sourceId: milestone.id,
        occurredAt: milestone.occurredAt,
      }),
    );
  }

  return found;
}

/**
 * §20's ranking, applied.
 *
 * Restates the shared `decideAct` kernel — the backend cannot import it at
 * runtime, and `src/tests/live-operations.test.ts` walks the same cases through
 * both. Dismissed candidates are removed before ranking, because a dismissal is
 * the Founder saying it should not have been shown.
 */
export async function decideAct(
  db: Database,
  input: { campaignId: string; campaignStatus: string; closesAt: Date | null },
): Promise<ActView> {
  const gathered = await gatherActCandidates(db, {
    campaignId: input.campaignId,
    campaignStatus: input.campaignStatus,
  });

  const dismissals = await db
    .select({ sourceId: actRankCorrections.sourceId })
    .from(actRankCorrections)
    .where(
      and(
        eq(actRankCorrections.campaignId, input.campaignId),
        eq(actRankCorrections.correctionKind, 'dismissal'),
      ),
    );
  const dismissed = new Set(dismissals.map((row) => row.sourceId).filter(Boolean));

  const candidates = gathered.filter((entry) => !dismissed.has(entry.sourceId));

  if (candidates.length === 0) {
    return { state: 'caught_up', closesAt: input.closesAt?.toISOString() ?? null };
  }

  const ordered = [...candidates].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Inside one rank, the record that has waited longest.
    return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  });

  const [override] = await db
    .select()
    .from(actRankCorrections)
    .where(
      and(
        eq(actRankCorrections.campaignId, input.campaignId),
        eq(actRankCorrections.correctionKind, 'safety_override'),
        isNull(actRankCorrections.withdrawnAt),
      ),
    )
    .limit(1);

  if (override) {
    const promoted = ordered.find((entry) => entry.kind === override.actionKind);
    // An override naming a kind with no real candidate promotes nothing. It
    // cannot manufacture an action — the one thing §20 forbids outright.
    if (promoted) {
      return {
        state: 'action',
        action: promoted,
        overridden: promoted !== ordered[0],
        override: {
          reason: override.reason,
          actor: override.actor,
          recordedAt: override.occurredAt.toISOString(),
        },
        deferred: ordered.filter((entry) => entry !== promoted),
      };
    }
  }

  const [first, ...rest] = ordered;
  return {
    state: 'action',
    action: first!,
    overridden: false,
    override: null,
    deferred: rest,
  };
}

/* ── §20: recording a correction (§31.9's next-action correction rate) ─────── */

export type RecordCorrectionOutcome =
  | { ok: true; correction: ActRankCorrection }
  | { ok: false; code: 'missing_reason' | 'invalid_rank' | 'override_exists'; message: string };

/**
 * §20: "Store every later correction/dismissal/reclassification of the ranked
 * action with prior rank, reason, actor, and time."
 *
 * The reason and the actor are refused here by name as well as by CHECK, so the
 * caller reads which one is missing rather than a constraint name. §31.9 counts
 * these rows, and a correction with no reason is a number nobody can act on.
 */
export async function recordActCorrection(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    actionKind: ActActionKind;
    correctionKind: ActCorrectionKind;
    priorRank: number;
    newRank?: number | undefined;
    reason: string;
    actor: string;
    sourceTable?: string | undefined;
    sourceId?: string | undefined;
  },
): Promise<RecordCorrectionOutcome> {
  if (!input.reason.trim()) {
    return {
      ok: false,
      code: 'missing_reason',
      message: 'A correction records why the ranking was wrong. Say what happened.',
    };
  }
  if (input.priorRank < 1 || input.priorRank > 5) {
    return { ok: false, code: 'invalid_rank', message: 'A prior rank is one of §20’s five.' };
  }
  if (input.correctionKind === 'reclassification' && input.newRank === undefined) {
    return {
      ok: false,
      code: 'invalid_rank',
      message: 'A reclassification states the rank it should have been.',
    };
  }

  const newRank = input.correctionKind === 'dismissal' ? null : (input.newRank ?? null);

  try {
    const [correction] = await db
      .insert(actRankCorrections)
      .values({
        campaignId: input.campaignId,
        actionKind: input.actionKind,
        correctionKind: input.correctionKind,
        priorRank: input.priorRank,
        newRank,
        reason: input.reason.trim(),
        actor: input.actor,
        sourceTable: input.sourceTable ?? null,
        sourceId: input.sourceId ?? null,
      })
      .returning();

    await deps.audit({
      action: `live.act_${input.correctionKind}`,
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `§20 ranked-action ${input.correctionKind} on ${input.actionKind}: ${input.reason.trim()}`,
      priorValue: { rank: input.priorRank },
      newValue: { rank: newRank },
      actorId: input.actor,
    });

    return { ok: true, correction: correction! };
  } catch (error) {
    // The partial unique index: one live safety override per campaign. Two would
    // make "which one changed the ranking" unanswerable from the record.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'override_exists',
        message: 'A safety override is already in force for this campaign. Withdraw it first.',
      };
    }
    throw error;
  }
}

/** Withdrawing a safety override is its own recorded act, not an edit. */
export async function withdrawSafetyOverride(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; actor: string },
): Promise<boolean> {
  const withdrawn = await db
    .update(actRankCorrections)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(actRankCorrections.campaignId, input.campaignId),
        eq(actRankCorrections.correctionKind, 'safety_override'),
        isNull(actRankCorrections.withdrawnAt),
      ),
    )
    .returning({ id: actRankCorrections.id });

  if (withdrawn.length === 0) return false;

  await deps.audit({
    action: 'live.act_safety_override_withdrawn',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: '§20 safety override withdrawn; the natural ranking applies again',
    actorId: input.actor,
  });
  return true;
}

export async function listActCorrections(
  db: Database,
  campaignId: string,
): Promise<ActRankCorrection[]> {
  return db
    .select()
    .from(actRankCorrections)
    .where(eq(actRankCorrections.campaignId, campaignId))
    .orderBy(desc(actRankCorrections.occurredAt));
}

/** Drizzle wraps the driver error, so the 23505 check walks `cause` (Phase 09a). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && 'code' in current && (current as { code?: string }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
