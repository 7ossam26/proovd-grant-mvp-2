/**
 * The Backer magic-link page data — Spec §19, §31.8.
 *
 * Assembles what a Backer sees behind their long-lived campaign-scoped link: the
 * full public campaign page (reused, so it never drifts from what anyone else
 * sees), and each of this Backer's transactions with reward, amounts, date,
 * payment status, and whether a charge occurred.
 *
 * ── The status is derived from real state, never predicted (§31.8) ──────────
 * `Reserved → Charge due / No charge → Captured / Failed → Delivery due →
 * Delivered / Refunded`. A `reserved_active` pre-order is `Reserved` — it is NOT
 * shown as "will be charged", because the threshold is measured at close and
 * even a met threshold does not guarantee a card succeeds. Every label is a fact
 * about the current state, and `chargeOccurred` is true only once money actually
 * moved.
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reservations } from '../db/schema/domain.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignCloseBatches } from '../db/schema/close.js';
import { buildPublicCampaign, type PublicCampaign } from '../campaign/public-page.js';
import {
  resolveFailedPaymentCopy,
  NO_MONEY_MOVED_STATE,
  UPDATE_CARD_ACTION,
} from '../close/restated.js';
import { formatCents } from './restated.js';
import { formatUtcInstant } from './consent.js';

export interface BackerStatus {
  /** The §31.8 stage label for the current reservation status. */
  label: string;
  /** True only once money actually moved — never predicted. */
  chargeOccurred: boolean;
  /** True while the pre-order is live and nothing has been charged. */
  notChargedYet: boolean;
}

export function deriveBackerStatus(status: string): BackerStatus {
  switch (status) {
    case 'reserved_active':
      return { label: 'Reserved', chargeOccurred: false, notChargedYet: true };
    case 'reserved_canceled':
      return { label: 'Canceled', chargeOccurred: false, notChargedYet: false };
    case 'threshold_not_met_no_charge':
      return { label: 'No charge — threshold not met', chargeOccurred: false, notChargedYet: false };
    case 'pending_capture':
      return { label: 'Charge due', chargeOccurred: false, notChargedYet: true };
    case 'capture_failed_retrying':
      return { label: 'Payment failed — retrying', chargeOccurred: false, notChargedYet: true };
    case 'capture_failed_dropped':
      return { label: 'Not charged', chargeOccurred: false, notChargedYet: false };
    case 'captured':
      return { label: 'Captured', chargeOccurred: true, notChargedYet: false };
    case 'refunded':
      return { label: 'Refunded', chargeOccurred: true, notChargedYet: false };
    case 'reversed':
      return { label: 'Reversed', chargeOccurred: true, notChargedYet: false };
    case 'disputed':
      return { label: 'Disputed', chargeOccurred: true, notChargedYet: false };
    case 'killed_no_charge':
      return { label: 'Canceled — no charge', chargeOccurred: false, notChargedYet: false };
    default:
      return { label: status, chargeOccurred: false, notChargedYet: false };
  }
}

export interface BackerTransaction {
  reservationId: string;
  rewardSku: string | null;
  rewardTitle: string | null;
  delivery: string | null;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  status: string;
  statusLabel: string;
  chargeOccurred: boolean;
  notChargedYet: boolean;
  reservedAt: string | null;
  canceledAt: string | null;
  /** Whether this transaction may still be canceled from the backer page (§20). */
  canCancel: boolean;
  /** Idea only: whether the reward may still be changed before close (§19). */
  canChangeReward: boolean;
  /**
   * The B.5 update-card state (§21, §33.7.9, Phase 18b). Present only while
   * the reservation is `capture_failed_retrying`: the exact Appendix B.5 body,
   * the ONE `Update card` action, and the retry deadline. `available` is false
   * once the stored deadline has passed — the anchor gates, not the sweep tick.
   */
  recovery: {
    body: string;
    action: string;
    deadlineUtc: string;
    deadlineIso: string;
    available: boolean;
  } | null;
}

export interface BackerPage {
  campaign: PublicCampaign | null;
  transactions: BackerTransaction[];
  /** `Pre-order saved — you were not charged` is the lead everywhere (§19). */
  notChargedLead: string;
}

/** Whether the campaign is still open for cancellation / reward change. */
async function campaignIsOpen(db: Database, campaignId: string): Promise<{ open: boolean; model: 'idea' | 'product' | null }> {
  const [row] = await db
    .select({ status: campaigns.status, type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const open = row?.status === 'live';
  const model = row?.type === 'pre_build' ? 'idea' : row?.type === 'pre_launch' ? 'product' : null;
  return { open, model };
}

export async function readBackerPage(
  db: Database,
  input: { campaignId: string; backerIdentityId: string; now?: Date },
): Promise<BackerPage> {
  const now = input.now ?? new Date();
  const campaign = await buildPublicCampaign(db, input.campaignId);
  const { open, model } = await campaignIsOpen(db, input.campaignId);

  // The one retry window, when this campaign opened one (§21 step 8).
  const [batch] = await db
    .select({ retryDeadlineAt: campaignCloseBatches.retryDeadlineAt })
    .from(campaignCloseBatches)
    .where(eq(campaignCloseBatches.campaignId, input.campaignId))
    .limit(1);
  const retryDeadlineAt = batch?.retryDeadlineAt ?? null;

  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.backerIdentityId, input.backerIdentityId))
    .orderBy(desc(reservations.createdAt));

  const transactions: BackerTransaction[] = rows
    .filter((r) => r.campaignId === input.campaignId)
    .map((r) => {
      const status = deriveBackerStatus(r.status);
      const isActive = r.status === 'reserved_active';

      // §21: the magic-link failed state IS Appendix B.5 — the same resolved
      // body the email carried, with its one action and the stored deadline.
      let recovery: BackerTransaction['recovery'] = null;
      if (r.status === 'capture_failed_retrying' && retryDeadlineAt) {
        const deadlineUtc = formatUtcInstant(retryDeadlineAt);
        const resolved = resolveFailedPaymentCopy({
          moneyMovedState: NO_MONEY_MOVED_STATE,
          campaignTitle: campaign?.campaign.title ?? 'this campaign',
          rewardTitle: r.rewardTitle ?? 'your reward',
          rewardSubtotal: formatCents(r.rewardSubtotalCents),
          salesTax: formatCents(r.salesTaxCents),
          totalAttempted: formatCents(r.totalAuthorizedCents ?? 0n),
          // §27.1 wants local + UTC; no Backer timezone is stored (§25.2), so
          // the one instant renders as UTC in both positions — the email's rule.
          updateByLocal: deadlineUtc,
          updateByUtc: deadlineUtc,
        });
        recovery = {
          body: resolved.body,
          action: UPDATE_CARD_ACTION,
          deadlineUtc,
          deadlineIso: retryDeadlineAt.toISOString(),
          available: retryDeadlineAt.getTime() > now.getTime(),
        };
      }

      return {
        reservationId: r.id,
        rewardSku: r.rewardSku,
        rewardTitle: r.rewardTitle,
        delivery: r.rewardDelivery,
        rewardSubtotal: formatCents(r.rewardSubtotalCents),
        salesTax: formatCents(r.salesTaxCents),
        totalAuthorized: formatCents(r.totalAuthorizedCents ?? 0n),
        status: r.status,
        statusLabel: status.label,
        chargeOccurred: status.chargeOccurred,
        notChargedYet: status.notChargedYet,
        reservedAt: r.reservedAt?.toISOString() ?? null,
        canceledAt: r.canceledAt?.toISOString() ?? null,
        canCancel: isActive && open,
        canChangeReward: isActive && open && model === 'idea',
        recovery,
      };
    });

  return {
    campaign,
    transactions,
    notChargedLead: 'Pre-order saved — you were not charged',
  };
}
