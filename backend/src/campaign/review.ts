/**
 * Review readiness, submission, and Admin review — Spec §15, §23.1, §33.3.10,
 * §33.4.1.
 *
 * ── `review_ready` is derived, and the submit gate reads it ─────────────────
 * `review_ready` follows the Campaign Setup build and is never stored.
 * Matching remains visible as its own stage, but it does not block submission.
 *
 * ── Changes preserve all valid work ─────────────────────────────────────────
 * §15: "Changes required: set `changes_required`, preserve all valid work,
 * group feedback into `Required before resubmission` and `Optional
 * improvements`, deep-link to affected content." Nothing is deleted on a
 * changes-required outcome — the feedback is additive rows, and the build,
 * roster, agreements, and readiness all survive for the resubmission.
 *
 * ── Approval preserves an immutable version ─────────────────────────────────
 * §15: "preserve immutable approved campaign/Creator terms version". The
 * snapshot table is insert-only and immutable by trigger, so an approval is a
 * durable record of exactly what was approved.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  campaignReviews,
  reviewFeedbackItems,
  approvedCampaignSnapshots,
  type CampaignReview,
  type ReviewFeedbackItem,
} from '../db/schema/build.js';
import { associationCompensationAgreements } from '../db/schema/decisions.js';
import { deriveReviewReady } from './logic.js';
import type { AuditWriter } from '../auth/audit.js';
import { readBuild } from './service.js';
import { evaluateRosterReadiness } from './readiness.js';
import {
  notifyReviewSubmitted,
  notifyChangesRequired,
  notifyCampaignApproved,
  type ReviewNotifyDeps,
} from './review-notifications.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/* ── Review readiness (§23.2, §33.3.10) ────────────────────────────────────── */

export interface ReviewReadinessView {
  rosterStatus: 'forming' | 'launch_ready' | 'failed';
  buildStatus: 'not_started' | 'in_progress' | 'complete';
  reviewReady: boolean;
}

export async function readReviewReadiness(
  db: Database,
  campaign: { campaignId: string; campaignType: 'pre_build' | 'pre_launch' },
): Promise<ReviewReadinessView> {
  // Recompute the roster from its inputs so the answer never trails a stale
  // stored status (§33.3.10's rule about derivation, applied to the roster).
  const roster = await evaluateRosterReadiness(db, campaign.campaignId);
  const build = await readBuild(db, campaign);
  return {
    rosterStatus: roster.rosterStatus,
    buildStatus: build.buildStatus,
    // Matching is reported independently but does not gate campaign review.
    reviewReady: deriveReviewReady(roster.rosterStatus, build.buildStatus),
  };
}

/* ── Submission (§15: "Founder can submit only then") ──────────────────────── */

export type SubmitOutcome =
  | { ok: true; review: CampaignReview }
  | { ok: false; code: 'not_ready' | 'already_submitted'; message: string; next: string; readiness?: ReviewReadinessView };

export async function submitForReview(
  db: Database,
  deps: { audit: AuditWriter } & Omit<ReviewNotifyDeps, 'db'>,
  input: {
    campaignId: string;
    campaignType: 'pre_build' | 'pre_launch';
    campaignStatus: string;
    actor: string;
  },
): Promise<SubmitOutcome> {
  const readiness = await readReviewReadiness(db, input);
  if (!readiness.reviewReady) {
    return {
      ok: false,
      code: 'not_ready',
      message: 'This campaign is not ready to submit yet.',
      next: 'Finish the required Campaign Setup fields before submitting for review.',
      readiness,
    };
  }
  if (input.campaignStatus !== 'affiliate_response_and_build' && input.campaignStatus !== 'changes_required') {
    return {
      ok: false,
      code: 'already_submitted',
      message: 'This campaign has already been submitted.',
      next: 'Your reviewer will be in touch.',
    };
  }

  const review = await db.transaction(async (tx) => {
    const [{ round }] = await tx
      .select({ round: campaignReviews.round })
      .from(campaignReviews)
      .where(eq(campaignReviews.campaignId, input.campaignId))
      .orderBy(desc(campaignReviews.round))
      .limit(1)
      .then((rows) => (rows.length ? rows : [{ round: 0 }]));

    const [inserted] = await tx
      .insert(campaignReviews)
      .values({
        campaignId: input.campaignId,
        round: (round ?? 0) + 1,
        submittedBy: input.actor,
      })
      .returning();

    const moved = await tx
      .update(campaigns)
      .set({ status: 'pending_review', updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, input.campaignId),
          eq(campaigns.status, input.campaignStatus as 'affiliate_response_and_build'),
        ),
      )
      .returning({ id: campaigns.id });
    if (moved.length === 1) {
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: input.campaignStatus as 'affiliate_response_and_build',
        toStatus: 'pending_review',
        actor: input.actor,
      });
    }
    return inserted!;
  });

  await deps.audit({
    action: 'review.submitted',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `Founder submitted for review (round ${review.round})`,
    actorId: input.actor,
  });

  // After the transaction, on 08c's precedent: the messages dedup on the review
  // row, so a crash between the two costs a retry rather than correctness, and
  // holding a row lock across a provider call would be a more expensive way to
  // be no safer.
  await notifyReviewSubmitted({ db, ...deps }, { campaignId: input.campaignId, review });

  return { ok: true, review };
}

/* ── Admin review decision (§15) ───────────────────────────────────────────── */

export interface FeedbackItemInput {
  group: 'required' | 'optional';
  area: string;
  body: string;
  deepLink: string;
  owner: string;
  dueExpectation?: string | undefined;
  enforcementInvolved?: boolean;
}

export type ReviewDecisionOutcome =
  | { ok: true; outcome: 'approved' | 'changes_required'; review: CampaignReview }
  | { ok: false; code: 'no_pending_review'; message: string };

/** Finds the campaign's open review round, or null. */
async function openReview(db: Executor, campaignId: string): Promise<CampaignReview | null> {
  const [row] = await db
    .select()
    .from(campaignReviews)
    .where(and(eq(campaignReviews.campaignId, campaignId), eq(campaignReviews.outcome, 'pending')))
    .limit(1);
  return row ?? null;
}

/**
 * §15 Approved: preserve an immutable approved campaign/Creator terms version
 * and move to `approved`.
 */
export async function approveReview(
  db: Database,
  deps: { audit: AuditWriter } & Omit<ReviewNotifyDeps, 'db'>,
  input: { campaignId: string; reviewer: string; actor: string },
): Promise<ReviewDecisionOutcome> {
  const review = await openReview(db, input.campaignId);
  if (!review) {
    return { ok: false, code: 'no_pending_review', message: 'This campaign has no review awaiting a decision.' };
  }

  const decided = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: campaigns.status, type: campaigns.type })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .for('update')
      .limit(1);

    // The immutable approved version: the build and the locked Creator terms.
    const build = await readBuild(tx, {
      campaignId: input.campaignId,
      campaignType: campaign!.type!,
    });
    const agreements = await tx
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.campaignId, input.campaignId));

    // JSONB cannot hold a bigint, so the money fields are serialized to
    // strings — the same integer-cents value, in a form JSON can carry.
    await tx.insert(approvedCampaignSnapshots).values({
      campaignId: input.campaignId,
      reviewId: review.id,
      snapshot: {
        build: build.build
          ? {
              ...build.build,
              internalTargetCents: build.build.internalTargetCents?.toString() ?? null,
              opensAt: build.build.opensAt?.toISOString() ?? null,
              closesAt: build.build.closesAt?.toISOString() ?? null,
              updatedAt: build.build.updatedAt.toISOString(),
              createdAt: build.build.createdAt.toISOString(),
            }
          : null,
        rewardPackages: build.rewardPackages.map((r) => ({
          sku: r.sku,
          title: r.title,
          priceCents: r.priceCents.toString(),
          contents: r.contents,
          fulfillmentCommitment: r.fulfillmentCommitment,
          delivery: r.delivery,
          limitedQuantity: r.limitedQuantity,
        })),
        faqs: build.faqs.map((f) => ({ question: f.question, answer: f.answer })),
      },
      creatorTerms: agreements.map((a) => ({
        associationId: a.associationId,
        source: a.source,
        totalPercent: a.totalPercent,
        fixedPaymentCents: a.fixedPaymentCents?.toString() ?? null,
      })),
      approvedBy: input.actor,
    });

    const [updated] = await tx
      .update(campaignReviews)
      .set({ outcome: 'approved', reviewer: input.reviewer, decidedAt: new Date(), decidedBy: input.actor })
      .where(eq(campaignReviews.id, review.id))
      .returning();

    if (campaign?.status === 'pending_review') {
      await tx
        .update(campaigns)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'pending_review')));
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: 'pending_review',
        toStatus: 'approved',
        actor: input.actor,
      });
    }
    return updated!;
  });

  await deps.audit({
    action: 'review.approved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: 'Admin approved the campaign; immutable approved version preserved (§15)',
    actorId: input.actor,
  });

  await notifyCampaignApproved({ db, ...deps }, { campaignId: input.campaignId, review: decided });

  return { ok: true, outcome: 'approved', review: decided };
}

/**
 * §15 Changes required: set `changes_required`, preserve all valid work, and
 * record the grouped, deep-linked feedback. Nothing is deleted (§33.4.1).
 */
export async function requireChanges(
  db: Database,
  deps: { audit: AuditWriter } & Omit<ReviewNotifyDeps, 'db'>,
  input: {
    campaignId: string;
    reviewer: string;
    nextUpdateExpectation?: string | undefined;
    feedback: FeedbackItemInput[];
    actor: string;
  },
): Promise<ReviewDecisionOutcome> {
  const review = await openReview(db, input.campaignId);
  if (!review) {
    return { ok: false, code: 'no_pending_review', message: 'This campaign has no review awaiting a decision.' };
  }

  const decided = await db.transaction(async (tx) => {
    for (const item of input.feedback) {
      await tx.insert(reviewFeedbackItems).values({
        reviewId: review.id,
        campaignId: input.campaignId,
        feedbackGroup: item.group,
        area: item.area.slice(0, 500),
        body: item.body.slice(0, 20000),
        deepLink: item.deepLink.slice(0, 2000),
        owner: item.owner,
        dueExpectation: item.dueExpectation ?? null,
        enforcementInvolved: item.enforcementInvolved ?? false,
      });
    }

    const [updated] = await tx
      .update(campaignReviews)
      .set({
        outcome: 'changes_required',
        reviewer: input.reviewer,
        nextUpdateExpectation: input.nextUpdateExpectation ?? null,
        decidedAt: new Date(),
        decidedBy: input.actor,
      })
      .where(eq(campaignReviews.id, review.id))
      .returning();

    const [campaign] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .limit(1);
    if (campaign?.status === 'pending_review') {
      await tx
        .update(campaigns)
        .set({ status: 'changes_required', updatedAt: new Date() })
        .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'pending_review')));
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: 'pending_review',
        toStatus: 'changes_required',
        actor: input.actor,
      });
    }
    return updated!;
  });

  await deps.audit({
    action: 'review.changes_required',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `Admin returned ${input.feedback.length} feedback item(s); all valid work preserved (§15)`,
    actorId: input.actor,
  });

  await notifyChangesRequired({ db, ...deps }, { campaignId: input.campaignId, review: decided });

  return { ok: true, outcome: 'changes_required', review: decided };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function listReviews(db: Database, campaignId: string): Promise<CampaignReview[]> {
  return db
    .select()
    .from(campaignReviews)
    .where(eq(campaignReviews.campaignId, campaignId))
    .orderBy(desc(campaignReviews.round));
}

export async function listFeedback(db: Database, reviewId: string): Promise<ReviewFeedbackItem[]> {
  return db
    .select()
    .from(reviewFeedbackItems)
    .where(eq(reviewFeedbackItems.reviewId, reviewId))
    .orderBy(reviewFeedbackItems.feedbackGroup, reviewFeedbackItems.createdAt);
}

/** The latest review with its feedback, for the Founder's changes surface. */
export async function readLatestReview(
  db: Database,
  campaignId: string,
): Promise<{ review: CampaignReview; feedback: ReviewFeedbackItem[] } | null> {
  const [review] = await db
    .select()
    .from(campaignReviews)
    .where(eq(campaignReviews.campaignId, campaignId))
    .orderBy(desc(campaignReviews.round))
    .limit(1);
  if (!review) return null;
  const feedback = await listFeedback(db, review.id);
  return { review, feedback };
}
