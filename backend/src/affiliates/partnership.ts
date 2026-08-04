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
 * ── What is deferred, and why it is labelled not guessed (§1.4) ─────────────
 * §18 item 6 also lists attributed pre-orders, conversion, captured amount,
 * earnings, and Transfer/payout state. Those need the reservation the Phase 15
 * pre-order flow creates and the money the Phase 19 reconciliation moves. Until
 * then they do not exist, so the payload reports them as unavailable with the
 * reason — never a fabricated zero that reads as "no sales" (§1.4). Clicks are
 * real now (the §18 attribution ledger), and are shown.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import {
  trackingLinks,
  associationCompensationAgreements,
} from '../db/schema/decisions.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
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

  /** §18 metrics that need Phase 15 (reservations) and Phase 19 (money). */
  pending: {
    available: false;
    note: string;
    fields: string[];
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
  input: { associationId: string; appBaseUrl: string },
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
      pending: {
        available: false,
        note: 'Attributed pre-orders, conversion, captured amount, estimated and finalized earnings, and payout status appear once the campaign takes pre-orders and, for earnings, after it closes and reconciles.',
        fields: [
          'Attributed active pre-orders',
          'Conversion',
          'Captured attributed amount',
          'Estimated and finalized earnings with bonus progress',
          'Transfer and payout state',
        ],
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
