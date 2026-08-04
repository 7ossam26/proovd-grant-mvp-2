/**
 * Live editing, comments, and mid-campaign Creators — Spec §20, §18 (Phase 17b).
 *
 * Three routers, because they are three different actors with three different
 * authentication mechanisms and mixing them into one file is how a Backer route
 * ends up behind an Admin guard:
 *
 *   `createFounderLiveEditRouter`  session, `founder`. One edit route, and the
 *                                  tier register decides what it does.
 *   `createBackerCommentRouter`    magic-link token, no account (§5.4, §28.1).
 *   `createAdminLiveOpsRouter`     session, `admin`, freshness gate on writes.
 *
 * ── There is exactly one Founder edit route ─────────────────────────────────
 * Not one per tier. A route per tier would let a caller choose which rules apply
 * to their edit by choosing a URL, which is the whole thing §20's three columns
 * exist to prevent. The Founder says which field and what value; `applyLiveEdit`
 * looks the field up and decides.
 */

import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import { requireRole, requireAdmin, requireFreshSession } from '../auth/guards.js';
import { requireMagicLinkToken } from '../auth/token-middleware.js';
import { MAGIC_LINK_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import type { AuditWriter } from '../auth/audit.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { findFounderCampaign } from '../workspace/service.js';
import {
  applyLiveEdit,
  decideChangeRequest,
  listChangeRequests,
  listLiveEdits,
} from '../campaign/live-editing.js';
import { EDITABLE_FIELDS, EDIT_SURFACES, type EditSurface } from '../campaign/editing-logic.js';
import {
  postComment,
  readCommentThread,
  flagComment,
  decideFlag,
  listOpenFlags,
} from '../campaign/comments.js';
import {
  readMidCampaignTerms,
  openMidCampaignAddition,
  activateMidCampaignCreator,
} from '../affiliates/mid-campaign.js';

function notFound(res: express.Response): void {
  res.status(404).json({
    error: 'not_found',
    title: 'Not found',
    whatHappened: 'We could not find that on your account.',
    next: 'Go back and try again. If you think this is wrong, contact support.',
    support: '/support',
  });
}

/* ── The Founder's one edit route ──────────────────────────────────────────── */

export interface FounderLiveEditDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

export function createFounderLiveEditRouter(deps: FounderLiveEditDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json = express.json({ limit: '256kb' });
  const base = '/api/founder/campaigns/:campaignId';

  async function resolve(req: express.Request, res: express.Response): Promise<string | null> {
    const campaign = await findFounderCampaign(db, {
      campaignId: String(req.params['campaignId'] ?? ''),
      founderUserId: req.authUser?.id ?? '',
    });
    if (!campaign) {
      notFound(res);
      return null;
    }
    return campaign.campaignId;
  }

  /** The register itself, so the surface can label each field with its tier. */
  router.get(`${base}/live-edit/fields`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;
    res.json({ fields: EDITABLE_FIELDS });
  });

  router.post(`${base}/live-edit`, founder, json, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const body = req.body as Record<string, unknown>;
    const surface = String(body['surface'] ?? '');
    if (!(EDIT_SURFACES as readonly string[]).includes(surface)) {
      res.status(422).json({
        error: 'unknown_surface',
        title: 'That is not something we can edit',
        whatHappened: 'An edit names the part of the campaign it is changing.',
        next: 'Reload the page and try again.',
      });
      return;
    }

    const campaign = await findFounderCampaign(db, {
      campaignId,
      founderUserId: req.authUser?.id ?? '',
    });

    const outcome = await applyLiveEdit(
      db,
      { audit },
      {
        campaignId,
        campaignStatus: campaign?.status ?? '',
        surface: surface as EditSurface,
        field: String(body['field'] ?? ''),
        value: body['value'] ?? null,
        ...(typeof body['targetId'] === 'string' ? { targetId: body['targetId'] } : {}),
        ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
        actor: `user:${req.authUser?.id ?? ''}`,
      },
    );

    if (!outcome.ok) {
      const status =
        outcome.code === 'never_direct'
          ? 409
          : outcome.code === 'not_found'
            ? 404
            : outcome.code === 'request_open'
              ? 409
              : 422;
      res.status(status).json({
        error: outcome.code,
        title:
          outcome.code === 'never_direct'
            ? 'That cannot be changed while the campaign is running'
            : 'That change was not applied',
        whatHappened: outcome.message,
        next: outcome.next,
        support: '/support',
      });
      return;
    }

    res.status(outcome.tier === 'direct_versioned' ? 200 : 202).json(outcome);
  });

  /** §20: "with version history." The Founder can read their own. */
  router.get(`${base}/live-edit/history`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;
    res.json({
      edits: await listLiveEdits(db, campaignId),
      requests: await listChangeRequests(db, { campaignId }),
    });
  });

  return router;
}

/* ── The Backer's comment thread (§18) ─────────────────────────────────────── */

export interface BackerCommentDeps {
  db: Database;
  tokens: TokenService;
  audit: AuditWriter;
}

export function createBackerCommentRouter(deps: BackerCommentDeps): Router {
  const { db, tokens, audit } = deps;
  const router = Router();
  router.use(express.json({ limit: '64kb' }));
  const base = `${MAGIC_LINK_TOKEN_PATH}/:${TOKEN_PARAM}`;
  const guard = requireMagicLinkToken(tokens);

  /**
   * §18: only a magic-link-authenticated Backer may post.
   *
   * The campaign comes from the *token subject*, never from the body — a
   * campaign id in a request is a value the caller chose, and accepting one
   * would let a magic link for campaign A post to campaign B.
   */
  router.post(`${base}/comments`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const body = req.body as Record<string, unknown>;

    const outcome = await postComment(
      db,
      { audit },
      {
        campaignId: subject.campaignId,
        backerIdentityId: subject.backerIdentityId,
        ...(typeof body['updateId'] === 'string' ? { updateId: body['updateId'] } : {}),
        body: String(body['body'] ?? ''),
        ...(typeof body['displayName'] === 'string' ? { displayName: body['displayName'] } : {}),
      },
    );

    if (!outcome.ok) {
      res.status(outcome.code === 'comments_closed' ? 409 : 422).json({
        error: outcome.code,
        title: 'That comment was not posted',
        whatHappened: outcome.message,
        next: outcome.next,
        support: '/support',
      });
      return;
    }
    res.status(201).json({ comment: outcome.comment });
  });

  router.get(`${base}/comments`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const updateId = typeof req.query['updateId'] === 'string' ? req.query['updateId'] : undefined;
    const thread = await readCommentThread(db, {
      campaignId: subject.campaignId,
      ...(updateId ? { updateId } : {}),
      viewerBackerIdentityId: subject.backerIdentityId,
    });
    if (!thread) {
      notFound(res);
      return;
    }
    res.json({ thread });
  });

  /** §18: "Flagging routes to Admin." It hides nothing. */
  router.post(`${base}/comments/:commentId/flag`, guard, async (req, res) => {
    const subject = req.magicLinkSubject!;
    const outcome = await flagComment(
      db,
      { audit },
      {
        commentId: String(req.params['commentId']),
        reportedBy: `backer:${subject.backerIdentityId}`,
        reason: String((req.body as Record<string, unknown>)['reason'] ?? ''),
      },
    );
    if (!outcome.ok) {
      res.status(outcome.code === 'not_found' ? 404 : 409).json({
        error: outcome.code,
        title: 'That report was not recorded',
        whatHappened: outcome.message,
        next: 'Nothing has changed.',
      });
      return;
    }
    res.status(201).json({
      reported: true,
      // §1.4: say what actually happens next, which is a person reading it.
      next: 'Someone at Proovd will read it. The comment stays up until they decide.',
    });
  });

  return router;
}

/* ── Admin: decide a change request, decide a flag, add a Creator ──────────── */

export interface AdminLiveOpsDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

export function createAdminLiveOpsRouter(deps: AdminLiveOpsDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json = express.json({ limit: '256kb' });
  const base = '/api/admin/live';

  const actorId = (req: express.Request) => `user:${req.authUser?.id ?? ''}`;

  /* §20 column two: the queue of what Founders have asked to change. */
  router.get(`${base}/change-requests`, admin, async (req, res) => {
    const campaignId =
      typeof req.query['campaignId'] === 'string' ? req.query['campaignId'] : undefined;
    res.json({
      requests: await listChangeRequests(db, {
        ...(campaignId ? { campaignId } : {}),
        status: 'open',
      }),
    });
  });

  /**
   * Applying is a high-impact editorial act on a live campaign, so it takes the
   * freshness gate — the same posture as every other Admin write since 06a.
   */
  router.post(`${base}/change-requests/:requestId`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const decision = body['decision'] === 'applied' ? 'applied' : 'declined';

    const outcome = await decideChangeRequest(
      db,
      { audit },
      {
        requestId: String(req.params['requestId']),
        decision,
        ...(body['classification'] === 'material' || body['classification'] === 'non_material'
          ? { classification: body['classification'] }
          : {}),
        ...(Array.isArray(body['affectedCreators'])
          ? { affectedCreators: (body['affectedCreators'] as string[]).map(String) }
          : {}),
        decisionReason: String(body['decisionReason'] ?? ''),
        actor: actorId(req),
      },
    );

    if (!outcome.ok) {
      res.status(outcome.code === 'not_found' ? 404 : 409).json({
        error: outcome.code,
        title: 'That request was not decided',
        whatHappened: outcome.message,
        next: 'Reload the queue.',
      });
      return;
    }
    res.json(outcome);
  });

  /* §18: the flag queue and its decision. */
  router.get(`${base}/comment-flags`, admin, async (req, res) => {
    const campaignId =
      typeof req.query['campaignId'] === 'string' ? req.query['campaignId'] : undefined;
    res.json({ flags: await listOpenFlags(db, campaignId) });
  });

  router.post(`${base}/comment-flags/:flagId`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const outcome = await decideFlag(
      db,
      { audit },
      {
        flagId: String(req.params['flagId']),
        decision: body['decision'] === 'upheld' ? 'upheld' : 'dismissed',
        decisionReason: String(body['decisionReason'] ?? ''),
        actor: actorId(req),
      },
    );
    if (!outcome.ok) {
      res.status(outcome.code === 'not_found' ? 404 : 409).json({
        error: outcome.code,
        title: 'That flag was not decided',
        whatHappened: outcome.message,
        next: 'Reload the queue.',
      });
      return;
    }
    res.json(outcome);
  });

  /* §20 mid-campaign addition. */
  router.get(`${base}/campaigns/:campaignId/mid-campaign-terms`, admin, async (req, res) => {
    const terms = await readMidCampaignTerms(db, String(req.params['campaignId']));
    if ('code' in terms) {
      res.status(409).json({ error: terms.code });
      return;
    }
    res.json({ terms });
  });

  router.post(
    `${base}/associations/:associationId/mid-campaign`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const outcome = await openMidCampaignAddition(
        db,
        { audit },
        {
          associationId: String(req.params['associationId']),
          ...(typeof body['adjustedDeliverables'] === 'string'
            ? { adjustedDeliverables: body['adjustedDeliverables'] }
            : {}),
          actor: actorId(req),
        },
      );
      if (!outcome.ok) {
        res.status(outcome.code === 'campaign_not_found' ? 404 : 409).json({
          error: outcome.code,
          title: 'That Creator was not added',
          whatHappened: outcome.message,
          next: outcome.next,
        });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  router.post(
    `${base}/associations/:associationId/activate`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await activateMidCampaignCreator(
        db,
        { audit },
        { associationId: String(req.params['associationId']), actor: actorId(req) },
      );
      if (!outcome.ok) {
        res.status(outcome.code === 'campaign_not_found' ? 404 : 409).json({
          error: outcome.code,
          title: 'That link was not activated',
          whatHappened: outcome.message,
          next: outcome.next,
        });
        return;
      }
      res.json(outcome);
    },
  );

  return router;
}
