/**
 * Admin — the Founder panel's eleven stages (migration 0059, 2026-08-22).
 * Spec §1.4, §9, §14.2, §15, §20, §23.1, §25.6, §26.2, §27.2, §33.12.4.
 *
 * ── What this router is for ────────────────────────────────────────────────
 * `admin-founders.ts` already serves the Founder workspace and §7's invitation,
 * and nothing here duplicates it. This router carries the panel's OWN records —
 * the eleven-stage workflow position, the application-review decision, the
 * Admin offers, the internal notes, the invite prefills, and the one route that
 * changes a saved campaign value directly. Two routers answering the same
 * question is two answers waiting to disagree, so `GET /founder-panel/:id`
 * returns a SUPPLEMENT and the workspace read stays where it is.
 *
 * ── Which routes take the freshness gate ───────────────────────────────────
 * §5.1 names the high-impact category; §33.12.5's sweep requires every mounted
 * write to be gated OR registered in `UNGATED_ADMIN_WRITES` with the sensitive
 * property it lacks. Gated here: every application-review decision (it reaches
 * the Founder and can reject an application), every Admin offer (it publishes a
 * commercial number to the Founder dashboard and its withdrawal takes one
 * away), the final-campaign send (it reaches a Creator), and every setup edit
 * (it changes a value a Backer or a Creator was shown).
 *
 * Ungated, and registered: adding an internal note, and writing the invitation
 * prefills. Neither reaches anybody, neither moves money, and `admin.ts` has
 * recorded since Phase 06a why that matters — making an Admin reauthenticate
 * for ordinary work teaches them to do it reflexively, and a gate cleared
 * without thinking is not a gate.
 *
 * ── What no route here does ────────────────────────────────────────────────
 *  · No route creates a `proposal_versions` row. §14.2 keeps acceptance
 *    bilateral, and `admin-decisions.ts` records that the absent accept-route
 *    IS the enforcement. An Admin offer is a separate record the Founder still
 *    responds to through the route they already use.
 *  · No route writes a derived aggregate — Backers, reserved, clicks, posts —
 *    or an auto-populated Stripe field (§26.2, §33.8.13). Those keys are in the
 *    register carrying the reason instead of a control.
 *  · No route accepts a prior value. Every one is read under lock inside the
 *    transaction that changes it (§33.12.4).
 *  · No route moves `campaigns.status`. §23.1 makes it lifecycle-only, and
 *    `pending_review`/`changes_required`/`approved` already belong to the §15
 *    BUILD review — a different decision later in the flow.
 */

import express from 'express';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignDrafts } from '../db/schema/invitations.js';
import { campaignAssets } from '../db/schema/workspace.js';
import type { Auth } from '../auth/auth.js';
import { ObjectNotStored, type ObjectStorage } from '../storage/object-storage.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { notifyApplicationReviewOutcome } from '../campaign/application-review-notifications.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  addAccountWarning,
  addInternalNote,
  decideApplicationReview,
  editSetupField,
  listAffiliateCandidates,
  openApplicationReview,
  readFounderPanel,
  recordAdminOffer,
  recordFinalCampaignSend,
  requestApplicationChange,
  setApplicationReviewRequirement,
  updateInvitePrefills,
  withdrawAdminOffer,
  type PanelActor,
  type PanelRefusal,
  type PrefillPatch,
} from '../founders/panel/service.js';
import {
  APPLICATION_REVIEW_OUTCOMES,
  FOUNDER_WORKFLOW_LABELS,
  FOUNDER_WORKFLOW_STAGE_IDS,
  PREFILL_AFFILIATE_TYPES,
} from '../founders/panel/workflow.js';
import {
  SETUP_FIELDS,
  SETUP_FIELD_GROUPS,
  SETUP_FIELD_GROUP_LABELS,
} from '../founders/panel/setup-fields.js';
import {
  APPLICATION_FIELDS,
  APPLICATION_FIELD_GROUPS,
  APPLICATION_FIELD_GROUP_LABELS,
} from '../founders/panel/application-fields.js';

export const ADMIN_FOUNDER_PANEL_PATH = '/api/admin/founder-panel';
export const ADMIN_PANEL_FOUNDERS_PATH = '/api/admin/founders';
export const ADMIN_PANEL_CAMPAIGNS_PATH = '/api/admin/campaigns';

export interface AdminFounderPanelDeps {
  db: Database;
  auth: Auth;
  storage: ObjectStorage;
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
  internalRecipient?: string | undefined;
}

/**
 * §25.6/§28.2's actor context, taken from the guarded session rather than the
 * body. The database cannot see either fact, which is why they are recorded.
 */
function whoOf(req: Request): PanelActor {
  const session = req.authSession;
  return {
    actor: `user:${req.authUser?.id ?? 'unknown'}`,
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function notFound(res: Response, whatHappened: string): void {
  res.status(404).json({
    error: 'not_found',
    title: 'Nothing at that address',
    whatHappened,
    next: 'Go back to the Founders list.',
  });
}

/**
 * A refusal the record decided. 422 with the reason the service named, because
 * §27.1 asks what happened and what can be done now — never a generic error.
 */
function sendRefusal(res: Response, refusal: PanelRefusal): void {
  if (refusal.code === 'not_found') {
    notFound(res, refusal.message);
    return;
  }
  const status = refusal.code === 'invalid_value' || refusal.code === 'reason_required' ? 400 : 422;
  res.status(status).json({
    error: refusal.code,
    title: 'That could not be saved',
    whatHappened: refusal.message,
    next: refusal.next,
  });
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Reads an optional integer from a body.
 *
 * Three answers: `undefined` means "not in this request" and writes nothing
 * (§9's autosave rule), `null` clears, and `'invalid'` is a value that could
 * not be read — reported rather than silently stored, because a number that
 * vanished on save is worse than one that was refused.
 */
function optionalInt(body: Record<string, unknown>, key: string): number | null | undefined | 'invalid' {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : 'invalid';
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return 'invalid';
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined | 'invalid' {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value : 'invalid';
}

export function createAdminFounderPanelRouter(deps: AdminFounderPanelDeps): Router {
  const { db, auth, storage } = deps;
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  /* ══ The registers ═════════════════════════════════════════════════════ */

  /**
   * Registered before `/:prospectId`, because `registers` is one path segment
   * and would otherwise be read as somebody's id. Express matches in order.
   *
   * The register is the single source for the stage menu, the field labels, and
   * the reason rendered where a control is absent. Three hand-written lists is
   * two chances to disagree, and the disagreement shows up as a control that
   * opens nothing.
   */
  router.get(`${ADMIN_FOUNDER_PANEL_PATH}/registers`, admin, (_req, res) => {
    res.json({
      workflowStages: FOUNDER_WORKFLOW_STAGE_IDS.map((id) => ({
        id,
        label: FOUNDER_WORKFLOW_LABELS[id],
      })),
      applicationReviewOutcomes: APPLICATION_REVIEW_OUTCOMES,
      prefillAffiliateTypes: PREFILL_AFFILIATE_TYPES,
      applicationFieldGroups: APPLICATION_FIELD_GROUPS.map((id) => ({
        id,
        label: APPLICATION_FIELD_GROUP_LABELS[id],
      })),
      applicationFields: APPLICATION_FIELDS,
      setupFieldGroups: SETUP_FIELD_GROUPS.map((id) => ({
        id,
        label: SETUP_FIELD_GROUP_LABELS[id],
      })),
      // `refusal` rides along on purpose: §1.4 prefers a control that is absent
      // with its reason rendered where the control would be, over a disabled one
      // that invites somebody to work out how to enable it.
      setupFields: SETUP_FIELDS,
    });
  });

  /* ══ 1. The panel supplement ═══════════════════════════════════════════ */

  router.get(
    `${ADMIN_FOUNDER_PANEL_PATH}/:prospectId/assets/:assetId/download`,
    admin,
    async (req, res) => {
      const [asset] = await db
        .select({
          id: campaignAssets.id,
          storageKey: campaignAssets.storageKey,
          filename: campaignAssets.originalFilename,
          contentType: campaignAssets.contentType,
          purpose: campaignAssets.purpose,
        })
        .from(campaignAssets)
        .innerJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaignAssets.campaignId))
        .where(
          and(
            eq(campaignDrafts.prospectId, String(req.params['prospectId'] ?? '')),
            eq(campaignAssets.id, String(req.params['assetId'] ?? '')),
            eq(campaignAssets.state, 'stored'),
            isNull(campaignAssets.removedAt),
          ),
        )
        .limit(1);

      if (!asset || (asset.purpose !== 'logo' && asset.purpose !== 'visual')) {
        notFound(res, 'There is no downloadable Founder image at that address.');
        return;
      }

      try {
        const object = await storage.getObject(asset.storageKey);
        const filename =
          (asset.filename ?? `${asset.purpose}-upload`)
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/[\r\n"]/g, '_') || `${asset.purpose}-upload`;
        const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
        res.setHeader('Content-Type', object.contentType || asset.contentType);
        res.setHeader('Content-Length', String(object.byteSize));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
        res.send(object.body);
      } catch (error) {
        if (error instanceof ObjectNotStored) {
          notFound(res, 'The upload record exists, but the stored file is missing.');
          return;
        }
        res.status(503).json({
          error: 'storage_unavailable',
          title: 'That image could not be downloaded',
          whatHappened: 'The stored file could not be read.',
          next: 'Try the download again. The Founder record has not changed.',
        });
      }
    },
  );

  router.get(`${ADMIN_FOUNDER_PANEL_PATH}/:prospectId`, admin, async (req, res) => {
    const view = await readFounderPanel(db, String(req.params['prospectId'] ?? ''));
    if (!view) {
      notFound(res, 'There is no Founder at that address.');
      return;
    }
    res.json(view);
  });

  /* ══ 2. Internal notes ═════════════════════════════════════════════════ */

  /**
   * UNGATED, and registered in `UNGATED_ADMIN_WRITES` with its reason: a note
   * is Proovd's own record about its own work. It moves no money, changes no
   * configuration, enforces against nobody, and reaches nobody — the body never
   * appears on a timeline (§26.8), because a timeline is exactly the view that
   * gets pasted into a customer message.
   */
  router.post(
    `${ADMIN_PANEL_FOUNDERS_PATH}/:prospectId/notes`,
    admin,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await addInternalNote(db, whoOf(req), {
        prospectId: String(req.params['prospectId'] ?? ''),
        body: str(body, 'body'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.status(201).json({ note: result.note });
    },
  );

  /** A warning is an enforcement signal, so it always requires fresh auth. */
  router.post(
    `${ADMIN_PANEL_FOUNDERS_PATH}/:prospectId/warnings`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await addAccountWarning(db, whoOf(req), {
        prospectId: String(req.params['prospectId'] ?? ''),
        reason: str(body, 'reason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.status(201).json({ warning: result.warning });
    },
  );

  /* ══ 3. Invite prefills ════════════════════════════════════════════════ */

  /**
   * UNGATED, and registered: this is the same act as composing the invitation
   * beside it — Proovd's own prep on an unsent draft. It reaches nobody, and
   * Send re-decides server-side whatever this wrote.
   *
   * A key ABSENT writes nothing; a key present as `null` clears (§9's autosave
   * rule). A failed save never clears a valid field.
   */
  router.put(
    `${ADMIN_PANEL_FOUNDERS_PATH}/:draftId/prefills`,
    admin,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const patch: PrefillPatch = {};

      const views = optionalInt(body, 'viewsCount');
      if (views === 'invalid') {
        sendRefusal(res, {
          ok: false,
          code: 'invalid_value',
          message: 'The number of views must be a whole number that is not negative.',
          next: 'Nothing you entered was lost.',
        });
        return;
      }
      if (views !== undefined) patch.viewsCount = views;

      const matches = optionalInt(body, 'affiliateMatches');
      if (matches === 'invalid') {
        sendRefusal(res, {
          ok: false,
          code: 'invalid_value',
          message: 'The number of affiliate matches must be a whole number that is not negative.',
          next: 'Nothing you entered was lost.',
        });
        return;
      }
      if (matches !== undefined) patch.affiliateMatches = matches;

      if (Object.prototype.hasOwnProperty.call(body, 'affiliateTypes')) {
        const value = body['affiliateTypes'];
        if (
          value !== null &&
          (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        ) {
          sendRefusal(res, {
            ok: false,
            code: 'invalid_value',
            message: '“affiliateTypes” must be a list of creator types, or null to clear it.',
            next: 'Nothing you entered was lost.',
          });
          return;
        }
        patch.affiliateTypes = value as string[] | null;
      }

      for (const key of ['affiliateType', 'brandVoice1', 'brandVoice2', 'username'] as const) {
        const value = optionalString(body, key);
        if (value === 'invalid') {
          sendRefusal(res, {
            ok: false,
            code: 'invalid_value',
            message: `“${key}” must be text, or null to clear it.`,
            next: 'Nothing you entered was lost.',
          });
          return;
        }
        if (value !== undefined) patch[key] = value;
      }

      const result = await updateInvitePrefills(db, whoOf(req), {
        draftId: String(req.params['draftId'] ?? ''),
        patch,
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.json({ prefills: result.prefills });
    },
  );

  /* ══ 4–6. Application review ═══════════════════════════════════════════ */

  router.put(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/application-review-requirement`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const required = body['required'];
      if (typeof required !== 'boolean') {
        sendRefusal(res, {
          ok: false,
          code: 'invalid_required',
          message: 'Application Review must be explicitly confirmed as required.',
          next: 'Confirm the requirement and try again. Nothing has changed.',
        });
        return;
      }
      const result = await setApplicationReviewRequirement(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        required,
        internalReason: str(body, 'internalReason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.json({ requirement: result.requirement, changed: result.changed });
    },
  );

  /**
   * Opens a round, or returns the one already open.
   *
   * FRESH: opening a review is the act that puts a Founder's application in
   * front of a decision, and the decision routes beside it move on the same
   * record. §9 defines no lifecycle state for this, so the round is the record
   * — see `campaign_application_reviews` in migration 0059 for why it is not a
   * `campaigns.status` value.
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/application-review`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const result = await openApplicationReview(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.status(result.opened ? 201 : 200).json({ review: result.review, opened: result.opened });
    },
  );

  /**
   * FRESH: this approves or rejects a Founder's application, and the reason it
   * records is shown to them.
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/application-review/decide`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await decideApplicationReview(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        outcome: str(body, 'outcome'),
        internalReason: str(body, 'internalReason'),
        customerExplanation: str(body, 'customerExplanation') || null,
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      await notifyApplicationReviewOutcome(
        {
          db,
          ...(deps.notifier ? { notifier: deps.notifier } : {}),
          ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
          ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
        },
        {
          campaignId: String(req.params['campaignId'] ?? ''),
          review: result.review,
        },
      );
      res.json({ review: result.review });
    },
  );

  /**
   * FRESH: a change request sends one exact field back to the Founder, and the
   * reason travels with it.
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/application-review/change-request`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await requestApplicationChange(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        fieldKey: str(body, 'fieldKey'),
        reason: str(body, 'reason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      await notifyApplicationReviewOutcome(
        {
          db,
          ...(deps.notifier ? { notifier: deps.notifier } : {}),
          ...(deps.notificationContext ? { context: deps.notificationContext } : {}),
          ...(deps.internalRecipient ? { internalRecipient: deps.internalRecipient } : {}),
        },
        {
          campaignId: String(req.params['campaignId'] ?? ''),
          review: result.review,
        },
      );
      res.status(201).json({ review: result.review, requestId: result.requestId });
    },
  );

  /* ══ 7–9. Matching ═════════════════════════════════════════════════════ */

  /**
   * Records an Admin offer, superseding any live one in the SAME transaction.
   *
   * FRESH: the number reaches the Founder dashboard, and the Founder responds
   * to it. Basis points, never a float — 3250 is 32.5%.
   *
   * This writes no `proposal_versions` row and moves no association status.
   * §14.2's acceptance is the Founder's, and no Admin route substitutes for it.
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/affiliates/:associationId/offer`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const raw = body['offerBasisPoints'];
      const basisPoints =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && /^\d+$/.test(raw.trim())
            ? Number(raw.trim())
            : Number.NaN;

      const result = await recordAdminOffer(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        associationId: String(req.params['associationId'] ?? ''),
        offerBasisPoints: basisPoints,
        internalReason: str(body, 'internalReason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.status(201).json({ offer: result.offer, supersededOfferId: result.superseded });
    },
  );

  /**
   * FRESH: withdrawing takes a published number away from the Founder
   * dashboard. Deliberately NOT routed through §29 enforcement — withdrawing an
   * offer is not a sanction, and the enforcement path asks for seven inputs
   * that describe one.
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/affiliates/:associationId/offer/withdraw`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await withdrawAdminOffer(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        associationId: String(req.params['associationId'] ?? ''),
        reason: str(body, 'reason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.json({ offer: result.offer });
    },
  );

  /**
   * FRESH: recording a final-campaign send is a statement that a Creator was
   * given the campaign.
   *
   * `notification_id` stays NULL, and that is a STATE — "recorded, not
   * confirmed delivered" (§27.2). Nothing here claims an inbox received
   * anything, because a key with no sender claims a message that does not
   * exist (§1.4).
   */
  router.post(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/affiliates/:associationId/final-campaign`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const result = await recordFinalCampaignSend(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        associationId: String(req.params['associationId'] ?? ''),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.status(201).json({ send: result.send });
    },
  );

  /* ══ 10. Affiliate candidates ══════════════════════════════════════════ */

  /**
   * The recruitable Creators, each carrying whether this campaign already has
   * them. A read — it attaches nobody, and there is deliberately no attach
   * route here: `POST /api/admin/affiliates` owns creating an association, and
   * a second path to it would be a second answer.
   */
  router.get(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/affiliate-candidates`,
    admin,
    async (req, res) => {
      const candidates = await listAffiliateCandidates(
        db,
        String(req.params['campaignId'] ?? ''),
      );
      if (!candidates) {
        notFound(res, 'There is no campaign at that address.');
        return;
      }
      res.json({ candidates, total: candidates.length });
    },
  );

  /* ══ 11. The setup field edit ══════════════════════════════════════════ */

  /**
   * Changes one saved campaign value directly, and records it.
   *
   * FRESH: this changes a value a Backer or a Creator was shown, and it does so
   * without the Founder's involvement.
   *
   * The body carries `{value, internalReason}` and NOTHING ELSE. In particular
   * it carries no prior value: §33.12.4's whole point is that a caller who
   * supplies both halves can supply a flattering pair, so the service reads the
   * prior value from the row under lock inside the transaction that changes it.
   *
   * `:fieldKey` resolves through `SETUP_FIELDS` — never a table or a column
   * name. Row-scoped keys carry their row id in the middle segment
   * (`faq.<faqId>.answer`).
   */
  router.patch(
    `${ADMIN_PANEL_CAMPAIGNS_PATH}/:campaignId/setup/:fieldKey`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = bodyOf(req);
      const result = await editSetupField(db, whoOf(req), {
        campaignId: String(req.params['campaignId'] ?? ''),
        fieldKey: String(req.params['fieldKey'] ?? ''),
        value: body['value'],
        internalReason: str(body, 'internalReason'),
      });
      if (!result.ok) {
        sendRefusal(res, result);
        return;
      }
      res.json({
        fieldKey: result.fieldKey,
        label: result.label,
        priorValue: result.priorValue,
        newValue: result.newValue,
        materiality: result.materiality,
        draftVersion: result.draftVersion,
        editId: result.editId,
      });
    },
  );

  return router;
}
