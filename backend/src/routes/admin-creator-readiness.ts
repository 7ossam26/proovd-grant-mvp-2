/**
 * Admin's Creator-readiness verification, funding deadline, funding-lapse
 * cancellation, and the one `campaign_live_at` — Spec §16, §26, §33.4.4.
 *
 * Reads behind `requireAdmin`; every write additionally behind
 * `requireFreshSession`, the Phase 06a/11/12b posture. §16: "Admin verifies
 * every checklist item… and schedules ONE exact `campaign_live_at` only after
 * the campaign and every scheduled Creator are ready." The schedule route
 * re-decides readiness server-side; a disabled button is not authorization.
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
import type { LaunchNotificationContext } from '../launch/notifications.js';
import type { CreatorPaymentNotifyDeps } from '../creator-payment/notifications.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { campaigns } from '../db/schema/domain.js';
import { setFundingDeadline } from '../creator-payment/allocations.js';
import {
  confirmCreatorDeliverables,
  cancelAssociationForFundingLapse,
  scheduleCampaignLive,
  evaluateCreatorReadiness,
} from '../creator-payment/readiness.js';
import { buildAdminReadinessView } from '../creator-payment/views.js';

export interface AdminCreatorReadinessDeps {
  db: Database;
  auth: Auth;
  gateway: StripeGateway;
  audit: AuditWriter;
  /** Phase 22b: the §27.3 funding request. Unset and the ask lives only on
      the readiness surface, which is where it lived before. */
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

export function createAdminCreatorReadinessRouter(deps: AdminCreatorReadinessDeps): Router {
  const { db, auth, gateway, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '16kb' });

  const actor = (req: express.Request): string => `admin:${req.authUser?.id ?? ''}`;
  const mode = () => gateway.mode;

  /** §27's funding messages. One shape, built once. */
  const paymentNotify: Omit<CreatorPaymentNotifyDeps, 'db'> = {
    ...(deps.notifier ? { notifier: deps.notifier } : {}),
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
    ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
  };

  async function campaignExists(campaignId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    return Boolean(row);
  }

  /* ── The Admin view (§16) ──────────────────────────────────────────────────── */

  router.get('/api/admin/campaigns/:campaignId/creator-readiness', admin, async (req, res) => {
    const campaignId = req.params['campaignId'] as string;
    if (!(await campaignExists(campaignId))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const view = await buildAdminReadinessView(db, mode(), campaignId);
    res.json({ readiness: view });
  });

  /* ── Verify a Creator's deliverable/post plan (§16 item 8) ─────────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/creators/:associationId/confirm-deliverables',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const report = await confirmCreatorDeliverables(db, { audit, mode: mode() }, {
        campaignId: req.params['campaignId'] as string,
        associationId: req.params['associationId'] as string,
        confirmed: body['confirmed'] !== false,
        actor: actor(req),
      });
      if (!report) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({
        creator: { associationId: report.associationId, status: report.associationStatus, canBeginWork: report.canBeginWork, incompleteItems: report.incompleteItems },
      });
    },
  );

  /* ── Re-evaluate one Creator's readiness (§16) ─────────────────────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/creators/:associationId/evaluate',
    admin,
    fresh,
    json,
    async (req, res) => {
      const report = await evaluateCreatorReadiness(db, { audit, mode: mode() }, {
        associationId: req.params['associationId'] as string,
        actor: actor(req),
      });
      if (!report) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({
        creator: { associationId: report.associationId, status: report.associationStatus, canBeginWork: report.canBeginWork, incompleteItems: report.incompleteItems },
      });
    },
  );

  /* ── The Admin-configured funding deadline (§16) ───────────────────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/creators/:associationId/funding-deadline',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const raw = typeof body['deadlineAt'] === 'string' ? body['deadlineAt'] : '';
      const deadlineAt = raw ? new Date(raw) : null;
      if (!deadlineAt || Number.isNaN(deadlineAt.getTime())) {
        res.status(422).json({ error: 'invalid_deadline', whatHappened: 'A funding deadline needs a valid date/time.' });
        return;
      }
      const result = await setFundingDeadline(db, { audit, ...paymentNotify }, {
        associationId: req.params['associationId'] as string,
        deadlineAt,
        actor: actor(req),
        gateway,
      });
      if (!result.ok) {
        res.status(result.code === 'canceled' ? 409 : 422).json({
          error: result.code,
          whatHappened:
            result.code === 'not_applicable'
              ? 'There is no fixed Creator payment to schedule for this Creator.'
              : 'This fixed Creator payment was canceled.',
        });
        return;
      }
      res.json({
        allocation: {
          status: result.allocation.status,
          fundingDeadlineAt: result.allocation.fundingDeadlineAt?.toISOString() ?? null,
        },
      });
    },
  );

  /* ── Missing the funding deadline: cancel the association (§16) ─────────────── */

  router.post(
    '/api/admin/campaigns/:campaignId/creators/:associationId/cancel-funding-lapse',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await cancelAssociationForFundingLapse(db, { audit }, {
        associationId: req.params['associationId'] as string,
        reason: typeof body['reason'] === 'string' ? body['reason'] : undefined,
        actor: actor(req),
      });
      if (!result.ok) {
        const status = result.code === 'funded' ? 409 : result.code === 'not_found' ? 404 : 422;
        res.status(status).json({
          error: result.code,
          whatHappened:
            result.code === 'funded'
              ? 'This fixed Creator payment is already funded, so this is not a funding lapse.'
              : result.code === 'not_found'
                ? 'That Creator or allocation could not be found.'
                : 'This Creator is not in a state that can be canceled for a funding lapse.',
        });
        return;
      }
      res.json({ association: { id: result.associationId, status: 'removed' } });
    },
  );

  /* ── Schedule the one campaign_live_at (§16) ───────────────────────────────── */

  router.post('/api/admin/campaigns/:campaignId/schedule-live', admin, fresh, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof body['liveAt'] === 'string' ? body['liveAt'] : '';
    const liveAt = raw ? new Date(raw) : null;
    if (!liveAt || Number.isNaN(liveAt.getTime())) {
      res.status(422).json({ error: 'invalid_live_at', whatHappened: 'A launch time needs a valid date/time.' });
      return;
    }
    const result = await scheduleCampaignLive(db, { audit, mode: mode() }, {
      campaignId: req.params['campaignId'] as string,
      liveAt,
      actor: actor(req),
    });
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : result.code === 'not_ready' ? 409 : 422;
      res.status(status).json({
        error: result.code,
        whatHappened: result.message,
        ...(result.code === 'not_ready' ? { blockers: result.blockers } : {}),
      });
      return;
    }
    res.json({ campaign: { campaignLiveAt: result.campaignLiveAt.toISOString() } });
  });

  return router;
}
