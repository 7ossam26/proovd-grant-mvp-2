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

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  campaigns,
  campaignAffiliateAssociations,
  reservations,
  type Reservation,
} from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import type { CampaignCloseBatch } from '../db/schema/close.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import {
  FOUNDER_CAMPAIGN_ENDED,
  FOUNDER_RESULTS_READY,
  BACKER_THRESHOLD_MISS_NO_CHARGE,
  BACKER_CHARGE_RECEIPT,
  BACKER_CHARGE_FAILED_UPDATE_CARD,
  BACKER_RETRY_DROPPED,
  BACKER_RETRY_SUCCESS,
  AFFILIATE_CAMPAIGN_CLOSED,
  INTERNAL_CHARGE_BATCH_RESULT,
  INTERNAL_RETRY_RECONCILIATION_COMPLETE,
} from '../notifications/events.js';
import {
  renderCampaignEnded,
  renderChargeReceipt,
  renderFailedPayment,
  renderNoChargeClosure,
  renderRetrySuccess,
  renderResultsReady,
  renderCreatorClosed,
} from '../notifications/templates/close.js';
import { renderInternalNotice } from '../notifications/templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { DESCRIPTOR_UNKNOWN_LABEL } from '../payments/descriptors.js';
import { formatCents } from '../reservations/restated.js';
import { formatUtcInstant } from '../reservations/consent.js';
import { mintOrReissueMagicLink } from '../reservations/magic-link.js';
import { readCreatorClose } from './creator-close.js';
import {
  resolveFailedPaymentCopy,
  NO_MONEY_MOVED_STATE,
  THRESHOLD_MISS_REASON,
  TAX_UNUSABLE_DROP_REASON,
  RETRY_WINDOW_DROP_REASON,
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
    statementDescriptor: reservation.statementDescriptor ?? DESCRIPTOR_UNKNOWN_LABEL,
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

/* ── §27.5: the retry success (Phase 18b) ───────────────────────────────────── */

/**
 * The campaign-aware confirmation for a charge recovered through the B.5
 * update-card path. §27.5 names "Charge receipt" and "Retry success" as
 * separate events, so a recovered charge sends THIS and never both — the
 * receipt key belongs to the close batch's first-attempt success.
 */
export async function notifyRetrySuccess(
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

  const rendered = await renderRetrySuccess({
    campaignTitle: title,
    founderLegalName: seller,
    rewardTitle: reservation.rewardTitle ?? 'your reward',
    rewardSubtotal: formatCents(reservation.rewardSubtotalCents),
    salesTax: formatCents(reservation.salesTaxCents),
    totalCaptured: formatCents(reservation.totalCapturedCents),
    statementDescriptor: reservation.statementDescriptor ?? DESCRIPTOR_UNKNOWN_LABEL,
    delivery: reservation.rewardDelivery ?? 'as stated on the campaign page',
    magicLinkUrl,
    reference: reservation.id,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_RETRY_SUCCESS,
    entityType: 'reservation',
    // One recovery confirmation per reservation — a duplicate update-card
    // submission or a racing webhook sends none (§33.7.9, §27.2).
    entityId: reservation.id,
    to: reservation.backerEmail,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.5: the retry-window-end drop (Phase 18b) ───────────────────────────── */

/**
 * The US$0 closure for a reservation dropped at the retry window's end — the
 * second sender for `backer_retry_dropped` (the first is the close batch's
 * tax-unusable drop). Different reservations, same key, same dedup.
 */
export async function notifyRetryWindowDropped(
  deps: CloseNotificationDeps,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.backerEmail) return;
  const title = await campaignTitleFor(deps.db, reservation.campaignId);
  const rendered = await renderNoChargeClosure({
    reason: RETRY_WINDOW_DROP_REASON,
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

/* ── §27.3: Results ready — its own event, never Campaign ended (§33.7.11) ──── */

export async function notifyResultsReady(
  deps: CloseNotificationDeps,
  input: { campaignId: string },
): Promise<void> {
  const founder = await loadFounder(deps.db, input.campaignId);
  if (!founder.email) return;
  const title = await campaignTitleFor(deps.db, input.campaignId);

  const [aggregates] = await deps.db
    .select({
      rewardSubtotal: campaigns.rewardSubtotalCapturedCents,
      salesTax: campaigns.salesTaxCapturedCents,
      total: campaigns.totalCapturedCents,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  const [captured] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.campaignId, input.campaignId), eq(reservations.status, 'captured')));

  const rendered = await renderResultsReady({
    founderName: founder.name ?? 'there',
    campaignTitle: title,
    rewardSubtotalCaptured: formatCents(aggregates?.rewardSubtotal ?? 0n),
    salesTaxCaptured: formatCents(aggregates?.salesTax ?? 0n),
    totalCaptured: formatCents(aggregates?.total ?? 0n),
    capturedCount: Number(captured?.count ?? 0),
    resultsUrl: `${deps.context.appBaseUrl}/campaigns/${input.campaignId}/results`,
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: FOUNDER_RESULTS_READY,
    entityType: 'campaign',
    // Once per campaign — and a different key from `founder_campaign_ended`,
    // which is the whole of §33.7.11.
    entityId: input.campaignId,
    to: founder.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...rendered,
  });
}

/* ── §27.4: the Creator's campaign-closed notice (Phase 18b) ────────────────── */

/**
 * One factual close notice per Creator whose partnership reached the campaign
 * — sent when the campaign's charge outcomes are final (a clean batch's
 * completion, the retry window's end, or the threshold-miss close). Deduped on
 * the association, so whichever path runs first sends it and the others send
 * nothing.
 */
export async function notifyCreatorsCampaignClosed(
  deps: CloseNotificationDeps,
  input: { campaignId: string },
): Promise<void> {
  const rows = await deps.db
    .select({
      associationId: campaignAffiliateAssociations.id,
      status: campaignAffiliateAssociations.status,
      email: affiliateSignupProfiles.email,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, input.campaignId),
        inArray(campaignAffiliateAssociations.status, [
          'active',
          'paused',
          'ended',
          'successfully_completed',
        ]),
      ),
    );

  for (const row of rows) {
    const to = row.email?.trim();
    if (!to) continue;

    const close = await readCreatorClose(deps.db, { associationId: row.associationId });
    if (!close.ok) continue;

    const rendered = await renderCreatorClosed({
      campaignTitle: close.view.campaignTitle,
      contentVerifiedLine: close.view.contentVerified.line,
      attributedPreorders: close.view.attributed.preorders,
      attributedCaptured: close.view.attributed.captured,
      moneyStatusBlock: close.view.earnings.statusBlock,
      nextReviewLine: close.view.nextReviewLine,
      partnershipUrl: `${deps.context.appBaseUrl}/creator/campaigns/${row.associationId}/close`,
      reference: row.associationId,
      supportEmail: deps.context.supportEmail,
    });

    await deps.notifier.send({
      eventKey: AFFILIATE_CAMPAIGN_CLOSED,
      entityType: 'campaign_affiliate_association',
      entityId: row.associationId,
      to,
      from: deps.context.fromAddress,
      replyTo: deps.context.supportEmail,
      ...rendered,
    });
  }
}

/* ── §27.6: the retry window's end, to the staffed inbox (Phase 18b) ────────── */

export async function notifyRetryReconciliationComplete(
  deps: CloseNotificationDeps,
  input: {
    campaignId: string;
    recovered: number;
    dropped: number;
    captured: number;
  },
): Promise<void> {
  const notice = await renderInternalNotice({
    subject: `Retry window ended — campaign ${input.campaignId}`,
    headline: `The 48-hour retry window has ended — campaign ${input.campaignId}`,
    facts: [
      { label: 'Recovered', value: String(input.recovered) },
      { label: 'Dropped', value: String(input.dropped) },
      { label: 'Captured in total', value: String(input.captured) },
    ],
    paragraphs: [
      'Dropped reservations count as no revenue, no Creator commission, and no Founder share (§21) — the ledger was only ever written at capture, so nothing needs unwinding.',
      'Reconciliation can begin.',
    ],
    action: { label: 'Open the close queue', url: `${deps.context.appBaseUrl}/admin/close` },
    reference: input.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_RETRY_RECONCILIATION_COMPLETE,
    entityType: 'campaign',
    // Once per campaign; the window ends once (the batch trigger pins it).
    entityId: input.campaignId,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
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

  const notice = await renderInternalNotice({
    subject: `Charge batch result — campaign ${batch.campaignId}`,
    headline: `Close batch complete — campaign ${batch.campaignId}`,
    facts: [
      { label: 'Campaign model', value: batch.campaignType === 'pre_build' ? 'Idea' : 'Product' },
      { label: 'Captured', value: String(input.captured) },
      { label: 'In the retry window', value: String(input.failed) },
      { label: 'Dropped', value: String(input.dropped) },
      { label: 'Closed without charge', value: String(input.noCharge) },
      ...(batch.thresholdDecidedAt
        ? [
            {
              label: 'Order threshold',
              value: `${batch.thresholdMet ? 'Met' : 'Missed'} at ${batch.uniqueActiveBackers}/${batch.thresholdRequired} unique active Backers`,
            },
          ]
        : []),
      ...(batch.retryDeadlineAt
        ? [
            {
              label: 'Retry window closes',
              // §27.1: a deadline names its zone.
              value: `${batch.retryDeadlineAt.toISOString().replace('Z', '')} UTC`,
            },
          ]
        : []),
      { label: 'Campaign status', value: campaign?.status ?? 'unknown' },
    ],
    action: { label: 'Open the close queue', url: `${deps.context.appBaseUrl}/admin/close` },
    reference: batch.campaignId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: INTERNAL_CHARGE_BATCH_RESULT,
    entityType: 'campaign_close_batch',
    // Once per batch; a batch completes once (the trigger enforces it).
    entityId: batch.id,
    to: deps.context.supportEmail,
    from: deps.context.fromAddress,
    ...notice,
  });
}
