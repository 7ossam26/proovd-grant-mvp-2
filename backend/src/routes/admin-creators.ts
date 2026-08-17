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
import { createAuditWriter } from '../auth/audit.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  listAssignableCampaigns,
  listCreatorDirectory,
  looksLikeRecordId,
} from '../affiliates/workspace/directory.js';
import { readCreatorWorkspace } from '../affiliates/workspace/record.js';
import { readCreatorRelationship } from '../affiliates/workspace/relationship.js';
import { LINK_TEST_MARKER } from '../affiliates/roster-labels.js';
import type { StripeGateway, StripeModeValue } from '../payments/stripe-client.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { unconfiguredStorage } from '../storage/object-storage.js';
import type { Notifier } from '../notifications/send.js';
import {
  assignProspectToCampaign,
  correctAffiliateAccountField,
  recordCreatorAccessAction,
  recordCreatorDeletionRequest,
  recordCreatorDeletionReview,
  refreshCreatorStripeAccount,
  requestAffiliateCorrection,
  sendCreatorPasswordRecovery,
  setTrackingLinkPaused,
  type ActorContext,
  type MutationFailure,
} from '../affiliates/workspace/mutations.js';
import {
  recordMetricDecision,
  removeEvidenceFile,
  requestEvidenceUpload,
  verifyEvidenceUpload,
  type EvidenceFailure,
} from '../affiliates/workspace/evidence.js';
import {
  decideDeliverable,
  decideTerminationRequest,
  openAffiliateSupportCase,
  recordDeliverable,
  recordDeliverableEvidence,
  recordMediationNote,
  recordTerminationRequest,
  sendPayoutReminder,
  verifyAvailability,
} from '../affiliates/workspace/relationship-mutations.js';
import type { AskContext } from '../affiliates/workspace/asks.js';
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
  /**
   * The gateway, for the §13 re-read (Session B's gap 4). Absent means the
   * refresh control refuses with the reason rather than pretending (§1.4).
   */
  stripeGateway?: StripeGateway | undefined;
  /** The evidence-picture store (gap 5). Unconfigured refuses honestly. */
  storage?: ObjectStorage | undefined;
  /** The §27 sender for the two Session B asks. Absent → recorded, not sent. */
  notifier?: Notifier | undefined;
  askContext?: AskContext | undefined;
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
  stripeGateway,
  storage,
  notifier,
  askContext,
}: AdminCreatorsDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json = express.json({ limit: '128kb' });
  const evidenceStorage = storage ?? unconfiguredStorage;
  const asks = { notifier, context: askContext };
  const audit = createAuditWriter(db);

  /**
   * The whole record, re-read. Every mutation ends here — or on the same 404 a
   * nonexistent Affiliate gets, which is what a caller sees if their record was
   * removed between the write and the read.
   */
  async function sendWorkspace(res: Response, prospectId: string): Promise<void> {
    const detail = await readCreatorWorkspace(db, prospectId, {
      storageConfigured: evidenceStorage.configured,
    });
    if (!detail) {
      notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
      return;
    }
    res.json(detail);
  }

  /** Maps an evidence-module failure onto the response its code means. */
  function evidenceFail(res: Response, result: EvidenceFailure, title: string): void {
    if (result.code === 'not_found') {
      notFound(res, 'Not found', result.message);
      return;
    }
    if (result.code === 'storage_unavailable') {
      res.status(503).json({
        error: 'storage_unavailable',
        title,
        whatHappened: result.message,
        next: 'Nothing has changed. The record itself is unaffected.',
      });
      return;
    }
    refused(res, title, result.message);
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
          storageConfigured: evidenceStorage.configured,
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
        // The relationship re-read — the payload the link surface renders
        // from, and what `api.ts` has always declared. (Until Session C this
        // answered with the workspace read while the client type said
        // relationship; the old page's test stubbed the response, which is
        // exactly how a type lie survives.)
        await sendRelationship(res, prospectId, associationId);
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

  /* ── Evidence pictures (§5.3, §12 — Session B, gap 5) ─────────────────────*/

  /**
   * UNGATED, all three, and registered: recording research evidence reaches
   * nobody and decides nothing — the §5.3 decision that reads it is the
   * verification route, which takes the gate. The presign is Phase 09a's
   * step 1 (a courtesy; the read-back decides), the verify is step 3, and the
   * removal is the §12 correction that re-permits the same checksum.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/evidence/uploads`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const byteSize = typeof body['byteSize'] === 'number' ? body['byteSize'] : NaN;

        const result = await requestEvidenceUpload(
          { db, storage: evidenceStorage },
          {
            prospectId,
            category: str(body, 'category') ?? '',
            contentType: str(body, 'contentType') ?? '',
            byteSize,
            checksumSha256: str(body, 'checksumSha256') ?? '',
            originalFilename: str(body, 'originalFilename'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          evidenceFail(res, result, 'That picture could not be attached');
          return;
        }
        res.json({
          fileId: result.fileId,
          url: result.url,
          requiredHeaders: result.requiredHeaders,
          expiresAt: result.expiresAt.toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/evidence/uploads/:fileId/verify`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, fileId } = req.params as { prospectId: string; fileId: string };
        const result = await verifyEvidenceUpload(
          { db, storage: evidenceStorage },
          { prospectId, fileId, who: whoOf(req) },
        );
        if (!result.ok) {
          evidenceFail(res, result, 'That upload could not be verified');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/evidence/uploads/:fileId/remove`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, fileId } = req.params as { prospectId: string; fileId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await removeEvidenceFile(
          { db },
          { prospectId, fileId, reason: str(body, 'reason'), who: whoOf(req) },
        );
        if (!result.ok) {
          evidenceFail(res, result, 'That picture could not be removed');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── The per-metric decision, and the ask it may carry (Session B) ────────*/

  /**
   * GATED, for the whole-record verification's reason: it is the trail the
   * §5.3 decision rests on, §33.12.4 wants the decider attributable, and a
   * `more_evidence_needed` decision reaches a real person as the §11 ask.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/evidence/metric-decision`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await recordMetricDecision(
          { db, asks },
          {
            prospectId,
            metric: str(body, 'metric') ?? '',
            decision: str(body, 'decision') ?? '',
            detail: str(body, 'detail'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          evidenceFail(res, result, 'That decision could not be recorded');
          return;
        }
        const detail = await readCreatorWorkspace(db, prospectId, {
          storageConfigured: evidenceStorage.configured,
        });
        if (!detail) {
          notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
          return;
        }
        // The ask's outcome rides beside the re-read: a decision recorded with
        // nothing sent is a state the Admin must see, not infer (§1.4).
        res.json({ detail, ask: { sent: result.sent, reason: result.sendReason } });
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── Correcting the Affiliate-supplied record (Session B) ─────────────────*/

  /**
   * GATED: it rewrites the person's own confirmed facts — including the
   * address every transactional message goes to — and §25.6 wants the actor
   * on it to be somebody who authenticated recently. The prior value is read
   * from the row under lock, never taken from the caller (§33.12.4).
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/account-correction`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await correctAffiliateAccountField(
          { db },
          {
            prospectId,
            field: str(body, 'field') ?? '',
            newValue: str(body, 'newValue'),
            reason: str(body, 'reason'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That correction could not be recorded');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GATED: it reaches a real person. The ask is recorded first (§1.3) and the
   * message dedups on that record; a transport refusal leaves the ask
   * recorded and the response says nothing was sent.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/correction-request`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await requestAffiliateCorrection(
          { db, asks },
          {
            prospectId,
            subjectLabel: str(body, 'subjectLabel'),
            note: str(body, 'note'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That request could not be sent');
          return;
        }
        const detail = await readCreatorWorkspace(db, prospectId, {
          storageConfigured: evidenceStorage.configured,
        });
        if (!detail) {
          notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
          return;
        }
        res.json({ detail, ask: { sent: result.sent, reason: result.sendReason } });
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── Password recovery (§5.5 — Session B, gap 8) ──────────────────────────*/

  /**
   * GATED: it reaches a real person's inbox with a credential-changing link.
   * One reset path — Better Auth mints the token and the one sender chooses
   * the key by role; this route only asks for the same thing the person's own
   * "forgot password" produces, and refuses when nobody has claimed the
   * account (§1.4: there is no password to reset).
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/password-recovery`,
    admin,
    fresh,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const result = await sendCreatorPasswordRecovery(
          { db, auth },
          { prospectId, who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'That recovery link could not be sent');
          return;
        }
        await sendWorkspace(res, prospectId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── The Session C relationship records (0048) ────────────────────────────*/

  /**
   * The relationship, re-read. Every relationship-scoped mutation ends here —
   * the campaign tabs render from this read, so the answer is the state the
   * write produced, never a local patch.
   */
  async function sendRelationship(
    res: Response,
    prospectId: string,
    associationId: string,
  ): Promise<void> {
    const detail = await readCreatorRelationship(db, associationId, {
      publicOrigin: appBaseUrl,
      linkTestMarker: LINK_TEST_MARKER,
      stripeMode: stripeMode ?? 'test',
      storageConfigured: evidenceStorage.configured,
    });
    if (!detail || detail.prospectId !== prospectId) {
      notFound(res, 'Relationship not found', 'There is no campaign relationship at that address.');
      return;
    }
    res.json(detail);
  }

  /**
   * UNGATED, and registered: recording an agreed work item and what was
   * supplied against it are receipts — they reach nobody and decide nothing.
   * The DECISION (verified / more evidence / the waiver) takes the gate, for
   * the metric-decision route's reason: it is the trail §22.8's completion
   * criterion reads, and §33.12.4 wants the decider attributable.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/deliverables`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId } = req.params as {
          prospectId: string;
          associationId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await recordDeliverable(
          { db },
          { prospectId, associationId, title: str(body, 'title'), who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'That deliverable could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/deliverables/:deliverableId/evidence`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId, deliverableId } = req.params as {
          prospectId: string;
          associationId: string;
          deliverableId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await recordDeliverableEvidence(
          { db },
          {
            prospectId,
            associationId,
            deliverableId,
            reference: str(body, 'reference'),
            note: str(body, 'note'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That evidence receipt could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/deliverables/:deliverableId/decision`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId, deliverableId } = req.params as {
          prospectId: string;
          associationId: string;
          deliverableId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await decideDeliverable(
          { db },
          {
            prospectId,
            associationId,
            deliverableId,
            outcome: str(body, 'outcome') ?? '',
            findings: str(body, 'findings'),
            waiverRecordedBy: str(body, 'waiverRecordedBy'),
            waiverReason: str(body, 'waiverReason'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That decision could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GATED: the availability check is a recorded judgement §22.8's completion
   * criteria read, exactly as a deliverable decision is. The TERM is composed
   * from records server-side — the body carries only the answer and the note.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/availability`,
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
        const result = await verifyAvailability(
          { db },
          {
            prospectId,
            associationId,
            available: typeof body['available'] === 'boolean' ? (body['available'] as boolean) : null,
            detail: str(body, 'detail'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That availability check could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  /** UNGATED, and registered: what Admin told the parties. It decides nothing. */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/mediation-note`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId } = req.params as {
          prospectId: string;
          associationId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await recordMediationNote(
          { db },
          { prospectId, associationId, note: str(body, 'note'), who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'That mediation note could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * UNGATED, and registered: recording that a party ASKED to end the
   * partnership — the §29.1/deletion-request posture. The DECISION takes the
   * gate: it is the answer somebody may be asked to stand behind, even though
   * executing anything stays with the §29 and §24.8 machinery.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/termination-request`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId } = req.params as {
          prospectId: string;
          associationId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const effectiveAt = parseInstant(body['effectiveAt']);
        const requestedAt = parseInstant(body['requestedAt']);
        if (effectiveAt === 'invalid' || requestedAt === 'invalid') {
          badRequest(res, 'A date could not be read.', 'Use a full date, or leave the request date blank to record now.');
          return;
        }
        const result = await recordTerminationRequest(
          { db },
          {
            prospectId,
            associationId,
            reason: str(body, 'reason'),
            effectiveAt: effectiveAt ?? null,
            cause: str(body, 'cause') ?? '',
            moneyTreatment: str(body, 'moneyTreatment') ?? '',
            receivedVia: str(body, 'receivedVia'),
            requestedAt: requestedAt ?? null,
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That termination request could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/relationships/:associationId/termination-request/:requestId/decision`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      try {
        const { prospectId, associationId, requestId } = req.params as {
          prospectId: string;
          associationId: string;
          requestId: string;
        };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await decideTerminationRequest(
          { db },
          {
            prospectId,
            associationId,
            requestId,
            decision: str(body, 'decision') ?? '',
            note: str(body, 'note'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That decision could not be recorded');
          return;
        }
        await sendRelationship(res, prospectId, associationId);
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── The payout reminder (§13, §27.4 — Session C, gap 3) ──────────────────*/

  /**
   * GATED: it reaches a real person. The ask is recorded first (§1.3), the
   * send dedups on that record, and the send is the EXISTING §27 key — no new
   * message is invented, and the words are the state-change sender's own.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/payout-reminder`,
    admin,
    fresh,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const result = await sendPayoutReminder(
          { db, asks },
          { prospectId, who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'That reminder could not be sent');
          return;
        }
        const detail = await readCreatorWorkspace(db, prospectId, {
          storageConfigured: evidenceStorage.configured,
        });
        if (!detail) {
          notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
          return;
        }
        res.json({ detail, ask: { sent: result.sent, reason: result.sendReason } });
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── Case intake (§26.7, §27.8 — Session C, gap 7) ────────────────────────*/

  /**
   * UNGATED, and registered — the Support workspace's own posture: opening a
   * case records what somebody asked and starts the published clock; it moves
   * no money and changes nobody's standing. The case is born through
   * `openSupportCase`, so there is no second queue.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/support-case`,
    admin,
    json,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await openAffiliateSupportCase(
          { db },
          {
            prospectId,
            associationId: str(body, 'associationId'),
            topic: str(body, 'topic') ?? '',
            subject: str(body, 'subject'),
            subcategory: str(body, 'subcategory'),
            message: str(body, 'message'),
            who: whoOf(req),
          },
        );
        if (!result.ok) {
          fail(res, result, 'That case could not be opened');
          return;
        }
        const detail = await readCreatorWorkspace(db, prospectId, {
          storageConfigured: evidenceStorage.configured,
        });
        if (!detail) {
          notFound(res, 'Affiliate not found', 'There is no Affiliate at that address.');
          return;
        }
        res.json({ detail, opened: { caseId: result.caseId, reference: result.reference } });
      } catch (error) {
        next(error);
      }
    },
  );

  /* ── The live Stripe re-read (§13 — Session B, gap 4) ─────────────────────*/

  /**
   * UNGATED, and registered: it re-reads a fact the provider owns and updates
   * the stored record through the Phase 10b reconciliation path — no money
   * moves, nobody's standing changes, and nothing reaches the Affiliate.
   */
  router.post(
    `${ADMIN_CREATORS_PATH}/:prospectId/stripe-refresh`,
    admin,
    async (req, res, next) => {
      try {
        const { prospectId } = req.params as { prospectId: string };
        const result = await refreshCreatorStripeAccount(
          {
            db,
            onboarding: stripeGateway ? { gateway: stripeGateway, audit } : null,
          },
          { prospectId, who: whoOf(req) },
        );
        if (!result.ok) {
          fail(res, result, 'The Stripe status could not be re-read');
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
