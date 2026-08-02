/**
 * Admin — listing-fee reconciliation, the clocks, and the refund.
 * Spec §13 Admin, §24.6, §31.6, §33.3.6, §33.3.8, §33.3.11.
 *
 * §13: "Admin can reconcile the listing fee separately from all campaign
 * money, see the exact clock and refund eligibility, and issue a direct refund
 * to the original payment method when required."
 *
 * ── Separate means separate ─────────────────────────────────────────────────
 * Every read here joins `listing_fee_payments`, `listing_fee_refunds`, and
 * `campaign_cancellations` — the §24.6 stream — and touches no reservation, no
 * association ledger, and no Connect object. §33.3.6 is tested against these
 * routes.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * Reads do not. Refunding and deciding a cancellation move money or end a
 * campaign; both are §5.1 "high-impact" and take `requireFreshSession`.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { Notifier } from '../notifications/send.js';
import { campaigns } from '../db/schema/domain.js';
import {
  listingFeePayments,
  listingFeeRefunds,
  campaignCancellations,
} from '../db/schema/listing.js';
import {
  refundListingFee,
  decideCancellation,
  findListingRefund,
  listCancellations,
} from '../payments/listing-refund.js';
import { findListingPayment } from '../payments/listing-checkout.js';
import { sweepListingDeadlines, clockFired } from '../payments/listing-clocks.js';
import {
  notifyListingRefund,
  type ListingNotificationContext,
} from '../payments/listing-notifications.js';

export const ADMIN_LISTING_PATH = '/api/admin/listing';

export interface AdminListingDeps {
  db: Database;
  auth: Auth;
  gateway: StripeGateway;
  audit: AuditWriter;
  notifier: Notifier;
  context: ListingNotificationContext;
}

const REFUND_TRIGGERS = [
  'zero_eligible_recruits',
  'no_mutual_acceptance',
  'creator_replacement_failed',
  'admin_discretion',
] as const;

const cents = (value: bigint): string => value.toString();

export function createAdminListingRouter(deps: AdminListingDeps): Router {
  const { db, auth, gateway, audit, notifier, context } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── The stream, reconcilable on its own (§33.3.6) ───────────────────────── */

  router.get(ADMIN_LISTING_PATH, admin, async (_req, res) => {
    const rows = await db
      .select({
        payment: listingFeePayments,
        campaignStatus: campaigns.status,
        refund: listingFeeRefunds,
      })
      .from(listingFeePayments)
      .innerJoin(campaigns, eq(campaigns.id, listingFeePayments.campaignId))
      .leftJoin(listingFeeRefunds, eq(listingFeeRefunds.paymentId, listingFeePayments.id))
      .orderBy(desc(listingFeePayments.paidAt));

    res.json({
      listingFees: rows.map(({ payment, campaignStatus, refund }) => ({
        campaignId: payment.campaignId,
        campaignStatus,
        mode: payment.mode,
        checkoutSessionId: payment.checkoutSessionId,
        paymentIntentId: payment.paymentIntentId,
        baseCents: cents(payment.baseCents),
        discountCents: cents(payment.discountCents),
        promotionCents: cents(payment.promotionCents),
        subtotalCents: cents(payment.subtotalCents),
        taxCents: cents(payment.taxCents),
        totalCents: cents(payment.totalCents),
        descriptor: payment.descriptor,
        paidAt: payment.paidAt.toISOString(),
        responseDeadlineAt: payment.responseDeadlineAt.toISOString(),
        freeCancellationDeadlineAt: payment.freeCancellationDeadlineAt.toISOString(),
        refund: refund
          ? {
              status: refund.status,
              trigger: refund.trigger,
              totalRefundedCents: cents(refund.totalRefundedCents),
              refundObjectId: refund.refundObjectId,
            }
          : null,
      })),
    });
  });

  /* ── One campaign: the exact clock and current refund eligibility (§13) ──── */

  router.get(`${ADMIN_LISTING_PATH}/campaigns/:campaignId`, admin, async (req, res) => {
    const campaignId = String(req.params['campaignId']);
    const payment = await findListingPayment(db, campaignId);
    if (!payment) {
      res.json({ listing: null });
      return;
    }

    const refund = await findListingRefund(db, campaignId);
    const cancellations = await listCancellations(db, campaignId);
    const now = new Date();

    res.json({
      listing: {
        payment: {
          id: payment.id,
          mode: payment.mode,
          checkoutSessionId: payment.checkoutSessionId,
          paymentIntentId: payment.paymentIntentId,
          baseCents: cents(payment.baseCents),
          discountLines: payment.discountLines,
          discountCents: cents(payment.discountCents),
          promotionCents: cents(payment.promotionCents),
          subtotalCents: cents(payment.subtotalCents),
          taxCents: cents(payment.taxCents),
          totalCents: cents(payment.totalCents),
          taxCalculationId: payment.taxCalculationId,
          descriptor: payment.descriptor,
          paidAt: payment.paidAt.toISOString(),
        },
        clocks: {
          responseDeadlineAt: payment.responseDeadlineAt.toISOString(),
          responseWindowHours: payment.responseWindowHours,
          responseDeadlinePassed: payment.responseDeadlineAt.getTime() <= now.getTime(),
          responseDeadlineRecorded: await clockFired(
            db,
            `listing_response_deadline_reached:${campaignId}`,
          ),
          freeCancellationDeadlineAt: payment.freeCancellationDeadlineAt.toISOString(),
          freeCancellationWindowHours: payment.freeCancellationWindowHours,
          freeCancellationOpen: payment.freeCancellationDeadlineAt.getTime() > now.getTime(),
        },
        refund: refund
          ? {
              id: refund.id,
              status: refund.status,
              trigger: refund.trigger,
              subtotalRefundedCents: cents(refund.subtotalRefundedCents),
              taxRefundedCents: cents(refund.taxRefundedCents),
              totalRefundedCents: cents(refund.totalRefundedCents),
              refundObjectId: refund.refundObjectId,
              actor: refund.actor,
              createdAt: refund.createdAt.toISOString(),
              confirmedAt: refund.confirmedAt?.toISOString() ?? null,
            }
          : null,
        refundEligible: refund === null,
        cancellations: cancellations.map((c) => ({
          id: c.id,
          kind: c.kind,
          status: c.status,
          requestedBy: c.requestedBy,
          requestedAt: c.requestedAt.toISOString(),
          decidedBy: c.decidedBy,
          decidedAt: c.decidedAt?.toISOString() ?? null,
        })),
      },
    });
  });

  /* ── The direct refund (§13, §33.3.8) ─────────────────────────────────────── */

  router.post(
    `${ADMIN_LISTING_PATH}/campaigns/:campaignId/refund`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const body = req.body as Record<string, unknown>;
      const trigger = String(body['trigger'] ?? '');
      const internalReason = String(body['internalReason'] ?? '').trim();
      const customerExplanation = String(body['customerExplanation'] ?? '').trim();

      if (!(REFUND_TRIGGERS as readonly string[]).includes(trigger)) {
        res.status(400).json({
          error: 'invalid_trigger',
          title: 'That refund could not be recorded',
          whatHappened: 'A refund must name which promise it honours.',
          next: `Use one of: ${REFUND_TRIGGERS.join(', ')}.`,
        });
        return;
      }
      if (!internalReason || !customerExplanation) {
        res.status(400).json({
          error: 'reason_required',
          title: 'That refund could not be recorded',
          whatHappened:
            'A refund needs both an internal reason and the sentence the Founder will read (§25.6).',
          next: 'Write both and try again.',
        });
        return;
      }

      const outcome = await refundListingFee(
        { db, gateway, audit },
        {
          campaignId,
          trigger: trigger as (typeof REFUND_TRIGGERS)[number],
          actor: `admin:${req.authUser?.id ?? 'unknown'}`,
          internalReason,
          customerExplanation,
        },
      );

      if (outcome.status === 'not_paid') {
        res.status(409).json({
          error: 'not_paid',
          title: 'There is nothing to refund',
          whatHappened: 'This campaign has no recorded listing payment.',
          next: 'Nothing was changed.',
        });
        return;
      }

      if (outcome.status === 'refunded' && !outcome.alreadyExisted) {
        await notifyListingRefund(db, notifier, context, { campaignId });
      }

      // §13: idempotent, and the answer communicates typical bank timing
      // without promising a settlement date.
      res.json({
        refund: {
          status: outcome.status === 'refunded' ? outcome.refund.status : 'initiated',
          alreadyExisted: outcome.status === 'refunded' ? outcome.alreadyExisted : false,
          totalRefundedCents: cents(outcome.refund.totalRefundedCents),
          timing:
            'The bank typically shows the refund within 5–10 business days; an exact date cannot be promised.',
        },
      });
    },
  );

  /* ── Deciding a pending cancellation (§31.6, §33.3.11) ───────────────────── */

  router.post(
    `${ADMIN_LISTING_PATH}/cancellations/:cancellationId/decision`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const internalReason = String(body['internalReason'] ?? '').trim();
      const customerExplanation = String(body['customerExplanation'] ?? '').trim();

      if (typeof body['approve'] !== 'boolean' || !internalReason || !customerExplanation) {
        res.status(400).json({
          error: 'invalid_decision',
          title: 'That decision could not be recorded',
          whatHappened:
            'A decision needs approve or deny, an internal reason, and the sentence the Founder will read.',
          next: 'Complete all three and try again.',
        });
        return;
      }

      const outcome = await decideCancellation(
        { db, audit },
        {
          cancellationId: String(req.params['cancellationId']),
          approve: body['approve'],
          actor: `admin:${req.authUser?.id ?? 'unknown'}`,
          internalReason,
          customerExplanation,
        },
      );

      if (outcome.status === 'not_found') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (outcome.status === 'already_decided') {
        res.status(409).json({
          error: 'already_decided',
          title: 'This request was already decided',
          whatHappened: 'A decided cancellation cannot be re-decided.',
          next: 'Nothing was changed.',
        });
        return;
      }

      res.json({
        cancellation: {
          id: outcome.cancellation.id,
          status: outcome.cancellation.status,
        },
      });
    },
  );

  /* ── Running the deadline sweep now — the recovery action (§1.1) ─────────── */

  router.post(`${ADMIN_LISTING_PATH}/run-deadline-sweep`, admin, fresh, async (_req, res) => {
    const result = await sweepListingDeadlines(db, audit);
    res.json({ sweep: result });
  });

  /* ── A pending-cancellations queue for the Admin shell ───────────────────── */

  router.get(`${ADMIN_LISTING_PATH}/cancellations`, admin, async (_req, res) => {
    const rows = await db
      .select()
      .from(campaignCancellations)
      .where(eq(campaignCancellations.status, 'pending'))
      .orderBy(campaignCancellations.requestedAt);
    res.json({
      cancellations: rows.map((c) => ({
        id: c.id,
        campaignId: c.campaignId,
        kind: c.kind,
        requestedBy: c.requestedBy,
        requestedAt: c.requestedAt.toISOString(),
        internalReason: c.internalReason,
      })),
    });
  });

  return router;
}
