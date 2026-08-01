/**
 * The §32.4 provider-object store.
 *
 * "Store every object affecting state with mode, account context, related
 * domain IDs, amount components, status, idempotency key, failure details, and
 * timestamps."
 *
 * ── One writer, and it is an upsert ────────────────────────────────────────
 * A provider object arrives more than once — created by an API call, then
 * updated by one webhook and another. The identity index is (provider, mode,
 * id), so `recordProviderObject` inserts or updates that one row. The *history*
 * of how it got there is `provider_events`, which is insert-only and already
 * holds every delivery; duplicating that history here would give reconciliation
 * two accounts of the same thing.
 *
 * ── What is deliberately not stored ────────────────────────────────────────
 * No raw provider payload. §32.4 lists the fields it wants and a full object
 * carries more than that — for a connected account, personal detail Proovd has
 * no reason to hold (§28.4), and file references §13 forbids following. A
 * curated write is the difference between a ledger and a copy of Stripe.
 *
 * ── Amounts are integer cents, and never negative ──────────────────────────
 * A refund is its own object with its own positive amount (§24.8), not a
 * negative charge. The CHECK in migration 0014 enforces it, because a sign
 * convention nobody wrote down is how a total comes out wrong two phases later.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { providerObjects } from '../db/schema/payments.js';
import type { StripeModeValue } from './stripe-client.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

export type ProviderObjectType = (typeof providerObjects.objectType.enumValues)[number];
export type AccountContext = (typeof providerObjects.accountContext.enumValues)[number];

export interface RecordProviderObjectInput {
  mode: StripeModeValue;
  objectType: ProviderObjectType;
  providerObjectId: string;
  accountContext: AccountContext;
  /** Required when the context is `connected`; refused when it is `platform`. */
  stripeAccountId?: string | null;

  campaignId?: string | null;
  reservationId?: string | null;
  associationId?: string | null;
  ownerUserId?: string | null;

  currency?: string;
  amountCents?: bigint | null;
  amountTaxCents?: bigint | null;
  amountFeeCents?: bigint | null;
  amountApplicationFeeCents?: bigint | null;
  amountNetCents?: bigint | null;
  amountDetail?: Record<string, unknown> | null;

  status?: string | null;
  idempotencyKey?: string | null;

  failureCode?: string | null;
  failureMessage?: string | null;
  failureDetail?: Record<string, unknown> | null;

  providerCreatedAt?: Date | null;
}

/**
 * Inserts or updates one provider object.
 *
 * Every field is written on conflict *except* the identity ones — the database
 * refuses to change mode or the provider id anyway (trigger, migration 0014),
 * and passing them to the update set would make the refusal look like a bug
 * rather than a rule.
 *
 * `undefined` means "this call does not know", and those keys are left alone —
 * §9's autosave rule, applied to a ledger. A webhook that reports only a status
 * change must not blank the amounts an earlier API call recorded.
 */
export async function recordProviderObject(
  db: Executor,
  input: RecordProviderObjectInput,
): Promise<void> {
  const defined = <T>(value: T | null | undefined): value is T =>
    value !== undefined && value !== null;

  const mutable = {
    ...(defined(input.stripeAccountId) ? { stripeAccountId: input.stripeAccountId } : {}),
    ...(defined(input.campaignId) ? { campaignId: input.campaignId } : {}),
    ...(defined(input.reservationId) ? { reservationId: input.reservationId } : {}),
    ...(defined(input.associationId) ? { associationId: input.associationId } : {}),
    ...(defined(input.ownerUserId) ? { ownerUserId: input.ownerUserId } : {}),
    ...(defined(input.currency) ? { currency: input.currency } : {}),
    ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
    ...(input.amountTaxCents !== undefined ? { amountTaxCents: input.amountTaxCents } : {}),
    ...(input.amountFeeCents !== undefined ? { amountFeeCents: input.amountFeeCents } : {}),
    ...(input.amountApplicationFeeCents !== undefined
      ? { amountApplicationFeeCents: input.amountApplicationFeeCents }
      : {}),
    ...(input.amountNetCents !== undefined ? { amountNetCents: input.amountNetCents } : {}),
    ...(input.amountDetail !== undefined ? { amountDetail: input.amountDetail } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
    ...(input.failureMessage !== undefined ? { failureMessage: input.failureMessage } : {}),
    ...(input.failureDetail !== undefined ? { failureDetail: input.failureDetail } : {}),
    ...(input.providerCreatedAt !== undefined
      ? { providerCreatedAt: input.providerCreatedAt }
      : {}),
  };

  await db
    .insert(providerObjects)
    .values({
      mode: input.mode,
      objectType: input.objectType,
      providerObjectId: input.providerObjectId,
      accountContext: input.accountContext,
      ...mutable,
    })
    .onConflictDoUpdate({
      target: [
        providerObjects.provider,
        providerObjects.mode,
        providerObjects.providerObjectId,
      ],
      set: { ...mutable, updatedAt: new Date() },
    });
}

/** One object, by the provider's id, within one mode. */
export async function readProviderObject(
  db: Executor,
  input: { mode: StripeModeValue; providerObjectId: string },
) {
  const [row] = await db
    .select()
    .from(providerObjects)
    .where(
      and(
        eq(providerObjects.mode, input.mode),
        eq(providerObjects.providerObjectId, input.providerObjectId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Everything the provider did for one campaign.
 *
 * The reconciliation read §26.5 and §21 will need, available from the phase
 * that creates the store rather than the phase that first needs it.
 */
export async function listCampaignProviderObjects(db: Executor, campaignId: string) {
  return db
    .select()
    .from(providerObjects)
    .where(eq(providerObjects.campaignId, campaignId))
    .orderBy(providerObjects.createdAt);
}
