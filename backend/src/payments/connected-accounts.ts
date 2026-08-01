/**
 * Connected accounts and the four states a human is shown — Spec §13, §11,
 * §24.1, §32.3.
 *
 * §13: returning from Stripe "always lands on a human-readable status:
 * Complete. More information required, with exact missing requirement and
 * resume action. Under review, with owner and next expected update.
 * Restricted/failed, with safe support path and no misleading ability to pay the
 * listing fee."
 *
 * ── Deriving the state is the substance of this file ───────────────────────
 * Stripe reports an account as a set of booleans, four requirement lists, and a
 * `disabled_reason`. §13 asks for one of four words. `deriveAccountState` is
 * that mapping, and every Stripe value it reads is named rather than pattern-
 * matched — an unrecognised `disabled_reason` resolves to `restricted`, which
 * is the safe direction: §13's restricted state offers "no misleading ability
 * to pay the listing fee", and treating an unknown refusal as workable is the
 * failure that sentence exists to prevent.
 *
 * ── The role decides what "complete" means ─────────────────────────────────
 * §24.1: the Founder account is the seller for campaign charges; the Affiliate
 * account "is a recipient only… never processes the Backer charge and is never
 * MoR". So a Founder account is complete when it can take charges and an
 * Affiliate account when it can receive payouts. One shared definition would
 * either block Affiliates on a capability they will never use or pass Founders
 * who cannot sell.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { stripeConnectedAccounts, stripeAccountEvents } from '../db/schema/payments.js';
import { recordProviderObject } from './provider-objects.js';
import type { StripeModeValue } from './stripe-client.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

export type ConnectedAccountRole = 'founder_seller' | 'affiliate_recipient';
export type ConnectedAccountState =
  | 'not_started'
  | 'more_information_required'
  | 'under_review'
  | 'restricted'
  | 'complete';

/** The subset of Stripe's account object §13 asks Proovd to store. */
export interface AccountFacts {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  pastDue: string[];
  eventuallyDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  capabilities: Record<string, string>;
  agreementType: string | null;
  agreementAcceptedAt: Date | null;
}

/**
 * Stripe's `requirements.disabled_reason` values, and what §13 calls each.
 *
 * Named individually because the difference is what a Founder is told and what
 * they can do next. `requirements.past_due` is fixable by them; `rejected.fraud`
 * is not, and offering a resume action for it would be a dead end dressed as a
 * step. Anything not listed resolves to `restricted` — see the header.
 */
const DISABLED_REASON_STATE: Record<string, ConnectedAccountState> = {
  'requirements.past_due': 'more_information_required',
  'requirements.pending_verification': 'under_review',
  under_review: 'under_review',
  listed: 'restricted',
  platform_paused: 'restricted',
  'rejected.fraud': 'restricted',
  'rejected.listed': 'restricted',
  'rejected.terms_of_service': 'restricted',
  'rejected.other': 'restricted',
  other: 'restricted',
};

export function deriveAccountState(
  facts: AccountFacts,
  role: ConnectedAccountRole,
): ConnectedAccountState {
  // A refusal outranks everything. An account Stripe has disabled is not
  // "complete" because some capability happens to still read true.
  if (facts.disabledReason) {
    return DISABLED_REASON_STATE[facts.disabledReason] ?? 'restricted';
  }

  // Nothing submitted and nothing asked for: onboarding has not begun. This is
  // distinct from "more information required" — there is no *missing
  // requirement* to name, and naming none while saying information is missing
  // is the unhelpful state §13 rules out.
  if (!facts.detailsSubmitted && facts.currentlyDue.length === 0 && facts.pastDue.length === 0) {
    return 'not_started';
  }

  if (facts.pastDue.length > 0 || facts.currentlyDue.length > 0) {
    return 'more_information_required';
  }

  if (facts.pendingVerification.length > 0) {
    return 'under_review';
  }

  // §24.1's two roles want two different capabilities.
  const capable = role === 'founder_seller' ? facts.chargesEnabled : facts.payoutsEnabled;
  if (facts.detailsSubmitted && capable) return 'complete';

  // Submitted, nothing outstanding, and still not capable. Stripe is working on
  // it; §13's "under review, with owner and next expected update" is exactly
  // this state, and calling it complete would let a Founder reach a payment
  // that will fail.
  return 'under_review';
}

/**
 * Reads Stripe's account object into `AccountFacts`.
 *
 * Tolerant about absence and strict about type: a missing list is empty rather
 * than undefined, and anything that is not a list of strings is dropped. §13
 * forbids storing identity documents, and the requirements lists are the one
 * place a widened copy could start pulling in more than requirement *names* —
 * so the filter is here as well as in the CHECK constraint.
 */
export function readAccountFacts(account: Record<string, unknown>): AccountFacts {
  const requirements = (account['requirements'] as Record<string, unknown> | undefined) ?? {};

  const names = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const capabilities: Record<string, string> = {};
  const rawCapabilities = account['capabilities'];
  if (rawCapabilities && typeof rawCapabilities === 'object') {
    for (const [key, value] of Object.entries(rawCapabilities as Record<string, unknown>)) {
      if (typeof value === 'string') capabilities[key] = value;
    }
  }

  const tos = account['tos_acceptance'] as Record<string, unknown> | undefined;
  const acceptedSeconds = typeof tos?.['date'] === 'number' ? tos['date'] : null;

  return {
    chargesEnabled: account['charges_enabled'] === true,
    payoutsEnabled: account['payouts_enabled'] === true,
    detailsSubmitted: account['details_submitted'] === true,
    currentlyDue: names(requirements['currently_due']),
    pastDue: names(requirements['past_due']),
    eventuallyDue: names(requirements['eventually_due']),
    pendingVerification: names(requirements['pending_verification']),
    disabledReason:
      typeof requirements['disabled_reason'] === 'string'
        ? requirements['disabled_reason']
        : null,
    capabilities,
    // §13: "Policy/agreement acceptance references." The reference, not the IP
    // or user agent Stripe also exposes — §28.4 limits collection to what is
    // needed, and nothing here needs them.
    agreementType: typeof tos?.['service_agreement'] === 'string' ? tos['service_agreement'] : null,
    agreementAcceptedAt: acceptedSeconds ? new Date(acceptedSeconds * 1000) : null,
  };
}

/* ── The record ───────────────────────────────────────────────────────────── */

export interface UpsertAccountInput {
  stripeAccountId: string;
  mode: StripeModeValue;
  role: ConnectedAccountRole;
  ownerUserId: string;
  facts?: AccountFacts;
  /** `founder` | `admin` | `provider:stripe` | `system:<job>`. */
  source: string;
  actor: string;
  event: string;
  providerEventId?: string | null;
}

export interface UpsertAccountResult {
  id: string;
  priorState: ConnectedAccountState | null;
  state: ConnectedAccountState;
  changed: boolean;
}

/**
 * Creates or updates one connected account, and records what changed.
 *
 * The append-only event row is written only when the state actually moved or
 * the caller named a lifecycle event (`returned`, `refreshed`, `link_created`).
 * A webhook that reports the same state again is not a return or a refresh, and
 * filling §13's history with unchanged rows would bury the three that explain a
 * stuck onboarding.
 */
export async function upsertConnectedAccount(
  db: Executor,
  input: UpsertAccountInput,
): Promise<UpsertAccountResult> {
  const [existing] = await db
    .select()
    .from(stripeConnectedAccounts)
    .where(eq(stripeConnectedAccounts.stripeAccountId, input.stripeAccountId))
    .limit(1);

  const facts = input.facts;
  const state = facts ? deriveAccountState(facts, input.role) : (existing?.state ?? 'not_started');
  const priorState = (existing?.state as ConnectedAccountState | undefined) ?? null;
  const now = new Date();

  const factColumns = facts
    ? {
        chargesEnabled: facts.chargesEnabled,
        payoutsEnabled: facts.payoutsEnabled,
        detailsSubmitted: facts.detailsSubmitted,
        requirementsCurrentlyDue: facts.currentlyDue,
        requirementsPastDue: facts.pastDue,
        requirementsEventuallyDue: facts.eventuallyDue,
        requirementsPendingVerification: facts.pendingVerification,
        requirementsDisabledReason: facts.disabledReason,
        capabilities: facts.capabilities,
        agreementType: facts.agreementType,
        agreementAcceptedAt: facts.agreementAcceptedAt,
        lastSyncedAt: now,
      }
    : {};

  let id: string;

  if (existing) {
    // Identity — account id, mode, owner — is immutable by trigger, so it is
    // deliberately not in this set: the refusal is a rule, and passing the
    // values would make it look like a bug.
    await db
      .update(stripeConnectedAccounts)
      .set({ state, ...factColumns, updatedAt: now })
      .where(eq(stripeConnectedAccounts.id, existing.id));
    id = existing.id;
  } else {
    const [created] = await db
      .insert(stripeConnectedAccounts)
      .values({
        stripeAccountId: input.stripeAccountId,
        mode: input.mode,
        role: input.role,
        ownerUserId: input.ownerUserId,
        state,
        ...factColumns,
      })
      .returning({ id: stripeConnectedAccounts.id });
    id = created!.id;
  }

  const lifecycle = input.event !== 'account_updated';
  const changed = priorState !== state;

  if (changed || lifecycle) {
    await db.insert(stripeAccountEvents).values({
      connectedAccountId: id,
      stripeAccountId: input.stripeAccountId,
      event: input.event,
      priorState,
      newState: state,
      source: input.source,
      actor: input.actor,
      providerEventId: input.providerEventId ?? null,
      // The requirement names that explain the state, and nothing else. §13
      // forbids storing identity documents and §28.4 limits collection; a
      // snapshot of the whole account object would exceed both.
      detail: facts
        ? {
            currentlyDue: facts.currentlyDue,
            pastDue: facts.pastDue,
            pendingVerification: facts.pendingVerification,
            disabledReason: facts.disabledReason,
          }
        : null,
    });
  }

  // §32.4 counts a connected account as an object affecting state.
  if (facts) {
    await recordProviderObject(db, {
      mode: input.mode,
      objectType: 'connected_account',
      providerObjectId: input.stripeAccountId,
      accountContext: 'connected',
      stripeAccountId: input.stripeAccountId,
      ownerUserId: input.ownerUserId,
      status: state,
      ...(facts.disabledReason ? { failureCode: facts.disabledReason } : {}),
    });
  }

  return { id, priorState, state, changed };
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/**
 * The account a person already has for a role, if any.
 *
 * §11: "Reuse valid onboarding from a prior campaign. Never ask an Affiliate to
 * re-enter valid provider data." This is the read that makes that possible, and
 * it is scoped by mode as well as owner — a test account must never be offered
 * as a live one.
 */
export async function findAccountForOwner(
  db: Executor,
  input: { ownerUserId: string; role: ConnectedAccountRole; mode: StripeModeValue },
) {
  const [row] = await db
    .select()
    .from(stripeConnectedAccounts)
    .where(
      and(
        eq(stripeConnectedAccounts.ownerUserId, input.ownerUserId),
        eq(stripeConnectedAccounts.role, input.role),
        eq(stripeConnectedAccounts.mode, input.mode),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findAccountByStripeId(db: Executor, stripeAccountId: string) {
  const [row] = await db
    .select()
    .from(stripeConnectedAccounts)
    .where(eq(stripeConnectedAccounts.stripeAccountId, stripeAccountId))
    .limit(1);

  return row ?? null;
}

/** §13's "return and refresh events", newest first. */
export async function readAccountHistory(db: Executor, connectedAccountId: string) {
  return db
    .select()
    .from(stripeAccountEvents)
    .where(eq(stripeAccountEvents.connectedAccountId, connectedAccountId))
    .orderBy(desc(stripeAccountEvents.occurredAt));
}
