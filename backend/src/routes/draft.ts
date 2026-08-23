/**
 * The invited-draft route — Spec §7, §33.1.1, §33.1.2.
 *
 * The only route in the system a Founder reaches without an account, and the
 * one §33.1.1 is about: "Personalized draft opens without account and grants no
 * other access."
 *
 * ── The route never takes a draft id ────────────────────────────────────────
 * It takes a token, and learns the draft id from the *verified subject*. There
 * is therefore no id in the request for a caller to change, no second draft the
 * route could be argued into serving, and no way to enumerate drafts by
 * incrementing anything. Phase 04's `requireDraftToken` middleware already
 * establishes that shape; this is its first real use.
 *
 * ── Every failure is the same failure ───────────────────────────────────────
 * Altered, cross-scope, replayed, expired, revoked, superseded by a resend,
 * never issued, malformed, rate-limited: one status, one body, byte-identical
 * (`token-rejection.ts`). Including the case this route adds — a draft that has
 * been anonymised, whose token would still verify in the window between the
 * two if they were not in one transaction. A distinguishable answer here would
 * tell a caller which drafts once existed.
 *
 * ── Nothing is set ─────────────────────────────────────────────────────────
 * No cookie, no session, no account. The response is read-only data about the
 * Founder's own draft. Phase 07 owns what happens when they act on it.
 */

import { Router } from 'express';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import { requireDraftToken, createTokenVerifyLimiter } from '../auth/token-middleware.js';
import { TOKEN_REJECTION_STATUS, TOKEN_REJECTION_BODY } from '../auth/token-rejection.js';
import { DRAFT_TOKEN_PATH, TOKEN_PARAM } from '../auth/token-routes.js';
import { readDraftLanding, DRAFT_PATH } from '../invitations/service.js';
import { PROCESS_SUMMARY, NO_GUARANTEE_TEXT } from '../notifications/templates/founder-invitation.js';

/**
 * §28.1 requires rate limiting on token verification. Twenty attempts per
 * quarter-hour is generous for a person who clicks a link and reloads it a few
 * times, and tight for anything sweeping a keyspace.
 *
 * It is configurable only because the integration suite issues far more than
 * twenty verifications from one loopback address, and a suite that tripped the
 * limiter would be testing the limiter by accident in every other case. The
 * production value is the default and nothing overrides it.
 */
export const DRAFT_VERIFY_LIMIT = 20;

export function createDraftRouter(
  db: Database,
  tokens: TokenService,
  options: { verifyLimit?: number } = {},
): Router {
  const router = Router();

  // `DRAFT_TOKEN_PATH` and `TOKEN_PARAM` come from `token-routes.ts`, which
  // also owns `redactTokenUrl`. One declaration, so a route shape and the
  // redaction rule that keeps its token out of Sentry cannot drift apart.
  router.get(
    `${DRAFT_TOKEN_PATH}/:${TOKEN_PARAM}`,
    // §28.1 requires rate limiting on token verification. The limiter answers
    // with the ordinary rejection, never a 429 — a limiter that announces
    // itself is the same enumeration oracle wearing a different hat.
    createTokenVerifyLimiter({
      limit: options.verifyLimit ?? DRAFT_VERIFY_LIMIT,
      windowMs: 15 * 60 * 1000,
    }),
    requireDraftToken(tokens),
    async (req, res) => {
      const draftId = req.draftSubject?.campaignDraftId;
      if (!draftId) {
        res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
        return;
      }

      const landing = await readDraftLanding(db, draftId);
      if (!landing) {
        // Anonymised, or a draft id with no row. Same answer as every other
        // failure — the caller learns nothing about which.
        res.status(TOKEN_REJECTION_STATUS).json(TOKEN_REJECTION_BODY);
        return;
      }

      res.json({
        recipientName: landing.recipientName,
        recipientEmail: landing.recipientEmail,
        productName: landing.productName,
        whatWeUnderstood: landing.whatWeUnderstood,
        senderName: landing.senderName,
        expectedSetupTime: landing.expectedSetupTime,
        lastContactAt: landing.lastContactAt,
        viewsCount: landing.viewsCount,
        reference: landing.reference,
        // The same fixed copy the email carried, so the two cannot drift and
        // the Founder reads one story (§7, §27.1).
        processSummary: PROCESS_SUMMARY,
        noGuarantee: NO_GUARANTEE_TEXT,
      });
    },
  );

  return router;
}

export { DRAFT_PATH };
