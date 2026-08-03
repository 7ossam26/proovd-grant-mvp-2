/**
 * Reservation-time tax — Spec §19, §25.2, §31.7.
 *
 * Tax is calculated once, at reservation time, on the Founder seller account and
 * for the Backer's location, and stored in full: calculation id, jurisdiction,
 * rate, taxability reason, expiry, and the amounts. Phase 18's later charge may
 * occur only for exactly that stored total and only while that same calculation
 * is still usable — this phase stores what Phase 18 validates (§33.5.11).
 *
 * §31.7: a zero produced by missing collection configuration is not proof that
 * no tax is due. So an unconfigured tax provider refuses loudly here, exactly as
 * the listing Checkout does — a reservation with an unknowable total is never
 * created.
 */

import type { Database } from '../db/client.js';
import { recordProviderObject } from '../payments/provider-objects.js';
import type { StripeGateway, TaxAddress, TaxCalculationResult } from '../payments/stripe-client.js';

export type ReservationTaxRefusal = 'tax_unavailable' | 'provider_error';

export type ReservationTaxResult =
  | { ok: true; tax: TaxCalculationResult; totalCents: bigint }
  | { ok: false; code: ReservationTaxRefusal; message: string };

/**
 * Calculates and stores the reservation-time tax for one reward subtotal at one
 * billing address, on the Founder's connected account. Records the calculation
 * as a §32.4 provider object so Admin reconciliation and the Phase 18 capture
 * can find it. Does NOT create the reservation — that waits on SetupIntent.
 */
export async function calculateReservationTax(
  db: Database,
  gateway: StripeGateway,
  input: {
    campaignId: string;
    connectedAccountId: string;
    subtotalCents: bigint;
    address: TaxAddress;
    reference: string;
  },
): Promise<ReservationTaxResult> {
  if (!gateway.taxEnabled) {
    return {
      ok: false,
      code: 'tax_unavailable',
      message:
        'Sales-tax calculation is not switched on for this deployment, so pre-orders cannot open.',
    };
  }

  let tax: TaxCalculationResult;
  try {
    tax = await gateway.createTaxCalculation({
      amountCents: input.subtotalCents,
      address: input.address,
      reference: input.reference,
      connectedAccountId: input.connectedAccountId,
    });
  } catch (error) {
    return {
      ok: false,
      code: 'provider_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (tax.id) {
    await recordProviderObject(db, {
      mode: gateway.mode,
      objectType: 'tax_calculation',
      providerObjectId: tax.id,
      accountContext: 'connected',
      stripeAccountId: input.connectedAccountId,
      campaignId: input.campaignId,
      amountCents: input.subtotalCents,
      amountTaxCents: tax.taxCents,
      status: 'calculated',
      amountDetail: {
        expiresAt: tax.expiresAt?.toISOString() ?? null,
        jurisdiction: tax.jurisdiction,
        rate: tax.rate,
        taxabilityReason: tax.taxabilityReason,
      },
    });
  }

  return { ok: true, tax, totalCents: input.subtotalCents + tax.taxCents };
}
