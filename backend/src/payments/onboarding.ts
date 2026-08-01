/**
 * Stripe-hosted onboarding — Spec §13, §11, §5.3, §24.1, §27.1.
 *
 * §13: "Before listing-fee payment, the Founder completes Stripe-hosted
 * onboarding for the connected account used as the campaign seller/payment
 * account." §11 asks the same of the Creator, for a recipient account.
 *
 * ── Proovd issues a link and reads a status. It collects nothing ───────────
 * §11 forbids "reproducing provider-controlled fields"; §5.3 says Proovd stores
 * statuses and IDs and "never full bank details"; §13 forbids storing
 * Stripe-collected identity documents. So the entire integration is: create an
 * account, create a link, send the person to Stripe, read the account back.
 * There is no form on this side to bypass, and no route that accepts a bank,
 * tax, or identity field — the absence is what makes the rule true, exactly as
 * it was in Phase 08b.
 *
 * ── Reuse is the default, not a special case ───────────────────────────────
 * §11: "Reuse valid onboarding from a prior campaign. Never ask an Affiliate to
 * re-enter valid provider data." The account is keyed to a *person*, so
 * `beginOnboarding` finds an existing one before creating anything, and a
 * Creator recruited to a second campaign is already done. A second account per
 * campaign would also fragment payouts across accounts Stripe treats as
 * unrelated people.
 *
 * ── Returning always lands on one of four states ───────────────────────────
 * §13 fixes them: complete; more information required, with the *exact* missing
 * requirement and a resume action; under review, with owner and next update;
 * restricted, with a safe support path and **no misleading ability to pay the
 * listing fee**. `readOnboardingState` returns that state and the facts §27.1
 * needs to render it — never a raw requirements array, which is what §13 is
 * ruling out.
 *
 * ── The return route re-reads the account ──────────────────────────────────
 * A Founder who finishes at Stripe and lands back before the `account.updated`
 * webhook arrives would otherwise be shown the state from before they started.
 * So returning fetches the account rather than trusting the last delivery —
 * the same "a vendor is a source of events, not of truth" position Phase 09b
 * took for bookings.
 */

import type { Database } from '../db/client.js';
import type { AuditWriter } from '../auth/audit.js';
import {
  findAccountByStripeId,
  findAccountForOwner,
  readAccountFacts,
  upsertConnectedAccount,
  type ConnectedAccountRole,
  type ConnectedAccountState,
} from './connected-accounts.js';
import type { StripeGateway } from './stripe-client.js';

/** §2.2 launches US-only. Stated once, here, rather than assumed per call. */
const ONBOARDING_COUNTRY = 'US';

export interface OnboardingContext {
  db: Database;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** §32.2's Connect URLs. Absent means onboarding cannot be offered. */
  returnUrl?: string | undefined;
  refreshUrl?: string | undefined;
}

/* ── The state a surface renders ──────────────────────────────────────────── */

export interface OnboardingView {
  state: ConnectedAccountState;
  stripeAccountId: string | null;
  /**
   * §13: "the exact missing requirement". The provider's own requirement names,
   * so the surface can say which — never an empty "more information needed".
   */
  missingRequirements: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  /**
   * §13: a resume action, and only where resuming is a real thing to do. A
   * restricted account has nothing to resume, and offering one would be a dead
   * end dressed as a step.
   */
  canResume: boolean;
  /** False while §32.2's Connect URLs are unset. The surface says so. */
  onboardingAvailable: boolean;
  /**
   * §13: restricted/failed lands with "no misleading ability to pay the listing
   * fee". Phase 11 reads this before offering Checkout; nothing but a complete
   * seller account makes it true.
   */
  listingFeeEligible: boolean;
  /**
   * §11: "Where onboarding is incomplete: campaign review continues, but
   * tracking-link activation and payment receipt are blocked." Phase 14 reads
   * the first and Phase 19 the second.
   */
  linkActivationBlocked: boolean;
  paymentReceiptBlocked: boolean;
  /** §11: review is explicitly NOT blocked by incomplete onboarding. */
  campaignReviewBlocked: false;
  lastSyncedAt: string | null;
}

function viewFor(
  role: ConnectedAccountRole,
  row: {
    stripeAccountId: string;
    state: ConnectedAccountState;
    requirementsCurrentlyDue: unknown;
    requirementsPastDue: unknown;
    requirementsPendingVerification: unknown;
    requirementsDisabledReason: string | null;
    lastSyncedAt: Date | null;
  } | null,
  onboardingAvailable: boolean,
): OnboardingView {
  const names = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const state = row?.state ?? 'not_started';
  const complete = state === 'complete';

  return {
    state,
    stripeAccountId: row?.stripeAccountId ?? null,
    // Past due first: §13 wants the exact missing requirement, and the overdue
    // one is the one that is actually holding things up.
    missingRequirements: [
      ...names(row?.requirementsPastDue),
      ...names(row?.requirementsCurrentlyDue),
    ],
    pendingVerification: names(row?.requirementsPendingVerification),
    disabledReason: row?.requirementsDisabledReason ?? null,
    // Resuming makes sense while Stripe will still take input. It does not once
    // the account is restricted, and it is not needed once it is complete.
    canResume:
      onboardingAvailable &&
      (state === 'not_started' || state === 'more_information_required'),
    onboardingAvailable,
    // §13. Only a complete SELLER account may reach listing-fee payment; a
    // recipient account is never the seller (§24.1), so it never makes this true.
    listingFeeEligible: complete && role === 'founder_seller',
    // §11's two blocks, and they apply to the recipient.
    linkActivationBlocked: role === 'affiliate_recipient' && !complete,
    paymentReceiptBlocked: role === 'affiliate_recipient' && !complete,
    campaignReviewBlocked: false,
    lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
  };
}

/** The current state for one person and one role. Creates nothing. */
export async function readOnboardingState(
  context: OnboardingContext,
  input: { ownerUserId: string; role: ConnectedAccountRole },
): Promise<OnboardingView> {
  const row = await findAccountForOwner(context.db, {
    ownerUserId: input.ownerUserId,
    role: input.role,
    mode: context.gateway.mode,
  });

  return viewFor(input.role, row, Boolean(context.returnUrl && context.refreshUrl));
}

/* ── Starting, resuming, returning ────────────────────────────────────────── */

export type OnboardingRefusal =
  | 'unavailable'
  | 'already_complete'
  | 'restricted'
  | 'provider_error';

export type BeginOnboardingResult =
  | { ok: true; url: string; expiresAt: Date; stripeAccountId: string; reused: boolean }
  | { ok: false; code: OnboardingRefusal; message: string; next: string };

/**
 * Creates or reuses the account, then issues a hosted link.
 *
 * Reuse first (§11), and reuse is silent — a Creator whose account is already
 * onboarded is told they are done rather than sent through Stripe again. A
 * restricted account refuses: §13's restricted state offers a support path, not
 * another attempt, and looping someone through onboarding that will fail again
 * is the §1.4 failure with a spinner on it.
 */
export async function beginOnboarding(
  context: OnboardingContext,
  input: { ownerUserId: string; role: ConnectedAccountRole; email?: string | undefined },
): Promise<BeginOnboardingResult> {
  const { db, gateway, audit, returnUrl, refreshUrl } = context;

  if (!returnUrl || !refreshUrl) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Payout setup is not switched on for this deployment yet.',
      next: 'Nothing you have done is affected. We will email you when it opens.',
    };
  }

  const existing = await findAccountForOwner(db, {
    ownerUserId: input.ownerUserId,
    role: input.role,
    mode: gateway.mode,
  });

  if (existing?.state === 'complete') {
    return {
      ok: false,
      code: 'already_complete',
      message: 'Your payout setup is already finished.',
      next: 'There is nothing more to do here.',
    };
  }

  if (existing?.state === 'restricted') {
    // §13: a safe support path, not another attempt.
    return {
      ok: false,
      code: 'restricted',
      message: 'Stripe cannot continue with this account.',
      next: 'Contact support and a person here will go through it with you.',
    };
  }

  let stripeAccountId = existing?.stripeAccountId ?? null;
  const reused = stripeAccountId !== null;

  try {
    if (!stripeAccountId) {
      stripeAccountId = await gateway.createConnectedAccount({
        role: input.role,
        email: input.email,
        country: ONBOARDING_COUNTRY,
      });

      await upsertConnectedAccount(db, {
        stripeAccountId,
        mode: gateway.mode,
        role: input.role,
        ownerUserId: input.ownerUserId,
        source: input.role === 'founder_seller' ? 'founder' : 'affiliate',
        actor: `user:${input.ownerUserId}`,
        event: 'link_created',
      });
    }

    const link = await gateway.createAccountLink({
      accountId: stripeAccountId,
      returnUrl,
      refreshUrl,
    });

    await audit({
      action: 'stripe.onboarding_link_created',
      targetType: 'connected_account',
      targetId: stripeAccountId,
      internalReason: reused
        ? 'resumed onboarding on the account this person already has'
        : 'created a connected account and issued the first onboarding link',
      actorId: input.ownerUserId,
    });

    return { ok: true, url: link.url, expiresAt: link.expiresAt, stripeAccountId, reused };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await audit({
      action: 'stripe.onboarding_link_failed',
      targetType: 'connected_account',
      targetId: stripeAccountId,
      internalReason: `the provider refused to issue an onboarding link: ${reason}`,
      actorId: input.ownerUserId,
    });

    // §27.1 and §30: never a bare failure. The person is told what did and did
    // not happen, and what they can do now.
    return {
      ok: false,
      code: 'provider_error',
      message: 'We could not open Stripe just now. Nothing has changed on your account.',
      next: 'Try again in a moment. If it keeps happening, contact support.',
    };
  }
}

/**
 * A person landing back from Stripe, on either the return or the refresh URL.
 *
 * Re-reads the account rather than trusting the last webhook, because a Founder
 * who finishes and lands back within the second would otherwise be shown the
 * state from before they started. §13: "Returning from Stripe always lands on a
 * human-readable status."
 *
 * `refreshed` is Stripe's word for a link that expired or was reused — which is
 * an ordinary thing to happen and not an error. It is recorded so the history
 * shows the bounce, and the caller offers a fresh link.
 */
export async function recordOnboardingReturn(
  context: OnboardingContext,
  input: { ownerUserId: string; role: ConnectedAccountRole; event: 'returned' | 'refreshed' },
): Promise<OnboardingView> {
  const { db, gateway } = context;

  const existing = await findAccountForOwner(db, {
    ownerUserId: input.ownerUserId,
    role: input.role,
    mode: gateway.mode,
  });

  if (!existing) {
    return viewFor(input.role, null, Boolean(context.returnUrl && context.refreshUrl));
  }

  const account = await gateway.retrieveAccount(existing.stripeAccountId);

  await upsertConnectedAccount(db, {
    stripeAccountId: existing.stripeAccountId,
    mode: existing.mode,
    role: existing.role,
    ownerUserId: existing.ownerUserId,
    ...(account ? { facts: readAccountFacts(account) } : {}),
    source: input.role === 'founder_seller' ? 'founder' : 'affiliate',
    actor: `user:${input.ownerUserId}`,
    event: input.event,
  });

  const refreshed = await findAccountByStripeId(db, existing.stripeAccountId);
  return viewFor(input.role, refreshed, Boolean(context.returnUrl && context.refreshUrl));
}

/**
 * Re-reads an account from the provider. Admin's reconciliation path.
 *
 * The same reasoning as Phase 09b's booking reconciliation, and the same trap:
 * a state reachable only by webhook is a state a dropped delivery can strand
 * someone in. Here it would strand a Founder who has finished onboarding
 * outside the listing-fee payment they are entitled to reach.
 */
export async function reconcileAccount(
  context: OnboardingContext,
  stripeAccountId: string,
): Promise<OnboardingView | null> {
  const existing = await findAccountByStripeId(context.db, stripeAccountId);
  if (!existing) return null;

  const account = await context.gateway.retrieveAccount(stripeAccountId);
  if (account) {
    await upsertConnectedAccount(context.db, {
      stripeAccountId,
      mode: existing.mode,
      role: existing.role,
      ownerUserId: existing.ownerUserId,
      facts: readAccountFacts(account),
      source: 'admin',
      actor: 'system:stripe-reconciliation',
      event: 'account_updated',
    });
  }

  const refreshed = await findAccountByStripeId(context.db, stripeAccountId);
  return viewFor(
    existing.role,
    refreshed,
    Boolean(context.returnUrl && context.refreshUrl),
  );
}
