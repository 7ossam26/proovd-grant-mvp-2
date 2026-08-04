/**
 * Threshold crossings and campaign milestones — Spec §20, §33.6.10 (Phase 17a).
 *
 * §20: "Crossing an Idea threshold emits `threshold reached`; falling below emits
 * `threshold lost`. Each crossing is its own event and notification, deduplicated
 * by state transition." And: "First pre-order, halfway, threshold met, and
 * campaign ended may appear once as a milestone then move to history."
 *
 * ── Deduplicated by transition, not by time and not by count ────────────────
 * `evaluateThresholdCrossing` compares the campaign's current state against the
 * last crossing actually recorded. A campaign that crosses up, down, and up again
 * emits three events; a hundred evaluations with no crossing between them emit
 * none. That is what lets it run on *every* pre-order and *every* cancellation,
 * which is where it has to run: a sweep on an interval would miss a campaign that
 * crossed and recrossed between two runs, and §20 says each crossing notifies.
 *
 * Three mechanisms make it safe under concurrency and retry, in the shape Phase
 * 11's listing payment established: the campaign row is locked `FOR UPDATE` so two
 * concurrent pre-orders cannot both read "below" and both insert `reached`;
 * migration 0026's alternation trigger refuses a second same-direction row even
 * if a service bug got past the lock; and the notification dedups on the crossing
 * row, so a retried send is one email.
 *
 * ── Idea only ───────────────────────────────────────────────────────────────
 * §14.4 gives a Product campaign an internal momentum target and states "No
 * public funding gate". A Product campaign has no threshold to cross, so this
 * returns without writing anything — not because the arithmetic would fail, but
 * because emitting `threshold reached` against an internal target would publish a
 * gate the Spec says does not exist.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import {
  campaignThresholdCrossings,
  campaignMilestones,
  type CampaignThresholdCrossing,
  type CampaignMilestone,
} from '../db/schema/live.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { notifyThresholdCrossing } from './notifications.js';
import { readPreorderCounts } from './counts.js';
import {
  crossingFor,
  reachedMilestones,
  thresholdStateFor,
  type MilestoneKind,
  type ThresholdCrossing,
} from './logic.js';

/** §23.1 statuses in which a campaign is collecting and a crossing is meaningful. */
const COLLECTING_STATUSES = ['live'] as const;

/** §23.1 statuses that mean the campaign is over, for the `campaign_ended` milestone. */
const ENDED_STATUSES = [
  'closed_pending_capture',
  'capture_retry_window',
  'closed_reconciling',
  'captured_pending_w9',
  'single_payment_released',
  'first_payment_released',
  'day_14_review',
  'remaining_payment_released',
  'fulfilled',
  'closed_resolved',
  'ended_no_charge',
  'suspended',
  'killed',
] as const;

export interface CrossingEvaluation {
  /** The crossing that was recorded, or null when nothing crossed. */
  crossing: CampaignThresholdCrossing | null;
  /** Milestones newly recorded by this evaluation. */
  milestones: CampaignMilestone[];
}

/**
 * Evaluates one campaign's threshold state and records a crossing if it moved.
 *
 * Called from the pre-order and the cancellation, and from the reconciliation
 * sweep. Idempotent by construction — a second call with no change in between
 * writes nothing and returns `crossing: null`.
 */
export async function evaluateThresholdCrossing(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; actor: string },
): Promise<CrossingEvaluation> {
  const counts = await readPreorderCounts(db, input.campaignId);

  const result = await db.transaction(async (tx) => {
    // Locked first. Two concurrent pre-orders reading "below" and both inserting
    // `reached` is exactly the race §20's "once per crossing" forbids.
    const [campaign] = await tx
      .select({
        id: campaigns.id,
        type: campaigns.type,
        status: campaigns.status,
      })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .for('update')
      .limit(1);
    if (!campaign) return { crossing: null, milestones: [] as CampaignMilestone[] };

    const model = campaign.type === 'pre_build' ? 'idea' : 'product';
    const ended = (ENDED_STATUSES as readonly string[]).includes(campaign.status);

    const [build] = await tx
      .select({ orderThreshold: campaignBuild.orderThreshold })
      .from(campaignBuild)
      .where(eq(campaignBuild.campaignId, input.campaignId))
      .limit(1);
    const threshold = model === 'idea' ? (build?.orderThreshold ?? null) : null;

    let crossing: CampaignThresholdCrossing | null = null;

    // A crossing is only meaningful while the campaign is collecting. After close
    // the Idea threshold is fixed (§21) and a late cancellation must not emit
    // `threshold lost` against a result already decided.
    const collecting = (COLLECTING_STATUSES as readonly string[]).includes(campaign.status);

    if (threshold !== null && threshold >= 1 && collecting) {
      const [last] = await tx
        .select({ direction: campaignThresholdCrossings.direction })
        .from(campaignThresholdCrossings)
        .where(eq(campaignThresholdCrossings.campaignId, input.campaignId))
        .orderBy(desc(campaignThresholdCrossings.occurredAt), desc(campaignThresholdCrossings.id))
        .limit(1);

      const direction = crossingFor(
        (last?.direction as ThresholdCrossing | undefined) ?? null,
        thresholdStateFor(counts.uniqueActiveBackers, threshold),
      );

      if (direction) {
        const [row] = await tx
          .insert(campaignThresholdCrossings)
          .values({
            campaignId: input.campaignId,
            direction,
            uniqueActiveBackers: counts.uniqueActiveBackers,
            threshold,
          })
          .returning();
        crossing = row ?? null;
      }
    }

    // §20's milestones. Recorded whenever they become true, once each — the
    // unique index is what makes "once" true rather than a check-then-insert.
    const reached = reachedMilestones({
      model,
      everHadPreorder: counts.everHadPreorder,
      uniqueActiveBackers: counts.uniqueActiveBackers,
      ...(threshold !== null ? { threshold } : {}),
      ended,
    });

    const milestones: CampaignMilestone[] = [];
    for (const kind of reached) {
      const inserted = await tx
        .insert(campaignMilestones)
        .values({ campaignId: input.campaignId, kind })
        .onConflictDoNothing({ target: [campaignMilestones.campaignId, campaignMilestones.kind] })
        .returning();
      if (inserted[0]) milestones.push(inserted[0]);
    }

    return { crossing, milestones };
  });

  if (result.crossing) {
    await deps.audit({
      action:
        result.crossing.direction === 'reached'
          ? 'live.threshold_reached'
          : 'live.threshold_lost',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason:
        `§20 threshold ${result.crossing.direction}: ${result.crossing.uniqueActiveBackers} unique active ` +
        `Backers against a threshold of ${result.crossing.threshold}`,
      priorValue: { direction: result.crossing.direction === 'reached' ? 'below' : 'reached' },
      newValue: { direction: result.crossing.direction },
      actorId: input.actor,
    });
  }

  for (const milestone of result.milestones) {
    await deps.audit({
      action: 'live.milestone_reached',
      targetType: 'campaign',
      targetId: input.campaignId,
      internalReason: `§20 milestone ${milestone.kind} recorded`,
      actorId: input.actor,
    });
  }

  return result;
}

/* ── Evaluate and notify — the one call every mutation site makes ──────────── */

export interface ThresholdHookDeps {
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/**
 * Evaluates the crossing and sends §20's two notices if it moved.
 *
 * One function so there is one implementation, called from the pre-order route,
 * the cancellation route, the reward-replacement route, and the reconciliation
 * sweep. A rule written in a route is a rule the next route forgets (§12's lesson,
 * restated) — the sweep is what covers the routes that do not exist yet and the
 * paths that change counts without going through a Backer action at all, such as
 * §26.7's kill.
 *
 * The notification runs after the evaluation transaction committed. A provider
 * refusal is recorded, never rolled back onto the crossing: the campaign crossed
 * whether or not the email left the building, and rolling it back would let it
 * cross twice.
 */
export async function evaluateAndNotifyThreshold(
  db: Database,
  deps: ThresholdHookDeps,
  input: { campaignId: string; actor: string },
): Promise<CrossingEvaluation> {
  const result = await evaluateThresholdCrossing(db, { audit: deps.audit }, input);
  if (result.crossing && deps.notifier && deps.context) {
    await notifyThresholdCrossing(db, deps.notifier, deps.context, result.crossing);
  }
  return result;
}

/**
 * Reconciliation across every live Idea campaign.
 *
 * Independently idempotent — `crossingFor` emits nothing when nothing moved and
 * migration 0026's alternation trigger refuses a duplicate underneath — so it is
 * safe to run twice, which is the §28.3 property every job here has.
 *
 * It is a *reconciliation*, not the primary path. §20 says each crossing
 * notifies, and a campaign that crossed up and back down between two sweep runs
 * would owe two notices this could never send — which is why the mutation sites
 * call `evaluateAndNotifyThreshold` directly and this exists to catch what they
 * miss. It sends no message that is not behind a real crossing, so it is not the
 * scheduled engagement email §33.6.11 forbids.
 */
export async function sweepThresholdCrossings(
  db: Database,
  deps: ThresholdHookDeps,
): Promise<{ evaluated: number; crossings: number }> {
  const live = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'live'), eq(campaigns.type, 'pre_build')));

  let crossings = 0;
  for (const campaign of live) {
    const result = await evaluateAndNotifyThreshold(db, deps, {
      campaignId: campaign.id,
      actor: 'system:threshold-reconciliation',
    });
    if (result.crossing) crossings += 1;
  }
  return { evaluated: live.length, crossings };
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function listCrossings(
  db: Database,
  campaignId: string,
): Promise<CampaignThresholdCrossing[]> {
  return db
    .select()
    .from(campaignThresholdCrossings)
    .where(eq(campaignThresholdCrossings.campaignId, campaignId))
    .orderBy(desc(campaignThresholdCrossings.occurredAt));
}

/** Milestones that have not yet been moved to history — Act rank 5's source. */
export async function listOpenMilestones(
  db: Database,
  campaignId: string,
): Promise<CampaignMilestone[]> {
  return db
    .select()
    .from(campaignMilestones)
    .where(
      and(
        eq(campaignMilestones.campaignId, campaignId),
        sql`${campaignMilestones.acknowledgedAt} is null`,
      ),
    )
    .orderBy(campaignMilestones.occurredAt);
}

export async function listMilestones(
  db: Database,
  campaignId: string,
): Promise<CampaignMilestone[]> {
  return db
    .select()
    .from(campaignMilestones)
    .where(eq(campaignMilestones.campaignId, campaignId))
    .orderBy(campaignMilestones.occurredAt);
}

/**
 * §20: a milestone "may appear once as a milestone then move to history".
 *
 * One-way — migration 0026 refuses to clear it. Acknowledging is the Founder
 * saying they have seen it, which is what removes it from Act rank 5; it does not
 * post anything, because §20 makes the milestone update optional and a surface
 * that posted on acknowledgement would have made it mandatory.
 */
export async function acknowledgeMilestone(
  db: Database,
  input: { campaignId: string; kind: MilestoneKind; actor: string },
): Promise<boolean> {
  const updated = await db
    .update(campaignMilestones)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: input.actor })
    .where(
      and(
        eq(campaignMilestones.campaignId, input.campaignId),
        eq(campaignMilestones.kind, input.kind),
        sql`${campaignMilestones.acknowledgedAt} is null`,
      ),
    )
    .returning({ id: campaignMilestones.id });
  return updated.length > 0;
}
