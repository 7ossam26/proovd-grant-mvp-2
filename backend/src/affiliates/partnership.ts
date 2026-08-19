/**
 * The Creator active-partnership surface — Spec §18 item 6 (Phase 14c).
 *
 * Once a Creator has accepted and their campaign is preparing or live, this is
 * their working dashboard: the Founder and product, their unique tracking link
 * and disclosure text (both copy-confirmable on the surface), the brand rules,
 * the rewards, their locked compensation, the fixed-payment and first-post
 * state, their readiness, and their clicks.
 *
 * ── Refresh-based, never real time (§18, §30) ───────────────────────────────
 * Every metric is computed at read time and stamped with `updatedAt`. §30
 * forbids a real-time claim for refresh data, so the surface says "Updated
 * [local time]" and that the metrics are refresh-based — the server provides the
 * instant, the surface provides the sentence.
 *
 * ── The metrics are real now — Creator Flow v2 Session F, 2026-08-20 ───────
 * Phase 14d shipped a `pending` block naming attributed pre-orders, conversion,
 * captured amount, earnings and payout state as unavailable, because Phase 15
 * had not created a reservation and Phase 19 had not moved any money. Both
 * shipped. So `performance` carries the real §17 numbers and `pending` is gone
 * — a block still saying "not yet" about records that exist is §1.4's failure
 * in the other direction.
 *
 * What survives from that block is its rule: a number nobody has computed is
 * absent, never a zero. `conversionRate` over zero clicks is `null` (§16a, and
 * 17a's), and the money block still renders no amount until there is a captured
 * attributed subtotal to state.
 *
 * ── §19's boundary is what this payload may carry ──────────────────────────
 * "Affiliate sees only aggregate clicks, attributed pre-orders, reward summary,
 * and timestamps", and §28.4 adds that the Creator receives no Backer PII. So
 * every number below is a COUNT or a SUM — there is no per-reservation row, no
 * Backer identity, and no survey answer in the query at all, which is the form
 * of that boundary that survives somebody adding a field later.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import {
  trackingLinks,
  associationCompensationAgreements,
  creatorBonuses,
} from '../db/schema/decisions.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { campaignAssets } from '../db/schema/workspace.js';
import { trackingLinkClicks } from '../db/schema/attribution.js';
import { findAllocation } from '../creator-payment/allocations.js';
import { CREATOR_DISCLOSURE_TEXT } from './decisions.js';
import { LINK_TEST_MARKER } from './roster-labels.js';
import { midCampaignAdditions } from '../db/schema/live-editing.js';
import { EARNINGS_STATE_LABELS } from '../campaign/editing-logic.js';
import { CREATOR_OBLIGATIONS, NO_ACTION_NEEDED } from './obligations.js';

export interface CreatorPartnership {
  associationId: string;
  campaignId: string;
  status: string;
  /** §18: joined-at (the association) and activated-at (the tracking link). */
  joinedAt: string;
  rosterMembership: string;

  founder: { displayName: string };
  product: { title: string; model: 'idea' | 'product'; publicUrl: string; closesAt: string | null };

  /** §18: the unique tracking link + the safe test URL, both copy-confirmable. */
  trackingLink: {
    url: string;
    testUrl: string;
    active: boolean;
    activatedAt: string | null;
    pausedAt: string | null;
    disclosureText: string;
  } | null;

  /** §18: brand notes, allowed and prohibited claims. */
  brandRules: {
    requiredWording: string | null;
    prohibitedClaims: string | null;
    brandPerception: string | null;
    brandVoice: string | null;
  };

  rewards: Array<{ title: string; priceCents: string; delivery: string }>;

  /** §18: locked compensation. */
  compensation: {
    basePercent: number;
    bidIncreasePercent: number;
    totalPercent: number;
    fixedPaymentCents: string | null;
  } | null;

  /** §18: fixed-payment funding and completion state. */
  fixedPayment:
    | { applicable: true; status: string; label: string; amountCents: string | null; fundedAt: string | null }
    | { applicable: false };

  /** §18: first-post state. */
  firstPost: {
    status: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    correctionDetail: string | null;
  };

  /** §18: readiness — at the status level; the 13-item breakdown is the Founder/Admin view. */
  readiness: { state: string; ready: boolean; label: string };

  /** §18: clicks. Real now (the attribution ledger); link tests are excluded (§14.1). */
  clicks: { total: number; attributed: number };

  /**
   * §17: "Clicks, attributed active pre-orders, conversion" and "Captured
   * attributed amount after close."
   *
   * Aggregate only (§19). `conversionRate` is null over zero clicks rather than
   * `0%` — a rate with no denominator is not a rate, and rendering one as zero
   * reads as "nobody converted" (§16a).
   */
  performance: {
    attributedPreorders: number;
    activePreorders: number;
    capturedPreorders: number;
    capturedSubtotalCents: string;
    /** Attributed pre-orders per click, 0–1, or null over zero clicks. */
    conversionRate: number | null;
    /** §17: the Creator's own attribution against everything else. */
    attributionNote: string;
  };

  /**
   * §17: "bonus progress" — and §14.3's bonus is CREATOR-SPECIFIC, per proposal
   * version, with a stored trigger unit and threshold.
   *
   * Null where no bonus was agreed. The reference draws a platform-wide "50
   * reservations to your bonus tier"; there is no such target and inventing one
   * is §1 rule 6 (refused in `CREATOR_FLOW_ABSENCES`).
   */
  bonus: {
    triggerUnit: string;
    /** Cents for the subtotal unit; a count of people for the Backer unit. */
    thresholdValue: string;
    additionalPercent: number;
    maxCombinedPercent: number;
    /**
     * Progress in the bonus's own unit, over this Creator's own attributed
     * pre-orders that are still live or already charged.
     *
     * The bonus is DECIDED at close, on captured and verified charges only
     * (`close/earnings.ts`), so this is a running measure and `note` says so.
     * Reporting the finalization measure live would read 0 for every Creator
     * until the close batch runs, which is true and useless.
     */
    progressValue: string;
    note: string;
    /** §14.3's recorded result. Null until finalization writes it once. */
    earnedPercent: number | null;
  } | null;

  /**
   * §31.5 kit material for this campaign, as the Founder supplied it.
   *
   * Downloaded, never generated (§30, §12). `available` is false while object
   * storage is unconfigured (Track A4) — the arrangement the Affiliate evidence
   * uploader uses: the payload names the gap so the surface renders an absence
   * rather than a dead control.
   */
  materials: {
    available: boolean;
    unavailableBecause: string | null;
    assets: Array<{ id: string; purpose: string; filename: string | null; contentType: string }>;
  };

  /**
   * §20 / §22.1's earnings state, rendered as Appendix B.7 (Phase 17b).
   *
   * Seven distinct states, and this reports the one the Creator is actually in.
   * During a live campaign that is `estimated` with nothing captured — §22.1
   * finalizes after the retry window and creates the Transfer on or after Day 3,
   * both Phase 19 — so the amount is null and the block names what it is waiting
   * for rather than showing a number nobody has computed (§1.4).
   */
  earnings: {
    state: string;
    label: string;
    /** Null until there is a captured, attributed amount to state. */
    amountCents: string | null;
    /** §20: reason, owner, and next date/action on every unpaid state. */
    reason: string;
    owner: string;
    nextUpdate: string;
    action: string;
    actionRequired: boolean;
    /** Appendix B.7, rendered — or null while there is no amount to render. */
    statusBlock: string | null;
  };

  /** §20's obligations, surfaced on the Creator's own working surface. */
  obligations: Array<{ key: string; statement: string; enforcement: string }>;

  /**
   * §20 mid-campaign addition: the remaining-time terms this Creator accepted,
   * when they joined late. Null for the initial roster.
   */
  midCampaign: {
    joinedWithHoursRemaining: number;
    adjustedDeliverables: string;
    /** §20: no retroactive attribution — stated, because it is money. */
    attributionNote: string;
  } | null;

  /** §18/§30: the refresh instant. The surface renders "Updated [local time]". */
  updatedAt: string;
}

export type PartnershipResult =
  | { ok: true; partnership: CreatorPartnership }
  | { ok: false; code: 'not_found' | 'not_active' };

const FIXED_PAYMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting funding',
  payment_failed: 'Funding failed',
  funded: 'Funded — held until you complete the work',
  returned: 'Returned to the Founder',
  paid: 'Paid',
};

const READINESS_LABELS: Record<string, { ready: boolean; label: string }> = {
  accepted: { ready: false, label: 'Accepted — getting ready' },
  readiness_blocked: { ready: false, label: 'Setup in progress' },
  ready: { ready: true, label: 'Ready — awaiting launch' },
  active: { ready: true, label: 'Active — your link is live' },
  paused: { ready: false, label: 'Paused — a correction is needed on your post' },
  ended: { ready: false, label: 'Ended' },
  removed: { ready: false, label: 'Removed' },
  successfully_completed: { ready: true, label: 'Completed' },
  completion_disqualified: { ready: false, label: 'Completion disqualified' },
};

/** The statuses at which a partnership exists — the Creator accepted terms. */
const PARTNERSHIP_STATUSES = new Set(Object.keys(READINESS_LABELS));

export async function buildCreatorPartnership(
  db: Database,
  input: { associationId: string; appBaseUrl: string; storageConfigured?: boolean },
): Promise<PartnershipResult> {
  const [association] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      rosterMembership: campaignAffiliateAssociations.rosterMembership,
      createdAt: campaignAffiliateAssociations.createdAt,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { ok: false, code: 'not_found' };
  if (!PARTNERSHIP_STATUSES.has(association.status)) return { ok: false, code: 'not_active' };

  const [campaign] = await db
    .select({ type: campaigns.type, closesAt: campaigns.campaignCloseAt })
    .from(campaigns)
    .where(eq(campaigns.id, association.campaignId))
    .limit(1);
  const model: 'idea' | 'product' = campaign?.type === 'pre_build' ? 'idea' : 'product';

  const [build] = await db
    .select()
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, association.campaignId))
    .limit(1);

  const rewardRows = await db
    .select()
    .from(campaignRewardPackages)
    .where(eq(campaignRewardPackages.campaignId, association.campaignId));

  const [link] = await db
    .select()
    .from(trackingLinks)
    .where(eq(trackingLinks.associationId, input.associationId))
    .limit(1);

  const [agreement] = await db
    .select()
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, input.associationId))
    .limit(1);

  const allocation = await findAllocation(db, input.associationId);

  const [submission] = await db
    .select()
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.associationId, input.associationId))
    .orderBy(desc(creatorPostSubmissions.submittedAt))
    .limit(1);

  // §18 clicks — from the attribution ledger; link tests excluded (§14.1).
  const [clickStats] = await db
    .select({
      total: sql<number>`count(*) filter (where ${trackingLinkClicks.linkTest} = false)`,
      attributed: sql<number>`count(*) filter (where ${trackingLinkClicks.outcome} = 'attributed')`,
    })
    .from(trackingLinkClicks)
    .where(eq(trackingLinkClicks.associationId, input.associationId));

  // §17: attributed pre-orders, conversion, and the captured attributed amount.
  // Aggregate only (§19) — counts and one sum, with no per-reservation row and
  // no Backer column selected at all.
  const [preorderStats] = await db
    .select({
      attributed: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${reservations.status} = 'reserved_active')::int`,
      captured: sql<number>`count(*) filter (where ${reservations.status} = 'captured')::int`,
      capturedSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} = 'captured'), 0)::text`,
      // §14.3's two trigger units, measured over rows that are still live or
      // already charged — the running total the bonus block reports.
      liveSubtotal: sql<string>`coalesce(sum(${reservations.rewardSubtotalCents}) filter (where ${reservations.status} in ('reserved_active','captured')), 0)::text`,
      liveBackers: sql<number>`count(distinct ${reservations.backerIdentityId}) filter (where ${reservations.status} in ('reserved_active','captured'))::int`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, association.campaignId),
        eq(reservations.attributionAssociationId, input.associationId),
      ),
    );

  // §14.3: this Creator's own bonus, from their own accepted proposal version.
  // There is no platform-wide target to fall back to and inventing one is
  // §1 rule 6, so a Creator with no agreed bonus gets null.
  const [bonus] = await db
    .select()
    .from(creatorBonuses)
    .where(eq(creatorBonuses.associationId, input.associationId))
    .limit(1);

  // §31.5 kit material for the campaign. Downloaded, never generated.
  const assetRows = await db
    .select({
      id: campaignAssets.id,
      purpose: campaignAssets.purpose,
      originalFilename: campaignAssets.originalFilename,
      contentType: campaignAssets.contentType,
    })
    .from(campaignAssets)
    .where(eq(campaignAssets.campaignId, association.campaignId));

  const readiness = READINESS_LABELS[association.status] ?? { ready: false, label: 'Not active' };
  const fixedApplicable = agreement?.fixedPaymentCents != null;

  // §20 (Phase 17b): the remaining-time terms a mid-campaign Creator accepted.
  // Read rather than recomputed — recomputing would show them a window that has
  // shrunk since they agreed to it, which is not what they agreed to.
  const [addition] = await db
    .select({
      remainingHours: midCampaignAdditions.remainingHours,
      adjustedDeliverables: midCampaignAdditions.adjustedDeliverables,
    })
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.associationId, input.associationId))
    .limit(1);

  return {
    ok: true,
    partnership: {
      associationId: association.id,
      campaignId: association.campaignId,
      status: association.status,
      joinedAt: association.createdAt.toISOString(),
      rosterMembership: association.rosterMembership,
      founder: { displayName: build?.founderDisplayName ?? 'The Founder' },
      product: {
        title: build?.title ?? 'the campaign',
        model,
        publicUrl: `${input.appBaseUrl}/campaign/${association.campaignId}`,
        closesAt: campaign?.closesAt?.toISOString() ?? null,
      },
      trackingLink: link
        ? {
            url: `${input.appBaseUrl}/c/${link.code}`,
            testUrl: `${input.appBaseUrl}/c/${link.code}?${LINK_TEST_MARKER}=1`,
            active: link.active,
            activatedAt: link.activatedAt?.toISOString() ?? null,
            pausedAt: link.pausedAt?.toISOString() ?? null,
            disclosureText: CREATOR_DISCLOSURE_TEXT,
          }
        : null,
      brandRules: {
        requiredWording: build?.requiredWording ?? null,
        prohibitedClaims: build?.prohibitedClaims ?? null,
        brandPerception: build?.brandPerception ?? null,
        brandVoice: build?.brandVoice ?? null,
      },
      rewards: rewardRows.map((r) => ({
        title: r.title,
        priceCents: r.priceCents.toString(),
        delivery: r.delivery,
      })),
      compensation: agreement
        ? {
            basePercent: agreement.basePercent,
            bidIncreasePercent: agreement.bidIncreasePercent,
            totalPercent: agreement.totalPercent,
            fixedPaymentCents: agreement.fixedPaymentCents?.toString() ?? null,
          }
        : null,
      fixedPayment:
        fixedApplicable && allocation
          ? {
              applicable: true,
              status: allocation.status,
              label: FIXED_PAYMENT_LABELS[allocation.status] ?? allocation.status,
              amountCents: allocation.amountCents.toString(),
              fundedAt: allocation.fundedAt?.toISOString() ?? null,
            }
          : { applicable: false },
      firstPost: {
        status: submission?.status ?? null,
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
        verifiedAt: submission?.verifiedAt?.toISOString() ?? null,
        correctionDetail: submission?.correctionDetail ?? null,
      },
      readiness: { state: association.status, ready: readiness.ready, label: readiness.label },
      clicks: {
        total: Number(clickStats?.total ?? 0),
        attributed: Number(clickStats?.attributed ?? 0),
      },
      performance: {
        attributedPreorders: Number(preorderStats?.attributed ?? 0),
        activePreorders: Number(preorderStats?.active ?? 0),
        capturedPreorders: Number(preorderStats?.captured ?? 0),
        capturedSubtotalCents: preorderStats?.capturedSubtotal ?? '0',
        // §16a: a rate over a zero denominator is not zero, it is absent.
        conversionRate:
          Number(clickStats?.total ?? 0) > 0
            ? Number(preorderStats?.attributed ?? 0) / Number(clickStats?.total ?? 0)
            : null,
        attributionNote:
          'These count only what came through your own link. Pre-orders the campaign got any other way are not yours and are not shown here.',
      },

      bonus: bonus
        ? {
            triggerUnit: bonus.triggerUnit,
            thresholdValue: bonus.threshold.toString(),
            additionalPercent: bonus.additionalPercent,
            maxCombinedPercent: bonus.maxCombinedPercent,
            progressValue:
              bonus.triggerUnit === 'attributed_subtotal_cents'
                ? (preorderStats?.liveSubtotal ?? '0')
                : String(preorderStats?.liveBackers ?? 0),
            note:
              'This counts pre-orders through your link that are still live or already charged. ' +
              'The bonus itself is decided when the campaign closes, on charges that actually went ' +
              'through and were verified as yours — so this is a running total, not a promise.',
            earnedPercent: bonus.earnedPercent,
          }
        : null,

      materials: {
        available: input.storageConfigured === true,
        unavailableBecause:
          input.storageConfigured === true
            ? null
            : 'The campaign’s object storage is not configured in this deployment, so there is nothing stored to download yet. Everything the Founder has supplied in writing is above.',
        assets: assetRows.map((a) => ({
          id: a.id,
          purpose: a.purpose,
          filename: a.originalFilename,
          contentType: a.contentType,
        })),
      },

      // §20/§22.1. `estimated` is the honest state while a campaign runs: no
      // charge has been captured, so nothing has been earned. Appendix B.7 is
      // not rendered because it names an exact amount and there is not one yet
      // — a rendered "US$0.00 recorded" would read as "you earned nothing".
      earnings: {
        state: 'estimated',
        label: EARNINGS_STATE_LABELS.estimated,
        amountCents: null,
        reason:
          'The campaign has not closed, so no charge has been captured and nothing has been earned yet. Your earnings come from captured charges attributed to your link.',
        owner: 'Proovd',
        nextUpdate: campaign?.closesAt
          ? `After the campaign closes on ${campaign.closesAt.toISOString().slice(0, 10)}`
          : 'After the campaign closes',
        action: NO_ACTION_NEEDED,
        actionRequired: false,
        statusBlock: null,
      },

      obligations: CREATOR_OBLIGATIONS.map((obligation) => ({
        key: obligation.key,
        statement: obligation.statement,
        enforcement: obligation.enforcement,
      })),

      midCampaign: addition
        ? {
            joinedWithHoursRemaining: addition.remainingHours,
            adjustedDeliverables: addition.adjustedDeliverables,
            attributionNote:
              'Your link went live when you joined. Clicks and pre-orders that happened before then belong to the campaign, not to you — they cannot be credited to your link.',
          }
        : null,

      updatedAt: new Date().toISOString(),
    },
  };
}
