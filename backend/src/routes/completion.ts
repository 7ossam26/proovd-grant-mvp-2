/**
 * Phase 21b's routes — Spec §22.8, §22.9, §22.10, §22.11, §31.8.
 *
 * Three routers, because three different actors reach this scope and each has
 * a different authorization story:
 *
 *   Admin    assigns completion, decides readiness, resolves the campaign.
 *   Founder  asks a completed Creator to work again, and reads their own
 *            cooldown and readiness.
 *   Creator  answers a request.
 *
 * The Backer's satisfaction routes live on the magic-link router instead
 * (§5.4: a Backer has no account, so the token IS the identity and a route
 * that took a reservation id would let anyone holding one link answer for
 * someone else).
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession, requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { campaignAffiliateAssociations, campaigns } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { workAgainRequests } from '../db/schema/completion.js';
import {
  assignCompletionStatus,
  correctCompletionStatus,
  gatherCompletionFindings,
  readCompletionStatus,
} from '../completion/service.js';
import {
  listWorkAgainForCampaign,
  listWorkAgainForCreator,
  requestWorkAgain,
  respondToWorkAgain,
  withdrawWorkAgain,
} from '../completion/work-again.js';
import {
  readNextCampaignReadiness,
  recordNextCampaignReadiness,
} from '../completion/next-campaign.js';
import { readResolution, resolveCampaign, markFulfilled } from '../completion/resolution.js';
import {
  notifyNextCampaignReadiness,
  notifyWorkAgainInternal,
  notifyWorkAgainRequested,
  notifyWorkAgainResponse,
  type CompletionNotifyDeps,
} from '../completion/notifications.js';
import { WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING, WORK_AGAIN_NO_PENALTY } from '../completion/logic.js';

export interface CompletionRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  notify?: Omit<CompletionNotifyDeps, 'db'> | undefined;
}

const json: RequestHandler = express.json({ limit: '32kb' });

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/* ── Admin (§22.8, §22.10, §22.11) ────────────────────────────────────────── */

export function createAdminCompletionRouter(deps: CompletionRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const notify = (): CompletionNotifyDeps => ({ db, ...(deps.notify ?? {}) });
  const actor = (req: express.Request): string => `user:${req.authUser?.id ?? 'unknown'}`;

  /** The five §22.8 criteria as they currently stand, before any decision. */
  router.get('/api/admin/completion/:associationId', admin, async (req, res) => {
    const associationId = String(req.params['associationId']);
    try {
      const findings = await gatherCompletionFindings(db, associationId);
      const current = await readCompletionStatus(db, associationId);
      res.json({ findings, current });
    } catch {
      res.status(404).json({ error: 'not_found', title: 'No such Creator' });
    }
  });

  router.post('/api/admin/completion/:associationId', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = str(body['status']);
    if (status !== 'successfully_completed' && status !== 'completion_disqualified') {
      res.status(422).json({ error: 'invalid_status' });
      return;
    }

    const result = await assignCompletionStatus(
      { db, audit },
      {
        associationId: String(req.params['associationId']),
        status,
        decidedBy: actor(req),
        evidenceNote: str(body['evidenceNote']),
        disqualifyingReason: str(body['disqualifyingReason']) || undefined,
      },
    );

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        whatHappened: result.message,
        ...(result.unmet ? { unmet: result.unmet } : {}),
      });
      return;
    }
    res.json({ status: result.status, statusId: result.statusId, findings: result.findings });
  });

  /** §22.9: a correction supersedes and keeps history. */
  router.post(
    '/api/admin/completion/:associationId/correct',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = str(body['status']);
      if (status !== 'successfully_completed' && status !== 'completion_disqualified') {
        res.status(422).json({ error: 'invalid_status' });
        return;
      }
      const result = await correctCompletionStatus(
        { db, audit },
        {
          associationId: String(req.params['associationId']),
          status,
          decidedBy: actor(req),
          evidenceNote: str(body['evidenceNote']),
          disqualifyingReason: str(body['disqualifyingReason']) || undefined,
        },
      );
      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 409).json({
          error: result.code,
          whatHappened: result.message,
        });
        return;
      }
      res.json({ status: result.status, statusId: result.statusId });
    },
  );

  /** §22.10: the Admin readiness decision, separate from the cooldown. */
  router.post('/api/admin/campaigns/:campaignId/next-readiness', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = str(body['decision']);
    if (decision !== 'ready' && decision !== 'not_ready') {
      res.status(422).json({ error: 'invalid_decision' });
      return;
    }
    const campaignId = String(req.params['campaignId']);
    const result = await recordNextCampaignReadiness(
      { db, audit },
      {
        campaignId,
        decision,
        decidedBy: actor(req),
        criteriaNote: str(body['criteriaNote']),
        customerExplanation: str(body['customerExplanation']),
      },
    );
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 422).json({
        error: result.code,
        whatHappened: result.message,
      });
      return;
    }
    await notifyNextCampaignReadiness(notify(), {
      campaignId,
      decisionId: result.decisionId,
      decision,
      explanation: str(body['customerExplanation']),
    });
    res.json({ decisionId: result.decisionId, decision });
  });

  /** §22.11: what reconciles, and what does not. */
  router.get('/api/admin/campaigns/:campaignId/resolution', admin, async (req, res) => {
    res.json(await readResolution(db, String(req.params['campaignId'])));
  });

  router.post('/api/admin/campaigns/:campaignId/resolve', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await resolveCampaign(
      { db, audit },
      {
        campaignId: String(req.params['campaignId']),
        resolvedBy: actor(req),
        note: str(body['note']),
      },
    );
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        whatHappened: result.message,
        ...(result.unresolved ? { unresolved: result.unresolved } : {}),
      });
      return;
    }
    res.json({ resolutionId: result.resolutionId, fulfillmentActive: result.fulfillmentActive });
  });

  /** §23.1's `fulfilled`, independent of resolution. */
  router.post('/api/admin/campaigns/:campaignId/fulfilled', admin, fresh, json, async (req, res) => {
    const result = await markFulfilled(
      { db, audit },
      { campaignId: String(req.params['campaignId']), actor: actor(req) },
    );
    if (!result.ok) {
      res.status(409).json({
        error: 'not_fulfilled',
        whatHappened: 'This campaign has no recorded delivery, so it cannot be marked fulfilled.',
      });
      return;
    }
    res.json({ moved: result.moved });
  });

  return router;
}

/* ── Founder (§22.9, §22.10) ──────────────────────────────────────────────── */

export function createFounderCompletionRouter(deps: CompletionRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const notify = (): CompletionNotifyDeps => ({ db, ...(deps.notify ?? {}) });

  /** The caller's own campaign, or null — scoped inside the query. */
  async function ownCampaign(req: express.Request): Promise<string | null> {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .innerJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.id, String(req.params['campaignId'] ?? '')),
          eq(founderClaimProfiles.claimedUserId, req.authUser?.id ?? ''),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** §22.10: the exact cooldown date AND the separate readiness decision. */
  router.get('/api/founder/campaigns/:campaignId/next-campaign', founder, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }
    res.json(await readNextCampaignReadiness(db, campaignId));
  });

  /** §22.9: ask a completed Creator to work again. */
  router.post('/api/founder/campaigns/:campaignId/work-again', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const associationId = str(body['associationId']);

    // The association must be on THIS campaign — otherwise a Founder could
    // name any association id and reach a Creator they never worked with.
    const [association] = await db
      .select({ id: campaignAffiliateAssociations.id })
      .from(campaignAffiliateAssociations)
      .where(
        and(
          eq(campaignAffiliateAssociations.id, associationId),
          eq(campaignAffiliateAssociations.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!association) {
      res.status(404).json({ error: 'not_found', title: 'No such Creator on this campaign' });
      return;
    }

    const result = await requestWorkAgain(
      { db, audit },
      {
        associationId,
        founderUserId: req.authUser?.id ?? '',
        message: str(body['message']),
      },
    );
    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        whatHappened: result.message,
      });
      return;
    }
    await notifyWorkAgainRequested(notify(), { requestId: result.requestId });
    await notifyWorkAgainInternal(notify(), { requestId: result.requestId });
    res.json({
      requestId: result.requestId,
      // §33.10.8, stated on the response the Founder reads first.
      grantsNothing: WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING,
    });
  });

  router.get('/api/founder/campaigns/:campaignId/work-again', founder, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) {
      res.status(404).json({ error: 'not_found', title: 'Campaign not found' });
      return;
    }
    res.json({ requests: await listWorkAgainForCampaign(db, campaignId) });
  });

  router.post('/api/founder/work-again/:requestId/withdraw', founder, json, async (req, res) => {
    const requestId = String(req.params['requestId']);
    const [own] = await db
      .select({ id: workAgainRequests.id })
      .from(workAgainRequests)
      .where(
        and(
          eq(workAgainRequests.id, requestId),
          eq(workAgainRequests.founderUserId, req.authUser?.id ?? ''),
        ),
      )
      .limit(1);
    if (!own) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await withdrawWorkAgain(
      { db, audit },
      { requestId, actor: `user:${req.authUser?.id ?? ''}` },
    );
    if (!('ok' in result) || !result.ok) {
      res.status(409).json({ error: 'not_open' });
      return;
    }
    res.json({ status: 'withdrawn' });
  });

  return router;
}

/* ── Creator (§22.9) ──────────────────────────────────────────────────────── */

export function createCreatorCompletionRouter(deps: CompletionRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const creator = requireRole(auth, 'affiliate');
  const notify = (): CompletionNotifyDeps => ({ db, ...(deps.notify ?? {}) });

  /** True when this association belongs to the caller. Scoped in the query. */
  async function owns(associationId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: affiliateSignupProfiles.id })
      .from(affiliateSignupProfiles)
      .where(
        and(
          eq(affiliateSignupProfiles.associationId, associationId),
          eq(affiliateSignupProfiles.claimedUserId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  router.get('/api/creator/campaigns/:associationId/work-again', creator, async (req, res) => {
    const associationId = String(req.params['associationId']);
    if (!(await owns(associationId, req.authUser?.id ?? ''))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({
      requests: await listWorkAgainForCreator(db, associationId),
      // §22.9's promise, on the surface where the Creator decides.
      noPenalty: WORK_AGAIN_NO_PENALTY,
    });
  });

  router.post('/api/creator/work-again/:requestId/respond', creator, json, async (req, res) => {
    const requestId = String(req.params['requestId']);
    const [request] = await db
      .select({ associationId: workAgainRequests.associationId })
      .from(workAgainRequests)
      .where(eq(workAgainRequests.id, requestId))
      .limit(1);
    if (!request || !(await owns(request.associationId, req.authUser?.id ?? ''))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await respondToWorkAgain(
      { db, audit },
      {
        requestId,
        accept: body['accept'] === true,
        responseNote: str(body['responseNote']) || undefined,
        actor: `user:${req.authUser?.id ?? ''}`,
      },
    );
    if (!result.ok) {
      res.status(409).json({ error: result.code, whatHappened: result.message });
      return;
    }
    await notifyWorkAgainResponse(notify(), { requestId });
    res.json({ status: result.status, noPenalty: WORK_AGAIN_NO_PENALTY });
  });

  return router;
}
