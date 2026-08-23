import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import {
  campaignApplicationChangeRequests,
  campaignApplicationReviews,
} from '../db/schema/admin-founder-panel.js';
import type { AuditWriter } from '../auth/audit.js';

export interface FounderApplicationReviewState {
  required: boolean;
  mayContinue: boolean;
  review: {
    id: string;
    round: number;
    outcome: string;
    submittedAt: string;
    decidedAt: string | null;
    customerExplanation: string | null;
    changeRequests: Array<{
      fieldKey: string;
      reason: string;
      requestedAt: string;
      resolvedAt: string | null;
    }>;
  } | null;
}

export async function readFounderApplicationReview(
  db: Database,
  campaignId: string,
): Promise<FounderApplicationReviewState | null> {
  const [campaign] = await db
    .select({ required: campaigns.applicationReviewRequired })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;

  const [review] = await db
    .select()
    .from(campaignApplicationReviews)
    .where(eq(campaignApplicationReviews.campaignId, campaignId))
    .orderBy(desc(campaignApplicationReviews.round))
    .limit(1);
  const requests = review
    ? await db
        .select()
        .from(campaignApplicationChangeRequests)
        .where(eq(campaignApplicationChangeRequests.reviewId, review.id))
        .orderBy(desc(campaignApplicationChangeRequests.requestedAt))
    : [];

  return {
    required: campaign.required,
    mayContinue: !campaign.required || review?.outcome === 'approved',
    review: review
      ? {
          id: review.id,
          round: review.round,
          outcome: review.outcome,
          submittedAt: review.openedAt.toISOString(),
          decidedAt: review.decidedAt?.toISOString() ?? null,
          customerExplanation: review.customerExplanation,
          changeRequests: requests.map((request) => ({
            fieldKey: request.fieldKey,
            reason: request.reason,
            requestedAt: request.requestedAt.toISOString(),
            resolvedAt: request.resolvedAt?.toISOString() ?? null,
          })),
        }
      : null,
  };
}

/** Opens the first Founder-submitted round. Repeated submissions are safe. */
export async function submitFounderApplicationReview(
  db: Database,
  audit: AuditWriter,
  input: { campaignId: string; founderUserId: string },
): Promise<{ state: FounderApplicationReviewState | null; submitted: boolean }> {
  const before = await readFounderApplicationReview(db, input.campaignId);
  if (!before) return { state: null, submitted: false };
  if (!before.required) {
    await db
      .update(campaigns)
      .set({ workflowStageReached: 'fee' })
      .where(
        and(
          eq(campaigns.id, input.campaignId),
          inArray(campaigns.workflowStageReached, ['invite', 'onboarding', 'review']),
        ),
      );
    return {
      state: await readFounderApplicationReview(db, input.campaignId),
      submitted: false,
    };
  }
  if (before.review?.outcome === 'approved') return { state: before, submitted: false };

  const [campaign] = await db
    .select({ status: campaigns.status, reached: campaigns.workflowStageReached })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (
    !campaign ||
    !['vetting_submitted', 'account_claimed'].includes(campaign.status) ||
    !['onboarding', 'review'].includes(campaign.reached)
  ) {
    return { state: before, submitted: false };
  }

  const mayOpen = !before.review || before.review.outcome === 'changes_requested';
  if (!mayOpen) return { state: before, submitted: false };
  const round = (before.review?.round ?? 0) + 1;

  const [created] = await db
    .insert(campaignApplicationReviews)
    .values({ campaignId: input.campaignId, round, outcome: 'waiting' })
    .onConflictDoNothing()
    .returning({ id: campaignApplicationReviews.id });

  if (created) {
    if (round > 1) {
      await db
        .update(campaignApplicationChangeRequests)
        .set({ resolvedAt: new Date() })
        .where(
          and(
            eq(campaignApplicationChangeRequests.campaignId, input.campaignId),
            isNull(campaignApplicationChangeRequests.resolvedAt),
          ),
        );
    }
    await db
      .update(campaigns)
      .set({ workflowStageReached: 'review' })
      .where(eq(campaigns.id, input.campaignId));
    await audit({
      action: 'campaign.application_review_submitted',
      targetType: 'campaign',
      targetId: input.campaignId,
      actorId: input.founderUserId,
      internalReason:
        round === 1
          ? 'The Founder submitted the required application for Admin review.'
          : `The Founder resubmitted the required application as round ${round}.`,
      newValue: { round, outcome: 'waiting' },
    });
  }
  return {
    state: await readFounderApplicationReview(db, input.campaignId),
    submitted: Boolean(created),
  };
}

export async function applicationReviewBlocksListing(
  db: Database,
  campaignId: string,
): Promise<boolean> {
  const state = await readFounderApplicationReview(db, campaignId);
  return state?.required === true && !state.mayContinue;
}
