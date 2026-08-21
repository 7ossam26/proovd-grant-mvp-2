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
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { reviewNotifyDeps } from '../campaign/review-notifications.js';
import { campaigns } from '../db/schema/domain.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  readBuild,
  saveBuild,
  upsertRewardPackage,
  deleteRewardPackage,
  upsertFaq,
  deleteFaq,
  upsertDemoMoment,
  deleteDemoMoment,
  upsertBenefitCard,
  deleteBenefitCard,
  type BuildPatch,
} from '../campaign/service.js';
import { submitForReview, readReviewReadiness, readLatestReview } from '../campaign/review.js';
import { buildCampaignPreview } from '../campaign/preview.js';
import { listPendingReacceptances, decideReacceptance } from '../campaign/materiality.js';
import {
  postUpdate,
  listFounderUpdates,
  serializeUpdate,
  type UpdateAudience,
} from '../campaign/updates.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';

export interface FounderBuildDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  /** Phase 22b: §27.3/§27.6's review messages. Unset → the review still runs
      and the Admin queue still shows it, which is where the work is visible. */
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
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

  /** The one refusal shape the content routes answer with (§1.1's failure state). */
  const contentRefusal = (
    res: express.Response,
    refusal: { code: 'not_editable' | 'invalid_value'; message: string; next: string },
  ) =>
    res.status(refusal.code === 'not_editable' ? 409 : 422).json({
      error: refusal.code,
      whatHappened: refusal.message,
      next: refusal.next,
    });

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
      demoMoments: view.demoMoments.map(serializeDemoMoment),
      benefitCards: view.benefitCards.map(serializeBenefitCard),
      buildStatus: view.buildStatus,
      missing: view.missing,
      campaignStatus: campaign.status,
      // §14.4's type-specific ingredients differ, so the surface has to know
      // which set to render. Named the customer-facing way (§3.1): the internal
      // `pre_build`/`pre_launch` must never reach a Founder.
      model: campaign.campaignType === 'pre_build' ? 'idea' : 'product',
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
        badge: typeof body['badge'] === 'string' ? body['badge'] : null,
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

  router.delete(
    '/api/founder/campaigns/:campaignId/build/rewards/:packageId',
    founder,
    async (req, res) => {
      const campaign = await resolve(req.params['campaignId'] as string, userId(req));
      if (!campaign) return notFound(res);
      const result = await deleteRewardPackage(db, { audit }, {
        campaignId: campaign.campaignId,
        campaignStatus: campaign.status,
        packageId: req.params['packageId'] as string,
        actor: actor(req),
      });
      if (!result.ok) return contentRefusal(res, result);
      res.json({ removed: true });
    },
  );

  /* ── FAQs (§14.4) ───────────────────────────────────────────────────────── */
  //
  // `campaign_faqs` was readable and live-editable from Phase 12b and had no
  // production writer: the §14.4 read shipped and the write never did. The
  // rebuilt page makes the FAQ a full section, and a section a Founder cannot
  // fill is a heading with nothing under it.

  router.put('/api/founder/campaigns/:campaignId/build/faqs', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertFaq(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignStatus: campaign.status,
      ...(typeof body['faqId'] === 'string' ? { faqId: body['faqId'] } : {}),
      faq: {
        question: String(body['question'] ?? ''),
        answer: String(body['answer'] ?? ''),
        sortOrder: typeof body['sortOrder'] === 'number' ? body['sortOrder'] : 0,
      },
      actor: actor(req),
    });
    if (!result.ok) return contentRefusal(res, result);
    res.json({ faq: result.faq });
  });

  router.delete('/api/founder/campaigns/:campaignId/build/faqs/:faqId', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const result = await deleteFaq(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignStatus: campaign.status,
      faqId: req.params['faqId'] as string,
      actor: actor(req),
    });
    if (!result.ok) return contentRefusal(res, result);
    res.json({ removed: true });
  });

  /* ── The demo stage and the benefit cards (campaign page v2) ────────────── */
  //
  // Optional presentation of the Founder's own product. No commercial rule: no
  // price, no date, no threshold, no eligibility. A campaign with no rows
  // renders no section rather than an empty one.

  router.put('/api/founder/campaigns/:campaignId/build/demo-moments', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertDemoMoment(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignStatus: campaign.status,
      ...(typeof body['momentId'] === 'string' ? { momentId: body['momentId'] } : {}),
      moment: {
        timeLabel: String(body['timeLabel'] ?? ''),
        momentLabel: String(body['momentLabel'] ?? ''),
        stateWord: String(body['stateWord'] ?? ''),
        headline: String(body['headline'] ?? ''),
        signalText: typeof body['signalText'] === 'string' ? body['signalText'] : null,
        isAction: body['isAction'] === true,
        actionLabel: typeof body['actionLabel'] === 'string' ? body['actionLabel'] : null,
        // Absent means "append", never 0. `(campaign_id, sort_order)` is
        // UNIQUE, so defaulting here would make the SECOND moment a 23505 the
        // Founder reads as the form having stopped working.
        ...(typeof body['sortOrder'] === 'number' ? { sortOrder: body['sortOrder'] } : {}),
      },
      actor: actor(req),
    });
    if (!result.ok) return contentRefusal(res, result);
    res.json({ moment: serializeDemoMoment(result.moment) });
  });

  router.delete(
    '/api/founder/campaigns/:campaignId/build/demo-moments/:momentId',
    founder,
    async (req, res) => {
      const campaign = await resolve(req.params['campaignId'] as string, userId(req));
      if (!campaign) return notFound(res);
      const result = await deleteDemoMoment(db, { audit }, {
        campaignId: campaign.campaignId,
        campaignStatus: campaign.status,
        momentId: req.params['momentId'] as string,
        actor: actor(req),
      });
      if (!result.ok) return contentRefusal(res, result);
      res.json({ removed: true });
    },
  );

  router.put('/api/founder/campaigns/:campaignId/build/benefit-cards', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertBenefitCard(db, { audit }, {
      campaignId: campaign.campaignId,
      campaignStatus: campaign.status,
      ...(typeof body['cardId'] === 'string' ? { cardId: body['cardId'] } : {}),
      card: {
        title: String(body['title'] ?? ''),
        footerWord: String(body['footerWord'] ?? ''),
        visualVariant: String(body['visualVariant'] ?? ''),
        // Absent means "append" — see the demo moments above.
        ...(typeof body['sortOrder'] === 'number' ? { sortOrder: body['sortOrder'] } : {}),
      },
      actor: actor(req),
    });
    if (!result.ok) return contentRefusal(res, result);
    res.json({ card: serializeBenefitCard(result.card) });
  });

  router.delete(
    '/api/founder/campaigns/:campaignId/build/benefit-cards/:cardId',
    founder,
    async (req, res) => {
      const campaign = await resolve(req.params['campaignId'] as string, userId(req));
      if (!campaign) return notFound(res);
      const result = await deleteBenefitCard(db, { audit }, {
        campaignId: campaign.campaignId,
        campaignStatus: campaign.status,
        cardId: req.params['cardId'] as string,
        actor: actor(req),
      });
      if (!result.ok) return contentRefusal(res, result);
      res.json({ removed: true });
    },
  );

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
    const result = await submitForReview(db, { audit, ...reviewNotifyDeps(deps) }, {
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

  /* ── Updates (§18, Phase 14c) ───────────────────────────────────────────── */

  router.get('/api/founder/campaigns/:campaignId/updates', founder, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const updates = await listFounderUpdates(db, campaign.campaignId);
    res.json({
      updates: updates.map(serializeUpdate),
      canPost: campaign.status === 'live' || campaign.status === 'ended_no_charge',
      campaignStatus: campaign.status,
      model: campaign.campaignType === 'pre_build' ? 'idea' : 'product',
    });
  });

  router.post('/api/founder/campaigns/:campaignId/updates', founder, json, async (req, res) => {
    const campaign = await resolve(req.params['campaignId'] as string, userId(req));
    if (!campaign) return notFound(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const delivery = body['deliveryChange'] as { prior?: unknown; revised?: unknown } | undefined;
    const metric = body['metric'] as { label?: unknown; value?: unknown } | undefined;
    const result = await postUpdate(db, { audit }, {
      campaignId: campaign.campaignId,
      author: actor(req),
      audience: String(body['audience'] ?? '') as UpdateAudience,
      ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
      body: String(body['body'] ?? ''),
      ...(typeof body['imageUrl'] === 'string' ? { imageUrl: body['imageUrl'] } : {}),
      ...(typeof body['videoUrl'] === 'string' ? { videoUrl: body['videoUrl'] } : {}),
      ...(delivery && typeof delivery.prior === 'string' && typeof delivery.revised === 'string'
        ? { deliveryChange: { prior: delivery.prior, revised: delivery.revised } }
        : {}),
      ...(metric && typeof metric.label === 'string' && typeof metric.value === 'string'
        ? { metric: { label: metric.label, value: metric.value } }
        : {}),
    });
    if (result.status !== 'posted') {
      res.status(result.status === 'not_found' ? 404 : 422).json({
        error: result.status,
        whatHappened: 'message' in result ? result.message : 'That update could not be posted.',
      });
      return;
    }
    res.status(201).json({ update: serializeUpdate(result.update) });
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
    // The rebuilt campaign page's own copy (0049). A column added to Drizzle
    // and to `BuildPatch` but not to this list is one the Founder can write and
    // never read back — the box empties on every reload.
    heroHeadline: build.heroHeadline,
    heroHeadlineAccent: build.heroHeadlineAccent,
    heroSubheadline: build.heroSubheadline,
    founderPullQuote: build.founderPullQuote,
    platformLine: build.platformLine,
    demoContextLabel: build.demoContextLabel,
    benefitsHeading: build.benefitsHeading,
    rewardsHeading: build.rewardsHeading,
    updatesHeading: build.updatesHeading,
    faqHeading: build.faqHeading,
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
    badge: reward.badge,
    sortOrder: reward.sortOrder,
  };
}

function serializeDemoMoment(moment: import('../db/schema/build.js').CampaignDemoMoment) {
  return {
    id: moment.id,
    timeLabel: moment.timeLabel,
    momentLabel: moment.momentLabel,
    stateWord: moment.stateWord,
    headline: moment.headline,
    signalText: moment.signalText,
    isAction: moment.isAction,
    actionLabel: moment.actionLabel,
    sortOrder: moment.sortOrder,
  };
}

function serializeBenefitCard(card: import('../db/schema/build.js').CampaignBenefitCard) {
  return {
    id: card.id,
    title: card.title,
    footerWord: card.footerWord,
    visualVariant: card.visualVariant,
    sortOrder: card.sortOrder,
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
