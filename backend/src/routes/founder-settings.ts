/**
 * The Founder's account-level settings — Session G (§5.2).
 *
 * Its own router rather than a branch of `founder-home.ts`, because every route
 * there is `:campaignId`-scoped and these are not: `founder_claim_profiles` is
 * unique per campaign, so a Founder with two campaigns would otherwise have two
 * settings pages, and correcting a phone number on one would leave the other
 * saying something else.
 *
 * ── Four routes, and none of them is new machinery ──────────────────────────
 * The read composes resolvers that already exist. The correction writes the row
 * Admin's own `updateFounderField` writes, under the same rules. The deletion
 * ask calls the same service the Admin workspace calls. The password change
 * wraps Better Auth's own endpoint — see `PASSWORD_CHANGE_REVOKES_OTHER_SESSIONS`
 * in the shared register for the §28.1 review that had to happen first.
 *
 * ── No freshness gate, and that is stated rather than assumed ───────────────
 * `requireFreshSession` guards Proovd's money-moving and enforcement actions.
 * None of these is one: correcting your own phone number moves nothing, and the
 * account-closure ask records a request that a person reads and executes
 * nothing. The password change is the closest call, and it carries its own
 * proof of identity — Better Auth requires the CURRENT password, which is a
 * stronger check than a recent sign-in, and it revokes the other sessions.
 *
 * §33.12.5's partition is over `/api/admin` writes and is untouched by this
 * file: nothing here is mounted under that prefix, and no Admin route is added.
 */

import { Router } from 'express';
import express from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import { requireRole } from '../auth/guards.js';
import {
  correctFounderField,
  readFounderSettings,
  requestFounderDeletion,
} from '../founder-dashboard/settings.js';
import { FOUNDER_PASSWORD_CHANGED } from '../founder-dashboard/settings-logic.js';

export const FOUNDER_SETTINGS_PATH = '/api/founder/settings';

export interface FounderSettingsRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function createFounderSettingsRouter(deps: FounderSettingsRouterDeps): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const founder = requireRole(auth, 'founder');
  const json: RequestHandler = express.json({ limit: '64kb' });

  /** §5.2's eleven, minus the two blocks that already have their own read. */
  router.get(FOUNDER_SETTINGS_PATH, founder, async (req, res) => {
    const view = await readFounderSettings(db, req.authUser?.id ?? '');
    if (!view) {
      res.status(404).json({
        error: 'not_found',
        message:
          'There is no Founder record on this account yet. If you have just finished signing up, open your campaign and come back.',
      });
      return;
    }
    res.json({ settings: view });
  });

  /**
   * One registered field, with a reason.
   *
   * The field id is in the PATH and is validated against the register rather
   * than against the request body's own idea of what a field is — a route that
   * accepted any string would record a correction of something that does not
   * exist, and the trail would look complete while pointing at nothing.
   */
  router.put(`${FOUNDER_SETTINGS_PATH}/fields/:fieldId`, founder, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await correctFounderField(db, {
      founderUserId: req.authUser?.id ?? '',
      fieldId: String(req.params['fieldId'] ?? ''),
      value: typeof body['value'] === 'string' ? body['value'] : null,
      reason: str(body['reason']) ?? '',
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        message: result.message,
      });
      return;
    }

    const view = await readFounderSettings(db, req.authUser?.id ?? '');
    res.json({ changed: result, settings: view });
  });

  /**
   * §5.2's password, through Better Auth's own `change-password`.
   *
   * Wrapped rather than called directly from the browser, for two things the
   * library cannot do on its own behalf: `revokeOtherSessions` is forced true
   * here rather than being a field the client may omit — somebody changing a
   * password because they think it is compromised must not be left with the
   * other sessions live — and the §25.6 audit row is written in the same act.
   *
   * The refusal is one sentence rather than the library's error shape, and it
   * is the SAME sentence whether the current password was wrong or the session
   * had gone stale: neither tells the caller anything about another account,
   * and distinguishing them would only help somebody who already holds the
   * session guess at the password faster.
   */
  router.post(`${FOUNDER_SETTINGS_PATH}/password`, founder, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const currentPassword = typeof body['currentPassword'] === 'string' ? body['currentPassword'] : '';
    const newPassword = typeof body['newPassword'] === 'string' ? body['newPassword'] : '';

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        error: 'invalid',
        message: 'Enter the password you use now and the one you want instead.',
      });
      return;
    }

    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: req.headers as unknown as Record<string, string>,
      });
    } catch {
      res.status(409).json({
        error: 'refused',
        message:
          'That did not work. Check the password you entered now — if you have forgotten it, use the reset link instead, which does not need the old one.',
      });
      return;
    }

    await audit({
      action: FOUNDER_PASSWORD_CHANGED,
      targetType: 'user',
      targetId: req.authUser?.id ?? '',
      actorId: req.authUser?.id ?? '',
      internalReason: 'password changed from the Founder settings page; other sessions revoked',
    });

    res.json({ ok: true });
  });

  /**
   * §5.2's delete-account request, onto 0040's record.
   *
   * It records an ask and erases nothing — there is no approval state on that
   * table and no purge column, because §25.8's retention obligations do not end
   * because somebody clicked a button. The surface says so in the same breath
   * as offering the control (§1.4).
   */
  router.post(`${FOUNDER_SETTINGS_PATH}/deletion-request`, founder, json, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await requestFounderDeletion(
      { db, audit },
      {
        founderUserId: req.authUser?.id ?? '',
        requestDetail: str(body['requestDetail']) ?? '',
      },
    );

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 409).json({
        error: result.code,
        message: result.message,
      });
      return;
    }

    const view = await readFounderSettings(db, req.authUser?.id ?? '');
    res.json({ recorded: true, settings: view });
  });

  return router;
}
