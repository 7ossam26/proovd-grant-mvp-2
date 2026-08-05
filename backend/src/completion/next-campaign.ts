/**
 * §22.10's Founder next-campaign readiness — Spec §22.10, §6, §29.6, §33.10.9.
 *
 * ── Two gates, and they are independent ─────────────────────────────────────
 * §22.10 lists the cooldown date and the Admin decision as separate lines, and
 * the phase trap says why it matters: "Meeting the cooldown grants nothing by
 * itself." So the read returns both, each with its own state, and there is no
 * combined boolean anywhere for a surface to render as a single green tick.
 * `readyForNextCampaign` exists and requires both, but it is derived at the
 * point of use rather than stored — a stored flag is one that can be true
 * while one of its inputs is false.
 *
 * ── The cooldown is derived, never stored ───────────────────────────────────
 * §29.6's rule: a deadline computed once and stored must never silently move.
 * The inverse applies here — the cooldown is a pure function of
 * `campaign_close_at` (immutable, §21) and the §6 setting, so computing it on
 * every read cannot drift, while storing it would create a second answer that
 * a settings change would leave stale. The §6 value in force at read time is
 * what governs, because §22.10 describes what the Founder is shown now rather
 * than a promise made earlier.
 *
 * ── "Ability to prepare updates/evidence without opening a new campaign" ────
 * That line is a product constraint rather than a feature: the surface offers
 * the existing update and evidence routes and offers NO route that creates a
 * campaign. There is no `createNextCampaign` anywhere in this phase, and the
 * suite asserts the absence.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderNextCampaignReadiness } from '../db/schema/completion.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { readSettingValue, SettingNotConfigured } from '../settings/service.js';
import type { AuditWriter } from '../auth/audit.js';
import { nextCampaignEarliestAt, cooldownElapsed, PREPARE_WITHOUT_OPENING } from './logic.js';

export interface NextCampaignDeps {
  db: Database;
  audit: AuditWriter;
}

export interface NextCampaignView {
  campaignId: string;
  /** §22.10: the EXACT earliest request date, in UTC and as an instant. */
  cooldown: {
    key: 'cooldown';
    months: number | null;
    closedAt: string | null;
    earliestAt: string | null;
    elapsed: boolean;
    /** Why it cannot be computed, when it cannot. Never a silent null. */
    blocker: string | null;
  };
  /** §22.10: the SEPARATE Admin decision. */
  adminReadiness: {
    key: 'admin_readiness';
    decision: 'ready' | 'not_ready' | null;
    decidedAt: string | null;
    /** §29.4: the actual criteria, never "policy violation". */
    explanation: string | null;
  };
  /**
   * Both gates. Derived here rather than stored, and never rendered as the
   * only thing on screen — §33.10.9 requires the Founder to see both parts.
   */
  readyForNextCampaign: boolean;
  /** §22.10's own promise about what this page is and is not. */
  prepareNote: string;
}

/**
 * What the Founder sees about their next campaign.
 *
 * Both gates always, even when one cannot be answered: §1.4's rule, applied to
 * a cooldown that cannot be computed because the campaign has not closed. A
 * null with no blocker would read as "no wait", which is the one wrong answer.
 */
export async function readNextCampaignReadiness(
  db: Database,
  campaignId: string,
  now: Date = new Date(),
): Promise<NextCampaignView> {
  const [campaign] = await db
    .select({ id: campaigns.id, closeAt: campaigns.campaignCloseAt, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) throw new Error('no such campaign');

  let months: number | null = null;
  let cooldownBlocker: string | null = null;
  try {
    months = Number(await readSettingValue(db, 'founder_cooldown_months'));
  } catch (error) {
    if (error instanceof SettingNotConfigured) {
      // §6 ships this with a value, so this is a deployment that cleared it.
      // Saying so beats showing a date computed from a number nobody set.
      cooldownBlocker = 'Proovd has not stated the repeat-campaign cooldown on this deployment yet.';
    } else {
      throw error;
    }
  }

  const closedAt = campaign.closeAt;
  if (!closedAt) {
    cooldownBlocker =
      cooldownBlocker ??
      'This campaign has not closed yet, so the cooldown has not started counting.';
  }

  const earliestAt =
    closedAt && months !== null ? nextCampaignEarliestAt(closedAt, months) : null;

  const [decision] = await db
    .select({
      decision: founderNextCampaignReadiness.decision,
      decidedAt: founderNextCampaignReadiness.decidedAt,
      explanation: founderNextCampaignReadiness.customerExplanation,
    })
    .from(founderNextCampaignReadiness)
    .where(
      and(
        eq(founderNextCampaignReadiness.campaignId, campaignId),
        isNull(founderNextCampaignReadiness.supersededAt),
      ),
    )
    .orderBy(desc(founderNextCampaignReadiness.decidedAt))
    .limit(1);

  const elapsed =
    closedAt !== null && months !== null ? cooldownElapsed(closedAt, months, now) : false;

  return {
    campaignId,
    cooldown: {
      key: 'cooldown',
      months,
      closedAt: closedAt?.toISOString() ?? null,
      earliestAt: earliestAt?.toISOString() ?? null,
      elapsed,
      blocker: cooldownBlocker,
    },
    adminReadiness: {
      key: 'admin_readiness',
      decision: (decision?.decision as 'ready' | 'not_ready' | undefined) ?? null,
      decidedAt: decision?.decidedAt?.toISOString() ?? null,
      explanation: decision?.explanation ?? null,
    },
    // BOTH. The cooldown alone grants nothing, and neither does the decision.
    readyForNextCampaign: elapsed && decision?.decision === 'ready',
    prepareNote: PREPARE_WITHOUT_OPENING,
  };
}

export type ReadinessDecisionOutcome =
  | { ok: true; decisionId: string }
  | { ok: false; code: 'not_found' | 'invalid'; message: string };

/**
 * Admin records the §22.10 readiness judgement.
 *
 * §22.10 fixes no criteria list, so the criteria are the Admin's recorded
 * judgement with its basis — §31.7's posture, and §1 rule 6's requirement that
 * an eligibility condition not be invented in code. A new decision supersedes
 * the previous one; nothing is edited.
 */
export async function recordNextCampaignReadiness(
  deps: NextCampaignDeps,
  input: {
    campaignId: string;
    decision: 'ready' | 'not_ready';
    decidedBy: string;
    criteriaNote: string;
    customerExplanation: string;
  },
): Promise<ReadinessDecisionOutcome> {
  const { db } = deps;

  if (!input.criteriaNote.trim() || !input.customerExplanation.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message:
        '§22.10 needs the criteria you applied and what the Founder is told. Both, and the explanation names the actual position (§29.4).',
    };
  }

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return { ok: false, code: 'not_found', message: 'No such campaign.' };

  const [profile] = await db
    .select({ userId: founderClaimProfiles.claimedUserId })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, input.campaignId))
    .limit(1);
  if (!profile?.userId) {
    return {
      ok: false,
      code: 'not_found',
      message: 'That campaign has no claimed Founder account to assess.',
    };
  }

  const decisionId = await db.transaction(async (tx) => {
    await tx
      .update(founderNextCampaignReadiness)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(founderNextCampaignReadiness.campaignId, input.campaignId),
          isNull(founderNextCampaignReadiness.supersededAt),
        ),
      );

    const [row] = await tx
      .insert(founderNextCampaignReadiness)
      .values({
        campaignId: input.campaignId,
        founderUserId: profile.userId!,
        decision: input.decision,
        decidedBy: input.decidedBy,
        criteriaNote: input.criteriaNote.trim(),
        customerExplanation: input.customerExplanation.trim(),
      })
      .returning({ id: founderNextCampaignReadiness.id });
    return row!.id;
  });

  await deps.audit({
    action: 'next_campaign.readiness_decided',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `§22.10 ${input.decision}: ${input.criteriaNote}`,
    customerExplanation: input.customerExplanation,
    newValue: { decisionId, decision: input.decision },
    actorId: input.decidedBy,
  });

  return { ok: true, decisionId };
}
