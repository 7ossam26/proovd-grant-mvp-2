/**
 * Coordinated launch — Spec §17, §21, §33.4.5, §33.4.6.
 *
 * At `campaign_live_at`, the five steps run in exactly this order:
 *
 *   1. Activate the approved public campaign page  (creator_prep → live).
 *   2. Activate scheduled Creator tracking links with activated_at =
 *      campaign_live_at — they now resolve to the live page, which is why step 1
 *      precedes step 2 (the phase's first trap: a link live before its page is a
 *      URL pointing at a 404).
 *
 * Steps 3–5 (Creators publish, Creators submit URLs, Admin verifies) are the
 * human sequence that follows and lives in `post-verification.ts`; a post cannot
 * exist before its link is live, and a verification cannot exist before its post.
 *
 * ── One state, one set of messages, no money (§33.4.6) ──────────────────────
 * Three mechanisms make the activation idempotent: the `campaign_launched:<id>`
 * idempotency key claimed first so every effect shares its fate, the unique
 * `campaign_launches` row behind it, and the conditional `creator_prep → live`
 * UPDATE that matches nothing on a second pass. Launch moves NO money: it writes
 * no payment flag, no refund, and touches no allocation. The suite asserts the
 * absence, not merely the intent.
 *
 * ── The close anchor is stamped here (§21) ──────────────────────────────────
 * `campaign_close_at` is a dedicated column, set at launch from the approved
 * build's close time — never inferred from created_at/updated_at. Phase 14b's
 * attribution cookie expires at exactly this instant.
 */

import { and, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { campaignLaunches, type CampaignLaunch } from '../db/schema/launch.js';
import { idempotencyKeys } from '../db/schema/integrity.js';
import type { AuditWriter } from '../auth/audit.js';
import { transitionAssociation } from '../affiliates/recruitment.js';

export function campaignLaunchKey(campaignId: string): string {
  return `campaign_launched:${campaignId}`;
}

export interface LaunchDeps {
  audit: AuditWriter;
}

export type LaunchResult =
  | {
      status: 'launched';
      campaignId: string;
      launch: CampaignLaunch;
      activatedAssociationIds: string[];
      campaignCloseAt: Date;
    }
  | { status: 'already_live'; launch: CampaignLaunch | null; activatedAssociationIds: string[] }
  | { status: 'not_found' }
  | { status: 'not_scheduled' }
  | { status: 'not_due'; campaignLiveAt: Date }
  | { status: 'not_launchable'; reason: string };

/**
 * Executes the idempotent five-step activation for one campaign. Returns
 * `already_live` for a campaign already launched — the same value whether this
 * call, a prior call, or a concurrent one did it.
 */
export async function launchCampaign(
  db: Database,
  deps: LaunchDeps,
  input: { campaignId: string; actor: string; now?: Date },
): Promise<LaunchResult> {
  const now = input.now ?? new Date();
  const { audit } = deps;

  try {
    const result = await db.transaction(async (tx): Promise<LaunchResult> => {
      const [campaign] = await tx
        .select({ id: campaigns.id, status: campaigns.status, campaignLiveAt: campaigns.campaignLiveAt })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .for('update')
        .limit(1);
      if (!campaign) return { status: 'not_found' };

      if (campaign.status === 'live') {
        const launch = await findLaunch(tx, input.campaignId);
        return { status: 'already_live', launch, activatedAssociationIds: [] };
      }
      if (campaign.status !== 'creator_prep') {
        return { status: 'not_launchable', reason: `the campaign is ${campaign.status}, not in Creator preparation` };
      }
      if (!campaign.campaignLiveAt) return { status: 'not_scheduled' };
      if (campaign.campaignLiveAt.getTime() > now.getTime()) {
        return { status: 'not_due', campaignLiveAt: campaign.campaignLiveAt };
      }

      const [build] = await tx
        .select({ closesAt: campaignBuild.closesAt })
        .from(campaignBuild)
        .where(eq(campaignBuild.campaignId, input.campaignId))
        .limit(1);
      if (!build?.closesAt) {
        return { status: 'not_launchable', reason: 'the approved build has no close date to anchor the close clock (§21)' };
      }
      const campaignCloseAt = build.closesAt;

      // The exactly-once pivot, claimed first so every effect shares its fate.
      // A concurrent or replayed launch collides here and the transaction aborts.
      await tx.insert(idempotencyKeys).values({
        key: campaignLaunchKey(input.campaignId),
        purpose: 'campaign_launch',
        completedAt: new Date(),
        result: { campaignId: input.campaignId, campaignLiveAt: campaign.campaignLiveAt.toISOString() },
      });

      /* ── Step 1: activate the approved public campaign page ─────────────────── */
      const moved = await tx
        .update(campaigns)
        .set({ status: 'live', campaignCloseAt, updatedAt: now })
        .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.status, 'creator_prep')))
        .returning({ id: campaigns.id });
      if (moved.length !== 1) {
        // Held FOR UPDATE, so this cannot happen for a real state — but a rule
        // written in a route is one the next route forgets. Fail the transaction.
        throw new Error('the campaign left creator_prep during launch');
      }
      await tx.insert(campaignStatusHistory).values({
        campaignId: input.campaignId,
        fromStatus: 'creator_prep',
        toStatus: 'live',
        actor: input.actor,
      });

      /* ── Step 2: activate the scheduled Creator tracking links ──────────────── */
      // Every `ready` Creator with a tracking link — a ready association passed
      // §16 readiness and was included. Links activate at exactly campaign_live_at
      // and now resolve to the page step 1 just made live.
      const ready = await tx
        .select({
          associationId: campaignAffiliateAssociations.id,
          status: campaignAffiliateAssociations.status,
          linkId: trackingLinks.id,
          linkActive: trackingLinks.active,
        })
        .from(campaignAffiliateAssociations)
        .innerJoin(trackingLinks, eq(trackingLinks.associationId, campaignAffiliateAssociations.id))
        .where(
          and(
            eq(campaignAffiliateAssociations.campaignId, input.campaignId),
            eq(campaignAffiliateAssociations.status, 'ready'),
          ),
        )
        .for('update');

      const activatedAssociationIds: string[] = [];
      for (const row of ready) {
        if (!row.linkActive) {
          await tx
            .update(trackingLinks)
            .set({ active: true, activatedAt: campaign.campaignLiveAt })
            .where(eq(trackingLinks.id, row.linkId));
        }
        const activated = await transitionAssociation(
          row.associationId,
          'ready',
          'active',
          input.actor,
          tx,
        );
        if (activated) activatedAssociationIds.push(row.associationId);
      }

      const [launch] = await tx
        .insert(campaignLaunches)
        .values({
          campaignId: input.campaignId,
          launchedAt: now,
          campaignLiveAt: campaign.campaignLiveAt,
          activatedLinkCount: activatedAssociationIds.length,
          actor: input.actor,
        })
        .returning();

      await audit({
        action: 'campaign.launched',
        targetType: 'campaign',
        targetId: input.campaignId,
        internalReason:
          `§17 activation at campaign_live_at ${campaign.campaignLiveAt.toISOString()}: page activated (→ live), ` +
          `${activatedAssociationIds.length} tracking link(s) activated at exactly that instant, close anchored at ${campaignCloseAt.toISOString()}. No money moved.`,
        newValue: {
          campaignCloseAt: campaignCloseAt.toISOString(),
          activatedAssociationIds,
        },
        actorId: input.actor.replace(/^user:|^admin:|^system:/, '') || null,
      });

      return {
        status: 'launched',
        campaignId: input.campaignId,
        launch: launch!,
        activatedAssociationIds,
        campaignCloseAt,
      };
    });
    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent or replayed launch won the race. One state, one record.
      const launch = await findLaunch(db, input.campaignId);
      return { status: 'already_live', launch, activatedAssociationIds: [] };
    }
    throw error;
  }
}

/* ── The scheduled-launch sweep (§17) ──────────────────────────────────────── */

export interface LaunchSweepResult {
  launched: string[];
  alreadyLive: string[];
}

/**
 * Launches every campaign whose scheduled `campaign_live_at` has arrived while
 * it still sits in `creator_prep`. Each launch is independently idempotent, so a
 * sweep that runs twice, overlaps itself, or crashes mid-run launches each once.
 */
export async function sweepScheduledLaunches(
  db: Database,
  deps: LaunchDeps,
  now: Date = new Date(),
): Promise<{ result: LaunchSweepResult; launches: LaunchResult[] }> {
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'creator_prep'), lte(campaigns.campaignLiveAt, now)));

  const result: LaunchSweepResult = { launched: [], alreadyLive: [] };
  const launches: LaunchResult[] = [];
  for (const row of due) {
    const outcome = await launchCampaign(db, deps, { campaignId: row.id, actor: 'system:scheduled_launch', now });
    launches.push(outcome);
    if (outcome.status === 'launched') result.launched.push(row.id);
    else if (outcome.status === 'already_live') result.alreadyLive.push(row.id);
  }
  return { result, launches };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

type Executor = Pick<Database, 'select'>;

export async function findLaunch(db: Executor, campaignId: string): Promise<CampaignLaunch | null> {
  const [row] = await db
    .select()
    .from(campaignLaunches)
    .where(eq(campaignLaunches.campaignId, campaignId))
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}
