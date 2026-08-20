/**
 * The Creator's two lists, and §14.1's content behind one pitch —
 * Creator Flow v2, Session E, 2026-08-20.
 *
 * ── This module contains no decision, and that is checkable ────────────────
 * `acceptStandardTerms`, `declineOpportunity`, `submitProposal` and
 * `respondToProposal` are §33.2.6–§33.2.13's, and `decisions.ts` is untouched
 * by this session. Everything here is a READ. The pitch detail calls
 * `readFormalOpportunity` verbatim for the decision facts and composes §14.1's
 * material beside it — `creator-money.ts` calling `readCreatorClose` and adding
 * nothing to it, one session earlier and for the same reason.
 *
 * ── The pitch count has one derivation ─────────────────────────────────────
 * `PITCH_DECISION_OPEN_STATES` and `pitchKindFor` live here and `home.ts`
 * imports them, so §20's hero count and the Pitches tab's count cannot
 * disagree. They were `home.ts`'s until Session E needed the second reader;
 * a copy would have been two answers to "what is waiting for me".
 *
 * ── §14.1's list was not being served, and the register said it was ────────
 * `readFormalOpportunity` returns the §14.3 cell, high effort, the versions,
 * the agreement and the link — the decision facts. It returns none of the
 * Founder's material: no Problem, no Solution, no rewards, no dates, no claims.
 * The reconciliation recorded the recap as *"All §14.1 kit fields that
 * `readFormalOpportunity` already returns"*, which is wrong, and the first
 * thing to read it found that out. `readPitchContent` is the other half.
 *
 * ── One assembly of the Founder's product content ──────────────────────────
 * `buildCampaignPreview` is the ONE place a campaign's built content is
 * composed — the public page and the Founder preview both read it — so the
 * recap reads it too rather than issuing a third set of queries that would
 * drift. What is added beside it is what §14.1 asks a CREATOR for and a Backer
 * is never shown: the internal target, the brand and claims notes, the
 * Founder's connected-account readiness, and their prior Proovd history.
 */

import { and, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations, campaigns } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { campaignVetting, founderClaimProfiles } from '../db/schema/vetting.js';
import { listingFeePayments } from '../db/schema/listing.js';
import { proposalVersions, trackingLinks } from '../db/schema/decisions.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { campaignBuild } from '../db/schema/build.js';
import {
  campaignAssets,
  campaignSocialProfiles,
  founderInterviewBookings,
} from '../db/schema/workspace.js';
import { midCampaignAdditions } from '../db/schema/live-editing.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { buildCampaignPreview } from '../campaign/preview.js';
import { readCompensationSettings, resolveCell, readFormalOpportunity } from './decisions.js';
import type { FormalOpportunity, Refused } from './decisions.js';
import { READINESS_LABELS } from './partnership.js';
import { CREATOR_OBLIGATIONS } from './obligations.js';

/**
 * The association states in which the Creator owes a decision.
 *
 * `proposal_pending` is deliberately not here: it counts only when the open
 * version is `awaiting_creator`, because a version waiting on the FOUNDER is
 * not something the Creator can act on, and counting it would put a number on
 * a tab that no control can reduce.
 */
export const PITCH_DECISION_OPEN_STATES = ['formal_decision_open', 'reviewing'] as const;

export type PitchKind = 'opportunity' | 'proposal';

/** `proposal` when a version is waiting on this side; `opportunity` otherwise. */
export function pitchKindFor(awaitingCreator: boolean): PitchKind {
  return awaitingCreator ? 'proposal' : 'opportunity';
}

/* ── The two lists ────────────────────────────────────────────────────────── */

export interface CreatorPitchRow {
  associationId: string;
  campaignId: string;
  productName: string | null;
  kind: PitchKind;
  /** §14.1's opener. Two Admin-written sentences, or nothing. */
  whyThisFitsYourAudience: string | null;
  /** §12's classification, locked at listing payment. */
  highEffort: boolean;
  /** The §14.3 cell, resolved — never a predicted amount (§22.2). */
  basePercent: number;
  bidAllowed: boolean;
  fixedPaymentAvailable: boolean;
  ceilingPercent: number;
  campaignType: 'pre_build' | 'pre_launch';
  /** The stored §14.6 deadline. Immutable, and what the default sort reads. */
  responseDeadlineAt: string | null;
  invitedAt: string;
}

export interface CreatorActiveRow {
  associationId: string;
  campaignId: string;
  productName: string | null;
  /** §23.4's machine value, and the ONE label map the work surface renders. */
  status: string;
  label: string;
  ready: boolean;
  trackingLinkUrl: string | null;
  trackingLinkActive: boolean;
  /** §17 step 5, or null where nothing has been submitted. */
  firstPostStatus: string | null;
  /** Where the row goes: the work surface while it runs, the close view after. */
  destination: 'work' | 'close';
}

export interface CreatorPitchesView {
  pitches: CreatorPitchRow[];
  active: CreatorActiveRow[];
}

/** The states at which a partnership exists — `partnership.ts`'s own set. */
const ACTIVE_STATES = Object.keys(READINESS_LABELS);

/** After these, the money is the story and the close view is where it is. */
const CLOSED_STATES = new Set([
  'ended',
  'removed',
  'successfully_completed',
  'completion_disqualified',
]);

/**
 * Both lists for one signed-in Creator, in one read.
 *
 * Batched with `inArray` rather than a query per row: a Creator with three
 * campaigns and two open invitations would otherwise cost fifteen round trips
 * for a list that renders in one screen.
 */
export async function readCreatorPitches(
  db: Database,
  affiliateUserId: string,
  options: { sort?: string } = {},
): Promise<CreatorPitchesView> {
  const rows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      whyRecruited: campaignAffiliateAssociations.whyRecruited,
      createdAt: campaignAffiliateAssociations.createdAt,
      campaignType: campaigns.type,
      highEffort: campaigns.highEffort,
      productName: founderProspects.productName,
      responseDeadlineAt: listingFeePayments.responseDeadlineAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaignAffiliateAssociations.campaignId))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .leftJoin(
      listingFeePayments,
      eq(listingFeePayments.campaignId, campaignAffiliateAssociations.campaignId),
    )
    // The authorization predicate, inside the query. Somebody else's
    // association is not filtered out afterwards — it is never selected.
    .where(eq(affiliateSignupProfiles.claimedUserId, affiliateUserId));

  const ids = rows.map((r) => r.associationId);

  const awaiting =
    ids.length > 0
      ? await db
          .select({ associationId: proposalVersions.associationId })
          .from(proposalVersions)
          .where(
            and(
              inArray(proposalVersions.associationId, ids),
              eq(proposalVersions.state, 'awaiting_creator'),
            ),
          )
      : [];
  const awaitingIds = new Set(awaiting.map((v) => v.associationId));

  const links =
    ids.length > 0
      ? await db
          .select({
            associationId: trackingLinks.associationId,
            code: trackingLinks.code,
            active: trackingLinks.active,
          })
          .from(trackingLinks)
          .where(inArray(trackingLinks.associationId, ids))
      : [];
  const linkByAssociation = new Map(links.map((l) => [l.associationId, l]));

  const posts =
    ids.length > 0
      ? await db
          .select({
            associationId: creatorPostSubmissions.associationId,
            status: creatorPostSubmissions.status,
            submittedAt: creatorPostSubmissions.submittedAt,
          })
          .from(creatorPostSubmissions)
          .where(inArray(creatorPostSubmissions.associationId, ids))
          .orderBy(desc(creatorPostSubmissions.submittedAt))
      : [];
  const postByAssociation = new Map<string, string>();
  for (const post of posts) {
    if (!postByAssociation.has(post.associationId)) {
      postByAssociation.set(post.associationId, post.status);
    }
  }

  const settings = await readCompensationSettings(db);

  const pitches: CreatorPitchRow[] = rows
    .filter(
      (r) =>
        // A campaign with no locked §9 type has no §14.3 cell, and there is no
        // honest way to render a pitch without one. Unreachable in practice —
        // the formal opportunity opens at listing payment, which is after the
        // type lock — and filtered rather than defaulted, because a default
        // here would be a guess about which of the two matrices applies.
        r.campaignType !== null &&
        ((PITCH_DECISION_OPEN_STATES as readonly string[]).includes(r.status) ||
          awaitingIds.has(r.associationId)),
    )
    .map((r) => {
      const campaignType = r.campaignType as 'pre_build' | 'pre_launch';
      const cell = resolveCell(
        settings,
        { campaignType, highEffort: r.highEffort === true },
        false,
      );
      return {
        associationId: r.associationId,
        campaignId: r.campaignId,
        productName: r.productName,
        kind: pitchKindFor(awaitingIds.has(r.associationId)),
        whyThisFitsYourAudience: r.whyRecruited,
        highEffort: r.highEffort === true,
        basePercent: cell.basePercent,
        bidAllowed: cell.bidAllowed,
        fixedPaymentAvailable: cell.fixedPaymentAllowed,
        ceilingPercent: cell.ceilingPercent,
        campaignType,
        responseDeadlineAt: r.responseDeadlineAt?.toISOString() ?? null,
        invitedAt: r.createdAt.toISOString(),
      };
    });

  // Both sorts are over a stored instant. A pitch with no recorded deadline
  // sorts last rather than first — an absent deadline is not an urgent one.
  if (options.sort === 'newest') {
    pitches.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
  } else {
    pitches.sort((a, b) => {
      if (a.responseDeadlineAt === b.responseDeadlineAt) return a.invitedAt.localeCompare(b.invitedAt);
      if (a.responseDeadlineAt === null) return 1;
      if (b.responseDeadlineAt === null) return -1;
      return a.responseDeadlineAt.localeCompare(b.responseDeadlineAt);
    });
  }

  const active: CreatorActiveRow[] = rows
    .filter((r) => ACTIVE_STATES.includes(r.status))
    .map((r) => {
      const readiness = READINESS_LABELS[r.status] ?? { ready: false, label: 'Not active' };
      const link = linkByAssociation.get(r.associationId);
      return {
        associationId: r.associationId,
        campaignId: r.campaignId,
        productName: r.productName,
        status: r.status,
        label: readiness.label,
        ready: readiness.ready,
        trackingLinkUrl: link ? link.code : null,
        trackingLinkActive: link?.active === true,
        firstPostStatus: postByAssociation.get(r.associationId) ?? null,
        destination: CLOSED_STATES.has(r.status) ? ('close' as const) : ('work' as const),
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status));

  return { pitches, active };
}

/* ── §14.1's content behind one pitch ─────────────────────────────────────── */

export interface PitchContent {
  /** §14.1's 60-second brief, composed from facts that already exist. */
  brief: {
    audience: string | null;
    productPromise: string | null;
    campaignType: string;
    requiredPromotion: string;
    compensation: string;
    keyDate: string | null;
    mainRisk: string | null;
  };
  founder: {
    displayName: string;
    entity: string;
    soleProprietor: boolean | null;
    profileUrl: string | null;
    /** §14.1: prior Proovd history. A count of their other campaigns. */
    priorCampaigns: number;
    /** §14.1's readiness INDICATOR — a state, never the documents (§13). */
    payoutReadiness: 'ready' | 'in_progress' | 'not_started';
  };
  positioning: {
    productName: string | null;
    category: string | null;
    problem: string | null;
    solution: string | null;
    competition: string | null;
  };
  chargeRule: { campaignType: string; rule: string };
  materials: {
    story: string | null;
    socials: Array<{ platform: string | null; url: string }>;
    /** Counts and a named absence — the file itself is Track A4 (§12). */
    visuals: { count: number; available: boolean; unavailableBecause: string | null };
    interview: { status: string | null; available: boolean; unavailableBecause: string | null };
  };
  rewards: Array<{
    title: string;
    priceCents: string;
    contents: string[];
    delivery: string;
    fulfillment: string;
    limitedQuantity: number | null;
  }>;
  /** §14.1: "correctly labeled" — the label is the server's, not the surface's. */
  threshold: { label: string; value: string | null; note: string };
  dates: { opensAt: string | null; closesAt: string | null; durationDays: number | null };
  brandNotes: { brandVoice: string | null; brandPerception: string | null };
  claims: {
    requiredWording: string | null;
    prohibitedClaims: string | null;
    unconfirmedClaimWarning: string;
  };
  refundPolicy: {
    applicable: boolean;
    title: string | null;
    text: string | null;
    note: string;
  };
  deliverables: {
    deliveryWindow: string | null;
    obligations: ReadonlyArray<{ key: string; statement: string; enforcement: string }>;
  };
  /** §14.1's live-invite terms. Null for an initial-roster Creator — an answer. */
  midCampaign: {
    joinedWithHoursRemaining: number;
    adjustedDeliverables: string;
    activationRule: string;
  } | null;
}

/**
 * §14.1's unconfirmed-claim warning, said once.
 *
 * The Founder's material is the Founder's assertion. Proovd verifies §12's
 * objective evidence and nothing about whether a product does what its page
 * says — and a Creator repeating a claim in their own voice is the person the
 * FTC holds to it.
 */
const UNCONFIRMED_CLAIM_WARNING =
  'Everything the Founder says about this product is the Founder’s own claim. Proovd has not tested it. If you repeat a claim in your own words, it becomes yours as well — say only what you can stand behind.';

const REFUND_POLICY_IDEA_NOTE =
  'An Idea Campaign has no Founder refund policy — §24.9 governs what happens when one is refunded, and there is no change-of-mind path.';

const REFUND_POLICY_PRODUCT_NOTE =
  'This is the Founder’s own policy. It is snapshotted onto every pre-order at the moment it is placed, so a later edit does not change what a Backer agreed to.';

const ACTIVATION_RULE =
  'Your link starts earning from the moment it is activated and never before. Traffic the campaign had before you joined is not yours, and nothing is applied retroactively.';

export type PitchContentResult =
  | { ok: true; content: PitchContent }
  | { ok: false; code: 'not_found' };

export async function readPitchContent(
  db: Database,
  input: { associationId: string; affiliateUserId: string },
): Promise<PitchContentResult> {
  const [row] = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      campaignType: campaigns.type,
      campaignStatus: campaigns.status,
      liveAt: campaigns.campaignLiveAt,
      closeAt: campaigns.campaignCloseAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaigns.id, campaignAffiliateAssociations.campaignId))
    .innerJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.id, input.associationId),
        eq(affiliateSignupProfiles.claimedUserId, input.affiliateUserId),
      ),
    )
    .limit(1);

  // The §9 type is locked at submission and the formal opportunity opens at
  // listing payment, so a pitch always has one. Treated as absent rather than
  // defaulted for the reason the list filters on it: choosing a matrix for a
  // campaign that has not chosen one is a guess about money.
  if (!row || row.campaignType === null) return { ok: false, code: 'not_found' };
  const campaignType: 'pre_build' | 'pre_launch' = row.campaignType;

  const preview = await buildCampaignPreview(db, {
    campaignId: row.campaignId,
    campaignType,
  });

  const [vetting] = await db
    .select({
      productName: founderProspects.productName,
      prospectId: founderProspects.id,
      founderUserId: founderProspects.claimedUserId,
      problem: campaignVetting.problemText,
      solution: campaignVetting.solutionText,
      competition: campaignVetting.competitionText,
      soleProprietor: founderClaimProfiles.soleProprietor,
    })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .leftJoin(campaignVetting, eq(campaignVetting.draftId, campaignDrafts.id))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.draftId, campaignDrafts.id))
    .where(eq(campaignDrafts.campaignId, row.campaignId))
    .limit(1);

  const [build] = await db
    .select({
      brandVoice: campaignBuild.brandVoice,
      brandPerception: campaignBuild.brandPerception,
      requiredWording: campaignBuild.requiredWording,
      prohibitedClaims: campaignBuild.prohibitedClaims,
      deliveryWindow: campaignBuild.deliveryWindow,
      internalTargetCents: campaignBuild.internalTargetCents,
      orderThreshold: campaignBuild.orderThreshold,
    })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, row.campaignId))
    .limit(1);

  const socials = await db
    .select({ platform: campaignSocialProfiles.platform, url: campaignSocialProfiles.url })
    .from(campaignSocialProfiles)
    .where(
      and(
        eq(campaignSocialProfiles.campaignId, row.campaignId),
        sql`${campaignSocialProfiles.removedAt} is null`,
      ),
    );

  const [visuals] = await db
    .select({ total: count() })
    .from(campaignAssets)
    .where(
      and(eq(campaignAssets.campaignId, row.campaignId), eq(campaignAssets.state, 'stored')),
    );

  const [booking] = await db
    .select({ status: founderInterviewBookings.status })
    .from(founderInterviewBookings)
    .where(eq(founderInterviewBookings.campaignId, row.campaignId))
    .orderBy(desc(founderInterviewBookings.createdAt))
    .limit(1);

  const [addition] = await db
    .select({
      remainingHours: midCampaignAdditions.remainingHours,
      adjustedDeliverables: midCampaignAdditions.adjustedDeliverables,
    })
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.associationId, row.associationId))
    .limit(1);

  // §14.1's "prior Proovd history": how many OTHER campaigns this Founder has
  // run with us. A count, not a rating — §30 defers public Founder ratings and
  // §8's assessment data is Admin's.
  const [prior] = vetting?.prospectId
    ? await db
        .select({ total: count() })
        .from(campaignDrafts)
        .where(
          and(
            eq(campaignDrafts.prospectId, vetting.prospectId),
            isNotNull(campaignDrafts.campaignId),
            ne(campaignDrafts.campaignId, row.campaignId),
          ),
        )
    : [{ total: 0 }];

  // §13/§14.1: the readiness INDICATOR. A state and nothing behind it — Proovd
  // holds a status and an id and never the identity documents.
  const [account] = vetting?.founderUserId
    ? await db
        .select({ chargesEnabled: stripeConnectedAccounts.chargesEnabled })
        .from(stripeConnectedAccounts)
        .where(
          and(
            eq(stripeConnectedAccounts.ownerUserId, vetting.founderUserId),
            eq(stripeConnectedAccounts.role, 'founder_seller'),
          ),
        )
        .limit(1)
    : [];

  const isIdea = campaignType === 'pre_build';
  const campaignTypeLabel = isIdea ? 'Idea Campaign' : 'Product Campaign';

  const durationDays =
    preview?.opensAt && preview.closesAt
      ? Math.max(
          0,
          Math.round(
            (Date.parse(preview.closesAt) - Date.parse(preview.opensAt)) / (24 * 60 * 60 * 1000),
          ),
        )
      : null;

  return {
    ok: true,
    content: {
      brief: {
        audience: null,
        productPromise: preview?.tagline || null,
        campaignType: campaignTypeLabel,
        requiredPromotion:
          'One first post that Proovd verifies, then keep promoting through the channels you told us about until the campaign closes.',
        compensation: isIdea
          ? 'A percentage of every captured, validly attributed pre-order. No fixed Creator payment exists on an Idea Campaign.'
          : 'A percentage of every captured, validly attributed pre-order, and — if you request one and the Founder accepts it — an optional fixed Creator payment beside it.',
        keyDate: preview?.closesAt ?? null,
        mainRisk: preview?.risksAndChallenges ?? preview?.earlyProductDisclaimer ?? null,
      },
      founder: {
        displayName: preview?.founder.legalName ?? 'The Founder',
        entity: preview?.founder.entity ?? 'sole proprietor',
        soleProprietor: vetting?.soleProprietor ?? null,
        profileUrl: preview?.founder.profile || null,
        priorCampaigns: Number(prior?.total ?? 0),
        payoutReadiness:
          account === undefined
            ? 'not_started'
            : account.chargesEnabled
              ? 'ready'
              : 'in_progress',
      },
      positioning: {
        productName: vetting?.productName ?? preview?.title ?? null,
        // §14.1 asks for a product category and no record holds one — not on
        // the prospect, not on the build. Null and named on the surface (§16a),
        // rather than a guess derived from the product name.
        category: null,
        problem: vetting?.problem ?? null,
        solution: vetting?.solution ?? null,
        competition: vetting?.competition ?? null,
      },
      chargeRule: {
        campaignType: campaignTypeLabel,
        rule: isIdea
          ? 'Backers save a card now and are charged only if the campaign reaches its order threshold by the close date. If it does not, nobody is charged.'
          : 'Backers save a card now and are charged when the campaign closes. There is no threshold to reach.',
      },
      materials: {
        story: preview?.story ?? null,
        socials: socials.map((s) => ({ platform: s.platform, url: s.url })),
        visuals: {
          count: Number(visuals?.total ?? 0),
          available: Number(visuals?.total ?? 0) > 0,
          unavailableBecause:
            Number(visuals?.total ?? 0) > 0
              ? null
              : 'The Founder has not uploaded visuals for this campaign yet. They arrive in the Campaign kit on your work surface once the campaign launches.',
        },
        interview: {
          status: booking?.status ?? null,
          available: false,
          unavailableBecause:
            'Proovd records whether the Founder interview happened, and does not keep a recording of it. What came out of it is in the material above.',
        },
      },
      rewards: (preview?.rewards ?? []).map((r) => ({
        title: r.title,
        priceCents: r.priceCents,
        contents: r.contents,
        delivery: r.delivery,
        fulfillment: r.fulfillment,
        limitedQuantity: r.limitedQuantity,
      })),
      threshold: isIdea
        ? {
            label: 'Order threshold',
            value: build?.orderThreshold != null ? String(build.orderThreshold) : null,
            note: 'A number of pre-orders, not an amount of money. Nobody is charged unless the campaign reaches it.',
          }
        : {
            label: 'The Founder’s internal target',
            value: build?.internalTargetCents?.toString() ?? null,
            note: 'The Founder’s own target. It is not a public number, it is not shown on the campaign page, and no charge depends on it.',
          },
      dates: {
        opensAt: preview?.opensAt ?? row.liveAt?.toISOString() ?? null,
        closesAt: preview?.closesAt ?? row.closeAt?.toISOString() ?? null,
        durationDays,
      },
      brandNotes: {
        brandVoice: build?.brandVoice ?? null,
        brandPerception: build?.brandPerception ?? null,
      },
      claims: {
        requiredWording: build?.requiredWording ?? null,
        prohibitedClaims: build?.prohibitedClaims ?? null,
        unconfirmedClaimWarning: UNCONFIRMED_CLAIM_WARNING,
      },
      refundPolicy: {
        applicable: !isIdea,
        title: preview?.founderRefundPolicy?.title ?? null,
        text: preview?.founderRefundPolicy?.text ?? null,
        note: isIdea ? REFUND_POLICY_IDEA_NOTE : REFUND_POLICY_PRODUCT_NOTE,
      },
      deliverables: {
        deliveryWindow: build?.deliveryWindow ?? null,
        obligations: CREATOR_OBLIGATIONS,
      },
      midCampaign: addition
        ? {
            joinedWithHoursRemaining: addition.remainingHours,
            adjustedDeliverables: addition.adjustedDeliverables,
            activationRule: ACTIVATION_RULE,
          }
        : null,
    },
  };
}

/**
 * The whole pitch: the decision facts, unchanged, and §14.1's material beside
 * them.
 *
 * `readFormalOpportunity` is called verbatim — including its §14.5 side effect
 * of recording `reviewing` on first read — because opening a pitch IS the read
 * that records it. The LIST deliberately does not call it: recording every
 * pitch as reviewed because somebody looked at a list of them would be a fact
 * the record did not observe.
 */
export async function readPitch(
  db: Database,
  deps: { appBaseUrl: string },
  input: { associationId: string; affiliateUserId: string; actor: string },
): Promise<{ ok: true; opportunity: FormalOpportunity; content: PitchContent } | Refused> {
  const result = await readFormalOpportunity(db, deps, input);
  if (!('opportunity' in result)) return result;

  const content = await readPitchContent(db, {
    associationId: input.associationId,
    affiliateUserId: input.affiliateUserId,
  });
  if (!content.ok) {
    // Unreachable in practice — the opportunity read applies the same
    // ownership predicate — and answered rather than thrown, because a 500 on
    // a decision surface tells a Creator nothing about whether they can act.
    const refusal: Refused = {
      ok: false,
      code: 'not_found',
      message: 'We could not find that campaign for your account.',
      next: 'Go back to your campaigns. If you think this is wrong, reply to the email we sent you.',
    };
    return refusal;
  }

  return { ok: true, opportunity: result.opportunity, content: content.content };
}
