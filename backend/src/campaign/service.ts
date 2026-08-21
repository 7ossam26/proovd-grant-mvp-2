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
  campaignDemoMoments,
  campaignBenefitCards,
  VISUAL_VARIANTS,
  type CampaignBuild,
  type CampaignRewardPackage,
  type CampaignFaq,
  type CampaignDemoMoment,
  type CampaignBenefitCard,
} from '../db/schema/build.js';
import {
  deriveBuildStatus,
  missingBuildFields,
  INTERNAL_TARGET_CAP_CENTS,
  type BuildSnapshot,
  type BuildStatus,
} from './logic.js';
import type { AuditWriter } from '../auth/audit.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

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
  /* The rebuilt campaign page's own copy (0049). All optional; none is in a
     `REQUIRED_*` register, so none of them can hold a build below `complete`. */
  heroHeadline?: string | null;
  heroHeadlineAccent?: string | null;
  heroSubheadline?: string | null;
  founderPullQuote?: string | null;
  platformLine?: string | null;
  demoContextLabel?: string | null;
  benefitsHeading?: string | null;
  rewardsHeading?: string | null;
  updatesHeading?: string | null;
  faqHeading?: string | null;
}

export type BuildRefusal = 'not_editable' | 'invalid_value';

export interface BuildView {
  build: CampaignBuild | null;
  rewardPackages: CampaignRewardPackage[];
  faqs: CampaignFaq[];
  /** Campaign page v2 (0049). Optional content; an empty list renders no section. */
  demoMoments: CampaignDemoMoment[];
  benefitCards: CampaignBenefitCard[];
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

  const demoMoments = await db
    .select()
    .from(campaignDemoMoments)
    .where(eq(campaignDemoMoments.campaignId, campaign.campaignId))
    .orderBy(asc(campaignDemoMoments.sortOrder));

  const benefitCards = await db
    .select()
    .from(campaignBenefitCards)
    .where(eq(campaignBenefitCards.campaignId, campaign.campaignId))
    .orderBy(asc(campaignBenefitCards.sortOrder));

  const snapshot = buildSnapshot(campaign.campaignType, build ?? null, rewardPackages.length);
  return {
    build: build ?? null,
    rewardPackages,
    faqs,
    demoMoments,
    benefitCards,
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
  //
  // These `assign` calls ARE the whole allowlist. There is no Zod schema in
  // `shared/` for a build patch and no route-layer whitelist, so a column added
  // to Drizzle and to the migration and not to this list is a column no Founder
  // can ever write. That is why the list is the second half of every new field.
  //
  // `assign` used to take the column name as a third argument. It was the same
  // string as the key in all twenty calls — Drizzle's `set` takes the property
  // name, not the snake_case column — and the key was never read, so the pair
  // was two chances to disagree with nothing deciding between them. One
  // parameter now, and the key is what is written.
  const set: Record<string, unknown> = {};
  const assign = (key: keyof BuildPatch, value: unknown) => {
    if (value !== undefined) set[key] = value;
  };
  const text = (v: string | null | undefined) => (v == null ? v : v.slice(0, 20000));

  assign('title', text(input.patch.title));
  assign('founderDisplayName', text(input.patch.founderDisplayName));
  assign('founderEntityDisplay', text(input.patch.founderEntityDisplay));
  assign('founderCountry', text(input.patch.founderCountry));
  assign('founderProfileUrl', text(input.patch.founderProfileUrl));
  assign('brandPerception', text(input.patch.brandPerception));
  assign('brandVoice', text(input.patch.brandVoice));
  assign('requiredWording', text(input.patch.requiredWording));
  assign('prohibitedClaims', text(input.patch.prohibitedClaims));
  assign('communityUrl', text(input.patch.communityUrl));
  assign('heroPreference', text(input.patch.heroPreference));
  assign('publicStory', text(input.patch.publicStory));
  assign('deliveryWindow', text(input.patch.deliveryWindow));
  assign('earlyProductDisclaimer', text(input.patch.earlyProductDisclaimer));
  assign('risksAndChallenges', text(input.patch.risksAndChallenges));
  assign('refundPolicyText', text(input.patch.refundPolicyText));
  assign('refundPolicyTitle', text(input.patch.refundPolicyTitle));
  assign('refundPolicySourceUrl', text(input.patch.refundPolicySourceUrl));
  assign('refundPolicyVersion', text(input.patch.refundPolicyVersion));
  assign('refundPolicyEffectiveDate', input.patch.refundPolicyEffectiveDate);
  /* The rebuilt campaign page's copy (0049). */
  assign('heroHeadline', text(input.patch.heroHeadline));
  assign('heroHeadlineAccent', text(input.patch.heroHeadlineAccent));
  assign('heroSubheadline', text(input.patch.heroSubheadline));
  assign('founderPullQuote', text(input.patch.founderPullQuote));
  assign('platformLine', text(input.patch.platformLine));
  assign('demoContextLabel', text(input.patch.demoContextLabel));
  assign('benefitsHeading', text(input.patch.benefitsHeading));
  assign('rewardsHeading', text(input.patch.rewardsHeading));
  assign('updatesHeading', text(input.patch.updatesHeading));
  assign('faqHeading', text(input.patch.faqHeading));

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
  /** Campaign page v2 (0049): `Lowest price`, `Best value`, `For five`. */
  badge?: string | null;
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
    // A blank badge is no badge. Stored as `''` it would render an empty chip,
    // which reads as a badge whose word failed to load rather than as absence.
    badge: input.reward.badge?.trim() ? input.reward.badge.trim().slice(0, 60) : null,
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

export async function deleteRewardPackage(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; campaignStatus: string; packageId: string; actor: string },
): Promise<{ ok: true } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('Reward packages');
  }
  const [removed] = await db
    .delete(campaignRewardPackages)
    .where(
      and(
        eq(campaignRewardPackages.id, input.packageId),
        eq(campaignRewardPackages.campaignId, input.campaignId),
      ),
    )
    .returning();
  if (!removed) return invalidValue('That reward package was not found.');
  await deps.audit({
    action: 'build.reward_package_removed',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `campaign reward removed: ${removed.title.slice(0, 120)}`,
    priorValue: {
      sku: removed.sku,
      title: removed.title,
      priceCents: removed.priceCents.toString(),
      delivery: removed.delivery,
    },
    actorId: input.actor,
  });
  await recomputeBuildStatus(db, input.campaignId);
  return { ok: true };
}

/* ── FAQs (§14.4) ──────────────────────────────────────────────────────────── */

/**
 * The FAQ authoring path.
 *
 * `campaign_faqs` has existed since Phase 12b and until now had no production
 * writer at all — it was only ever SELECTed, or live-edited through §20's one
 * door, and the sole INSERT in the repository was in a test. The §14.4 read was
 * shipped and the write never was, which is invisible until a Founder looks for
 * the box. The rebuilt page makes the FAQ a full section, so shipping the
 * section without the authoring route would be shipping a heading a Founder
 * cannot fill.
 */
export type ContentRefusal = { ok: false; code: BuildRefusal; message: string; next: string };

function notEditable(what: string): ContentRefusal {
  return {
    ok: false,
    code: 'not_editable',
    message: `${what} cannot be edited once the campaign is in review or approved.`,
    next: 'A change now goes through review. Nothing you entered was lost.',
  };
}

function invalidValue(message: string): ContentRefusal {
  return { ok: false, code: 'invalid_value', message, next: 'Nothing you entered was lost.' };
}

export interface FaqInput {
  question: string;
  answer: string;
  sortOrder?: number;
}

export async function upsertFaq(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignStatus: string;
    faqId?: string;
    faq: FaqInput;
    actor: string;
  },
): Promise<{ ok: true; faq: CampaignFaq } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('FAQs');
  }
  const question = input.faq.question.trim();
  const answer = input.faq.answer.trim();
  if (!question || !answer) {
    return invalidValue('An FAQ needs both a question and an answer.');
  }

  const values = {
    campaignId: input.campaignId,
    question: question.slice(0, 500),
    answer: answer.slice(0, 20000),
    sortOrder: input.faq.sortOrder ?? 0,
  };

  let row: CampaignFaq;
  if (input.faqId) {
    const [updated] = await db
      .update(campaignFaqs)
      .set(values)
      .where(and(eq(campaignFaqs.id, input.faqId), eq(campaignFaqs.campaignId, input.campaignId)))
      .returning();
    if (!updated) return invalidValue('That FAQ was not found.');
    row = updated;
  } else {
    const [inserted] = await db.insert(campaignFaqs).values(values).returning();
    row = inserted!;
  }

  await deps.audit({
    action: 'build.faq_saved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `campaign FAQ saved: ${row.question.slice(0, 120)}`,
    actorId: input.actor,
  });
  return { ok: true, faq: row };
}

export async function deleteFaq(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; campaignStatus: string; faqId: string; actor: string },
): Promise<{ ok: true } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('FAQs');
  }
  const [removed] = await db
    .delete(campaignFaqs)
    .where(and(eq(campaignFaqs.id, input.faqId), eq(campaignFaqs.campaignId, input.campaignId)))
    .returning();
  if (!removed) return invalidValue('That FAQ was not found.');
  await deps.audit({
    action: 'build.faq_removed',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `campaign FAQ removed: ${removed.question.slice(0, 120)}`,
    priorValue: { question: removed.question, answer: removed.answer },
    actorId: input.actor,
  });
  return { ok: true };
}

/* ── The demo stage (campaign page v2) ─────────────────────────────────────── */

/**
 * §18 hands presentation to the DNA document, so the demo stage is licensed as
 * presentation of the Founder's own product — the class §14.4 already contains
 * as "Hero preference" and "Product visuals and brand assets". It carries no
 * commercial rule: no price, no date, no threshold, no eligibility. It is
 * optional, and a campaign with no moments renders no demo section at all.
 *
 * The reference draws three. The cap is here rather than in the database
 * because it is a layout fact rather than a rule about the world — a fourth
 * moment would not be wrong, it would not fit — and a CHECK would make it look
 * like the second.
 */
export const MAX_DEMO_MOMENTS = 3;
export const MAX_BENEFIT_CARDS = 3;

/**
 * The next free position in an ordered list.
 *
 * Both new tables index `(campaign_id, sort_order)` UNIQUEly, which is what
 * makes the order a fact rather than a hint — and which also means a bare
 * default of 0 turns the second row into a 23505. Appending is what an Add
 * control means.
 */
function nextSortOrder(existing: readonly { sortOrder: number }[]): number {
  return existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

export interface DemoMomentInput {
  timeLabel: string;
  momentLabel: string;
  stateWord: string;
  headline: string;
  signalText?: string | null;
  isAction?: boolean;
  actionLabel?: string | null;
  sortOrder?: number;
}

export async function upsertDemoMoment(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignStatus: string;
    momentId?: string;
    moment: DemoMomentInput;
    actor: string;
  },
): Promise<{ ok: true; moment: CampaignDemoMoment } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('The demo');
  }

  const isAction = input.moment.isAction === true;
  const actionLabel = input.moment.actionLabel?.trim() ?? '';
  const signalText = input.moment.signalText?.trim() ?? '';
  // The 0049 CHECK refuses the wrong shape regardless; refusing here first is
  // what puts a sentence in front of the Founder instead of a constraint name.
  if (isAction && !actionLabel) {
    return invalidValue('A moment that asks for an action needs the words on the button.');
  }
  if (!isAction && !signalText) {
    return invalidValue('A moment that does not ask for anything needs the signal it shows.');
  }
  const required = [
    input.moment.timeLabel,
    input.moment.momentLabel,
    input.moment.stateWord,
    input.moment.headline,
  ].map((v) => v.trim());
  if (required.some((v) => !v)) {
    return invalidValue('A demo moment needs a time, a name, a state word, and a headline.');
  }

  // `(campaign_id, sort_order)` is UNIQUE, so a default of 0 would make the
  // SECOND row a 23505 the Founder reads as "the form stopped working". An
  // unspecified position means "after the ones that exist", which is what a
  // repeater's Add control actually means.
  let sortOrder = input.moment.sortOrder;
  if (!input.momentId) {
    const existing = await db
      .select({ sortOrder: campaignDemoMoments.sortOrder })
      .from(campaignDemoMoments)
      .where(eq(campaignDemoMoments.campaignId, input.campaignId));
    if (existing.length >= MAX_DEMO_MOMENTS) {
      return invalidValue(`The demo shows ${MAX_DEMO_MOMENTS} moments. Edit or remove one first.`);
    }
    sortOrder ??= nextSortOrder(existing);
  }

  const values = {
    campaignId: input.campaignId,
    timeLabel: required[0]!.slice(0, 40),
    momentLabel: required[1]!.slice(0, 60),
    stateWord: required[2]!.slice(0, 60),
    headline: required[3]!.slice(0, 200),
    signalText: isAction ? null : signalText.slice(0, 200),
    isAction,
    actionLabel: isAction ? actionLabel.slice(0, 60) : null,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    updatedAt: new Date(),
  };

  let row: CampaignDemoMoment;
  if (input.momentId) {
    const [updated] = await db
      .update(campaignDemoMoments)
      .set(values)
      .where(
        and(
          eq(campaignDemoMoments.id, input.momentId),
          eq(campaignDemoMoments.campaignId, input.campaignId),
        ),
      )
      .returning();
    if (!updated) return invalidValue('That demo moment was not found.');
    row = updated;
  } else {
    const [inserted] = await db.insert(campaignDemoMoments).values(values).returning();
    row = inserted!;
  }

  await deps.audit({
    action: 'build.demo_moment_saved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `demo moment saved: ${row.momentLabel}`,
    actorId: input.actor,
  });
  return { ok: true, moment: row };
}

export async function deleteDemoMoment(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; campaignStatus: string; momentId: string; actor: string },
): Promise<{ ok: true } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('The demo');
  }
  const [removed] = await db
    .delete(campaignDemoMoments)
    .where(
      and(
        eq(campaignDemoMoments.id, input.momentId),
        eq(campaignDemoMoments.campaignId, input.campaignId),
      ),
    )
    .returning();
  if (!removed) return invalidValue('That demo moment was not found.');
  await deps.audit({
    action: 'build.demo_moment_removed',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `demo moment removed: ${removed.momentLabel}`,
    actorId: input.actor,
  });
  return { ok: true };
}

/* ── Benefit cards (campaign page v2) ──────────────────────────────────────── */

export interface BenefitCardInput {
  title: string;
  footerWord: string;
  visualVariant: string;
  sortOrder?: number;
}

export async function upsertBenefitCard(
  db: Database,
  deps: { audit: AuditWriter },
  input: {
    campaignId: string;
    campaignStatus: string;
    cardId?: string;
    card: BenefitCardInput;
    actor: string;
  },
): Promise<{ ok: true; card: CampaignBenefitCard } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('Benefit cards');
  }
  const title = input.card.title.trim();
  const footerWord = input.card.footerWord.trim();
  if (!title || !footerWord) {
    return invalidValue('A benefit card needs a title and a footer word.');
  }
  // Three shapes exist and a fourth would render nothing. The list is closed in
  // the database too; refusing here names the three instead of the constraint.
  if (!(VISUAL_VARIANTS as readonly string[]).includes(input.card.visualVariant)) {
    return invalidValue(`A benefit card draws one of: ${VISUAL_VARIANTS.join(', ')}.`);
  }

  let sortOrder = input.card.sortOrder;
  if (!input.cardId) {
    const existing = await db
      .select({ sortOrder: campaignBenefitCards.sortOrder })
      .from(campaignBenefitCards)
      .where(eq(campaignBenefitCards.campaignId, input.campaignId));
    if (existing.length >= MAX_BENEFIT_CARDS) {
      return invalidValue(`The page shows ${MAX_BENEFIT_CARDS} benefit cards. Edit or remove one first.`);
    }
    sortOrder ??= nextSortOrder(existing);
  }

  const values = {
    campaignId: input.campaignId,
    title: title.slice(0, 120),
    footerWord: footerWord.slice(0, 60),
    visualVariant: input.card.visualVariant,
    ...(sortOrder === undefined ? {} : { sortOrder }),
    updatedAt: new Date(),
  };

  let row: CampaignBenefitCard;
  if (input.cardId) {
    const [updated] = await db
      .update(campaignBenefitCards)
      .set(values)
      .where(
        and(
          eq(campaignBenefitCards.id, input.cardId),
          eq(campaignBenefitCards.campaignId, input.campaignId),
        ),
      )
      .returning();
    if (!updated) return invalidValue('That benefit card was not found.');
    row = updated;
  } else {
    const [inserted] = await db.insert(campaignBenefitCards).values(values).returning();
    row = inserted!;
  }

  await deps.audit({
    action: 'build.benefit_card_saved',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `benefit card saved: ${row.title}`,
    actorId: input.actor,
  });
  return { ok: true, card: row };
}

export async function deleteBenefitCard(
  db: Database,
  deps: { audit: AuditWriter },
  input: { campaignId: string; campaignStatus: string; cardId: string; actor: string },
): Promise<{ ok: true } | ContentRefusal> {
  if (!(BUILD_EDITABLE_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return notEditable('Benefit cards');
  }
  const [removed] = await db
    .delete(campaignBenefitCards)
    .where(
      and(
        eq(campaignBenefitCards.id, input.cardId),
        eq(campaignBenefitCards.campaignId, input.campaignId),
      ),
    )
    .returning();
  if (!removed) return invalidValue('That benefit card was not found.');
  await deps.audit({
    action: 'build.benefit_card_removed',
    targetType: 'campaign',
    targetId: input.campaignId,
    internalReason: `benefit card removed: ${removed.title}`,
    actorId: input.actor,
  });
  return { ok: true };
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
