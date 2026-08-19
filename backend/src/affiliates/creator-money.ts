/**
 * The Creator's Earnings address — Creator Flow v2 **deviation 5**, Session F,
 * 2026-08-20.
 *
 * ═══ AN ADDRESS, NOT A SECOND COMPUTATION (§33.8.13) ════════════════════════
 *
 * §22.1's seven earnings states and Appendix B.7's block have exactly one
 * resolver — `resolveAffiliateMoneyStatus`, which throws on an unfilled bracket
 * — and one record, `creator_earnings`, whose amounts are trigger-immutable.
 * This read calls `readCreatorClose` per association and lists what it returns.
 * It computes no amount of its own: there is no `percentOfCents`, no
 * multiplication, and no `BigInt` arithmetic anywhere in this file except the
 * lifetime sum, which is an addition of numbers the finalization record
 * already stored.
 *
 * The F4 consistency pass deep-compares a row here against that campaign's own
 * close view and against the amount the §27.4 email carries. They agree because
 * they are the same call, not because three implementations were kept in step.
 *
 * ── Why an account-level money page needed a recorded deviation ────────────
 * §26: *"The Admin panel is the only dashboard-style product in MVP."* What is
 * built is a LIST — one row per campaign, each row the block that campaign's
 * own surface renders — plus a lifetime total that is a sum of recorded rows.
 * No chart, no trend, no comparison to anybody else.
 *
 * ── What is absent, and it is the point (§22.1) ────────────────────────────
 * There is no withdrawal. §22.1, verbatim: *"The Affiliate never requests a
 * Proovd withdrawal and never receives Backer funds before Transfer creation."*
 * There is no route in this module that moves money, no field a surface could
 * bind a control to, and the suite walks every control on the rendered page for
 * `withdraw`, `cash out`, and `request payout`.
 */

import { desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignAffiliateAssociations, campaigns } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { creatorEarnings } from '../db/schema/earnings.js';
import { readCreatorClose, type CreatorCloseView } from '../close/creator-close.js';

export interface CreatorEarningsRow {
  associationId: string;
  campaignId: string;
  campaignTitle: string;
  /**
   * The campaign's own close view, or null while it has not closed.
   *
   * Null is a stage, not a zero: §22.1 works earnings out after the campaign
   * closes and its charges settle, so before that there is no number to state
   * (§16a). The surface says which of the two it is.
   */
  close: CreatorCloseView | null;
  /** Why there is no block yet, when there is none. */
  waitingOn: string | null;
}

export interface CreatorEarningsView {
  /**
   * The sum of every FINALIZED total this Creator holds.
   *
   * Recorded rows only — commission + bonus + eligible fixed, the three
   * separate stored numbers §24.4 keeps apart. An estimate is never added in:
   * a lifetime figure that moved when a campaign reconciled would have been
   * wrong on the way there.
   */
  lifetimeRecordedCents: string;
  /** How many campaigns contributed to it. Zero is honest; the label is not "0". */
  recordedCampaigns: number;
  rows: CreatorEarningsRow[];
}

/**
 * Every association this Creator holds, newest first.
 *
 * Resolved through `affiliate_signup_profiles.claimed_user_id` — the account
 * identity. `campaign_affiliate_associations.affiliate_id` holds the §8
 * PROSPECT id, and anything keying money off it routes at a UUID nobody owns.
 */
export async function readCreatorEarnings(
  db: Database,
  userId: string,
): Promise<CreatorEarningsView> {
  const profiles = await db
    .select({ associationId: affiliateSignupProfiles.associationId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.claimedUserId, userId));
  const associationIds = profiles.map((p) => p.associationId);
  if (associationIds.length === 0) {
    return { lifetimeRecordedCents: '0', recordedCampaigns: 0, rows: [] };
  }

  const associations = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      createdAt: campaignAffiliateAssociations.createdAt,
    })
    .from(campaignAffiliateAssociations)
    .where(inArray(campaignAffiliateAssociations.id, associationIds))
    .orderBy(desc(campaignAffiliateAssociations.createdAt));

  const campaignIds = associations.map((a) => a.campaignId);
  const builds = campaignIds.length
    ? await db
        .select({ campaignId: campaignBuild.campaignId, title: campaignBuild.title })
        .from(campaignBuild)
        .where(inArray(campaignBuild.campaignId, campaignIds))
    : [];
  const statuses = campaignIds.length
    ? await db
        .select({ id: campaigns.id, status: campaigns.status })
        .from(campaigns)
        .where(inArray(campaigns.id, campaignIds))
    : [];

  // The lifetime figure is a sum of RECORDED rows, read straight from the
  // finalization record. §24.4's three numbers are stored separately and are
  // added here and nowhere else — there is no split, no weighting, and no
  // percentage in this file (the reference's `earned * 0.8` is refused).
  const finalized = await db
    .select({
      associationId: creatorEarnings.associationId,
      commissionCents: creatorEarnings.commissionCents,
      bonusCents: creatorEarnings.bonusCents,
      eligibleFixedCents: creatorEarnings.eligibleFixedCents,
    })
    .from(creatorEarnings)
    .where(inArray(creatorEarnings.associationId, associationIds));

  let lifetime = 0n;
  for (const row of finalized) {
    lifetime += row.commissionCents + row.bonusCents + row.eligibleFixedCents;
  }

  const rows: CreatorEarningsRow[] = [];
  for (const association of associations) {
    const result = await readCreatorClose(db, { associationId: association.id });
    const title =
      builds.find((b) => b.campaignId === association.campaignId)?.title ?? 'the campaign';
    const status = statuses.find((s) => s.id === association.campaignId)?.status ?? null;
    rows.push({
      associationId: association.id,
      campaignId: association.campaignId,
      campaignTitle: title,
      close: result.ok ? result.view : null,
      waitingOn: result.ok
        ? null
        : status === 'live'
          ? 'This campaign is still running. Earnings are worked out after it closes and its charges settle.'
          : 'This campaign has not closed yet, so there is nothing worked out for it.',
    });
  }

  return {
    lifetimeRecordedCents: lifetime.toString(),
    recordedCampaigns: finalized.length,
    rows,
  };
}
