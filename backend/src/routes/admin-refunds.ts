/**
 * Admin refund operations — Spec §24.8, §24.9, §26.6, §26.7 (Phase 20a).
 *
 * Reads are `admin`; recording a case, previewing an execution, and executing
 * take the freshness gate — §26.6's reauthentication requirement, applied
 * where the money moves. The execute route additionally requires the consumed
 * customer-consequence preview (16a's machine), so the four §26.6 requirements
 * are all mechanisms here: reauth (guard), preview (consumed row), idempotency
 * (the stable `reservation-refund:<allocationId>` key), immutable audit
 * (insert-only rows in every service).
 *
 * The registers travel with the queue payload so the surface renders §24.8's
 * causes and §24.9's exceptions by definition, never by a second hardcoded
 * list — and the §24.9 best-effort sentence rides along because no surface
 * discussing recovery may promise more (§24.9).
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { bigintSafeJson } from './json-safe.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import {
  recordRefundCase,
  previewRefundExecution,
  executeRefund,
  readRefundQueue,
  type RefundDeps,
} from '../refunds/service.js';
import {
  REFUND_CAUSES,
  IDEA_REFUND_EXCEPTIONS,
  PROOVD_FEE_TREATMENTS,
  BEST_EFFORT_RECOVERY_SENTENCE,
} from '../refunds/logic.js';

export const ADMIN_REFUNDS_BASE_PATH = '/api/admin/refunds';

export interface AdminRefundsRouterDeps {
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

const cents = z
  .string()
  .regex(/^\d+$/, 'integer cents as a string')
  .transform((v) => BigInt(v));

const recordCaseSchema = z.object({
  reservationId: z.string().uuid(),
  cause: z.enum([
    'founder_or_product',
    'affiliate_fraud_or_breach',
    'proovd_or_system_error',
    'backer_dispute_unrelated',
    'law_stripe_or_issuer',
  ]),
  affiliateTreatment: z.enum([
    'not_attributed',
    'earnings_remain',
    'cancel_unfinalized',
    'cancel_unpaid_invalid',
    'contractual_recovery',
  ]),
  proovdFeeTreatment: z.enum([
    'retained',
    'returned_elective',
    'returned_required_stripe',
    'returned_required_law',
  ]),
  affiliateInvalidCents: cents.nullish(),
  founderLiabilityCents: cents,
  evidence: z.string().min(1),
  recoveryNote: z.string().nullish(),
  mandate: z.string().nullish(),
  amountCents: cents,
  ideaExceptionReason: z
    .enum([
      'duplicate_charge',
      'wrong_amount',
      'charge_after_valid_cancellation',
      'unauthorized_transaction',
      'material_misrepresentation',
      'applicable_non_delivery',
      'campaign_killed_serious_violation',
      'required_by_law_or_network',
    ])
    .nullish(),
  providerRefundId: z.string().nullish(),
});

const executeSchema = z.object({
  previewId: z.string().uuid().nullish(),
});

export function createAdminRefundsRouter(deps: AdminRefundsRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /*
    Money in this product is `bigint` all the way down, and `JSON.stringify`
    throws on one. Several services here return Drizzle rows directly, so this
    is mounted on the ROUTER rather than remembered per route — see
    `routes/json-safe.ts`.
  */
  router.use(bigintSafeJson);

  const refundDeps = (): RefundDeps => ({
    db,
    gateway: deps.gateway,
    audit,
    notifier: deps.notifier,
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
    tokens: deps.tokens,
  });

  /* ── The queue: cases + Founder-issued refunds awaiting classification ──── */

  router.get(ADMIN_REFUNDS_BASE_PATH, admin, async (req, res) => {
    const campaignId =
      typeof req.query['campaignId'] === 'string' ? req.query['campaignId'] : undefined;
    const queue = await readRefundQueue(db, { campaignId });
    res.json({
      ...queue,
      causes: REFUND_CAUSES,
      ideaExceptions: IDEA_REFUND_EXCEPTIONS,
      proovdFeeTreatments: PROOVD_FEE_TREATMENTS,
      bestEffortRecovery: BEST_EFFORT_RECOVERY_SENTENCE,
    });
  });

  /* ── Recording the §24.8 case (freshness: it is a money decision) ────────── */

  router.post(`${ADMIN_REFUNDS_BASE_PATH}/case`, admin, fresh, json, async (req, res) => {
    const parsed = recordCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', detail: parsed.error.issues });
      return;
    }
    const outcome = await recordRefundCase(refundDeps(), {
      reservationId: parsed.data.reservationId,
      cause: parsed.data.cause,
      affiliateTreatment: parsed.data.affiliateTreatment,
      proovdFeeTreatment: parsed.data.proovdFeeTreatment,
      affiliateInvalidCents: parsed.data.affiliateInvalidCents ?? null,
      founderLiabilityCents: parsed.data.founderLiabilityCents,
      evidence: parsed.data.evidence,
      recoveryNote: parsed.data.recoveryNote ?? null,
      mandate: parsed.data.mandate ?? null,
      amountCents: parsed.data.amountCents,
      ideaExceptionReason: parsed.data.ideaExceptionReason ?? null,
      providerRefundId: parsed.data.providerRefundId ?? null,
      actor: actorOf(req),
    });
    if (outcome.status === 'refused') {
      res.status(422).json({ error: outcome.reason });
      return;
    }
    res.status(201).json({
      refund: {
        id: outcome.refund.id,
        reference: outcome.refund.reference,
        status: outcome.refund.status,
        amountCents: outcome.refund.amountCents.toString(),
      },
      allocationId: outcome.allocation.id,
    });
  });

  /* ── §26.6's preview, consumed exactly once by the execute below ─────────── */

  router.post(
    `${ADMIN_REFUNDS_BASE_PATH}/:refundId/preview`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await previewRefundExecution(db, {
        refundId: String(req.params['refundId']),
        issuedBy: actorOf(req),
      });
      if (!outcome.ok) {
        res.status(422).json({ error: outcome.reason });
        return;
      }
      res.json(outcome);
    },
  );

  /* ── Executing the refund (fresh + consumed preview + stable key) ─────────── */

  router.post(
    `${ADMIN_REFUNDS_BASE_PATH}/:refundId/execute`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = executeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', detail: parsed.error.issues });
        return;
      }
      const outcome = await executeRefund(refundDeps(), {
        refundId: String(req.params['refundId']),
        previewId: parsed.data.previewId ?? null,
        actor: actorOf(req),
      });
      if (outcome.status === 'refused') {
        res.status(422).json({ error: outcome.reason });
        return;
      }
      if (outcome.status === 'failed') {
        // The internal message stays internal; the surface reads the state.
        res.status(502).json({ status: 'failed' });
        return;
      }
      if (outcome.status === 'already_succeeded') {
        res.json({ status: 'already_succeeded' });
        return;
      }
      res.json({
        status: outcome.status,
        refund: {
          id: outcome.refund.id,
          reference: outcome.refund.reference,
          status: outcome.refund.status,
        },
      });
    },
  );

  return router;
}
