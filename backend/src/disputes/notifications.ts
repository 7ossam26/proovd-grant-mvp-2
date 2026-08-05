/**
 * Dispute and reversal notifications — §27.6, §27.4 (Phase 20b).
 *
 * `internal_dispute_opened` goes to the staffed inbox with the §24.11 task's
 * due time, deduped per dispute row. The provider's reason code may appear in
 * the internal notice (§26.8 permits it as internal detail) and never in the
 * Creator's reversal notice (§33.9.11).
 */

import { eq } from 'drizzle-orm';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignBuild } from '../db/schema/build.js';
import type { PaymentDispute } from '../db/schema/disputes.js';
import type { AffiliateTransfer } from '../db/schema/earnings.js';
import {
  AFFILIATE_TRANSFER_REVERSAL,
  INTERNAL_DISPUTE_OPENED,
} from '../notifications/events.js';
import { formatCents } from '../reservations/restated.js';
import type { DisputeDeps } from './service.js';

async function campaignTitle(deps: DisputeDeps, campaignId: string): Promise<string> {
  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return build?.title ?? 'the campaign';
}

/** §27.6: the 24-hour §24.11 task, announced once per dispute. */
export async function notifyDisputeOpened(
  deps: DisputeDeps,
  input: { dispute: PaymentDispute },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const d = input.dispute;
  const summary =
    `A payment dispute (${d.providerDisputeId}) opened on reservation ${d.reservationId} ` +
    `for US$${formatCents(d.amountCents)} (provider reason: ${d.reasonCode ?? 'none'}). ` +
    `The §24.11 evidence packet is due by ${d.taskDueAt.toISOString()} — within 24 hours of notice. ` +
    'Classify the case through the §24.8 cause register; nothing about the Creator’s earnings moves until an Admin records that classification.';

  await deps.notifier.send({
    eventKey: INTERNAL_DISPUTE_OPENED,
    entityType: 'payment_dispute',
    entityId: d.id,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    subject: `Dispute opened — evidence due in 24 hours (${d.providerDisputeId})`,
    html: `<p>${summary}</p>`,
    text: summary,
  });
}

/** §27.4 "Transfer … reversal": factual, no raw provider vocabulary (§33.9.11). */
export async function notifyTransferReversal(
  deps: DisputeDeps,
  input: { transfer: AffiliateTransfer; amountReversedCents: bigint | null },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const [profile] = await deps.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, input.transfer.associationId))
    .limit(1);
  if (!profile?.email) return;

  const title = await campaignTitle(deps, input.transfer.campaignId);
  const amount = formatCents(input.amountReversedCents ?? input.transfer.totalCents);
  const text =
    `A transfer of US$${amount} for ${title} was reversed as part of a recorded recovery decision. ` +
    'Your money status view shows the current state, the amounts involved, and the reason on record. ' +
    `Questions or a dispute of this decision: reply to ${deps.context.supportEmail} and a person will answer.`;

  await deps.notifier.send({
    eventKey: AFFILIATE_TRANSFER_REVERSAL,
    entityType: 'affiliate_transfer',
    // One reversal notice per Transfer — a redelivered webhook sends nothing.
    entityId: input.transfer.id,
    to: profile.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    subject: `Transfer reversal recorded — ${title}`,
    html: `<p>${text}</p>`,
    text,
  });
}
