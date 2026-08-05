/**
 * Pre-order context — the campaign, reward, Founder, and connected account a
 * pre-order is placed against (§19, §24.1, §24.2).
 *
 * A pre-order can only be placed on a *live* campaign whose Founder is a
 * complete seller (§24.1: the Founder connected account is where the campaign
 * charge is made, so the saved card must live there). This loads everything the
 * eligibility checks, tax calculation, consent, and SetupIntent need, and
 * refuses — with a reason a person can act on — when the campaign is not open
 * or the seller is not ready.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { computeCampaignDescriptor } from '../payments/descriptors.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignBuild, campaignRewardPackages, type CampaignRewardPackage } from '../db/schema/build.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { founderProspects } from '../db/schema/invitations.js';
import { findAccountForOwner } from '../payments/connected-accounts.js';
import type { StripeGateway } from '../payments/stripe-client.js';

type Executor = Pick<Database, 'select'>;

export interface PreorderFounder {
  userId: string;
  legalName: string;
  entity: string;
  connectedAccountId: string;
}

export interface PreorderContext {
  campaignId: string;
  model: 'idea' | 'product';
  title: string;
  closeAt: Date;
  orderThreshold: number | null;
  founder: PreorderFounder;
  statementDescriptor: string;
  refundPolicy: {
    title: string | null;
    version: string | null;
    effectiveDate: string | null;
    sourceUrl: string | null;
    /**
     * §24.10's "preserve exact text": the operative policy text as it stood at
     * this reservation. The build row can later change through an Admin-applied
     * change request, so the transaction carries its own copy — a later website
     * edit cannot alter an existing transaction (§33.9.1).
     */
    text: string | null;
  } | null;
}

export type PreorderContextRefusal =
  | 'not_found'
  | 'not_live'
  | 'no_build'
  | 'seller_unavailable';

export type PreorderContextResult =
  | { ok: true; context: PreorderContext }
  | { ok: false; code: PreorderContextRefusal };

/**
 * §24.12 statement descriptor, computed once here and stored on the
 * reservation. Phase 20b: the compute moved to the ONE kernel in
 * `payments/descriptors.ts` (shared-restated, drift-tested) — the public page
 * renders the same kernel's output, and the capture call derives its provider
 * SUFFIX from the stored display rather than re-sending the whole string
 * (§33.9.13).
 */
export function computeStatementDescriptor(founder: { entity: string; legalName: string }): string {
  return computeCampaignDescriptor(founder).display;
}

/** Resolves the Founder user id that owns a campaign (§25.5 chain). */
export async function findCampaignFounderUserId(
  db: Executor,
  campaignId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ claimedUserId: founderProspects.claimedUserId })
    .from(founderClaimProfiles)
    .innerJoin(founderProspects, eq(founderClaimProfiles.prospectId, founderProspects.id))
    .where(eq(founderClaimProfiles.campaignId, campaignId))
    .limit(1);
  return row?.claimedUserId ?? null;
}

export async function loadPreorderContext(
  db: Database,
  gateway: StripeGateway,
  campaignId: string,
): Promise<PreorderContextResult> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      status: campaigns.status,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign || !campaign.type) return { ok: false, code: 'not_found' };
  // §19 pre-orders are only accepted while the campaign is live; before or after
  // there is no open pre-order (the public page renders the ended state instead).
  if (campaign.status !== 'live' || !campaign.closeAt) {
    return { ok: false, code: 'not_live' };
  }

  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  if (!build || !build.title) return { ok: false, code: 'no_build' };

  const [claim] = await db
    .select({
      legalName: founderClaimProfiles.legalName,
      businessName: founderClaimProfiles.businessName,
      soleProprietor: founderClaimProfiles.soleProprietor,
    })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, campaignId))
    .limit(1);

  const founderUserId = await findCampaignFounderUserId(db, campaignId);
  if (!founderUserId) return { ok: false, code: 'seller_unavailable' };

  // §24.1: the saved card and the later charge live on the Founder's seller
  // account. A live campaign implies a complete one (listing payment gated it),
  // but this reads it back rather than trusting the campaign status alone.
  const account = await findAccountForOwner(db, {
    ownerUserId: founderUserId,
    role: 'founder_seller',
    mode: gateway.mode,
  });
  if (!account) return { ok: false, code: 'seller_unavailable' };

  const legalName = build.founderDisplayName ?? claim?.legalName ?? 'The Founder';
  const entity =
    claim?.soleProprietor === true
      ? 'sole proprietor'
      : (build.founderEntityDisplay ?? claim?.businessName ?? 'sole proprietor');

  return {
    ok: true,
    context: {
      campaignId,
      model: campaign.type === 'pre_build' ? 'idea' : 'product',
      title: build.title,
      closeAt: campaign.closeAt,
      orderThreshold: build.orderThreshold ?? null,
      founder: {
        userId: founderUserId,
        legalName,
        entity,
        connectedAccountId: account.stripeAccountId,
      },
      statementDescriptor: computeStatementDescriptor({ legalName, entity }),
      refundPolicy:
        campaign.type === 'pre_launch'
          ? {
              title: build.refundPolicyTitle ?? null,
              version: build.refundPolicyVersion ?? null,
              effectiveDate: build.refundPolicyEffectiveDate ?? null,
              sourceUrl: build.refundPolicySourceUrl ?? null,
              text: build.refundPolicyText ?? null,
            }
          : null,
    },
  };
}

/** One reward package by SKU, or null. Availability is decided by the caller. */
export async function findRewardPackage(
  db: Executor,
  campaignId: string,
  sku: string,
): Promise<CampaignRewardPackage | null> {
  const [row] = await db
    .select()
    .from(campaignRewardPackages)
    .where(and(eq(campaignRewardPackages.campaignId, campaignId), eq(campaignRewardPackages.sku, sku)))
    .limit(1);
  return row ?? null;
}

/** All reward packages for a campaign, in display order. */
export async function listRewardPackages(
  db: Executor,
  campaignId: string,
): Promise<CampaignRewardPackage[]> {
  return db
    .select()
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, campaignId))
    .orderBy(asc(campaignRewardPackages.sortOrder));
}
