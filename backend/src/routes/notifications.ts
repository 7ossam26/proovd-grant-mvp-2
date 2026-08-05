/**
 * The digest preference, the notification history, and the §27.2 preview —
 * Spec §27.7, §27.2, §30, DNA §5.2 (Phase 22c).
 *
 * ── One router, three mounts, and the audience is never a parameter ─────────
 * The Founder, Creator, and Admin surfaces are the same two reads over
 * different scopes, so they are built once and mounted three times with the
 * audience bound at construction. The alternative — one route taking
 * `?audience=` — would let a Creator ask for the Founder view and an
 * unauthenticated caller ask for the Admin one; here the guard and the scope
 * are decided together, before any request arrives.
 *
 * ── There is no route that turns a digest on for someone else ──────────────
 * §30 forbids prechecked optional consent. The preference write takes the
 * session's own subject and no target parameter, so there is no shape of
 * request — Admin's included — that subscribes another person. An Admin who
 * needs to know what someone chose reads the preference history; an Admin who
 * thinks someone should be subscribed asks them.
 *
 * ── The history is read-only, and nothing here writes a read-state ─────────
 * No `POST .../seen`, no unread count in the payload, no `last_opened_at`.
 * §27.7 forbids the history turning the Founder home into a dashboard, and a
 * read receipt is the first thing a badge would be computed from.
 */

import { Router } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireRole } from '../auth/guards.js';
import type { AuditWriter } from '../auth/audit.js';
import { readDigestPreference, setDigestPreference } from '../notifications/preferences.js';
import { readNotificationHistory } from '../notifications/history.js';
import { previewNotification } from '../notifications/preview.js';
import { NOTIFICATION_CATALOG } from '../notifications/catalog.js';
import type { NotificationEventKey } from '../notifications/events.js';
import { DIGEST_PREFERENCES } from '../notifications/digest-logic.js';

export const NOTIFICATIONS_FOUNDER_PATH = '/api/founder';
export const NOTIFICATIONS_CREATOR_PATH = '/api/creator';
export const NOTIFICATIONS_ADMIN_PATH = '/api/admin';

export interface NotificationsRouterDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
}

type Surface = 'founder' | 'affiliate' | 'admin';

const BASE_PATH: Record<Surface, string> = {
  founder: NOTIFICATIONS_FOUNDER_PATH,
  affiliate: NOTIFICATIONS_CREATOR_PATH,
  admin: NOTIFICATIONS_ADMIN_PATH,
};

export function createNotificationsRouter(
  deps: NotificationsRouterDeps,
  surface: Surface,
): Router {
  const { db, auth, audit } = deps;
  const router = Router();
  const base = BASE_PATH[surface];
  const guard = surface === 'admin' ? requireAdmin(auth) : requireRole(auth, surface);
  const json = express.json({ limit: '8kb' });

  /* ── The preference (§27.7) ───────────────────────────────────────────── */

  if (surface !== 'admin') {
    const audience = surface;

    router.get(`${base}/notifications/preferences`, guard, async (req, res) => {
      const preference = await readDigestPreference(db, {
        audience,
        userId: req.authUser?.id ?? '',
      });
      res.json({ preference });
    });

    router.put(`${base}/notifications/preferences`, guard, json, async (req, res) => {
      const frequency = String(
        (req.body as { frequency?: unknown } | undefined)?.frequency ?? '',
      );
      const result = await setDigestPreference(
        db,
        { audience, userId: req.authUser?.id ?? '' },
        frequency,
      );

      if (result.status === 'invalid_frequency') {
        res.status(400).json({
          error: 'invalid_frequency',
          title: 'That is not one of the choices',
          whatHappened: `A digest preference must be one of: ${result.permitted.join(', ')}.`,
          next: 'Pick one of the options shown and try again.',
          support: '/support',
          permitted: result.permitted,
        });
        return;
      }

      // §25.6. A recorded consent to an opt-out-able message is worth an audit
      // row of its own — the trigger keeps the history, this keeps the actor.
      await audit({
        actorId: req.authUser?.id,
        action: 'notification.digest_preference_set',
        targetType: 'digest_preference',
        targetId: req.authUser?.id ?? '',
        internalReason: `${audience} chose digest frequency ${result.frequency}`,
        newValue: { frequency: result.frequency },
      });

      const preference = await readDigestPreference(db, {
        audience,
        userId: req.authUser?.id ?? '',
      });
      res.json({ preference });
    });
  }

  /* ── The history (§27.7) ──────────────────────────────────────────────── */

  router.get(`${base}/notifications/history`, guard, async (req, res) => {
    const result = await readNotificationHistory(db, {
      audience: surface,
      // The session's own address, never a parameter. Admin may filter by one.
      email:
        surface === 'admin'
          ? (req.query['email'] as string | undefined)
          : (req.authUser?.email ?? undefined),
      before: req.query['before'] as string | undefined,
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
      eventKey: surface === 'admin' ? (req.query['eventKey'] as string | undefined) : undefined,
    });

    if (result.status === 'email_required') {
      res.status(409).json({
        error: 'email_required',
        title: 'We could not identify your account',
        whatHappened: 'Your session has no email address, so we cannot show what was sent to you.',
        next: 'Sign out and back in. If it keeps happening, contact support.',
        support: '/support',
      });
      return;
    }

    res.json({ history: result.page });
  });

  /* ── §27.2's preview, for the Admin who sends by hand ─────────────────── */

  if (surface === 'admin') {
    /**
     * §27.2: "High-impact messages can be previewed with final variables before
     * manual send." 22a built the machine and left the surface for here.
     *
     * It reports and does not refuse — the reasoning is in `preview.ts`. Two
     * refusing gates already exist where a human actually composes and sends
     * (§7's and §8's invitation previews scan the rendered message); a third
     * that blocked on a heuristic would train an Admin to work around it.
     */
    router.get(`${base}/notifications/preview/:eventKey`, guard, async (req, res) => {
      const eventKey = String(req.params['eventKey'] ?? '') as NotificationEventKey;
      if (!(eventKey in NOTIFICATION_CATALOG)) {
        res.status(404).json({
          error: 'unknown_event',
          title: 'No such message',
          whatHappened: 'That notification key has no template in the render catalog.',
          next: 'Pick a key from the list of messages the product sends.',
          support: '/support',
        });
        return;
      }
      res.json(await previewNotification(eventKey));
    });

    /** Every key that has a template, so the surface can list them. */
    router.get(`${base}/notifications/catalog`, guard, (_req, res) => {
      res.json({ keys: Object.keys(NOTIFICATION_CATALOG).sort() });
    });
  }

  return router;
}

/** Re-exported so the surfaces read one source for the option list. */
export { DIGEST_PREFERENCES };
