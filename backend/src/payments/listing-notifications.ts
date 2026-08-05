/**
 * §13's effect 7 — the payment's messages, sent after the transaction commits.
 *
 * "Sends Founder confirmation/receipt and Affiliate formal-opportunity
 * notifications exactly once each." Exactly-once is `notification_deliveries`:
 * the receipt is keyed on the payment, each opportunity message on its
 * association, the internal §27.6 message on the payment — every one a thing
 * that happens once, keyed at the granularity at which it happens once.
 *
 * A provider refusal is recorded and returned, never thrown: the payment
 * already committed, and rolling back money because an email bounced would be
 * the wrong half of the system winning. The unconfirmed claim is visible in
 * Admin, which is the honest state (§1.4).
 */

import { desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { listingFeeRefunds } from '../db/schema/listing.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_LISTING_FEE_RECEIPT,
  FOUNDER_LISTING_FEE_REFUND,
  AFFILIATE_FORMAL_OPPORTUNITY_AVAILABLE,
  INTERNAL_LISTING_PAID_DEADLINE_STARTED,
} from '../notifications/events.js';
import {
  renderListingReceipt,
  renderListingRefund,
  OPTIONAL_ITEM_LABELS,
  type ListingFeeLine,
} from '../notifications/templates/listing-fee.js';
import { renderFormalOpportunity } from '../notifications/templates/affiliate-formal-opportunity.js';
import { renderInternalNotice } from '../notifications/templates/plain.js';
import { findListingPayment } from './listing-checkout.js';

export interface ListingNotificationContext {
  appBaseUrl: string;
  supportEmail: string;
  fromAddress: string;
}

/* ── Formatting — the ledger's values, rendered ───────────────────────────── */

/**
 * `shared/money`'s USD format, restated (the backend cannot import it at
 * runtime) and drift-tested by the suite against the shared implementation.
 */
export function formatUsdCents(cents: bigint): string {
  const digits = cents.toString().padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `US$${whole}.${digits.slice(-2)}`;
}

function utcStamp(at: Date): string {
  return at.toISOString().replace('T', ' ').slice(0, 16);
}

/* ── The Founder's identity for one campaign ──────────────────────────────── */

async function founderIdentity(db: Database, campaignId: string) {
  const [row] = await db
    .select({
      claimEmail: founderClaimProfiles.email,
      claimName: founderClaimProfiles.preferredName,
      legalName: founderClaimProfiles.legalName,
      prospectEmail: founderProspects.email,
      prospectName: founderProspects.preferredName,
      productName: founderProspects.productName,
    })
    .from(campaigns)
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!row) return null;
  return {
    email: (row.claimEmail ?? row.prospectEmail ?? '').trim(),
    name: row.claimName ?? row.prospectName ?? row.legalName ?? null,
    productName: row.productName ?? null,
  };
}

/* ── The receipt, the opportunities, and the internal note ────────────────── */

export interface PaymentNotifyResult {
  receipt: string;
  opportunities: Array<{ associationId: string; outcome: string }>;
  internal: string;
}

export async function notifyListingPayment(
  db: Database,
  notifier: Notifier,
  context: ListingNotificationContext,
  input: {
    campaignId: string;
    paymentId: string;
    responseDeadlineAt: Date;
    openedAssociationIds: string[];
  },
): Promise<PaymentNotifyResult> {
  const payment = await findListingPayment(db, input.campaignId);
  const founder = await founderIdentity(db, input.campaignId);
  const deadlineUtc = utcStamp(input.responseDeadlineAt);

  /* The receipt — §13's list, itemised from the payment row and nothing else. */
  let receiptOutcome = 'skipped: no payment or no Founder address';
  if (payment && founder?.email) {
    const lines: ListingFeeLine[] = [
      { label: 'Listing fee', amount: formatUsdCents(payment.baseCents) },
      ...(payment.discountLines as Array<{ item: string; discountCents: string }>).map((l) => ({
        label: `${OPTIONAL_ITEM_LABELS[l.item] ?? l.item} — your saving`,
        amount: `−${formatUsdCents(BigInt(l.discountCents))}`,
      })),
      { label: 'Subtotal', amount: formatUsdCents(payment.subtotalCents) },
      { label: 'Sales tax', amount: formatUsdCents(payment.taxCents) },
    ];

    const rendered = await renderListingReceipt({
      founderName: founder.name,
      productName: founder.productName,
      lines,
      total: formatUsdCents(payment.totalCents),
      descriptor: payment.descriptor,
      receiptUrl: payment.receiptUrl,
      responseDeadlineUtc: deadlineUtc,
      reference: input.campaignId,
      supportEmail: context.supportEmail,
    });

    const outcome = await notifier.send({
      eventKey: FOUNDER_LISTING_FEE_RECEIPT,
      entityType: 'listing_fee_payment',
      entityId: input.paymentId,
      to: founder.email,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    receiptOutcome = outcome.status;
  }

  /* The formal opportunities — one per opened association, keyed on it. */
  const opportunities: Array<{ associationId: string; outcome: string }> = [];
  if (input.openedAssociationIds.length > 0) {
    const rows = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        signupEmail: affiliateSignupProfiles.email,
        signupHandle: affiliateSignupProfiles.publicHandle,
        prospectEmail: affiliateProspects.email,
        prospectHandle: affiliateProspects.publicHandle,
      })
      .from(campaignAffiliateAssociations)
      .leftJoin(
        affiliateSignupProfiles,
        eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
      )
      .leftJoin(
        affiliateProspects,
        eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
      )
      .where(inArray(campaignAffiliateAssociations.id, input.openedAssociationIds));

    for (const row of rows) {
      const to = (row.signupEmail ?? row.prospectEmail ?? '').trim();
      if (!to) {
        opportunities.push({ associationId: row.associationId, outcome: 'skipped: no address' });
        continue;
      }
      const rendered = await renderFormalOpportunity({
        creatorName: row.signupHandle ?? row.prospectHandle ?? null,
        productName: founder?.productName ?? null,
        campaignUrl: `${context.appBaseUrl}/creator/campaigns/${row.associationId}`,
        responseDeadlineUtc: deadlineUtc,
        reference: row.associationId,
        supportEmail: context.supportEmail,
      });
      const outcome = await notifier.send({
        eventKey: AFFILIATE_FORMAL_OPPORTUNITY_AVAILABLE,
        entityType: 'campaign_affiliate_association',
        entityId: row.associationId,
        to,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      opportunities.push({ associationId: row.associationId, outcome: outcome.status });
    }
  }

  /* §27.6: "Listing paid / deadline started" — to the staffed inbox. */
  const opened = input.openedAssociationIds.length;
  const internalNotice = await renderInternalNotice({
    subject: `Listing paid — response deadline ${deadlineUtc} UTC — campaign ${input.campaignId}`,
    headline: `Listing fee paid — campaign ${input.campaignId}`,
    facts: [
      { label: 'Response window ends', value: `${deadlineUtc} UTC` },
      {
        label: 'Formal opportunities opened',
        value: `${opened} ${opened === 1 ? 'Creator' : 'Creators'}`,
      },
    ],
    paragraphs: [
      'The deadline was stored at payment with the window length in force at that moment; a later settings change moves future deadlines and never this one.',
    ],
    action: {
      label: 'Open the campaign roster',
      url: `${context.appBaseUrl}/admin/campaigns/${input.campaignId}`,
    },
    reference: input.campaignId,
    supportEmail: context.supportEmail,
  });

  const internal = await notifier.send({
    eventKey: INTERNAL_LISTING_PAID_DEADLINE_STARTED,
    entityType: 'listing_fee_payment',
    entityId: input.paymentId,
    to: context.supportEmail,
    from: context.fromAddress,
    ...internalNotice,
  });

  return { receipt: receiptOutcome, opportunities, internal: internal.status };
}

/* ── The refund confirmation (§13, §27.3) ─────────────────────────────────── */

export async function notifyListingRefund(
  db: Database,
  notifier: Notifier,
  context: ListingNotificationContext,
  input: { campaignId: string },
): Promise<string> {
  const [refund] = await db
    .select()
    .from(listingFeeRefunds)
    .where(eq(listingFeeRefunds.campaignId, input.campaignId))
    .orderBy(desc(listingFeeRefunds.createdAt))
    .limit(1);
  if (!refund) return 'skipped: no refund recorded';

  const founder = await founderIdentity(db, input.campaignId);
  if (!founder?.email) return 'skipped: no Founder address';

  const rendered = await renderListingRefund({
    founderName: founder.name,
    productName: founder.productName,
    totalRefunded: formatUsdCents(refund.totalRefundedCents),
    explanation: refund.customerExplanation,
    reference: input.campaignId,
    supportEmail: context.supportEmail,
  });

  const outcome = await notifier.send({
    eventKey: FOUNDER_LISTING_FEE_REFUND,
    entityType: 'listing_fee_refund',
    entityId: refund.id,
    to: founder.email,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  return outcome.status;
}
