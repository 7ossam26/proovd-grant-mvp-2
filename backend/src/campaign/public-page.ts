/**
 * The public campaign page — Spec §18, §33.6 (Phase 14b).
 *
 * Phase 05 renders two static samples through the frontend `CampaignPage`; this
 * assembles the same view model for an approved, live campaign so the same
 * component renders it. The content comes from `buildCampaignPreview` — the one
 * assembly of a campaign's public content, already used by the §15 Founder
 * preview — so there is a single source for "what a Backer sees", not two that
 * can drift.
 *
 * ── It renders from the build, which is frozen once approved ─────────────────
 * §15 refuses a build save outside `affiliate_response_and_build`/
 * `changes_required`, so a live campaign's build cannot change under a Founder's
 * hand; a material change goes through Admin review (Phase 17), which is where
 * rendering-from-an-approved-snapshot and diffing belong. For Phase 14b the live
 * build IS the approved content.
 *
 * ── The lifecycle gate and the ended state (§18) ────────────────────────────
 * A campaign is public once it has gone live. Before that — draft, vetting,
 * building, awaiting launch, or refunded with no Creator — it has no public page
 * and the endpoint answers 404. After close/suspension/kill the page stays
 * accessible in an outcome-specific ended state; the frontend composes the copy
 * from `ended.kind` and the campaign facts, because §18 forbids one generic
 * "Campaign ended" message.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { campaignCloseBatches } from '../db/schema/close.js';
import { campaignEnforcementActions } from '../db/schema/support.js';
import { buildCampaignPreview } from './preview.js';
import { countActiveForRewards } from '../reservations/preorder.js';
import { readPreorderCounts } from '../live/counts.js';

/**
 * §33.9.9's outcome-specific kinds (Phase 20b). The old four ('closed',
 * 'no_charge', 'suspended', 'killed') collapsed a threshold miss into a
 * pre-charge kill and could not say whether a suspension found charged money —
 * exactly the distinctions §33.9.9 names. The status alone cannot draw them,
 * so `resolveEndedState` consults the records that can: the close batch's
 * threshold decision (§33.7.5), the §31.6 cancellation, and the §26.7
 * enforcement action with its recorded phase.
 */
export type EndedKind =
  | 'closed'
  | 'threshold_not_met'
  | 'canceled_before_charge'
  | 'suspended_before_charge'
  | 'suspended_after_charge'
  | 'killed_before_charge'
  | 'killed_after_charge';

/** The coarse group the lifecycle status alone can answer. */
export type EndedGroup = 'closed' | 'no_charge' | 'suspended' | 'killed';

/** How each §23.1 lifecycle status renders publicly. */
interface Lifecycle {
  /** Is there a public page at all? False for every pre-live status. */
  isPublic: boolean;
  /** null while live/open; the coarse ended group once the campaign has ended. */
  ended: EndedGroup | null;
}

export function classifyLifecycle(status: string): Lifecycle {
  switch (status) {
    case 'live':
      return { isPublic: true, ended: null };
    // Natural close: the campaign closed and charges are being or have been
    // processed. All of §21's post-close capture/fulfilment lifecycle.
    case 'closed_pending_capture':
    case 'capture_retry_window':
    case 'closed_reconciling':
    case 'captured_pending_w9':
    case 'single_payment_released':
    case 'first_payment_released':
    case 'day_14_review':
    case 'remaining_payment_released':
    case 'fulfilled':
    case 'closed_resolved':
      return { isPublic: true, ended: 'closed' };
    // Pre-charge termination: threshold miss or §31.6 cancellation. Which one
    // is a record, not a status — `resolveEndedState` reads it.
    case 'ended_no_charge':
      return { isPublic: true, ended: 'no_charge' };
    case 'suspended':
      return { isPublic: true, ended: 'suspended' };
    case 'killed':
    case 'banned_founder':
      return { isPublic: true, ended: 'killed' };
    default:
      // invited_draft … creator_prep, creator_replacement, refunded_no_creator,
      // approved — never went public.
      return { isPublic: false, ended: null };
  }
}

export interface EndedState {
  kind: EndedKind;
  /**
   * The Admin-recorded §26.7 customer explanation for a suspension/kill —
   * already refused if it carried a raw provider code (§33.9.11). Null for
   * the non-enforcement outcomes, whose copy the surface composes from facts.
   */
  explanation: string | null;
}

/** Whether any of this campaign's reservations was ever actually charged. */
async function anyReservationCharged(db: Database, campaignId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, campaignId),
        inArray(sql`${reservations.status}::text`, ['captured', 'disputed', 'refunded', 'reversed']),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function latestEnforcement(
  db: Database,
  campaignId: string,
  action?: 'suspend' | 'kill',
): Promise<{ phase: string; customerExplanation: string } | null> {
  const [row] = await db
    .select({
      phase: campaignEnforcementActions.phase,
      customerExplanation: campaignEnforcementActions.customerExplanation,
    })
    .from(campaignEnforcementActions)
    .where(
      action
        ? and(
            eq(campaignEnforcementActions.campaignId, campaignId),
            eq(campaignEnforcementActions.action, action),
          )
        : eq(campaignEnforcementActions.campaignId, campaignId),
    )
    .orderBy(desc(campaignEnforcementActions.occurredAt))
    .limit(1);
  return row ?? null;
}

export async function resolveEndedState(
  db: Database,
  campaignId: string,
  group: EndedGroup,
): Promise<EndedState> {
  if (group === 'closed') return { kind: 'closed', explanation: null };

  if (group === 'no_charge') {
    // The batch's threshold decision is immutable at close (§33.7.5) — the
    // authoritative record of a miss.
    const [batch] = await db
      .select({ thresholdMet: campaignCloseBatches.thresholdMet })
      .from(campaignCloseBatches)
      .where(eq(campaignCloseBatches.campaignId, campaignId))
      .limit(1);
    if (batch && batch.thresholdMet === false) {
      return { kind: 'threshold_not_met', explanation: null };
    }
    // A suspension resolved to pre-charge termination keeps its enforcement
    // record; a §31.6 cancellation keeps its own. Either way nothing was
    // charged, and the copy says which act ended it.
    const enforcement = await latestEnforcement(db, campaignId);
    if (enforcement) {
      return { kind: 'suspended_before_charge', explanation: enforcement.customerExplanation };
    }
    return { kind: 'canceled_before_charge', explanation: null };
  }

  const action = group === 'suspended' ? 'suspend' : 'kill';
  const enforcement = await latestEnforcement(db, campaignId, action);
  // The recorded phase wins; a record-less state (unreachable through the one
  // enforcement door) falls back to whether money actually moved.
  const afterCharge = enforcement
    ? enforcement.phase === 'post_capture'
    : await anyReservationCharged(db, campaignId);
  const kind: EndedKind =
    group === 'suspended'
      ? afterCharge
        ? 'suspended_after_charge'
        : 'suspended_before_charge'
      : afterCharge
        ? 'killed_after_charge'
        : 'killed_before_charge';
  return { kind, explanation: enforcement?.customerExplanation ?? null };
}

export interface PublicReward {
  sku: string;
  title: string;
  priceCents: string;
  contents: string[];
  delivery: string;
  fulfillment: string;
  /** The reference's tier badge (0049). Null renders no chip, not an empty one. */
  badge: string | null;
  /**
   * §14.4's own field, which this payload used to drop on the floor.
   *
   * Null means unlimited — and the page renders NO remaining line for it, never
   * the word "unlimited" (§30: a scarcity signal invented where the record has
   * none). `remaining` is null in exactly the same case.
   */
  limitedQuantity: number | null;
  /** `limitedQuantity − active pre-orders`, floored at 0. Null when unlimited. */
  remaining: number | null;
}

/** One moment of the demo stage (0049). Optional; an empty list renders nothing. */
export interface PublicDemoMoment {
  id: string;
  timeLabel: string;
  momentLabel: string;
  stateWord: string;
  headline: string;
  signalText: string | null;
  isAction: boolean;
  actionLabel: string | null;
}

/** One benefit card (0049). `visualVariant` is `bars` | `check` | `dots`. */
export interface PublicBenefitCard {
  id: string;
  title: string;
  footerWord: string;
  visualVariant: string;
}

export interface PublicCampaignPayload {
  campaignId: string;
  model: 'idea' | 'product';
  title: string;
  tagline: string;
  founder: { legalName: string; entity: string; country: string; profile: string };
  opensAt: string | null;
  closesAt: string | null;
  rewards: PublicReward[];
  featuredRewardSku: string | null;
  orderThreshold: number | null;
  statementDescriptor: string;
  story: string | null;
  faq: Array<{ question: string; answer: string }>;
  refundSummary: string[];
  founderRefundPolicy: {
    title: string;
    version: string;
    effectiveDate: string;
    text: string | null;
  } | null;
  /**
   * Always false, and not a gap.
   *
   * The comment that used to sit here said comments "arrive in Phase 14c", and
   * it went stale the moment 17b built the thread. §18 admits only a Backer
   * holding a magic link, and nobody on the public page is authenticated — so
   * the thread lives on `/backer/:token`, which is the only surface in the
   * product where a Backer has an identity at all. The public page renders the
   * §18 item-13 band and points there; it does not host a thread it could not
   * attribute a single post to.
   */
  commentsEnabled: boolean;

  /* ── The rebuilt page's own copy and content (0049) ──────────────────────
   * All optional. A null heading or an empty list renders no section — never
   * an empty one, and never a placeholder (§1.4, §33.11.3). */
  heroHeadline: string | null;
  heroHeadlineAccent: string | null;
  founderPullQuote: string | null;
  platformLine: string | null;
  demoContextLabel: string | null;
  benefitsHeading: string | null;
  rewardsHeading: string | null;
  updatesHeading: string | null;
  faqHeading: string | null;
  demoMoments: PublicDemoMoment[];
  benefitCards: PublicBenefitCard[];

  /**
   * §20's own composed counts, for the threshold panel and the "N people
   * reserved" line (§21's threshold measure is `uniqueActiveBackers`, so this
   * adds no second way of counting).
   *
   * §30: rendered only where a real record produced it. Zero pre-orders renders
   * "Be the first" — never a fabricated number and never a rounded-up one.
   */
  preorderCounts: { uniqueActiveBackers: number; activeCount: number };
}

export interface PublicCampaign {
  campaign: PublicCampaignPayload;
  ended: EndedState | null;
  /** §18: false through Days 1–7 (known-link-only); true once Day 8 opened it. */
  indexable: boolean;
}

/** The factual refund summary for the page, restating the disclosed rules (§19/§31). */
function refundSummary(model: 'idea' | 'product', hasFounderPolicy: boolean): string[] {
  if (model === 'idea') {
    return [
      'If the campaign does not reach its order threshold, no card is charged at all.',
      'You can cancel free at any time before the close date.',
      "After a valid charge there is no change-of-mind refund on an Idea Campaign; Proovd's Refund Policy exceptions still apply.",
    ];
  }
  return [
    'You can cancel free at any time before the close date.',
    hasFounderPolicy
      ? "After the close date the campaign-specific Founder refund policy applies, at the exact version disclosed when you pre-ordered."
      : "After the close date, refund eligibility follows Proovd's Refund Policy and applicable law.",
    "Proovd's Refund Policy, applicable law, Stripe rules, and card-issuer rules apply on top and cannot be signed away.",
  ];
}

export async function buildPublicCampaign(
  db: Database,
  campaignId: string,
): Promise<PublicCampaign | null> {
  const [row] = await db
    .select({
      id: campaigns.id,
      type: campaigns.type,
      status: campaigns.status,
      discoveryOpenedAt: campaigns.discoveryOpenedAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!row || !row.type) return null;
  const lifecycle = classifyLifecycle(row.status);
  if (!lifecycle.isPublic) return null;

  const preview = await buildCampaignPreview(db, {
    campaignId,
    campaignType: row.type,
  });
  if (!preview) return null;

  const founderRefundPolicy =
    preview.founderRefundPolicy && preview.founderRefundPolicy.title
      ? {
          title: preview.founderRefundPolicy.title,
          version: preview.founderRefundPolicy.version ?? '',
          effectiveDate: preview.founderRefundPolicy.effectiveDate ?? '',
          text: preview.founderRefundPolicy.text,
        }
      : null;

  // "N left" on the page and the sold-out refusal at checkout must count the
  // same thing, so both read `countActiveForRewards` — the one predicate. A
  // page saying "3 left" over a different query from the one that refuses is a
  // Backer told there is stock and then told there is not.
  const takenByReward = await countActiveForRewards(
    db,
    preview.rewards.map((r) => r.id),
  );

  // §21's own threshold measure, composed from the append-only transition
  // history (17a). No second counter, and nothing rounded (§30).
  const counts = await readPreorderCounts(db, row.id);

  const payload: PublicCampaignPayload = {
    campaignId: row.id,
    model: preview.model,
    title: preview.title,
    tagline: preview.tagline,
    founder: preview.founder,
    opensAt: preview.opensAt,
    closesAt: preview.closesAt,
    rewards: preview.rewards.map((r) => {
      const taken = takenByReward.get(r.id) ?? 0;
      return {
        sku: r.sku,
        title: r.title,
        priceCents: r.priceCents,
        contents: r.contents,
        delivery: r.delivery,
        fulfillment: r.fulfillment,
        badge: r.badge,
        limitedQuantity: r.limitedQuantity,
        // Null when unlimited, so the surface has nothing to render rather than
        // a number it would have to decide how to describe. Floored at 0: a
        // negative remainder is unreachable through the atomic cap, and if one
        // ever appeared "−2 left" would be the worst possible way to say it.
        remaining: r.limitedQuantity === null ? null : Math.max(0, r.limitedQuantity - taken),
      };
    }),
    featuredRewardSku: preview.featuredRewardSku,
    orderThreshold: preview.orderThreshold,
    // §24.12/§33.9.13: the preview computes the one kernel's display value —
    // the same value the checkout stores on every reservation.
    statementDescriptor: preview.statementDescriptor,
    story: preview.story,
    faq: preview.faq,
    refundSummary: refundSummary(preview.model, Boolean(founderRefundPolicy)),
    founderRefundPolicy,
    commentsEnabled: false,
    heroHeadline: preview.heroHeadline,
    heroHeadlineAccent: preview.heroHeadlineAccent,
    founderPullQuote: preview.founderPullQuote,
    platformLine: preview.platformLine,
    demoContextLabel: preview.demoContextLabel,
    benefitsHeading: preview.benefitsHeading,
    rewardsHeading: preview.rewardsHeading,
    updatesHeading: preview.updatesHeading,
    faqHeading: preview.faqHeading,
    demoMoments: preview.demoMoments,
    benefitCards: preview.benefitCards,
    preorderCounts: {
      uniqueActiveBackers: counts.uniqueActiveBackers,
      activeCount: counts.activeCount,
    },
  };

  return {
    campaign: payload,
    ended: lifecycle.ended ? await resolveEndedState(db, row.id, lifecycle.ended) : null,
    indexable: row.discoveryOpenedAt !== null,
  };
}
