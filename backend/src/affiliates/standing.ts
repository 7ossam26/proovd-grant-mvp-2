/**
 * The Creator standing snapshot — Creator Flow v2 **deviation 2**, Session D,
 * 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * The full reasoning is in `shared/src/creator-flow/standing.ts` and in
 * migration 0055 section 4. What this file owns is the derivation, and there
 * are three things about it worth stating where somebody editing it will read
 * them.
 *
 * ── The tier binds nothing, and a source scan is what enforces it ──────────
 * Nothing under `affiliates/decisions.ts`, `campaign/readiness.ts`,
 * `creator-payment/`, `close/earnings.ts` or `close/founder-payments.ts`
 * imports this module, and `creator-flow-d.test.ts` scans each of them by name.
 * (The brief says `affiliates/readiness.ts`; §15's roster readiness is at
 * `campaign/readiness.ts` and §16's at `creator-payment/readiness.ts`, so the
 * scan names both — a register naming a module that does not exist would pass
 * by finding nothing.) A later phase
 * reaching here for a compensation, readiness, or eligibility input has taken a
 * wrong turn — there is no rate, floor, percentage, or multiplier to find.
 *
 * ── Every input is a count of records, and there are exactly four ──────────
 * `CREATOR_STANDING_INPUTS` names them and what each is counted from. Three
 * plausible fifths are refused in the register with their own reasons: sales
 * volume (§22.8 keeps revenue out of completion and §33.10.6 asserts that
 * absence), response speed to an opportunity (§14.2 says declining carries no
 * penalty), and the §8 internal quality tier (an Admin's judgement, not a
 * record of what somebody did).
 *
 * ── It is a snapshot, and a change is a NEW row ────────────────────────────
 * 21b's completion-findings reasoning applied to the number a Creator reads
 * hardest: a live recomputation silently rewrites its own justification the
 * next time a record moves, and the person reading it would have no way to know
 * it had. So the score, the percentile and the counts that produced them are
 * stored together, and `ensureStandingSnapshot` writes a row only when the
 * derived counts DIFFER from the latest stored ones.
 *
 * That write happens on a read, which is deliberate and has precedent:
 * `readPreparingKit` writes its §31.5 access row in the same call that returns
 * the content, and §20's `readGlance` issues its delivery receipt. What makes
 * it safe here is that the write is caused by a RECORD having moved and never
 * by time passing — there is no clock in this file, no sweep, and no job. A
 * Creator who reloads a hundred times gets one row.
 */

import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { affiliateStandingSnapshots } from '../db/schema/creator-flow.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateEvidenceVerifications } from '../db/schema/creator-workspace.js';
import { affiliateEnforcementActions } from '../db/schema/enforcement.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import {
  STANDING_INPUT_IDS,
  standingPercentile,
  standingScore,
  standingTier,
} from '../creator-flow/logic.js';

export interface StandingInputs {
  campaigns_completed: number;
  posts_verified: number;
  obligations_met: number;
  evidence_verified: number;
}

export interface StandingSnapshot {
  score: number;
  tier: string;
  percentile: number | null;
  inputs: StandingInputs;
  computedAt: Date;
}

/**
 * The four counts, each from the record `CREATOR_STANDING_INPUTS` names.
 *
 * `obligations_met` is the one that reads oddly and is right: it is the count
 * of ENDED partnerships with no §29 action recorded against them, which is the
 * absence of something rather than the presence of anything. Counting the
 * absence needs the completed set as its universe, so a Creator with no history
 * scores zero on it rather than scoring full marks for never having worked.
 */
export async function gatherStandingInputs(
  db: Database,
  prospectId: string,
): Promise<StandingInputs> {
  const [completed] = await db
    .select({ n: count() })
    .from(campaignAffiliateAssociations)
    .where(
      and(
        eq(campaignAffiliateAssociations.affiliateId, prospectId),
        eq(campaignAffiliateAssociations.status, 'successfully_completed'),
      ),
    );

  const [posts] = await db
    .select({ n: count() })
    .from(creatorPostSubmissions)
    .innerJoin(
      campaignAffiliateAssociations,
      eq(campaignAffiliateAssociations.id, creatorPostSubmissions.associationId),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.affiliateId, prospectId),
        eq(creatorPostSubmissions.status, 'passed'),
      ),
    );

  // Completed partnerships with no enforcement row of their own. A LEFT JOIN
  // and `IS NULL` rather than a NOT IN, so a Creator with no associations at
  // all counts zero rather than matching an empty subquery.
  const [clean] = await db
    .select({ n: count() })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateEnforcementActions,
      eq(affiliateEnforcementActions.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.affiliateId, prospectId),
        eq(campaignAffiliateAssociations.status, 'successfully_completed'),
        isNull(affiliateEnforcementActions.id),
      ),
    );

  // Distinct METRICS an Admin verified, and the word matters: 0048 pins this
  // column to the five §5.3 evidence metrics rather than to a channel. A metric
  // re-verified after a correction is one signal, not two.
  const [channels] = await db
    .select({ n: sql<number>`count(distinct ${affiliateEvidenceVerifications.metric})` })
    .from(affiliateEvidenceVerifications)
    .where(
      and(
        eq(affiliateEvidenceVerifications.prospectId, prospectId),
        eq(affiliateEvidenceVerifications.decision, 'verified'),
      ),
    );

  return {
    campaigns_completed: Number(completed?.n ?? 0),
    posts_verified: Number(posts?.n ?? 0),
    obligations_met: Number(clean?.n ?? 0),
    evidence_verified: Number(channels?.n ?? 0),
  };
}

/** The latest stored snapshot for one Creator, or null when there is none. */
export async function readLatestStanding(
  db: Database,
  prospectId: string,
): Promise<StandingSnapshot | null> {
  const [row] = await db
    .select()
    .from(affiliateStandingSnapshots)
    .where(eq(affiliateStandingSnapshots.prospectId, prospectId))
    .orderBy(desc(affiliateStandingSnapshots.computedAt))
    .limit(1);
  if (!row) return null;
  return {
    score: row.score,
    tier: row.tier,
    percentile: row.percentile,
    inputs: row.inputs as StandingInputs,
    computedAt: row.computedAt,
  };
}

/** The latest score of every Creator who has one. The percentile's cohort. */
async function cohortScores(db: Database): Promise<number[]> {
  const rows = await db
    .select({
      prospectId: affiliateStandingSnapshots.prospectId,
      score: affiliateStandingSnapshots.score,
      computedAt: affiliateStandingSnapshots.computedAt,
    })
    .from(affiliateStandingSnapshots)
    .orderBy(desc(affiliateStandingSnapshots.computedAt));
  const latest = new Map<string, number>();
  for (const row of rows) if (!latest.has(row.prospectId)) latest.set(row.prospectId, row.score);
  return [...latest.values()];
}

function sameInputs(a: StandingInputs, b: StandingInputs): boolean {
  return STANDING_INPUT_IDS.every(
    (id) =>
      (a as unknown as Record<string, number>)[id] ===
      (b as unknown as Record<string, number>)[id],
  );
}

/**
 * The snapshot a surface renders. Written only when a record actually moved.
 *
 * **A Creator with no completed campaign gets no snapshot at all**, and that is
 * §16a rather than an optimisation: a stored zero would render as a score of
 * zero and a `Starting out` tier, which reads as a judgement about somebody who
 * has simply not started. `STANDING_NOT_ENOUGH_HISTORY` is what renders in its
 * place, and it is a different sentence because it is a different fact.
 *
 * The percentile is recomputed on each new row rather than backfilled onto
 * older ones — a percentile is a position in a cohort at a moment, and moving
 * an old one because the cohort grew would rewrite what somebody was told.
 */
export async function ensureStandingSnapshot(
  db: Database,
  prospectId: string,
): Promise<StandingSnapshot | null> {
  const inputs = await gatherStandingInputs(db, prospectId);
  const latest = await readLatestStanding(db, prospectId);

  if (inputs.campaigns_completed === 0) return latest;
  if (latest && sameInputs(latest.inputs, inputs)) return latest;

  const score = standingScore(inputs as unknown as Record<string, number>);
  const percentile = standingPercentile(score, await cohortScores(db));
  const [written] = await db
    .insert(affiliateStandingSnapshots)
    .values({ prospectId, score, tier: standingTier(score), percentile, inputs })
    .returning();

  return written
    ? {
        score: written.score,
        tier: written.tier,
        percentile: written.percentile,
        inputs: written.inputs as StandingInputs,
        computedAt: written.computedAt,
      }
    : latest;
}

export interface StandingLeaderRow {
  /** §11's boundary, restated Creator→Creator: a public handle and nothing else. */
  handle: string;
  score: number;
  tier: string;
  isYou: boolean;
}

/**
 * The leaderboard: public handles and standing, and nothing about money.
 *
 * §11 draws a Founder→Creator boundary and the Spec has no Creator→Creator
 * twin, so this brief states one — a Creator sees of another Creator exactly
 * what a Founder sees of them. The query selects `public_handle` and `score`
 * and there is no earnings, campaign, legal-name, or email column in it to
 * forget to filter out, which is the same enforcement `listFounderVisibleRoster`
 * uses: the columns are not in the projection.
 *
 * It renders at all only once the cohort exists — a ranking of three people is
 * a sentence about two strangers, and `STANDING_NOT_ENOUGH_HISTORY`'s sibling
 * is what a smaller cohort gets.
 */
export async function readStandingLeaders(
  db: Database,
  prospectId: string,
  limit = 5,
): Promise<StandingLeaderRow[]> {
  const rows = await db
    .select({
      prospectId: affiliateStandingSnapshots.prospectId,
      score: affiliateStandingSnapshots.score,
      tier: affiliateStandingSnapshots.tier,
      computedAt: affiliateStandingSnapshots.computedAt,
      handle: affiliateProspects.publicHandle,
    })
    .from(affiliateStandingSnapshots)
    .innerJoin(
      affiliateProspects,
      eq(affiliateProspects.id, affiliateStandingSnapshots.prospectId),
    )
    .orderBy(desc(affiliateStandingSnapshots.computedAt));

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.prospectId)) latest.set(row.prospectId, row);

  return [...latest.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({
      // A Creator with no recorded handle is not named. There is no fallback to
      // a legal name or an email — both are exactly what this projection is for
      // keeping out (§11, §25.7).
      handle: row.handle ?? 'A Creator',
      score: row.score,
      tier: row.tier,
      isYou: row.prospectId === prospectId,
    }));
}
