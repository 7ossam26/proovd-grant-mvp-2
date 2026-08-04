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
import { findFounderCampaign } from '../workspace/service.js';
import { readCampaignHome } from '../live/home.js';
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
