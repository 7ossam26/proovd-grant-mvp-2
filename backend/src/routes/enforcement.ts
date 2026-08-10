/**
 * §29 enforcement routes — Phase 20b.
 *
 * Admin side (`/api/admin/...`): the §29.4 affiliate enforcement action and
 * the appeal decision take the freshness gate (they change a person's standing
 * and their money's path); disclosures and the reads take `admin`. The Creator
 * side (`/api/creator/enforcement...`) lets the affected person see what was
 * recorded against them — the §29.4 customer statement, never the internal
 * reason — and submit their one appeal inside the window. The reacceptance
 * routes (`/api/account/policy-reacceptance`) live OUTSIDE the gated prefixes,
 * because a suspension you cannot end is a ban wearing a different word
 * (§29.8).
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { requireAdmin, requireFreshSession, requireRole } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import {
  affiliateEnforcementActions,
  affiliateEnforcementAppeals,
} from '../db/schema/enforcement.js';
import {
  decideAffiliateAppeal,
  listAffiliateEnforcement,
  recordAffiliateEnforcement,
  recordConflictDisclosure,
  recordSelfPreorderDisclosure,
  submitAffiliateAppeal,
  type AffiliateEnforcementDeps,
} from '../enforcement/affiliates.js';
import {
  acceptPolicyReacceptance,
  readOutstandingReacceptance,
  requirePolicyReacceptance,
  type ReacceptanceDeps,
} from '../enforcement/reacceptance.js';
import {
  AFFILIATE_ENFORCEMENT_ACTIONS,
  AFFILIATE_ENFORCEMENT_REASONS,
  CONFLICT_RELATIONSHIP_KINDS,
  TERMINATION_VALIDITY,
} from '../enforcement/logic.js';

export interface EnforcementRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

function securityContext(req: express.Request): { mfaContext: string; reauthContext: string } {
  const session = req.authSession;
  return {
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

const enforcementSchema = z.object({
  actionKind: z.enum(AFFILIATE_ENFORCEMENT_ACTIONS),
  reasonCategory: z.enum(AFFILIATE_ENFORCEMENT_REASONS),
  internalReason: z.string().min(1),
  evidenceAndBehavior: z.string().min(1),
  ruleViolated: z.string().min(1),
  immediateEffect: z.string().min(1),
  correctionPath: z.string().min(1),
  humanRoute: z.string().min(1),
  terminationValidity: z.enum(TERMINATION_VALIDITY).nullish(),
  evidenceLinks: z.record(z.string(), z.unknown()).optional(),
});

export function createEnforcementRouter(deps: EnforcementRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const creator = requireRole(auth, 'affiliate');
  const founderOrCreator = requireRole(auth, 'founder', 'affiliate');
  const json: RequestHandler = express.json({ limit: '64kb' });

  const serviceDeps = (): AffiliateEnforcementDeps => ({
    db,
    audit,
    notifier: deps.notifier,
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
  });
  const reacceptanceDeps = (): ReacceptanceDeps => ({
    db,
    audit,
    notifier: deps.notifier,
    ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
  });

  /* ── Admin: the §29.4 action ─────────────────────────────────────────────── */

  router.post(
    '/api/admin/associations/:associationId/enforcement',
    admin,
    fresh,
    json,
    async (req, res) => {
      const parsed = enforcementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', detail: parsed.error.issues });
        return;
      }
      const outcome = await recordAffiliateEnforcement(serviceDeps(), {
        associationId: req.params['associationId'] as string,
        actionKind: parsed.data.actionKind,
        reasonCategory: parsed.data.reasonCategory,
        internalReason: parsed.data.internalReason,
        evidenceAndBehavior: parsed.data.evidenceAndBehavior,
        ruleViolated: parsed.data.ruleViolated,
        immediateEffect: parsed.data.immediateEffect,
        correctionPath: parsed.data.correctionPath,
        humanRoute: parsed.data.humanRoute,
        terminationValidity: parsed.data.terminationValidity ?? null,
        evidenceLinks: parsed.data.evidenceLinks,
        actor: actorOf(req),
        ...securityContext(req),
      });
      if (!outcome.ok) {
        res
          .status(outcome.code === 'not_found' ? 404 : 422)
          .json({ error: outcome.code, message: outcome.message });
        return;
      }
      res.status(201).json({ action: outcome.action });
    },
  );

  router.get(
    '/api/admin/campaigns/:campaignId/affiliate-enforcement',
    admin,
    async (req, res) => {
      const actions = await listAffiliateEnforcement(db, req.params['campaignId'] as string);
      res.json({
        actions,
        registers: {
          actionKinds: AFFILIATE_ENFORCEMENT_ACTIONS,
          reasonCategories: AFFILIATE_ENFORCEMENT_REASONS,
          terminationValidity: TERMINATION_VALIDITY,
          conflictKinds: CONFLICT_RELATIONSHIP_KINDS,
        },
      });
    },
  );

  /* ── Admin: the appeal decision (final, §29.4) ───────────────────────────── */

  router.post(
    '/api/admin/appeals/:appealId/decide',
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const decision = body['decision'];
      if (decision !== 'upheld' && decision !== 'overturned') {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }
      const outcome = await decideAffiliateAppeal(serviceDeps(), {
        appealId: req.params['appealId'] as string,
        decision,
        note: typeof body['note'] === 'string' ? body['note'] : undefined,
        actor: actorOf(req),
      });
      if (!outcome.ok) {
        res
          .status(outcome.code === 'not_found' ? 404 : 422)
          .json({ error: outcome.code, message: outcome.message });
        return;
      }
      res.json(outcome);
    },
  );

  /* ── Admin: §29.1/§29.2 disclosures ──────────────────────────────────────── */

  router.post(
    '/api/admin/associations/:associationId/conflict-disclosures',
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const outcome = await recordConflictDisclosure(serviceDeps(), {
        associationId: req.params['associationId'] as string,
        relationshipKind: body['relationshipKind'] as never,
        detail: typeof body['detail'] === 'string' ? body['detail'] : '',
        disclosedBy: typeof body['disclosedBy'] === 'string' ? body['disclosedBy'] : 'admin',
        actor: actorOf(req),
      });
      if (!outcome.ok) {
        res
          .status(outcome.code === 'not_found' ? 404 : 422)
          .json({ error: outcome.code, message: outcome.message });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  router.post(
    '/api/admin/associations/:associationId/self-preorder-disclosures',
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const outcome = await recordSelfPreorderDisclosure(serviceDeps(), {
        associationId: req.params['associationId'] as string,
        reservationId: typeof body['reservationId'] === 'string' ? body['reservationId'] : null,
        intentNote: typeof body['intentNote'] === 'string' ? body['intentNote'] : '',
        selfFundedCertified: body['selfFundedCertified'] === true,
        identityDisclosed: body['identityDisclosed'] === true,
        actor: actorOf(req),
      });
      if (!outcome.ok) {
        res
          .status(outcome.code === 'not_found' ? 404 : 422)
          .json({ error: outcome.code, message: outcome.message });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  /* ── Admin: §29.8 requirement ────────────────────────────────────────────── */

  router.post('/api/admin/policy-reacceptance', admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const outcome = await requirePolicyReacceptance(reacceptanceDeps(), {
      slug: typeof body['slug'] === 'string' ? body['slug'] : '',
      version: typeof body['version'] === 'string' ? body['version'] : '',
      audience: body['audience'] as never,
      reason: typeof body['reason'] === 'string' ? body['reason'] : '',
      actor: actorOf(req),
    });
    if (!outcome.ok) {
      res
        .status(outcome.code === 'not_found' ? 404 : 422)
        .json({ error: outcome.code, message: outcome.message });
      return;
    }
    res.status(201).json(outcome);
  });

  /* ── Creator: what was recorded against me, and my one appeal ────────────── */

  router.get('/api/creator/enforcement', creator, async (req, res) => {
    const userId = req.authUser!.id;
    // The Creator's own associations, resolved through the signup profile —
    // §11's boundary: the customer statement renders; the internal reason and
    // the recording Admin never leave the record.
    const profileRows = await db
      .select({ associationId: affiliateSignupProfiles.associationId })
      .from(affiliateSignupProfiles)
      .where(eq(affiliateSignupProfiles.claimedUserId, userId));
    const associationIds = profileRows.map((r) => r.associationId);
    if (associationIds.length === 0) {
      res.json({ actions: [] });
      return;
    }
    const actions = await db
      .select()
      .from(affiliateEnforcementActions)
      .where(inArray(affiliateEnforcementActions.associationId, associationIds));
    const appeals =
      actions.length > 0
        ? await db
            .select()
            .from(affiliateEnforcementAppeals)
            .where(
              inArray(
                affiliateEnforcementAppeals.actionId,
                actions.map((a) => a.id),
              ),
            )
        : [];
    res.json({
      actions: actions.map((a) => {
        const appeal = appeals.find((p) => p.actionId === a.id) ?? null;
        return {
          actionId: a.id,
          associationId: a.associationId,
          actionKind: a.actionKind,
          evidenceAndBehavior: a.evidenceAndBehavior,
          ruleViolated: a.ruleViolated,
          immediateEffect: a.immediateEffect,
          correctionPath: a.correctionPath,
          humanRoute: a.humanRoute,
          appealDueAt: a.appealDueAt.toISOString(),
          occurredAt: a.occurredAt.toISOString(),
          appeal: appeal
            ? {
                submittedAt: appeal.submittedAt.toISOString(),
                decision: appeal.decision,
                decisionNote: appeal.decisionNote,
              }
            : null,
        };
      }),
    });
  });

  router.post(
    '/api/creator/enforcement/:actionId/appeal',
    creator,
    json,
    async (req, res) => {
      const userId = req.authUser!.id;
      const actionId = req.params['actionId'] as string;
      // Only the affected Creator may appeal; anyone else's action answers the
      // identical 404 a nonexistent one does.
      const [action] = await db
        .select({ associationId: affiliateEnforcementActions.associationId })
        .from(affiliateEnforcementActions)
        .where(eq(affiliateEnforcementActions.id, actionId))
        .limit(1);
      const [owned] = action
        ? await db
            .select({ id: affiliateSignupProfiles.associationId })
            .from(affiliateSignupProfiles)
            .where(
              and(
                eq(affiliateSignupProfiles.associationId, action.associationId),
                eq(affiliateSignupProfiles.claimedUserId, userId),
              ),
            )
            .limit(1)
        : [];
      if (!owned) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const outcome = await submitAffiliateAppeal(serviceDeps(), {
        actionId,
        grounds: typeof body['grounds'] === 'string' ? body['grounds'] : '',
        actor: actorOf(req),
      });
      if (!outcome.ok) {
        res
          .status(outcome.code === 'not_found' ? 404 : 422)
          .json({ error: outcome.code, message: outcome.message });
        return;
      }
      res.status(201).json(outcome);
    },
  );

  /* ── §29.8: read what is outstanding, and accept it ──────────────────────── */

  router.get('/api/account/policy-reacceptance', founderOrCreator, async (req, res) => {
    const audience = req.authUser!.role === 'founder' ? 'founder' : 'affiliate';
    const outstanding = await readOutstandingReacceptance(db, {
      userId: req.authUser!.id,
      audience,
    });
    res.json({ outstanding });
  });

  router.post('/api/account/policy-reacceptance', founderOrCreator, json, async (req, res) => {
    const audience = req.authUser!.role === 'founder' ? 'founder' : 'affiliate';
    const body = req.body as Record<string, unknown>;
    const outcome = await acceptPolicyReacceptance(reacceptanceDeps(), {
      userId: req.authUser!.id,
      audience,
      slug: typeof body['slug'] === 'string' ? body['slug'] : '',
      actor: actorOf(req),
    });
    if (!outcome.ok) {
      res.status(422).json({ error: outcome.code, message: outcome.message });
      return;
    }
    res.status(201).json(outcome);
  });

  return router;
}
