/**
 * The Founder's Creator-readiness and fixed-payment funding — Spec §16, §11,
 * §33.4.4.
 *
 * Two routes on the Founder authorization spine: every one resolves the campaign
 * through the caller's own claim (`findFounderCampaign`), and someone else's
 * campaign answers the identical 404 a missing one gets.
 *
 * ── The Founder cannot ask a Creator to begin early ─────────────────────────
 * §16 makes that a product constraint, not a guideline — so there is no route
 * that "nudges" a Creator, and the view carries `canAskToBegin: false`. What the
 * Founder can do is fund the secured Creator payment (§16 step 2), which is a
 * different thing entirely.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { findFounderCampaign } from '../workspace/service.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { beginAllocationFunding } from '../creator-payment/allocations.js';
import { buildFounderReadinessView } from '../creator-payment/views.js';

export interface FounderCreatorPaymentDeps {
  db: Database;
  auth: Auth;
  gateway: StripeGateway;
  audit: AuditWriter;
  appBaseUrl: string;
}

export function createFounderCreatorPaymentRouter(deps: FounderCreatorPaymentDeps): Router {
  const { db, auth, gateway, audit, appBaseUrl } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '16kb' });

  function notFound(res: express.Response): void {
    res.status(404).json({
      error: 'not_found',
      title: 'Campaign not found',
      whatHappened: 'We could not find that campaign on your account.',
      next: 'Go back to your campaigns.',
      support: '/support',
    });
  }

  async function resolveCampaign(req: express.Request, res: express.Response): Promise<string | null> {
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

  /* ── The two views' Founder half (§16) ─────────────────────────────────────── */

  router.get(
    '/api/founder/campaigns/:campaignId/creator-readiness',
    founder,
    async (req, res) => {
      const campaignId = await resolveCampaign(req, res);
      if (!campaignId) return;
      const view = await buildFounderReadinessView(db, gateway.mode, campaignId);
      res.json({ readiness: view });
    },
  );

  /* ── Funding the secured Creator payment (§16 step 2) ──────────────────────── */

  router.post(
    '/api/founder/campaigns/:campaignId/creators/:associationId/fund',
    founder,
    json,
    async (req, res) => {
      const campaignId = await resolveCampaign(req, res);
      if (!campaignId) return;

      const associationId = String(req.params['associationId'] ?? '');
      const [association] = await db
        .select({ id: campaignAffiliateAssociations.id })
        .from(campaignAffiliateAssociations)
        .where(
          and(
            eq(campaignAffiliateAssociations.id, associationId),
            eq(campaignAffiliateAssociations.campaignId, campaignId),
          ),
        )
        .limit(1);
      if (!association) {
        notFound(res);
        return;
      }

      const result = await beginAllocationFunding(
        {
          db,
          gateway,
          audit,
          successUrl: `${appBaseUrl}/campaigns/${campaignId}/creator-readiness?fund=paid`,
          cancelUrl: `${appBaseUrl}/campaigns/${campaignId}/creator-readiness?fund=canceled`,
        },
        {
          associationId,
          founderUserId: req.authUser?.id ?? '',
          founderEmail: req.authUser?.email ?? undefined,
          actor: `user:${req.authUser?.id ?? ''}`,
        },
      );

      if (!result.ok) {
        const status =
          result.code === 'already_funded'
            ? 409
            : result.code === 'provider_error'
              ? 503
              : 422;
        res.status(status).json({
          error: result.code,
          title: 'Funding cannot open yet',
          whatHappened: result.message,
          next: result.next,
          support: '/support',
        });
        return;
      }

      res.json({
        funding: {
          url: result.url,
          sessionId: result.sessionId,
          amountCents: result.amountCents.toString(),
          descriptor: 'PROOVD CREATOR PAY',
        },
      });
    },
  );

  return router;
}
