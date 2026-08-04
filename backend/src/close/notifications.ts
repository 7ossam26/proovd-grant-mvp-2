/**
 * The close-batch messages — Spec §21, §27.2, §27.3, §27.5, §27.6 (Phase 18a).
 *
 * Every sender here dedups on the entity at the granularity at which the
 * message may legitimately happen once (§27.2):
 *
 *  - `Campaign ended` on the campaign — it fires at close, once, and is
 *    deliberately a different key from `Results ready` (§33.7.11; 18b sends
 *    that one after reconciliation);
 *  - the receipt, the B.5 recovery, and the US$0 closures on the reservation —
 *    a duplicate webhook or a re-run batch finds the claim and sends nothing
 *    (§33.7.7);
 *  - the batch result on the batch row, to the staffed inbox (§27.6).
 *
 * Every send runs AFTER the domain transaction committed. A provider refusal
 * is recorded by the notifier and never rolled back onto money — the charge
 * happened whether or not the email left the building.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, type Reservation } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import type { CampaignCloseBatch } from '../db/schema/close.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import {
  FOUNDER_CAMPAIGN_ENDED,
  BACKER_THRESHOLD_MISS_NO_CHARGE,
  BACKER_CHARGE_RECEIPT,
  BACKER_CHARGE_FAILED_UPDATE_CARD,
  BACKER_RETRY_DROPPED,
  INTERNAL_CHARGE_BATCH_RESULT,
} from '../notifications/events.js';
import {
  renderCampaignEnded,
  renderChargeReceipt,
  renderFailedPayment,
  renderNoChargeClosure,
} from '../notifications/templates/close.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';
import { formatUtcInstant } from '../reservations/consent.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import {
  resolveFailedPaymentCopy,
  NO_MONEY_MOVED_STATE,
  THRESHOLD_MISS_REASON,
  TAX_UNUSABLE_DROP_REASON,
} from './restated.js';

export interface CloseNotificationDeps {
  db: Database;
  notifier: Notifier;
  context: LaunchNotificationContext;
  /** Mints the Backer's magic link for the receipt/recovery messages. Absent →
      the message still sends, pointing at the support route instead (§1.4:
      better an honest fallback than a dead control). */
  tokens?: TokenService | undefined;
}

async function campaignTitleFor(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ title: campaignBuild.title, founderEntityDisplay: campaignBuild.founderEntityDisplay })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.title ?? 'your campaign';
}

async function founderDisplayFor(db: Database, campaignId: string): Promise<string> {
  const [row] = await db
    .select({ display: campaignBuild.founderEntityDisplay, name: campaignBuild.founderDisplayName })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return row?.display ?? row?.name ?? 'the campaign seller';
}

async function magicLinkFor(
  deps: CloseNotificationDeps,
  input: { campaignId: string; backerIdentityId: string },
): Promise<string> {
  if (!deps.tokens) return `mailto:${deps.context.supportEmail}`;
  try {
    const link = await mintOrReissueMagicLink(
      { db: deps.db, tokenService: deps.tokens, appBaseUrl: deps.context.appBaseUrl },
      input,
    );
    return link.url;
  } catch {
    return `mailto:${deps.context.supportEmail}`;
  }
}

/* ── §27.3: Campaign ended — fires at close, separate from Results ready ───── */

export async function notifyCampaignEnded(
  deps: CloseNotificationDeps,
  input: { campaignId: string; closedAt: Date; outcomeLine: string },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;
  const title = await campaignTitleFor(deps.db, input.campaignId);

  const rendered = await renderCampaignEnded({
    founderName: founder.name ?? 'there',
    campaignTitle: title,
    closedAtUtc: formatUtcInstant(input.closedAt),
    outcomeLine: input.outcomeLine,
    campaignHomeUrl: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/home`,
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_CAMPAIGN_ENDED,
    entityType: 'campaign',
    // Once per campaign, ever. `Results ready` is its own key (§33.7.11).
    entityId: input.campaignId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.5: the charge receipt (§21's campaign-aware confirmation) ─────────── */

export async function notifyChargeReceipt(
  deps: CloseNotificationDeps,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.backerEmail) return;
  const title = await campaignTitleFor(deps.db, reservation.campaignId);
  const seller = await founderDisplayFor(deps.db, reservation.campaignId);
  const magicLinkUrl = await magicLinkFor(deps, {
    campaignId: reservation.campaignId,
    backerIdentityId: reservation.backerIdentityId,
  });

  const rendered = await renderChargeReceipt({
    campaignTitle: title,
    founderLegalName: seller,
    rewardTitle: reservation.rewardTitle ?? 'your reward',
    rewardSubtotal: formatCents(reservation.rewardSubtotalCents),
    salesTax: formatCents(reservation.salesTaxCents),
    totalCaptured: formatCents(reservation.totalCapturedCents),
    statementDescriptor: reservation.statementDescriptor ?? 'the campaign descriptor',
    delivery: reservation.rewardDelivery ?? 'as stated on the campaign page',
    magicLinkUrl,
    reference: reservation.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_CHARGE_RECEIPT,
    entityType: 'reservation',
    // One receipt per reservation — a duplicate webhook sends none (§33.7.7).
    entityId: reservation.id,
    to: reservation.backerEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.5: the B.5 failed-payment recovery ─────────────────────────────────── */

export async function notifyCaptureFailed(
  deps: CloseNotificationDeps,
  reservation: Reservation,
  input: { retryDeadlineAt: Date },
): Promise<void> {
  if (!reservation.backerEmail) return;
  const title = await campaignTitleFor(deps.db, reservation.campaignId);
  const magicLinkUrl = await magicLinkFor(deps, {
    campaignId: reservation.campaignId,
    backerIdentityId: reservation.backerIdentityId,
  });

  const deadlineUtc = formatUtcInstant(input.retryDeadlineAt);
  const resolved = resolveFailedPaymentCopy({
    moneyMovedState: NO_MONEY_MOVED_STATE,
    campaignTitle: title,
    rewardTitle: reservation.rewardTitle ?? 'your reward',
    rewardSubtotal: formatCents(reservation.rewardSubtotalCents),
    salesTax: formatCents(reservation.salesTaxCents),
    totalAttempted: formatCents(reservation.totalAuthorizedCents ?? 0n),
    // §27.1 wants local primary with UTC secondary; a Backer's timezone is not
    // stored (§25.2 keeps no such field), so the one instant renders as UTC in
    // both positions rather than a guessed locality claiming to be theirs.
    updateByLocal: deadlineUtc,
    updateByUtc: deadlineUtc,
  });

  const rendered = await renderFailedPayment({
    resolvedBody: resolved.body,
    action: resolved.action,
    campaignTitle: title,
    updateCardUrl: magicLinkUrl,
    reference: reservation.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_CHARGE_FAILED_UPDATE_CARD,
    entityType: 'reservation',
    // One failure notice per reservation at close; the 18b retry's own
    // outcome messages are different keys (§27.5's retry success/dropped).
    entityId: reservation.id,
    to: reservation.backerEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.5: the US$0 closures ───────────────────────────────────────────────── */

export async function notifyThresholdMissClosure(
  deps: CloseNotificationDeps,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.backerEmail) return;
  const title = await campaignTitleFor(deps.db, reservation.campaignId);
  const rendered = await renderNoChargeClosure({
    reason: THRESHOLD_MISS_REASON,
    campaignTitle: title,
    rewardTitle: reservation.rewardTitle ?? 'your reward',
    reference: reservation.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_THRESHOLD_MISS_NO_CHARGE,
    entityType: 'reservation',
    entityId: reservation.id,
    to: reservation.backerEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/** §21 step 6's tax-unusable drop: notified as a dropped payment (§27.5). */
export async function notifyCaptureDropped(
  deps: CloseNotificationDeps,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.backerEmail) return;
  const title = await campaignTitleFor(deps.db, reservation.campaignId);
  const rendered = await renderNoChargeClosure({
    reason: TAX_UNUSABLE_DROP_REASON,
    campaignTitle: title,
    rewardTitle: reservation.rewardTitle ?? 'your reward',
    reference: reservation.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_RETRY_DROPPED,
    entityType: 'reservation',
    entityId: reservation.id,
    to: reservation.backerEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.6: the charge batch result, to the staffed inbox ───────────────────── */

export async function notifyBatchResult(
  deps: CloseNotificationDeps,
  batch: CampaignCloseBatch,
  input: {
    captured: number;
    failed: number;
    dropped: number;
    noCharge: number;
  },
): Promise<void> {
  const [campaign] = await deps.db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, batch.campaignId))
    .limit(1);

  const summary =
    `Close batch complete for campaign ${batch.campaignId} (${batch.campaignType === 'pre_build' ? 'Idea' : 'Product'}): ` +
    `${input.captured} captured, ${input.failed} in the retry window, ${input.dropped} dropped, ` +
    `${input.noCharge} closed without charge. ` +
    (batch.thresholdDecidedAt
      ? `Threshold ${batch.thresholdMet ? 'met' : 'missed'} at ${batch.uniqueActiveBackers}/${batch.thresholdRequired} unique active Backers. `
      : '') +
    (batch.retryDeadlineAt
      ? `The one 48-hour retry window closes ${batch.retryDeadlineAt.toISOString()}. `
      : '') +
    `Campaign is now ${campaign?.status ?? 'unknown'}.`;

  await deps.notifier.send({
    eventKey: INTERNAL_CHARGE_BATCH_RESULT,
    entityType: 'campaign_close_batch',
    // Once per batch; a batch completes once (the trigger enforces it).
    entityId: batch.id,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    subject: `Charge batch result — campaign ${batch.campaignId}`,
    html: `<p>${summary}</p>`,
    text: summary,
  });
}
