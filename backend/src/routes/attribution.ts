/**
 * The tracking-link ingest — Spec §18, §14.1, §33.6.1–5 (Phase 14b).
 *
 * `GET /c/:code` is the URL a Creator shares. It is public and takes no session:
 * whoever clicks it is a visitor, not an account. It records the click, sets the
 * per-browser cookies, and redirects to the live campaign page — in that order,
 * so the winner cookie is written before the page it points at loads.
 *
 * ── Page before links is upstream; this route trusts it ─────────────────────
 * §17's launch activates the page before the links (Phase 14a), so an activated
 * link always resolves to a live page. This route still redirects an ignored
 * click (pre-activation, paused, closed) to the campaign page, which renders the
 * correct not-yet-open or ended state — it just does not set the winner cookie,
 * so an earlier valid attribution is preserved (§33.6.1's "direct return
 * preserves", applied to a click that cannot win).
 *
 * ── The link-test marker is excluded by its exact name (§14.1) ──────────────
 * The safe link-test action appends `LINK_TEST_MARKER` as a query parameter.
 * Its presence makes the click `ignored/link_test`: no cookie, no production
 * attribution, no conversion count — the Creator sees their link resolve to the
 * right page without contaminating anything.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client.js';
import { LINK_TEST_MARKER } from '../affiliates/roster-labels.js';
import { recordClick } from '../attribution/service.js';
import {
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  attributionCookieName,
  signAttribution,
  parseCookieHeader,
} from '../attribution/cookies.js';

export interface AttributionRouterDeps {
  db: Database;
  /** Signs the winner cookie. `BETTER_AUTH_SECRET`, domain-separated. */
  secret: string;
  /** Set the `Secure` cookie attribute — true in production (https origin). */
  secure: boolean;
}

export function createAttributionRouter(deps: AttributionRouterDeps): Router {
  const router = Router();
  const { db, secret, secure } = deps;

  router.get('/c/:code', async (req, res) => {
    const code = req.params.code;
    const now = new Date();

    // The visitor id: reuse the browser's, or mint one and set it. It groups the
    // ledger and is the whole of §18's same-browser limitation.
    const cookies = parseCookieHeader(req.headers.cookie);
    const visitorId = cookies[VISITOR_COOKIE] ?? randomUUID();
    res.cookie(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS * 1000,
    });

    // §14.1: the marker is read by its exact name; its presence taints the click.
    const linkTest = req.query[LINK_TEST_MARKER] !== undefined;

    const click = await recordClick(db, { code, visitorId, linkTest, now });

    // An unknown code identifies no campaign; send the visitor to the homepage
    // rather than leak whether a code exists.
    if (!click.found || !click.campaignId) {
      res.redirect(302, '/');
      return;
    }

    // Only a valid click becomes the winner. Its cookie carries the linkId and
    // expires at exactly `campaign_close_at` (§33.6.2) — the browser drops it at
    // close. An ignored click leaves any earlier winner untouched (§33.6.1).
    if (click.outcome === 'attributed' && click.trackingLinkId && click.campaignCloseAt) {
      const value = signAttribution(
        { v: visitorId, l: click.trackingLinkId, t: now.toISOString() },
        secret,
      );
      res.cookie(attributionCookieName(click.campaignId), value, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        expires: click.campaignCloseAt,
      });
    }

    res.redirect(302, `/campaign/${click.campaignId}`);
  });

  return router;
}
