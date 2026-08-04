/**
 * The §21/§33.7.12 Admin close routes (Phase 18b).
 *
 *   GET  /api/admin/close                        the queue: incomplete batches
 *                                                first (visibly recoverable),
 *                                                then retry windows, then
 *                                                campaigns reconciling
 *   GET  /api/admin/close/:campaignId            batch detail + attempts +
 *                                                reconciliation items
 *   POST /api/admin/close/:campaignId/resume     resume the batch — the SAME
 *                                                idempotent machine the sweep
 *                                                runs, never a second one
 *   POST /api/admin/close/:campaignId/reconciliation  record one §21 item
 *   POST /api/admin/close/:campaignId/results    record the narrative and send
 *                                                `Results ready` (§33.7.11)
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * Reads are `admin` (16a's reasoning — a gate on looking teaches reflexive
 * reauthentication). Resume creates PaymentIntents, and results/reconciliation
 * are the §5.1 high-impact judgements this phase exists to record — all three
 * take `fresh`.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { runCloseBatch } from '../close/close-batch.js';
import { endRetryWindow } from '../close/retry.js';
import {
  readCloseOperations,
  readCloseBatchDetail,
  readReconciliation,
  recordReconciliationItem,
} from '../close/reconciliation.js';
import { prepareResults } from '../close/results.js';
import { RECONCILIATION_ITEMS, RESULTS_NARRATIVE_FIELDS } from '../close/logic.js';

export const ADMIN_CLOSE_BASE_PATH = '/api/admin/close';

export interface AdminCloseRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  gateway: StripeGateway;
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

export function createAdminCloseRouter(deps: AdminCloseRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  const closeDeps = () => ({
    db,
    gateway: deps.gateway,
    audit,
    notifier: deps.notifier,
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
    tokens: deps.tokens,
  });

  /* ── The queue (§33.7.12: an incomplete batch is visibly recoverable) ───── */

  router.get(ADMIN_CLOSE_BASE_PATH, admin, async (_req, res) => {
    const operations = await readCloseOperations(db);
    res.json({
      operations,
      // The register travels with the payload so the surface renders §21's
      // items by definition rather than by a second hardcoded list.
      reconciliationItems: RECONCILIATION_ITEMS,
      narrativeFields: RESULTS_NARRATIVE_FIELDS,
    });
  });

  router.get(`${ADMIN_CLOSE_BASE_PATH}/:campaignId`, admin, async (req, res) => {
    const campaignId = String(req.params['campaignId']);
    const detail = await readCloseBatchDetail(db, campaignId);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const reconciliation = await readReconciliation(db, campaignId);
    res.json({ detail, reconciliation });
  });

  /**
   * Resume an interrupted batch — and, when the window has already passed, the
   * window's end. Both are the same idempotent machines the sweep runs:
   * "retry does not double-charge or duplicate receipts" (§33.7.12) is the
   * stable attempt keys and the per-entity dedups, not this route being
   * careful.
   */
  router.post(`${ADMIN_CLOSE_BASE_PATH}/:campaignId/resume`, admin, fresh, json, async (req, res) => {
    const campaignId = String(req.params['campaignId']);
    const actor = actorOf(req);

    const batch = await runCloseBatch(closeDeps(), { campaignId, actor });
    const windowEnd = await endRetryWindow(closeDeps(), { campaignId, actor });

    await audit({
      action: 'close.batch_resumed_by_admin',
      targetType: 'campaign',
      targetId: campaignId,
      internalReason:
        `Admin resumed the close machine: batch ${batch.status}` +
        `${windowEnd.status !== 'not_due' && windowEnd.status !== 'not_found' ? `, retry window ${windowEnd.status}` : ''}. ` +
        'Every retried attempt reused its stable key (§33.7.7).',
      actorId: actor,
    });

    res.json({ batch, windowEnd });
  });

  /* ── §21 reconciliation: one recorded verification per item ─────────────── */

  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/:campaignId/reconciliation`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (
        typeof b['itemKey'] !== 'string' ||
        typeof b['result'] !== 'string' ||
        typeof b['note'] !== 'string' ||
        !b['note'].trim()
      ) {
        res.status(422).json({
          error: { code: 'invalid_request', message: 'itemKey, result, and a non-blank note are required.' },
        });
        return;
      }

      const outcome = await recordReconciliationItem(
        { db, audit },
        {
          campaignId: String(req.params['campaignId']),
          itemKey: b['itemKey'],
          result: b['result'],
          note: b['note'],
          actor: actorOf(req),
        },
      );

      switch (outcome.status) {
        case 'recorded':
          res.status(201).json({ record: outcome.record });
          return;
        case 'unknown_item':
          res.status(422).json({
            error: {
              code: 'unknown_item',
              message: `"${outcome.itemKey}" is not a §21 reconciliation item.`,
            },
          });
          return;
        case 'invalid_result':
          res.status(422).json({
            error: { code: 'invalid_result', message: 'The result must be verified or discrepancy.' },
          });
          return;
        case 'retry_window_open':
          res.status(409).json({
            error: {
              code: 'retry_window_open',
              message: 'Reconciliation begins only after the retry window closes (§21).',
            },
          });
          return;
        case 'batch_incomplete':
          res.status(409).json({
            error: { code: 'batch_incomplete', message: 'The close batch has not completed — resume it first.' },
          });
          return;
        case 'not_reconcilable':
          res.status(409).json({ error: { code: 'not_reconcilable', current: outcome.current } });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  /* ── Results preparation: the narrative, the flag, and the one sender ───── */

  router.post(`${ADMIN_CLOSE_BASE_PATH}/:campaignId/results`, admin, fresh, json, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const narrative = {
      strongestSignal: typeof b['strongestSignal'] === 'string' ? b['strongestSignal'] : '',
      weakestSignal: typeof b['weakestSignal'] === 'string' ? b['weakestSignal'] : '',
      leadingSurveyReason: typeof b['leadingSurveyReason'] === 'string' ? b['leadingSurveyReason'] : '',
      whatThisProves: typeof b['whatThisProves'] === 'string' ? b['whatThisProves'] : '',
      whatThisDoesNotProve:
        typeof b['whatThisDoesNotProve'] === 'string' ? b['whatThisDoesNotProve'] : '',
    };

    const outcome = await prepareResults(
      {
        db,
        audit,
        ...(deps.notifier && deps.notificationContext
          ? {
              notifications: {
                db,
                notifier: deps.notifier,
                context: deps.notificationContext,
                tokens: deps.tokens,
              },
            }
          : {}),
      },
      { campaignId: String(req.params['campaignId']), narrative, actor: actorOf(req) },
    );

    switch (outcome.status) {
      case 'prepared':
        res.status(201).json({ results: outcome.results });
        return;
      case 'already_prepared':
        res.status(409).json({
          error: { code: 'already_prepared', message: 'Results were already prepared for this campaign.' },
        });
        return;
      case 'retry_window_open':
        res.status(409).json({
          error: {
            code: 'retry_window_open',
            message: 'The retry window is still open — results are prepared only after it closes (§21).',
            deadline: outcome.deadline?.toISOString() ?? null,
          },
        });
        return;
      case 'charge_retry_incomplete':
        res.status(409).json({
          error: { code: 'charge_retry_incomplete', current: outcome.current },
        });
        return;
      case 'reconciliation_incomplete':
        res.status(409).json({
          error: {
            code: 'reconciliation_incomplete',
            message: 'The charge/retry reconciliation items are not all verified.',
            missing: outcome.missing,
          },
        });
        return;
      case 'narrative_incomplete':
        res.status(422).json({
          error: {
            code: 'narrative_incomplete',
            message: 'Every §21 narrative field needs a real sentence.',
            missing: outcome.missing,
          },
        });
        return;
      default:
        res.status(404).json({ error: { code: 'not_found' } });
    }
  });

  return router;
}
