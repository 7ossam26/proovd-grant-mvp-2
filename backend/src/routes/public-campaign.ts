/**
 * The public campaign data endpoint — Spec §18, §33.6 (Phase 14b).
 *
 * `GET /api/campaign/:campaignId` returns the Backer-facing view the frontend
 * `CampaignPage` renders, plus the attribution the visitor's cookie resolves to
 * ("You came through [handle]", §18) and the ended state. Public and
 * session-less: a campaign page is read by anyone with the link.
 *
 * ── The winner cookie is read here, server-side ─────────────────────────────
 * The per-campaign attribution cookie is HttpOnly, so only the server reads it.
 * A direct return to this endpoint with a valid cookie resolves the same winner
 * it did before (§33.6.1's "direct return preserves") — this route never writes
 * a cookie, so nothing it does can replace one. Only `/c/:code` sets the winner.
 */

import { Router } from 'express';
import type { Database } from '../db/client.js';
import { buildPublicCampaign } from '../campaign/public-page.js';
import { resolveAttribution } from '../attribution/service.js';
import { attributionCookieName, verifyAttribution, parseCookieHeader } from '../attribution/cookies.js';

export interface PublicCampaignRouterDeps {
  db: Database;
  /** Verifies the winner cookie's signature. `BETTER_AUTH_SECRET`. */
  secret: string;
}

export function createPublicCampaignRouter(deps: PublicCampaignRouterDeps): Router {
  const router = Router();
  const { db, secret } = deps;

  router.get('/api/campaign/:campaignId', async (req, res) => {
    const campaignId = req.params.campaignId;
    // A non-UUID id is a mistyped or hostile path — the same 404 as a real id
    // that has no public page, so nothing distinguishes them.
    if (!/^[0-9a-fA-F-]{36}$/.test(campaignId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const result = await buildPublicCampaign(db, campaignId);
    if (!result) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    // Resolve the "You came through [handle]" attribution from the cookie, if any.
    let attribution: { handle: string | null; status: string } | null = null;
    const cookies = parseCookieHeader(req.headers.cookie);
    const payload = verifyAttribution(cookies[attributionCookieName(campaignId)], secret);
    if (payload) {
      const resolved = await resolveAttribution(db, {
        campaignId,
        trackingLinkId: payload.l,
      });
      if (resolved) attribution = { handle: resolved.handle, status: resolved.status };
    }

    res.json({
      campaign: result.campaign,
      ended: result.ended,
      indexable: result.indexable,
      attribution,
    });
  });

  return router;
}
