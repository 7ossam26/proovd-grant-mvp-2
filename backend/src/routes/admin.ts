/**
 * The Admin API — Spec §6, §26.
 *
 * This is the first product surface any guard is mounted on. Phase 04 built
 * `requireSession` / `requireRole` / `requireAdmin` / `requireFreshSession` and
 * mounted them on nothing, because Phase 05 was entirely public. Everything
 * below `/api/admin` now goes through `requireAdmin`, which means: a session,
 * the `admin` role, and a registered TOTP factor. All three, or 401/403.
 *
 * ── Which routes additionally demand recent reauthentication ────────────────
 * §5.1 names the category — "money movement, refund, connected-account,
 * campaign kill/suspend, and other high-impact actions". A settings write
 * changes the listing fee, the platform fee, the campaign cap, and every
 * deadline in the system, so it is squarely inside that category and takes the
 * freshness gate. Reads do not: making an Admin re-authenticate to *look* at
 * the configuration teaches them to re-authenticate reflexively, which is how
 * the gate stops meaning anything.
 *
 * ── Body parsing is mounted here, not globally ──────────────────────────────
 * `app.ts` mounts no global `express.json()` — Better Auth reads the raw
 * stream and Phase 10's Stripe webhooks need the raw body for signature
 * verification. Each router adds parsing at its own scope (tech-stack §6).
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import {
  readSettings,
  readSettingHistory,
  updateSetting,
  readAdminReauthWindowSeconds,
} from '../settings/service.js';

export const ADMIN_BASE_PATH = '/api/admin';

export interface AdminRouterDeps {
  db: Database;
  auth: Auth;
}

/**
 * The actor string for `audit_events` and `app_settings.updated_by`.
 * `createAuditWriter` uses the same `user:<id>` shape, so one audit query
 * resolves both token events and Admin actions to the same actor.
 */
function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

/**
 * §25.6 wants the MFA and reauthentication context on high-impact events.
 * `requireAdmin` has already refused anyone without a registered factor, and
 * `requireFreshSession` has already refused a session older than the window, so
 * what is recorded here is what those guards actually established.
 */
function securityContext(req: express.Request): {
  mfaContext: string;
  reauthContext: string;
} {
  const session = req.authSession;
  return {
    mfaContext: 'totp_factor_registered',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

export function createAdminRouter({ db, auth }: AdminRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);

  // The window is read per request, so a change in Admin settings applies to
  // the next sensitive action rather than the next deployment. It fails closed
  // when unset — which is the state the app ships in until an operator states
  // a number (§6).
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));

  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── Settings (§6) ─────────────────────────────────────────────────────── */

  // State only. Labels, help text, and grouping come from the §6 register,
  // which the Admin surface imports directly through Vite — copying that prose
  // into a response is how two versions of one sentence start disagreeing.
  router.get(`${ADMIN_BASE_PATH}/settings`, admin, async (_req, res) => {
    const rows = await readSettings(db);
    res.json({
      settings: rows.map((row) => ({
        key: row.key,
        value: row.value,
        kind: row.kind,
        provenance: row.provenance,
        minimum: row.minimum,
        maximum: row.maximum,
        specRef: row.specRef,
        version: row.version,
        editable: row.editable,
        updatedBy: row.updatedBy,
        updateReason: row.updateReason,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  router.get(`${ADMIN_BASE_PATH}/settings/:key/history`, admin, async (req, res) => {
    const entries = await readSettingHistory(db, req.params['key'] as string);
    res.json({
      history: entries.map((entry) => ({
        version: entry.version,
        priorValue: entry.priorValue,
        newValue: entry.newValue,
        changedBy: entry.changedBy,
        reason: entry.reason,
        occurredAt: entry.occurredAt.toISOString(),
      })),
    });
  });

  router.put(`${ADMIN_BASE_PATH}/settings/:key`, admin, fresh, json, async (req, res) => {
    const body = req.body as { value?: unknown; reason?: unknown };

    if (typeof body?.value !== 'string' || typeof body?.reason !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That change could not be saved',
        whatHappened: 'A new value and a reason are both required.',
        next: 'Enter a value and say why it is changing, then save again.',
      });
      return;
    }

    const result = await updateSetting(db, {
      key: req.params['key'] as string,
      value: body.value,
      reason: body.reason,
      actor: actorOf(req),
      ...securityContext(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'setting_rejected',
        title: 'That change could not be saved',
        whatHappened: result.message,
        next: 'Correct the value and save again. Nothing has changed.',
      });
      return;
    }

    res.json({
      key: result.row.key,
      value: result.row.value,
      version: result.row.version,
      changed: result.changed,
      updatedBy: result.row.updatedBy,
      updateReason: result.row.updateReason,
      updatedAt: result.row.updatedAt.toISOString(),
    });
  });

  /* ── Who am I ─────────────────────────────────────────────────────────── */

  router.get(`${ADMIN_BASE_PATH}/me`, admin, (req, res) => {
    res.json({
      id: req.authUser?.id,
      name: req.authUser?.name,
      email: req.authUser?.email,
      sessionEstablishedAt: req.authSession?.createdAt.toISOString(),
    });
  });

  return router;
}
