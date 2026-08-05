/**
 * Fulfillment, Day 14, and the ghost ban — Spec §22.4–§22.7 (Phase 21a).
 *
 * Two routers on one module because they serve the same records from opposite
 * sides, and §22.4 requires the Founder and the Admin to see the SAME checklist
 * and the same evidence list — keeping the two reads in one file is what makes
 * "the same" checkable rather than aspirational.
 *
 * ── Authorization ──────────────────────────────────────────────────────────
 * Founder routes resolve the campaign through `findFounderCampaign`, which
 * joins the caller's own claim profile INSIDE the query, so another Founder's
 * campaign answers the same 404 a non-existent one does (Phase 09a's rule).
 * Admin reads are `admin`; every decision — the Day 14 outcome, a delivery-date
 * approval, and the ban — takes the freshness gate, because each is a
 * high-impact act in §26.6's sense and the ban is irreversible.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * There is no route that lifts a ban, no route that edits a recorded delivery
 * commitment, no route that re-decides a Day 14 review, and no route that
 * writes a delivery date without going through `applyDeliveryRevision`. Each
 * absence is the enforcement of a §22.5/§22.6/§22.7 rule; the database refuses
 * as well, but a route that does not exist cannot be called by mistake.
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { TokenService } from '../auth/token-service.js';
import { requireAdmin, requireFreshSession, requireRole } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { findFounderCampaign } from '../workspace/service.js';
import {
  applyDeliveryRevision,
  decideDeliveryChange,
  readFulfillmentStatus,
  recordCloseConfirmation,
  recordDelivery,
  recordOriginalCommitment,
  requestDeliveryChange,
  setDeliveryMechanism,
  buildDisclosedCommitmentText,
  type FulfillmentDeps,
} from '../fulfillment/service.js';
import {
  decideDay14Review,
  openDay14Review,
  readDay14Checklist,
  readDay14Queue,
  recordDay14ClarificationResponse,
  requestDay14Clarification,
  submitDay14Evidence,
  type Day14Deps,
} from '../fulfillment/day14.js';
import {
  gatherGhostBanFacts,
  readGhostBanCandidates,
  recordGhostBan,
  type GhostBanDeps,
} from '../fulfillment/ghost-ban.js';
import {
  DELIVERY_MECHANISMS,
  DELIVERY_MECHANISM_LABELS,
  DAY_14_FAILURE_REASONS,
  DAY_14_FAILURE_LABELS,
  GHOST_BAN_TRIGGERS,
  GHOST_BAN_TRIGGER_LABELS,
  GHOST_BAN_RECORD_FIELDS,
  GHOST_BAN_PERMANENT_SENTENCE,
  MATERIAL_UPDATE_FIELDS,
} from '../fulfillment/logic.js';

export const FOUNDER_FULFILLMENT_BASE_PATH = '/api/founder';
export const ADMIN_FULFILLMENT_BASE_PATH = '/api/admin/fulfillment';

export interface FulfillmentRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  tokens?: TokenService | undefined;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

const monthish = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD');
const dateish = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const mechanismSchema = z.object({
  mechanism: z.enum(DELIVERY_MECHANISMS),
  accessInstructions: z.string().min(1),
});

const originalCommitmentSchema = z.object({
  deliveryMonth: monthish,
  deliveryDate: dateish.nullish(),
  commitmentText: z.string().min(1),
});

const changeFieldsSchema = z.object({
  proposedDeliveryMonth: monthish,
  proposedDeliveryDate: dateish.nullish(),
  reason: z.string().min(1),
  unchangedObligations: z.string().min(1),
  nextUpdateDate: dateish,
  supportRefundRoute: z.string().min(1),
});

const revisionSchema = changeFieldsSchema.extend({
  commitmentText: z.string().min(1),
  changeRequestId: z.string().uuid().nullish(),
});

const evidenceSchema = z.object({
  items: z
    .array(
      z.object({
        itemKey: z.string().min(1),
        detail: z.string().min(1),
        url: z.string().url().nullish(),
      }),
    )
    .min(1),
});

const day14DecisionSchema = z.object({
  outcome: z.enum(['pass', 'fail']),
  adequateProgressEvidence: z.boolean(),
  requiredCommunication: z.boolean(),
  failureReasons: z.array(z.enum(DAY_14_FAILURE_REASONS)).default([]),
  internalReason: z.string().min(1),
  customerExplanation: z.string().min(1),
});

const banSchema = z.object({
  trigger: z.enum(GHOST_BAN_TRIGGERS),
  evidence: z.string().min(1),
  notice: z.string().min(1),
  paymentRecoveryStatus: z.string().min(1),
  enforcementDecision: z.string().min(1),
  internalReason: z.string().min(1),
});

/* ── The Founder's fulfillment surface ─────────────────────────────────────── */

export function createFounderFulfillmentRouter(deps: FulfillmentRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '64kb' });

  const fulfillmentDeps = (): FulfillmentDeps => ({
    db,
    audit,
    notifier: deps.notifier,
    context: deps.notificationContext,
    tokens: deps.tokens,
  });
  const day14Deps = (): Day14Deps => ({
    db,
    audit,
    notifier: deps.notifier,
    context: deps.notificationContext,
    tokens: deps.tokens,
  });

  async function ownCampaign(req: express.Request): Promise<string | null> {
    const campaignId = req.params.campaignId as string;
    const found = await findFounderCampaign(db, {
      campaignId,
      founderUserId: req.authUser!.id,
    });
    return found ? campaignId : null;
  }

  router.get('/campaigns/:campaignId/fulfillment', founder, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });

    const status = await readFulfillmentStatus(db, campaignId);
    if (!status) return res.status(404).json({ error: 'not_found' });

    res.json({
      ...status,
      // The registers travel with the payload so the surface renders §22.5's
      // mechanisms and §22.6's required fields by definition, not from a second
      // hardcoded list.
      mechanisms: DELIVERY_MECHANISMS.map((key) => ({
        key,
        label: DELIVERY_MECHANISM_LABELS[key],
      })),
      materialUpdateFields: MATERIAL_UPDATE_FIELDS,
      /** Offered so the Founder does not retype a promise the Backer already read. */
      disclosedCommitmentSuggestion: await buildDisclosedCommitmentText(db, campaignId),
    });
  });

  router.post('/campaigns/:campaignId/fulfillment/commitment', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = originalCommitmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await recordOriginalCommitment(fulfillmentDeps(), {
      campaignId,
      deliveryMonth: parsed.data.deliveryMonth,
      deliveryDate: parsed.data.deliveryDate ?? null,
      commitmentText: parsed.data.commitmentText,
      actor: actorOf(req),
    });
    if (outcome.status === 'recorded') return res.status(201).json(outcome);
    if (outcome.status === 'already_recorded') return res.status(200).json(outcome);
    return res.status(400).json({ error: outcome.status });
  });

  router.post('/campaigns/:campaignId/fulfillment/mechanism', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = mechanismSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await setDeliveryMechanism(fulfillmentDeps(), {
      campaignId,
      mechanism: parsed.data.mechanism,
      accessInstructions: parsed.data.accessInstructions,
      actor: actorOf(req),
    });
    if (outcome.status === 'saved') return res.json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json({ error: outcome.status });
  });

  router.post(
    '/campaigns/:campaignId/fulfillment/close-confirmation',
    founder,
    json,
    async (req, res) => {
      const campaignId = await ownCampaign(req);
      if (!campaignId) return res.status(404).json({ error: 'not_found' });
      const parsed = z.object({ updateId: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid' });

      const outcome = await recordCloseConfirmation(fulfillmentDeps(), {
        campaignId,
        updateId: parsed.data.updateId,
        actor: actorOf(req),
      });
      if (outcome.status === 'recorded') return res.json(outcome);
      return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json({ error: outcome.status });
    },
  );

  router.post('/campaigns/:campaignId/fulfillment/deliver', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });

    const outcome = await recordDelivery(fulfillmentDeps(), { campaignId, actor: actorOf(req) });
    if (outcome.status === 'delivered' || outcome.status === 'already_delivered') {
      return res.json(outcome);
    }
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json({ error: outcome.status });
  });

  /** §22.6's approval path: ask BEFORE Backers hear anything. */
  router.post('/campaigns/:campaignId/delivery-change', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = changeFieldsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await requestDeliveryChange(fulfillmentDeps(), {
      campaignId,
      actor: actorOf(req),
      ...parsed.data,
      proposedDeliveryDate: parsed.data.proposedDeliveryDate ?? null,
    });
    if (outcome.status === 'requested') return res.status(201).json(outcome);
    if (outcome.status === 'not_required') return res.status(200).json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json(outcome);
  });

  /** The ONE door that moves a delivery date, whichever path governs. */
  router.post('/campaigns/:campaignId/delivery-revision', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = revisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await applyDeliveryRevision(fulfillmentDeps(), {
      campaignId,
      actor: actorOf(req),
      ...parsed.data,
      proposedDeliveryDate: parsed.data.proposedDeliveryDate ?? null,
      changeRequestId: parsed.data.changeRequestId ?? null,
    });
    if (outcome.status === 'revised') return res.status(201).json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json(outcome);
  });

  /** §22.4: the SAME checklist the Admin reads. */
  router.get('/campaigns/:campaignId/day-14', founder, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });

    const checklist = await readDay14Checklist(db, campaignId);
    if (!checklist) return res.status(404).json({ error: 'not_found' });
    res.json(checklist);
  });

  router.post('/campaigns/:campaignId/day-14/evidence', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = evidenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await submitDay14Evidence(day14Deps(), {
      campaignId,
      items: parsed.data.items.map((i) => ({ ...i, url: i.url ?? null })),
      actor: actorOf(req),
    });
    if (outcome.status === 'submitted') return res.status(201).json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json(outcome);
  });

  router.post('/campaigns/:campaignId/day-14/clarification', founder, json, async (req, res) => {
    const campaignId = await ownCampaign(req);
    if (!campaignId) return res.status(404).json({ error: 'not_found' });
    const parsed = z
      .object({ requestId: z.string().uuid(), responseNote: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });

    const outcome = await recordDay14ClarificationResponse(day14Deps(), {
      requestId: parsed.data.requestId,
      responseNote: parsed.data.responseNote,
      actor: actorOf(req),
    });
    if (outcome.status === 'recorded') return res.json(outcome);
    return res.status(outcome.status === 'not_found' ? 404 : 409).json({ error: outcome.status });
  });

  return router;
}

/* ── The Admin surface ─────────────────────────────────────────────────────── */

export function createAdminFulfillmentRouter(deps: FulfillmentRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  const fulfillmentDeps = (): FulfillmentDeps => ({
    db,
    audit,
    notifier: deps.notifier,
    context: deps.notificationContext,
    tokens: deps.tokens,
  });
  const day14Deps = (): Day14Deps => ({
    db,
    audit,
    notifier: deps.notifier,
    context: deps.notificationContext,
    tokens: deps.tokens,
  });
  const banDeps = (): GhostBanDeps => ({ db, audit });

  /** The Day 14 queue: overdue first (16b's rule). */
  router.get('/day-14', admin, async (_req, res) => {
    const queue = await readDay14Queue(db);
    res.json({
      queue,
      failureReasons: DAY_14_FAILURE_REASONS.map((key) => ({
        key,
        label: DAY_14_FAILURE_LABELS[key],
      })),
    });
  });

  router.get('/campaigns/:campaignId', admin, async (req, res) => {
    const campaignId = req.params.campaignId as string;
    const [status, checklist, ban] = await Promise.all([
      readFulfillmentStatus(db, campaignId),
      readDay14Checklist(db, campaignId),
      gatherGhostBanFacts(db, campaignId),
    ]);
    if (!status || !checklist) return res.status(404).json({ error: 'not_found' });

    res.json({
      fulfillment: status,
      day14: checklist,
      ghostBan: ban
        ? {
            triggersMet: ban.triggersMet,
            labels: ban.labels,
            alreadyBanned: ban.alreadyBanned !== null,
            // §22.7's five recorded facts, so the form cannot omit one.
            requiredFields: GHOST_BAN_RECORD_FIELDS,
            permanentSentence: GHOST_BAN_PERMANENT_SENTENCE,
            triggers: GHOST_BAN_TRIGGERS.map((key) => ({
              key,
              label: GHOST_BAN_TRIGGER_LABELS[key],
              met: ban.triggersMet.includes(key),
            })),
          }
        : null,
    });
  });

  router.post('/campaigns/:campaignId/day-14/open', admin, fresh, json, async (req, res) => {
    const outcome = await openDay14Review(day14Deps(), {
      campaignId: req.params.campaignId as string,
    });
    if (outcome.status === 'opened') return res.status(201).json({ status: outcome.status });
    if (outcome.status === 'already_open') return res.json({ status: outcome.status });
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json({ error: outcome.status });
  });

  router.post('/campaigns/:campaignId/day-14/clarification', admin, fresh, json, async (req, res) => {
    const parsed = z.object({ question: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });

    const outcome = await requestDay14Clarification(day14Deps(), {
      campaignId: req.params.campaignId as string,
      question: parsed.data.question,
      actor: actorOf(req),
    });
    if (outcome.status === 'requested') return res.status(201).json(outcome);
    return res.status(400).json({ error: outcome.status });
  });

  router.post('/campaigns/:campaignId/day-14/decide', admin, fresh, json, async (req, res) => {
    const parsed = day14DecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await decideDay14Review(day14Deps(), {
      campaignId: req.params.campaignId as string,
      actor: actorOf(req),
      ...parsed.data,
    });
    if (outcome.status === 'decided') return res.status(201).json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json(outcome);
  });

  router.post('/delivery-changes/:requestId/decide', admin, fresh, json, async (req, res) => {
    const parsed = z
      .object({
        decision: z.enum(['approved', 'rejected']),
        baitAndSwitchFinding: z.string().min(1),
        paymentImpactFinding: z.string().min(1),
        internalReason: z.string().min(1),
        customerExplanation: z.string().min(1),
        commitmentText: z.string().min(1).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await decideDeliveryChange(fulfillmentDeps(), {
      requestId: req.params.requestId as string,
      actor: actorOf(req),
      ...parsed.data,
    });
    if (outcome.status === 'approved' || outcome.status === 'rejected') return res.json(outcome);
    return res.status(outcome.status === 'not_found' ? 404 : 400).json(outcome);
  });

  /**
   * The ban candidates. Every row has at least one MET trigger — the queue
   * cannot suggest a ban the record would not support (§33.10.4).
   */
  router.get('/ghost-ban/candidates', admin, async (_req, res) => {
    const candidates = await readGhostBanCandidates(db);
    res.json({
      candidates,
      triggers: GHOST_BAN_TRIGGERS.map((key) => ({ key, label: GHOST_BAN_TRIGGER_LABELS[key] })),
      requiredFields: GHOST_BAN_RECORD_FIELDS,
      permanentSentence: GHOST_BAN_PERMANENT_SENTENCE,
    });
  });

  router.post('/campaigns/:campaignId/ghost-ban', admin, fresh, json, async (req, res) => {
    const parsed = banSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });

    const outcome = await recordGhostBan(banDeps(), {
      campaignId: req.params.campaignId as string,
      actor: actorOf(req),
      ...parsed.data,
    });
    if (outcome.status === 'banned') return res.status(201).json(outcome);
    if (outcome.status === 'already_banned') return res.status(409).json(outcome);
    return res.status(outcome.status === 'campaign_not_found' ? 404 : 400).json(outcome);
  });

  return router;
}
