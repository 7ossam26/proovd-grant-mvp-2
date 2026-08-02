/**
 * The Founder's campaign build, review submission, and preview — Spec §14.4,
 * §15, §33.3.10, §33.4.
 *
 * Mounted under `/api/founder` beside the Phase 09a workspace routes and behind
 * the same guard. Every route resolves the campaign through the caller's own
 * claim profile inside the query; another Founder's campaign answers 404.
 *
 * The build runs in parallel with the §14 formal decisions (§14.4), so these
 * routes and the roster routes (12a) operate on the same campaign at the same
 * time — that parallelism is the phase's defining structure.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import { campaigns } from '../db/schema/domain.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { readBuild, saveBuild, upsertRewardPackage, type BuildPatch } from '../campaign/service.js';
import { submitForReview, readReviewReadiness, readLatestReview } from '../campaign/review.js';
import { buildCampaignPreview } from '../campaign/preview.js';
import { listPendingReacceptances, decideReacceptance } from '../campaign/materiality.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';

export interface FounderBuildDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

interface FounderCampaign {
  campaignId: string;
  campaignType: 'pre_build' | 'pre_launch';
  status: string;
}

export function createFounderBuildRouter(deps: FounderBuildDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '128kb' });

  const userId = (req: express.Request): string => req.authUser?.id ?? '';
  const actor = (req: express.Request): string => `founder:${userId(req)}`;

  /** The caller's own campaign, with its type — 404s another Founder's. */
  async function resolve(campaignId: string, founderUserId: string): Promise<FounderCampaign | null> {
    const [row] = await db
      .select({ campaignId: campaigns.id, type: campaigns.type, status: campaigns.status })
      .from(campaigns)
      .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(founderClaimProfiles.claimedUserId, founderUserId),
          isNull(campaigns.archivedAt),
        ),
      )
      .limit(1);
    if (!row || !row.type) return null;
    return { campaignId: row.campaignId, campaignType: row.type, status: row.status };
  }

  const notFound = (res: express.Response) =>
    res.status(404).json({ error: 'not_found', whatHappened: 'That campaign could not be found.' });

  /* ── The build (§14.4) ──────────────────────────────────────────────────── */

  router.get('/api/founder/campaigns/:campaignId/build', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const view = await readBuild(db, campaign);
    const readiness = await readReviewReadiness(db, campaign);
    res.json({
      build: serializeBuild(view.build),
      rewardPackages: view.rewardPackages.map(serializeReward),
      faqs: view.faqs,
      buildStatus: view.buildStatus,
      missing: view.missing,
      campaignStatus: campaign.status,
      reviewReadiness: readiness,
    });
  });

  router.patch('/api/founder/campaigns/:campaignId/build', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const result = await saveBuild(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignType: campaign.campaignType,
      campaignStatus: campaign.status,
      patch: (req.body ?? {}) as BuildPatch,
      actor: actor(req),
    });
    if (!result.ok) {
      res.status(result.code === 'not_editable' ? 409 : 422).json({
        error: result.code,
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({
      buildStatus: result.buildStatus,
      missing: result.view.missing,
      build: serializeBuild(result.view.build),
    });
  });

  router.put('/api/founder/campaigns/:campaignId/build/rewards', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertRewardPackage(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignStatus: campaign.status,
      ...(typeof body['packageId'] === 'string' ? { packageId: body['packageId'] } : {}),
      reward: {
        sku: String(body['sku'] ?? ''),
        title: String(body['title'] ?? ''),
        priceCents: String(body['priceCents'] ?? ''),
        contents: String(body['contents'] ?? ''),
        fulfillmentCommitment: String(body['fulfillmentCommitment'] ?? ''),
        delivery: String(body['delivery'] ?? ''),
        limitedQuantity:
          typeof body['limitedQuantity'] === 'number' ? body['limitedQuantity'] : null,
        sortOrder: typeof body['sortOrder'] === 'number' ? body['sortOrder'] : 0,
      },
      actor: actor(req),
    });
    if (!result.ok) {
      res.status(result.code === 'not_editable' ? 409 : 422).json({
        error: result.code,
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }
    res.json({ package: serializeReward(result.package) });
  });

  /* ── Preview (§15) — collects no payment information ─────────────────────── */

  router.get('/api/founder/campaigns/:campaignId/preview', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const preview = await buildCampaignPreview(db, campaign);
    res.json({ preview });
  });

  /* ── Submission (§15) ───────────────────────────────────────────────────── */

  router.post('/api/founder/campaigns/:campaignId/submit', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const result = await submitForReview(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignType: campaign.campaignType,
      campaignStatus: campaign.status,
      actor: actor(req),
    });
    if (!result.ok) {
      res.status(result.code === 'not_ready' ? 409 : 409).json({
        error: result.code,
        whatHappened: result.message,
        next: result.next,
        ...(result.readiness ? { reviewReadiness: result.readiness } : {}),
      });
      return;
    }
    res.json({ review: { id: result.review.id, round: result.review.round, status: result.review.outcome } });
  });

  /* ── The latest review's feedback, for the changes surface (§33.4.1) ────── */

  router.get('/api/founder/campaigns/:campaignId/review', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const latest = await readLatestReview(db, campaign.campaignId);
    if (!latest) {
      res.json({ review: null });
      return;
    }
    res.json({
      review: {
        round: latest.review.round,
        outcome: latest.review.outcome,
        reviewer: latest.review.reviewer,
        nextUpdateExpectation: latest.review.nextUpdateExpectation,
        submittedAt: latest.review.submittedAt.toISOString(),
        decidedAt: latest.review.decidedAt?.toISOString() ?? null,
        // §15/§33.4.1: grouped, deep-linked feedback with owner and due.
        required: latest.feedback
          .filter((f) => f.feedbackGroup === 'required')
          .map(serializeFeedback),
        optional: latest.feedback
          .filter((f) => f.feedbackGroup === 'optional')
          .map(serializeFeedback),
      },
    });
  });

  return router;
}

/* ── The Creator's reacceptance route (§15) ────────────────────────────────── */

export function createCreatorReacceptanceRouter(deps: FounderBuildDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const creator = requireRole(auth, 'affiliate');
  const json: RequestHandler = express.json({ limit: '16kb' });
  const userId = (req: express.Request): string => req.authUser?.id ?? '';

  /** The caller's own association, or null (scoped in the query, §5.5). */
  async function ownAssociation(associationId: string, affiliateUserId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: campaignAffiliateAssociations.id })
      .from(campaignAffiliateAssociations)
      .innerJoin(
        affiliateSignupProfiles,
        eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
      )
      .where(
        and(
          eq(campaignAffiliateAssociations.id, associationId),
          eq(affiliateSignupProfiles.claimedUserId, affiliateUserId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  router.get('/api/creator/campaigns/:associationId/reacceptances', creator, async (req, res) => {
    const associationId = req.params['associationId'] as string;
    if (!(await ownAssociation(associationId, userId(req)))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const tasks = await listPendingReacceptances(db, associationId);
    res.json({
      reacceptances: tasks.map((t) => ({
        id: t.id,
        newVersion: t.newVersion,
        changedFields: t.changedFields,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  router.post(
    '/api/creator/reacceptances/:reacceptanceId/respond',
    creator,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decision = body['decision'];
      if (decision !== 'accepted' && decision !== 'declined') {
        res.status(422).json({ error: 'invalid_decision' });
        return;
      }
      // Resolve the task's association and check ownership.
      const { materialChangeReacceptances } = await import('../db/schema/build.js');
      const [task] = await db
        .select({ associationId: materialChangeReacceptances.associationId })
        .from(materialChangeReacceptances)
        .where(eq(materialChangeReacceptances.id, req.params['reacceptanceId'] as string))
        .limit(1);
      if (!task || !(await ownAssociation(task.associationId, userId(req)))) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const result = await decideReacceptance(db, { audit }, {
        reacceptanceId: req.params['reacceptanceId'] as string,
        associationId: task.associationId,
        decision,
        actor: `affiliate:${userId(req)}`,
      });
      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 409).json({
          error: result.code,
          whatHappened: result.message,
        });
        return;
      }
      res.json({ reacceptance: { decision: result.decision } });
    },
  );

  return router;
}

/* ── Serialization (bigints and Dates to the wire) ─────────────────────────── */

function serializeBuild(build: import('../db/schema/build.js').CampaignBuild | null) {
  if (!build) return null;
  return {
    title: build.title,
    founderDisplayName: build.founderDisplayName,
    founderEntityDisplay: build.founderEntityDisplay,
    founderCountry: build.founderCountry,
    founderProfileUrl: build.founderProfileUrl,
    opensAt: build.opensAt?.toISOString() ?? null,
    closesAt: build.closesAt?.toISOString() ?? null,
    orderThreshold: build.orderThreshold,
    internalTargetCents: build.internalTargetCents?.toString() ?? null,
    brandPerception: build.brandPerception,
    brandVoice: build.brandVoice,
    requiredWording: build.requiredWording,
    prohibitedClaims: build.prohibitedClaims,
    communityUrl: build.communityUrl,
    heroPreference: build.heroPreference,
    publicStory: build.publicStory,
    deliveryWindow: build.deliveryWindow,
    earlyProductDisclaimer: build.earlyProductDisclaimer,
    risksAndChallenges: build.risksAndChallenges,
    refundPolicyText: build.refundPolicyText,
    refundPolicyTitle: build.refundPolicyTitle,
    refundPolicySourceUrl: build.refundPolicySourceUrl,
    refundPolicyVersion: build.refundPolicyVersion,
    refundPolicyEffectiveDate: build.refundPolicyEffectiveDate,
  };
}

function serializeReward(reward: import('../db/schema/build.js').CampaignRewardPackage) {
  return {
    id: reward.id,
    sku: reward.sku,
    title: reward.title,
    priceCents: reward.priceCents.toString(),
    contents: reward.contents,
    fulfillmentCommitment: reward.fulfillmentCommitment,
    delivery: reward.delivery,
    limitedQuantity: reward.limitedQuantity,
    sortOrder: reward.sortOrder,
  };
}

function serializeFeedback(item: import('../db/schema/build.js').ReviewFeedbackItem) {
  return {
    area: item.area,
    body: item.body,
    deepLink: item.deepLink,
    owner: item.owner,
    dueExpectation: item.dueExpectation,
    enforcementInvolved: item.enforcementInvolved,
  };
}
