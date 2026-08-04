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
import {
  readCampaignEarnings,
  recordCompletionDecision,
  finalizeCreatorEarnings,
  approveEarningsForTransfer,
  createAffiliateTransfer,
  recordThankYou,
} from '../close/earnings.js';
import {
  COMPLETION_OUTCOMES,
  THANK_YOU_ELIGIBILITY_FACTS,
  type CompletionOutcomeKey,
} from '../close/earnings-logic.js';

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

  /* ── §22.1: the per-campaign Creator earnings queue (Phase 19a) ─────────── */

  router.get(`${ADMIN_CLOSE_BASE_PATH}/:campaignId/earnings`, admin, async (req, res) => {
    const rows = await readCampaignEarnings(db, String(req.params['campaignId']));
    if (!rows) {
      res.status(404).json({ error: { code: 'not_found' } });
      return;
    }
    res.json({
      creators: rows,
      // The registers travel with the payload — the surface renders §22.1's
      // outcomes and §22.2's facts by definition, not by a second list.
      completionOutcomes: COMPLETION_OUTCOMES,
      thankYouEligibilityFacts: THANK_YOU_ELIGIBILITY_FACTS,
    });
  });

  /**
   * §22.1's four money acts, in its own order: decide → finalize → approve →
   * transfer. Each is an idempotent service refusing by name; every one is a
   * §5.1 high-impact judgement, so all four take `fresh`.
   */
  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/creators/:associationId/completion`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const outcomeKey = typeof b['outcome'] === 'string' ? b['outcome'] : '';
      if (!COMPLETION_OUTCOMES.some((o) => o.key === outcomeKey)) {
        res.status(422).json({
          error: { code: 'unknown_outcome', message: `"${outcomeKey}" is not a §22.1 completion outcome.` },
        });
        return;
      }
      if (typeof b['deliverablesNote'] !== 'string' || !b['deliverablesNote'].trim()) {
        res.status(422).json({
          error: { code: 'invalid_request', message: 'A deliverables note is required (§1.3).' },
        });
        return;
      }

      const outcome = await recordCompletionDecision(closeDeps(), {
        associationId: String(req.params['associationId']),
        outcome: outcomeKey as CompletionOutcomeKey,
        deliverablesNote: b['deliverablesNote'],
        waiver: typeof b['waiver'] === 'string' && b['waiver'].trim() ? b['waiver'] : undefined,
        waiverAgreedByFounder: b['waiverAgreedByFounder'] === true,
        waiverAgreedByAdmin: b['waiverAgreedByAdmin'] === true,
        evidence:
          b['evidence'] && typeof b['evidence'] === 'object'
            ? (b['evidence'] as Record<string, unknown>)
            : undefined,
        actor: actorOf(req),
      });

      switch (outcome.status) {
        case 'recorded':
          res.status(201).json({ decision: outcome.decision, fixedAction: outcome.fixedAction });
          return;
        case 'already_decided':
          res.status(409).json({
            error: { code: 'already_decided', message: 'This outcome is already the recorded decision.' },
          });
          return;
        case 'not_closed':
          res.status(409).json({
            error: {
              code: 'not_closed',
              current: outcome.current,
              message: '§22.1 completion is verified after the retry window.',
            },
          });
          return;
        case 'waiver_incomplete':
          res.status(422).json({
            error: {
              code: 'waiver_incomplete',
              message: 'A waiver is recorded only when Founder AND Admin agreed (§22.1).',
            },
          });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/creators/:associationId/finalize`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await finalizeCreatorEarnings(closeDeps(), {
        associationId: String(req.params['associationId']),
        actor: actorOf(req),
      });
      switch (outcome.status) {
        case 'finalized':
          res.status(201).json({ earnings: outcome.earnings });
          return;
        case 'already_finalized':
          res.status(409).json({ error: { code: 'already_finalized' }, earnings: outcome.earnings });
          return;
        case 'no_completion_decision':
          res.status(409).json({
            error: {
              code: 'no_completion_decision',
              message: '§22.1 verifies deliverables before earnings finalize.',
            },
          });
          return;
        case 'no_locked_agreement':
          res.status(409).json({ error: { code: 'no_locked_agreement' } });
          return;
        case 'not_closed':
          res.status(409).json({ error: { code: 'not_closed', current: outcome.current } });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/creators/:associationId/approve`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await approveEarningsForTransfer(closeDeps(), {
        associationId: String(req.params['associationId']),
        actor: actorOf(req),
      });
      switch (outcome.status) {
        case 'approved':
          res.json({ earnings: outcome.earnings });
          return;
        case 'already_approved':
          res.status(409).json({ error: { code: 'already_approved' } });
          return;
        case 'nothing_to_transfer':
          res.status(409).json({
            error: {
              code: 'nothing_to_transfer',
              message: 'US$0.00 finalized is complete — there is no Transfer to approve.',
            },
          });
          return;
        case 'not_finalized':
          res.status(409).json({ error: { code: 'not_finalized', current: outcome.current } });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/creators/:associationId/transfer`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await createAffiliateTransfer(closeDeps(), {
        associationId: String(req.params['associationId']),
        actor: actorOf(req),
      });
      switch (outcome.status) {
        case 'created':
          res.status(201).json({ transfer: outcome.transfer });
          return;
        case 'already_created':
          res.status(409).json({ error: { code: 'already_created' }, transfer: outcome.transfer });
          return;
        case 'transfer_failed':
          // The raw provider message stays internal (§25.6); the route answers
          // with the fact and the recovery path.
          res.status(502).json({
            error: {
              code: 'transfer_failed',
              message: 'The provider call failed; the retry sweep will re-drive it under the same key.',
            },
          });
          return;
        case 'before_day_3':
          res.status(409).json({
            error: {
              code: 'before_day_3',
              message: `§22.1 permits the Transfer on or after Day 3 (${outcome.earliestAt.toISOString()}).`,
              earliestAt: outcome.earliestAt.toISOString(),
            },
          });
          return;
        case 'tax_gate_blocked':
          res.status(409).json({ error: { code: 'tax_gate_blocked', message: outcome.reason } });
          return;
        case 'recipient_account_not_ready':
          res.status(409).json({
            error: {
              code: 'recipient_account_not_ready',
              message: 'The Creator’s recipient account is not payouts-capable (§24.1).',
            },
          });
          return;
        case 'not_approved':
          res.status(409).json({ error: { code: 'not_approved', current: outcome.current } });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  /* ── §22.2: the discretionary thank-you (§33.8.14) ──────────────────────── */

  router.post(
    `${ADMIN_CLOSE_BASE_PATH}/creators/:associationId/thank-you`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kind = b['kind'] === 'payment' ? 'payment' : b['kind'] === 'recognition' ? 'recognition' : null;
      if (!kind || typeof b['reason'] !== 'string' || !b['reason'].trim()) {
        res.status(422).json({
          error: { code: 'invalid_request', message: 'A kind (recognition or payment) and a reason are required.' },
        });
        return;
      }

      // The amount is the Admin's typed value — nothing here computes,
      // estimates, or suggests one (§22.2).
      let amountCents: bigint | undefined;
      if (typeof b['amountCents'] === 'string' && /^\d+$/.test(b['amountCents'])) {
        amountCents = BigInt(b['amountCents']);
      }

      const outcome = await recordThankYou(closeDeps(), {
        associationId: String(req.params['associationId']),
        kind,
        amountCents,
        reason: b['reason'],
        minimumWorkCompleted: b['minimumWorkCompleted'] === true,
        clickThresholdMet: b['clickThresholdMet'] === true,
        brandAupCompliant: b['brandAupCompliant'] === true,
        approvalReference:
          typeof b['approvalReference'] === 'string' ? b['approvalReference'] : undefined,
        approvedBy: typeof b['approvedBy'] === 'string' ? b['approvedBy'] : undefined,
        taxTreatment: typeof b['taxTreatment'] === 'string' ? b['taxTreatment'] : undefined,
        actor: actorOf(req),
      });

      switch (outcome.status) {
        case 'recorded':
          res.status(201).json({ record: outcome.record });
          return;
        case 'duplicate_payment':
          res.status(409).json({
            error: { code: 'duplicate_payment', message: 'A thank-you payment already exists for this Creator (§22.2).' },
          });
          return;
        case 'listing_revenue_unresolved':
          res.status(409).json({ error: { code: 'listing_revenue_unresolved', message: outcome.reason } });
          return;
        case 'amount_exceeds_funding_source':
          res.status(409).json({
            error: {
              code: 'amount_exceeds_funding_source',
              message: '§22.2 funds this only from retained listing-fee revenue; the amount exceeds it.',
            },
          });
          return;
        case 'tax_gate_blocked':
          res.status(409).json({ error: { code: 'tax_gate_blocked', message: outcome.reason } });
          return;
        case 'recipient_account_not_ready':
          res.status(409).json({ error: { code: 'recipient_account_not_ready' } });
          return;
        case 'approval_missing':
          res.status(409).json({
            error: {
              code: 'approval_missing',
              message:
                'Without the recorded tax/accounting approval and path, recognition may be recorded but no money may be promised or sent (§22.2).',
            },
          });
          return;
        case 'eligibility_not_confirmed':
          res.status(409).json({
            error: {
              code: 'eligibility_not_confirmed',
              message: 'All three §22.2 eligibility facts must be confirmed before a payment.',
            },
          });
          return;
        default:
          res.status(404).json({ error: { code: 'not_found' } });
      }
    },
  );

  return router;
}
