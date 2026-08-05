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
  AFFILIATE_TRANSFER_UPDATE,
  INTERNAL_DISPUTE_OPENED,
} from '../notifications/events.js';
import { formatCents } from '../reservations/restated.js';
import {
  renderInternalNotice,
  renderPlainNotice,
} from '../notifications/templates/plain.js';
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
  const notice = await renderInternalNotice({
    subject: `Dispute opened — evidence due in 24 hours (${d.providerDisputeId})`,
    headline: `Payment dispute opened — evidence due within 24 hours`,
    facts: [
      { label: 'Provider dispute', value: d.providerDisputeId },
      { label: 'Reservation', value: d.reservationId },
      { label: 'Amount', value: `US$${formatCents(d.amountCents)}` },
      { label: 'Provider reason', value: d.reasonCode ?? 'none supplied' },
      // §27.1: a deadline names its zone. `toISOString` ends in `Z`, which is
      // canonical UTC and spells nothing out.
      { label: 'Evidence due', value: `${d.taskDueAt.toISOString().replace('Z', '')} UTC` },
    ],
    paragraphs: [
      'Classify the case through the §24.8 cause register. Nothing about the Creator’s earnings moves until an Admin records that classification.',
    ],
    action: { label: 'Open the dispute queue', url: `${deps.context.appBaseUrl}/admin/refunds` },
    reference: d.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_DISPUTE_OPENED,
    entityType: 'payment_dispute',
    entityId: d.id,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
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
  const notice = await renderPlainNotice({
    subject: `Transfer reversal recorded — ${title}`,
    headline: 'A transfer for this campaign was reversed.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Amount reversed', value: `US$${amount}` },
      { label: 'Status', value: 'Reversed — recorded recovery decision' },
    ],
    paragraphs: [
      'Your money status view shows the current state, the amounts involved, and the reason on record.',
      `Questions, or to dispute this decision: reply to ${deps.context.supportEmail} and a person will answer.`,
    ],
    action: {
      label: 'View your earnings',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${input.transfer.associationId}/close`,
    },
    reference: input.transfer.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_TRANSFER_REVERSAL,
    entityType: 'affiliate_transfer',
    // One reversal notice per Transfer — a redelivered webhook sends nothing.
    entityId: input.transfer.id,
    to: profile.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/**
 * §27.4 "Transfer … update" (Phase 22b).
 *
 * Sent only when the provider's amount disagrees with the recorded total —
 * `applyTransferUpdated` makes that comparison, and everything else is recorded
 * without a message, because §27 forbids a notification with no consequence
 * behind it. The Creator is told the discrepancy exists and that a person is
 * looking at it; the resolution is an Admin's recorded decision, never one this
 * message predicts (§1 rule 6).
 */
export async function notifyTransferUpdate(
  deps: DisputeDeps,
  input: { transfer: AffiliateTransfer; providerAmountCents: bigint },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const [profile] = await deps.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, input.transfer.associationId))
    .limit(1);
  if (!profile?.email) return;

  const title = await campaignTitle(deps, input.transfer.campaignId);
  const notice = await renderPlainNotice({
    subject: `Transfer amount under review — ${title}`,
    headline: 'A transfer for this campaign is being checked.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Amount Proovd recorded', value: `US$${formatCents(input.transfer.totalCents)}` },
      { label: 'Amount the payment provider reports', value: `US$${formatCents(input.providerAmountCents)}` },
      { label: 'Status', value: 'Pending — a person is reconciling the two' },
      { label: 'Who owns it', value: 'Proovd' },
    ],
    paragraphs: [
      'Your finalized earnings have not changed. We are checking why the two figures differ before anything else happens, and we will tell you the outcome.',
      'No action is needed from you.',
    ],
    action: {
      label: 'View your earnings',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${input.transfer.associationId}/close`,
    },
    reference: input.transfer.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_TRANSFER_UPDATE,
    entityType: 'affiliate_transfer',
    // Per transfer row: a redelivery of the same discrepancy is the same fact.
    entityId: input.transfer.id,
    to: profile.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
