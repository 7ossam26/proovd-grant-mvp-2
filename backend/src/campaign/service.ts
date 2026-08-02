/**
 * The Founder's parallel campaign build — Spec §14.4, §23.2, §33.3.10.
 *
 * ── One decision at a time, campaign type read-only ─────────────────────────
 * §14.4: "the Founder completes one decision at a time. Campaign type is
 * read-only." So a save writes only the keys it was given (the §9 autosave
 * rule — `undefined` means "not in this request"), and there is no `type`
 * column here and no route that could change it.
 *
 * ── `complete` is derived, never set ────────────────────────────────────────
 * `campaign_build_status` on `campaigns` is a server decision recomputed from
 * the stored content on every save (`deriveBuildStatus`), exactly as the §12
 * optional-item decisions are. A Founder cannot mark their own build complete —
 * that would let `review_ready` (§23.2) drift from its inputs (§33.3.10).
 *
 * ── After submission the build is not directly editable ─────────────────────
 * §15: "A Founder cannot publish a material change directly." Once the campaign
 * is in review or approved, a build edit could be a material change to terms
 * Creators accepted — so the save refuses outside the build window and routes
 * the Founder to the review/materiality path. The absence of a write path is
 * the enforcement, the same posture as the missing bank-field routes (10b).
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns } from '../db/schema/domain.js';
import {
  campaignBuild,
  campaignRewardPackages,
  campaignFaqs,
  type CampaignBuild,
  type CampaignRewardPackage,
  type CampaignFaq,
} from '../db/schema/build.js';
import {
  deriveBuildStatus,
  missingBuildFields,
  INTERNAL_TARGET_CAP_CENTS,
  type BuildSnapshot,
  type BuildStatus,
} from './logic.js';
import type { AuditWriter } from '../auth/audit.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/** The lifecycle states in which the Founder may still edit the build freely. */
const BUILD_EDITABLE_STATUSES = ['affiliate_response_and_build', 'changes_required'] as const;

/* ── The build fields a save may carry ─────────────────────────────────────── */

export interface BuildPatch {
  title?: string | null;
  founderDisplayName?: string | null;
  founderEntityDisplay?: string | null;
  founderCountry?: string | null;
  founderProfileUrl?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  orderThreshold?: number | null;
  internalTargetCents?: string | null;
  brandPerception?: string | null;
  brandVoice?: string | null;
  requiredWording?: string | null;
  prohibitedClaims?: string | null;
  communityUrl?: string | null;
  heroPreference?: string | null;
  publicStory?: string | null;
  deliveryWindow?: string | null;
  earlyProductDisclaimer?: string | null;
  risksAndChallenges?: string | null;
  refundPolicyText?: string | null;
  refundPolicyTitle?: string | null;
  refundPolicySourceUrl?: string | null;
  refundPolicyVersion?: string | null;
  refundPolicyEffectiveDate?: string | null;
}

export type BuildRefusal = 'not_editable' | 'invalid_value';

export interface BuildView {
  build: CampaignBuild | null;
  rewardPackages: CampaignRewardPackage[];
  faqs: CampaignFaq[];
  buildStatus: BuildStatus;
  missing: string[];
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function readBuild(
  db: Executor,
  campaign: { campaignId: string; campaignType: 'pre_build' | 'pre_launch' },
): Promise<BuildView> {
  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaign.campaignId))
    .limit(1);

  const rewardPackages = await db
    .select()
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, campaign.campaignId))
    .orderBy(asc(campaignRewardPackages.sortOrder));

  const faqs = await db
    .select()
    .from(campaignFaqs)
    .where(eq(campaignFaqs.campaignId, campaign.campaignId))
    .orderBy(asc(campaignFaqs.sortOrder));

  const snapshot = buildSnapshot(campaign.campaignType, build ?? null, rewardPackages.length);
  return {
    build: build ?? null,
    rewardPackages,
    faqs,
    buildStatus: deriveBuildStatus(snapshot),
    missing: missingBuildFields(snapshot),
  };
}

/** Assembles the §14.4 completeness snapshot from the stored row. */
function buildSnapshot(
  campaignType: 'pre_build' | 'pre_launch',
  build: CampaignBuild | null,
  rewardPackageCount: number,
): BuildSnapshot {
  const refundPolicyPresent = Boolean(
    build?.refundPolicyText?.trim() ||
      (build?.refundPolicyTitle?.trim() &&
        build?.refundPolicySourceUrl?.trim() &&
        build?.refundPolicyVersion?.trim() &&
        build?.refundPolicyEffectiveDate),
  );
  return {
    campaignType,
    rewardPackageCount,
    refundPolicyPresent,
    fields: {
      title: build?.title ?? null,
      founderDisplayName: build?.founderDisplayName ?? null,
      founderCountry: build?.founderCountry ?? null,
      founderProfileUrl: build?.founderProfileUrl ?? null,
      opensAt: build?.opensAt ?? null,
      closesAt: build?.closesAt ?? null,
      brandPerception: build?.brandPerception ?? null,
      brandVoice: build?.brandVoice ?? null,
      heroPreference: build?.heroPreference ?? null,
      publicStory: build?.publicStory ?? null,
      orderThreshold: build?.orderThreshold ?? null,
      deliveryWindow: build?.deliveryWindow ?? null,
      earlyProductDisclaimer: build?.earlyProductDisclaimer ?? null,
      risksAndChallenges: build?.risksAndChallenges ?? null,
      internalTargetCents: build?.internalTargetCents ?? null,
    },
  };
}

/* ── Save ──────────────────────────────────────────────────────────────────── */

export interface SaveBuildResult {
  ok: true;
  view: BuildView;
  buildStatus: BuildStatus;
}

export type SaveBuildOutcome =
  | SaveBuildResult
  | { ok: false; code: BuildRefusal; message: string; next: string };

/**
 * Applies a partial build patch and re-derives `campaign_build_status`. Only
 * the keys present in the patch are written; `undefined` leaves the stored
 * value untouched (§9's "a failed save never clears valid fields", applied to
 * the build).
 */
export async function saveBuild(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignType: 'pre_build' | 'pre_launch';
    campaignStatus: string;
    patch: BuildPatch;
    actor: string;
  },
): Promise<SaveBuildOutcome> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return {
      ok: false,
      code: 'not_editable',
      message:
        'This campaign is in review or approved, so it cannot be edited directly. A change now goes through review.',
      next: 'Ask your Proovd reviewer to open the change. Material changes need Creator reacceptance before they go live.',
    };
  }

  // Translate the wire patch to storable columns, keeping only present keys.
  const set: Record<string, unknown> = {};
  const assign = <T>(key: keyof BuildPatch, value: T | undefined, column: string) => {
    if (value !== undefined) set[column] = value;
  };
  const text = (v: string | null | undefined) => (v == null ? v : v.slice(0, 20000));

  assign('title', text(input.patch.title), 'title');
  assign('founderDisplayName', text(input.patch.founderDisplayName), 'founderDisplayName');
  assign('founderEntityDisplay', text(input.patch.founderEntityDisplay), 'founderEntityDisplay');
  assign('founderCountry', text(input.patch.founderCountry), 'founderCountry');
  assign('founderProfileUrl', text(input.patch.founderProfileUrl), 'founderProfileUrl');
  assign('brandPerception', text(input.patch.brandPerception), 'brandPerception');
  assign('brandVoice', text(input.patch.brandVoice), 'brandVoice');
  assign('requiredWording', text(input.patch.requiredWording), 'requiredWording');
  assign('prohibitedClaims', text(input.patch.prohibitedClaims), 'prohibitedClaims');
  assign('communityUrl', text(input.patch.communityUrl), 'communityUrl');
  assign('heroPreference', text(input.patch.heroPreference), 'heroPreference');
  assign('publicStory', text(input.patch.publicStory), 'publicStory');
  assign('deliveryWindow', text(input.patch.deliveryWindow), 'deliveryWindow');
  assign('earlyProductDisclaimer', text(input.patch.earlyProductDisclaimer), 'earlyProductDisclaimer');
  assign('risksAndChallenges', text(input.patch.risksAndChallenges), 'risksAndChallenges');
  assign('refundPolicyText', text(input.patch.refundPolicyText), 'refundPolicyText');
  assign('refundPolicyTitle', text(input.patch.refundPolicyTitle), 'refundPolicyTitle');
  assign('refundPolicySourceUrl', text(input.patch.refundPolicySourceUrl), 'refundPolicySourceUrl');
  assign('refundPolicyVersion', text(input.patch.refundPolicyVersion), 'refundPolicyVersion');
  assign('refundPolicyEffectiveDate', input.patch.refundPolicyEffectiveDate, 'refundPolicyEffectiveDate');
  assign('heroPreference', text(input.patch.heroPreference), 'heroPreference');

  if (input.patch.opensAt !== undefined) {
    set['opensAt'] = input.patch.opensAt ? new Date(input.patch.opensAt) : null;
  }
  if (input.patch.closesAt !== undefined) {
    set['closesAt'] = input.patch.closesAt ? new Date(input.patch.closesAt) : null;
  }
  if (input.patch.orderThreshold !== undefined) {
    if (
      input.patch.orderThreshold !== null &&
      (!Number.isInteger(input.patch.orderThreshold) || input.patch.orderThreshold <= 0)
    ) {
      return invalid('The order threshold must be a positive whole number.');
    }
    set['orderThreshold'] = input.patch.orderThreshold;
  }
  if (input.patch.internalTargetCents !== undefined) {
    if (input.patch.internalTargetCents === null) {
      set['internalTargetCents'] = null;
    } else if (!/^\d+$/.test(input.patch.internalTargetCents)) {
      return invalid('The internal target must be a whole number of cents.');
    } else {
      const cents = BigInt(input.patch.internalTargetCents);
      if (cents <= 0n || cents > INTERNAL_TARGET_CAP_CENTS) {
        return invalid('The internal momentum target must be between US$0.01 and US$50,000.');
      }
      set['internalTargetCents'] = cents;
    }
  }

  const result = await db.transaction(async (tx) => {
    if (Object.keys(set).length > 0) {
      set['updatedAt'] = new Date();
      set['updatedBy'] = input.actor;
      await tx
        .insert(campaignBuild)
        .values({ campaignId: input.campaignId, updatedBy: input.actor, ...set })
        .onConflictDoUpdate({ target: campaignBuild.campaignId, set });
    } else {
      // A save with no writable keys still ensures the row exists so the status
      // can be derived, but changes nothing (a no-op save is a legal outcome).
      await tx
        .insert(campaignBuild)
        .values({ campaignId: input.campaignId, updatedBy: input.actor })
        .onConflictDoNothing();
    }

    const view = await readBuild(tx, {
      campaignId: input.campaignId,
      campaignType: input.campaignType,
    });

    // §23.2: the derived build status, mirrored onto the campaign so
    // `review_ready` reads one column. Never set from a Founder flag.
    await tx
      .update(campaigns)
      .set({ campaignBuildStatus: view.buildStatus, updatedAt: new Date() })
      .where(eq(campaigns.id, input.campaignId));

    return view;
  });

  await deps.audit({
    action: 'build.saved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `campaign build saved; status now ${result.buildStatus}`,
    actorId: input.actor,
  });

  return { ok: true, view: result, buildStatus: result.buildStatus };

  function invalid(message: string): SaveBuildOutcome {
    return { ok: false, code: 'invalid_value', message, next: 'Nothing you entered was lost.' };
  }
}

/* ── Reward packages (§14.4) ───────────────────────────────────────────────── */

export interface RewardPackageInput {
  sku: string;
  title: string;
  priceCents: string;
  contents: string;
  fulfillmentCommitment: string;
  delivery: string;
  limitedQuantity?: number | null;
  sortOrder?: number;
}

export async function upsertRewardPackage(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignStatus: string;
    packageId?: string;
    reward: RewardPackageInput;
    actor: string;
  },
): Promise<{ ok: true; package: CampaignRewardPackage } | { ok: false; code: BuildRefusal; message: string; next: string }> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return {
      ok: false,
      code: 'not_editable',
      message: 'Reward packages cannot be edited once the campaign is in review or approved.',
      next: 'A reward change now goes through review, and a price or delivery change is material to Creator terms.',
    };
  }
  if (!/^\d+$/.test(input.reward.priceCents) || BigInt(input.reward.priceCents) <= 0n) {
    return {
      ok: false,
      code: 'invalid_value',
      message: 'A reward price must be a positive whole number of cents.',
      next: 'Nothing you entered was lost.',
    };
  }

  const values = {
    campaignId: input.campaignId,
    sku: input.reward.sku.slice(0, 200),
    title: input.reward.title.slice(0, 500),
    priceCents: BigInt(input.reward.priceCents),
    contents: input.reward.contents.slice(0, 20000),
    fulfillmentCommitment: input.reward.fulfillmentCommitment.slice(0, 20000),
    delivery: input.reward.delivery.slice(0, 500),
    limitedQuantity: input.reward.limitedQuantity ?? null,
    sortOrder: input.reward.sortOrder ?? 0,
    updatedAt: new Date(),
  };

  let row: CampaignRewardPackage;
  if (input.packageId) {
    const [updated] = await db
      .update(campaignRewardPackages)
      .set(values)
      .where(
        and(
          eq(campaignRewardPackages.id, input.packageId),
          eq(campaignRewardPackages.campaignId, input.campaignId),
        ),
      )
      .returning();
    if (!updated) {
      return { ok: false, code: 'invalid_value', message: 'That reward package was not found.', next: 'Reload the page.' };
    }
    row = updated;
  } else {
    const [inserted] = await db.insert(campaignRewardPackages).values(values).returning();
    row = inserted!;
  }

  await deps.audit({
    action: 'build.reward_package_saved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `reward package ${row.sku} saved`,
    actorId: input.actor,
  });

  // A reward package changes build completeness; re-derive.
  await recomputeBuildStatus(db, input.campaignId);
  return { ok: true, package: row };
}

/** Re-derives and mirrors the build status after a reward/faq change. */
export async function recomputeBuildStatus(db: Database, campaignId: string): Promise<void> {
  const [campaign] = await db
    .select({ type: campaigns.type })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign?.type) return;
  const view = await readBuild(db, { campaignId, campaignType: campaign.type });
  await db
    .update(campaigns)
    .set({ campaignBuildStatus: view.buildStatus, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));
}
