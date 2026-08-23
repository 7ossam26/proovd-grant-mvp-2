/**
 * Admin's review, roster finalization, and materiality — Spec §15, §26, §33.3.9,
 * §33.4.1, §33.4.2.
 *
 * Reads behind `requireAdmin`; every write additionally behind
 * `requireFreshSession`, the same posture as the Phase 06a settings and Phase
 * 11 listing surfaces. A material change is Admin's to classify and record —
 * "A Founder cannot publish a material change directly" (§15), and there is no
 * Founder route that reaches this machinery.
 */

import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import {
  notifyCampaignApproved,
  reviewNotifyDeps,
} from '../campaign/review-notifications.js';
import { campaigns } from '../db/schema/domain.js';
import {
  evaluateRosterReadiness,
  finalizeInitialRoster,
  recordAssociationRosterDecision,
} from '../campaign/readiness.js';
import {
  approveReview,
  requireChanges,
  readReviewReadiness,
  listReviews,
  listFeedback,
  type FeedbackItemInput,
} from '../campaign/review.js';
import { recordMaterialChange, type MaterialChangeInput } from '../campaign/materiality.js';

export interface AdminReviewDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  /** Phase 22b: §27.3/§27.6's review messages. Unset → the review still runs
      and the Admin queue still shows it, which is where the work is visible. */
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

export function createAdminReviewRouter(deps: AdminReviewDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  const actor = (req: express.Request): string => `admin:${req.authUser?.id ?? ''}`;

  async function campaignType(campaignId: string): Promise<'pre_build' | 'pre_launch' | null> {
    const [row] = await db
      .select({ type: campaigns.type })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    return row?.type ?? null;
  }

  /* ── The two parallel tracks, for the Admin review surface (§15) ─────────── */

  router.get('/api/admin/campaigns/:campaignId/review', admin, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    const type = await campaignType(campaignId);
    if (!type) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const readiness = await evaluateRosterReadiness(db, campaignId);
    const reviewReadiness = await readReviewReadiness(db, { campaignId, campaignType: type });
    const reviews = await listReviews(db, campaignId);
    const open = reviews.find((r) => r.outcome === 'pending');

    res.json({
      review: {
        rosterReadiness: {
          rosterStatus: readiness.rosterStatus,
          ready: readiness.ready,
          unmetRules: readiness.unmetRules,
          finalRoster: readiness.finalRosterAssociationIds,
          candidates: readiness.candidates,
        },
        reviewReady: reviewReadiness.reviewReady,
        buildStatus: reviewReadiness.buildStatus,
        rounds: reviews.map((r) => ({
          id: r.id,
          round: r.round,
          outcome: r.outcome,
          submittedAt: r.submittedAt.toISOString(),
          decidedAt: r.decidedAt?.toISOString() ?? null,
        })),
        openReviewId: open?.id ?? null,
      },
    });
  });

  /* ── §15 rule 2: mark the final initial launch roster ───────────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/roster/finalize',
    admin,
    fresh,
    json,
    async (req, res) => {
      const report = await finalizeInitialRoster(db, { audit }, {
        campaignId: req.params['campaignId'] as string,
        actor: actor(req),
      });
      res.json({ rosterReadiness: { rosterStatus: report.rosterStatus, ready: report.ready, unmetRules: report.unmetRules } });
    },
  );

  /* ── §15 rules 5 & 6: per-Creator roster decision ───────────────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/roster/:associationId/decision',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decision = body['rosterDecision'];
      if (decision !== 'included' && decision !== 'excluded') {
        res.status(422).json({ error: 'invalid_decision', whatHappened: 'Unknown roster decision.' });
        return;
      }
      const report = await recordAssociationRosterDecision(db, { audit }, {
        campaignId: req.params['campaignId'] as string,
        associationId: req.params['associationId'] as string,
        rosterDecision: decision,
        launchRequired: body['launchRequired'] === true,
        readinessConfirmed: body['readinessConfirmed'] === true,
        actor: actor(req),
      });
      res.json({
        rosterReadiness: { rosterStatus: report.rosterStatus, ready: report.ready, unmetRules: report.unmetRules },
      });
    },
  );

  /* ── The review decision (§15) ──────────────────────────────────────────── */

  router.post('/api/admin/campaigns/:campaignId/review/approve', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await approveReview(db, { audit, ...reviewNotifyDeps(deps) }, {
      campaignId: req.params['campaignId'] as string,
      reviewer: typeof body['reviewer'] === 'string' ? body['reviewer'] : actor(req),
      actor: actor(req),
    });
    if (!result.ok) {
      res.status(409).json({ error: result.code, whatHappened: result.message });
      return;
    }
    res.json({ review: { outcome: result.outcome, round: result.review.round } });
  });

  router.post(
    '/api/admin/campaigns/:campaignId/review/approval-email/resend',
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = req.params['campaignId'] as string;
      const reviews = await listReviews(db, campaignId);
      const approved = reviews.find((review) => review.outcome === 'approved');
      if (!approved) {
        res.status(409).json({
          error: 'campaign_not_approved',
          whatHappened: 'There is no approved campaign email to resend yet.',
        });
        return;
      }

      const outcome = await notifyCampaignApproved(
        { db, ...reviewNotifyDeps(deps) },
        {
          campaignId,
          review: approved,
          deliveryEntityId: `${approved.id}:resend:${randomUUID()}`,
        },
      );

      if (outcome.status === 'unavailable') {
        res.status(503).json({
          error: 'email_unavailable',
          whatHappened:
            outcome.reason === 'missing_email'
              ? 'The Founder record has no email address.'
              : 'Email delivery is not configured.',
        });
        return;
      }
      if (outcome.status === 'failed') {
        res.status(502).json({
          error: 'email_rejected',
          whatHappened: 'The email provider did not accept the approval email.',
        });
        return;
      }

      await audit({
        action: 'review.approval_email_resent',
        targetType: 'campaign',
        targetId: campaignId,
        internalReason: 'Admin deliberately resent the approved campaign dashboard link',
        actorId: req.authUser?.id ?? null,
      });
      res.json({ email: { status: 'sent', reviewRound: approved.round } });
    },
  );

  router.post('/api/admin/campaigns/:campaignId/review/changes', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawFeedback = Array.isArray(body['feedback']) ? body['feedback'] : [];
    const feedback: FeedbackItemInput[] = [];
    for (const raw of rawFeedback as Array<Record<string, unknown>>) {
      const group = raw['group'];
      if (group !== 'required' && group !== 'optional') {
        res.status(422).json({ error: 'invalid_feedback', whatHappened: 'Each feedback item needs a group.' });
        return;
      }
      // §15/§33.4.1: deep-link and owner are required; a change with nowhere to
      // point and nobody to own it is not actionable feedback.
      if (typeof raw['deepLink'] !== 'string' || !raw['deepLink'].trim()) {
        res.status(422).json({ error: 'deep_link_required', whatHappened: 'Every feedback item deep-links to the affected content.' });
        return;
      }
      feedback.push({
        group,
        area: String(raw['area'] ?? ''),
        body: String(raw['body'] ?? ''),
        deepLink: String(raw['deepLink']),
        owner: String(raw['owner'] ?? 'Founder'),
        dueExpectation: typeof raw['dueExpectation'] === 'string' ? raw['dueExpectation'] : undefined,
        enforcementInvolved: raw['enforcementInvolved'] === true,
      });
    }

    const result = await requireChanges(db, { audit, ...reviewNotifyDeps(deps) }, {
      campaignId: req.params['campaignId'] as string,
      reviewer: typeof body['reviewer'] === 'string' ? body['reviewer'] : actor(req),
      nextUpdateExpectation:
        typeof body['nextUpdateExpectation'] === 'string' ? body['nextUpdateExpectation'] : undefined,
      feedback,
      actor: actor(req),
    });
    if (!result.ok) {
      res.status(409).json({ error: result.code, whatHappened: result.message });
      return;
    }
    res.json({ review: { outcome: result.outcome, round: result.review.round } });
  });

  /* ── Materiality (§15, §33.4.2) — the general machine ───────────────────── */

  router.post('/api/admin/campaigns/:campaignId/material-changes', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const classification = body['classification'];
    if (classification !== 'material' && classification !== 'non_material') {
      res.status(422).json({ error: 'invalid_classification', whatHappened: 'A change is classified material or non_material (§15).' });
      return;
    }
    if (typeof body['reason'] !== 'string' || !body['reason'].trim()) {
      res.status(422).json({ error: 'reason_required', whatHappened: 'A classification is recorded with its reason (§15).' });
      return;
    }
    const affectedFields = Array.isArray(body['affectedFields'])
      ? (body['affectedFields'] as unknown[]).map(String)
      : [];
    const affectedCreators = Array.isArray(body['affectedCreators'])
      ? (body['affectedCreators'] as unknown[]).map(String)
      : [];

    const input: MaterialChangeInput = {
      campaignId: req.params['campaignId'] as string,
      classification,
      reason: body['reason'],
      affectedFields,
      beforeValue: body['beforeValue'],
      afterValue: body['afterValue'],
      affectedCreators,
      actor: actor(req),
      ...(typeof body['reviewId'] === 'string' ? { reviewId: body['reviewId'] } : {}),
    };
    const result = await recordMaterialChange(db, { audit }, input);
    res.json({
      materialChange: {
        id: result.change.id,
        classification: result.change.classification,
        newVersion: result.change.newVersion,
        reacceptanceState: result.change.reacceptanceState,
        reacceptanceTasks: result.reacceptances.length,
      },
      rosterReadiness: {
        rosterStatus: result.readiness.rosterStatus,
        ready: result.readiness.ready,
        unmetRules: result.readiness.unmetRules,
      },
    });
  });

  /* ── A review round's feedback, for Admin's own view ────────────────────── */

  router.get('/api/admin/reviews/:reviewId/feedback', admin, async (req, res) => {
    const feedback = await listFeedback(db, req.params['reviewId'] as string);
    res.json({ feedback });
  });

  return router;
}
