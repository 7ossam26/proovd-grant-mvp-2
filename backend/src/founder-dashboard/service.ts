/**
 * The Founder dashboard shell's own read — Founder Dashboard Session B (B4).
 *
 * The shell needs five facts to draw its rail: which chapter the campaign is
 * in, which chapters may be opened, and what to call the campaign. This is the
 * read that supplies them, and it is deliberately its OWN read rather than a
 * field on §20's `readCampaignHome`.
 *
 * ── Why not reuse the §20 home read ─────────────────────────────────────────
 * `readGlance` issues a `campaign_home_deliveries` receipt carrying the count
 * it rendered (§33.6.6). The shell re-reads on every chapter change, and a
 * shell that minted a receipt per chapter switch would advance last-seen for
 * deltas the Founder never saw — the exact failure §20's two-write split
 * exists to prevent. This read touches no delivery record and writes nothing.
 *
 * ── Why not widen `GET /api/founder/campaigns` ──────────────────────────────
 * That is a list, and the shell wants one campaign. More to the point, the
 * list is the signed-in Founder's whole inventory: growing it with every
 * column one surface happens to need is how a list read becomes a join per
 * row.
 *
 * ── Nothing here is a query parameter ───────────────────────────────────────
 * The supplied reference drives its chapters from `?phase=`, `?type=` and
 * `?day=`. Every one is a column below. A caller that could name its own phase
 * could name `ended` on a live campaign and open the Get-paid chapter.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';

export interface FounderDashboardView {
  readonly campaignId: string;
  /** §23.1's lifecycle value. The chapter is derived from it, never stored. */
  readonly status: string;
  /** §9's locked campaign type, or null before the lock. */
  readonly type: string | null;
  /**
   * §17 stamps this at launch and nothing else writes it, so it is the one
   * honest answer to "did this campaign ever open". `campaign_close_at` cannot
   * stand in: §17 stamps that at launch too, as a SCHEDULE.
   */
  readonly campaignLiveAt: string | null;
  readonly campaignCloseAt: string | null;
  readonly listingPaidAt: string | null;
  /** §12's classification, locked at listing-fee payment. */
  readonly highEffort: boolean;
  /**
   * §14.4's own title, or null while the build has none. Null renders as
   * nothing rather than as an invented name (§1.4) — the shell has a campaign
   * id and that is not a name.
   */
  readonly title: string | null;
}

/**
 * One campaign, scoped to its Founder inside the query. A campaign belonging to
 * somebody else answers `null`, which the route turns into the same 404 a
 * campaign that does not exist gets — `findFounderCampaign`'s rule, so nothing
 * can be enumerated.
 */
export async function readFounderDashboard(
  db: Database,
  input: { campaignId: string; founderUserId: string },
): Promise<FounderDashboardView | null> {
  const [row] = await db
    .select({
      campaignId: campaigns.id,
      status: campaigns.status,
      type: campaigns.type,
      campaignLiveAt: campaigns.campaignLiveAt,
      campaignCloseAt: campaigns.campaignCloseAt,
      listingPaidAt: campaigns.listingPaidAt,
      highEffort: campaigns.highEffort,
      title: campaignBuild.title,
    })
    .from(campaigns)
    .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    // Left, not inner: a campaign has no build row until §14.4 starts, and a
    // shell that 404s on a campaign in `listing_fee_pending` would lock the
    // Founder out of the one chapter that is always open.
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.id, input.campaignId),
        eq(founderClaimProfiles.claimedUserId, input.founderUserId),
        isNull(campaigns.archivedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    campaignId: row.campaignId,
    status: row.status,
    type: row.type ?? null,
    campaignLiveAt: row.campaignLiveAt?.toISOString() ?? null,
    campaignCloseAt: row.campaignCloseAt?.toISOString() ?? null,
    listingPaidAt: row.listingPaidAt?.toISOString() ?? null,
    highEffort: row.highEffort ?? false,
    title: row.title ?? null,
  };
}
