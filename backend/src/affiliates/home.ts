/**
 * The Creator's home — Creator Flow v2 **deviation 5**, Session D, 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * §26 makes the Admin panel the only dashboard-style product in MVP, and the
 * Spec gives the Creator no home. What is built is §20's rules for the Founder
 * campaign home applied by analogy, and the analogy is load-bearing rather than
 * decorative — every rule below is one §20 states and one this read obeys.
 *
 * ── One thing waiting, or the caught-up ending ────────────────────────────
 * §20's Act, in the Creator's vocabulary: the pitches count is what is waiting,
 * and when it is zero the surface renders `CREATOR_HOME_CAUGHT_UP` with **no
 * control at all**. There is no second candidate ranked behind it and nothing
 * that produces an Act from a date, a duration, or an absence — every number
 * here comes from a row.
 *
 * ── No counters table ────────────────────────────────────────────────────
 * §20's counts compose from `reservation_status_history` and store nothing;
 * these compose from the association states and `proposal_versions`. A stored
 * pitch counter is a number that can be wrong while the rows are right, and the
 * person reading it would act on the wrong one.
 *
 * ── This module writes ONE thing, and it is not a counter ─────────────────
 * `ensureStandingSnapshot`, which appends a row only when a record it counts
 * has actually moved. Everything else here is a read.
 *
 * ── What is deliberately not in the payload ──────────────────────────────
 * A notification count. 22c's history has none by design — no count field, no
 * read state, no `unread` column — and a badge here would be the first of the
 * four things that turn it into a dashboard. `CREATOR_APP_ABSENCES` records it
 * and the suite asserts the payload's own keys.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { proposalVersions } from '../db/schema/decisions.js';
import { workAgainRequests } from '../db/schema/completion.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { reservations } from '../db/schema/domain.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import {
  ensureStandingSnapshot,
  readStandingLeaders,
  type StandingInputs,
  type StandingLeaderRow,
} from './standing.js';
import { PITCH_DECISION_OPEN_STATES, pitchKindFor } from './creator-pitches.js';
import { listCreatorReferrals } from './referrals.js';
import { STANDING_COHORT_MINIMUM } from '../creator-flow/logic.js';

/**
 * The association states in which the Creator owes a decision.
 *
 * `formal_decision_open` and `reviewing` are §14.1's opportunity before either
 * side has proposed anything; `proposal_pending` is a live negotiation, and it
 * counts only when the open version is `awaiting_creator` — a version waiting
 * on the FOUNDER is not something the Creator can act on, and counting it would
 * put a number on the hero that no control can reduce.
 */
/*
 * Session E moved this to `creator-pitches.ts` and imports it back, so §20's
 * hero count here and the Pitches tab's count there read one derivation. A copy
 * would have been two answers to "what is waiting for me", on two surfaces one
 * tap apart.
 */
const DECISION_OPEN_STATES = PITCH_DECISION_OPEN_STATES;

export interface CreatorHomePitch {
  associationId: string;
  campaignId: string;
  productName: string | null;
  /** `opportunity` (nothing proposed yet) or `proposal` (their turn to answer). */
  kind: 'opportunity' | 'proposal';
}

export interface CreatorHomeWorkAgain {
  requestId: string;
  associationId: string;
  productName: string | null;
  message: string;
  requestedAt: Date;
}

export interface CreatorHomeStanding {
  score: number;
  tier: string;
  percentile: number | null;
  inputs: StandingInputs;
  computedAt: Date;
}

export interface CreatorHomeTrackRecord {
  launched: number;
  verified: number;
  /** Pre-tax reward subtotal of captured, validly attributed pre-orders, in cents. */
  backedCents: bigint;
}

export interface CreatorHome {
  firstName: string | null;
  pitches: CreatorHomePitch[];
  standing: CreatorHomeStanding | null;
  /** Absent while the cohort is short — never a percentile computed anyway. */
  leaders: StandingLeaderRow[];
  cohortMinimum: number;
  trackRecord: CreatorHomeTrackRecord;
  workAgain: CreatorHomeWorkAgain[];
  referrals: Awaited<ReturnType<typeof listCreatorReferrals>>;
}

/**
 * The §8 prospect id behind a session. The account identity is a different id.
 *
 * Exported because the referral route needs the same answer, and a second
 * lookup written beside this one is a second chance to key off `affiliate_id`
 * by mistake — four `owns` helpers already re-implement this join and a fifth
 * is not what Session D adds.
 */
export async function creatorProspectId(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ affiliateId: campaignAffiliateAssociations.affiliateId })
    .from(affiliateSignupProfiles)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, affiliateSignupProfiles.associationId),
    )
    .where(eq(affiliateSignupProfiles.claimedUserId, userId))
    .limit(1);
  return row?.affiliateId ?? null;
}

/**
 * Everything Home renders, for one signed-in Creator.
 *
 * Scoped by the session throughout: the prospect id is resolved from the
 * caller's own claimed profile and every query filters on it. There is no id in
 * the request at all, which is `creator.ts`'s own rule and the reason nothing
 * here can be enumerated.
 *
 * **`affiliate_id` on an association is the §8 PROSPECT id, not an account id.**
 * That confusion is the one mistake in this area that moves money to a UUID
 * nobody owns, and it is why the lookup goes through `affiliate_signup_profiles`
 * rather than treating the session's user id as the affiliate.
 */
export async function readCreatorHome(db: Database, userId: string): Promise<CreatorHome> {
  const prospectId = await creatorProspectId(db, userId);

  const empty: CreatorHome = {
    firstName: null,
    pitches: [],
    standing: null,
    leaders: [],
    cohortMinimum: STANDING_COHORT_MINIMUM,
    trackRecord: { launched: 0, verified: 0, backedCents: 0n },
    workAgain: [],
    referrals: [],
  };
  if (!prospectId) return empty;

  const [prospect] = await db
    .select({ legalName: affiliateProspects.legalName, handle: affiliateProspects.publicHandle })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, prospectId))
    .limit(1);

  // Every association this person holds, with the campaign's product name.
  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      status: campaignAffiliateAssociations.status,
      productName: founderProspects.productName,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      campaignDrafts,
      eq(campaignDrafts.campaignId, campaignAffiliateAssociations.campaignId),
    )
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignAffiliateAssociations.affiliateId, prospectId));

  const ids = associations.map((a) => a.associationId);

  // §14.2's open versions awaiting THIS side. A version awaiting the Founder is
  // not a pitch the Creator can act on.
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

  const pitches: CreatorHomePitch[] = associations
    .filter(
      (a) =>
        (DECISION_OPEN_STATES as readonly string[]).includes(a.status) ||
        awaitingIds.has(a.associationId),
    )
    .map((a) => ({
      associationId: a.associationId,
      campaignId: a.campaignId,
      productName: a.productName,
      kind: pitchKindFor(awaitingIds.has(a.associationId)),
    }));

  // §22.9's asks that are still open. The Founder's, always — nothing on this
  // surface starts one, and there is no route here that could.
  const workAgainRows =
    ids.length > 0
      ? await db
          .select({
            requestId: workAgainRequests.id,
            associationId: workAgainRequests.associationId,
            message: workAgainRequests.message,
            requestedAt: workAgainRequests.requestedAt,
          })
          .from(workAgainRequests)
          .where(
            and(
              inArray(workAgainRequests.associationId, ids),
              eq(workAgainRequests.status, 'requested'),
            ),
          )
          .orderBy(desc(workAgainRequests.requestedAt))
      : [];
  const productOf = new Map(associations.map((a) => [a.associationId, a.productName]));

  const standing = await ensureStandingSnapshot(db, prospectId);
  const leaders = await readStandingLeaders(db, prospectId);

  return {
    // The greeting takes the first word of the recorded legal name, and falls
    // back to the public handle rather than to an email local part — an address
    // is not a name, and §18's comment thread refuses exactly that substitution.
    firstName: (prospect?.legalName ?? '').trim().split(/\s+/)[0] || prospect?.handle || null,
    pitches,
    standing,
    // A leaderboard of three is a sentence about two strangers. The cohort gate
    // is the same one the percentile uses, so the two can never disagree about
    // whether there is a cohort.
    leaders: leaders.length >= STANDING_COHORT_MINIMUM ? leaders : [],
    cohortMinimum: STANDING_COHORT_MINIMUM,
    trackRecord: await readTrackRecord(db, prospectId, ids),
    workAgain: workAgainRows.map((row) => ({
      ...row,
      productName: productOf.get(row.associationId) ?? null,
    })),
    referrals: await listCreatorReferrals(db, prospectId),
  };
}

/**
 * The three track-record counts.
 *
 * `Backed` is the pre-tax reward subtotal of captured, validly attributed
 * pre-orders — §24.3 keeps sales tax out of every Creator-facing figure, and
 * `attribution_status = 'verified'` is the same filter §22.1's finalization
 * uses, so the number here and the number a commission is computed from count
 * the same rows. It is deliberately labelled as what people bought rather than
 * as what the Creator earned; those are different numbers and only one of them
 * is on this surface.
 *
 * The reference's third count is `Hits`, which is refused — see
 * `CREATOR_APP_ABSENCES`.
 */
async function readTrackRecord(
  db: Database,
  prospectId: string,
  associationIds: string[],
): Promise<CreatorHomeTrackRecord> {
  const launched = await db
    .select({ id: campaignAffiliateAssociations.id })
    .from(campaignAffiliateAssociations)
    .where(
      and(
        eq(campaignAffiliateAssociations.affiliateId, prospectId),
        eq(campaignAffiliateAssociations.status, 'successfully_completed'),
      ),
    );

  const verified =
    associationIds.length > 0
      ? await db
          .select({ id: creatorPostSubmissions.id })
          .from(creatorPostSubmissions)
          .where(
            and(
              inArray(creatorPostSubmissions.associationId, associationIds),
              eq(creatorPostSubmissions.status, 'passed'),
            ),
          )
      : [];

  const backedRows =
    associationIds.length > 0
      ? await db
          .select({ subtotal: reservations.rewardSubtotalCents })
          .from(reservations)
          .where(
            and(
              inArray(reservations.attributionAssociationId, associationIds),
              eq(reservations.attributionStatus, 'verified'),
              // The ever-captured set, exactly as §22.1's finalization reads it:
              // `refunded`, `reversed` and `disputed` are all reachable FROM
              // `captured`, and dropping them would make this number fall when
              // a Backer disputed rather than when nothing was bought.
              inArray(sql`${reservations.status}::text`, [
                'captured',
                'refunded',
                'reversed',
                'disputed',
              ]),
            ),
          )
      : [];

  return {
    launched: launched.length,
    verified: verified.length,
    backedCents: backedRows.reduce((total, row) => total + (row.subtotal ?? 0n), 0n),
  };
}
