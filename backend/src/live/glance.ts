/**
 * §20 Glance and its delivery receipt — Spec §20, §33.6.6 (Phase 17a).
 *
 * ── The trap this module exists to avoid ────────────────────────────────────
 * §20: "Store/update `last_seen_count` and `last_seen_at` only after the rendered
 * state is successfully delivered." The obvious implementation advances last-seen
 * inside the read, and it is wrong in a way nobody notices until it matters: if
 * the response never arrives, the Founder's delta has been consumed by a render
 * they did not see, and it is gone permanently. §20 calls that out and §33.6.6
 * tests it.
 *
 * A server cannot assert delivery about its own response — the connection can
 * drop after the last byte leaves. So this splits into two writes:
 *
 *   `readGlance`         issues a receipt (`campaign_home_deliveries`) carrying
 *                        exactly the count it rendered, and advances nothing.
 *   `acknowledgeDelivery` is called by the surface once the render succeeded, and
 *                        it is the only thing that moves last-seen.
 *
 * A failed render never acknowledges, the receipt stays open, and the next read
 * computes the same delta from the same unmoved position. Reading twice in a row
 * without acknowledging returns the same delta twice, which is exactly right: the
 * Founder has still not seen it.
 *
 * The acknowledgement advances last-seen to the *receipt's* count, never to the
 * count at acknowledgement time. Otherwise acknowledging a delta you read would
 * silently consume one that arrived while you were reading it.
 *
 * ── Never "real time" ───────────────────────────────────────────────────────
 * Freshness is a timestamp the caller formats as `Updated 3:40 PM`, and the
 * payload says the page is refresh-based. §30 bans the immediacy claim and
 * `BANNED_FRESHNESS_TERMS` is scanned across this phase's files by test.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  campaignHomeDeliveries,
  founderCampaignLastSeen,
  type CampaignHomeDelivery,
} from '../db/schema/live.js';
import { readPreorderCounts, type PreorderCounts } from './counts.js';
import { GLANCE_NOT_YET_CHARGED } from './logic.js';

export interface GlanceView {
  /** §20: "One large number: active pre-order count." */
  activePreorderCount: number;

  /**
   * §20's last-visit delta. `null` on a first visit — there is no previous
   * position, and rendering `+N since` against nothing would invent a visit.
   */
  delta: { count: number; since: string } | null;

  /** §20's two progress lines, decided by campaign model. */
  model: 'idea' | 'product';
  /** Idea only: how many more unique Backers to reach the threshold. */
  remainingToThreshold: number | null;
  /** Both models state the close. ISO; the surface renders local with UTC (§27.1). */
  closesAt: string | null;

  /** §20: the permanent clarification. Not dismissible, not a tooltip. */
  notYetChargedNotice: string;

  /**
   * §20: "Current Creator liveness only when true." `null` means there is
   * nothing true to say — not zero, which would read as a stated fact about an
   * empty roster (§1.4).
   */
  activeCreators: number | null;

  /** §20: freshness as a time. The surface renders `Updated 3:40 PM`. */
  readAt: string;
  /** §30: refresh-based, and the payload says so rather than implying otherwise. */
  freshnessBasis: 'refresh';

  /** The receipt to acknowledge once the render succeeded (§33.6.6). */
  deliveryId: string;

  counts: PreorderCounts;
}

/**
 * Builds Glance and issues the delivery receipt.
 *
 * Advances nothing. That is the whole point of the split — see the header.
 */
export async function readGlance(
  db: Database,
  input: { campaignId: string; viewerUserId: string },
): Promise<GlanceView | null> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      status: campaigns.status,
      campaignCloseAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return null;

  const counts = await readPreorderCounts(db, input.campaignId);
  const model = campaign.type === 'pre_build' ? 'idea' : 'product';

  const [build] = await db
    .select({ orderThreshold: campaignBuild.orderThreshold, closesAt: campaignBuild.closesAt })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.campaignId))
    .limit(1);

  const threshold = model === 'idea' ? (build?.orderThreshold ?? null) : null;
  const remainingToThreshold =
    threshold === null ? null : Math.max(0, threshold - counts.uniqueActiveBackers);

  const [lastSeen] = await db
    .select({
      lastSeenCount: founderCampaignLastSeen.lastSeenCount,
      lastSeenAt: founderCampaignLastSeen.lastSeenAt,
    })
    .from(founderCampaignLastSeen)
    .where(
      and(
        eq(founderCampaignLastSeen.campaignId, input.campaignId),
        eq(founderCampaignLastSeen.viewerUserId, input.viewerUserId),
      ),
    )
    .limit(1);

  // §20: "Current Creator liveness only when true." Counted from the association
  // states §2.2 calls an active partnership; a campaign with none says nothing
  // rather than saying zero.
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignAffiliateAssociations)
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, input.campaignId),
        eq(campaignAffiliateAssociations.status, 'active'),
      ),
    );
  const activeCreators = Number(live?.n ?? 0);

  const [delivery] = await db
    .insert(campaignHomeDeliveries)
    .values({
      campaignId: input.campaignId,
      viewerUserId: input.viewerUserId,
      renderedActiveCount: counts.activeCount,
    })
    .returning();

  return {
    activePreorderCount: counts.activeCount,
    delta: lastSeen
      ? {
          // A drop since the last visit is not a negative delta — §20's sentence
          // is `+N since [date]` or a truthful no-change. Cancellations are
          // reported in Explore, where the definition sits beside the number.
          count: Math.max(0, counts.activeCount - lastSeen.lastSeenCount),
          since: lastSeen.lastSeenAt.toISOString(),
        }
      : null,
    model,
    remainingToThreshold,
    closesAt: (campaign.campaignCloseAt ?? build?.closesAt ?? null)?.toISOString() ?? null,
    notYetChargedNotice: GLANCE_NOT_YET_CHARGED,
    activeCreators: activeCreators > 0 ? activeCreators : null,
    readAt: new Date().toISOString(),
    freshnessBasis: 'refresh',
    deliveryId: delivery!.id,
    counts,
  };
}

export type AcknowledgeOutcome =
  | { ok: true; advanced: boolean }
  | { ok: false; code: 'not_found' | 'already_acknowledged' };

/**
 * The only thing that moves last-seen (§33.6.6).
 *
 * Idempotent by the receipt: migration 0026 refuses a second acknowledgement, so
 * a retrying client cannot consume a second delta. `advanced` is false when the
 * receipt was older than the position already recorded — a stale tab finishing
 * its render must not rewind a Founder past something they have read, which the
 * monotonic trigger also refuses underneath.
 */
export async function acknowledgeDelivery(
  db: Database,
  input: { deliveryId: string; campaignId: string; viewerUserId: string },
): Promise<AcknowledgeOutcome> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(campaignHomeDeliveries)
      .where(
        and(
          eq(campaignHomeDeliveries.id, input.deliveryId),
          eq(campaignHomeDeliveries.campaignId, input.campaignId),
          eq(campaignHomeDeliveries.viewerUserId, input.viewerUserId),
        ),
      )
      .for('update')
      .limit(1);

    if (!delivery) return { ok: false as const, code: 'not_found' as const };
    if (delivery.acknowledgedAt) {
      return { ok: false as const, code: 'already_acknowledged' as const };
    }

    await tx
      .update(campaignHomeDeliveries)
      .set({ acknowledgedAt: new Date() })
      .where(eq(campaignHomeDeliveries.id, delivery.id));

    const [existing] = await tx
      .select({
        id: founderCampaignLastSeen.id,
        lastSeenAt: founderCampaignLastSeen.lastSeenAt,
      })
      .from(founderCampaignLastSeen)
      .where(
        and(
          eq(founderCampaignLastSeen.campaignId, input.campaignId),
          eq(founderCampaignLastSeen.viewerUserId, input.viewerUserId),
        ),
      )
      .for('update')
      .limit(1);

    if (!existing) {
      await tx.insert(founderCampaignLastSeen).values({
        campaignId: input.campaignId,
        viewerUserId: input.viewerUserId,
        lastSeenCount: delivery.renderedActiveCount,
        lastSeenAt: delivery.renderedAt,
        lastDeliveryId: delivery.id,
      });
      return { ok: true as const, advanced: true };
    }

    if (delivery.renderedAt <= existing.lastSeenAt) {
      // An out-of-order acknowledgement. The receipt is spent — it may not be
      // used twice — but the position does not move backwards.
      return { ok: true as const, advanced: false };
    }

    await tx
      .update(founderCampaignLastSeen)
      .set({
        lastSeenCount: delivery.renderedActiveCount,
        lastSeenAt: delivery.renderedAt,
        lastDeliveryId: delivery.id,
      })
      .where(eq(founderCampaignLastSeen.id, existing.id));

    return { ok: true as const, advanced: true };
  });
}

/** The open receipts for one viewer. Used by the suite to prove nothing advanced. */
export async function listOpenDeliveries(
  db: Database,
  input: { campaignId: string; viewerUserId: string },
): Promise<CampaignHomeDelivery[]> {
  return db
    .select()
    .from(campaignHomeDeliveries)
    .where(
      and(
        eq(campaignHomeDeliveries.campaignId, input.campaignId),
        eq(campaignHomeDeliveries.viewerUserId, input.viewerUserId),
        sql`${campaignHomeDeliveries.acknowledgedAt} is null`,
      ),
    );
}
