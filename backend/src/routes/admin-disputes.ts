/**
 * Admin dispute operations — Spec §24.11, §26.7 (Phase 20b).
 *
 * The queue leads with overdue 24-hour tasks. Reads are `admin`; the two
 * writes — recording the evidence assembly and classifying the case — take the
 * freshness gate: one is what Proovd submits to a card network, the other is a
 * §24.8 money decision.
 *
 * The classification route serves the same registers the refund-case form
 * reads (`REFUND_CAUSES`, treatments) so the surface is constrained by the
 * register, never a second hardcoded list — and the §24.9 best-effort sentence
 * rides along wherever recovery is discussed.
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { bigintSafeJson } from './json-safe.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  classifyDispute,
  readDisputeEvidencePacket,
  readDisputeQueue,
  recordDisputeEvidenceAssembly,
  type DisputeDeps,
} from '../disputes/service.js';
import {
  BEST_EFFORT_RECOVERY_SENTENCE,
  PROOVD_FEE_TREATMENTS,
  REFUND_CAUSES,
} from '../refunds/logic.js';
import { DISPUTE_EVIDENCE_ITEMS } from '../disputes/logic.js';

export const ADMIN_DISPUTES_BASE_PATH = '/api/admin/disputes';

export interface AdminDisputesRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  gateway: StripeGateway;
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

const cents = z
  .string()
  .regex(/^\d+$/, 'integer cents as a string')
  .transform((v) => BigInt(v));

const classifySchema = z.object({
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
});

export function createAdminDisputesRouter(deps: AdminDisputesRouterDeps): Router {
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

  const disputeDeps = (): DisputeDeps => ({
    db,
    gateway: deps.gateway,
    audit,
    notifier: deps.notifier,
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
  });

  /* ── The queue: overdue 24-hour tasks first (§24.11) ─────────────────────── */

  router.get(ADMIN_DISPUTES_BASE_PATH, admin, async (req, res) => {
    const campaignId =
      typeof req.query['campaignId'] === 'string' ? req.query['campaignId'] : undefined;
    const queue = await readDisputeQueue(db, { campaignId });
    res.json({
      ...queue,
      causes: REFUND_CAUSES,
      proovdFeeTreatments: PROOVD_FEE_TREATMENTS,
      evidenceItems: DISPUTE_EVIDENCE_ITEMS,
      bestEffortRecovery: BEST_EFFORT_RECOVERY_SENTENCE,
    });
  });

  /* ── The assembled §24.11 packet, composed live from stored records ──────── */

  router.get(`${ADMIN_DISPUTES_BASE_PATH}/:disputeId/evidence`, admin, async (req, res) => {
    const packet = await readDisputeEvidencePacket(db, req.params['disputeId'] as string);
    if (!packet) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(packet);
  });

  /* ── Recording the assembly (§26.7, §1.3) ───────────────────────────────── */

  router.post(
    `${ADMIN_DISPUTES_BASE_PATH}/:disputeId/evidence`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const outcome = await recordDisputeEvidenceAssembly(disputeDeps(), {
        disputeId: req.params['disputeId'] as string,
        actor: actorOf(req),
      });
      if (outcome.status === 'refused') {
        res.status(outcome.reason === 'not_found' ? 404 : 422).json({
          error: outcome.reason,
          ...(outcome.missing ? { missing: outcome.missing } : {}),
        });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  /* ── The §24.8 classification (a money decision: freshness) ──────────────── */

  router.post(
    `${ADMIN_DISPUTES_BASE_PATH}/:disputeId/classify`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = classifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', detail: parsed.error.issues });
        return;
      }
      const outcome = await classifyDispute(disputeDeps(), {
        disputeId: req.params['disputeId'] as string,
        cause: parsed.data.cause,
        affiliateTreatment: parsed.data.affiliateTreatment,
        proovdFeeTreatment: parsed.data.proovdFeeTreatment,
        affiliateInvalidCents: parsed.data.affiliateInvalidCents ?? null,
        founderLiabilityCents: parsed.data.founderLiabilityCents,
        evidence: parsed.data.evidence,
        recoveryNote: parsed.data.recoveryNote ?? null,
        mandate: parsed.data.mandate ?? null,
        actor: actorOf(req),
      });
      if (outcome.status === 'refused') {
        res.status(outcome.reason === 'not_found' ? 404 : 422).json({ error: outcome.reason });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  return router;
}
