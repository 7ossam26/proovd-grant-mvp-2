/**
 * Admin — the §12 optional items, the evidence behind them, and the fee.
 * Spec §12, §25.6, §26.2, §33.3.1, §33.12.4.
 *
 * §12 Admin, in one sentence: "Admin sees every item, evidence, status,
 * discount line, high-effort inputs, fee preview, interview state, invalidation
 * history, and override. A manual override requires prior value, new value,
 * reason, actor, time, and evidence."
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * Reading does not. Invalidating, reinstating, and overriding do: each one
 * changes what a Founder will be charged, and §5.1 puts "other high-impact
 * actions" behind recent reauthentication. Confirming or cancelling an
 * interview on a Founder's behalf takes it too — it moves a US$2 line and the
 * high-effort input that governs Phase 12's compensation ceiling.
 *
 * ── An Admin cannot hand out a completion by clicking ──────────────────────
 * `reinstate` clears an invalidation and lets the evidence decide again;
 * `override` is the separate, §12-named act that sets a completion without
 * evidence and is recorded as `admin_override` for the rest of the campaign's
 * life. Both require a written reason and a customer-facing explanation, kept
 * in separate columns (§25.6), and the database refuses an invalidation
 * carrying neither.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { auditEvents } from '../db/schema/integrity.js';
import { readAdminWorkspace } from '../workspace/projection.js';
import {
  ensureWorkspace,
  evaluateWorkspace,
  invalidateItem,
  reinstateItem,
  overrideItem,
} from '../workspace/service.js';
import { confirmBooking, cancelBooking, readInterviewConfiguration } from '../workspace/interview.js';
import { OPTIONAL_ITEM_KEYS, type OptionalItemKey } from '../workspace/registry.js';

export const ADMIN_WORKSPACE_PATH = '/api/admin/campaigns';

export interface AdminWorkspaceDeps {
  db: Database;
  auth: Auth;
}

const actorOf = (req: express.Request): string => `user:${req.authUser?.id ?? 'unknown'}`;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function isItem(value: unknown): value is OptionalItemKey {
  return typeof value === 'string' && (OPTIONAL_ITEM_KEYS as readonly string[]).includes(value);
}

function badRequest(res: express.Response, whatHappened: string, next: string): void {
  res
    .status(400)
    .json({ error: 'invalid_request', title: 'That could not be recorded', whatHappened, next });
}

export function createAdminWorkspaceRouter({ db, auth }: AdminWorkspaceDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  /* ── §12's Admin view ───────────────────────────────────────────────────── */

  router.get(`${ADMIN_WORKSPACE_PATH}/:campaignId/workspace`, admin, async (req, res) => {
    const campaignId = String(req.params['campaignId']);
    const view = await readAdminWorkspace(db, campaignId);

    if (!view) {
      // A campaign whose Founder has not opened the workspace has no rows yet.
      // Saying so is more useful than a 404 that reads like a missing campaign.
      res.json({
        workspace: null,
        whatHappened: 'This Founder has not opened their campaign workspace yet.',
        interviewConfiguration: await readInterviewConfiguration(db),
      });
      return;
    }

    res.json({ workspace: view });
  });

  /**
   * Re-runs every §12 rule against the stored content.
   *
   * Read-only in effect — the evaluation is idempotent and writes nothing when
   * nothing changed — so it does not take the freshness gate. It exists because
   * an accessibility check or an object verification can have been transient,
   * and an Admin looking at a Founder's stuck item needs to be able to ask
   * again without editing anything.
   */
  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/recheck`,
    admin,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      await ensureWorkspace(db, { campaignId, actor: actorOf(req) });
      await evaluateWorkspace(db, { campaignId, actor: actorOf(req), trigger: 'admin_recheck' });
      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  /* ── Invalidate, reinstate, override (§12) ──────────────────────────────── */

  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/items/:item/invalidate`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const item = req.params['item'];
      if (!isItem(item)) {
        badRequest(res, 'That is not one of the five optional items.', 'Check the address.');
        return;
      }

      const body = req.body as Record<string, unknown>;
      const reason = str(body['reason']);
      const explanation = str(body['explanation']);

      if (!reason || !explanation) {
        badRequest(
          res,
          'An invalidation needs an internal reason and an explanation the Founder can read.',
          'Write both and try again. §12 requires a reason, and the Founder has to be able to correct it.',
        );
        return;
      }

      const result = await invalidateItem(db, {
        campaignId,
        item,
        actor: actorOf(req),
        reason,
        explanation,
      });

      if (!result.ok) {
        res.status(result.code === 'locked' ? 409 : 404).json({
          error: result.code,
          title: 'That item could not be invalidated',
          whatHappened: result.message,
          next: 'Nothing was changed.',
        });
        return;
      }

      // §25.6. The database wrote the item history by trigger; this is the
      // audit row that carries the MFA and reauthentication context the
      // database cannot see.
      await db.insert(auditEvents).values({
        actor: actorOf(req),
        mfaContext: req.authUser ? 'password_session_admin_role_verified' : null,
        reauthContext: `session:${req.authSession?.id ?? 'unknown'}`,
        targetType: 'campaign_optional_item',
        targetId: `${campaignId}:${item}`,
        action: 'optional_item.invalidated',
        internalReason: reason,
        customerExplanation: explanation,
        priorValue: { complete: true },
        newValue: { complete: false, invalidated: true },
      });

      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/items/:item/reinstate`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const item = req.params['item'];
      if (!isItem(item)) {
        badRequest(res, 'That is not one of the five optional items.', 'Check the address.');
        return;
      }

      const reason = str((req.body as Record<string, unknown>)['reason']);
      if (!reason) {
        badRequest(res, 'Say why the invalidation is being lifted.', 'Write a reason and try again.');
        return;
      }

      const result = await reinstateItem(db, { campaignId, item, actor: actorOf(req), reason });
      if (!result.ok) {
        res.status(result.code === 'locked' ? 409 : 404).json({
          error: result.code,
          title: 'That item could not be reinstated',
          whatHappened: result.message,
          next: 'Nothing was changed.',
        });
        return;
      }

      await db.insert(auditEvents).values({
        actor: actorOf(req),
        mfaContext: req.authUser ? 'password_session_admin_role_verified' : null,
        reauthContext: `session:${req.authSession?.id ?? 'unknown'}`,
        targetType: 'campaign_optional_item',
        targetId: `${campaignId}:${item}`,
        action: 'optional_item.reinstated',
        internalReason: reason,
        customerExplanation: null,
        priorValue: { invalidated: true },
        newValue: { invalidated: false },
      });

      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  /**
   * §12: "A manual override requires prior value, new value, reason, actor,
   * time, and evidence."
   *
   * All six are required here and the request is refused without them. The
   * evidence is the Admin's own — a support ticket, a call, a file received out
   * of band — and it is required because an override with no evidence is
   * indistinguishable from the self-assertion the whole phase exists to
   * prevent, just performed by a different person.
   */
  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/items/:item/override`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const item = req.params['item'];
      if (!isItem(item)) {
        badRequest(res, 'That is not one of the five optional items.', 'Check the address.');
        return;
      }

      const body = req.body as Record<string, unknown>;
      const reason = str(body['reason']);
      const explanation = str(body['explanation']);
      const evidenceNote = str(body['evidence']);
      const complete = body['complete'] === true;

      if (!reason || !explanation || !evidenceNote) {
        badRequest(
          res,
          'An override needs a reason, an explanation the Founder can read, and the evidence it rests on.',
          '§12 requires all three. Write them and try again.',
        );
        return;
      }

      const before = await readAdminWorkspace(db, campaignId);
      const prior = before?.items.find((i) => i && i.item === item) ?? null;

      const result = await overrideItem(db, {
        campaignId,
        item,
        actor: actorOf(req),
        complete,
        reason,
        explanation,
        evidence: { note: evidenceNote },
      });

      if (!result.ok) {
        res.status(result.code === 'locked' ? 409 : 404).json({
          error: result.code,
          title: 'That item could not be overridden',
          whatHappened: result.message,
          next: 'Nothing was changed.',
        });
        return;
      }

      await db.insert(auditEvents).values({
        actor: actorOf(req),
        mfaContext: req.authUser ? 'password_session_admin_role_verified' : null,
        reauthContext: `session:${req.authSession?.id ?? 'unknown'}`,
        targetType: 'campaign_optional_item',
        targetId: `${campaignId}:${item}`,
        action: 'optional_item.overridden',
        internalReason: reason,
        customerExplanation: explanation,
        priorValue: prior ? { complete: prior.complete, decisionSource: prior.decisionSource } : null,
        newValue: { complete, decisionSource: complete ? 'admin_override' : null, evidence: evidenceNote },
      });

      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  /* ── The interview, on a Founder's behalf ───────────────────────────────── */

  /**
   * The reconciliation path. Phase 09's trap: "Cal.com is a source of events,
   * not truth. If the webhook is missed, the booking state must be
   * reconcilable — don't leave `confirmed` reachable only by webhook."
   *
   * `source: 'admin_reconciliation'` lands in the append-only booking history,
   * so a confirmation that came from a person is never mistaken for one that
   * came from the provider.
   */
  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/interview/:bookingId/confirm`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const body = req.body as Record<string, unknown>;

      const result = await confirmBooking(db, {
        bookingId: String(req.params['bookingId']),
        campaignId,
        actor: actorOf(req),
        source: 'admin_reconciliation',
        ...(str(body['meetingLink']) ? { meetingLink: str(body['meetingLink'])! } : {}),
        ...(str(body['interviewer']) ? { interviewer: str(body['interviewer'])! } : {}),
      });

      if (!result.ok) {
        res.status(result.code === 'incomplete' ? 422 : 404).json({
          error: result.code,
          title: 'That booking could not be confirmed',
          whatHappened: result.message,
          next: 'Fill in the missing details and try again.',
        });
        return;
      }

      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  router.post(
    `${ADMIN_WORKSPACE_PATH}/:campaignId/workspace/interview/:bookingId/cancel`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const campaignId = String(req.params['campaignId']);
      const reason = str((req.body as Record<string, unknown>)['reason']);
      if (!reason) {
        badRequest(res, 'Say why the interview is being canceled.', 'Write a reason and try again.');
        return;
      }

      const result = await cancelBooking(db, {
        bookingId: String(req.params['bookingId']),
        campaignId,
        actor: actorOf(req),
        source: 'admin',
        reason,
      });

      if (!result.ok) {
        res.status(404).json({
          error: result.code,
          title: 'That booking could not be canceled',
          whatHappened: result.message,
          next: 'Nothing was changed.',
        });
        return;
      }

      res.json({ workspace: await readAdminWorkspace(db, campaignId) });
    },
  );

  return router;
}
