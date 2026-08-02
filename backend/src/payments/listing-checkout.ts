/**
 * The listing-fee Checkout — Spec §13, §24.6, §14.6, §29.6, §23.1, §33.3.5–8.
 *
 * The first real money in the product, and the only place Proovd is merchant of
 * record. Three moments live here:
 *
 *   `beginListingCheckout`   the pre-payment path: eligibility, the stored tax
 *                            calculation A.5's total comes from, the campaign's
 *                            walk to `listing_fee_pending`, and the session.
 *   `applyListingPayment`    §13's seven atomic effects, in one transaction.
 *   `recordCheckoutExpired`  §13's failure path: everything survives, nothing
 *                            starts, retry duplicates nothing.
 *
 * ── Not a Connect charge, structurally ──────────────────────────────────────
 * §24.6 and §33.3.6: listing money and campaign money never mix. The session is
 * created on the platform account, the stored stream references no reservation
 * and no connected account, and the handler that applies it is registered on
 * the platform endpoint only — a Connect delivery cannot reach it (Phase 10's
 * two-map split doing its job).
 *
 * ── The total is consented before it is charged ─────────────────────────────
 * A.5 names an exact `US$[TOTAL]`, so tax is calculated BEFORE Checkout from
 * the billing address the Founder gives the pre-payment surface, stored under
 * §32.4, and the session charges exactly subtotal + that tax. If the
 * calculation cannot be made there is no consent to render and no session to
 * create — never a substituted amount (§19/§21's rule, applied to Proovd's own
 * fee; §31.7: a zero from missing configuration proves nothing).
 *
 * ── Why the webhook's metadata is trustworthy here, unlike Cal.com's ────────
 * Phase 09b refused to trust a campaign id in a webhook payload because the
 * *booker* typed it. This metadata was written by Proovd's own API call when the
 * session was created; the payer never holds it. It is still cross-checked
 * against the stored §32.4 session row, and a delivery that does not reconcile
 * is recorded and routed to Admin rather than guessed into place (§1 rule 6).
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignStatusHistory,
  campaignAffiliateAssociations,
} from '../db/schema/domain.js';
import { listingFeeCalculations, campaignOptionalItems } from '../db/schema/workspace.js';
import { listingFeePayments, type ListingFeePayment } from '../db/schema/listing.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import { readSettingValue } from '../settings/service.js';
import { transitionAssociation } from '../affiliates/recruitment.js';
import { readOnboardingState } from './onboarding.js';
import { recordProviderObject, readProviderObject } from './provider-objects.js';
import type { StripeGateway, TaxAddress } from './stripe-client.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/** The two §6 clocks. Named once so a typo is a compile error. */
export const LISTING_CLOCK_SETTING_KEYS = {
  responseWindow: 'affiliate_response_window_hours',
  freeCancellation: 'founder_free_cancellation_window_hours',
} as const;

export interface ListingClockSettings {
  responseWindowHours: number;
  freeCancellationWindowHours: number;
}

/**
 * Reads the two §6 windows in force. Throws on an unset or non-numeric value —
 * a clock started from an invented number is §29.6's failure at birth.
 */
export async function readListingClockSettings(db: Executor): Promise<ListingClockSettings> {
  const hours = async (key: string): Promise<number> => {
    const value = await readSettingValue(db as Database, key);
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`setting "${key}" is not a positive whole number of hours`);
    }
    return value;
  };
  return {
    responseWindowHours: await hours(LISTING_CLOCK_SETTING_KEYS.responseWindow),
    freeCancellationWindowHours: await hours(LISTING_CLOCK_SETTING_KEYS.freeCancellation),
  };
}

/* ── Walking the campaign to listing_fee_pending (§23.1) ──────────────────── */

/**
 * §23.1's two hops between the claim and the fee: `account_claimed →
 * stripe_onboarding_pending` when listing preparation begins, and on to
 * `listing_fee_pending` once requirements are complete and the fee is
 * calculated. Conditional UPDATEs, so a concurrent request takes each hop once,
 * and each hop that lands writes its history row.
 */
export async function advanceCampaignToListingFeePending(
  db: Executor,
  campaignId: string,
  actor: string,
): Promise<void> {
  const hops: Array<{
    from: 'account_claimed' | 'stripe_onboarding_pending';
    to: 'stripe_onboarding_pending' | 'listing_fee_pending';
  }> = [
    // §23.1: "Stripe onboarding/listing preparation begins."
    { from: 'account_claimed', to: 'stripe_onboarding_pending' },
    // §23.1: "Requirements complete" — and the fee is calculated.
    { from: 'stripe_onboarding_pending', to: 'listing_fee_pending' },
  ];

  for (const hop of hops) {
    const moved = await db
      .update(campaigns)
      .set({ status: hop.to, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, hop.from)))
      .returning({ id: campaigns.id });

    if (moved.length === 1) {
      await db.insert(campaignStatusHistory).values({
        campaignId,
        fromStatus: hop.from,
        toStatus: hop.to,
        actor,
      });
    }
  }
}

/* ── Beginning Checkout ───────────────────────────────────────────────────── */

export type BeginCheckoutRefusal =
  | 'already_paid'
  | 'onboarding_incomplete'
  | 'restricted'
  | 'tax_unavailable'
  | 'no_calculation'
  | 'checkout_unavailable'
  | 'provider_error';

export type BeginCheckoutResult =
  | {
      ok: true;
      sessionId: string;
      url: string;
      calculationId: string;
      subtotalCents: bigint;
      taxCents: bigint;
      totalCents: bigint;
      discountLines: unknown;
      baseCents: bigint;
      discountCents: bigint;
    }
  | { ok: false; code: BeginCheckoutRefusal; message: string; next: string };

export interface BeginCheckoutContext {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** Where Stripe sends the Founder back. Derived from the app base URL. */
  successUrl: string;
  cancelUrl: string;
  /** §13's onboarding gate needs to know whether hosted onboarding exists. */
  connectUrls?: { returnUrl: string; refreshUrl: string } | undefined;
}

export async function beginListingCheckout(
  context: BeginCheckoutContext,
  input: {
    campaignId: string;
    founderUserId: string;
    founderEmail?: string | undefined;
    address: TaxAddress;
    newsletterOptIn: boolean;
    actor: string;
  },
): Promise<BeginCheckoutResult> {
  const { db, gateway, audit } = context;

  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status, listingPaidAt: campaigns.listingPaidAt })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) {
    return refuse('provider_error', 'That campaign could not be found.', 'Contact support.');
  }

  if (campaign.listingPaidAt) {
    return refuse(
      'already_paid',
      'This listing fee has already been paid.',
      'Nothing more is due. Your receipt is in your email.',
    );
  }

  // §13: only a complete seller account reaches payment, and a restricted one
  // is offered a support path, never a Checkout (§33.3.11's spirit at the door).
  const onboarding = await readOnboardingState(
    {
      db,
      gateway,
      audit,
      returnUrl: context.connectUrls?.returnUrl,
      refreshUrl: context.connectUrls?.refreshUrl,
    },
    { ownerUserId: input.founderUserId, role: 'founder_seller' },
  );

  if (onboarding.state === 'restricted') {
    return refuse(
      'restricted',
      'Stripe cannot continue with your payout account, so payment is not available.',
      'Contact support and a person here will go through it with you.',
    );
  }
  if (!onboarding.listingFeeEligible) {
    return refuse(
      'onboarding_incomplete',
      'Your payout setup is not finished, so the listing fee cannot be paid yet.',
      'Finish payout setup first. Everything in your workspace is saved.',
    );
  }

  // §12 puts Stripe Tax on this Checkout. Unconfigured tax refuses loudly —
  // the unconfiguredTransport decision, applied to a tax authority (§31.7).
  if (!gateway.taxEnabled) {
    return refuse(
      'tax_unavailable',
      'Sales-tax calculation is not switched on for this deployment, so payment cannot open.',
      'Nothing you have done is affected. We will email you when payment opens.',
    );
  }

  // The fee in force: the latest §12 calculation. The workspace keeps it
  // current on every change; a campaign with none has never opened the
  // workspace, and there is nothing to charge.
  const [calculation] = await db
    .select()
    .from(listingFeeCalculations)
    .where(eq(listingFeeCalculations.campaignId, input.campaignId))
    .orderBy(desc(listingFeeCalculations.calculatedAt))
    .limit(1);

  if (!calculation) {
    return refuse(
      'no_calculation',
      'Your listing fee has not been calculated yet.',
      'Open your campaign workspace first.',
    );
  }

  try {
    // The stored tax calculation A.5's total comes from (§32.4).
    const tax = await gateway.createTaxCalculation({
      amountCents: calculation.subtotalCents,
      address: input.address,
      reference: `listing-fee:${input.campaignId}`,
    });

    if (tax.id) {
      await recordProviderObject(db, {
        mode: gateway.mode,
        objectType: 'tax_calculation',
        providerObjectId: tax.id,
        accountContext: 'platform',
        campaignId: input.campaignId,
        ownerUserId: input.founderUserId,
        amountCents: calculation.subtotalCents,
        amountTaxCents: tax.taxCents,
        status: 'calculated',
        amountDetail: {
          expiresAt: tax.expiresAt?.toISOString() ?? null,
        },
      });
    }

    const totalCents = calculation.subtotalCents + tax.taxCents;

    // §23.1's hops. Landing here at all means onboarding is complete and the
    // fee is calculated, which are exactly the entry rules.
    await advanceCampaignToListingFeePending(db, input.campaignId, input.actor);

    const session = await gateway.createListingCheckoutSession({
      customerEmail: input.founderEmail,
      subtotalCents: calculation.subtotalCents,
      taxCents: tax.taxCents,
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
      // Stripe-side idempotency: the same calculation at the same tax answers
      // with the same session, so a double-click cannot mint two charges.
      idempotencyKey: `listing-checkout:${input.campaignId}:${calculation.id}:${tax.taxCents}`,
      metadata: {
        proovd_campaign_id: input.campaignId,
        proovd_calculation_id: calculation.id,
        proovd_subtotal_cents: calculation.subtotalCents.toString(),
        proovd_tax_cents: tax.taxCents.toString(),
        proovd_tax_calculation_id: tax.id ?? '',
        proovd_newsletter_opt_in: input.newsletterOptIn ? '1' : '0',
      },
    });

    await recordProviderObject(db, {
      mode: gateway.mode,
      objectType: 'checkout_session',
      providerObjectId: session.id,
      accountContext: 'platform',
      campaignId: input.campaignId,
      ownerUserId: input.founderUserId,
      amountCents: totalCents,
      amountTaxCents: tax.taxCents,
      status: 'open',
      idempotencyKey: `listing-checkout:${input.campaignId}:${calculation.id}:${tax.taxCents}`,
      amountDetail: {
        subtotalCents: calculation.subtotalCents.toString(),
        baseCents: calculation.baseCents.toString(),
        discountCents: calculation.discountCents.toString(),
        calculationId: calculation.id,
        taxCalculationId: tax.id,
        newsletterOptIn: input.newsletterOptIn,
      },
    });

    await audit({
      action: 'listing.checkout_opened',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `Checkout session ${session.id} created for the listing fee`,
      newValue: {
        sessionId: session.id,
        subtotalCents: calculation.subtotalCents.toString(),
        taxCents: tax.taxCents.toString(),
        totalCents: totalCents.toString(),
      },
      actorId: input.founderUserId,
    });

    return {
      ok: true,
      sessionId: session.id,
      url: session.url,
      calculationId: calculation.id,
      subtotalCents: calculation.subtotalCents,
      taxCents: tax.taxCents,
      totalCents,
      discountLines: calculation.discountLines,
      baseCents: calculation.baseCents,
      discountCents: calculation.discountCents,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await audit({
      action: 'listing.checkout_open_failed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `the provider refused to open Checkout: ${reason}`,
      actorId: input.founderUserId,
    });
    return refuse(
      'provider_error',
      'We could not open the payment page just now. Nothing has been charged and nothing you entered was lost.',
      'Try again in a moment. If it keeps happening, contact support.',
    );
  }

  function refuse(
    code: BeginCheckoutRefusal,
    message: string,
    next: string,
  ): BeginCheckoutResult {
    return { ok: false, code, message, next };
  }
}

/* ── §13's seven atomic effects ───────────────────────────────────────────── */

export type ApplyPaymentOutcome =
  | {
      status: 'applied';
      paymentId: string;
      paidAt: Date;
      responseDeadlineAt: Date;
      /** The associations the payment made actionable — for the notifications. */
      openedAssociationIds: string[];
      newsletterOptIn: boolean;
    }
  | { status: 'duplicate' }
  /** Signed, delivered, and irreconcilable. Recorded and routed to Admin. */
  | { status: 'unreconciled'; reason: string };

export interface ApplyPaymentInput {
  campaignId: string;
  calculationId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  /** What Stripe says was charged. Verified against the stored calculation. */
  amountTotalCents: bigint;
  subtotalCents: bigint;
  taxCents: bigint;
  taxCalculationId: string | null;
  newsletterOptIn: boolean;
  /** The completion moment — the anchor of both clocks (§33.3.7). */
  paidAt: Date;
  providerEventId: string | null;
  actor: string;
}

/**
 * One transaction. All seven §13 effects, or none of them — the trap's exact
 * words: "a partial application — say, the clock starts but the lock doesn't —
 * is the worst outcome here."
 *
 * Idempotency is layered exactly as Phase 08c's reveal was: `provider_events`
 * stops the same delivery, the `listing_fee_paid:<campaignId>` idempotency key
 * stops a different delivery of the same fact, and the unique payment row stops
 * everything else. §33.7.7's standard, applied to the first money.
 */
export async function applyListingPayment(
  db: Database,
  deps: { gateway: StripeGateway; audit: AuditWriter },
  input: ApplyPaymentInput,
): Promise<ApplyPaymentOutcome> {
  const { gateway, audit } = deps;

  try {
    return await db.transaction(async (tx) => {
      // The exactly-once pivot, first, so everything below shares its fate.
      await tx.insert(idempotencyKeys).values({
        key: `listing_fee_paid:${input.campaignId}`,
        purpose: 'listing_fee_paid',
        completedAt: new Date(),
        result: {
          campaignId: input.campaignId,
          checkoutSessionId: input.checkoutSessionId,
          providerEventId: input.providerEventId,
        },
      });

      const [campaign] = await tx
        .select({
          id: campaigns.id,
          status: campaigns.status,
          listingPaidAt: campaigns.listingPaidAt,
        })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .for('update')
        .limit(1);

      if (!campaign) throw new Unreconciled('the session names a campaign that does not exist');

      // Effect 2's precondition: the calculation the session was created from.
      const [calculation] = await tx
        .select()
        .from(listingFeeCalculations)
        .where(
          and(
            eq(listingFeeCalculations.id, input.calculationId),
            eq(listingFeeCalculations.campaignId, input.campaignId),
          ),
        )
        .limit(1);

      if (!calculation) {
        throw new Unreconciled('the session references a calculation that does not exist');
      }

      // The charge must be the consented amounts, exactly. A mismatch is money
      // that moved outside the record, which no code path may paper over —
      // recorded, routed to a person (§1 rule 6).
      if (
        calculation.subtotalCents !== input.subtotalCents ||
        input.amountTotalCents !== input.subtotalCents + input.taxCents
      ) {
        throw new Unreconciled(
          `charged amounts do not reconcile with calculation ${calculation.id}: ` +
            `calculated subtotal ${calculation.subtotalCents}, charged subtotal ${input.subtotalCents}, ` +
            `charged total ${input.amountTotalCents}, tax ${input.taxCents}`,
        );
      }

      /* Effect 2 — the lock, total. The charged calculation, every optional
         item, and (through them) the high-effort inputs. The triggers installed
         in migration 0012 refuse edits from here on; `evaluateWorkspace` finds
         nothing it may change (§33.3.3's second direction, §33.3.4). */
      const now = new Date();
      await tx
        .update(listingFeeCalculations)
        .set({ lockedAt: now })
        .where(
          and(
            eq(listingFeeCalculations.id, calculation.id),
            isNull(listingFeeCalculations.lockedAt),
          ),
        );
      await tx
        .update(campaignOptionalItems)
        .set({ lockedAt: now, updatedAt: now, updatedBy: input.actor })
        .where(
          and(
            eq(campaignOptionalItems.campaignId, input.campaignId),
            isNull(campaignOptionalItems.lockedAt),
          ),
        );

      /* Effect 1 and effect 5 — the payment record with both §6 clocks,
         computed from the settings in force and stored forever (§29.6). */
      const clocks = await readListingClockSettings(tx);
      const responseDeadlineAt = addHours(input.paidAt, clocks.responseWindowHours);
      const freeCancellationDeadlineAt = addHours(
        input.paidAt,
        clocks.freeCancellationWindowHours,
      );

      const [payment] = await tx
        .insert(listingFeePayments)
        .values({
          campaignId: input.campaignId,
          calculationId: calculation.id,
          mode: gateway.mode,
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId: input.paymentIntentId,
          baseCents: calculation.baseCents,
          discountCents: calculation.discountCents,
          discountLines: calculation.discountLines,
          promotionCents: 0n,
          subtotalCents: input.subtotalCents,
          taxCents: input.taxCents,
          totalCents: input.amountTotalCents,
          taxCalculationId: input.taxCalculationId,
          newsletterOptIn: input.newsletterOptIn,
          newsletterOptInAt: input.newsletterOptIn ? input.paidAt : null,
          paidAt: input.paidAt,
          responseWindowHours: clocks.responseWindowHours,
          responseDeadlineAt,
          freeCancellationWindowHours: clocks.freeCancellationWindowHours,
          freeCancellationDeadlineAt,
          providerEventId: input.providerEventId,
        })
        .returning({ id: listingFeePayments.id });

      /* Effect 3 — the lifecycle hop, with §21's anchor. The campaign may not
         have walked the two earlier hops if payment raced the walk; take them
         now, then the one §23.1 hangs on `listing_paid_at`. */
      await advanceCampaignToListingFeePending(tx, input.campaignId, input.actor);
      const moved = await tx
        .update(campaigns)
        .set({ status: 'affiliate_response_and_build', listingPaidAt: input.paidAt, updatedAt: now })
        .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'listing_fee_pending')))
        .returning({ id: campaigns.id });

      if (moved.length !== 1) {
        // Not a state §23.1 lets a successful payment reach. Roll everything
        // back and let the retry meet a person who has seen the audit row.
        throw new Error(
          `campaign ${input.campaignId} is in status "${campaign.status}" and cannot accept a listing payment`,
        );
      }

      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: 'listing_fee_pending',
        toStatus: 'affiliate_response_and_build',
        actor: input.actor,
      });

      /* Effect 4 — the formal opportunity opens for every eligible
         pre-associated Creator: revealed (`preparing`) and not revoked. A
         kit-revoked association is deliberately NOT opened — §31.5 revocation
         withdrew their access, and granting a larger surface to someone whose
         access an Admin consciously removed would be an access grant nobody
         made. It is recorded for Admin instead. */
      const eligible = await tx
        .select({
          id: campaignAffiliateAssociations.id,
          revokedAt: campaignAffiliateAssociations.kitAccessRevokedAt,
        })
        .from(campaignAffiliateAssociations)
        .where(
          and(
            eq(campaignAffiliateAssociations.campaignId, input.campaignId),
            eq(campaignAffiliateAssociations.status, 'preparing'),
          ),
        )
        .for('update');

      const openedAssociationIds: string[] = [];
      for (const association of eligible) {
        if (association.revokedAt) continue;
        const openedNow = await transitionAssociation(
          association.id,
          'preparing',
          'formal_decision_open',
          input.actor,
          tx,
        );
        if (openedNow) openedAssociationIds.push(association.id);
      }
      const skippedRevoked = eligible.filter((a) => a.revokedAt).map((a) => a.id);

      /* Effect 6 — campaign building starts in parallel. §23.2's separate
         column, moved only from its starting value so a build already underway
         is not reset. */
      await tx
        .update(campaigns)
        .set({ campaignBuildStatus: 'in_progress', updatedAt: now })
        .where(
          and(eq(campaigns.id, input.campaignId), eq(campaigns.campaignBuildStatus, 'not_started')),
        );

      /* The §32.4 ledger's view of the same fact. */
      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'checkout_session',
        providerObjectId: input.checkoutSessionId,
        accountContext: 'platform',
        campaignId: input.campaignId,
        amountCents: input.amountTotalCents,
        amountTaxCents: input.taxCents,
        status: 'complete',
      });
      if (input.paymentIntentId) {
        await recordProviderObject(tx, {
          mode: gateway.mode,
          objectType: 'payment_intent',
          providerObjectId: input.paymentIntentId,
          accountContext: 'platform',
          campaignId: input.campaignId,
          amountCents: input.amountTotalCents,
          amountTaxCents: input.taxCents,
          status: 'succeeded',
        });
      }

      await audit({
        action: 'listing.payment_applied',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason:
          `listing fee paid: session ${input.checkoutSessionId}; calculation ${calculation.id} locked; ` +
          `${openedAssociationIds.length} formal ${openedAssociationIds.length === 1 ? 'opportunity' : 'opportunities'} opened` +
          (skippedRevoked.length > 0
            ? `; ${skippedRevoked.length} revoked association(s) NOT opened — needs Admin review`
            : ''),
        amountCents: input.amountTotalCents,
        currency: 'USD',
        newValue: {
          paymentId: payment!.id,
          paidAt: input.paidAt.toISOString(),
          responseDeadlineAt: responseDeadlineAt.toISOString(),
          freeCancellationDeadlineAt: freeCancellationDeadlineAt.toISOString(),
          skippedRevokedAssociations: skippedRevoked,
        },
        providerObjectIds: {
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId: input.paymentIntentId,
        },
      });

      /* Effect 7 — the notifications — happens after this commits, in
         `notifyListingPayment`: a message about a payment that rolled back
         must never exist, and `notification_deliveries` makes the retry safe. */
      return {
        status: 'applied' as const,
        paymentId: payment!.id,
        paidAt: input.paidAt,
        responseDeadlineAt,
        openedAssociationIds,
        newsletterOptIn: input.newsletterOptIn,
      };
    });
  } catch (error) {
    if (error instanceof Unreconciled) {
      await audit({
        action: 'listing.payment_unreconciled',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason:
          `a signed checkout.session.completed could not be applied: ${error.message}. ` +
          'Recorded and routed to Admin; no domain effect was performed.',
        newValue: { checkoutSessionId: input.checkoutSessionId, providerEventId: input.providerEventId },
      });
      return { status: 'unreconciled', reason: error.message };
    }
    if (isUniqueViolation(error)) {
      // The idempotency key or the unique payment row: this fact is already
      // recorded. A duplicate may update audit and nothing else (§28.3).
      await audit({
        action: 'listing.payment_duplicate_suppressed',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason: `a repeat application for session ${input.checkoutSessionId} changed nothing`,
      });
      return { status: 'duplicate' };
    }
    throw error;
  }
}

/** An anomaly a person must look at. Never applied, always recorded. */
class Unreconciled extends Error {}

/* ── Failure and abandonment (§13, §33.3.5's failure half) ────────────────── */

/**
 * `checkout.session.expired`. The campaign stays `listing_fee_pending`, no
 * clock starts, the Founder's inputs and the calculated fee survive untouched —
 * this records the fact and nothing else, which is the whole point.
 */
export async function recordCheckoutExpired(
  db: Database,
  deps: { gateway: StripeGateway; audit: AuditWriter },
  input: { checkoutSessionId: string; campaignId: string | null; providerEventId: string | null },
): Promise<void> {
  await recordProviderObject(db, {
    mode: deps.gateway.mode,
    objectType: 'checkout_session',
    providerObjectId: input.checkoutSessionId,
    accountContext: 'platform',
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    status: 'expired',
  });

  await deps.audit({
    action: 'listing.checkout_expired',
    targetType: 'campaign',
    targetId: input.campaignId ?? input.checkoutSessionId,
    internalReason:
      `Checkout session ${input.checkoutSessionId} expired without payment. The campaign stays ` +
      'listing_fee_pending, no clock starts, and a fresh attempt duplicates nothing.',
  });
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/** The recorded payment for one campaign, or null while unpaid. */
export async function findListingPayment(
  db: Executor,
  campaignId: string,
): Promise<ListingFeePayment | null> {
  const [row] = await db
    .select()
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

/** The stored session facts, for binding a webhook delivery. */
export async function findStoredSession(db: Executor, gateway: StripeGateway, sessionId: string) {
  return readProviderObject(db, { mode: gateway.mode, providerObjectId: sessionId });
}

/* ── Small helpers ────────────────────────────────────────────────────────── */

function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

/** Walks Drizzle's wrapping to Postgres's unique-violation code. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
