/**
 * The Backer pre-order — Spec §19, §24.2, §33.5.1–12.
 *
 * A real person saves a real card, is charged nothing, and receives proof of
 * that. The order of operations is the whole correctness of this phase:
 *
 *   validate → tax → consent → HOLD capacity → SetupIntent → create reservation.
 *
 * Three of Phase 15's independent correctness problems live in that line:
 *
 *  - Non-US billing and unchecked age fail BEFORE any SetupIntent (§33.5.1).
 *  - The US$50,000 pre-tax cap is held atomically before SetupIntent and released
 *    on failure, so a race never exceeds it (§33.5.10) and a failed setup never
 *    consumes it.
 *  - No reservation exists until SetupIntent succeeds (§33.5.4); a stored tax
 *    calculation and its total are what a later charge is bound to (§33.5.11).
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations, reservationStatusHistory, type Reservation } from '../db/schema/domain.js';
import { founderOperationalShares, backerIdentities } from '../db/schema/reservations.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { validateSurvey, formatCents } from './restated.js';
import { loadPreorderContext, findRewardPackage, type PreorderContext } from './context.js';
import { buildConsent } from './consent.js';
import { calculateReservationTax } from './tax.js';
import {
  readCampaignCapCents,
  ensureCapacityRow,
  reserveCapacity,
  releaseCapacity,
  readCapacity,
} from './capacity.js';
import {
  findOrCreateBackerIdentity,
  recordDedupSignals,
  detectSuspectedDuplicates,
  hasActiveReservation,
} from './dedup.js';
import { resolvePreorderAttribution } from './attribution.js';
import { mintOrReissueMagicLink } from './magic-link.js';
import { sendPreorderConfirmation } from '../notifications/backer.js';

export interface CreatePreorderInput {
  campaignId: string;
  rewardSku: string;
  contact: { email: string; phone: string };
  billing: {
    country: string;
    postalCode: string;
    line1?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
  };
  ageConfirmed: boolean;
  survey: { why: unknown; recommend: unknown };
  operationalSharingAck: boolean;
  founderMarketingConsent: boolean;
  newsletterConsent: boolean;
  /** A PaymentMethod created client-side via Stripe Elements. */
  paymentMethodId: string;
  /** Stabilises the SetupIntent idempotency key across a double-submit. */
  requestId?: string | undefined;
  /** The raw Cookie header, for the §18 winner cookie. */
  attributionCookieHeader?: string | undefined;
  ipHash?: string | null | undefined;
  deviceHash?: string | null | undefined;
}

export interface PreorderDeps {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  tokenService: TokenService;
  notifier?: Notifier | undefined;
  /** BETTER_AUTH_SECRET — for the dedup HMAC and the attribution cookie. */
  secret: string;
  appBaseUrl: string;
  emailFrom?: string | undefined;
}

export type PreorderRefusalCode =
  | 'not_found'
  | 'not_live'
  | 'no_build'
  | 'seller_unavailable'
  | 'reward_not_found'
  | 'reward_sold_out'
  | 'non_us_billing'
  | 'age_not_confirmed'
  | 'operational_ack_required'
  | 'survey_invalid'
  | 'payment_method_required'
  | 'tax_unavailable'
  | 'cap_exceeded'
  | 'setup_failed'
  | 'idea_already_active'
  | 'provider_error';

export interface PreorderRefusal {
  code: PreorderRefusalCode;
  message: string;
  next?: string;
  field?: string;
  /** For a `requires_action` SetupIntent the client must complete and resubmit. */
  clientSecret?: string | null;
}

export interface PreorderSuccess {
  reservationId: string;
  campaignTitle: string;
  founderLegalName: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  chargedToday: string;
  chargeRule: string;
  chargeTimeUtc: string;
  delivery: string;
  statementDescriptor: string;
  magicLinkUrl: string;
  suspectedDuplicate: boolean;
}

export type PreorderResult =
  | { ok: true; reservation: Reservation; success: PreorderSuccess }
  | { ok: false; refusal: PreorderRefusal };

const NOT_CHARGED_LEAD = 'Pre-order saved — you were not charged';

/**
 * §19: the mandatory Founder operational-sharing acknowledgment, disclosed
 * *before* consent. A fixed sentence — it is a promise about what happens to a
 * Backer's data, not Admin's or a Founder's to soften.
 */
export const OPERATIONAL_SHARING_DISCLOSURE =
  'Your email and purchase details are shared with the Founder immediately after you reserve — ' +
  'even though you are not charged today — only so they can prepare fulfillment and provide ' +
  'purchase support. This is not marketing. If you cancel, the Founder is told not to fulfill; ' +
  'information already shared cannot be retracted.';

/** How many active reservations already hold a limited reward (§19 sold-out). */
async function countActiveForReward(db: Database, rewardPackageId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n FROM reservations
    WHERE reward_package_id = ${rewardPackageId} AND status = 'reserved_active'
  `);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/** Reuses a Customer already created for this Backer identity, if any (§33.7.2). */
async function findCustomerForIdentity(db: Database, backerIdentityId: string): Promise<string | null> {
  const [row] = await db
    .select({ customerId: reservations.stripeCustomerId })
    .from(reservations)
    .where(
      and(
        eq(reservations.backerIdentityId, backerIdentityId),
        sql`${reservations.stripeCustomerId} IS NOT NULL`,
      ),
    )
    .orderBy(desc(reservations.createdAt))
    .limit(1);
  return row?.customerId ?? null;
}

function chargeRuleText(context: PreorderContext, closeDateUtc: string): string {
  if (context.model === 'idea') {
    return `Charged only if the campaign reaches its order threshold of ${
      context.orderThreshold ?? 0
    } unique Backers at close (${closeDateUtc}).`;
  }
  return `Charged on the close date (${closeDateUtc}).`;
}

export async function createPreorder(
  deps: PreorderDeps,
  input: CreatePreorderInput,
): Promise<PreorderResult> {
  const { db, gateway } = deps;

  // 1 — the campaign, reward, Founder, seller account.
  const ctxResult = await loadPreorderContext(db, gateway, input.campaignId);
  if (!ctxResult.ok) {
    const messages: Record<string, string> = {
      not_found: 'That campaign could not be found.',
      not_live: 'This campaign is not open for pre-orders right now.',
      no_build: 'This campaign is not ready for pre-orders yet.',
      seller_unavailable: 'This campaign cannot take pre-orders right now.',
    };
    return refuse(ctxResult.code, messages[ctxResult.code] ?? 'Pre-orders are not available.');
  }
  const context = ctxResult.context;

  // 2 — the selected reward and its availability (§19: sold out = visible but unavailable).
  const reward = await findRewardPackage(db, input.campaignId, input.rewardSku);
  if (!reward) return refuse('reward_not_found', 'That reward is no longer available.');
  if (reward.limitedQuantity != null) {
    const taken = await countActiveForReward(db, reward.id);
    if (taken >= reward.limitedQuantity) {
      return refuse('reward_sold_out', 'That reward is sold out.', {
        next: 'Choose another reward to continue.',
      });
    }
  }
  const subtotalCents = reward.priceCents;

  // 3 — eligibility, BEFORE any SetupIntent (§33.5.1).
  if (input.billing.country !== 'US') {
    return refuse('non_us_billing', 'Pre-orders are available to US billing addresses only.', {
      field: 'billing.country',
    });
  }
  if (!input.ageConfirmed) {
    return refuse(
      'age_not_confirmed',
      'Please confirm you are at least 18 and billing in the United States.',
      { field: 'ageConfirmed' },
    );
  }
  if (!input.operationalSharingAck) {
    return refuse(
      'operational_ack_required',
      'Please acknowledge that your email and purchase details are shared with the Founder for fulfillment.',
      { field: 'operationalSharingAck' },
    );
  }
  const survey = validateSurvey(input.survey);
  if (!survey.ok) return refuse('survey_invalid', survey.reason, { field: `survey.${survey.field}` });
  if (!input.paymentMethodId) {
    return refuse('payment_method_required', 'Enter your card to continue.', {
      field: 'paymentMethodId',
    });
  }

  // 3.5 — the practical-unique Backer, and the Idea one-active rule (§4.1, §33.5.7).
  const resolved = await findOrCreateBackerIdentity(db, deps.secret, input.campaignId, input.contact);
  if (context.model === 'idea' && (await hasActiveReservation(db, resolved.identity.id))) {
    return refuse(
      'idea_already_active',
      'You already have an active pre-order on this campaign. Change your reward from your backer page instead.',
    );
  }

  // 4 — reservation-time tax on the Founder seller account (§19, §33.5.11).
  const address = {
    country: input.billing.country,
    postalCode: input.billing.postalCode,
    ...(input.billing.line1 ? { line1: input.billing.line1 } : {}),
    ...(input.billing.city ? { city: input.billing.city } : {}),
    ...(input.billing.state ? { state: input.billing.state } : {}),
  };
  const taxResult = await calculateReservationTax(db, gateway, {
    campaignId: input.campaignId,
    connectedAccountId: context.founder.connectedAccountId,
    subtotalCents,
    address,
    reference: `reservation:${input.campaignId}:${resolved.identity.id}`,
  });
  if (!taxResult.ok) return refuse(taxResult.code, taxResult.message);
  const { tax, totalCents } = taxResult;

  // 5 — the exact consent, resolved from the ledger and hashed (§19, §25.2).
  const consent = buildConsent({
    context,
    rewardTitle: reward.title,
    rewardDelivery: reward.delivery,
    subtotalCents,
    taxCents: tax.taxCents,
  });

  // 6 — HOLD the pre-tax cap atomically, before SetupIntent (§19, §33.5.10).
  const capCents = await readCampaignCapCents(db);
  await ensureCapacityRow(db, input.campaignId, capCents);
  const held = await reserveCapacity(db, input.campaignId, subtotalCents);
  if (!held) {
    return refuse(
      'cap_exceeded',
      'This campaign has reached its reservation capacity. You were not charged.',
      { next: 'You can join the waitlist or try a smaller reward.' },
    );
  }

  let capacityHeld = true;
  try {
    // 7 — the Customer on the Founder connected account (reused per Backer).
    let customerId = await findCustomerForIdentity(db, resolved.identity.id);
    if (!customerId) {
      customerId = await gateway.createCustomer({
        email: input.contact.email,
        connectedAccountId: context.founder.connectedAccountId,
        metadata: {
          proovd_campaign_id: input.campaignId,
          proovd_backer_identity_id: resolved.identity.id,
        },
      });
    }

    // 8 — confirm the off-session SetupIntent (§24.2). Only success continues.
    const idempotencyKey = `setup:${input.campaignId}:${resolved.identity.id}:${
      input.requestId ?? input.paymentMethodId
    }`;
    const setup = await gateway.confirmSetupIntent({
      customerId,
      connectedAccountId: context.founder.connectedAccountId,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey,
      metadata: {
        proovd_campaign_id: input.campaignId,
        proovd_backer_identity_id: resolved.identity.id,
      },
    });

    if (setup.status !== 'succeeded' || !setup.paymentMethodId) {
      // §33.5.4: a setup that is not confirmed creates no reservation, and the
      // held capacity is released so the failure consumes nothing.
      await releaseCapacity(db, input.campaignId, subtotalCents);
      capacityHeld = false;
      return refuse('setup_failed', 'We could not save your card. You were not charged.', {
        next:
          setup.status === 'requires_action'
            ? 'Complete the card verification and try again.'
            : 'Check your card details and try again.',
        clientSecret: setup.clientSecret ?? null,
      });
    }

    // 9 — create the reservation, atomically (§33.5.4).
    const attribution = await resolvePreorderAttribution(
      db,
      deps.secret,
      input.attributionCookieHeader,
      input.campaignId,
    );
    const now = new Date();

    const created = await db.transaction(async (tx) => {
      const [reservation] = await tx
        .insert(reservations)
        .values({
          campaignId: input.campaignId,
          backerIdentityId: resolved.identity.id,
          status: 'reserved_active',
          currency: 'USD',
          rewardSubtotalCents: subtotalCents,
          salesTaxCents: tax.taxCents,
          totalAuthorizedCents: totalCents,
          rewardPackageId: reward.id,
          rewardSku: reward.sku,
          rewardTitle: reward.title,
          rewardDelivery: reward.delivery,
          // §26.5's ledger dimension, stamped by the code that actually made the
          // decision. Reaching this line means the capacity hold succeeded, so
          // the answer is `within_cap` — a refusal returns before any
          // reservation exists (§33.5.4), which is why no row ever carries
          // `rejected_cap_exceeded`.
          capResult: 'within_cap',
          backerEmail: input.contact.email,
          backerPhone: input.contact.phone,
          billingCountry: input.billing.country,
          billingPostalCode: input.billing.postalCode,
          billingLine1: input.billing.line1 ?? null,
          billingCity: input.billing.city ?? null,
          billingState: input.billing.state ?? null,
          ageConfirmed: true,
          ageConfirmedVersion: consent.version,
          ageConfirmedAt: now,
          taxCalculationId: tax.id,
          taxJurisdiction: tax.jurisdiction,
          taxRate: tax.rate,
          taxabilityReason: tax.taxabilityReason,
          taxCalculationExpiresAt: tax.expiresAt,
          taxCalculatedAt: now,
          stripeCustomerId: customerId,
          setupIntentId: setup.id,
          paymentMethodId: setup.paymentMethodId,
          paymentMethodFingerprint: setup.fingerprint,
          paymentMethodBrand: setup.brand,
          paymentMethodLast4: setup.last4,
          consentAppendix: consent.appendix,
          consentVersion: consent.version,
          consentHash: consent.hash,
          consentText: consent.text,
          policyVersions: {
            referenced: ['terms', 'acceptable-use', 'refund', 'fulfillment', 'privacy'],
            founderRefundPolicy: context.refundPolicy,
          },
          surveyWhy: survey.value.why,
          surveyRecommend: survey.value.recommend,
          operationalSharingAck: true,
          operationalSharingAckVersion: consent.version,
          operationalSharingAckAt: now,
          founderMarketingConsent: input.founderMarketingConsent,
          founderMarketingConsentAt: input.founderMarketingConsent ? now : null,
          newsletterConsent: input.newsletterConsent,
          newsletterConsentAt: input.newsletterConsent ? now : null,
          attributionSource: attribution.source,
          attributionTrackingLinkId: attribution.trackingLinkId,
          attributionAssociationId: attribution.associationId,
          attributionClickedAt: attribution.clickedAt,
          attributionStatus: attribution.status,
          sameDeviceLimitation: attribution.sameDeviceLimitation,
          statementDescriptor: context.statementDescriptor,
          reservedAt: now,
        })
        .returning();

      await tx.insert(reservationStatusHistory).values({
        reservationId: reservation!.id,
        fromStatus: null,
        toStatus: 'reserved_active',
        actor: `backer:${resolved.identity.id}`,
      });

      // §25.3 signal record + §4.1 suspected-duplicate cases (never IP alone).
      await recordDedupSignals(tx, {
        campaignId: input.campaignId,
        reservationId: reservation!.id,
        backerIdentityId: resolved.identity.id,
        material: resolved.material,
        paymentFingerprint: setup.fingerprint,
        deviceHash: input.deviceHash ?? null,
        ipHash: input.ipHash ?? null,
      });
      const cases = await detectSuspectedDuplicates(tx, {
        campaignId: input.campaignId,
        identity: resolved.identity,
        material: resolved.material,
        paymentFingerprint: setup.fingerprint,
      });

      // §19: immediate, mandatory Founder operational share — email + purchase
      // details, no survey PII. Immutable once shared (trigger).
      await tx.insert(founderOperationalShares).values({
        reservationId: reservation!.id,
        campaignId: input.campaignId,
        founderUserId: `founder:${context.founder.userId}`,
        backerEmail: input.contact.email,
        rewardSku: reward.sku,
        rewardTitle: reward.title,
        purchaseDetail: {
          rewardSku: reward.sku,
          rewardTitle: reward.title,
          delivery: reward.delivery,
          subtotalCents: subtotalCents.toString(),
          totalAuthorizedCents: totalCents.toString(),
        },
        fulfillmentState: 'active',
      });

      // §32.4 provider objects, tied to the reservation.
      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'customer',
        providerObjectId: customerId!,
        accountContext: 'connected',
        stripeAccountId: context.founder.connectedAccountId,
        campaignId: input.campaignId,
        reservationId: reservation!.id,
      });
      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'setup_intent',
        providerObjectId: setup.id,
        accountContext: 'connected',
        stripeAccountId: context.founder.connectedAccountId,
        campaignId: input.campaignId,
        reservationId: reservation!.id,
        status: 'succeeded',
      });
      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'payment_method',
        providerObjectId: setup.paymentMethodId!,
        accountContext: 'connected',
        stripeAccountId: context.founder.connectedAccountId,
        campaignId: input.campaignId,
        reservationId: reservation!.id,
        amountDetail: { fingerprint: setup.fingerprint, brand: setup.brand, last4: setup.last4 },
      });

      return { reservation: reservation!, cases };
    });

    // The reservation now owns the held capacity; never release it from here.
    capacityHeld = false;

    // 10 — the magic link (minted or reissued) and the confirmation (§19 step 12).
    const link = await mintOrReissueMagicLink(
      { db, tokenService: deps.tokenService, appBaseUrl: deps.appBaseUrl },
      { campaignId: input.campaignId, backerIdentityId: resolved.identity.id },
    );

    await deps.audit({
      action: 'reservation.created',
      targetType: 'reservation',
      targetId: created.reservation.id,
      internalReason:
        `pre-order saved: reward ${reward.sku}, SetupIntent ${setup.id} succeeded, ` +
        `US$0 charged; ${created.cases.length} suspected-duplicate case(s) opened`,
      amountCents: totalCents,
      currency: 'USD',
      actorId: `backer:${resolved.identity.id}`,
      newValue: {
        rewardSku: reward.sku,
        subtotalCents: subtotalCents.toString(),
        taxCents: tax.taxCents.toString(),
        totalAuthorizedCents: totalCents.toString(),
        setupIntentId: setup.id,
        attributionSource: attribution.source,
        suspectedDuplicateCases: created.cases,
      },
      providerObjectIds: { setupIntentId: setup.id, customerId },
    });

    const success: PreorderSuccess = {
      reservationId: created.reservation.id,
      campaignTitle: context.title,
      founderLegalName: context.founder.legalName,
      rewardTitle: reward.title,
      rewardSubtotal: consent.rewardSubtotal,
      salesTax: consent.salesTax,
      totalAuthorized: consent.totalAuthorized,
      chargedToday: formatCents(0n),
      chargeRule: chargeRuleText(context, consent.closeDateUtc),
      chargeTimeUtc: consent.closeDateUtc,
      delivery: reward.delivery,
      statementDescriptor: context.statementDescriptor,
      magicLinkUrl: link.url,
      suspectedDuplicate: created.cases.length > 0,
    };

    // The confirmation email (B.2). A provider refusal is recorded, never
    // rolled back onto the reservation — the saved card is the valuable thing.
    if (deps.notifier && deps.emailFrom) {
      await sendPreorderConfirmation(
        { notifier: deps.notifier, from: deps.emailFrom },
        {
          to: input.contact.email,
          reservationId: created.reservation.id,
          lead: NOT_CHARGED_LEAD,
          success,
        },
      );
    }

    return { ok: true, reservation: created.reservation, success };
  } catch (error) {
    if (capacityHeld) await releaseCapacity(db, input.campaignId, subtotalCents);
    await deps.audit({
      action: 'reservation.create_failed',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `pre-order failed after capacity hold: ${
        error instanceof Error ? error.message : String(error)
      }. Capacity released; no reservation created.`,
    });
    return refuse('provider_error', 'We could not complete your pre-order. You were not charged.', {
      next: 'Nothing you entered was lost. Try again in a moment.',
    });
  }

  function refuse(
    code: PreorderRefusalCode,
    message: string,
    extra?: { next?: string; field?: string; clientSecret?: string | null },
  ): { ok: false; refusal: PreorderRefusal } {
    return {
      ok: false,
      refusal: {
        code,
        message,
        ...(extra?.next ? { next: extra.next } : {}),
        ...(extra?.field ? { field: extra.field } : {}),
        ...(extra?.clientSecret !== undefined ? { clientSecret: extra.clientSecret } : {}),
      },
    };
  }
}

/* ── The checkout quote (§19 step 5, §33.5.2) ─────────────────────────────── */

export interface PreorderQuote {
  campaignTitle: string;
  founderLegalName: string;
  rewardSku: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  chargedToday: string;
  chargeRule: string;
  chargeTimeUtc: string;
  delivery: string;
  statementDescriptor: string;
  consentAppendix: 'A.3' | 'A.4';
  consentText: string;
  marketingLabel: string;
  sharingDisclosure: string;
  cancellationPath: string;
  capacity: { capCents: string; reservedSubtotalCents: string } | null;
}

export type PreorderQuoteResult =
  | { ok: true; quote: PreorderQuote }
  | { ok: false; refusal: PreorderRefusal };

/**
 * Computes and displays the exact amounts, trigger, delivery, seller,
 * descriptor, cancel path, and sharing disclosure §33.5.2 requires — before any
 * card is entered and without creating anything. The tax is a real Stripe Tax
 * calculation at the given address, so the total the surface shows is the total
 * the consent will name (§19 step 5).
 */
export async function quotePreorder(
  deps: Pick<PreorderDeps, 'db' | 'gateway'>,
  input: {
    campaignId: string;
    rewardSku: string;
    billing: {
      country: string;
      postalCode: string;
      line1?: string | undefined;
      city?: string | undefined;
      state?: string | undefined;
    };
  },
): Promise<PreorderQuoteResult> {
  const ctxResult = await loadPreorderContext(deps.db, deps.gateway, input.campaignId);
  if (!ctxResult.ok) {
    return {
      ok: false,
      refusal: { code: ctxResult.code, message: 'Pre-orders are not available.' },
    };
  }
  const context = ctxResult.context;

  const reward = await findRewardPackage(deps.db, input.campaignId, input.rewardSku);
  if (!reward) {
    return {
      ok: false,
      refusal: { code: 'reward_not_found', message: 'That reward is no longer available.' },
    };
  }

  const address = {
    country: input.billing.country,
    postalCode: input.billing.postalCode,
    ...(input.billing.line1 ? { line1: input.billing.line1 } : {}),
    ...(input.billing.city ? { city: input.billing.city } : {}),
    ...(input.billing.state ? { state: input.billing.state } : {}),
  };
  const taxResult = await calculateReservationTax(deps.db, deps.gateway, {
    campaignId: input.campaignId,
    connectedAccountId: context.founder.connectedAccountId,
    subtotalCents: reward.priceCents,
    address,
    reference: `quote:${input.campaignId}:${reward.sku}`,
  });
  if (!taxResult.ok) {
    return { ok: false, refusal: { code: taxResult.code, message: taxResult.message } };
  }

  const consent = buildConsent({
    context,
    rewardTitle: reward.title,
    rewardDelivery: reward.delivery,
    subtotalCents: reward.priceCents,
    taxCents: taxResult.tax.taxCents,
  });

  const capacity = await readCapacity(deps.db, input.campaignId);

  return {
    ok: true,
    quote: {
      campaignTitle: context.title,
      founderLegalName: context.founder.legalName,
      rewardSku: reward.sku,
      rewardTitle: reward.title,
      rewardSubtotal: consent.rewardSubtotal,
      salesTax: consent.salesTax,
      totalAuthorized: consent.totalAuthorized,
      chargedToday: formatCents(0n),
      chargeRule: chargeRuleText(context, consent.closeDateUtc),
      chargeTimeUtc: consent.closeDateUtc,
      delivery: reward.delivery,
      statementDescriptor: context.statementDescriptor,
      consentAppendix: consent.appendix,
      consentText: consent.text,
      marketingLabel: consent.marketingLabel,
      sharingDisclosure: OPERATIONAL_SHARING_DISCLOSURE,
      cancellationPath: 'Cancel free any time before the charge date from your backer page.',
      capacity: capacity
        ? {
            capCents: capacity.capCents.toString(),
            reservedSubtotalCents: capacity.reservedSubtotalCents.toString(),
          }
        : null,
    },
  };
}

/* ── The Idea reward change (§19, §33.5.8) ────────────────────────────────── */

export interface ReplaceIdeaRewardInput {
  campaignId: string;
  backerIdentityId: string;
  newRewardSku: string;
  billing: CreatePreorderInput['billing'];
  paymentMethodId: string;
  requestId?: string | undefined;
}

/**
 * Changes an Idea Backer's reward through a replacement that must complete
 * before the old selection is replaced (§19). The tempting implementation —
 * cancel the old, then create the new — loses the Backer's place if the new
 * SetupIntent fails; §33.5.8 requires the opposite. So the new reservation's
 * capacity is held and its SetupIntent confirmed first, and only on success is
 * the old one canceled. A failure leaves the old selection exactly as it was.
 */
export async function replaceIdeaReward(
  deps: PreorderDeps,
  input: ReplaceIdeaRewardInput,
): Promise<PreorderResult> {
  const { db, gateway } = deps;

  const ctxResult = await loadPreorderContext(db, gateway, input.campaignId);
  if (!ctxResult.ok) {
    return failReplace(ctxResult.code, 'Pre-orders are not available.');
  }
  const context = ctxResult.context;
  if (context.model !== 'idea') {
    return failReplace('provider_error', 'Only Idea campaigns support a reward change.');
  }

  const [oldReservation] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.backerIdentityId, input.backerIdentityId),
        eq(reservations.campaignId, input.campaignId),
        eq(reservations.status, 'reserved_active'),
      ),
    )
    .orderBy(desc(reservations.createdAt))
    .limit(1);
  if (!oldReservation) {
    return failReplace('idea_already_active', 'You have no active pre-order to change.');
  }

  const reward = await findRewardPackage(db, input.campaignId, input.newRewardSku);
  if (!reward) return failReplace('reward_not_found', 'That reward is no longer available.');
  if (input.billing.country !== 'US') return failReplace('non_us_billing', 'US billing only.');

  const [identity] = await db
    .select()
    .from(backerIdentities)
    .where(eq(backerIdentities.id, input.backerIdentityId))
    .limit(1);
  if (!identity) return failReplace('idea_already_active', 'Backer not found.');

  const address = {
    country: input.billing.country,
    postalCode: input.billing.postalCode,
    ...(input.billing.line1 ? { line1: input.billing.line1 } : {}),
    ...(input.billing.city ? { city: input.billing.city } : {}),
    ...(input.billing.state ? { state: input.billing.state } : {}),
  };
  const taxResult = await calculateReservationTax(db, gateway, {
    campaignId: input.campaignId,
    connectedAccountId: context.founder.connectedAccountId,
    subtotalCents: reward.priceCents,
    address,
    reference: `reservation-change:${input.campaignId}:${identity.id}:${reward.sku}`,
  });
  if (!taxResult.ok) return failReplace(taxResult.code, taxResult.message);
  const { tax, totalCents } = taxResult;

  const consent = buildConsent({
    context,
    rewardTitle: reward.title,
    rewardDelivery: reward.delivery,
    subtotalCents: reward.priceCents,
    taxCents: tax.taxCents,
  });

  // Hold capacity for the NEW reward before its SetupIntent. The old reward's
  // capacity is released only if this whole change commits.
  const capCents = await readCampaignCapCents(db);
  await ensureCapacityRow(db, input.campaignId, capCents);
  const held = await reserveCapacity(db, input.campaignId, reward.priceCents);
  if (!held) {
    return failReplace('cap_exceeded', 'The campaign has no capacity for that reward right now.');
  }

  let capacityHeld = true;
  try {
    const customerId =
      oldReservation.stripeCustomerId ??
      (await gateway.createCustomer({
        email: identity.email,
        connectedAccountId: context.founder.connectedAccountId,
      }));

    const setup = await gateway.confirmSetupIntent({
      customerId,
      connectedAccountId: context.founder.connectedAccountId,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `setup-change:${input.campaignId}:${identity.id}:${
        input.requestId ?? input.paymentMethodId
      }`,
      metadata: { proovd_campaign_id: input.campaignId, proovd_reward_change: '1' },
    });

    if (setup.status !== 'succeeded' || !setup.paymentMethodId) {
      // §33.5.8: the replacement did not complete — release the new hold and
      // leave the old selection active, untouched.
      await releaseCapacity(db, input.campaignId, reward.priceCents);
      capacityHeld = false;
      return failReplace('setup_failed', 'We could not save your card. Your original pre-order is unchanged.');
    }

    const now = new Date();
    const created = await db.transaction(async (tx) => {
      const [newReservation] = await tx
        .insert(reservations)
        .values({
          campaignId: input.campaignId,
          backerIdentityId: identity.id,
          status: 'reserved_active',
          currency: 'USD',
          rewardSubtotalCents: reward.priceCents,
          salesTaxCents: tax.taxCents,
          totalAuthorizedCents: totalCents,
          rewardPackageId: reward.id,
          rewardSku: reward.sku,
          rewardTitle: reward.title,
          rewardDelivery: reward.delivery,
          // §26.5, as above: the replacement reservation also passed the hold.
          capResult: 'within_cap',
          backerEmail: identity.email,
          backerPhone: identity.phone,
          billingCountry: input.billing.country,
          billingPostalCode: input.billing.postalCode,
          billingLine1: input.billing.line1 ?? null,
          billingCity: input.billing.city ?? null,
          billingState: input.billing.state ?? null,
          ageConfirmed: true,
          ageConfirmedVersion: consent.version,
          ageConfirmedAt: now,
          taxCalculationId: tax.id,
          taxJurisdiction: tax.jurisdiction,
          taxRate: tax.rate,
          taxabilityReason: tax.taxabilityReason,
          taxCalculationExpiresAt: tax.expiresAt,
          taxCalculatedAt: now,
          stripeCustomerId: customerId,
          setupIntentId: setup.id,
          paymentMethodId: setup.paymentMethodId,
          paymentMethodFingerprint: setup.fingerprint,
          paymentMethodBrand: setup.brand,
          paymentMethodLast4: setup.last4,
          consentAppendix: consent.appendix,
          consentVersion: consent.version,
          consentHash: consent.hash,
          consentText: consent.text,
          surveyWhy: oldReservation.surveyWhy,
          surveyRecommend: oldReservation.surveyRecommend,
          operationalSharingAck: true,
          operationalSharingAckVersion: consent.version,
          operationalSharingAckAt: now,
          founderMarketingConsent: oldReservation.founderMarketingConsent,
          founderMarketingConsentAt: oldReservation.founderMarketingConsentAt,
          newsletterConsent: oldReservation.newsletterConsent,
          newsletterConsentAt: oldReservation.newsletterConsentAt,
          attributionSource: oldReservation.attributionSource,
          attributionTrackingLinkId: oldReservation.attributionTrackingLinkId,
          attributionAssociationId: oldReservation.attributionAssociationId,
          attributionClickedAt: oldReservation.attributionClickedAt,
          attributionStatus: oldReservation.attributionStatus,
          sameDeviceLimitation: oldReservation.sameDeviceLimitation,
          statementDescriptor: context.statementDescriptor,
          replacesReservationId: oldReservation.id,
          reservedAt: now,
        })
        .returning();

      await tx.insert(reservationStatusHistory).values({
        reservationId: newReservation!.id,
        fromStatus: null,
        toStatus: 'reserved_active',
        actor: `backer:${identity.id}`,
      });

      // Cancel the old selection now that the new one is committed.
      await tx
        .update(reservations)
        .set({
          status: 'reserved_canceled',
          canceledAt: now,
          replacedByReservationId: newReservation!.id,
          updatedAt: now,
        })
        .where(and(eq(reservations.id, oldReservation.id), eq(reservations.status, 'reserved_active')));
      await tx.insert(reservationStatusHistory).values({
        reservationId: oldReservation.id,
        fromStatus: 'reserved_active',
        toStatus: 'reserved_canceled',
        actor: `backer:${identity.id}`,
      });

      // The old reward's capacity returns; the new reward's hold stands.
      await releaseCapacity(tx, input.campaignId, oldReservation.rewardSubtotalCents);

      // The old operational share becomes do-not-fulfill; a new one is shared.
      await tx
        .update(founderOperationalShares)
        .set({ fulfillmentState: 'do_not_fulfill', doNotFulfillAt: now, deliveryStatus: 'do_not_fulfill' })
        .where(eq(founderOperationalShares.reservationId, oldReservation.id));
      await tx.insert(founderOperationalShares).values({
        reservationId: newReservation!.id,
        campaignId: input.campaignId,
        founderUserId: `founder:${context.founder.userId}`,
        backerEmail: identity.email,
        rewardSku: reward.sku,
        rewardTitle: reward.title,
        purchaseDetail: {
          rewardSku: reward.sku,
          rewardTitle: reward.title,
          delivery: reward.delivery,
          subtotalCents: reward.priceCents.toString(),
          totalAuthorizedCents: totalCents.toString(),
          replacesReservationId: oldReservation.id,
        },
        fulfillmentState: 'active',
      });

      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'setup_intent',
        providerObjectId: setup.id,
        accountContext: 'connected',
        stripeAccountId: context.founder.connectedAccountId,
        campaignId: input.campaignId,
        reservationId: newReservation!.id,
        status: 'succeeded',
      });

      return newReservation!;
    });

    // The new reservation owns the new hold; the old hold was released inside
    // the transaction. Nothing to release from here.
    capacityHeld = false;

    const link = await mintOrReissueMagicLink(
      { db, tokenService: deps.tokenService, appBaseUrl: deps.appBaseUrl },
      { campaignId: input.campaignId, backerIdentityId: identity.id },
    );

    await deps.audit({
      action: 'reservation.reward_changed',
      targetType: 'reservation',
      targetId: created.id,
      internalReason: `Idea reward changed to ${reward.sku}; reservation ${oldReservation.id} canceled and replaced`,
      amountCents: totalCents,
      currency: 'USD',
      actorId: `backer:${identity.id}`,
      newValue: { replacesReservationId: oldReservation.id, newRewardSku: reward.sku },
    });

    const success: PreorderSuccess = {
      reservationId: created.id,
      campaignTitle: context.title,
      founderLegalName: context.founder.legalName,
      rewardTitle: reward.title,
      rewardSubtotal: consent.rewardSubtotal,
      salesTax: consent.salesTax,
      totalAuthorized: consent.totalAuthorized,
      chargedToday: formatCents(0n),
      chargeRule: chargeRuleText(context, consent.closeDateUtc),
      chargeTimeUtc: consent.closeDateUtc,
      delivery: reward.delivery,
      statementDescriptor: context.statementDescriptor,
      magicLinkUrl: link.url,
      suspectedDuplicate: false,
    };
    return { ok: true, reservation: created, success };
  } catch (error) {
    if (capacityHeld) await releaseCapacity(db, input.campaignId, reward.priceCents);
    await deps.audit({
      action: 'reservation.reward_change_failed',
      targetType: 'reservation',
      targetId: oldReservation.id,
      internalReason: `reward change failed: ${
        error instanceof Error ? error.message : String(error)
      }. Original pre-order unchanged.`,
    });
    return failReplace('provider_error', 'We could not change your reward. Your original pre-order is unchanged.');
  }

  function failReplace(code: PreorderRefusalCode, message: string): { ok: false; refusal: PreorderRefusal } {
    return { ok: false, refusal: { code, message } };
  }
}
