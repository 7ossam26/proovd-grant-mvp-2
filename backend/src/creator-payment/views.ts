/**
 * The §16 two views — Founder and Admin — Spec §16, §11, §27.1.
 *
 * ── The Founder view keeps Phase 08a's boundary ─────────────────────────────
 * §16: the Founder sees each Creator's readiness status, fixed-payment funding
 * status, the exact blockers, the owner, and the next date. §11 forbids the
 * Founder seeing email, legal name, quality tier, or onboarding data — so the
 * projection selects only the public handle and the derived status, never those
 * columns. And there is no "ask to begin" affordance: §16 makes that a product
 * constraint, so the field does not exist (`CANNOT_NUDGE`).
 *
 * ── The Admin view sees every item ──────────────────────────────────────────
 * §16: Admin verifies every checklist item, the funding object, the amount, the
 * accepted proposal version, and the draft/launch plan — and schedules one
 * exact `campaign_live_at`.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import type { StripeModeValue } from '../payments/stripe-client.js';
import { gatherCreatorReadiness, campaignScheduleBlockers } from './readiness.js';
import { deriveCreatorReadiness, READINESS_ITEMS, type ReadinessItemKey } from './logic.js';
import type { CreatorPaymentAllocation } from '../db/schema/creator-payment.js';
import { FIXED_PAYMENT_LABEL } from './labels.js';

/**
 * §16: "there is no 'nudge' affordance." Stated once so the surfaces and the
 * tests read the same fact, and so a future route cannot quietly add one.
 */
export const CANNOT_NUDGE = false;

function fixedPaymentView(allocation: CreatorPaymentAllocation | null, applicable: boolean) {
  if (!applicable || !allocation) {
    return { applicable: false as const };
  }
  return {
    applicable: true as const,
    status: allocation.status,
    label: FIXED_PAYMENT_LABEL[allocation.status],
    amountCents: allocation.amountCents.toString(),
    fundingDeadlineAt: allocation.fundingDeadlineAt?.toISOString() ?? null,
    fundedAt: allocation.fundedAt?.toISOString() ?? null,
    canceledAt: allocation.canceledAt?.toISOString() ?? null,
  };
}

/* ── Founder view (§16, §11) ───────────────────────────────────────────────── */

export interface FounderCreatorReadinessRow {
  associationId: string;
  publicHandle: string | null;
  status: string;
  canBeginWork: boolean;
  fixedPayment: ReturnType<typeof fixedPaymentView>;
  /** The applicable incomplete items, with their owner (§16). */
  blockers: Array<{ key: ReadinessItemKey; label: string; owner: string }>;
  /** §27.1: "when's the next update." The funding deadline where one applies. */
  nextDate: string | null;
}

export interface FounderReadinessView {
  campaignId: string;
  campaignStatus: string;
  campaignLiveAt: string | null;
  /** §16: the Founder cannot ask a Creator to begin early. Always false. */
  canAskToBegin: typeof CANNOT_NUDGE;
  creators: FounderCreatorReadinessRow[];
}

export async function buildFounderReadinessView(
  db: Database,
  mode: StripeModeValue,
  campaignId: string,
): Promise<FounderReadinessView> {
  const [campaign] = await db
    .select({ status: campaigns.status, liveAt: campaigns.campaignLiveAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      publicHandle: affiliateProspects.publicHandle,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(affiliateProspects, eq(affiliateProspects.id, campaignAffiliateAssociations.prospectId))
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const creators: FounderCreatorReadinessRow[] = [];
  for (const association of associations) {
    const gathered = await gatherCreatorReadiness(db, mode, association.associationId);
    if (!gathered) continue;
    const result = deriveCreatorReadiness(gathered.snapshot);
    const blockers = result.incompleteItems.map((key) => {
      const definition = READINESS_ITEMS.find((i) => i.key === key)!;
      return { key, label: definition.label, owner: definition.owner };
    });
    const fundingBlocking = result.incompleteItems.includes('fixed_allocation_funded');
    creators.push({
      associationId: association.associationId,
      publicHandle: association.publicHandle,
      status: gathered.associationStatus,
      canBeginWork: result.canBeginWork,
      fixedPayment: fixedPaymentView(gathered.allocation, gathered.snapshot.fixedPaymentApplicable),
      blockers,
      nextDate: fundingBlocking ? (gathered.allocation?.fundingDeadlineAt?.toISOString() ?? null) : null,
    });
  }

  return {
    campaignId,
    campaignStatus: campaign?.status ?? 'unknown',
    campaignLiveAt: campaign?.liveAt?.toISOString() ?? null,
    canAskToBegin: CANNOT_NUDGE,
    creators,
  };
}

/* ── Admin view (§16) ──────────────────────────────────────────────────────── */

export interface AdminCreatorReadinessRow {
  associationId: string;
  publicHandle: string | null;
  legalName: string | null;
  status: string;
  canBeginWork: boolean;
  /** Every §16 item, with completion and applicability. */
  items: Array<{ key: ReadinessItemKey; label: string; owner: string; specRef: string; complete: boolean; applicable: boolean }>;
  fixedPayment: ReturnType<typeof fixedPaymentView> & { proposalVersionId?: string | null };
}

export interface AdminReadinessView {
  campaignId: string;
  campaignStatus: string;
  campaignLiveAt: string | null;
  /** Empty when the campaign is ready to schedule a launch time (§16). */
  scheduleBlockers: string[];
  canScheduleLive: boolean;
  creators: AdminCreatorReadinessRow[];
}

export async function buildAdminReadinessView(
  db: Database,
  mode: StripeModeValue,
  campaignId: string,
): Promise<AdminReadinessView> {
  const [campaign] = await db
    .select({ status: campaigns.status, liveAt: campaigns.campaignLiveAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      publicHandle: affiliateProspects.publicHandle,
      legalName: affiliateProspects.legalName,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(affiliateProspects, eq(affiliateProspects.id, campaignAffiliateAssociations.prospectId))
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const creators: AdminCreatorReadinessRow[] = [];
  for (const association of associations) {
    const gathered = await gatherCreatorReadiness(db, mode, association.associationId);
    if (!gathered) continue;
    const result = deriveCreatorReadiness(gathered.snapshot);
    const items = result.items.map((item) => {
      const definition = READINESS_ITEMS.find((i) => i.key === item.key)!;
      return {
        key: item.key,
        label: definition.label,
        owner: definition.owner,
        specRef: definition.specRef,
        complete: item.complete,
        applicable: item.applicable,
      };
    });
    creators.push({
      associationId: association.associationId,
      publicHandle: association.publicHandle,
      legalName: association.legalName,
      status: gathered.associationStatus,
      canBeginWork: result.canBeginWork,
      items,
      fixedPayment: {
        ...fixedPaymentView(gathered.allocation, gathered.snapshot.fixedPaymentApplicable),
        proposalVersionId: gathered.allocation?.proposalVersionId ?? null,
      },
    });
  }

  const scheduleBlockers = await campaignScheduleBlockers(db, mode, campaignId);
  const canScheduleLive =
    scheduleBlockers.length === 0 &&
    !campaign?.liveAt &&
    (campaign?.status === 'creator_prep' || campaign?.status === 'approved');

  return {
    campaignId,
    campaignStatus: campaign?.status ?? 'unknown',
    campaignLiveAt: campaign?.liveAt?.toISOString() ?? null,
    scheduleBlockers,
    canScheduleLive,
    creators,
  };
}
