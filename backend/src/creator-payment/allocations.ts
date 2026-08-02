/**
 * The optional fixed Creator payment — the allocation and its funding — Spec
 * §16, §24.7, §14.3, §33.4.3.
 *
 * The fourth money stream. Where a fixed Creator payment was mutually accepted
 * through one proposal version (§14.2), the Founder funds it in full before any
 * work begins:
 *
 *   `ensureAllocation`        creates the ONE allocation for the exact accepted
 *                             amount, idempotently. Refuses an Idea Campaign — a
 *                             database trigger backs the refusal (§14.3, §16).
 *   `beginAllocationFunding`  the Founder's Checkout on the platform account.
 *   `applyAllocationFunding`  the webhook apply. Exact full amount only; a
 *                             partial, wrong, or duplicate charge cannot mark it
 *                             `funded` (§33.4.3).
 *   `setFundingDeadline`      the Admin-configured funding deadline (§16).
 *
 * ── Funded is not paid ──────────────────────────────────────────────────────
 * §16: `funded` means the Founder secured the amount, not that the Creator
 * earned it. Whether it becomes `paid` or `returned` is §22.1's completion
 * outcome — Phase 19. This module reaches `funded`.
 *
 * ── Never a holding-account word ────────────────────────────────────────────
 * §3.2's forbidden holding-account vocabulary is refused anywhere (§16, §3.1).
 * The allocation is *secured* and, once funded, *funded* — never described with
 * §3.2's replaced terms, and never as money already paid to the Creator.
 *
 * ── Idempotency keys are stable, for the phases that reuse them ─────────────
 * §16 requires funding, return, finalization, and Transfer to each use a stable
 * idempotency key. `creatorPaymentKeys` names all four so Phase 19 reuses the
 * same scheme rather than inventing a second one.
 */

import { and, eq, isNull, isNotNull, lte, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  creatorPaymentAllocations,
  creatorPaymentFundingAttempts,
  type CreatorPaymentAllocation,
} from '../db/schema/creator-payment.js';
import { associationCompensationAgreements } from '../db/schema/decisions.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { recordProviderObject } from '../payments/provider-objects.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/**
 * §24.7's "tax/accounting treatment", recorded rather than computed. The stream
 * carries no sales tax (§24.7), and the funding charge is not a sale of goods;
 * the final tax treatment on release follows §22.1 and the §11
 * tax-accountability configuration in Phase 19. A recorded classification, not
 * an invented tax rule (§1 rule 6).
 */
export const FUNDING_TAX_TREATMENT =
  'Founder-funded secured Creator payment, held as a Proovd liability pending the ' +
  '§22.1 completion outcome. Not a taxable sale; §24.7 excludes sales tax from this ' +
  'stream. Release-time tax/accounting follows §22.1 and the §11 tax-accountability ' +
  'configuration (Phase 19).';

/** The metadata discriminator that routes a Checkout webhook to this stream. */
export const FUNDING_PURPOSE = 'creator_payment_funding';

/** §16: the four stable idempotency keys. Funding is used here; the rest Phase 19. */
export const creatorPaymentKeys = {
  funding: (allocationId: string): string => `creator_payment_funded:${allocationId}`,
  fundingSession: (allocationId: string, amountCents: bigint): string =>
    `creator-payment-funding:${allocationId}:${amountCents}`,
  return: (allocationId: string): string => `creator-payment-return:${allocationId}`,
  finalization: (allocationId: string): string => `creator-payment-finalized:${allocationId}`,
  transfer: (allocationId: string): string => `creator-payment-transfer:${allocationId}`,
} as const;

/* ── Ensuring the one allocation (§16 step 1) ──────────────────────────────── */

export type EnsureAllocationResult =
  | { status: 'ok'; allocation: CreatorPaymentAllocation }
  | { status: 'not_applicable' };

/**
 * Creates the ONE allocation for an association whose mutually accepted version
 * carried a fixed payment, at the exact accepted amount. Idempotent by the
 * unique association index. Refuses an Idea Campaign loudly — a fixed request
 * that reached this point on an Idea campaign means Phase 12's validation
 * failed (§16's trap), and the database trigger refuses it besides.
 */
export async function ensureAllocation(
  db: Executor,
  gateway: StripeGateway,
  associationId: string,
): Promise<EnsureAllocationResult> {
  const [agreement] = await db
    .select()
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, associationId))
    .limit(1);

  if (!agreement || agreement.fixedPaymentCents === null) {
    return { status: 'not_applicable' };
  }
  if (!agreement.proposalVersionId) {
    // A fixed payment only ever arrives through a version (§14.2). An agreement
    // with a fixed amount and no version is a Phase 12 corruption, not a state
    // to paper over.
    throw new Error(
      `agreement ${agreement.id} carries a fixed payment with no proposal version — §14.2 violated`,
    );
  }

  const [campaign] = await db
    .select({ type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, agreement.campaignId))
    .limit(1);
  if (campaign?.type === 'pre_build') {
    throw new Error(
      'a fixed Creator payment is prohibited on an Idea Campaign — Phase 12 validation failed (§14.3, §16)',
    );
  }

  await db
    .insert(creatorPaymentAllocations)
    .values({
      associationId,
      campaignId: agreement.campaignId,
      proposalVersionId: agreement.proposalVersionId,
      agreementId: agreement.id,
      mode: gateway.mode,
      amountCents: agreement.fixedPaymentCents,
      taxTreatment: FUNDING_TAX_TREATMENT,
    })
    .onConflictDoNothing();

  const [allocation] = await db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.associationId, associationId))
    .limit(1);

  return allocation ? { status: 'ok', allocation } : { status: 'not_applicable' };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function findAllocation(
  db: Executor,
  associationId: string,
): Promise<CreatorPaymentAllocation | null> {
  const [row] = await db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.associationId, associationId))
    .limit(1);
  return row ?? null;
}

/** True when the fixed allocation is fully funded (or paid). §16 item 12. */
export function allocationFunded(allocation: CreatorPaymentAllocation | null): boolean {
  return allocation !== null && (allocation.status === 'funded' || allocation.status === 'paid');
}

/* ── Beginning funding (§16 step 2) ────────────────────────────────────────── */

export type BeginFundingRefusal =
  | 'not_applicable'
  | 'already_funded'
  | 'canceled'
  | 'provider_error';

export type BeginFundingResult =
  | { ok: true; sessionId: string; url: string; amountCents: bigint }
  | { ok: false; code: BeginFundingRefusal; message: string; next: string };

export interface BeginFundingContext {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The Founder funds the allocation in full on the platform account. Idempotent
 * at the provider: the stable session key returns the same session for the same
 * allocation and amount, so a double-click cannot mint two charges (§16, §33.4.3).
 */
export async function beginAllocationFunding(
  context: BeginFundingContext,
  input: { associationId: string; founderUserId: string; founderEmail?: string | undefined; actor: string },
): Promise<BeginFundingResult> {
  const { db, gateway, audit } = context;

  const ensured = await ensureAllocation(db, gateway, input.associationId);
  if (ensured.status !== 'ok') {
    return {
      ok: false,
      code: 'not_applicable',
      message: 'There is no fixed Creator payment to fund for this Creator.',
      next: 'Nothing is due.',
    };
  }
  const allocation = ensured.allocation;

  if (allocation.canceledAt) {
    return {
      ok: false,
      code: 'canceled',
      message: 'This fixed Creator payment was canceled.',
      next: 'Contact support if you think this is wrong.',
    };
  }
  if (allocationFunded(allocation)) {
    return {
      ok: false,
      code: 'already_funded',
      message: 'This fixed Creator payment is already funded in full.',
      next: 'Nothing more is due. Your receipt is in your email.',
    };
  }

  try {
    const sessionKey = creatorPaymentKeys.fundingSession(allocation.id, allocation.amountCents);
    const session = await gateway.createFundingCheckoutSession({
      customerEmail: input.founderEmail,
      amountCents: allocation.amountCents,
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
      idempotencyKey: sessionKey,
      metadata: {
        proovd_purpose: FUNDING_PURPOSE,
        proovd_campaign_id: allocation.campaignId,
        proovd_association_id: allocation.associationId,
        proovd_allocation_id: allocation.id,
        proovd_amount_cents: allocation.amountCents.toString(),
      },
    });

    await recordProviderObject(db, {
      mode: gateway.mode,
      objectType: 'checkout_session',
      providerObjectId: session.id,
      accountContext: 'platform',
      campaignId: allocation.campaignId,
      associationId: allocation.associationId,
      ownerUserId: input.founderUserId,
      amountCents: allocation.amountCents,
      status: 'open',
      idempotencyKey: sessionKey,
      amountDetail: { purpose: FUNDING_PURPOSE, allocationId: allocation.id },
    });

    await audit({
      action: 'creator_payment.funding_opened',
      targetType: 'campaign_affiliate_association',
      targetId: allocation.associationId,
      internalReason: `funding Checkout ${session.id} opened for the secured Creator payment (${allocation.amountCents} cents)`,
      amountCents: allocation.amountCents,
      currency: 'USD',
      newValue: { allocationId: allocation.id, sessionId: session.id },
      actorId: input.founderUserId,
    });

    return { ok: true, sessionId: session.id, url: session.url, amountCents: allocation.amountCents };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await audit({
      action: 'creator_payment.funding_open_failed',
      targetType: 'campaign_affiliate_association',
      targetId: allocation.associationId,
      internalReason: `the provider refused to open funding Checkout: ${reason}`,
      actorId: input.founderUserId,
    });
    return {
      ok: false,
      code: 'provider_error',
      message: 'We could not open the payment page just now. Nothing has been charged.',
      next: 'Try again in a moment. If it keeps happening, contact support.',
    };
  }
}

/* ── Applying funding (§16 step 2, §33.4.3) ────────────────────────────────── */

export type ApplyFundingOutcome =
  | { status: 'funded'; allocationId: string; associationId: string; campaignId: string }
  | { status: 'duplicate' }
  /** Partial, wrong-amount, or otherwise not the exact full amount. Not funded. */
  | { status: 'rejected'; reason: string }
  | { status: 'unreconciled'; reason: string };

export interface ApplyFundingInput {
  allocationId: string;
  campaignId: string;
  associationId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  /** What Stripe says was charged. Verified against the exact accepted amount. */
  amountTotalCents: bigint;
  paidAt: Date;
  providerEventId: string | null;
  actor: string;
}

/**
 * §16 step 2, in one transaction. The exact full amount marks `funded`; a
 * partial or wrong amount records a failed attempt and leaves the allocation
 * `payment_failed` — never `funded` (§33.4.3's trap). A duplicate under a fresh
 * event id changes nothing: the `creator_payment_funded:<id>` idempotency key
 * and the unique attempt session both make a second success impossible.
 */
export async function applyAllocationFunding(
  db: Database,
  deps: { gateway: StripeGateway; audit: AuditWriter },
  input: ApplyFundingInput,
): Promise<ApplyFundingOutcome> {
  const { gateway, audit } = deps;

  try {
    return await db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(creatorPaymentAllocations)
        .where(eq(creatorPaymentAllocations.id, input.allocationId))
        .for('update')
        .limit(1);

      if (
        !allocation ||
        allocation.campaignId !== input.campaignId ||
        allocation.associationId !== input.associationId
      ) {
        throw new Unreconciled('the funding session names an allocation that does not reconcile');
      }

      // §33.4.3: partial funding is rejected outright — not held, not queued,
      // rejected. The amount charged must be the exact accepted amount.
      if (input.amountTotalCents !== allocation.amountCents) {
        await tx
          .insert(creatorPaymentFundingAttempts)
          .values({
            allocationId: allocation.id,
            campaignId: allocation.campaignId,
            associationId: allocation.associationId,
            mode: gateway.mode,
            checkoutSessionId: input.checkoutSessionId,
            paymentIntentId: input.paymentIntentId,
            amountCents: input.amountTotalCents > 0n ? input.amountTotalCents : allocation.amountCents,
            status: 'failed',
            idempotencyKey: creatorPaymentKeys.fundingSession(allocation.id, allocation.amountCents),
            failureCode: 'amount_mismatch',
            failureMessage: `charged ${input.amountTotalCents} against an accepted allocation of ${allocation.amountCents}`,
            providerEventId: input.providerEventId,
          })
          .onConflictDoNothing();

        // Preserve the accepted amount, block work — but never overwrite a
        // funded/paid allocation.
        await tx
          .update(creatorPaymentAllocations)
          .set({ status: 'payment_failed', updatedAt: new Date() })
          .where(
            and(
              eq(creatorPaymentAllocations.id, allocation.id),
              ne(creatorPaymentAllocations.status, 'funded'),
              ne(creatorPaymentAllocations.status, 'paid'),
            ),
          );

        await audit({
          action: 'creator_payment.funding_rejected',
          targetType: 'campaign_affiliate_association',
          targetId: allocation.associationId,
          internalReason:
            `funding was NOT the exact accepted amount: charged ${input.amountTotalCents}, ` +
            `accepted ${allocation.amountCents}. Partial funding is rejected (§16); the accepted amount is preserved and work stays blocked.`,
          amountCents: input.amountTotalCents,
          currency: 'USD',
        });
        return { status: 'rejected' as const, reason: 'amount_mismatch' };
      }

      // Already funded: a duplicate under a fresh event id or a repeat session.
      if (allocation.status === 'funded' || allocation.status === 'paid') {
        await audit({
          action: 'creator_payment.funding_duplicate_suppressed',
          targetType: 'campaign_affiliate_association',
          targetId: allocation.associationId,
          internalReason: `a repeat funding for allocation ${allocation.id} changed nothing (already ${allocation.status})`,
        });
        return { status: 'duplicate' as const };
      }

      // The exactly-once pivot, claimed before marking funded, so a concurrent
      // or replayed apply collides here.
      await tx.insert(idempotencyKeys).values({
        key: creatorPaymentKeys.funding(allocation.id),
        purpose: 'creator_payment_funded',
        completedAt: new Date(),
        result: { allocationId: allocation.id, checkoutSessionId: input.checkoutSessionId },
      });

      await tx.insert(creatorPaymentFundingAttempts).values({
        allocationId: allocation.id,
        campaignId: allocation.campaignId,
        associationId: allocation.associationId,
        mode: gateway.mode,
        checkoutSessionId: input.checkoutSessionId,
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountTotalCents,
        status: 'succeeded',
        idempotencyKey: creatorPaymentKeys.fundingSession(allocation.id, allocation.amountCents),
        providerEventId: input.providerEventId,
        confirmedAt: input.paidAt,
      });

      await tx
        .update(creatorPaymentAllocations)
        .set({ status: 'funded', fundedAt: input.paidAt, updatedAt: new Date() })
        .where(eq(creatorPaymentAllocations.id, allocation.id));

      await recordProviderObject(tx, {
        mode: gateway.mode,
        objectType: 'checkout_session',
        providerObjectId: input.checkoutSessionId,
        accountContext: 'platform',
        campaignId: allocation.campaignId,
        associationId: allocation.associationId,
        amountCents: input.amountTotalCents,
        status: 'complete',
      });
      if (input.paymentIntentId) {
        await recordProviderObject(tx, {
          mode: gateway.mode,
          objectType: 'payment_intent',
          providerObjectId: input.paymentIntentId,
          accountContext: 'platform',
          campaignId: allocation.campaignId,
          associationId: allocation.associationId,
          amountCents: input.amountTotalCents,
          status: 'succeeded',
        });
      }

      await audit({
        action: 'creator_payment.funded',
        targetType: 'campaign_affiliate_association',
        targetId: allocation.associationId,
        internalReason: `secured Creator payment funded in full: ${allocation.amountCents} cents, session ${input.checkoutSessionId}`,
        amountCents: allocation.amountCents,
        currency: 'USD',
        newValue: { allocationId: allocation.id, fundedAt: input.paidAt.toISOString() },
        providerObjectIds: { checkoutSessionId: input.checkoutSessionId, paymentIntentId: input.paymentIntentId },
      });

      return {
        status: 'funded' as const,
        allocationId: allocation.id,
        associationId: allocation.associationId,
        campaignId: allocation.campaignId,
      };
    });
  } catch (error) {
    if (error instanceof Unreconciled) {
      await audit({
        action: 'creator_payment.funding_unreconciled',
        targetType: 'campaign_affiliate_association',
        targetId: input.associationId,
        internalReason: `a signed funding delivery could not be applied: ${error.message}. Recorded and routed to Admin; nothing applied.`,
        newValue: { checkoutSessionId: input.checkoutSessionId, providerEventId: input.providerEventId },
      });
      return { status: 'unreconciled', reason: error.message };
    }
    if (isUniqueViolation(error)) {
      await audit({
        action: 'creator_payment.funding_duplicate_suppressed',
        targetType: 'campaign_affiliate_association',
        targetId: input.associationId,
        internalReason: `a repeat funding application for session ${input.checkoutSessionId} changed nothing`,
      });
      return { status: 'duplicate' };
    }
    throw error;
  }
}

class Unreconciled extends Error {}

/**
 * `checkout.session.expired` for a funding session — the abandonment/failure
 * path. Records a failed attempt and moves the allocation to `payment_failed`,
 * which preserves the accepted amount, blocks work, and allows an idempotent
 * retry (§16). Never touches a funded allocation.
 */
export async function recordFundingFailed(
  db: Database,
  deps: { gateway: StripeGateway; audit: AuditWriter },
  input: { allocationId: string; checkoutSessionId: string; providerEventId: string | null },
): Promise<void> {
  const [allocation] = await db
    .select()
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.id, input.allocationId))
    .limit(1);
  if (!allocation) return;
  if (allocation.status === 'funded' || allocation.status === 'paid') return;

  await db
    .insert(creatorPaymentFundingAttempts)
    .values({
      allocationId: allocation.id,
      campaignId: allocation.campaignId,
      associationId: allocation.associationId,
      mode: deps.gateway.mode,
      checkoutSessionId: input.checkoutSessionId,
      amountCents: allocation.amountCents,
      status: 'failed',
      idempotencyKey: creatorPaymentKeys.fundingSession(allocation.id, allocation.amountCents),
      failureCode: 'checkout_expired',
      failureMessage: 'the funding Checkout expired without payment',
      providerEventId: input.providerEventId,
    })
    .onConflictDoNothing();

  await db
    .update(creatorPaymentAllocations)
    .set({ status: 'payment_failed', updatedAt: new Date() })
    .where(
      and(
        eq(creatorPaymentAllocations.id, allocation.id),
        ne(creatorPaymentAllocations.status, 'funded'),
        ne(creatorPaymentAllocations.status, 'paid'),
      ),
    );

  await deps.audit({
    action: 'creator_payment.funding_failed',
    targetType: 'campaign_affiliate_association',
    targetId: allocation.associationId,
    internalReason:
      `funding Checkout ${input.checkoutSessionId} expired. The accepted amount is preserved, work stays blocked, and a fresh attempt duplicates nothing (§16).`,
  });
}

/* ── The Admin-configured funding deadline (§16) ───────────────────────────── */

/**
 * Admin sets the funding deadline for one allocation. §6 fixes no value, so the
 * deadline is stated per allocation by a named Admin, recorded with who and
 * when. Missing it may cancel the association (§16) — see `readiness.ts`.
 */
export async function setFundingDeadline(
  db: Database,
  deps: { audit: AuditWriter },
  input: { associationId: string; deadlineAt: Date; actor: string; gateway: StripeGateway },
): Promise<{ ok: true; allocation: CreatorPaymentAllocation } | { ok: false; code: 'not_applicable' | 'canceled' }> {
  const ensured = await ensureAllocation(db, input.gateway, input.associationId);
  if (ensured.status !== 'ok') return { ok: false, code: 'not_applicable' };
  if (ensured.allocation.canceledAt) return { ok: false, code: 'canceled' };

  const [updated] = await db
    .update(creatorPaymentAllocations)
    .set({
      fundingDeadlineAt: input.deadlineAt,
      fundingDeadlineSetBy: input.actor,
      fundingDeadlineSetAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(creatorPaymentAllocations.id, ensured.allocation.id))
    .returning();

  await deps.audit({
    action: 'creator_payment.funding_deadline_set',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `Admin set the funding deadline to ${input.deadlineAt.toISOString()} (§16)`,
    newValue: { allocationId: ensured.allocation.id, fundingDeadlineAt: input.deadlineAt.toISOString() },
    actorId: input.actor.replace(/^user:/, ''),
  });

  return { ok: true, allocation: updated! };
}

/**
 * Allocations whose Admin-configured funding deadline has passed while still
 * unfunded and not canceled. §16: missing the deadline MAY cancel the
 * association — the decision is an Admin's (`cancelAssociationForFundingLapse`
 * in `readiness.ts`), so this surfaces the candidates rather than acting.
 */
export async function findFundingLapsedAllocations(
  db: Database,
  now: Date,
): Promise<CreatorPaymentAllocation[]> {
  return db
    .select()
    .from(creatorPaymentAllocations)
    .where(
      and(
        isNotNull(creatorPaymentAllocations.fundingDeadlineAt),
        lte(creatorPaymentAllocations.fundingDeadlineAt, now),
        isNull(creatorPaymentAllocations.fundedAt),
        isNull(creatorPaymentAllocations.canceledAt),
        ne(creatorPaymentAllocations.status, 'funded'),
        ne(creatorPaymentAllocations.status, 'paid'),
      ),
    );
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
