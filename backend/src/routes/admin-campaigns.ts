/**
 * Admin — the Campaigns hub. Spec §26.1, §26.8, §18.
 *
 * ── Two routes, both GET, and that is the whole design ──────────────────────
 * Campaigns is a read-only hub. Every operation a campaign needs already lives
 * in a router another workspace owns — §15's review rounds, §16's readiness and
 * funding deadline, §17's launch, §20's live edits, §21's close batch, §22.1's
 * earnings, §24.8's refunds, §26.7's suspend/kill — and each of those encodes
 * rules a duplicate control here would have to restate. A second door into the
 * one Transfer per association, or a second way to decide a threshold, is the
 * failure this section is shaped to avoid.
 *
 * So there is no POST, no PUT, no PATCH, and no DELETE mounted below, and
 * `tests/campaign-workspace.test.ts` drives all four verbs at both paths and
 * asserts 404. That is stronger than a comment: a write added here would fail
 * the suite rather than quietly join §33.12.5's ungated set.
 *
 * ── Which guard, and why not the freshness one ──────────────────────────────
 * `requireAdmin` on both, which is where the Admin boundary is decided for all
 * 45 call sites in this app. `requireFreshSession` is deliberately absent:
 * §5.1 gates high-impact ACTIONS, and `admin.ts` has recorded since Phase 06a
 * that making an Admin reauthenticate to LOOK at something teaches them to
 * reauthenticate reflexively, which is how the gate stops meaning anything.
 * These two routes change nothing, so there is nothing for a stale session to
 * do with them.
 *
 * §33.12.5's partition is untouched for the same reason: it enumerates the
 * mounted router's WRITES, and this router contributes none.
 *
 * ── The payload carries no Backer identity and no support body ──────────────
 * The brief's §9: the hub's cross-domain summaries must expose only what the
 * hub needs. So the reads select COUNTS from `reservations` and `support_cases`
 * — never a Backer's email, never a case message, never a payment record — and
 * §26.7's enforcement rows contribute only their customer explanation, never
 * the internal reason beside it (§25.6).
 */

import { Router, type Request, type Response } from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin } from '../auth/guards.js';
import {
  listCampaignDirectory,
  readCampaignRecord,
  looksLikeCampaignId,
} from '../campaigns/workspace/read.js';

export const ADMIN_CAMPAIGNS_PATH = '/api/admin/campaigns';

export interface AdminCampaignsDeps {
  db: Database;
  auth: Auth;
  /**
   * Where a public campaign page resolves.
   *
   * Passed in rather than read from a constant because the same code serves
   * local, test, and production origins, and a hardcoded origin would put a
   * `proovd.co` address on a control an Admin clicks in a test environment.
   */
  appBaseUrl: string;
}

function notFound(res: Response): void {
  /* The same answer a nonexistent campaign gets. An id that exists and one that
     does not must be indistinguishable to a caller who is guessing — the rule
     `findFounderCampaign` has applied since Phase 09a. */
  res.status(404).json({
    error: 'not_found',
    title: 'Campaign not found',
    whatHappened: 'No campaign with that id is on the record.',
    next: 'Open the campaign from the Campaigns list.',
  });
}

export function createAdminCampaignsRouter(deps: AdminCampaignsDeps): Router {
  const router = Router();
  const { db, auth, appBaseUrl } = deps;

  /**
   * The directory.
   *
   * One read for every campaign, batched over ten queries — the filters and the
   * search run in the browser over the `searchText` and `groups` the SERVER
   * composed, so the palette and the table can never disagree about what
   * matches. A per-filter round trip would also mean the hero's blocked count
   * moved every time somebody clicked a chip.
   */
  router.get(
    ADMIN_CAMPAIGNS_PATH,
    requireAdmin(auth),
    async (_req: Request, res: Response) => {
      const view = await listCampaignDirectory({ db, appBaseUrl });
      res.json(view);
    },
  );

  /** One campaign, all four tabs in one payload. */
  router.get(
    `${ADMIN_CAMPAIGNS_PATH}/:campaignId`,
    requireAdmin(auth),
    async (req: Request, res: Response) => {
      const campaignId = (req.params['campaignId'] as string | undefined) ?? '';
      /* Checked before the query so a malformed id answers 404 rather than
         erroring at the driver on an invalid uuid literal — a 500 where a 404
         belongs tells a caller their guess was interesting. */
      if (!looksLikeCampaignId(campaignId)) {
        notFound(res);
        return;
      }
      const view = await readCampaignRecord({ db, appBaseUrl }, campaignId);
      if (!view) {
        notFound(res);
        return;
      }
      res.json(view);
    },
  );

  return router;
}
