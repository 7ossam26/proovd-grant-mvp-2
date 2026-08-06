/**
 * The §34 live-mode gate, as an Admin surface — Spec §34, §6, §2.2, Appendix C
 * (Phase 24).
 *
 * Reads are `admin`. Every write takes the freshness gate: filing a §34
 * answer, enabling live mode for a pilot, and rolling it back are the three
 * most consequential actions in the product, and §26.6's reauthentication
 * requirement is exactly for these. That is not the reflexive gating
 * `admin.ts` has warned about since Phase 06a — these are rare, deliberate
 * acts, which is the condition under which a reauthentication prompt still
 * means something.
 *
 * ── There is no override, and nowhere to add one ────────────────────────────
 * The same posture as `/admin/prerequisites` since Phase 06a. No route sets
 * `open`, no route skips a condition, and `enablePilotCampaign` reads the gate
 * itself rather than taking it from the caller — so there is no request body
 * that opens live mode. §34 is released by satisfying it.
 *
 * The registers travel with the payload so the surface renders §34's eleven
 * conditions, Appendix C's four statements, and the five rollback-plan fields
 * by definition, never from a second hardcoded list.
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  fileLiveModeCondition,
  readLiveModeGate,
  type LiveModeEnvironment,
} from '../live-mode/gate.js';
import {
  enablePilotCampaign,
  readAppendixCCoverage,
  readLivePilot,
  recordAppendixCWalkthrough,
  recordPilotPreflight,
  rollBackPilot,
} from '../live-mode/pilot.js';
import {
  APPENDIX_C_ACTORS,
  APPENDIX_C_STEP_KEYS,
  PILOT_PREFLIGHT_KEYS,
} from '../live-mode/logic.js';

export const ADMIN_LIVE_MODE_BASE_PATH = '/api/admin/live-mode';

export interface AdminLiveModeRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  environment: LiveModeEnvironment;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

const fileConditionSchema = z.object({
  conditionKey: z.string().min(1),
  status: z.enum(['satisfied', 'not_satisfied']),
  verifiedBy: z.string().min(1),
  findings: z.string().min(1),
  evidenceReference: z.string().nullish(),
});

const ownerSchema = z.object({
  role: z.enum(['monitoring', 'rollback']),
  name: z.string(),
  contact: z.string(),
  acknowledgedBy: z.string(),
});

const enableSchema = z.object({
  campaignId: z.string().uuid(),
  owners: z.array(ownerSchema).min(1),
  rollbackPlan: z.object({
    triggers: z.string(),
    decisionMaker: z.string(),
    mechanism: z.string(),
    inFlightReservations: z.string(),
    partyCommunication: z.string(),
  }),
});

const rollbackSchema = z.object({
  reason: z.string().min(1),
});

const preflightSchema = z.object({
  checkKey: z.string().min(1),
  findings: z.string().min(1),
});

const walkthroughSchema = z.object({
  actor: z.string().min(1),
  stepKey: z.string().min(1),
  result: z.enum(['passed', 'failed']),
  findings: z.string().min(1),
  undocumentedKnowledgeRequired: z.string().nullish(),
});

export function createAdminLiveModeRouter(deps: AdminLiveModeRouterDeps): Router {
  const { db, auth, audit, environment } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── The gate ───────────────────────────────────────────────────────────── */

  router.get(ADMIN_LIVE_MODE_BASE_PATH, admin, async (_req, res) => {
    const [gate, pilot] = await Promise.all([
      readLiveModeGate(db, environment),
      readLivePilot(db),
    ]);
    const appendixC = await readAppendixCCoverage(db, APPENDIX_C_STEP_KEYS);

    res.json({
      gate,
      pilot,
      appendixC,
      stripeMode: environment.stripeMode,
      /**
       * §2.1, both directions. Derived from condition 1 rather than stored, so
       * "the conditional architecture sentence is correct" and "it is now
       * stale" can never disagree with whether approval actually exists.
       */
      approvalCopyState: gate.conditions.find((c) => c.key === 'payment_architecture')
        ?.satisfied
        ? 'conditional_copy_is_now_stale'
        : 'conditional_copy_is_correct',
    });
  });

  /* ── Filing one of the nine answers ─────────────────────────────────────── */

  router.post(
    `${ADMIN_LIVE_MODE_BASE_PATH}/conditions`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = fileConditionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: 'invalid', detail: parsed.error.flatten() });
        return;
      }

      const result = await fileLiveModeCondition(db, {
        conditionKey: parsed.data.conditionKey,
        status: parsed.data.status,
        verifiedBy: parsed.data.verifiedBy,
        findings: parsed.data.findings,
        evidenceReference: parsed.data.evidenceReference ?? undefined,
      });
      if (!result.ok) {
        res.status(422).json({ error: 'refused', message: result.message });
        return;
      }

      await audit({
        action: 'live_mode.condition_filed',
        targetType: 'live_mode_condition',
        targetId: parsed.data.conditionKey,
        internalReason: parsed.data.findings,
        actorId: actorOf(req),
        newValue: { status: parsed.data.status, verifiedBy: parsed.data.verifiedBy },
      });

      res.status(201).json({ ok: true });
    },
  );

  /* ── Enabling the one pilot ─────────────────────────────────────────────── */

  router.post(`${ADMIN_LIVE_MODE_BASE_PATH}/pilot`, admin, fresh, json, async (req, res) => {
    const parsed = enableSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid', detail: parsed.error.flatten() });
      return;
    }

    // Read here, never taken from the caller. There is no request body that
    // opens live mode.
    const gate = await readLiveModeGate(db, environment);
    const result = await enablePilotCampaign(db, gate, {
      campaignId: parsed.data.campaignId,
      enabledBy: actorOf(req),
      owners: parsed.data.owners,
      rollbackPlan: parsed.data.rollbackPlan,
    });

    if (!result.ok) {
      res.status(422).json({ error: 'refused', violations: result.violations });
      return;
    }

    await audit({
      action: 'live_mode.pilot_enabled',
      targetType: 'campaign',
      targetId: parsed.data.campaignId,
      internalReason: 'The §34 gate is open and this campaign is the named pilot.',
      actorId: actorOf(req),
      newValue: { enablementId: result.enablementId, owners: parsed.data.owners },
    });

    res.status(201).json({ ok: true, enablementId: result.enablementId });
  });

  /* ── The rollback ───────────────────────────────────────────────────────── */

  router.post(
    `${ADMIN_LIVE_MODE_BASE_PATH}/rollback`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = rollbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: 'invalid', detail: parsed.error.flatten() });
        return;
      }

      const result = await rollBackPilot(db, {
        rolledBackBy: actorOf(req),
        reason: parsed.data.reason,
      });
      if (!result.ok) {
        res.status(422).json({ error: 'refused', message: result.message });
        return;
      }

      await audit({
        action: 'live_mode.pilot_rolled_back',
        targetType: 'live_mode_pilot',
        targetId: null,
        internalReason: parsed.data.reason,
        actorId: actorOf(req),
      });

      res.status(200).json({ ok: true });
    },
  );

  /* ── The three pre-first-reservation confirmations ──────────────────────── */

  router.post(
    `${ADMIN_LIVE_MODE_BASE_PATH}/preflight`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = preflightSchema.safeParse(req.body);
      if (!parsed.success || !PILOT_PREFLIGHT_KEYS.includes(parsed.data?.checkKey ?? '')) {
        res.status(422).json({ error: 'invalid' });
        return;
      }

      const result = await recordPilotPreflight(db, {
        checkKey: parsed.data.checkKey,
        confirmedBy: actorOf(req),
        findings: parsed.data.findings,
      });
      if (!result.ok) {
        res.status(422).json({ error: 'refused', message: result.message });
        return;
      }

      res.status(201).json({ ok: true });
    },
  );

  /* ── Appendix C — one recorded walk ─────────────────────────────────────── */

  router.post(
    `${ADMIN_LIVE_MODE_BASE_PATH}/appendix-c`,
    admin,
    json,
    async (req, res) => {
      const parsed = walkthroughSchema.safeParse(req.body);
      if (!parsed.success || !APPENDIX_C_ACTORS.includes(parsed.data?.actor ?? '')) {
        res.status(422).json({ error: 'invalid' });
        return;
      }

      const result = await recordAppendixCWalkthrough(db, {
        actor: parsed.data.actor,
        stepKey: parsed.data.stepKey,
        result: parsed.data.result,
        walkedBy: actorOf(req),
        findings: parsed.data.findings,
        undocumentedKnowledgeRequired:
          parsed.data.undocumentedKnowledgeRequired ?? undefined,
      });
      if (!result.ok) {
        res.status(422).json({ error: 'refused', message: result.message });
        return;
      }

      res.status(201).json({ ok: true });
    },
  );

  return router;
}
