/**
 * The Founder preview — Spec §15, §18, §33.4 ("Preview collects no real payment
 * information").
 *
 * §15: "The Founder can view the complete public campaign exactly as a Backer
 * will, including … Checkout drawer preview with correct campaign-specific
 * consent, subtotal/tax/total examples." So the projection is `CampaignView`
 * shaped — the exact model the public campaign page and its A.3/A.4 consent
 * render from — assembled from the Founder's build. The frontend renders it
 * through the same `consentPreview`, which mounts NO payment field: §18/§34's
 * rule for samples, applied to the preview.
 *
 * ── The tax is an example, and says so ──────────────────────────────────────
 * A preview has no Backer and no billing address, so there is no real Stripe
 * Tax calculation. The subtotal/tax/total are computed at a representative
 * example rate and labelled as an example wherever they render — never a real
 * charge and never presented as one (§1.4).
 */

import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignRewardPackages, campaignFaqs } from '../db/schema/build.js';
import { computeCampaignDescriptor } from '../payments/descriptors.js';

type Executor = Pick<Database, 'select'>;

/** A representative example sales-tax rate for the preview only (basis points). */
const EXAMPLE_TAX_BPS = 800n;

/** The `CampaignView`-shaped preview payload. Dates are ISO strings. */
export interface CampaignPreview {
  model: 'idea' | 'product';
  title: string;
  tagline: string;
  founder: { legalName: string; entity: string; country: string; profile: string };
  opensAt: string | null;
  closesAt: string | null;
  rewards: Array<{
    sku: string;
    title: string;
    priceCents: string;
    contents: string[];
    delivery: string;
    fulfillment: string;
    limitedQuantity: number | null;
  }>;
  featuredRewardSku: string | null;
  /** Example checkout amounts, in cents, for the drawer preview. */
  example: {
    rewardSubtotalCents: string;
    salesTaxCents: string;
    totalCents: string;
  } | null;
  orderThreshold: number | null;
  internalTargetCents: string | null;
  statementDescriptor: string;
  story: string | null;
  faq: Array<{ question: string; answer: string }>;
  founderRefundPolicy: {
    title: string | null;
    version: string | null;
    effectiveDate: string | null;
    sourceUrl: string | null;
    text: string | null;
  } | null;
  earlyProductDisclaimer: string | null;
  risksAndChallenges: string | null;
  /** Always true here: the surface renders read-only and mounts no payment field. */
  isPreview: true;
}

export async function buildCampaignPreview(
  db: Executor,
  campaign: { campaignId: string; campaignType: 'pre_build' | 'pre_launch' },
): Promise<CampaignPreview | null> {
  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaign.campaignId))
    .limit(1);

  const [claim] = await db
    .select({
      legalName: founderClaimProfiles.legalName,
      businessName: founderClaimProfiles.businessName,
      soleProprietor: founderClaimProfiles.soleProprietor,
    })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, campaign.campaignId))
    .limit(1);

  const [descriptorRow] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaign.campaignId))
    .limit(1);
  if (!descriptorRow) return null;

  const rewardRows = await db
    .select()
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, campaign.campaignId))
    .orderBy(asc(campaignRewardPackages.sortOrder));

  const faqRows = await db
    .select()
    .from(campaignFaqs)
    .where(eq(campaignFaqs.campaignId, campaign.campaignId))
    .orderBy(asc(campaignFaqs.sortOrder));

  const featured = rewardRows[0] ?? null;
  const example = featured
    ? (() => {
        const subtotal = featured.priceCents;
        const tax = (subtotal * EXAMPLE_TAX_BPS) / 10_000n;
        return {
          rewardSubtotalCents: subtotal.toString(),
          salesTaxCents: tax.toString(),
          totalCents: (subtotal + tax).toString(),
        };
      })()
    : null;

  const entity =
    claim?.soleProprietor === true
      ? 'sole proprietor'
      : (build?.founderEntityDisplay ?? claim?.businessName ?? 'sole proprietor');

  return {
    model: campaign.campaignType === 'pre_build' ? 'idea' : 'product',
    title: build?.title ?? 'Untitled campaign',
    tagline: build?.brandPerception ?? '',
    founder: {
      legalName: build?.founderDisplayName ?? claim?.legalName ?? 'The Founder',
      entity,
      country: build?.founderCountry ?? '',
      profile: build?.founderProfileUrl ?? '',
    },
    opensAt: build?.opensAt?.toISOString() ?? null,
    closesAt: build?.closesAt?.toISOString() ?? null,
    rewards: rewardRows.map((r) => ({
      sku: r.sku,
      title: r.title,
      priceCents: r.priceCents.toString(),
      contents: r.contents.split('\n').filter((line) => line.trim().length > 0),
      delivery: r.delivery,
      fulfillment: r.fulfillmentCommitment,
      limitedQuantity: r.limitedQuantity,
    })),
    featuredRewardSku: featured?.sku ?? null,
    example,
    orderThreshold: build?.orderThreshold ?? null,
    internalTargetCents: build?.internalTargetCents?.toString() ?? null,
    // §24.12: the same kernel the checkout stores on the reservation
    // (§33.9.13) — the preview shows what a Backer's statement will show.
    statementDescriptor: computeCampaignDescriptor({
      legalName: build?.founderDisplayName ?? claim?.legalName ?? 'The Founder',
      entity,
    }).display,
    story: build?.publicStory ?? null,
    faq: faqRows.map((f) => ({ question: f.question, answer: f.answer })),
    founderRefundPolicy:
      campaign.campaignType === 'pre_launch'
        ? {
            title: build?.refundPolicyTitle ?? null,
            version: build?.refundPolicyVersion ?? null,
            effectiveDate: build?.refundPolicyEffectiveDate ?? null,
            sourceUrl: build?.refundPolicySourceUrl ?? null,
            text: build?.refundPolicyText ?? null,
          }
        : null,
    earlyProductDisclaimer: build?.earlyProductDisclaimer ?? null,
    risksAndChallenges: build?.risksAndChallenges ?? null,
    isPreview: true,
  };
}
