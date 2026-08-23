/**
 * The Founder's listing payment — Spec §13, §24.6, §31.6, §33.3.5, §33.3.11.
 *
 * Three routes on the same authorization spine as the workspace: every one
 * resolves the campaign through the caller's own claim (`findFounderCampaign`),
 * and someone else's campaign answers the identical 404 a missing one gets.
 *
 * ── What the server sends and what it never computes ────────────────────────
 * The GET returns every §24.6 line as integer-cent strings plus the resolved
 * A.5 amounts; the browser formats and renders and does no arithmetic — the
 * Phase 09 rule, unchanged. The consent *text* is the shared A.5 register the
 * surface imports; the server's job is the variables, from the same records
 * the ledger stores.
 *
 * ── The Checkout POST is the consent gate's server half ─────────────────────
 * The surface shows A.5 with the resolved total, then posts here; this returns
 * the session URL for exactly those amounts. A disabled button is not
 * authorization (§1.1) — eligibility, tax, and the amounts are all re-decided
 * server-side on this request.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway, TaxAddress } from '../payments/stripe-client.js';
import type { Notifier } from '../notifications/send.js';
import { findFounderCampaign } from '../workspace/service.js';
import {
  applySimulatedListingPayment,
  beginListingCheckout,
  findListingPayment,
} from '../payments/listing-checkout.js';
import {
  requestFounderCancellation,
  findListingRefund,
  listCancellations,
} from '../payments/listing-refund.js';
import { readOnboardingState } from '../payments/onboarding.js';
import {
  notifyListingRefund,
  type ListingNotificationContext,
} from '../payments/listing-notifications.js';
import { applicationReviewBlocksListing } from '../campaign/application-review-gate.js';

export const FOUNDER_LISTING_PATH = '/api/founder/campaigns';

export interface FounderListingDeps {
  db: Database;
  auth: Auth;
  gateway: StripeGateway;
  audit: AuditWriter;
  notifier: Notifier;
  context: ListingNotificationContext;
  connectUrls?: { returnUrl: string; refreshUrl: string } | undefined;
  simulatedPaymentsEnabled?: boolean;
}

function notFound(res: express.Response): void {
  res.status(404).json({
    error: 'not_found',
    title: 'Campaign not found',
    whatHappened: 'We could not find that campaign on your account.',
    next: 'Go back to your campaigns. If you think this is wrong, contact support.',
    support: '/support',
  });
}

const cents = (value: bigint): string => value.toString();

export function createFounderListingRouter(deps: FounderListingDeps): Router {
  const {
    db,
    auth,
    gateway,
    audit,
    notifier,
    context,
    connectUrls,
    simulatedPaymentsEnabled = false,
  } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '64kb' });

  async function resolve(req: express.Request, res: express.Response): Promise<string | null> {
    const campaign = await findFounderCampaign(db, {
      campaignId: String(req.params['campaignId'] ?? ''),
      founderUserId: req.authUser?.id ?? '',
    });
    if (!campaign) {
      notFound(res);
      return null;
    }
    return campaign.campaignId;
  }

  /* ── The listing state (§13's pre-payment list; §24.6's record when paid) ── */

  router.get(`${FOUNDER_LISTING_PATH}/:campaignId/listing`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const payment = await findListingPayment(db, campaignId);

    if (payment) {
      const refund = await findListingRefund(db, campaignId);
      const cancellations = await listCancellations(db, campaignId);
      res.json({
        listing: {
          paid: true,
          payment: {
            baseCents: cents(payment.baseCents),
            discountLines: payment.discountLines,
            discountCents: cents(payment.discountCents),
            promotionCents: cents(payment.promotionCents),
            subtotalCents: cents(payment.subtotalCents),
            taxCents: cents(payment.taxCents),
            totalCents: cents(payment.totalCents),
            descriptor: payment.descriptor,
            receiptUrl: payment.receiptUrl,
            paidAt: payment.paidAt.toISOString(),
            responseDeadlineAt: payment.responseDeadlineAt.toISOString(),
            freeCancellationDeadlineAt: payment.freeCancellationDeadlineAt.toISOString(),
          },
          refund: refund
            ? {
                status: refund.status,
                trigger: refund.trigger,
                totalRefundedCents: cents(refund.totalRefundedCents),
                explanation: refund.customerExplanation,
              }
            : null,
          cancellation:
            cancellations.length > 0
              ? {
                  status: cancellations[cancellations.length - 1]!.status,
                  kind: cancellations[cancellations.length - 1]!.kind,
                  explanation: cancellations[cancellations.length - 1]!.customerExplanation,
                }
              : null,
        },
      });
      return;
    }

    if (await applicationReviewBlocksListing(db, campaignId)) {
      res.status(409).json({
        error: 'application_review_required',
        title: 'Application Review approval is required',
        whatHappened: 'This campaign must be approved before the listing fee can open.',
        next: 'Return to Application Review to see its current status.',
      });
      return;
    }

    const onboarding = await readOnboardingState(
      {
        db,
        gateway,
        audit,
        returnUrl: connectUrls?.returnUrl,
        refreshUrl: connectUrls?.refreshUrl,
      },
      { ownerUserId: req.authUser?.id ?? '', role: 'founder_seller' },
    );

    res.json({
      listing: {
        paid: false,
        onboardingState: onboarding.state,
        listingFeeEligible: onboarding.listingFeeEligible,
        taxAvailable: gateway.taxEnabled,
        // §13's restricted state: no misleading ability to pay. The surface
        // reads this one flag; the POST below re-decides regardless.
        checkoutAvailable: onboarding.listingFeeEligible && gateway.taxEnabled,
      },
    });
  });

  /* ── Opening Checkout (§13, A.5) ──────────────────────────────────────────── */

  router.post(
    `${FOUNDER_LISTING_PATH}/:campaignId/listing/checkout`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      if (await applicationReviewBlocksListing(db, campaignId)) {
        res.status(409).json({
          error: 'application_review_required',
          title: 'Application Review approval is required',
          whatHappened: 'This campaign must be approved before listing-fee checkout can open.',
          next: 'Return to Application Review to see its current status.',
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const rawAddress = (body['address'] as Record<string, unknown> | undefined) ?? {};
      const postalCode = String(rawAddress['postalCode'] ?? '').trim();

      if (!postalCode) {
        res.status(422).json({
          error: 'address_required',
          title: 'A billing address is needed first',
          whatHappened:
            'Sales tax depends on your billing address, and the exact total has to be shown before you agree to pay it.',
          next: 'Enter your billing address and try again. Nothing else has changed.',
        });
        return;
      }

      const address: TaxAddress = {
        postalCode,
        country: String(rawAddress['country'] ?? 'US').trim() || 'US',
        ...(typeof rawAddress['state'] === 'string' && rawAddress['state'].trim()
          ? { state: rawAddress['state'].trim() }
          : {}),
        ...(typeof rawAddress['city'] === 'string' && rawAddress['city'].trim()
          ? { city: rawAddress['city'].trim() }
          : {}),
        ...(typeof rawAddress['line1'] === 'string' && rawAddress['line1'].trim()
          ? { line1: rawAddress['line1'].trim() }
          : {}),
      };

      const result = await beginListingCheckout(
        {
          db,
          gateway,
          audit,
          // Founder Flow v2 Session E (2026-08-19): the listing fee has its own
          // page now, and it is the ONE address for it — it renders the
          // pre-payment state, §24.6’s record afterwards, and §31.6’s
          // cancellation decision. Landing back anywhere else would mean a
          // second surface over the same money (`CLAUDE.md`, Session D).
          successUrl: `${context.appBaseUrl}/campaigns/${campaignId}/setup/fee?listing=paid`,
          cancelUrl: `${context.appBaseUrl}/campaigns/${campaignId}/setup/fee?listing=canceled`,
          connectUrls,
        },
        {
          campaignId,
          founderUserId: req.authUser?.id ?? '',
          founderEmail: req.authUser?.email ?? undefined,
          address,
          newsletterOptIn: body['newsletterOptIn'] === true,
          actor: `user:${req.authUser?.id ?? ''}`,
        },
      );

      if (!result.ok) {
        const status =
          result.code === 'already_paid'
            ? 409
            : result.code === 'provider_error' || result.code === 'tax_unavailable'
              ? 503
              : 422;
        res.status(status).json({
          error: result.code,
          title: 'Payment cannot open yet',
          whatHappened: result.message,
          next: result.next,
          support: '/support',
        });
        return;
      }

      res.json({
        checkout: {
          url: result.url,
          sessionId: result.sessionId,
          baseCents: cents(result.baseCents),
          discountLines: result.discountLines,
          discountCents: cents(result.discountCents),
          subtotalCents: cents(result.subtotalCents),
          taxCents: cents(result.taxCents),
          totalCents: cents(result.totalCents),
          descriptor: 'PROOVD LISTING',
        },
      });
    },
  );

  /* ── Simulated payment for the no-provider pitch flow ───────────────────── */

  router.post(
    `${FOUNDER_LISTING_PATH}/:campaignId/listing/simulated-payment`,
    founder,
    async (req, res) => {
      // Never expose the fake-pay write in a live money mode or a deployment
      // that did not explicitly enable it.
      if (!simulatedPaymentsEnabled || gateway.mode !== 'test') {
        notFound(res);
        return;
      }

      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      if (await applicationReviewBlocksListing(db, campaignId)) {
        res.status(409).json({
          error: 'application_review_required',
          title: 'Application Review approval is required',
          whatHappened: 'This campaign must be approved before the listing fee can be recorded.',
          next: 'Return to Application Review to see its current status.',
        });
        return;
      }

      const existing = await findListingPayment(db, campaignId);
      if (existing) {
        res.json({ paid: true, paidAt: existing.paidAt.toISOString() });
        return;
      }

      const outcome = await applySimulatedListingPayment(
        db,
        { gateway, audit },
        {
          campaignId,
          actor: `user:${req.authUser?.id ?? ''}`,
        },
      );

      if (outcome.status === 'no_calculation') {
        res.status(422).json({
          error: 'no_calculation',
          title: 'The listing fee is not ready',
          whatHappened: 'This campaign does not have a saved listing-fee calculation yet.',
          next: 'Open the campaign workspace, then try Pay again.',
        });
        return;
      }
      if (outcome.status === 'unreconciled') {
        res.status(409).json({
          error: 'payment_not_recorded',
          title: 'The payment state could not be recorded',
          whatHappened: outcome.reason,
          next: 'Try again. If this continues, contact support.',
        });
        return;
      }

      const payment = await findListingPayment(db, campaignId);
      if (!payment) {
        res.status(409).json({
          error: 'payment_not_recorded',
          title: 'The payment state could not be recorded',
          whatHappened: 'The campaign did not produce a saved payment record.',
          next: 'Try again. If this continues, contact support.',
        });
        return;
      }

      res.json({ paid: true, paidAt: payment.paidAt.toISOString() });
    },
  );

  /* ── Founder cancellation (§31.6, §33.3.11) ──────────────────────────────── */

  router.post(
    `${FOUNDER_LISTING_PATH}/:campaignId/listing/cancel`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const reason = String((req.body as Record<string, unknown>)['reason'] ?? '').trim();
      const outcome = await requestFounderCancellation(
        { db, gateway, audit },
        {
          campaignId,
          requestedBy: `user:${req.authUser?.id ?? ''}`,
          reason: reason || 'Canceled by the Founder',
        },
      );

      switch (outcome.status) {
        case 'canceled_and_refunded': {
          // §13's refund message, after the decision committed.
          await notifyListingRefund(db, notifier, context, { campaignId });
          res.json({
            cancellation: {
              status: 'canceled',
              refund: outcome.refund.status,
              explanation: outcome.cancellation.customerExplanation,
            },
          });
          return;
        }
        case 'admin_review':
        case 'already_pending':
          res.status(202).json({
            cancellation: {
              status: 'pending',
              explanation: outcome.cancellation.customerExplanation,
            },
          });
          return;
        case 'already_canceled':
          res.status(409).json({
            error: 'already_canceled',
            title: 'This campaign is already canceled',
            whatHappened: 'The cancellation was already recorded.',
            next: 'Nothing more is needed.',
          });
          return;
        case 'not_paid':
          res.status(409).json({
            error: 'not_paid',
            title: 'There is nothing to cancel here yet',
            whatHappened: 'This campaign has not paid a listing fee.',
            next: 'If you want to stop before payment, contact support.',
            support: '/support',
          });
          return;
      }
    },
  );

  return router;
}
