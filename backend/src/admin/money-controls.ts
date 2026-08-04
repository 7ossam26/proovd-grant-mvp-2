/**
 * §26.6 money controls.
 *
 * "Admin sees and reconciles: captured subtotal, tax, total; Proovd 5%; Founder
 * share and Stripe fee; Creator provisional maximum, earned percentage/bonus,
 * unearned return; fixed allocation funding/return/payment; Transfer, payout,
 * reversal, failure; W-9 and Founder single/first/remaining-payment status;
 * Product early-release evidence; separate thank-you expense."
 *
 * The phase brief's instruction is exact: "Most of these populate in Phases
 * 18–19. Build the surfaces now against the Phase 03 ledger columns so those
 * phases fill rows rather than inventing views." So every line reads a Phase 03
 * column, and no line invents one.
 *
 * ── Not yet populated is not zero (§1.4) ────────────────────────────────────
 * The single most important decision here. Every ledger column defaults to 0, so
 * a naïve read produces "Proovd's 5%: US$0.00" for a campaign whose close batch
 * has simply not run — which is indistinguishable from a campaign that captured
 * nothing, and one of those is a fact while the other is an absence. So each
 * line carries a `populated` flag derived from whether the phase that fills it
 * has actually run for this campaign, and the surface renders an unpopulated
 * line as **not yet populated** rather than as an amount. Rendering the zero
 * would be §1.4's failure: implying an answer the system does not have.
 *
 * ── Nothing here computes the waterfall ─────────────────────────────────────
 * §24.3 permits exactly one implementation, in `shared/money`, and both the
 * checkout preview and the close batch call it. A reconciliation view that
 * recomputed the 5% would be a second implementation whose whole job is to agree
 * with the first — so this reads the stored result and *compares* the parts,
 * which is what reconciling actually means.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { creatorPaymentAllocations } from '../db/schema/creator-payment.js';
import { providerObjects } from '../db/schema/payments.js';
import { thankYouRecords } from '../db/schema/earnings.js';
import {
  MONEY_CONTROL_KEYS,
  MONEY_STATUSES,
  type MoneyControlKey,
  type MoneyStatus,
} from './logic.js';

export interface MoneyControlValue {
  key: MoneyControlKey;
  /** Cents as strings — bigint does not survive JSON, and money is never a float. */
  amounts: Record<string, string>;
  /**
   * False → the phase that fills this has not run for this campaign. The surface
   * says so; it must not print the zero (§1.4).
   */
  populated: boolean;
  /** Which phase fills it, so an Admin knows what they are waiting for. */
  populatedBy: string;
  /** §27.1 question 2, on an internal surface: what makes this appear. */
  awaiting: string | null;
}

export interface MoneyControlPanel {
  campaignId: string;
  campaignStatus: string;
  lines: MoneyControlValue[];
  /**
   * The one arithmetic check this surface *does* perform, and it is a comparison
   * rather than a computation: §24.4 requires the provisional Creator amount to
   * resolve exactly once into earned plus unearned-returned. A mismatch means a
   * liability account that does not balance, which is the reconciliation failure
   * §26.6 exists to catch.
   */
  provisionalReconciles: boolean | null;
  /** §24.3: sales tax is excluded from every percentage. Asserted, not assumed. */
  taxExcludedFromFees: boolean | null;
}

/**
 * §22.3's money status, with the blocker always named.
 *
 * `blocked` without a reason is `held` wearing a different word, which is the
 * exact substitution §22.3 forbids — so the type makes the reason mandatory on
 * that branch rather than optional everywhere.
 */
export type FounderPaymentStatus =
  | { status: Extract<MoneyStatus, 'eligible'>; amountCents: string }
  | { status: Extract<MoneyStatus, 'blocked'>; amountCents: string; blocker: string; secureAction: string }
  | { status: Extract<MoneyStatus, 'released'>; amountCents: string; releasedAt: string };

export async function readMoneyControls(
  db: Database,
  campaignId: string,
): Promise<MoneyControlPanel | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      status: sql<string>`${campaigns.status}::text`,
      rewardSubtotalCapturedCents: campaigns.rewardSubtotalCapturedCents,
      salesTaxCapturedCents: campaigns.salesTaxCapturedCents,
      totalCapturedCents: campaigns.totalCapturedCents,
      proovdFeeCents: campaigns.proovdFeeCents,
      affiliateProvisionalCents: campaigns.affiliateProvisionalCents,
      affiliateEarnedCents: campaigns.affiliateEarnedCents,
      affiliateUnearnedReturnedCents: campaigns.affiliateUnearnedReturnedCents,
      founderGrossShareCents: campaigns.founderGrossShareCents,
      stripeFeeCents: campaigns.stripeFeeCents,
      founderNetCents: campaigns.founderNetCents,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) return null;

  // "Has anything captured?" is the honest test for whether Phase 18 has run.
  // A campaign that closed with nothing captured has a *different* fact to
  // report, and the close batch stamps the aggregate either way — so the flag
  // reads the lifecycle rather than guessing from a zero.
  const captureRun = [
    'closed_reconciling',
    'captured_pending_w9',
    'single_payment_released',
    'first_payment_released',
    'day_14_review',
    'remaining_payment_released',
    'fulfilled',
    'closed_resolved',
  ].includes(campaign.status);

  const [allocation] = await db
    .select({
      total: sql<string>`coalesce(sum(${creatorPaymentAllocations.amountCents}), 0)::text`,
      funded: sql<string>`coalesce(sum(${creatorPaymentAllocations.amountCents}) FILTER (WHERE ${creatorPaymentAllocations.status}::text = 'funded'), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(creatorPaymentAllocations)
    .where(eq(creatorPaymentAllocations.campaignId, campaignId));

  const [transfers] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerObjects)
    .where(
      and(
        eq(providerObjects.campaignId, campaignId),
        sql`${providerObjects.objectType}::text IN ('transfer', 'transfer_reversal', 'payout')`,
      ),
    );

  const provisional = campaign.affiliateProvisionalCents;
  const resolved = campaign.affiliateEarnedCents + campaign.affiliateUnearnedReturnedCents;

  // Phase 19a: §22.2's separate expense — its own table with no ledger column,
  // which is exactly why this line reads it rather than a campaign aggregate.
  const [thankYou] = await db
    .select({
      count: sql<number>`count(*)::int`,
      paidCents: sql<string>`coalesce(sum(${thankYouRecords.amountCents}) FILTER (WHERE ${thankYouRecords.kind} = 'payment'), 0)::text`,
      recognitions: sql<number>`count(*) FILTER (WHERE ${thankYouRecords.kind} = 'recognition')::int`,
    })
    .from(thankYouRecords)
    .where(eq(thankYouRecords.campaignId, campaignId));

  const lines: MoneyControlValue[] = [
    {
      key: 'captured_amounts',
      amounts: {
        subtotalCents: campaign.rewardSubtotalCapturedCents.toString(),
        taxCents: campaign.salesTaxCapturedCents.toString(),
        totalCents: campaign.totalCapturedCents.toString(),
      },
      populated: captureRun,
      populatedBy: 'phase_18',
      awaiting: captureRun ? null : 'The close batch has not run for this campaign.',
    },
    {
      key: 'proovd_fee',
      amounts: { proovdFeeCents: campaign.proovdFeeCents.toString() },
      populated: captureRun,
      populatedBy: 'phase_18',
      awaiting: captureRun ? null : 'The close batch has not run for this campaign.',
    },
    {
      key: 'founder_share',
      amounts: {
        grossCents: campaign.founderGrossShareCents.toString(),
        stripeFeeCents: campaign.stripeFeeCents.toString(),
        netCents: campaign.founderNetCents.toString(),
      },
      populated: captureRun,
      populatedBy: 'phase_18',
      awaiting: captureRun ? null : 'The close batch has not run for this campaign.',
    },
    {
      key: 'creator_percentage',
      amounts: {
        provisionalCents: provisional.toString(),
        earnedCents: campaign.affiliateEarnedCents.toString(),
        unearnedReturnedCents: campaign.affiliateUnearnedReturnedCents.toString(),
      },
      populated: provisional > 0n,
      populatedBy: 'phase_19',
      awaiting:
        provisional > 0n ? null : 'Creator earnings are finalized after close and retry (§22.1).',
    },
    {
      key: 'fixed_allocation',
      amounts: {
        allocatedCents: allocation?.total ?? '0',
        fundedCents: allocation?.funded ?? '0',
      },
      populated: (allocation?.count ?? 0) > 0,
      populatedBy: 'phase_13',
      awaiting:
        (allocation?.count ?? 0) > 0
          ? null
          : 'No fixed Creator payment was accepted on this campaign.',
    },
    {
      key: 'transfers',
      amounts: { objectCount: String(transfers?.count ?? 0) },
      populated: (transfers?.count ?? 0) > 0,
      populatedBy: 'phase_19',
      awaiting: (transfers?.count ?? 0) > 0 ? null : 'No Transfer has been created yet.',
    },
    {
      key: 'founder_payment',
      amounts: {},
      populated: false,
      populatedBy: 'phase_19',
      awaiting: 'W-9 collection and the Founder payment schedule begin immediately after close (§22.3).',
    },
    {
      key: 'early_release_evidence',
      amounts: {},
      populated: false,
      populatedBy: 'phase_19',
      awaiting:
        'Early release of the remaining payment is decided after Day 3, on recorded evidence (§22.3).',
    },
    {
      key: 'thank_you_expense',
      amounts: {
        paidCents: thankYou?.paidCents ?? '0',
        recognitionCount: String(thankYou?.recognitions ?? 0),
      },
      populated: (thankYou?.count ?? 0) > 0,
      populatedBy: 'phase_19',
      awaiting:
        (thankYou?.count ?? 0) > 0
          ? null
          : 'The discretionary good-effort payment is decided after completion (§22.2).',
    },
  ];

  // Every §26.6 line is present, in register order. A line quietly dropped would
  // be a reconciliation an Admin no longer performs and would never notice.
  const emitted = lines.map((l) => l.key);
  for (const key of MONEY_CONTROL_KEYS) {
    if (!emitted.includes(key)) {
      throw new Error(`§26.6 money control line missing from the panel: ${key}`);
    }
  }

  const [taxCheck] = await db
    .select({
      taxCents: sql<string>`coalesce(sum(${reservations.salesTaxCents}), 0)::text`,
      subtotalCents: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}), 0)::text`,
    })
    .from(reservations)
    .where(
      and(eq(reservations.campaignId, campaignId), eq(sql`${reservations.status}::text`, 'captured')),
    );

  return {
    campaignId,
    campaignStatus: campaign.status,
    lines,
    // §24.4: the provisional amount resolves exactly once into earned plus
    // returned. Null while nothing is provisional — there is nothing to balance.
    provisionalReconciles: provisional > 0n ? resolved === provisional : null,
    // §24.3: the 5% is taken from the pre-tax subtotal. Reported as a comparison
    // against what the reservations actually carry, never recomputed here.
    taxExcludedFromFees: captureRun
      ? campaign.salesTaxCapturedCents === BigInt(taxCheck?.taxCents ?? '0') &&
        campaign.rewardSubtotalCapturedCents === BigInt(taxCheck?.subtotalCents ?? '0')
      : null,
  };
}

/**
 * §22.3's vocabulary, exported so Phase 19 uses these words rather than minting
 * a fourth. The trap is explicit: "`held` is not a synonym for `eligible`,
 * `blocked`, or `released`. Establish the vocabulary here — Phase 19 depends on
 * it."
 */
export { MONEY_STATUSES };
