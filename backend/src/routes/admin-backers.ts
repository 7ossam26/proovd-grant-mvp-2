/**
 * Admin — the Backers workspace. Spec §26.1, §26.5, §25.7, §28.4.
 *
 * ── The directory is a read, and nothing about a pre-order is written here ──
 * The Backers reference contains no mutating control: its only interactions are
 * switching views, filtering, searching, and drilling from an Affiliate row
 * into the Backer list. Every operation a pre-order needs already lives in a
 * router that owns its rules — §20's cancellation, §21's close batch and retry
 * window, §24.8's refund cases, §24.11's disputes, §26.7's suspend/kill, §4.1's
 * duplicate queue — and each encodes decisions a duplicate control here would
 * have to restate. A second door into a refund is the failure this shape avoids.
 *
 * So no verb is mounted at `ADMIN_BACKERS_PATH` itself, and
 * `tests/backer-workspace.test.ts` drives POST, PUT, PATCH and DELETE at that
 * path and asserts 404. That is stronger than a comment: a write added to the
 * directory fails the suite rather than quietly joining §33.12.5's ungated set.
 *
 * ── One write does live here, added Session F, and it is not about a Backer ──
 * §25.7's data request (`/data-requests/:requestId`) is a decision about what a
 * FOUNDER may be handed, and this is the workspace where an Admin can see the
 * people it concerns. It takes the freshness gate, so §33.12.5's partition
 * needs no register entry for it. It grants nothing: there is no access column
 * on 0058 and `exportBackerRows` has no parameter an approval could arrive as,
 * so approving one cannot widen a file — what happens next is a person acting,
 * through §26.7's support case (§1.3).
 *
 * ── There is no export, deliberately ────────────────────────────────────────
 * §25.7 draws the line between what Admin may SEE and what Admin may HAND OUT,
 * and the §26.5 ledger register classes Backer email and both survey answers
 * `restricted` — visible on screen for support and risk work, never written
 * into an export file. This page renders exactly those fields, so an export
 * route here would be the one that carries them out of the building. Bulk
 * export of Backer identity is a privacy decision for whoever owns §25.7, not
 * a convenience to add alongside a table, and the absence of the route is the
 * enforcement.
 *
 * ── Which guard, and why not the freshness one ──────────────────────────────
 * `requireAdmin`, which is where the Admin boundary is decided for all call
 * sites in this app: it refuses no session, an unreadable session, a missing
 * role, and every non-`admin` role, and it fails closed on a database error.
 * `requireFreshSession` is deliberately absent from both READS — §5.1 gates
 * high-impact ACTIONS, and `admin.ts` has recorded since Phase 06a that making
 * an Admin reauthenticate to LOOK at something teaches them to reauthenticate
 * reflexively, which is how the gate stops meaning anything. Neither read
 * changes anything, so there is nothing for a stale session to do with them.
 *
 * The one write takes it, because approving a §25.7 request is Proovd
 * undertaking to hand a person identifiable Backer detail — which is exactly
 * the sensitive property §33.12.5 asks about.
 *
 * ── Why no Founder or Affiliate can reach this ──────────────────────────────
 * `requireAdmin` refuses both by role before any query runs, so neither can
 * reach the route at all — and this is the only route in the product that
 * returns a Backer's survey answer beside their email. §25.7 names Backer name,
 * email, phone, billing address, and identifiable survey responses as fields an
 * Affiliate never receives; the strongest form of that is an endpoint their
 * role cannot enter. Nothing here is shared with a Founder-facing read: the
 * Founder's own campaign reads compose from `founder_operational_shares` and
 * from the consent-gated aggregates in `close/results.ts` and `live/explore.ts`,
 * and none of them calls this module.
 */

import express, { Router, type Request, type Response } from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  decideBackerDataRequest,
  readBackerDataQueue,
} from '../founder-dashboard/wrap.js';
import { isBackerDataDecision } from '../founder-dashboard/logic.js';
import { readBackersDirectory, looksLikeId } from '../backers/workspace/read.js';
import type { BackerQuery } from '../backers/workspace/types.js';

export const ADMIN_BACKERS_PATH = '/api/admin/backers';

export interface AdminBackersDeps {
  db: Database;
  auth: Auth;
  /** Session F's decision route writes an audit row and takes the gate. */
  audit: AuditWriter;
}

/** One string from the query string, or undefined. Arrays are refused. */
function one(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

export function createAdminBackersRouter(deps: AdminBackersDeps): Router {
  const router = Router();
  const { db, auth } = deps;

  /**
   * The whole page in one read: the totals, both filter option lists, the
   * Affiliate results, and one page of Backers.
   *
   * One request rather than one per view, because the two views are two
   * readings of the same filtered set — an Admin who switches tabs has already
   * decided something on the first, and a second round trip is a second chance
   * for the totals and the rows to disagree about what the filter matched.
   *
   * ── The parameters are validated, not trusted ─────────────────────────────
   * A campaign or association id that is not a uuid is DROPPED rather than
   * passed to the driver, so a malformed filter narrows nothing instead of
   * erroring at the database — a 500 where a filtered page belongs tells a
   * caller their guess was interesting. Neither parameter can widen access:
   * `requireAdmin` has already decided the caller may read every campaign, so a
   * filter is a narrowing convenience and there is no per-campaign scope for a
   * manipulated id to escape. That is the opposite of the Founder routes, where
   * `findFounderCampaign` joins the caller's own claim profile inside the query.
   */
  router.get(ADMIN_BACKERS_PATH, requireAdmin(auth), async (req: Request, res: Response) => {
    const campaignId = one(req.query['campaignId']);
    const affiliate = one(req.query['affiliate']);

    const query: BackerQuery = {
      campaignId: campaignId && looksLikeId(campaignId) ? campaignId : undefined,
      /* `organic` is a sentinel, so it passes through unvalidated as an id;
         anything else must be a real association id or it is dropped. */
      affiliate:
        affiliate === 'organic' || (affiliate && looksLikeId(affiliate)) ? affiliate : undefined,
      window: one(req.query['window']),
      affiliateSearch: one(req.query['affiliateSearch']),
      backerSearch: one(req.query['backerSearch']),
      page: positiveInt(req.query['page']),
      pageSize: positiveInt(req.query['pageSize']),
    };

    const view = await readBackersDirectory({ db }, query);
    res.json(view);
  });

  /* ── §25.7's Backer data requests (Founder Dashboard Session F, F4) ─────── */

  /** Every undecided ask, oldest first. */
  router.get(
    `${ADMIN_BACKERS_PATH}/data-requests`,
    requireAdmin(auth),
    async (_req: Request, res: Response) => {
      res.json({ requests: await readBackerDataQueue(db) });
    },
  );

  /**
   * The decision. GATED, and the reason is worth stating: approving one is
   * Proovd undertaking to hand a person identifiable Backer detail. That is the
   * sensitive property §33.12.5 asks about, so it takes the freshness gate and
   * needs no register entry.
   *
   * It grants nothing by itself — there is no access column here and
   * `exportBackerRows` has no parameter an approval could arrive as. What
   * happens next is a person acting, through §26.7's support case (§1.3).
   */
  router.post(
    `${ADMIN_BACKERS_PATH}/data-requests/:requestId`,
    requireAdmin(auth),
    requireFreshSession(auth, () => readAdminReauthWindowSeconds(db)),
    express.json({ limit: '32kb' }),
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decision = body['decision'];
      if (!isBackerDataDecision(decision)) {
        res.status(400).json({
          error: 'decision_invalid',
          whatHappened: 'A request is either approved or declined.',
        });
        return;
      }
      const result = await decideBackerDataRequest(
        { db, audit: deps.audit },
        {
          requestId: String(req.params['requestId'] ?? ''),
          decision,
          decisionNote: String(body['decisionNote'] ?? ''),
          decidedBy: `user:${req.authUser?.id ?? ''}`,
        },
      );
      if (!result.ok) {
        res.status(result.code === 'already_decided' ? 409 : 400).json({
          error: result.code,
          whatHappened: result.message,
        });
        return;
      }
      res.json({ requestId: result.requestId, decision });
    },
  );

  return router;
}
