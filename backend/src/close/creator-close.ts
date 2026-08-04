/**
 * The Creator close view — Spec §21, §22.1, §27.4, Appendix B.7 (Phase 18b).
 *
 * §21: "Affiliate close surface/notification shows content verified,
 * attributed pre-orders/capture, estimated/final earnings, next review date,
 * and a factual thank-you without public ranking."
 *
 * ── Estimated is now a number, and it is still not final ────────────────────
 * Phase 17b deliberately rendered no B.7 — nothing had been captured, so
 * "US$0.00 recorded" would have read as "you earned nothing". After close
 * there IS a captured, attributed subtotal, so the block renders with the
 * estimated amount — the locked percentage over captured attributed pre-tax
 * subtotal (§22.1's base) — and says plainly why it is not paid yet:
 * finalization is §22.1's verification, Phase 19's work. The bonus is reported
 * as pending for the same reason; its earned result does not exist until a
 * person verifies the trigger (§14.3).
 *
 * ── No ranking, structurally ────────────────────────────────────────────────
 * Nothing in this view reads another association's rows. There is no rank, no
 * percentile, no "top Creator" — §30 forbids public leaderboards and the
 * absence of the query is the enforcement.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { associationCompensationAgreements, creatorBonuses } from '../db/schema/decisions.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { findAllocation } from '../creator-payment/allocations.js';
import { formatCents } from '../reservations/restated.js';
import {
  EARNINGS_STATE_LABELS,
  NO_ACTION_NEEDED,
  resolveAffiliateMoneyStatus,
} from '../campaign/editing-logic.js';
import { percentOfCents } from './logic.js';

/** §21/§22.3 anchor: Day N after close is close + N calendar days. */
export function dayAfterClose(closeAt: Date, day: number): Date {
  return new Date(closeAt.getTime() + day * 24 * 60 * 60 * 1000);
}

export interface CreatorCloseView {
  associationId: string;
  campaignId: string;
  campaignTitle: string;
  /** The campaign's close outcome, as a lifecycle fact. */
  campaignStatus: string;
  closedAt: string | null;

  /** §21: content verified — the first-post verification, stated as a fact. */
  contentVerified: { status: string | null; line: string };

  /** §21: attributed pre-orders and captures — this Creator's own only. */
  attributed: {
    preorders: number;
    captured: number;
    capturedSubtotalCents: string;
  };

  /** §21/§22.1: estimated earnings now, final earnings pending Phase 19. */
  earnings: {
    state: 'estimated';
    label: string;
    lockedPercent: number | null;
    estimatedCents: string;
    reason: string;
    nextUpdate: string;
    action: string;
    /** Appendix B.7, rendered server-side — the same block the email carries. */
    statusBlock: string;
    finalization: 'pending';
    finalizationNote: string;
  };

  bonus: { recorded: number; finalization: 'pending'; note: string } | null;

  fixedPayment:
    | { applicable: true; status: string; amountCents: string }
    | { applicable: false };

  /** §22.1: Admin creates the Transfer on or after Day 3. */
  nextReviewAt: string | null;
  nextReviewLine: string;

  /** §21: a factual thank-you without public ranking (§30). */
  thankYou: string;
}

/** §21's thank-you — factual, and explicitly not a leaderboard (§30). */
export const CREATOR_CLOSE_THANK_YOU =
  'Thank you for the work you put into this campaign. What happens next is verification and reconciliation, not a leaderboard — your results are your own.';

const CONTENT_LINES: Record<string, string> = {
  passed: 'Content verified: your first post passed verification.',
  submitted: 'Content verification: your first post is submitted and awaiting verification.',
  correction_needed:
    'Content verification: a correction was requested on your first post and is still open.',
  rejected: 'Content verification: your first post was rejected. Support can walk you through it.',
};

export type CreatorCloseResult =
  | { ok: true; view: CreatorCloseView }
  | { ok: false; code: 'not_found' | 'not_closed' };

/** The lifecycle states at which a campaign's charge outcomes exist to report. */
const CLOSED_STATUSES = new Set([
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'ended_no_charge',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
]);

export async function readCreatorClose(
  db: Database,
  input: { associationId: string },
): Promise<CreatorCloseResult> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { ok: false, code: 'not_found' };

  const [campaign] = await db
    .select({ status: campaigns.status, closeAt: campaigns.campaignCloseAt })
    .from(campaigns)
    .where(eq(campaigns.id, association.campaignId))
    .limit(1);
  if (!campaign || !CLOSED_STATUSES.has(campaign.status)) {
    return { ok: false, code: 'not_closed' };
  }

  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, association.campaignId))
    .limit(1);

  const [submission] = await db
    .select({ status: creatorPostSubmissions.status })
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.associationId, association.id))
    .orderBy(desc(creatorPostSubmissions.submittedAt))
    .limit(1);

  // This Creator's own attribution only — never a comparison (§30).
  const [attributed] = await db
    .select({
      preorders: sql<number>`count(*)::int`,
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      capturedSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} = 'captured'), 0)::text`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, association.campaignId),
        eq(reservations.attributionAssociationId, association.id),
      ),
    );

  const [agreement] = await db
    .select({ totalPercent: associationCompensationAgreements.totalPercent })
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, association.id))
    .limit(1);

  const bonuses = await db
    .select({ id: creatorBonuses.id })
    .from(creatorBonuses)
    .where(eq(creatorBonuses.associationId, association.id));

  const allocation = await findAllocation(db, association.id);

  const capturedSubtotal = BigInt(attributed?.capturedSubtotal ?? '0');
  const lockedPercent = agreement?.totalPercent ?? null;
  const estimatedCents =
    lockedPercent !== null ? percentOfCents(capturedSubtotal, lockedPercent) : 0n;

  const nextReviewAt = campaign.closeAt ? dayAfterClose(campaign.closeAt, 3) : null;
  const nextReviewLine = nextReviewAt
    ? `Next review: Proovd finalizes Creator earnings and creates payments on or after ${nextReviewAt.toISOString().slice(0, 10)} (Day 3 after close), once deliverables are verified.`
    : 'Next review: Proovd finalizes Creator earnings once deliverables are verified after close.';

  // §22.1: estimated until verification finalizes it — the reason is stated,
  // never implied (§1.4). The window/bonus caveat keeps the estimate honest.
  const reason =
    campaign.status === 'ended_no_charge'
      ? 'The campaign closed without any charge, so there is no commission to pay.'
      : 'Earnings are estimated from captured charges attributed to your link. They finalize after the payment window ends and Proovd verifies your deliverables (§22.1) — a bonus you qualified for can still raise this number.';

  const statusBlock = resolveAffiliateMoneyStatus({
    amount: formatCents(estimatedCents),
    state: 'estimated',
    reason,
    nextUpdate: nextReviewAt
      ? `On or after ${nextReviewAt.toISOString().slice(0, 10)}`
      : 'After deliverable verification',
    action: NO_ACTION_NEEDED,
  });

  return {
    ok: true,
    view: {
      associationId: association.id,
      campaignId: association.campaignId,
      campaignTitle: build?.title ?? 'the campaign',
      campaignStatus: campaign.status,
      closedAt: campaign.closeAt?.toISOString() ?? null,
      contentVerified: {
        status: submission?.status ?? null,
        line: submission?.status
          ? (CONTENT_LINES[submission.status] ?? `Content verification: ${submission.status}.`)
          : 'Content verification: no first-post submission was recorded.',
      },
      attributed: {
        preorders: Number(attributed?.preorders ?? 0),
        captured: Number(attributed?.captured ?? 0),
        capturedSubtotalCents: capturedSubtotal.toString(),
      },
      earnings: {
        state: 'estimated',
        label: EARNINGS_STATE_LABELS.estimated,
        lockedPercent,
        estimatedCents: estimatedCents.toString(),
        reason,
        nextUpdate: nextReviewAt
          ? `On or after ${nextReviewAt.toISOString().slice(0, 10)}`
          : 'After deliverable verification',
        action: NO_ACTION_NEEDED,
        statusBlock,
        finalization: 'pending',
        finalizationNote:
          'Final earnings are recorded when Proovd verifies deliverables and finalizes results after the payment window — they are not final yet (§22.1).',
      },
      bonus:
        bonuses.length > 0
          ? {
              recorded: bonuses.length,
              finalization: 'pending',
              note: 'Your Creator-specific bonus is evaluated against your own captured results during finalization — it is not decided yet.',
            }
          : null,
      fixedPayment:
        allocation !== null
          ? {
              applicable: true,
              status: allocation.status,
              amountCents: allocation.amountCents.toString(),
            }
          : { applicable: false },
      nextReviewAt: nextReviewAt?.toISOString() ?? null,
      nextReviewLine,
      thankYou: CREATOR_CLOSE_THANK_YOU,
    },
  };
}
