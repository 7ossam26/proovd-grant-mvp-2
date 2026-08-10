/**
 * The §26.6 / §33.12.4 high-impact action and override routes (Phase 16a).
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * §5.1 names the category: "money movement, refund, connected-account, campaign
 * kill/suspend, and other high-impact actions". Listing the overrides already
 * recorded is *looking*, and making an Admin reauthenticate to look teaches
 * them to reauthenticate reflexively, which is how the gate stops meaning
 * anything (the reasoning `admin.ts` already records for settings).
 *
 * So: every read is `admin` only. Executing a §33.12.4 override takes `fresh` —
 * it is §26.6's high-impact action by definition.
 *
 * The *preview* also takes `fresh`. It writes a row and it is the step that
 * makes the override possible; letting it run on a stale session would mean the
 * reauthentication happened after the Admin had already decided.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  previewHighImpactAction,
  recordOverride,
  listOverrides,
  AUTO_POPULATED_FIELDS,
} from '../admin/high-impact.js';
import { OVERRIDABLE_FIELDS } from '../admin/logic.js';

export const ADMIN_OPS_BASE_PATH = '/api/admin';

export interface AdminOperationsRouterDeps {
  db: Database;
  auth: Auth;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

function securityContext(req: express.Request): { mfaContext: string; reauthContext: string } {
  const session = req.authSession;
  return {
    mfaContext: 'totp_factor_registered',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

export function createAdminOperationsRouter({
  db,
  auth,
}: AdminOperationsRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── §26.6 / §33.12.4 high-impact actions and overrides ────────────────── */

  router.get(`${ADMIN_OPS_BASE_PATH}/overrides/fields`, admin, (_req, res) => {
    res.json({
      overridable: OVERRIDABLE_FIELDS,
      // §26.2's other half, stated rather than implied: these have no write path
      // anywhere, and saying so is what makes the absence legible (§33.12.4).
      autoPopulated: AUTO_POPULATED_FIELDS,
      autoPopulatedNote:
        'User and provider data auto-populates. Admin adds only review, decision, evidence, and override data (§26.2). There is no route that writes an auto-populated field.',
    });
  });

  router.get(
    `${ADMIN_OPS_BASE_PATH}/overrides/:targetType/:targetId`,
    admin,
    async (req, res) => {
      const rows = await listOverrides(
        db,
        req.params['targetType'] as string,
        req.params['targetId'] as string,
      );
      res.json({ overrides: rows });
    },
  );

  /** §26.6 step 1: compute the consequences before anything moves. */
  router.post(`${ADMIN_OPS_BASE_PATH}/overrides/preview`, admin, fresh, json, async (req, res) => {
    const body = req.body as { fieldKey?: unknown; targetId?: unknown; newValue?: unknown };

    if (typeof body?.fieldKey !== 'string' || typeof body?.targetId !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That preview could not be produced',
        whatHappened: 'A field and a target are both required.',
        next: 'Choose what you are changing, then preview it again.',
      });
      return;
    }

    const result = await previewHighImpactAction(db, {
      fieldKey: body.fieldKey,
      targetId: body.targetId,
      newValue: body.newValue,
      issuedBy: actorOf(req),
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 422).json({
        error: result.code,
        title: 'That preview could not be produced',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.status(201).json(result.preview);
  });

  /** §26.6 step 2: execute, citing the preview that was read. */
  router.post(`${ADMIN_OPS_BASE_PATH}/overrides`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

    if (!str('fieldKey') || !str('targetId')) {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That override could not be recorded',
        whatHappened: 'A field and a target are both required.',
        next: 'Nothing has changed.',
      });
      return;
    }

    const result = await recordOverride(db, {
      fieldKey: str('fieldKey'),
      targetId: str('targetId'),
      newValue: body['newValue'],
      internalReason: str('internalReason'),
      customerExplanation: str('customerExplanation'),
      previewId: str('previewId'),
      actor: actorOf(req),
      ...securityContext(req),
      evidenceLinks:
        body['evidenceLinks'] && typeof body['evidenceLinks'] === 'object'
          ? (body['evidenceLinks'] as Record<string, unknown>)
          : undefined,
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 422).json({
        error: result.code,
        title: 'That override could not be recorded',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.status(201).json(result);
  });

  return router;
}
