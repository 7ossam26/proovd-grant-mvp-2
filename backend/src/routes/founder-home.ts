/**
 * The Founder's live campaign home — Spec §20, §33.6.6–§33.6.8 (Phase 17a).
 *
 * ── Two writes, and the split is the whole design ───────────────────────────
 * `GET .../home` renders and advances nothing. `POST .../home/seen` is the
 * acknowledgement, and it is the only thing that moves the last-seen position.
 * §20 requires last-seen to advance "only after the rendered state is
 * successfully delivered", and a server cannot assert that about its own
 * response — see `live/glance.ts`. A surface whose render threw never calls the
 * second route, and the delta survives.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * There is no route here that edits campaign content, changes a reward, moves a
 * date, or adds a Creator. Live editing and mid-campaign addition are 17b's, and
 * the tier that "cannot be changed directly at all" (§20) is enforced the way the
 * repo has enforced every other such rule since Phase 10b: the absence of the
 * route is the enforcement, not a check inside one.
 *
 * There is also no route that posts an update on the Founder's behalf, and none
 * that dismisses an action without a reason. §20 asks for the reason, actor, and
 * time on every correction, and §31.9 counts them.
 */

import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { findFounderCampaign } from '../workspace/service.js';
import { readCampaignHome } from '../live/home.js';
import { readFounderResults } from '../close/results.js';
import { readFounderPaymentStatus, requestEarlyRemaining } from '../close/founder-payments.js';
import { readExplore } from '../live/explore.js';
import { acknowledgeDelivery } from '../live/glance.js';
import { acknowledgeMilestone } from '../live/thresholds.js';
import {
  recordActCorrection,
  withdrawSafetyOverride,
  listActCorrections,
} from '../live/act.js';
import {
  ACT_ACTION_KINDS,
  ACT_CORRECTION_KINDS,
  MILESTONE_KINDS,
  type ActActionKind,
  type ActCorrectionKind,
  type MilestoneKind,
} from '../live/logic.js';

export const FOUNDER_HOME_PATH = '/api/founder';

export interface FounderHomeRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  /** Phase 19b: the early-release request acknowledgement (§22.3). */
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
}

function notFound(res: express.Response): void {
  res.status(404).json({
    error: 'not_found',
    title: 'Campaign not found',
    whatHappened: 'We could not find that campaign on your account.',
    next: 'Go back to your campaigns. If you think this is wrong, contact support.',
    support: '/support',
  });
}

export function createFounderHomeRouter(deps: FounderHomeRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json = express.json({ limit: '64kb' });

  const actorId = (req: express.Request) => `user:${req.authUser?.id ?? ''}`;

  /** The session decides, never the parameter — `founder.ts`'s rule, restated. */
  async function resolve(
    req: express.Request,
    res: express.Response,
  ): Promise<string | null> {
    const campaign = await findFounderCampaign(db, {
      campaignId: String(req.params['campaignId'] ?? ''),
      founderUserId: req.authUser?.id ?? '',
    });
    if (!campaign) {
      notFound(res);
      return null;
    }
    return campaign.campaignId;
  }

  /* ── Glance, Act, Explore — one read (§20) ──────────────────────────────── */

  router.get(`${FOUNDER_HOME_PATH}/campaigns/:campaignId/home`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const home = await readCampaignHome(db, {
      campaignId,
      viewerUserId: req.authUser?.id ?? '',
    });
    if (!home) {
      notFound(res);
      return;
    }
    res.json({ home });
  });

  /**
   * §21's Founder results (Phase 18b). One read, two states: `preparing` — the
   * honest waiting state until `Results ready` has actually fired — and `ready`,
   * carrying every §21 number plus the Admin-reviewed narrative. Survey answers
   * appear only where the Backer consented, and Creators appear as public
   * handles only (§11) — both enforced in the read itself.
   */
  router.get(`${FOUNDER_HOME_PATH}/campaigns/:campaignId/results`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const results = await readFounderResults(db, { campaignId, stampViewed: true });
    if (!results) {
      notFound(res);
      return;
    }
    res.json({ results });
  });

  /**
   * §22.3's Founder payment status (Phase 19b) — the SAME
   * `readFounderPaymentStatus` view the Admin queue reads, so the two can
   * never disagree on an amount, a status, or a reason (§33.8.13). It answers
   * the §22.3 list: exact amount affected, requirement or blocker, secure
   * action, submitted/verified state, next review date, and `No action needed`
   * while under review.
   */
  router.get(`${FOUNDER_HOME_PATH}/campaigns/:campaignId/payments`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const payments = await readFounderPaymentStatus(db, { campaignId });
    if (!payments) {
      notFound(res);
      return;
    }
    res.json({ payments });
  });

  /**
   * §22.3's early remaining payment request (Phase 19b). Recording it promises
   * nothing — the §6 setting's own words: each request is evidence-gated and
   * decided by an Admin. One pending request per campaign.
   */
  router.post(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/early-remaining-request`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const message = String((req.body as Record<string, unknown>)['message'] ?? '').trim();
      if (!message) {
        res.status(422).json({
          error: 'message_required',
          title: 'That request could not be recorded',
          whatHappened: 'An early-release request says what is ready and for whom.',
          next: 'Describe what affected Backers can already reach, then send it again.',
        });
        return;
      }

      const outcome = await requestEarlyRemaining(
        {
          db,
          audit,
          notifier: deps.notifier,
          ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
        },
        { campaignId, requestedBy: actorId(req), message },
      );

      switch (outcome.status) {
        case 'requested':
          res.status(201).json({ request: outcome.request });
          return;
        case 'already_pending':
          res.status(409).json({
            error: 'already_pending',
            title: 'A request is already waiting',
            whatHappened: 'Your earlier early-release request has not been decided yet.',
            next: 'You will receive the decision with its reason. No action needed.',
          });
          return;
        case 'wrong_model':
          res.status(409).json({
            error: 'wrong_model',
            title: 'This campaign has one payment',
            whatHappened: 'Only a Product campaign has a remaining payment to release early.',
            next: 'Nothing has changed.',
          });
          return;
        case 'not_closed':
          res.status(409).json({
            error: 'not_closed',
            title: 'Your campaign has not closed yet',
            whatHappened: 'Early release is decided after close, once charges settle.',
            next: 'Nothing has changed.',
          });
          return;
        default:
          notFound(res);
      }
    },
  );

  /**
   * §33.6.6. The acknowledgement, and the only thing that advances last-seen.
   *
   * Answers 200 on an already-acknowledged receipt rather than an error: a client
   * retrying after a dropped connection has done nothing wrong, and the trigger
   * has already made the second one a no-op.
   */
  router.post(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/seen`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const deliveryId = String((req.body as Record<string, unknown>)['deliveryId'] ?? '');
      if (!deliveryId) {
        res.status(422).json({
          error: 'delivery_required',
          title: 'That acknowledgement could not be recorded',
          whatHappened: 'An acknowledgement names the render it is confirming.',
          next: 'Reload the page. Nothing has changed.',
        });
        return;
      }

      const outcome = await acknowledgeDelivery(db, {
        deliveryId,
        campaignId,
        viewerUserId: req.authUser?.id ?? '',
      });

      if (!outcome.ok && outcome.code === 'not_found') {
        notFound(res);
        return;
      }
      res.json({
        acknowledged: true,
        advanced: outcome.ok ? outcome.advanced : false,
      });
    },
  );

  /* ── Explore on its own, for a refresh that does not re-issue a receipt ─── */

  router.get(`${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/explore`, founder, async (req, res) => {
    const campaignId = await resolve(req, res);
    if (!campaignId) return;

    const explore = await readExplore(db, { campaignId });
    if (!explore) {
      notFound(res);
      return;
    }
    res.json({ explore });
  });

  /* ── §20: correcting the ranked action (§31.9) ──────────────────────────── */

  router.post(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/act/corrections`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const body = req.body as Record<string, unknown>;
      const actionKind = String(body['actionKind'] ?? '');
      const correctionKind = String(body['correctionKind'] ?? '');

      if (!(ACT_ACTION_KINDS as readonly string[]).includes(actionKind)) {
        res.status(422).json({
          error: 'unknown_action',
          title: 'That action is not one of the five',
          whatHappened: '§20 names five ranked actions and a correction has to name one of them.',
          next: 'Reload the page and try again.',
        });
        return;
      }
      if (!(ACT_CORRECTION_KINDS as readonly string[]).includes(correctionKind)) {
        res.status(422).json({
          error: 'unknown_correction',
          title: 'That correction kind is not recorded',
          whatHappened:
            'A correction is a correction, a dismissal, a reclassification, or a documented safety override.',
          next: 'Reload the page and try again.',
        });
        return;
      }

      const outcome = await recordActCorrection(
        db,
        { audit },
        {
          campaignId,
          actionKind: actionKind as ActActionKind,
          correctionKind: correctionKind as ActCorrectionKind,
          priorRank: Number(body['priorRank'] ?? 0),
          ...(body['newRank'] !== undefined ? { newRank: Number(body['newRank']) } : {}),
          reason: String(body['reason'] ?? ''),
          actor: actorId(req),
          ...(typeof body['sourceTable'] === 'string' ? { sourceTable: body['sourceTable'] } : {}),
          ...(typeof body['sourceId'] === 'string' ? { sourceId: body['sourceId'] } : {}),
        },
      );

      if (!outcome.ok) {
        res.status(outcome.code === 'override_exists' ? 409 : 422).json({
          error: outcome.code,
          title: 'That correction was not recorded',
          whatHappened: outcome.message,
          next: 'Nothing on this page has changed.',
        });
        return;
      }

      res.status(201).json({ correction: outcome.correction });
    },
  );

  router.delete(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/act/override`,
    founder,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const withdrawn = await withdrawSafetyOverride(db, { audit }, {
        campaignId,
        actor: actorId(req),
      });
      res.json({ withdrawn });
    },
  );

  router.get(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/act/corrections`,
    founder,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;
      res.json({ corrections: await listActCorrections(db, campaignId) });
    },
  );

  /* ── §20: moving a milestone to history ─────────────────────────────────── */

  router.post(
    `${FOUNDER_HOME_PATH}/campaigns/:campaignId/home/milestones/:kind/seen`,
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolve(req, res);
      if (!campaignId) return;

      const kind = String(req.params['kind'] ?? '');
      if (!(MILESTONE_KINDS as readonly string[]).includes(kind)) {
        notFound(res);
        return;
      }

      const moved = await acknowledgeMilestone(db, {
        campaignId,
        kind: kind as MilestoneKind,
        actor: actorId(req),
      });
      res.json({ movedToHistory: moved });
    },
  );

  return router;
}
