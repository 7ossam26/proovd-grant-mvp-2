/**
 * Admin's launch, first-post verification, and §29.6 replacement surface —
 * Spec §17, §29.6, §26, §33.4.5–§33.4.9.
 *
 * Reads behind `requireAdmin`; every write additionally behind
 * `requireFreshSession`, the Phase 06a/11/12b posture. The launch route
 * re-decides readiness server-side — a disabled button is not authorization
 * (§1.1) — and every route is independently idempotent, so a double-click, a
 * retry, or a duplicate delivery produces one state and one set of messages
 * (§33.4.6).
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import { campaigns } from '../db/schema/domain.js';
import { launchCampaign, findLaunch } from '../launch/launch.js';
import {
  verifyPost,
  listCampaignSubmissions,
  findSubmission,
} from '../launch/post-verification.js';
import { recordCreatorFailure, resolveCreatorReplacement, findCreatorFailure } from '../launch/creator-failure.js';
import { notifyCampaignLive, notifyPostVerification, type LaunchNotificationContext } from '../launch/notifications.js';
import { POST_OUTCOMES, type PostOutcome } from '../launch/logic.js';

export interface AdminLaunchDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  notifier: Notifier;
  context: LaunchNotificationContext;
}

export function createAdminLaunchRouter(deps: AdminLaunchDeps): Router {
  const { db, auth, audit, notifier, context } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '32kb' });

  const actor = (req: express.Request): string => `admin:${req.authUser?.id ?? ''}`;

  async function campaignStatus(campaignId: string): Promise<string | null> {
    const [row] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    return row?.status ?? null;
  }

  /* ── The launch/verification view (§17) ────────────────────────────────────── */

  router.get('/api/admin/campaigns/:campaignId/launch', admin, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const status = await campaignStatus(campaignId);
    if (!status) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const [launch, submissions, failure] = await Promise.all([
      findLaunch(db, campaignId),
      listCampaignSubmissions(db, campaignId),
      findCreatorFailure(db, campaignId),
    ]);
    res.json({
      campaign: { id: campaignId, status },
      launch: launch
        ? {
            launchedAt: launch.launchedAt.toISOString(),
            campaignLiveAt: launch.campaignLiveAt.toISOString(),
            activatedLinkCount: launch.activatedLinkCount,
          }
        : null,
      submissions: submissions.map((s) => ({
        id: s.id,
        associationId: s.associationId,
        postUrl: s.postUrl,
        status: s.status,
        submittedAt: s.submittedAt.toISOString(),
        verifiedAt: s.verifiedAt?.toISOString() ?? null,
        correctionDetail: s.correctionDetail,
        correctionDueAt: s.correctionDueAt?.toISOString() ?? null,
      })),
      creatorFailure: failure
        ? {
            status: failure.status,
            failedAssociationId: failure.failedAssociationId,
            recordedAt: failure.creatorFailureRecordedAt.toISOString(),
            dueAt: failure.dueAt.toISOString(),
            dueCalendarVersion: failure.dueCalendarVersion,
          }
        : null,
    });
  });

  /* ── Trigger the coordinated launch (§17, §33.4.5) ─────────────────────────── */

  router.post('/api/admin/campaigns/:campaignId/launch', admin, fresh, json, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const result = await launchCampaign(db, { audit }, { campaignId, actor: actor(req) });

    if (result.status === 'launched') {
      await notifyCampaignLive(db, notifier, context, {
        campaignId,
        activatedAssociationIds: result.activatedAssociationIds,
        campaignCloseAt: result.campaignCloseAt,
      });
      res.json({
        launch: {
          status: 'launched',
          activatedLinkCount: result.launch.activatedLinkCount,
          campaignCloseAt: result.campaignCloseAt.toISOString(),
        },
      });
      return;
    }
    if (result.status === 'already_live') {
      res.json({ launch: { status: 'already_live', activatedLinkCount: result.launch?.activatedLinkCount ?? 0 } });
      return;
    }

    const status =
      result.status === 'not_found' ? 404 : result.status === 'not_due' || result.status === 'not_scheduled' ? 409 : 422;
    res.status(status).json({
      error: result.status,
      whatHappened:
        result.status === 'not_found'
          ? 'That campaign could not be found.'
          : result.status === 'not_scheduled'
            ? 'No launch time is scheduled for this campaign yet.'
            : result.status === 'not_due'
              ? `The scheduled launch time (${result.campaignLiveAt.toISOString()}) has not arrived yet.`
              : result.reason,
    });
  });

  /* ── Verify a first post (§17, §33.4.7, §33.4.8) ───────────────────────────── */

  router.post('/api/admin/post-submissions/:submissionId/verify', admin, fresh, json, async (req, res) => {
    const submissionId = req.params['submissionId'] as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const outcome = body['outcome'];
    if (typeof outcome !== 'string' || !(POST_OUTCOMES as readonly string[]).includes(outcome)) {
      res.status(422).json({ error: 'invalid_outcome', whatHappened: 'The outcome must be passed, correction_needed, or rejected.' });
      return;
    }
    const checklist = (body['checklist'] ?? {}) as Record<string, boolean>;
    const correctionDueRaw = typeof body['correctionDueAt'] === 'string' ? body['correctionDueAt'] : '';
    const correctionDueAt = correctionDueRaw ? new Date(correctionDueRaw) : undefined;

    const result = await verifyPost(db, { audit }, {
      submissionId,
      outcome: outcome as PostOutcome,
      checklist,
      correctionDetail: typeof body['correctionDetail'] === 'string' ? body['correctionDetail'] : undefined,
      correctionDueAt: correctionDueAt && !Number.isNaN(correctionDueAt.getTime()) ? correctionDueAt : undefined,
      enforcementReason: typeof body['enforcementReason'] === 'string' ? body['enforcementReason'] : undefined,
      evidence: (body['evidence'] ?? undefined) as Record<string, unknown> | undefined,
      actor: actor(req),
    });

    if (result.status === 'verified') {
      await notifyPostVerification(db, notifier, context, { submissionId });
      res.json({
        verification: {
          outcome: result.outcome,
          linkPaused: result.linkPaused,
          associationPaused: result.associationPaused,
          associationResumed: result.associationResumed,
        },
      });
      return;
    }
    if (result.status === 'already_verified') {
      res.json({ verification: { outcome: result.submission.status, alreadyVerified: true } });
      return;
    }
    if (result.status === 'checklist_incomplete') {
      res.status(422).json({ error: 'checklist_incomplete', failed: result.failed, whatHappened: 'A pass requires every check to be true.' });
      return;
    }
    res.status(404).json({ error: 'not_found', whatHappened: 'That post submission could not be found.' });
  });

  /* ── Record a required launch Creator failure (§29.6, §33.4.9) ──────────────── */

  router.post('/api/admin/campaigns/:campaignId/creator-failure', admin, fresh, json, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const failedAssociationId = typeof body['failedAssociationId'] === 'string' ? body['failedAssociationId'] : '';
    const replacementDesignation = typeof body['replacementDesignation'] === 'string' ? body['replacementDesignation'] : '';
    if (!failedAssociationId || !replacementDesignation.trim()) {
      res.status(422).json({ error: 'invalid', whatHappened: 'Name the failed Creator and the replacement plan.' });
      return;
    }

    const result = await recordCreatorFailure({ db, audit }, {
      campaignId,
      failedAssociationId,
      replacementDesignation,
      recordedBy: actor(req),
    });

    if (result.status === 'recorded') {
      res.json({
        creatorFailure: {
          status: result.failure.status,
          dueAt: result.failure.dueAt.toISOString(),
          dueCalendarVersion: result.failure.dueCalendarVersion,
          alreadyExisted: result.alreadyExisted,
        },
      });
      return;
    }
    const status = result.status === 'not_found' ? 404 : 409;
    res.status(status).json({
      error: result.status,
      whatHappened: result.status === 'not_found' ? 'That campaign could not be found.' : result.message,
    });
  });

  /* ── Mark the replacement ready (§29.6) ────────────────────────────────────── */

  router.post('/api/admin/campaigns/:campaignId/creator-replacement/resolve', admin, fresh, json, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await resolveCreatorReplacement({ db, audit }, {
      campaignId,
      actor: actor(req),
      resolutionNote: typeof body['resolutionNote'] === 'string' ? body['resolutionNote'] : undefined,
    });
    if (result.status === 'resolved') {
      res.json({ creatorReplacement: { status: result.failure.status } });
      return;
    }
    const status = result.status === 'not_found' ? 404 : 409;
    res.status(status).json({
      error: result.status,
      whatHappened: result.status === 'not_found' ? 'No required-Creator failure is recorded for this campaign.' : result.message,
    });
  });

  return router;
}

/** Exposed for the read view and tests. */
export { findSubmission };
