/**
 * The Founder campaign home — Spec §20, DNA §5.2, §5.3, §5.6 (Phase 17a).
 *
 * One read composing the three altitudes. It exists so that Glance, Act, and
 * Explore describe the *same* campaign at the *same* instant: three endpoints
 * read a moment apart could disagree about whether the campaign is suspended, and
 * a Glance saying "live" beside an Act saying "resolve a safety block" is the
 * kind of contradiction a Founder reports as the product being broken.
 *
 * DNA §5.3 — the loop, not the map. The payload is ordered: what changed, what to
 * do about it, everything else. There is no top-level list of panels for a
 * surface to lay out in a grid.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { readGlance, type GlanceView } from './glance.js';
import { decideAct, type ActView } from './act.js';
import { readExplore, type ExploreView } from './explore.js';
import { listMilestones } from './thresholds.js';

export interface CampaignHomeView {
  campaignId: string;
  status: string;
  /** §20 Glance. */
  glance: GlanceView;
  /** §20 Act — one ranked action, or the caught-up ending. */
  act: ActView;
  /** §20 Explore. */
  explore: ExploreView;
  /** §20: milestones that have moved to history stay readable. */
  milestoneHistory: { kind: string; occurredAt: string; acknowledgedAt: string | null }[];
}

export async function readCampaignHome(
  db: Database,
  input: { campaignId: string; viewerUserId: string },
): Promise<CampaignHomeView | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      status: campaigns.status,
      campaignCloseAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return null;

  const glance = await readGlance(db, input);
  if (!glance) return null;

  const [build] = await db
    .select({ closesAt: campaignBuild.closesAt })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.campaignId))
    .limit(1);

  const act = await decideAct(db, {
    campaignId: input.campaignId,
    campaignStatus: campaign.status,
    closesAt: campaign.campaignCloseAt ?? build?.closesAt ?? null,
  });

  const explore = await readExplore(db, {
    campaignId: input.campaignId,
    counts: glance.counts,
  });

  const milestones = await listMilestones(db, input.campaignId);

  return {
    campaignId: campaign.id,
    status: campaign.status,
    glance,
    act,
    explore: explore!,
    milestoneHistory: milestones.map((milestone) => ({
      kind: milestone.kind,
      occurredAt: milestone.occurredAt.toISOString(),
      acknowledgedAt: milestone.acknowledgedAt?.toISOString() ?? null,
    })),
  };
}
