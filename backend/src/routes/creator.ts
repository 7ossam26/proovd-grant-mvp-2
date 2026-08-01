/**
 * The signed-in Creator's surface — Spec §10, §31.5, §5.3, §33.2.4.
 *
 * The first session-bearing routes for an actor other than Admin. §10's handoff
 * is to "every eligible **authenticated** Affiliate", and 08b burned the
 * invitation token when it created the account — so from here on a Creator
 * arrives with a session, not a link.
 *
 * ── Everything here is scoped by the session, not by a parameter ────────────
 * `requireRole(auth, 'affiliate')` establishes who is asking, and every read
 * below filters on that user id inside the query. There is no campaign id in a
 * request that is not first checked against the caller's own associations, and
 * an association belonging to someone else answers `not_found` — the same
 * answer as one that does not exist, so nothing can be enumerated.
 *
 * ── No TOTP here, and that is §5.1's rule, not an omission ─────────────────
 * §5.1 makes a second factor mandatory for Admin. §5.3 gives the Affiliate
 * "email + password, private campaign-specific invitation only". Requiring a
 * factor the Spec does not ask for would lock out every Creator who signed up
 * under 08b, and inventing an authentication policy is as much a §1 rule 6
 * violation as inventing a commercial one.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * Accept, decline, propose, activate. §10: the Creator "cannot accept, decline,
 * propose compensation, activate a link, or begin work until listing-fee
 * payment makes the formal opportunity actionable." Those are Phase 12's, and
 * there is no route here to reach them early — not a disabled one, absent.
 */

import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireRole } from '../auth/guards.js';
import { readPreparingKit, listCreatorCampaigns } from '../affiliates/kit.js';

export const CREATOR_PATH = '/api/creator';

export function createCreatorRouter(db: Database, auth: Auth): Router {
  const router = Router();
  const creator = requireRole(auth, 'affiliate');

  function actorId(req: express.Request): string {
    return req.authUser?.id ?? '';
  }

  /** The Creator's own campaigns. Scoped by session; no id in the request. */
  router.get(`${CREATOR_PATH}/campaigns`, creator, async (req, res) => {
    const rows = await listCreatorCampaigns(db, actorId(req));
    res.json({
      campaigns: rows.map((row) => ({
        ...row,
        revealedAt: row.revealedAt?.toISOString() ?? null,
      })),
    });
  });

  /**
   * The preparing Campaign kit for one association.
   *
   * The read logs itself (§31.5) — `readPreparingKit` writes the access row in
   * the same call that returns the content, rather than relying on a middleware
   * a later route could be added without.
   */
  router.get(`${CREATOR_PATH}/campaigns/:associationId`, creator, async (req, res) => {
    const section = req.query['section'] === 'campaign_kit' ? 'campaign_kit' : 'campaign_information';

    const result = await readPreparingKit(db, {
      associationId: req.params['associationId'] as string,
      affiliateUserId: actorId(req),
      section,
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 403).json({
        error: result.code,
        title:
          result.code === 'revoked'
            ? 'This campaign is no longer available to you'
            : result.code === 'not_revealed'
              ? 'Not ready yet'
              : 'Campaign not found',
        whatHappened: result.message,
        next: result.next,
      });
      return;
    }

    res.json({ kit: result.kit });
  });

  return router;
}
