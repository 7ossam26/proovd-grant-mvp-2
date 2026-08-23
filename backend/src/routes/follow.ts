/**
 * The three public follow routes (campaign-page-v2 Session C).
 *
 * A RECORDED DEVIATION from §1 rule 6 — see `followers/service.ts` and
 * migration 0050 for the full statement. These are the only three routes it
 * adds, and there is no Admin write among them.
 *
 * ── Why confirm and unfollow are POSTs behind a page, not one-click GETs ────
 * A link that acts on being FETCHED records the answers email scanners give.
 * Phase 21b already decided this for §31.8's satisfaction survey — "a link
 * that records an answer on being fetched records answers that email scanners
 * give" — and it applies twice as hard here: a GET confirm would let a scanner
 * complete the double opt-in it exists to require, and a GET unfollow would
 * unsubscribe people who never clicked. So the emailed URL opens a page, the
 * page says what is about to happen, and the person's own click is the POST.
 *
 * ── No §33.12.5 entry is needed, and that is checked rather than assumed ────
 * The partition test filters to `/api/admin` writes; these are public. Adding
 * an Admin write here would need either the freshness gate or a registered
 * reason — and `system-contract.test.ts` asserts `gated.length > ungated.length`,
 * which enough new ungated writes would invert.
 */

import { Router, type Request, type Response } from 'express';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { FOLLOW_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import {
  FOLLOW_ACK,
  confirmFollow,
  requestFollow,
  unfollowCampaign,
  type FollowDeps,
} from '../followers/service.js';

export interface FollowRouterDeps {
  db: Database;
  tokens: TokenService;
  notifier?: Notifier | undefined;
  appBaseUrl: string;
  fromAddress: string;
  supportEmail: string;
  audit: (event: {
    action: string;
    targetType: string;
    targetId: string | null;
    internalReason: string;
  }) => Promise<void>;
}

/**
 * The one answer to a confirm or unfollow attempt that did not work.
 *
 * Frozen and identical for every reason — a token that never existed, one from
 * the other lineage, an expired one, a follow that was already ended. §5.5's
 * rule applies unchanged: telling the holder WHY is what lets somebody probe.
 */
export const FOLLOW_ACTION_FAILED = Object.freeze({
  status: 'unavailable' as const,
  title: 'That link is not usable',
  whatHappened:
    'This link has already been used, has expired, or was never valid. Nothing has changed.',
  next: 'Open the most recent email we sent you and use the link in that one.',
});

function followDeps(deps: FollowRouterDeps): FollowDeps {
  return {
    db: deps.db,
    tokenService: deps.tokens,
    notifier: deps.notifier,
    appBaseUrl: deps.appBaseUrl,
    fromAddress: deps.fromAddress,
    supportEmail: deps.supportEmail,
  };
}

export function createFollowRouter(deps: FollowRouterDeps): Router {
  const router = Router();

  /**
   * The ask. Every branch answers `FOLLOW_ACK` — a hit, a miss, a malformed
   * address, an unknown campaign, and one that is not live.
   */
  router.post(
    '/api/campaign/:campaignId/follow',
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body['email'] === 'string' ? body['email'] : '';
      const frequency = typeof body['frequency'] === 'string' ? body['frequency'] : '';
      const source = body['source'] === 'checkout_success' ? 'checkout_success' : 'campaign_page';
      const campaignParam = req.params['campaignId'];
      const campaignId = typeof campaignParam === 'string' ? campaignParam : '';

      // Answer FIRST. A hit writes a row, mints two tokens and sends an email
      // while a miss returns immediately, and that difference is measurable
      // even when the bodies match. The result of this request arrives by
      // email, so responding before the work is honest rather than a claim of
      // completion.
      res.status(202).json(FOLLOW_ACK);

      if (!email || !frequency || !campaignId) return;

      try {
        await requestFollow(followDeps(deps), { campaignId, email, frequency, source });
      } catch (error) {
        // The response is already sent, so this can only be recorded. It must
        // not surface: an error path that behaved differently would be the
        // oracle the whole route is built to avoid.
        await deps.audit({
          action: 'follow.request_failed',
          targetType: 'campaign',
          targetId: campaignId,
          internalReason: `follow request failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        });
      }
    },
  );

  /** Confirms. Single-use: the confirm lineage is claimed here. */
  router.post(`${FOLLOW_TOKEN_PATH}/:${TOKEN_PARAM}/confirm`, async (req, res) => {
    const rawParam = req.params[TOKEN_PARAM];
    const raw = typeof rawParam === 'string' ? rawParam : '';
    const result = await confirmFollow(followDeps(deps), raw);
    if (!result.ok) {
      res.status(404).json(FOLLOW_ACTION_FAILED);
      return;
    }
    res.json({
      status: 'confirmed',
      campaignId: result.campaignId,
      campaignTitle: result.campaignTitle,
      frequency: result.frequency,
    });
  });

  /** Ends it. Never claims — an opt-out link that stops working is not one. */
  router.post(`${FOLLOW_TOKEN_PATH}/:${TOKEN_PARAM}/stop`, async (req, res) => {
    const rawParam = req.params[TOKEN_PARAM];
    const raw = typeof rawParam === 'string' ? rawParam : '';
    const result = await unfollowCampaign(followDeps(deps), raw);
    if (!result.ok) {
      res.status(404).json(FOLLOW_ACTION_FAILED);
      return;
    }
    res.json({
      status: 'unfollowed',
      campaignId: result.campaignId,
      campaignTitle: result.campaignTitle,
    });
  });

  return router;
}
