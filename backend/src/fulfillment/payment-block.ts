/**
 * The §22.4 Day-14 payment block — Spec §22.4, §33.10.3 (Phase 21a).
 *
 * §22.4's Product failure consequence begins "block unreleased remaining
 * payment". This is 20b's `campaignEnforcementHold` shape applied to a
 * different fact: the block is DERIVED from the recorded review, so there is no
 * flag to set, no flag to forget to clear, and no way for the block to disagree
 * with the decision that caused it.
 *
 * Two properties matter and both are structural rather than remembered:
 *
 *   * it blocks the REMAINING payment only. §22.4 says "unreleased remaining
 *     payment"; a first payment already released is not unreleased, and
 *     recovering it is §22.4's separate best-effort line, which is an
 *     Admin-recorded §24.8 case (20a) and never an automatic reversal;
 *   * it cannot exist on an Idea campaign, because §22.4 says an Idea review is
 *     enforcement-only — there is no second payment. `day14BlocksAPayment`
 *     gates it, so §33.10.3's per-type difference holds at the money edge and
 *     not only in the copy.
 */

import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { day14Reviews } from '../db/schema/fulfillment.js';
import { DAY_14_FAILURE_LABELS, day14BlocksAPayment, type CampaignType, type Day14FailureReason } from './logic.js';

export interface Day14Block {
  blocked: boolean;
  /** Which payment kinds the block applies to. Empty when nothing is blocked. */
  kinds: readonly ('remaining_payment' | 'single_payment' | 'first_payment')[];
  /** §22.4's own words for what was found — never a bare "blocked". */
  reasons: readonly string[];
  reviewId: string | null;
  decidedAt: Date | null;
  /** The named requirement a surface renders. Null when nothing is blocked. */
  blocker: string | null;
}

const NOT_BLOCKED: Day14Block = {
  blocked: false,
  kinds: [],
  reasons: [],
  reviewId: null,
  decidedAt: null,
  blocker: null,
};

type Executor = Pick<Database, 'select'>;

/**
 * Reads the block. Called by `createFounderPayment` and `releaseFounderPayment`
 * before either writes, and by `readFounderPaymentStatus` so the Founder reads
 * the same named requirement the refusal uses (19b's one-source rule).
 */
export async function day14PaymentBlock(
  db: Executor,
  campaignId: string,
): Promise<Day14Block> {
  const [campaign] = await db
    .select({ type: sql<string | null>`${campaigns.type}::text` })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign?.type) return NOT_BLOCKED;
  if (!day14BlocksAPayment(campaign.type as CampaignType)) return NOT_BLOCKED;

  const [review] = await db
    .select({
      id: day14Reviews.id,
      outcome: day14Reviews.outcome,
      failureReasons: day14Reviews.failureReasons,
      decidedAt: day14Reviews.decidedAt,
    })
    .from(day14Reviews)
    .where(eq(day14Reviews.campaignId, campaignId))
    .limit(1);

  if (!review || review.outcome !== 'fail') return NOT_BLOCKED;

  const reasons = (review.failureReasons as Day14FailureReason[]).map(
    (r) => DAY_14_FAILURE_LABELS[r] ?? r,
  );

  return {
    blocked: true,
    kinds: ['remaining_payment'],
    reasons,
    reviewId: review.id,
    decidedAt: review.decidedAt,
    blocker: `The Day 14 Progress Check did not pass: ${reasons.join('; ')}. §22.4 blocks the unreleased remaining payment.`,
  };
}
