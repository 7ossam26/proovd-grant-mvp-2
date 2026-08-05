/**
 * The Day 14 Progress Check — Spec §22.4, §33.10.3 (Phase 21a).
 *
 * ── One checklist, two readers ──────────────────────────────────────────────
 * §22.4: "Admin and Founder see the same checklist and evidence list." So
 * there is ONE function — `day14Checklist(campaignType)` — and both surfaces
 * render its output. A second list would drift, and the Founder would be
 * refused for missing an item nobody showed them.
 *
 * ── The receipt is durable because it is insert-only ────────────────────────
 * §22.4 calls it a "durable receipt listing every supplied item and the
 * decision due time". A receipt the supplier can edit afterwards is not one, so
 * `day_14_evidence_submissions` and `day_14_evidence_items` have no UPDATE or
 * DELETE grant at all. A resubmission is a NEW receipt with its own reference;
 * the earlier one survives, which is what makes "here is what I sent you on the
 * 12th" a checkable claim rather than an argument.
 *
 * ── The consequences differ by campaign type, and the difference is real ────
 * §22.4: Product failure blocks the unreleased remaining payment; an Idea
 * campaign has no unreleased payment, so its review is enforcement-only. That
 * is `day14FailureConsequences`, and §33.10.3 compares the two lists. Only the
 * block is executed automatically — it is a refusal, and refusals can be
 * structural. Every recovery line is `automatic: false`, because 20a made every
 * refund an Admin-recorded case with a cause, a preview, and an execution step,
 * and a review outcome must not move money past all three (§31.7's posture).
 */

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignUpdates } from '../db/schema/updates.js';
import {
  day14Reviews,
  day14EvidenceSubmissions,
  day14EvidenceItems,
  day14ClarificationRequests,
  type Day14Review,
} from '../db/schema/fulfillment.js';
import type { AuditWriter } from '../auth/audit.js';
import { businessDayDeadline } from '../launch/business-calendar.js';
import { containsRawProviderCode } from '../admin/logic.js';
import { notifyDay14Result, notifyDay14Due, type FulfillmentNotificationDeps } from './notifications.js';
import { loadFulfillmentFacts } from './service.js';
import {
  DAY_14_CLARIFICATION_BUSINESS_DAYS,
  DAY_14_FAILURE_LABELS,
  DAY_14_FAILURE_REASONS,
  DAY_14_RECENT_UPDATE_DAYS,
  DAY_14_REVIEW_DAY,
  day14BlocksAPayment,
  day14Checklist,
  day14FailureConsequences,
  day14OutcomeIsConsistent,
  missingDay14Items,
  type CampaignType,
  type Day14ChecklistItem,
  type Day14FailureReason,
  type Day14Outcome,
} from './logic.js';

export interface Day14Deps extends FulfillmentNotificationDeps {
  db: Database;
  audit: AuditWriter;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 16b reference alphabet: no O/0 or I/1, random, quotable. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function referenceChunk(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return out;
}

export function generateDay14Reference(): string {
  return `D14-${referenceChunk(5)}-${referenceChunk(5)}`;
}

/**
 * §22.4's anchor. `campaign_close_at` + 14 days — §22.4's own number, not a §6
 * setting: §6 fixes `product_remaining_payment_day` for the Product payment and
 * names nothing for the review, and §22.4 applies the review to every campaign
 * including Idea ones whose payment day is 3.
 */
export function day14DueAt(closeAt: Date): Date {
  return new Date(closeAt.getTime() + DAY_14_REVIEW_DAY * DAY_MS);
}

export type OpenDay14Outcome =
  | { status: 'opened'; review: Day14Review }
  | { status: 'already_open'; review: Day14Review }
  | { status: 'campaign_not_found' }
  | { status: 'no_close_anchor' }
  | { status: 'nothing_captured' };

/**
 * Opens the review record. Idempotent by the one-per-campaign unique index — a
 * second sweep tick returns the first row unchanged.
 *
 * A campaign that captured nothing gets no review: §22.4's failure consequences
 * are all about money that moved, and opening a progress check against a
 * campaign whose Backers were never charged would be a burden nothing justifies
 * (§1.4 — the same reasoning as 19b's W-9 request).
 */
export async function openDay14Review(
  deps: Day14Deps,
  input: { campaignId: string; now?: Date },
): Promise<OpenDay14Outcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };
  if (!facts.closeAt) return { status: 'no_close_anchor' };
  if (!facts.anyCaptured) return { status: 'nothing_captured' };

  const existing = await readDay14Review(deps.db, input.campaignId);
  if (existing) return { status: 'already_open', review: existing };

  const dueAt = day14DueAt(facts.closeAt);
  try {
    const [row] = await deps.db
      .insert(day14Reviews)
      .values({ campaignId: input.campaignId, dueAt })
      .returning();
    await deps.audit({
      action: 'day_14.review_opened',
      targetType: 'campaign',
      targetId: input.campaignId,
      actorId: 'system',
      internalReason: '§22.4: Admin performs the Day 14 Progress Check for every campaign.',
      newValue: { dueAt: dueAt.toISOString() },
    });
    return { status: 'opened', review: row! };
  } catch {
    const again = await readDay14Review(deps.db, input.campaignId);
    if (again) return { status: 'already_open', review: again };
    throw new Error('day 14 review could not be opened');
  }
}

export async function readDay14Review(
  db: Database,
  campaignId: string,
): Promise<Day14Review | null> {
  const [row] = await db
    .select()
    .from(day14Reviews)
    .where(eq(day14Reviews.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

/* ── The checklist and its receipt ─────────────────────────────────────────── */

export interface Day14ChecklistView {
  campaignId: string;
  campaignType: CampaignType;
  /** §22.4: the same list the Admin sees. */
  items: readonly Day14ChecklistItem[];
  reviewOpen: boolean;
  outcome: string;
  decisionDueAt: string | null;
  /** §22.4: "Idea review is enforcement-only." */
  blocksAPayment: boolean;
  enforcementOnly: boolean;
  submissions: {
    id: string;
    reference: string;
    submittedAt: string;
    submittedBy: string;
    decisionDueAt: string;
    items: { itemKey: string; label: string; detail: string; url: string | null }[];
  }[];
  clarifications: {
    id: string;
    question: string;
    requestedAt: string;
    dueAt: string;
    respondedAt: string | null;
    responseNote: string | null;
    overdue: boolean;
  }[];
}

/**
 * The one checklist read. §22.4 requires Admin and Founder to see the same
 * thing, so both routes call this and the Founder route simply omits nothing —
 * there is no Admin-only item and no Founder-only item to keep in step.
 */
export async function readDay14Checklist(
  db: Database,
  campaignId: string,
  now: Date = new Date(),
): Promise<Day14ChecklistView | null> {
  const facts = await loadFulfillmentFacts(db, campaignId);
  if (!facts) return null;

  const review = await readDay14Review(db, campaignId);
  const items = day14Checklist(facts.campaignType);
  const labels = new Map(items.map((i) => [i.key, i.label]));

  const submissions = review
    ? await db
        .select()
        .from(day14EvidenceSubmissions)
        .where(eq(day14EvidenceSubmissions.reviewId, review.id))
        .orderBy(desc(day14EvidenceSubmissions.submittedAt))
    : [];

  const submissionItems = submissions.length
    ? await db
        .select()
        .from(day14EvidenceItems)
        .where(
          inArray(
            day14EvidenceItems.submissionId,
            submissions.map((s) => s.id),
          ),
        )
        .orderBy(asc(day14EvidenceItems.createdAt))
    : [];

  const clarifications = review
    ? await db
        .select()
        .from(day14ClarificationRequests)
        .where(eq(day14ClarificationRequests.reviewId, review.id))
        .orderBy(asc(day14ClarificationRequests.requestedAt))
    : [];

  return {
    campaignId,
    campaignType: facts.campaignType,
    items,
    reviewOpen: review !== null,
    outcome: review?.outcome ?? 'not_opened',
    decisionDueAt: review?.dueAt.toISOString() ?? null,
    blocksAPayment: day14BlocksAPayment(facts.campaignType),
    enforcementOnly: !day14BlocksAPayment(facts.campaignType),
    submissions: submissions.map((s) => ({
      id: s.id,
      reference: s.reference,
      submittedAt: s.submittedAt.toISOString(),
      submittedBy: s.submittedBy,
      decisionDueAt: s.decisionDueAt.toISOString(),
      items: submissionItems
        .filter((i) => i.submissionId === s.id)
        .map((i) => ({
          itemKey: i.itemKey,
          label: labels.get(i.itemKey) ?? i.itemKey,
          detail: i.detail,
          url: i.url,
        })),
    })),
    clarifications: clarifications.map((c) => ({
      id: c.id,
      question: c.question,
      requestedAt: c.requestedAt.toISOString(),
      dueAt: c.dueAt.toISOString(),
      respondedAt: c.respondedAt?.toISOString() ?? null,
      responseNote: c.responseNote,
      overdue: c.respondedAt === null && now.getTime() > c.dueAt.getTime(),
    })),
  };
}

export type SubmitDay14Outcome =
  | { status: 'submitted'; submissionId: string; reference: string; decisionDueAt: Date }
  | { status: 'campaign_not_found' }
  | { status: 'review_not_open' }
  | { status: 'already_decided'; outcome: string }
  | { status: 'missing_items'; items: readonly string[] }
  | { status: 'unknown_items'; items: readonly string[] };

/**
 * §22.4's submission and its durable receipt.
 *
 * Refuses by NAME on a missing required item, so the Founder reads which one is
 * absent rather than a constraint. An item nobody asked for is refused too —
 * accepting one would let a submission look complete while missing what was
 * actually requested.
 */
export async function submitDay14Evidence(
  deps: Day14Deps,
  input: {
    campaignId: string;
    items: readonly { itemKey: string; detail: string; url?: string | null }[];
    actor: string;
    now?: Date;
  },
): Promise<SubmitDay14Outcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const review = await readDay14Review(deps.db, input.campaignId);
  if (!review) return { status: 'review_not_open' };
  if (review.outcome !== 'pending') return { status: 'already_decided', outcome: review.outcome };

  const allowed = new Set(day14Checklist(facts.campaignType).map((i) => i.key));
  const unknown = input.items.filter((i) => !allowed.has(i.itemKey)).map((i) => i.itemKey);
  if (unknown.length > 0) return { status: 'unknown_items', items: unknown };

  const supplied = input.items
    .filter((i) => i.detail.trim().length > 0)
    .map((i) => i.itemKey);
  const missing = missingDay14Items(facts.campaignType, supplied);
  if (missing.length > 0) return { status: 'missing_items', items: missing };

  const now = input.now ?? new Date();
  const reference = generateDay14Reference();

  const submissionId = await deps.db.transaction(async (tx) => {
    const [submission] = await tx
      .insert(day14EvidenceSubmissions)
      .values({
        campaignId: input.campaignId,
        reviewId: review.id,
        reference,
        // §22.4: the receipt lists "the decision due time" — the campaign's own
        // Day 14 anchor. A submission arriving after it is late, and the queue
        // shows it as overdue rather than inventing a fresh promise (16b's rule).
        decisionDueAt: review.dueAt,
        submittedBy: input.actor,
        submittedAt: now,
      })
      .returning({ id: day14EvidenceSubmissions.id });

    for (const item of input.items) {
      if (item.detail.trim().length === 0) continue;
      await tx.insert(day14EvidenceItems).values({
        submissionId: submission!.id,
        itemKey: item.itemKey,
        detail: item.detail,
        url: item.url ?? null,
      });
    }
    return submission!.id;
  });

  await deps.audit({
    action: 'day_14.evidence_submitted',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason: '§22.4: Founder evidence submission; the receipt is durable and insert-only.',
    newValue: {
      reference,
      decisionDueAt: review.dueAt.toISOString(),
      items: input.items.filter((i) => i.detail.trim().length > 0).map((i) => i.itemKey),
    },
  });

  return { status: 'submitted', submissionId, reference, decisionDueAt: review.dueAt };
}

/* ── §22.4's five-business-day clarification window ────────────────────────── */

export type ClarificationOutcome =
  | { status: 'requested'; requestId: string; dueAt: Date }
  | { status: 'review_not_open' }
  | { status: 'already_decided'; outcome: string };

export async function requestDay14Clarification(
  deps: Day14Deps,
  input: { campaignId: string; question: string; actor: string; now?: Date },
): Promise<ClarificationOutcome> {
  const review = await readDay14Review(deps.db, input.campaignId);
  if (!review) return { status: 'review_not_open' };
  if (review.outcome !== 'pending') return { status: 'already_decided', outcome: review.outcome };

  const now = input.now ?? new Date();
  // §22.4's third failure reason is a business-day deadline, so §29.6 governs
  // it: the committed calendar, stored with its version.
  const deadline = businessDayDeadline(now, DAY_14_CLARIFICATION_BUSINESS_DAYS);

  const [row] = await deps.db
    .insert(day14ClarificationRequests)
    .values({
      campaignId: input.campaignId,
      reviewId: review.id,
      question: input.question,
      requestedBy: input.actor,
      requestedAt: now,
      dueAt: deadline.dueAt,
      calendarVersion: deadline.calendarVersion,
    })
    .returning({ id: day14ClarificationRequests.id });

  await deps.audit({
    action: 'day_14.clarification_requested',
    targetType: 'campaign',
    targetId: input.campaignId,
    actorId: input.actor,
    internalReason: '§22.4: Admin clarification; unreachable for five business days is a failure reason.',
    newValue: { dueAt: deadline.dueAt.toISOString(), calendarVersion: deadline.calendarVersion },
  });

  return { status: 'requested', requestId: row!.id, dueAt: deadline.dueAt };
}

export async function recordDay14ClarificationResponse(
  deps: Day14Deps,
  input: { requestId: string; responseNote: string; actor: string; now?: Date },
): Promise<{ status: 'recorded' } | { status: 'not_found' } | { status: 'already_answered' }> {
  const [row] = await deps.db
    .select()
    .from(day14ClarificationRequests)
    .where(eq(day14ClarificationRequests.id, input.requestId))
    .limit(1);
  if (!row) return { status: 'not_found' };
  if (row.respondedAt) return { status: 'already_answered' };

  const now = input.now ?? new Date();
  const moved = await deps.db
    .update(day14ClarificationRequests)
    .set({ respondedAt: now, responseNote: input.responseNote })
    .where(
      and(
        eq(day14ClarificationRequests.id, input.requestId),
        isNull(day14ClarificationRequests.respondedAt),
      ),
    )
    .returning({ id: day14ClarificationRequests.id });
  if (moved.length !== 1) return { status: 'already_answered' };

  await deps.audit({
    action: 'day_14.clarification_answered',
    targetType: 'campaign',
    targetId: row.campaignId,
    actorId: input.actor,
    internalReason: '§22.4: the Founder answered the Admin clarification inside its window.',
    newValue: { respondedAt: now.toISOString() },
  });

  return { status: 'recorded' };
}

/* ── The decision ──────────────────────────────────────────────────────────── */

export type DecideDay14Outcome =
  | {
      status: 'decided';
      outcome: Day14Outcome;
      consequences: readonly { key: string; label: string; automatic: boolean }[];
      blocksRemainingPayment: boolean;
    }
  | { status: 'campaign_not_found' }
  | { status: 'review_not_open' }
  | { status: 'already_decided'; outcome: string }
  | { status: 'inconsistent'; problem: string }
  | { status: 'unknown_failure_reason'; reason: string }
  | { status: 'raw_provider_code_in_explanation' };

/**
 * §22.4's decision, recorded once.
 *
 * The outcome and the findings cannot disagree — `day14OutcomeIsConsistent`
 * refuses first by name and the 0034 CHECKs refuse regardless, so a "pass" with
 * no adequate progress evidence and a "fail" with no reason are both
 * unrecordable. §29.4's rule holds: the customer explanation must name actual
 * behaviour and evidence, and a raw provider or fraud code in it is refused at
 * the point an Admin can still fix it (§33.9.11, 16a's check reused).
 *
 * The consequences are STORED on the review, from the type-specific register,
 * so what a failure meant for this campaign is readable years later without
 * re-deriving it from a type that cannot change but a register that might.
 */
export async function decideDay14Review(
  deps: Day14Deps,
  input: {
    campaignId: string;
    outcome: Day14Outcome;
    adequateProgressEvidence: boolean;
    requiredCommunication: boolean;
    failureReasons?: readonly string[];
    internalReason: string;
    customerExplanation: string;
    actor: string;
    now?: Date;
  },
): Promise<DecideDay14Outcome> {
  const facts = await loadFulfillmentFacts(deps.db, input.campaignId);
  if (!facts) return { status: 'campaign_not_found' };

  const review = await readDay14Review(deps.db, input.campaignId);
  if (!review) return { status: 'review_not_open' };
  if (review.outcome !== 'pending') return { status: 'already_decided', outcome: review.outcome };

  const reasons = (input.failureReasons ?? []) as Day14FailureReason[];
  for (const reason of reasons) {
    if (!DAY_14_FAILURE_REASONS.includes(reason)) {
      return { status: 'unknown_failure_reason', reason };
    }
  }

  const consistency = day14OutcomeIsConsistent({
    outcome: input.outcome,
    adequateProgressEvidence: input.adequateProgressEvidence,
    requiredCommunication: input.requiredCommunication,
    failureReasons: reasons,
  });
  if (!consistency.ok) return { status: 'inconsistent', problem: consistency.problem };

  if (containsRawProviderCode(input.customerExplanation)) {
    return { status: 'raw_provider_code_in_explanation' };
  }

  const now = input.now ?? new Date();
  const consequences =
    input.outcome === 'fail' ? day14FailureConsequences(facts.campaignType) : [];

  const decided = await deps.db.transaction(async (tx) => {
    const moved = await tx
      .update(day14Reviews)
      .set({
        outcome: input.outcome,
        adequateProgressEvidence: input.adequateProgressEvidence,
        requiredCommunication: input.requiredCommunication,
        failureReasons: reasons,
        internalReason: input.internalReason,
        customerExplanation: input.customerExplanation,
        consequences,
        decidedBy: input.actor,
        decidedAt: now,
      })
      .where(and(eq(day14Reviews.id, review.id), eq(day14Reviews.outcome, 'pending')))
      .returning();
    if (moved.length !== 1) return null;

    await deps.audit(
      {
        action: `day_14.${input.outcome}`,
        targetType: 'campaign',
        targetId: input.campaignId,
        actorId: input.actor,
        internalReason: input.internalReason,
        customerExplanation: input.customerExplanation,
        priorValue: { outcome: 'pending' },
        newValue: {
          outcome: input.outcome,
          failureReasons: reasons.map((r) => DAY_14_FAILURE_LABELS[r]),
          consequences: consequences.map((c) => c.key),
          campaignType: facts.campaignType,
        },
      });

    return moved[0]!;
  });

  if (!decided) return { status: 'already_decided', outcome: 'unknown' };

  await notifyDay14Result(deps, { review: decided, campaignType: facts.campaignType });

  return {
    status: 'decided',
    outcome: input.outcome,
    consequences,
    // §22.4: only the Product branch has an unreleased payment to block, and the
    // block is the derived read in `payment-block.ts`, not a flag written here.
    blocksRemainingPayment:
      input.outcome === 'fail' && day14BlocksAPayment(facts.campaignType),
  };
}

/* ── The Admin queue and the sweep ─────────────────────────────────────────── */

export interface Day14QueueRow {
  campaignId: string;
  campaignTitle: string | null;
  campaignType: CampaignType;
  reviewId: string;
  dueAt: string;
  overdue: boolean;
  outcome: string;
  submissionCount: number;
  latestSubmissionAt: string | null;
  openClarifications: number;
  overdueClarifications: number;
  /** §22.4's second failure reason, computed so an Admin does not count days. */
  daysSinceLastUpdate: number | null;
  noSubstantiveUpdateInSevenDays: boolean;
  blocksAPayment: boolean;
}

/**
 * The Day 14 queue. Overdue first — 16b's rule: a deadline nobody can see
 * breached is a deadline that gets breached.
 */
export async function readDay14Queue(
  db: Database,
  now: Date = new Date(),
): Promise<Day14QueueRow[]> {
  const rows = await db
    .select({
      reviewId: day14Reviews.id,
      campaignId: day14Reviews.campaignId,
      dueAt: day14Reviews.dueAt,
      outcome: day14Reviews.outcome,
      campaignType: sql<string | null>`${campaigns.type}::text`,
    })
    .from(day14Reviews)
    .innerJoin(campaigns, eq(campaigns.id, day14Reviews.campaignId))
    .where(eq(day14Reviews.outcome, 'pending'))
    .orderBy(asc(day14Reviews.dueAt));

  const out: Day14QueueRow[] = [];
  for (const row of rows) {
    if (!row.campaignType) continue;
    const checklist = await readDay14Checklist(db, row.campaignId, now);
    const [{ title }] = await db
      .select({ title: sql<string | null>`(select title from campaign_build where campaign_id = ${row.campaignId})` })
      .from(campaigns)
      .where(eq(campaigns.id, row.campaignId))
      .limit(1);

    const [lastUpdate] = await db
      .select({ publishedAt: campaignUpdates.publishedAt })
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, row.campaignId))
      .orderBy(desc(campaignUpdates.publishedAt))
      .limit(1);

    const daysSinceLastUpdate = lastUpdate
      ? Math.floor((now.getTime() - lastUpdate.publishedAt.getTime()) / DAY_MS)
      : null;

    out.push({
      campaignId: row.campaignId,
      campaignTitle: title ?? null,
      campaignType: row.campaignType as CampaignType,
      reviewId: row.reviewId,
      dueAt: row.dueAt.toISOString(),
      overdue: now.getTime() > row.dueAt.getTime(),
      outcome: row.outcome,
      submissionCount: checklist?.submissions.length ?? 0,
      latestSubmissionAt: checklist?.submissions[0]?.submittedAt ?? null,
      openClarifications: (checklist?.clarifications ?? []).filter((c) => !c.respondedAt).length,
      overdueClarifications: (checklist?.clarifications ?? []).filter((c) => c.overdue).length,
      daysSinceLastUpdate,
      // §22.4's own words. Computed, so "no substantive update in the prior
      // seven days" is a fact on the queue rather than an Admin's arithmetic.
      noSubstantiveUpdateInSevenDays:
        daysSinceLastUpdate === null || daysSinceLastUpdate > DAY_14_RECENT_UPDATE_DAYS,
      blocksAPayment: day14BlocksAPayment(row.campaignType as CampaignType),
    });
  }

  return out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueAt.localeCompare(b.dueAt);
  });
}

/**
 * Opens every due review and sends §27.6's internal notice once per campaign.
 * Independently idempotent: the review row is unique per campaign and the
 * notice dedups, so running the sweep twice changes nothing.
 */
export async function sweepDay14Reviews(
  deps: Day14Deps,
  input: { now?: Date; internalRecipient?: string } = {},
): Promise<{ opened: number; noticed: number }> {
  const now = input.now ?? new Date();

  const candidates = await deps.db
    .select({ id: campaigns.id, closeAt: campaigns.campaignCloseAt })
    .from(campaigns)
    .where(
      inArray(campaigns.status, [
        'closed_reconciling',
        'captured_pending_w9',
        'single_payment_released',
        'first_payment_released',
        'day_14_review',
        'remaining_payment_released',
      ] as never[]),
    );

  let opened = 0;
  let noticed = 0;
  for (const campaign of candidates) {
    if (!campaign.closeAt) continue;
    const dueAt = day14DueAt(campaign.closeAt);
    if (now.getTime() < dueAt.getTime()) continue;

    const result = await openDay14Review(deps, { campaignId: campaign.id, now });
    if (result.status === 'opened') opened += 1;
    if (result.status !== 'opened' && result.status !== 'already_open') continue;
    if (result.review.outcome !== 'pending') continue;

    if (input.internalRecipient) {
      await notifyDay14Due(deps, {
        campaignId: campaign.id,
        dueAt,
        internalRecipient: input.internalRecipient,
      });
      noticed += 1;
    }
  }

  return { opened, noticed };
}
