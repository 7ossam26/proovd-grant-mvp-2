/**
 * Admin — the §22.3 Founder-payment read. Spec §22.3, §26.1, §33.8.13.
 *
 * ── Why this file exists again ──────────────────────────────────────────────
 * `admin-close.ts` was 972 lines and went with the Admin close screen when the
 * dashboard was replaced (commit `2f7aeed`). Its screen going was a decision;
 * its ROUTES going was not, and CLAUDE.md records the rule that commit was
 * meant to follow: the deleted surfaces' backends stay mounted, because they
 * encode acceptance-tested machinery and "deleting them would have gutted
 * safety rules to remove a page."
 *
 * §33.8.13 is one of the 131 named acceptance tests, and its whole claim is
 * "one source, many renderers" — that the Founder's view of what they are owed
 * and the Admin's view of the same thing are the same resolver, to the cent.
 * That test drove the read below. With the router gone it asserted 200 against
 * a 404 and had been red ever since.
 *
 * ── What is restored, and what is not ───────────────────────────────────────
 * ONE route: the read the acceptance test drives. Not the W-9 decisions, not
 * create/release, not the early-release decision, not the close batch, not the
 * reconciliation — those are writes with no surface, and a mounted money-moving
 * route nobody can see is worse than an absent one. They come back with the
 * close surface that operates them, and the §33 suites that cover them drive
 * the services directly rather than the routes.
 *
 * It is a GET behind `requireAdmin`, over a resolver that already exists. It
 * adds no rule, computes nothing, and writes nothing.
 */

import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin } from '../auth/guards.js';
import { readFounderPaymentStatus } from '../close/founder-payments.js';
import {
  EARLY_RELEASE_EVIDENCE_FACTS,
  FOUNDER_PAYMENT_STATUS_FACTS,
} from '../close/founder-payments-logic.js';
import { earlyReleaseRequests } from '../db/schema/founder-payments.js';

export const ADMIN_CLOSE_BASE_PATH = '/api/admin/close';

export interface AdminCloseRouterDeps {
  db: Database;
  auth: Auth;
}

export function createAdminCloseRouter({ db, auth }: AdminCloseRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);

  /**
   * The Admin read serves the SAME `readFounderPaymentStatus` view the Founder
   * route serves — one source, many renderers (§33.8.13) — plus the request
   * history and the registers the surface renders by definition.
   *
   * A read, so `admin` and not `fresh`: making an Admin reauthenticate to LOOK
   * at what a Founder is owed teaches them to reauthenticate reflexively, which
   * is how the gate stops meaning anything (`admin.ts`, Phase 06a).
   */
  router.get(`${ADMIN_CLOSE_BASE_PATH}/:campaignId/founder-payments`, admin, async (req, res, next) => {
    try {
      const campaignId = String(req.params['campaignId']);
      const status = await readFounderPaymentStatus(db, { campaignId });
      if (!status) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      const requests = await db
        .select()
        .from(earlyReleaseRequests)
        .where(eq(earlyReleaseRequests.campaignId, campaignId))
        .orderBy(desc(earlyReleaseRequests.createdAt));
      res.json({
        status,
        requests,
        evidenceFacts: EARLY_RELEASE_EVIDENCE_FACTS,
        statusFacts: FOUNDER_PAYMENT_STATUS_FACTS,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
