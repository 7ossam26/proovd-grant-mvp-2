/**
 * §16 Creator readiness — gathering, evaluation, the two views, and the Admin
 * actions — Spec §16, §23.1, §23.4, §33.4.4.
 *
 * A Creator may begin work only when every applicable §16 item is complete
 * (§33.4.4). The decision itself is the pure `deriveCreatorReadiness` (restated
 * in `logic.ts`, drift-tested against shared); this module gathers the snapshot
 * it decides over and mirrors the result onto the association status —
 * `ready` when all applicable items hold, `readiness_blocked` otherwise. The
 * association status is never set by hand, so it cannot drift from its inputs
 * (the §33.3.10 rule, one level down).
 *
 * ── The two views (§16) ─────────────────────────────────────────────────────
 * The Founder sees each Creator's readiness and funding status, the exact
 * blockers, the owner, and the next date — and has no affordance to ask a
 * Creator to begin early (a product constraint, not a guideline). Admin verifies
 * every item and schedules ONE exact `campaign_live_at`, only when everything is
 * ready.
 *
 * ── Missing the funding deadline (§16) ──────────────────────────────────────
 * `cancelAssociationForFundingLapse` removes the association and closes the
 * allocation. The 20% base then stops applying because a removed association has
 * no live compensation — a Creator whose fixed payment lapsed does not silently
 * continue on the reduced percentage (§16's trap).
 */

import { and, count, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild, campaignRewardPackages, associationReadiness, approvedCampaignSnapshots } from '../db/schema/build.js';
import {
  associationCompensationAgreements,
  associationAcceptanceConfirmations,
  trackingLinks,
} from '../db/schema/decisions.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeModeValue } from '../payments/stripe-client.js';
import { transitionAssociation } from '../affiliates/recruitment.js';
import { findAllocation, allocationFunded } from './allocations.js';
import {
  deriveCreatorReadiness,
  READINESS_ITEMS,
  type CreatorReadinessSnapshot,
  type CreatorReadinessResult,
  type ReadinessItemKey,
} from './logic.js';
import {
  creatorPaymentAllocations,
  type CreatorPaymentAllocation,
} from '../db/schema/creator-payment.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

const present = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/* ── Gathering the §16 snapshot ────────────────────────────────────────────── */

export interface GatheredReadiness {
  associationId: string;
  campaignId: string;
  associationStatus: string;
  snapshot: CreatorReadinessSnapshot;
  allocation: CreatorPaymentAllocation | null;
}

/** Reads the thirteen §16 facts for one association. */
export async function gatherCreatorReadiness(
  db: Executor,
  mode: StripeModeValue,
  associationId: string,
): Promise<GatheredReadiness | null> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!association) return null;

  const [campaign] = await db
    .select({ status: campaigns.status, type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, association.campaignId))
    .limit(1);

  const [snapshotRow] = await db
    .select({ id: approvedCampaignSnapshots.id })
    .from(approvedCampaignSnapshots)
    .where(eq(approvedCampaignSnapshots.campaignId, association.campaignId))
    .limit(1);
  const approvedSnapshotExists = Boolean(snapshotRow);

  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, association.campaignId))
    .limit(1);

  const [rewards] = await db
    .select({ n: count() })
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, association.campaignId));

  const [agreement] = await db
    .select()
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, associationId))
    .limit(1);

  const [link] = await db
    .select({ id: trackingLinks.id })
    .from(trackingLinks)
    .where(eq(trackingLinks.associationId, associationId))
    .limit(1);

  const [confirmation] = await db
    .select()
    .from(associationAcceptanceConfirmations)
    .where(eq(associationAcceptanceConfirmations.associationId, associationId))
    .limit(1);

  const [readinessRow] = await db
    .select({ readinessConfirmedAt: associationReadiness.readinessConfirmedAt })
    .from(associationReadiness)
    .where(eq(associationReadiness.associationId, associationId))
    .limit(1);

  const [profile] = await db
    .select({ claimedUserId: affiliateSignupProfiles.claimedUserId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, associationId))
    .limit(1);

  let connectedAccountReady = false;
  if (profile?.claimedUserId) {
    const [account] = await db
      .select({ state: stripeConnectedAccounts.state })
      .from(stripeConnectedAccounts)
      .where(
        and(
          eq(stripeConnectedAccounts.ownerUserId, profile.claimedUserId),
          eq(stripeConnectedAccounts.role, 'affiliate_recipient'),
          eq(stripeConnectedAccounts.mode, mode),
        ),
      )
      .limit(1);
    connectedAccountReady = account?.state === 'complete';
  }

  const allocation = await findAllocation(db, associationId);
  const fixedPaymentApplicable = agreement?.fixedPaymentCents != null;

  const campaignApproved =
    approvedSnapshotExists &&
    (campaign?.status === 'approved' || campaign?.status === 'creator_prep');

  const snapshot: CreatorReadinessSnapshot = {
    campaignApproved,
    rewardsFinal: Number(rewards?.n ?? 0) >= 1,
    compensationFinal: Boolean(agreement),
    // §14.4 groups product visuals and brand assets with the launch narrative;
    // the story is the concrete required build field for them.
    brandAssetsPresent: present(build?.publicStory) && present(build?.heroPreference),
    claimsRulesPresent: present(build?.requiredWording) && present(build?.prohibitedClaims),
    trackingLinkPresent: Boolean(link),
    ftcAcknowledged: confirmation?.ftcDisclosureAcknowledgedAt != null,
    // Admin's confirmation of the Creator's deliverable/post plan (§15 rule 6,
    // "Admin may review drafts/planned posts").
    deliverablesConfirmed: readinessRow?.readinessConfirmedAt != null,
    campaignDatesSet: build?.opensAt != null && build?.closesAt != null,
    ipAgreementAccepted: confirmation?.ipAgreementConsentId != null,
    termsAupAccepted: confirmation?.termsAupState != null,
    fixedPaymentApplicable,
    fixedAllocationFunded: allocationFunded(allocation),
    connectedAccountReady,
  };

  return {
    associationId,
    campaignId: association.campaignId,
    associationStatus: association.status,
    snapshot,
    allocation,
  };
}

/* ── Evaluation (§16, §23.4) ───────────────────────────────────────────────── */

/** The statuses in which readiness is meaningful (§23.4: accepted → ready/blocked). */
const READINESS_STATUSES = ['accepted', 'readiness_blocked', 'ready'] as const;

export interface CreatorReadinessReport extends CreatorReadinessResult {
  associationId: string;
  associationStatus: string;
  allocation: CreatorPaymentAllocation | null;
  snapshot: CreatorReadinessSnapshot;
}

/**
 * Re-derives §16 readiness and mirrors it onto the association status. Moves
 * between `ready` and `readiness_blocked` only — an association not yet
 * `accepted` (or already `active`/`removed`) is left where it is. Idempotent by
 * the conditional transition.
 */
export async function evaluateCreatorReadiness(
  db: Database,
  deps: { audit: AuditWriter; mode: StripeModeValue },
  input: { associationId: string; actor: string },
): Promise<CreatorReadinessReport | null> {
  return db.transaction(async (tx) => {
    const [association] = await tx
      .select({ id: campaignAffiliateAssociations.id, status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, input.associationId))
      .for('update')
      .limit(1);
    if (!association) return null;

    const gathered = await gatherCreatorReadiness(tx, deps.mode, input.associationId);
    if (!gathered) return null;

    const result = deriveCreatorReadiness(gathered.snapshot);

    if ((READINESS_STATUSES as readonly string[]).includes(association.status)) {
      const target = result.canBeginWork ? 'ready' : 'readiness_blocked';
      if (association.status !== target) {
        const moved = await transitionAssociation(
          input.associationId,
          association.status as 'accepted',
          target,
          input.actor,
          tx,
        );
        if (moved) {
          gathered.associationStatus = target;
          await deps.audit({
            action: 'creator_readiness.evaluated',
            targetType: 'campaign_affiliate_association',
            targetId: input.associationId,
            internalReason:
              `§16 readiness → ${target}: ${result.incompleteItems.length} incomplete item(s)` +
              (result.incompleteItems.length ? ` (${result.incompleteItems.join(', ')})` : ''),
            actorId: input.actor.replace(/^user:|^system:/, '') || null,
          });
        }
      }
    }

    return {
      ...result,
      associationId: input.associationId,
      associationStatus: gathered.associationStatus,
      allocation: gathered.allocation,
      snapshot: gathered.snapshot,
    };
  });
}

/**
 * §23.1: the `approved → creator_prep` hop — "Creator prep starts." Recorded
 * when readiness tracking begins for an approved campaign. Conditional, so a
 * second call is a no-op.
 */
export async function beginCreatorPrep(
  db: Executor,
  campaignId: string,
  actor: string,
): Promise<boolean> {
  const moved = await db
    .update(campaigns)
    .set({ status: 'creator_prep', updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'approved')))
    .returning({ id: campaigns.id });
  if (moved.length === 1) {
    await db.insert(campaignStatusHistory).values({
      campaignId,
      fromStatus: 'approved',
      toStatus: 'creator_prep',
      actor,
    });
    return true;
  }
  return false;
}

/* ── Admin: confirm the Creator's deliverable plan (§16 item 8) ────────────── */

/**
 * §16: "Admin verifies every checklist item… and the draft/launch plan." This
 * records the per-Creator deliverables/plan confirmation (the §15 rule-6
 * readiness record), without disturbing the Phase 12b roster decision.
 */
export async function confirmCreatorDeliverables(
  db: Database,
  deps: { audit: AuditWriter; mode: StripeModeValue },
  input: { associationId: string; campaignId: string; confirmed: boolean; actor: string },
): Promise<CreatorReadinessReport | null> {
  const now = new Date();
  await db
    .insert(associationReadiness)
    .values({
      associationId: input.associationId,
      campaignId: input.campaignId,
      readinessConfirmedAt: input.confirmed ? now : null,
      decidedBy: input.actor,
      decidedAt: now,
    })
    .onConflictDoUpdate({
      target: associationReadiness.associationId,
      set: {
        readinessConfirmedAt: input.confirmed ? now : null,
        decidedBy: input.actor,
        decidedAt: now,
        updatedAt: now,
      },
    });

  await deps.audit({
    action: 'creator_readiness.deliverables_confirmed',
    targetType: 'campaign_affiliate_association',
    targetId: input.associationId,
    internalReason: `Admin ${input.confirmed ? 'confirmed' : 'un-confirmed'} the Creator's deliverable/post plan (§16)`,
    actorId: input.actor.replace(/^user:/, ''),
  });

  return evaluateCreatorReadiness(db, deps, { associationId: input.associationId, actor: input.actor });
}

/* ── Missing the funding deadline (§16) ────────────────────────────────────── */

export type FundingLapseOutcome =
  | { ok: true; associationId: string }
  | { ok: false; code: 'not_found' | 'not_lapsable' | 'funded' };

/**
 * §16: "Missing the Admin-configured funding deadline may cancel the association
 * and allow replacement recruitment. The 20% base stops applying after
 * cancellation." The Admin decision removes the association and closes the
 * allocation; the reduced base no longer governs because a removed association
 * has no live compensation. Replacement recruitment is Phase 14/§15.
 */
export async function cancelAssociationForFundingLapse(
  db: Database,
  deps: { audit: AuditWriter },
  input: { associationId: string; actor: string; reason?: string | undefined; now?: Date },
): Promise<FundingLapseOutcome> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [association] = await tx
      .select({ id: campaignAffiliateAssociations.id, status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, input.associationId))
      .for('update')
      .limit(1);
    if (!association) return { ok: false as const, code: 'not_found' as const };

    const allocation = await findAllocation(tx, input.associationId);
    if (!allocation) return { ok: false as const, code: 'not_found' as const };
    if (allocation.status === 'funded' || allocation.status === 'paid') {
      // A funded allocation is not a lapse: the money is secured, and §31.6/§22.1
      // decide its return, not this path.
      return { ok: false as const, code: 'funded' as const };
    }
    if (!(['accepted', 'readiness_blocked', 'ready'] as string[]).includes(association.status)) {
      return { ok: false as const, code: 'not_lapsable' as const };
    }

    // Close the allocation and remove the association. The 20% base stops
    // applying because the association is removed — there is no live
    // relationship for the reduced percentage to govern.
    await tx
      .update(creatorPaymentAllocations)
      .set({
        status: 'payment_failed',
        canceledAt: now,
        canceledBy: input.actor,
        canceledReason: input.reason ?? 'funding deadline missed',
        updatedAt: now,
      })
      .where(eq(creatorPaymentAllocations.id, allocation.id));

    const moved = await transitionAssociation(
      input.associationId,
      association.status as 'accepted',
      'removed',
      input.actor,
      tx,
    );
    if (!moved) return { ok: false as const, code: 'not_lapsable' as const };

    await deps.audit({
      action: 'creator_payment.funding_lapsed_association_removed',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason:
        `Admin removed the association for a missed funding deadline (§16). The secured Creator payment ` +
        `was not funded; the association is removed and the reduced 20% base no longer applies. ` +
        `Replacement recruitment may proceed.`,
      newValue: { allocationId: allocation.id, canceledAt: now.toISOString() },
      actorId: input.actor.replace(/^user:/, ''),
    });

    return { ok: true as const, associationId: input.associationId };
  });
}

/* ── Admin: schedule the one campaign_live_at (§16) ────────────────────────── */

export type ScheduleLiveOutcome =
  | { ok: true; campaignLiveAt: Date }
  | { ok: false; code: 'not_found' | 'wrong_status' | 'already_scheduled' | 'not_ready' | 'in_past'; message: string; blockers?: string[] };

/**
 * §16: "Admin schedules ONE exact `campaign_live_at` only after the campaign and
 * every scheduled Creator are ready." Sets the §21 anchor once (conditional on
 * it being null); it does not move the campaign to `live` — that is Phase 14.
 */
export async function scheduleCampaignLive(
  db: Database,
  deps: { audit: AuditWriter; mode: StripeModeValue },
  input: { campaignId: string; liveAt: Date; actor: string; now?: Date },
): Promise<ScheduleLiveOutcome> {
  const now = input.now ?? new Date();
  const [campaign] = await db
    .select({ id: campaigns.id, status: campaigns.status, liveAt: campaigns.campaignLiveAt })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { ok: false, code: 'not_found', message: 'That campaign could not be found.' };
  if (campaign.liveAt) {
    return { ok: false, code: 'already_scheduled', message: 'A launch time is already scheduled for this campaign.' };
  }
  if (campaign.status !== 'creator_prep' && campaign.status !== 'approved') {
    return { ok: false, code: 'wrong_status', message: 'This campaign is not in Creator preparation.' };
  }
  if (input.liveAt.getTime() <= now.getTime()) {
    return { ok: false, code: 'in_past', message: 'The launch time has to be in the future.' };
  }

  // Everything ready: every included, launch-required Creator is `ready`, and
  // there is at least one such Creator. A blocked/pending required Creator, or
  // an unfunded fixed allocation, blocks the schedule.
  const blockers = await campaignScheduleBlockers(db, deps.mode, input.campaignId);
  if (blockers.length > 0) {
    return {
      ok: false,
      code: 'not_ready',
      message: 'Not every scheduled Creator is ready yet.',
      blockers,
    };
  }

  await beginCreatorPrep(db, input.campaignId, input.actor);

  const moved = await db
    .update(campaigns)
    .set({ campaignLiveAt: input.liveAt, updatedAt: now })
    .where(and(eq(campaigns.id, input.campaignId)))
    .returning({ id: campaigns.id });
  if (moved.length !== 1) {
    return { ok: false, code: 'wrong_status', message: 'The campaign changed while scheduling.' };
  }

  await deps.audit({
    action: 'campaign.live_scheduled',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `Admin scheduled campaign_live_at = ${input.liveAt.toISOString()} (§16); launch itself is Phase 14`,
    newValue: { campaignLiveAt: input.liveAt.toISOString() },
    actorId: input.actor.replace(/^user:/, ''),
  });

  return { ok: true, campaignLiveAt: input.liveAt };
}

/** The reasons a campaign is not ready to schedule a launch time. Empty = ready. */
export async function campaignScheduleBlockers(
  db: Database,
  mode: StripeModeValue,
  campaignId: string,
): Promise<string[]> {
  const [snapshotRow] = await db
    .select({ id: approvedCampaignSnapshots.id })
    .from(approvedCampaignSnapshots)
    .where(eq(approvedCampaignSnapshots.campaignId, campaignId))
    .limit(1);
  if (!snapshotRow) return ['The campaign is not approved yet.'];

  // Every included, launch-required Creator must be `ready` (§16). We take the
  // set Admin marked `included` + `launchRequired` as "scheduled".
  const scheduled = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      status: campaignAffiliateAssociations.status,
      launchRequired: associationReadiness.launchRequired,
      rosterDecision: associationReadiness.rosterDecision,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(associationReadiness, eq(associationReadiness.associationId, campaignAffiliateAssociations.id))
    .where(eq(campaignAffiliateAssociations.campaignId, campaignId));

  const required = scheduled.filter((s) => s.rosterDecision === 'included' && s.launchRequired);
  if (required.length === 0) {
    return ['No launch-required Creator has been marked ready for this campaign.'];
  }

  const blockers: string[] = [];
  for (const creator of required) {
    if (creator.status !== 'ready') {
      const gathered = await gatherCreatorReadiness(db, mode, creator.associationId);
      const items = gathered ? deriveCreatorReadiness(gathered.snapshot).incompleteItems : ['unknown'];
      blockers.push(
        `A required Creator is not ready (${items.map(labelForItem).join(', ') || creator.status}).`,
      );
    }
  }
  return blockers;
}

function labelForItem(key: string): string {
  return READINESS_ITEMS.find((i) => i.key === key)?.label ?? key;
}
