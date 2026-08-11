/**
 * Admin — the Creator (Affiliate) workspace.
 * Spec §8, §5.3, §11, §25.6, §25.8, §26.1, §26.7, §33.12.4.
 *
 * ── One subject: the PERSON ─────────────────────────────────────────────────
 * Every route here is keyed on `affiliate_prospects.id`. A Creator recruited to
 * two campaigns is ONE person with two `campaign_affiliate_associations` rows,
 * and the previous surface — deleted with the old dashboard — was
 * campaign-scoped, which meant the product could not answer "who have we
 * recruited" or "what else is this person running".
 *
 * The association-scoped routes are `admin-affiliates.ts` and stay there
 * unchanged. That is not a duplicate address for the same thing: recording a
 * verification, composing an invitation, and revoking kit access are all acts
 * against ONE relationship, and this router does not reimplement any of them —
 * the surface calls both.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * §5.1 names the high-impact category; `shared/src/qa/system.ts` names the
 * property that puts a route in it, and §33.12.5's sweep requires the gated and
 * ungated sets to partition exactly.
 *
 * Gated: the §25.8 closure review (it is a decision somebody may be asked to
 * stand behind). Ungated and registered: assigning an existing Affiliate to
 * another campaign (it creates a `prospect`-state relationship that reaches
 * nobody — the invitation that follows sends under its own gate), and recording
 * that somebody ASKED to close their account (Phase 20b's §29.1 decision,
 * applied here: writing down what somebody told us decides nothing).
 *
 * The §26.7 access decision takes the gate too: suspending somebody stops them
 * reaching `/api/creator/*` on their next call, which is the property §5.1
 * names. It is a reversible standing review and never a ban — §29's
 * association-scoped enforcement is untouched.
 *
 * ── Every mutation answers with a full re-read ──────────────────────────────
 * `sendWorkspace` re-reads the whole record, so no surface patches a payload
 * locally. A locally-edited copy is a claim about an outcome nobody confirmed,
 * and the Founders workspace has taken the same position since it was built.
 *
 * ── The raw token never appears ─────────────────────────────────────────────
 * No response below carries an invitation link (§28.1). Admin sees that a live
 * link exists and when it was last sent — never the value.
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  listAssignableCampaigns,
  listCreatorDirectory,
  looksLikeRecordId,
} from '../affiliates/workspace/directory.js';
import { readCreatorWorkspace } from '../affiliates/workspace/record.js';
import { readCreatorRelationship } from '../affiliates/workspace/relationship.js';
import { LINK_TEST_MARKER } from '../affiliates/roster-labels.js';
import type { StripeModeValue } from '../payments/stripe-client.js';
import {
  assignProspectToCampaign,
  recordCreatorAccessAction,
  recordCreatorDeletionRequest,
  recordCreatorDeletionReview,
  setTrackingLinkPaused,
  type ActorContext,
  type MutationFailure,
} from '../affiliates/workspace/mutations.js';
import { isCreatorHistoryCategory } from '../affiliates/workspace/labels.js';

export const ADMIN_CREATORS_PATH = '/api/admin/creators';

export interface AdminCreatorsDeps {
  db: Database;
  auth: Auth;
  /** Where a tracking link resolves — the `/c/:code` origin the ingest serves. */
  appBaseUrl: string;
  /**
   * §32.2's mode, for §16's connected-account readiness item.
   *
   * Absent means this deployment has no Stripe client, so the readiness read
   * would be answering a question about an account it cannot see. The pane says
   * so rather than reporting a thirteenth item as incomplete (§1.4, §32.2).
   */
  stripeMode?: StripeModeValue | undefined;
}

/* ── Small shared shapes ────────────────────────────────────────────────────*/

function actorOf(req: Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

/**
 * §25.6/§28.2's actor context, taken from the guarded session rather than the
 * body. The database cannot see either fact, which is why they are recorded.
 */
function whoOf(req: Request): ActorContext {
  const session = req.authSession;
  return {
    actor: actorOf(req),
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

function notFound(res: Response, title: string, whatHappened: string): void {
  res.status(404).json({
    error: 'not_found',
    title,
    whatHappened,
    next: 'Go back to the Affiliate directory.',
  });
}

function badRequest(res: Response, whatHappened: string, next: string): void {
  res.status(400).json({ error: 'invalid_request', title: 'That could not be saved', whatHappened, next });
}

/** A refusal the record decided. 422, with the reason the service named. */
function refused(res: Response, title: string, message: string): void {
  res.status(422).json({
    error: 'refused',
    title,
    whatHappened: message,
    next: 'Nothing has changed.',
  });
}

/** Maps a service failure onto the response its code means. */
function fail(res: Response, result: MutationFailure, title: string): void {
  if (result.code === 'not_found') notFound(res, 'Not found', result.message);
  else refused(res, title, result.message);
}

function str(body: Record<string, unknown>, key: string): string | null {
  return typeof body[key] === 'string' ? (body[key] as string) : null;
}

/**
 * Reads an optional instant from a request body.
 *
 * Three answers, not two: `undefined` means "not in this request", `null`
 * means "clear it", and `'invalid'` is a value that could not be read — which
 * the caller reports rather than silently storing as NULL, because a date that
 * vanished on save is worse than one that was refused.
 */
function parseInstant(value: unknown): Date | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? 'invalid' : at;
}

/* ── The router ─────────────────────────────────────────────────────────────*/

export function createAdminCreatorsRouter({
  db,
  auth,
  appBaseUrl,
  stripeMode,
}: AdminCreatorsDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json = express.json({ limit: '128kb' });

  /**
   * The whole record, re-read. Every mutation ends here — or on the same 404 a
   * nonexistent Affiliate gets, which is what a caller sees if their record was
   * removed between the write and the read.
   */
  async function sendWorkspace(res: Response, prospectId: string): Promise<void> {
    const detail = await readCreatorWorkspace(db, prospectId);
    if (!detail) {
      notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
      return;
    }
    res.json(detail);
  }

  /* ── Reads ────────────────────────────────────────────────────────────── */

  router.get(`${ADMIN_CREATORS_PATH}`, admin, async (_req, res, next) => {
    try {
      res.json({ creators: await listCreatorDirectory(db) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The campaigns an Admin can attach a relationship to.
   *
   * It exists because the reference's own acceptance audit refuses a free-text
   * campaign or Founder field by name, and a `<select>` needs a list. Both
   * forms that pick a campaign — Add Affiliate, and Assign to another campaign
   * — read this one.
   *
   * Deliberately unfiltered by eligibility. §8 does not state which lifecycle
   * states may take a new recruit, and inventing one here would be §1 rule 6;
   * what the list DOES carry is each campaign's status in words, so the choice
   * is informed. The relationship starts at `prospect` whatever is chosen, and
   * every downstream rule — the §14.6 deadline, §15's readiness, §20's
   * mid-campaign terms — refuses what it refuses. Archived campaigns are out:
   * §9's archive-and-restart replaced them, so recruiting to one would attach
   * somebody to a record that has a successor.
   */
  router.get(`${ADMIN_CREATORS_PATH}/campaigns`, admin, async (_req, res, next) => {
    try {
      res.json({ campaigns: await listAssignableCampaigns(db) });
    } catch (error) {
      next(error);
    }
  });

  router.get(`${ADMIN_CREATORS_PATH}/:prospectId`, admin, async (req, res, next) => {
    try {
      const { prospectId } = req.params as { prospectId: string };
      // A malformed id answers the same 404 a real-but-unknown one does. Not a
      // secrecy measure on an Admin surface — it is that "that is not an id"
      // and "no such Affiliate" lead to the same next action.
      if (!looksLikeRecordId(prospectId)) {
        notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
        return;
      }
      await sendWorkspace(res, prospectId);
    } catch (error) {
      next(error);
    }
  });

  router.get(`${ADMIN_CREATORS_PATH}/:prospectId/history`, admin, async (req, res, next) => {
    try {
      const { prospectId } = req.params as { prospectId: string };
      if (!looksLikeRecordId(prospectId)) {
        notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
        return;
      }
      const detail = await readCreatorWorkspace(db, prospectId);
      if (!detail) {
        notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
        return;
      }
      const requested = typeof req.query['category'] === 'string' ? req.query['category'] : null;
      const entries =
        requested && isCreatorHistoryCategory(requested)
          ? detail.history.filter((entry) => entry.category === requested)
          : detail.history;
      res.json({ entries, counts: detail.historyCounts });
    } catch (error) {
      next(error);
    }
  });

  /* ── One campaign relationship (§14–§18, §22.1, §24.4, §24.7) ─────────── */

  router.get(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId`,
    admin,
    async (req, res, next) => {
      try {
        const { prospectId, associationId } = req.params as {
          prospectId: string;
          associationId: string;
        };
        if (!looksLikeRecordId(prospectId) || !looksLikeRecordId(associationId)) {
          notFound(res, 'Relationship not found', 'There is no campaign relationship at that address.');
          return;
        }

        const detail = await readCreatorRelationship(db, associationId, {
          publicOrigin: appBaseUrl,
          linkTestMarker: LINK_TEST_MARKER,
          stripeMode: stripeMode ?? 'test',
        });
        if (!detail) {
          notFound(res, 'Relationship not found', 'There is no campaign relationship at that address.');
          return;
        }
        /*
         * The address carries both ids, so it can carry a pair that does not
         * belong together. A relationship read under the wrong person's id
         * answers the same 404 an unknown one does — otherwise the URL would be
         * a way to confirm which Affiliate an association belongs to.
         */
        if (detail.prospectId !== prospectId) {
          notFound(res, 'Relationship not found', 'There is no campaign relationship at that address.');
          return;
        }
        res.json(detail);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Pausing and reactivating a tracking link — §17, §18, §29.5.
   *
   * GATED. A paused link stops new attribution, and an unpaused one starts it
   * again: §18 decides every click against the link's state at the instant it
   * arrives, so this is a control over whether traffic can become money. It is
   * not enforcement — §29's action against the Creator is a separate record
   * with its own five customer-facing statement fields and its appeal window.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/link`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId } = req.params as {
          prospectId: string;
          associationId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const action = str(body, 'action');
        if (action !== 'pause' && action !== 'reactivate') {
          badRequest(
            res,
            'A link control is either a pause or a reactivation.',
            'Choose one. Ending the partnership is a §29 enforcement action with its own record.',
          );
          return;
        }

        const result = await setTrackingLinkPaused(
          { db },
          {
            associationId,
            paused: action === 'pause',
            reason: str(body, 'reason'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That link control could not be applied');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── Assign to another campaign (§8, §11) ─────────────────────────────── */

  /**
   * UNGATED, and registered in `UNGATED_ADMIN_WRITES` with its reason.
   *
   * It creates a `prospect`-state relationship: no message, no account, no
   * money, no standing change. The invitation that follows is composed and sent
   * under `admin-affiliates.ts`'s own gates, and Send re-decides server-side.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/assign-campaign`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const campaignId = str(body, 'campaignId');
        if (!campaignId) {
          badRequest(
            res,
            'Choose the campaign this relationship belongs to.',
            'A campaign is chosen from the list, never typed — a typed name is a name that matches no campaign.',
          );
          return;
        }
        const intent = str(body, 'rosterIntent') ?? 'initial_roster';
        if (intent !== 'initial_roster' && intent !== 'mid_campaign') {
          badRequest(
            res,
            'A roster designation is either the initial launch roster or a mid-campaign addition.',
            'Choose one of the two.',
          );
          return;
        }

        const result = await assignProspectToCampaign(
          { db },
          {
            prospectId,
            campaignId,
            rosterIntent: intent,
            recruitmentSource: str(body, 'recruitmentSource'),
            whyRecruited: str(body, 'whyRecruited'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That relationship could not be created');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── Account standing (§26.7) ─────────────────────────────────────────── */

  /**
   * GATED. Suspending a person's Affiliate access stops them reaching
   * `/api/creator/*` on their very next call, and restoring it lets them back
   * in — which is exactly the "changes standing" property §5.1 names.
   *
   * A recorded deviation, and a narrow one: this is a reversible review, never
   * a ban. `action` admits two values by CHECK, and §29's association-scoped
   * enforcement — with its five customer-facing statement fields and its
   * five-business-day appeal window — is untouched and lives elsewhere.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/access`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const nextReviewAt = parseInstant(body['nextReviewAt']);
        if (nextReviewAt === 'invalid') {
          badRequest(
            res,
            'That next-review date could not be read.',
            'Use a full date, or leave it blank.',
          );
          return;
        }

        const result = await recordCreatorAccessAction(
          { db },
          {
            prospectId,
            action: str(body, 'action') ?? '',
            reason: str(body, 'reason'),
            evidence: str(body, 'evidence'),
            reviewOwner: str(body, 'reviewOwner'),
            nextReviewAt: nextReviewAt ?? null,
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That access decision could not be recorded');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── The §25.8 deletion ask, and its review ───────────────────────────── */

  /**
   * UNGATED, and registered. Records that the Affiliate ASKED — Phase 20b's
   * §29.1 decision applied here: writing down what somebody told us decides
   * nothing, and the retention obligations §25.8 names are unaffected by it.
   * The review below decides an outcome and takes the gate.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/deletion-request`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const requestedAt = parseInstant(body['requestedAt']);
        if (requestedAt === 'invalid') {
          badRequest(
            res,
            'That request date could not be read.',
            'Use a full date, or leave it blank to record now.',
          );
          return;
        }

        const result = await recordCreatorDeletionRequest(
          { db },
          {
            prospectId,
            detail: str(body, 'detail'),
            receivedVia: str(body, 'receivedVia'),
            requestedAt: requestedAt ?? null,
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That request could not be recorded');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/deletion-request/:requestId/reviews`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, requestId } = req.params as {
          prospectId: string;
          requestId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;

        const result = await recordCreatorDeletionReview(
          { db },
          { requestId, note: str(body, 'note'), who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'That review could not be recorded');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
