/**
 * The listing-fee refund and the §31.6 cancellation — Spec §13, §14.6, §29.6,
 * §31.6, §33.3.8, §33.3.11.
 *
 * ── One refund path, shared by everything that refunds ──────────────────────
 * Phase 11's brief: "Build the refund path here so Phase 14 calls it rather
 * than inventing a second one." `refundListingFee` is that path. §13's three
 * promise triggers (Phase 12 evaluates the first two, Phase 14 the third), the
 * §31.6 free-window cancellation, and Admin's discretionary refund all call it;
 * each states which promise it is honouring, and nothing else moves this money.
 *
 * ── "The whole Checkout total, once" is three mechanisms ────────────────────
 * The refund row is unique on the payment (never twice), a database trigger
 * compares its amounts to the payment row (never partial), and the provider
 * call carries a stable idempotency key derived from the payment (a retry is
 * the same refund at Stripe too). §33.3.8 is those three, not a promise.
 *
 * ── The row lands before the provider call ──────────────────────────────────
 * §7's ordering, applied to money: claim the record, then call the provider,
 * then confirm. A crash between the two leaves an `initiated` row — visible,
 * honest, and retryable, and the retry reuses the same provider idempotency key
 * so Stripe refunds once no matter how many attempts it takes. The alternative
 * ordering leaves a refund with no record, which is money that moved outside
 * the ledger.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import {
  listingFeePayments,
  listingFeeRefunds,
  campaignCancellations,
  type ListingFeeRefund,
  type CampaignCancellation,
} from '../db/schema/listing.js';
import type { AuditWriter } from '../auth/audit.js';
import { recordProviderObject } from './provider-objects.js';
import type { StripeGateway } from './stripe-client.js';
import { findListingPayment } from './listing-checkout.js';

export type ListingRefundTrigger = (typeof listingFeeRefunds.trigger.enumValues)[number];

/* ── The refund path ──────────────────────────────────────────────────────── */

export type RefundOutcome =
  | { status: 'refunded'; refund: ListingFeeRefund; alreadyExisted: false }
  /** The single refund already exists. Idempotent success, not an error. */
  | { status: 'refunded'; refund: ListingFeeRefund; alreadyExisted: true }
  /** Claimed, and the provider refused. Visible, retryable. */
  | { status: 'initiated_unconfirmed'; refund: ListingFeeRefund; reason: string }
  | { status: 'not_paid' };

export interface RefundDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
}

/**
 * Refunds the entire Checkout charge — subtotal plus its tax reversal or
 * correction — to the original payment method, exactly once.
 */
export async function refundListingFee(
  deps: RefundDeps,
  input: {
    campaignId: string;
    trigger: ListingRefundTrigger;
    actor: string;
    internalReason: string;
    customerExplanation: string;
  },
): Promise<RefundOutcome> {
  const { db, gateway, audit } = deps;

  const payment = await findListingPayment(db, input.campaignId);
  if (!payment) return { status: 'not_paid' };

  // Claim the record first. The unique index on payment_id settles a race
  // between two callers; the loser reads the winner's row and reports it.
  let refund: ListingFeeRefund;
  let claimed = false;
  try {
    const [inserted] = await db
      .insert(listingFeeRefunds)
      .values({
        paymentId: payment.id,
        campaignId: input.campaignId,
        trigger: input.trigger,
        subtotalRefundedCents: payment.subtotalCents,
        taxRefundedCents: payment.taxCents,
        totalRefundedCents: payment.totalCents,
        actor: input.actor,
        internalReason: input.internalReason,
        customerExplanation: input.customerExplanation,
      })
      .returning();
    refund = inserted!;
    claimed = true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db
      .select()
      .from(listingFeeRefunds)
      .where(eq(listingFeeRefunds.paymentId, payment.id))
      .limit(1);
    refund = existing!;
  }

  if (!claimed) {
    // §28.3: a duplicate may update audit; it may never move money twice.
    await audit({
      action: 'listing.refund_duplicate_suppressed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `a second refund request (${input.trigger}) found the existing refund and changed nothing`,
    });
    // An unconfirmed claim is retried by the SAME provider call below rather
    // than reported as done — fall through only when confirmation is missing.
    if (refund.status === 'succeeded') {
      return { status: 'refunded', refund, alreadyExisted: true };
    }
  }

  if (!payment.paymentIntentId) {
    // A payment with no intent reference cannot be refunded by API. Recorded,
    // routed to a person; the claim stays visible as initiated.
    await audit({
      action: 'listing.refund_unconfirmed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason:
        'the payment record carries no payment-intent reference; the refund needs Admin follow-up at the provider',
    });
    return { status: 'initiated_unconfirmed', refund, reason: 'no payment intent reference' };
  }

  try {
    const provider = await gateway.createRefund({
      paymentIntentId: payment.paymentIntentId,
      amountCents: payment.totalCents,
      // Stable per payment: every retry is the same refund at Stripe.
      idempotencyKey: `listing-refund:${payment.id}`,
    });

    const [confirmed] = await db
      .update(listingFeeRefunds)
      .set({ status: 'succeeded', refundObjectId: provider.id, confirmedAt: new Date() })
      .where(eq(listingFeeRefunds.id, refund.id))
      .returning();

    await recordProviderObject(db, {
      mode: gateway.mode,
      objectType: 'refund',
      providerObjectId: provider.id,
      accountContext: 'platform',
      campaignId: input.campaignId,
      amountCents: payment.totalCents,
      amountTaxCents: payment.taxCents,
      status: provider.status,
      idempotencyKey: `listing-refund:${payment.id}`,
    });

    await audit({
      action: 'listing.refund_succeeded',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `${input.trigger}: full Checkout total refunded to the original payment method`,
      customerExplanation: input.customerExplanation,
      amountCents: payment.totalCents,
      currency: 'USD',
      providerObjectIds: { refundId: provider.id, paymentIntentId: payment.paymentIntentId },
    });

    return { status: 'refunded', refund: confirmed ?? refund, alreadyExisted: !claimed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db
      .update(listingFeeRefunds)
      .set({ failureMessage: reason })
      .where(eq(listingFeeRefunds.id, refund.id));
    await audit({
      action: 'listing.refund_unconfirmed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `the provider refused the refund call: ${reason}. The claim stays initiated and a retry reuses the same idempotency key.`,
    });
    return { status: 'initiated_unconfirmed', refund, reason };
  }
}

/* ── Founder cancellation (§31.6, §33.3.11) ───────────────────────────────── */

export type CancellationOutcome =
  | { status: 'canceled_and_refunded'; cancellation: CampaignCancellation; refund: RefundOutcome }
  /** Outside the free window or live: §31.6 sends it to a person. */
  | { status: 'admin_review'; cancellation: CampaignCancellation }
  | { status: 'already_pending'; cancellation: CampaignCancellation }
  | { status: 'not_paid' }
  | { status: 'already_canceled' };

/**
 * §31.6's decision, taken where the rule says it is taken:
 *
 *  - within the stored 48-hour deadline AND not live → cancel now, refund the
 *    entire Checkout charge including tax;
 *  - after the deadline, or live → a pending request an Admin decides, with no
 *    automatic refund.
 *
 * The deadline read is the one stored at payment (§29.6) — never recomputed
 * from settings, so a later settings change cannot reopen or shrink a window
 * that was already promised.
 */
export async function requestFounderCancellation(
  deps: RefundDeps,
  input: {
    campaignId: string;
    requestedBy: string;
    reason: string;
  },
): Promise<CancellationOutcome> {
  const { db, audit } = deps;

  const payment = await findListingPayment(db, input.campaignId);
  if (!payment) return { status: 'not_paid' };

  const [campaign] = await db
    .select({
      status: campaigns.status,
      campaignLiveAt: campaigns.campaignLiveAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign || campaign.status === 'ended_no_charge') return { status: 'already_canceled' };

  const now = new Date();
  const notLive = campaign.status !== 'live' && campaign.campaignLiveAt === null;
  const insideWindow = now.getTime() <= payment.freeCancellationDeadlineAt.getTime();

  if (notLive && insideWindow) {
    // The free path. Decision and lifecycle move together; the refund follows
    // the committed decision, and its own idempotency covers a crash between.
    const cancellation = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(campaignCancellations)
        .values({
          campaignId: input.campaignId,
          kind: 'free_window',
          status: 'canceled',
          requestedBy: input.requestedBy,
          decidedBy: input.requestedBy,
          decidedAt: now,
          internalReason: input.reason,
          customerExplanation:
            'You canceled within the free cancellation window, so the entire listing Checkout charge — ' +
            'including its sales tax — is refunded to your original payment method.',
        })
        .returning();

      // §31.6 pre-charge termination → §23.1's ended_no_charge.
      const moved = await tx
        .update(campaigns)
        .set({ status: 'ended_no_charge', updatedAt: now })
        .where(
          and(
            eq(campaigns.id, input.campaignId),
            eq(campaigns.status, 'affiliate_response_and_build'),
          ),
        )
        .returning({ id: campaigns.id });

      if (moved.length === 1) {
        await tx.insert(campaignStatusHistory).values({
          campaignId: input.campaignId,
          fromStatus: 'affiliate_response_and_build',
          toStatus: 'ended_no_charge',
          actor: input.requestedBy,
        });
      }

      return row!;
    });

    await audit({
      action: 'listing.founder_cancellation_free_window',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `Founder canceled inside the stored free window (deadline ${payment.freeCancellationDeadlineAt.toISOString()}): ${input.reason}`,
      customerExplanation: cancellation.customerExplanation,
    });

    const refund = await refundListingFee(deps, {
      campaignId: input.campaignId,
      trigger: 'founder_free_cancellation',
      actor: input.requestedBy,
      internalReason: 'automatic §31.6 free-window cancellation refund',
      customerExplanation: cancellation.customerExplanation,
    });

    // Link the refund the decision produced, when it produced one.
    if (refund.status === 'refunded' || refund.status === 'initiated_unconfirmed') {
      await db
        .update(campaignCancellations)
        .set({ refundId: refund.refund.id })
        .where(eq(campaignCancellations.id, cancellation.id));
    }

    return { status: 'canceled_and_refunded', cancellation, refund };
  }

  // §31.6: "After 48 hours, or after live: requires Admin approval. No
  // automatic refund." Recorded and routed to a person (§1.3, §1 rule 6).
  try {
    const [pending] = await db
      .insert(campaignCancellations)
      .values({
        campaignId: input.campaignId,
        kind: 'admin_review',
        status: 'pending',
        requestedBy: input.requestedBy,
        internalReason: input.reason,
        customerExplanation:
          'Your cancellation request is with our team for review. Cancellation at this stage needs ' +
          'approval, and no automatic refund applies.',
      })
      .returning();

    await audit({
      action: 'listing.founder_cancellation_requested',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `cancellation requested outside the free window (deadline was ${payment.freeCancellationDeadlineAt.toISOString()}; live: ${!notLive}): ${input.reason}`,
    });

    return { status: 'admin_review', cancellation: pending! };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db
      .select()
      .from(campaignCancellations)
      .where(
        and(
          eq(campaignCancellations.campaignId, input.campaignId),
          eq(campaignCancellations.status, 'pending'),
        ),
      )
      .limit(1);
    return { status: 'already_pending', cancellation: existing! };
  }
}

/* ── The Admin decision on a pending request (§31.6) ──────────────────────── */

export type CancellationDecisionOutcome =
  | { status: 'decided'; cancellation: CampaignCancellation }
  | { status: 'not_found' }
  | { status: 'already_decided' };

/**
 * Approves or denies a pending request. Approval cancels the campaign
 * (pre-charge termination) and deliberately refunds nothing — §31.6 gives a
 * late cancellation "no automatic refund", and a discretionary refund is
 * Admin's separate, separately-recorded act through `refundListingFee` with
 * the `admin_discretion` trigger.
 */
export async function decideCancellation(
  deps: { db: Database; audit: AuditWriter },
  input: {
    cancellationId: string;
    approve: boolean;
    actor: string;
    internalReason: string;
    customerExplanation: string;
  },
): Promise<CancellationDecisionOutcome> {
  const { db, audit } = deps;

  const decided = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(campaignCancellations)
      .where(eq(campaignCancellations.id, input.cancellationId))
      .for('update')
      .limit(1);

    if (!row) return { status: 'not_found' as const };
    if (row.status !== 'pending') return { status: 'already_decided' as const };

    const now = new Date();
    const [updated] = await tx
      .update(campaignCancellations)
      .set({
        status: input.approve ? 'canceled' : 'denied',
        decidedBy: input.actor,
        decidedAt: now,
      })
      .where(eq(campaignCancellations.id, row.id))
      .returning();

    if (input.approve) {
      // Pre-charge termination from whichever pre-charge state it sits in.
      // §23.1 admits ended_no_charge from the states a paid, unlaunched (or
      // just-live) campaign can occupy; a state it does not admit from is a
      // case the machine correctly refuses and Admin escalates.
      const [current] = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, row.campaignId))
        .for('update')
        .limit(1);

      const from = current?.status;
      if (from && from !== 'ended_no_charge') {
        const moved = await tx
          .update(campaigns)
          .set({ status: 'ended_no_charge', updatedAt: now })
          .where(and(eq(campaigns.id, row.campaignId), eq(campaigns.status, from)))
          .returning({ id: campaigns.id });
        if (moved.length === 1) {
          await tx.insert(campaignStatusHistory).values({
            campaignId: row.campaignId,
            fromStatus: from,
            toStatus: 'ended_no_charge',
            actor: input.actor,
          });
        }
      }
    }

    return { status: 'decided' as const, cancellation: updated! };
  });

  if (decided.status === 'decided') {
    await audit({
      action: input.approve
        ? 'listing.cancellation_approved'
        : 'listing.cancellation_denied',
      targetType: 'campaign',
      targetId: decided.cancellation.campaignId,
      internalReason: input.internalReason,
      customerExplanation: input.customerExplanation,
    });
  }

  return decided;
}

/* ── Reads for Admin reconciliation (§33.3.6) ─────────────────────────────── */

/** Every recorded refund for one campaign (at most one, by design). */
export async function findListingRefund(
  db: Database,
  campaignId: string,
): Promise<ListingFeeRefund | null> {
  const [row] = await db
    .select()
    .from(listingFeeRefunds)
    .where(eq(listingFeeRefunds.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

export async function listCancellations(
  db: Database,
  campaignId: string,
): Promise<CampaignCancellation[]> {
  return db
    .select()
    .from(campaignCancellations)
    .where(eq(campaignCancellations.campaignId, campaignId))
    .orderBy(campaignCancellations.requestedAt);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
