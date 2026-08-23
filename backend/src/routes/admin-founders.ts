/**
 * Admin — the Founder workspace and the §7 invitation.
 * Spec §7, §9, §10, §25.6, §25.8, §26.1, §26.2, §26.7, §33.12.4.
 *
 * ── Two subjects, and they are not two names for one thing ──────────────────
 * The workspace is keyed on `founder_prospects.id` — the PERSON. A Founder
 * whose campaign was archived-and-restarted (§9's wrong-type path) has more
 * than one draft and more than one campaign, and the prospect is what survives
 * a restart, so the workspace addresses it and every pane fans out from there.
 *
 * The §7 invitation routes are keyed on `campaign_drafts.id` — ONE INVITATION.
 * That is a different subject, not a second address for the same one: a resend
 * rotates one draft's token, a revoke kills one draft's link, and `readDraft`
 * answers about one message. `invitations/service.ts` has said so since Phase
 * 06b, and the §33.1 acceptance suite drives those routes by draft id.
 *
 * The two meet at `GET /api/admin/founders/:id`, which resolves a prospect
 * first and a draft second. That is unambiguous — an id is one or the other —
 * and it is the only place either subject is guessed at.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * §5.1 names the high-impact category; the register in `shared/src/qa/system.ts`
 * names the property that puts a route in it, and §33.12.5's sweep requires the
 * two sets to partition exactly. Gated here: sending, resending and cancelling
 * an invitation (each reaches a real person or cuts off their access), the
 * §26.7 access decision, the §22.7 ban, the §25.8 closure review, the §22.10
 * readiness decision, the §10 Creator result, the §9 archive-and-restart, and a
 * profile-field edit once the Founder owns the account.
 *
 * Ungated: composing, previewing, recording a prospect, prefilling §9's two
 * answers, overriding a value for one unsent invitation, and writing down that
 * somebody asked to close their account. None of it reaches anybody, and
 * `admin.ts` has recorded since Phase 06a why that matters — making an Admin
 * reauthenticate for ordinary work teaches them to do it reflexively, and a
 * gate cleared without thinking is not a gate.
 *
 * ── The field gate is decided by the record, and fails closed ───────────────
 * `editReasonRequired` already answers "is this somebody else's data": before
 * the claim a Founder record is Proovd's own prep, and afterwards it belongs to
 * a person. One predicate, said once — changing somebody else's record takes
 * both a stated reason and a recent sign-in. An unregistered key or an unknown
 * Founder takes the gate too: if the process cannot tell whose record this is,
 * it is not a permissive answer (`guards.ts`'s whole posture).
 *
 * ── §33.12.4: auto-populated, and overrides recorded ────────────────────────
 * Everything Proovd already knows — campaign status, the anchors, the send
 * history, token state, the retention due date, the money — is served from the
 * record and is not re-keyable here. What an Admin adds is review and decision
 * data, and every write below stores prior value, new value, reason, evidence,
 * actor, MFA/reauth context, and time. No route accepts a prior value.
 *
 * ── The raw token never appears ─────────────────────────────────────────────
 * No response below carries a draft link. §28.1 puts the raw value in the
 * delivered URL and nowhere else, so Admin sees that a live link exists, its
 * version, and when it expires — never the value. An Admin who needs a Founder
 * to have a working link sends a new one.
 */

import { Router, type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { AuditWriter } from '../auth/audit.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { campaigns } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import {
  updateProspect,
  composeInvitation,
  previewInvitation,
  sendInvitation,
  revokeInvitation,
  readDraft,
  listFounders as listInvitationDrafts,
  type InvitationContext,
} from '../invitations/service.js';
import { retentionDueAt, UNCLAIMED_DRAFT_RETENTION_DAYS } from '../invitations/retention.js';
import { NO_GUARANTEE_TEXT, PROCESS_SUMMARY } from '../notifications/templates/founder-invitation.js';
import {
  readVetting,
  prefillVetting,
  setCampaignPath,
  readFieldEdits,
  readPossibleCreatorSignal,
  recordPossibleCreatorSignal,
  archiveAndRestartVetting,
  type CampaignTypeValue,
} from '../vetting/service.js';
import { readClaimProfile, readSignupComplete } from '../vetting/claim.js';
import { editReasonRequired, founderFieldByKey } from '../founders/logic.js';
import {
  invitableDraftOf,
  listFounders,
  loadFounderContext,
  looksLikeRecordId,
  readFounderWorkspace,
} from '../founders/workspace.js';
import {
  addFounder,
  addMeetingNote,
  addResearchEntry,
  banFounder,
  clearInvitationOverride,
  recordAccessAction,
  recordDeletionRequest,
  recordDeletionReview,
  recordInvitationSender,
  revokeFounderSessions,
  sendFounderPasswordRecovery,
  setInvitationOverride,
  setNextCampaignReadiness,
  updateFounderField,
  type ActorContext,
  type FounderMutationDeps,
} from '../founders/mutations.js';
import type { OnboardingContext } from '../payments/onboarding.js';
import { hardDeleteFounder, postgresErrorCode } from '../founders/hard-delete.js';

export const ADMIN_FOUNDERS_PATH = '/api/admin/founders';
export const ADMIN_CAMPAIGNS_PATH = '/api/admin/campaigns';

export interface AdminFoundersDeps {
  db: Database;
  auth: Auth;
  audit: AuditWriter;
  tokens: TokenService;
  notifier: Notifier;
  context: InvitationContext;
  /**
   * §13's payment-setup facts, when this deployment has a Stripe client.
   * Absent means the money pane says Stripe is not configured rather than
   * making a claim about the Founder (§1.4, §32.2).
   */
  onboarding?: OnboardingContext | undefined;
}

/**
 * Reads an optional instant from a request body.
 *
 * Three answers, not two: `undefined` means "not in this request" and writes
 * nothing (§9's autosave rule), `null` means "clear it", and `'invalid'` is a
 * value that could not be read — which the caller reports rather than silently
 * storing as NULL, because a date that vanished on save is worse than one that
 * was refused.
 */
function parseInstant(value: unknown): Date | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? 'invalid' : at;
}

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

function badRequest(res: Response, whatHappened: string, next: string): void {
  res.status(400).json({
    error: 'invalid_request',
    title: 'That could not be saved',
    whatHappened,
    next,
  });
}

function notFound(res: Response, title: string, whatHappened: string): void {
  res.status(404).json({
    error: 'not_found',
    title,
    whatHappened,
    next: 'Go back to the Founders list.',
  });
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

function str(body: Record<string, unknown>, key: string): string | null {
  return typeof body[key] === 'string' ? (body[key] as string) : null;
}

/**
 * What each §22.7 refusal means, in words an Admin can act on.
 *
 * `recordGhostBan` answers with a status rather than a sentence because the
 * same refusals are surfaced on more than one queue. The wording lives here so
 * a ban that was not recorded says why it was not (§27.1).
 */
const BAN_REFUSALS: Record<string, string> = {
  campaign_not_found: 'There is no Founder or campaign at that address.',
  no_campaign: 'This Founder has no campaign, so there is no record to evaluate a ban against.',
  no_founder_account: 'This Founder has not created an account, so there is nobody to ban.',
  unknown_trigger:
    'That is not one of §22.7’s four defined triggers, and there is no discretionary trigger.',
  trigger_not_met: 'The record does not currently meet that trigger, so the ban was refused.',
  already_banned: 'This Founder already carries a permanent ban. §22.7 is one strike.',
  missing_fields:
    '§22.7 requires the evidence, the notice, the payment-recovery status, and the enforcement decision to be recorded.',
  raw_provider_code_in_notice:
    'The Founder-facing notice contains a provider or fraud code. §29.4 asks for the actual behaviour and evidence instead.',
};

export function createAdminFoundersRouter({
  db,
  auth,
  audit,
  tokens,
  notifier,
  context,
  onboarding,
}: AdminFoundersDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  const mutations: FounderMutationDeps = { db, audit };

  /** The whole workspace, re-read after every write. One source of truth. */
  const workspaceOf = (prospectId: string) =>
    readFounderWorkspace(
      { db, invitationContext: context, ...(onboarding ? { onboarding } : {}) },
      prospectId,
    );

  /** Serves the workspace, or the same 404 a nonexistent Founder gets. */
  async function sendWorkspace(res: Response, prospectId: string): Promise<void> {
    const detail = await workspaceOf(prospectId);
    if (!detail) {
      notFound(res, 'No such Founder', 'There is no Founder at that address.');
      return;
    }
    res.json(detail);
  }

  /**
   * The freshness gate for a field edit, decided by the record.
   *
   * §25.6 already answers "is this somebody else's data" through
   * `editReasonRequired`, and this reuses that one predicate rather than
   * inventing a second rule that could disagree with it: changing a claimed
   * Founder's own details takes both a stated reason and a recent sign-in;
   * correcting Proovd's own pre-claim prep takes neither.
   *
   * An unregistered key, an unknown Founder, or a database that will not answer
   * all take the gate. That is the safe direction and the one `guards.ts` takes
   * everywhere else — a process that cannot tell whose record this is has not
   * established that the edit is routine.
   */
  const freshWhenClaimed: RequestHandler = (req, res, next: NextFunction) => {
    void (async () => {
      const field = founderFieldByKey(String(req.params['key'] ?? ''));
      if (!field) {
        fresh(req, res, next);
        return;
      }
      let claimed: boolean;
      try {
        const ctx = await loadFounderContext(db, String(req.params['prospectId'] ?? ''));
        if (!ctx) {
          fresh(req, res, next);
          return;
        }
        claimed = ctx.accountUserId !== null;
      } catch {
        fresh(req, res, next);
        return;
      }
      if (editReasonRequired(field.group, claimed)) {
        fresh(req, res, next);
        return;
      }
      next();
    })();
  };

  /* ── §7's fixed copy, so a compose surface can show it read-only ───────── */

  /**
   * Registered before `/:id`, because `invitation-copy` is one path segment and
   * would otherwise be read as somebody's id. Express matches in order.
   *
   * §7 forbids Admin promising acceptance, results, reward pricing, or a named
   * Creator's participation. These paragraphs are constants in the template for
   * that reason; a surface renders them so Admin knows exactly what goes out,
   * and there is no route that edits them.
   */
  router.get(`${ADMIN_FOUNDERS_PATH}/invitation-copy`, admin, (_req, res) => {
    res.json({
      processSummary: PROCESS_SUMMARY,
      noGuarantee: NO_GUARANTEE_TEXT,
      retentionDays: UNCLAIMED_DRAFT_RETENTION_DAYS,
    });
  });

  /* ══ The person: Users → Founders (§26.1) ═══════════════════════════════ */

  /**
   * One row per PERSON, carrying the §26.1 invitation facts of their current
   * draft.
   *
   * A Founder who restarted after a wrong campaign type appears once, which is
   * the defect that made the workspace person-scoped. The draft-level facts
   * ride alongside because §26.1 asks for them on this list and there is
   * exactly one live invitation per person to report.
   */
  router.get(ADMIN_FOUNDERS_PATH, admin, async (_req, res) => {
    const rows = await listFounders({ db });
    const drafts = await listInvitationDrafts(db);

    // The newest draft is the live invitation: a restart creates a new draft
    // for the same person and leaves the old campaign archived.
    const liveDraft = new Map<string, (typeof drafts)[number]>();
    for (const draft of drafts) {
      if (!liveDraft.has(draft.prospectId)) liveDraft.set(draft.prospectId, draft);
    }

    res.json({
      founders: rows.map((row) => {
        const draft = liveDraft.get(row.prospectId) ?? null;
        return {
          ...row,
          draftId: draft?.draftId ?? null,
          campaignId: draft?.campaignId ?? null,
          status: draft?.status ?? null,
          invitationSource: draft?.invitationSource ?? null,
          internalOwner: draft?.internalOwner ?? null,
          lastSentAt: draft?.lastSentAt ? new Date(draft.lastSentAt).toISOString() : null,
          claimedAt: draft?.claimedAt?.toISOString() ?? null,
          anonymisedAt: draft?.anonymisedAt?.toISOString() ?? null,
          createdAt: draft?.createdAt.toISOString() ?? null,
          retentionDueAt:
            retentionDueAt(draft?.lastSentAt ? new Date(draft.lastSentAt) : null)?.toISOString() ??
            null,
        };
      }),
    });
  });

  /**
   * Permanently removes one Founder and the complete foreign-key graph rooted
   * at their campaigns, drafts, prospect, and (Founder-only) account.
   *
   * This is intentionally distinct from §25.8's deletion-request record. It is
   * the explicit Admin hard-delete requested for disposable or incorrectly
   * created records, so it takes the freshness gate and requires both a typed
   * email confirmation and a substantial reason at the database boundary.
   */
  router.delete(
    `${ADMIN_FOUNDERS_PATH}/:prospectId`,
    admin,
    fresh,
    json,
    async (req, res, next) => {
      const prospectId = req.params['prospectId'] as string;
      const body = req.body as Record<string, unknown>;
      if (!looksLikeRecordId(prospectId)) {
        notFound(res, 'No such Founder', 'There is no Founder at that address.');
        return;
      }

      try {
        const deleted = await hardDeleteFounder(db, {
          prospectId,
          confirmationEmail: str(body, 'confirmationEmail') ?? '',
          reason: str(body, 'reason') ?? '',
          actor: actorOf(req),
        });
        res.json({ deleted: true, ...deleted });
      } catch (error) {
        const code = postgresErrorCode(error);
        if (code === 'P0002') {
          notFound(res, 'No such Founder', 'There is no Founder at that address.');
          return;
        }
        if (code === '22023') {
          badRequest(
            res,
            error instanceof Error ? error.message : 'The deletion confirmation was not valid.',
            'Check the Founder email and give a deletion reason. Nothing was deleted.',
          );
          return;
        }
        if (code === '54001' || code === '23503' || code === 'P0001') {
          res.status(409).json({
            error: 'deletion_blocked',
            title: 'That Founder was not deleted',
            whatHappened: 'A protected related record prevented permanent deletion. Nothing was deleted.',
            next: 'Keep the closure request for retention review, or remove the protected test data first.',
          });
          return;
        }
        next(error);
      }
    },
  );

  /* ── §7's first act: writing somebody down ─────────────────────────────── */

  router.post(ADMIN_FOUNDERS_PATH, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    // §7 splits into two acts and this route is the first: writing down a
    // person somebody met off-platform. Only the two facts that identify them
    // are required. The rest of §7's invitation-creation list is filled in on
    // the workspace and enforced at Send, which is where a blank one actually
    // costs something.
    for (const field of ['legalName', 'email']) {
      if (typeof body[field] !== 'string' || !(body[field] as string).trim()) {
        badRequest(
          res,
          `${field} is required before a prospect can be created.`,
          'Fill it in and create the prospect again.',
        );
        return;
      }
    }

    const lastContactAt = parseInstant(body['lastContactAt']);
    if (lastContactAt === 'invalid') {
      badRequest(
        res,
        'That last-contact date could not be read.',
        'Give a date, or leave it empty if you do not remember.',
      );
      return;
    }

    // There is no `competition` key here, in `addFounder`, or in the table
    // behind it (§9, §33.1.5). A caller that offers one is ignored rather than
    // stored, because there is nowhere for the answer to go.
    const created = await addFounder(
      mutations,
      {
        legalName: body['legalName'] as string,
        email: body['email'] as string,
        preferredName: str(body, 'preferredName'),
        phone: str(body, 'phone'),
        productName: str(body, 'productName'),
        // The workspace calls it `website`; §7's column is the product URL.
        productUrl: str(body, 'productUrl') ?? str(body, 'website'),
        invitationSource: str(body, 'invitationSource'),
        internalOwner: str(body, 'internalOwner'),
        lastContactAt: lastContactAt ?? null,
        adminNotes: str(body, 'adminNotes'),
        problem: str(body, 'problem'),
        solution: str(body, 'solution'),
      },
      whoOf(req),
    );

    res.status(201).json(created);
  });

  /**
   * The directory's one-click create-and-send act.
   *
   * The request key is database-unique. If the browser loses the response and
   * retries, this route resumes the same draft; if delivery was already
   * confirmed it returns that send without rotating the link or emailing twice.
   */
  router.post(
    `${ADMIN_FOUNDERS_PATH}/create-and-invite`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const required = [
        ['requestKey', 'Request key'],
        ['legalName', 'Founder name'],
        ['email', 'Email'],
        ['businessName', 'Business'],
        ['invitationSource', 'Invitation source'],
        ['internalOwner', 'Internal owner'],
        ['whatWeUnderstood', 'What Proovd understood'],
        ['whyInvited', 'Why the Founder was invited'],
        ['expectedSetupTime', 'Expected setup time'],
        ['campaignType', 'Campaign path'],
      ] as const;
      const missing = required
        .filter(([key]) => typeof body[key] !== 'string' || !(body[key] as string).trim())
        .map(([, label]) => label);
      if (missing.length > 0) {
        badRequest(
          res,
          `The invitation is incomplete. Still blank: ${missing.join(', ')}.`,
          'Complete every field and try again. No invitation was sent.',
        );
        return;
      }

      const requestKey = (body['requestKey'] as string).trim();
      const email = (body['email'] as string).trim().toLowerCase();
      const campaignType = (body['campaignType'] as string).trim();
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
        badRequest(res, 'The request key is not valid.', 'Reload the form and try again.');
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        badRequest(res, 'The Founder email is not valid.', 'Correct the address and try again.');
        return;
      }
      if (campaignType !== 'pre_build' && campaignType !== 'pre_launch') {
        badRequest(
          res,
          'That is not one of the two campaign paths.',
          'Choose Idea Campaign or Product Campaign and try again.',
        );
        return;
      }
      if (!req.authUser?.name?.trim() || !req.authUser.email?.trim()) {
        refused(
          res,
          'That invitation was not sent',
          'The sending Admin account must have a name and email address before it can be named in the invitation.',
        );
        return;
      }

      const findCreated = async () => {
        const [row] = await db
          .select({
            prospectId: founderProspects.id,
            campaignId: campaignDrafts.campaignId,
            draftId: campaignDrafts.id,
          })
          .from(founderProspects)
          .innerJoin(campaignDrafts, eq(campaignDrafts.prospectId, founderProspects.id))
          .where(eq(founderProspects.creationRequestKey, requestKey))
          .limit(1);
        return row ?? null;
      };

      let created = await findCreated();
      if (!created) {
        try {
          created = await addFounder(
            mutations,
            {
              creationRequestKey: requestKey,
              legalName: body['legalName'] as string,
              email,
              phone: str(body, 'phone'),
              productName: body['businessName'] as string,
              invitationSource: body['invitationSource'] as string,
              internalOwner: body['internalOwner'] as string,
            },
            whoOf(req),
          );
        } catch (error) {
          // A simultaneous retry may win the unique request-key insert. Read
          // the winner; any other database failure remains a real failure.
          created = await findCreated();
          if (!created) throw error;
        }
      }

      const current = await readDraft(db, created.draftId);
      const confirmed = current?.hasLiveToken
        ? current.sends.find((send) => send.notificationId !== null)
        : null;
      if (confirmed) {
        res.status(200).json({
          ...created,
          sendId: confirmed.id,
          tokenVersion: confirmed.tokenVersion,
          resent: false,
          alreadySent: true,
        });
        return;
      }

      for (const [key, value] of [
        ['bizLegal', body['businessName'] as string],
        ['state', str(body, 'location')],
      ] as const) {
        if (!value) continue;
        const updated = await updateFounderField(
          mutations,
          { prospectId: created.prospectId, key, value },
          whoOf(req),
        );
        if (!updated.ok) {
          refused(res, 'That Founder was created but the invitation was not sent', updated.message);
          return;
        }
      }

      const path = await setCampaignPath(db, created.draftId, {
        type: campaignType,
        actor: actorOf(req),
      });
      if (!path.ok) {
        refused(res, 'That Founder was created but the invitation was not sent', path.message);
        return;
      }

      const composed = await composeInvitation(db, created.draftId, {
        whatWeUnderstood: body['whatWeUnderstood'] as string,
        whyInvited: body['whyInvited'] as string,
        expectedSetupTime: body['expectedSetupTime'] as string,
        actor: actorOf(req),
      });
      if (!composed.ok) {
        refused(res, 'That Founder was created but the invitation was not sent', composed.message);
        return;
      }

      const sender = await recordInvitationSender(
        mutations,
        {
          draftId: created.draftId,
          senderName: req.authUser.name,
          senderEmail: req.authUser.email,
        },
        whoOf(req),
      );
      if (!sender.ok) {
        refused(res, 'That Founder was created but the invitation was not sent', sender.message);
        return;
      }

      const sent = await sendInvitation(
        { db, tokens, notifier },
        { draftId: created.draftId, actor: actorOf(req), context },
      );
      if (!sent.ok) {
        res.status(422).json({
          error: 'send_rejected',
          title: 'That Founder was created but the invitation was not sent',
          whatHappened: sent.message,
          next: 'Fix the named issue and submit the same form again; the request resumes this Founder.',
          ...(sent.unresolved ? { unresolved: sent.unresolved } : {}),
          prospectId: created.prospectId,
        });
        return;
      }

      res.status(201).json({
        ...created,
        sendId: sent.sendId,
        tokenVersion: sent.tokenVersion,
        resent: sent.resent,
        alreadySent: false,
      });
    },
  );

  /* ── One subject, resolved: the person, else the invitation ────────────── */

  /**
   * The workspace for a prospect id, or the per-invitation record for a draft
   * id.
   *
   * Both are real subjects and an id is one or the other. Resolving the person
   * first is deliberate: the workspace is the surface, and the draft record is
   * what the §7/§9 invitation flow reads about one message.
   */
  router.get(`${ADMIN_FOUNDERS_PATH}/:id`, admin, async (req, res) => {
    const id = req.params['id'] as string;

    // Neither subject, and not a value either query can be asked about: both
    // columns are `uuid`, so an unreadable id would fail the query rather than
    // miss it. §1.1 wants the not-found state answered, so it is answered here.
    if (!looksLikeRecordId(id)) {
      notFound(res, 'No such Founder', 'There is no Founder or invitation at that address.');
      return;
    }

    const [prospect] = await db
      .select({ id: founderProspects.id })
      .from(founderProspects)
      .where(eq(founderProspects.id, id))
      .limit(1);

    if (prospect) {
      await sendWorkspace(res, prospect.id);
      return;
    }

    const record = await readDraft(db, id);
    if (!record) {
      notFound(res, 'No such Founder', 'There is no Founder or invitation at that address.');
      return;
    }

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, record.draft.campaignId))
      .limit(1);

    res.json({
      draft: {
        id: record.draft.id,
        campaignId: record.draft.campaignId,
        prospectId: record.draft.prospectId,
        status: record.draft.status,
        whatWeUnderstood: record.draft.whatWeUnderstood,
        whyInvited: record.draft.whyInvited,
        senderName: record.draft.senderName,
        senderEmail: record.draft.senderEmail,
        expectedSetupTime: record.draft.expectedSetupTime,
        anonymisedAt: record.draft.anonymisedAt?.toISOString() ?? null,
        createdAt: record.draft.createdAt.toISOString(),
      },
      prospect: {
        id: record.prospect.id,
        legalName: record.prospect.legalName,
        preferredName: record.prospect.preferredName,
        email: record.prospect.email,
        phone: record.prospect.phone,
        lastContactAt: record.prospect.lastContactAt?.toISOString() ?? null,
        productName: record.prospect.productName,
        productUrl: record.prospect.productUrl,
        launchFrame: record.prospect.launchFrame,
        usAgeFit: record.prospect.usAgeFit,
        deliveryFeasibility: record.prospect.deliveryFeasibility,
        compensationExpectations: record.prospect.compensationExpectations,
        affiliateSourcingHypothesis: record.prospect.affiliateSourcingHypothesis,
        adminNotes: record.prospect.adminNotes,
        discoveryEvidence: record.prospect.discoveryEvidence,
        invitationSource: record.prospect.invitationSource,
        internalOwner: record.prospect.internalOwner,
        claimedAt: record.prospect.claimedAt?.toISOString() ?? null,
        anonymisedAt: record.prospect.anonymisedAt?.toISOString() ?? null,
      },
      // §26.2: the campaign record, with lifecycle and the three §21 anchors
      // shown separately. Payment flags are their own rows and stay that way.
      campaign: campaign
        ? {
            id: campaign.id,
            type: campaign.type,
            typeLockedAt: campaign.typeLockedAt?.toISOString() ?? null,
            status: campaign.status,
            affiliateRosterStatus: campaign.affiliateRosterStatus,
            campaignBuildStatus: campaign.campaignBuildStatus,
            listingPaidAt: campaign.listingPaidAt?.toISOString() ?? null,
            campaignLiveAt: campaign.campaignLiveAt?.toISOString() ?? null,
            campaignCloseAt: campaign.campaignCloseAt?.toISOString() ?? null,
            createdAt: campaign.createdAt.toISOString(),
          }
        : null,
      sends: record.sends.map((send) => ({
        id: send.id,
        sentAt: send.sentAt.toISOString(),
        recipientEmail: send.recipientEmail,
        senderName: send.senderName,
        notificationId: send.notificationId,
        tokenVersion: send.tokenVersion,
        tokenExpiresAt: send.tokenExpiresAt?.toISOString() ?? null,
        sentBy: send.sentBy,
      })),
      lastSentAt: record.lastSentAt?.toISOString() ?? null,
      retentionDueAt: retentionDueAt(record.lastSentAt)?.toISOString() ?? null,
      // Whether a usable link is outstanding — never the link (§28.1).
      hasLiveToken: record.hasLiveToken,

      /* ── §9's Admin lens ───────────────────────────────────────────────
         "Admin can see the live saved draft, provenance, completeness,
         last-save time, and errors but does not re-enter Founder data."

         Everything below is read. There is no route on this router that
         writes a Founder's answer — the one write Admin has is the Problem
         and Solution *prefill*, which §9 asks for by name, and it stops
         moving the moment the Founder edits the field. */
      vetting: await readVetting(db, record.draft.id),
      vettingEdits: await readFieldEdits(db, record.draft.id),
      claimProfile: await readClaimProfile(db, record.draft.id),
      creatorSignal: campaign ? await readPossibleCreatorSignal(db, campaign.id) : null,
      signupComplete: campaign ? await readSignupComplete(db, campaign.id) : null,
    });
  });

  /* ── One registered field of the record (§25.6, §26.2, §33.12.4) ───────── */

  /**
   * The gate is decided by the record — see `freshWhenClaimed`. The service
   * decides again, so a route reached with a stale session that happened to
   * clear the gate still cannot save without the reason §25.6 requires.
   */
  router.put(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/fields/:key`,
    admin,
    freshWhenClaimed,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await updateFounderField(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          key: req.params['key'] as string,
          value: str(body, 'value'),
          reason: str(body, 'reason'),
          evidence: str(body, 'evidence'),
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        if (result.code === 'invalid') {
          badRequest(res, result.message, 'Nothing has changed.');
          return;
        }
        refused(res, 'That could not be saved', result.message);
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  /* ── Per-invitation overrides of the profile (§7, §26.2) ───────────────── */

  /**
   * Not gated, and the reason is what the write actually touches: only
   * `campaign_drafts`. The Founder profile is left exactly as it was, the
   * workspace renders both values side by side, and the message this composes
   * has not reached anybody — Send is a separate act and it takes the gate.
   */
  router.put(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/overrides/:key`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await setInvitationOverride(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          key: req.params['key'] as string,
          value: str(body, 'value'),
          reason: str(body, 'reason'),
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        if (result.code === 'invalid') {
          badRequest(res, result.message, 'Nothing has changed.');
          return;
        }
        refused(res, 'That value was not overridden', result.message);
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  router.delete(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/overrides/:key`,
    admin,
    async (req, res) => {
      const result = await clearInvitationOverride(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          key: req.params['key'] as string,
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        if (result.code === 'invalid') {
          badRequest(res, result.message, 'Nothing has changed.');
          return;
        }
        refused(res, 'That override was not removed', result.message);
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  /* ── The invitation, addressed by the person (§7) ──────────────────────── */

  router.get(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/preview`,
    admin,
    async (req, res) => {
      const ctx = await loadFounderContext(db, req.params['prospectId'] as string);
      const draft = ctx ? invitableDraftOf(ctx) : null;
      if (!ctx || !draft) {
        notFound(res, 'No invitation to preview', 'This Founder has no invitation to preview.');
        return;
      }

      const preview = await previewInvitation(db, draft.id, context);
      if (!preview) {
        notFound(res, 'No invitation to preview', 'This Founder has no invitation to preview.');
        return;
      }

      res.json({
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        recipientEmail: preview.recipientEmail,
        unresolved: preview.unresolved,
        // §7 list items that never appear in the message, so the marker gate
        // cannot report them. Named so the surface says which one is blank
        // rather than refusing without a reason.
        missingBeforeSend: preview.missingFields,
        // The server's answer to "may this be sent". The surface disables Send
        // on it; the send route re-decides independently, because §1.1 requires
        // server-side authorization and a disabled button is not one.
        blocked: preview.blocked,
      });
    },
  );

  /**
   * Send, and resend, as two acts.
   *
   * §7 requires resend to work AND the previous link to stop working, and those
   * are two different things to tell a Founder who writes in holding the old
   * one — so they are two routes with two refusals rather than one route with a
   * flag. `sendInvitation` does the same work either way; what differs is what
   * an Admin is told they are about to do.
   */
  async function deliverInvitation(
    req: Request,
    res: Response,
    intent: 'first' | 'again',
  ): Promise<void> {
    const prospectId = req.params['prospectId'] as string;
    const ctx = await loadFounderContext(db, prospectId);
    const draft = ctx ? invitableDraftOf(ctx) : null;
    if (!ctx || !draft) {
      notFound(res, 'No invitation to send', 'This Founder has no invitation to send.');
      return;
    }
    if (ctx.prospect.claimedAt) {
      refused(
        res,
        'That invitation was not sent',
        'This invitation has already been claimed and is now an account.',
      );
      return;
    }

    const record = await readDraft(db, draft.id);
    const alreadyLive = record?.hasLiveToken === true;
    if (intent === 'first' && alreadyLive) {
      refused(
        res,
        'That invitation was not sent',
        'This Founder already has a working invitation link. Send a new invite instead — it replaces the current link.',
      );
      return;
    }
    if (intent === 'again' && !alreadyLive && (record?.sends.length ?? 0) === 0) {
      refused(
        res,
        'That invitation was not sent',
        'No invitation has been sent to this Founder yet. Send the first one instead.',
      );
      return;
    }

    // §7 requires the message to name a Proovd sender and a reply route. The
    // Admin pressing Send is that person, so it is recorded from their own
    // account rather than typed into a box — and never overwritten, because a
    // resend by a colleague must not rewrite who the first message came from.
    const sender = await recordInvitationSender(
      mutations,
      {
        draftId: draft.id,
        senderName: req.authUser?.name ?? '',
        senderEmail: req.authUser?.email ?? '',
      },
      whoOf(req),
    );
    if (!sender.ok) {
      refused(res, 'That invitation was not sent', sender.message);
      return;
    }

    const result = await sendInvitation(
      { db, tokens, notifier },
      { draftId: draft.id, actor: actorOf(req), context },
    );

    if (!result.ok) {
      res.status(422).json({
        error: 'send_rejected',
        title: 'That invitation was not sent',
        whatHappened: result.message,
        next: result.unresolved?.length
          ? `Fill in: ${result.unresolved.join(', ')}`
          : 'Nothing was delivered.',
        ...(result.unresolved ? { unresolved: result.unresolved } : {}),
      });
      return;
    }

    res.status(201).json({
      sendId: result.sendId,
      tokenVersion: result.tokenVersion,
      resent: result.resent,
    });
  }

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/send`,
    admin,
    fresh,
    json,
    async (req, res) => {
      await deliverInvitation(req, res, 'first');
    },
  );

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/new`,
    admin,
    fresh,
    json,
    async (req, res) => {
      await deliverInvitation(req, res, 'again');
    },
  );

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/password-recovery`,
    admin,
    fresh,
    async (req, res) => {
      const result = await sendFounderPasswordRecovery(
        { ...mutations, auth },
        { prospectId: req.params['prospectId'] as string, who: whoOf(req) },
      );
      if (!result.ok) {
        refused(res, 'That recovery link could not be sent', result.message);
        return;
      }
      res.json({ sent: true });
    },
  );

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/sessions/revoke`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await revokeFounderSessions(mutations, {
        prospectId: req.params['prospectId'] as string,
        reason: str(body, 'reason') ?? '',
        who: whoOf(req),
      });
      if (!result.ok) {
        refused(res, 'Those sessions were not revoked', result.message);
        return;
      }
      res.json({ revoked: result.revoked });
    },
  );

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/invitation/cancel`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const reason = str(body, 'reason');
      if (!reason || !reason.trim()) {
        badRequest(
          res,
          'A reason is required before an invitation can be canceled.',
          'Say why, then cancel.',
        );
        return;
      }

      const ctx = await loadFounderContext(db, req.params['prospectId'] as string);
      const draft = ctx ? invitableDraftOf(ctx) : null;
      if (!ctx || !draft) {
        notFound(res, 'No invitation to cancel', 'This Founder has no invitation to cancel.');
        return;
      }

      const result = await revokeInvitation(
        { db, tokens },
        { draftId: draft.id, actor: actorOf(req), reason },
      );

      if (!result.ok) {
        refused(res, 'That invitation was not canceled', result.message);
        return;
      }

      res.json({ ok: true, tokensRevoked: result.revoked });
    },
  );

  /* ── §26.7 person-level access ─────────────────────────────────────────── */

  router.post(`${ADMIN_FOUNDERS_PATH}/:prospectId/access`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const nextReviewAt = parseInstant(body['nextReviewAt']);
    if (nextReviewAt === 'invalid') {
      badRequest(
        res,
        'That next-review date could not be read.',
        'Give a date, or leave it empty. Nothing has changed.',
      );
      return;
    }

    const result = await recordAccessAction(
      mutations,
      {
        prospectId: req.params['prospectId'] as string,
        action: String(body['action'] ?? ''),
        reason: str(body, 'reason') ?? '',
        evidence: str(body, 'evidence'),
        reviewOwner: str(body, 'reviewOwner'),
        nextReviewAt: nextReviewAt ?? null,
      },
      whoOf(req),
    );

    if (!result.ok) {
      if (result.code === 'not_found') {
        notFound(res, 'No such Founder', result.message);
        return;
      }
      if (result.code === 'invalid') {
        badRequest(res, result.message, 'Nothing has changed.');
        return;
      }
      refused(res, 'That decision was not recorded', result.message);
      return;
    }

    await sendWorkspace(res, req.params['prospectId'] as string);
  });

  /* ── §22.7's one strike ────────────────────────────────────────────────── */

  /**
   * All five of §22.7's recorded facts are required, and none of them has a
   * default here. `recordGhostBan` refuses a trigger the record does not
   * currently meet and refuses a blank field by name — a route that filled in
   * "not applicable" for the payment-recovery status would be manufacturing a
   * §22.7 record nobody actually made.
   */
  router.post(`${ADMIN_FOUNDERS_PATH}/:prospectId/ban`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const outcome = await banFounder(
      mutations,
      {
        prospectId: req.params['prospectId'] as string,
        trigger: String(body['trigger'] ?? ''),
        evidence: str(body, 'evidence') ?? '',
        notice: str(body, 'notice') ?? '',
        paymentRecoveryStatus: str(body, 'paymentRecoveryStatus') ?? '',
        enforcementDecision: str(body, 'enforcementDecision') ?? '',
        internalReason: str(body, 'reason') ?? str(body, 'internalReason') ?? '',
      },
      whoOf(req),
    );

    if (outcome.status !== 'banned') {
      const message = BAN_REFUSALS[outcome.status] ?? 'That ban was not recorded.';
      const detail =
        outcome.status === 'missing_fields'
          ? `${message} Still blank: ${outcome.fields.join(', ')}.`
          : outcome.status === 'trigger_not_met'
            ? `${message} The record currently meets: ${outcome.met.length ? outcome.met.join(', ') : 'none of them'}.`
            : message;

      if (outcome.status === 'campaign_not_found' || outcome.status === 'no_campaign') {
        notFound(res, 'No such Founder', detail);
        return;
      }
      refused(res, 'That ban was not recorded', detail);
      return;
    }

    await sendWorkspace(res, req.params['prospectId'] as string);
  });

  /* ── §25.8 account-closure request and its reviews ─────────────────────── */

  /**
   * Not gated: this records what somebody told us, which is Phase 20b's own
   * decision for the §29.1 disclosures. The REVIEW below decides an outcome and
   * takes the gate.
   */
  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/deletion-request`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      // Required, and not defaulted to now: §25.8's record is of when the
      // FOUNDER asked, which is not when an Admin got round to writing it down.
      const requestedAt = parseInstant(body['requestedAt']);
      if (requestedAt === 'invalid' || requestedAt === undefined || requestedAt === null) {
        badRequest(
          res,
          'The date the Founder asked is required, and it could not be read.',
          'Give the date they asked. Nothing has been recorded.',
        );
        return;
      }

      const result = await recordDeletionRequest(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          requestDetail: str(body, 'detail') ?? str(body, 'requestDetail') ?? '',
          receivedVia: str(body, 'receivedVia') ?? '',
          requestedAt,
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        badRequest(res, result.message, 'Nothing has been recorded.');
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/deletion-request/:requestId/reviews`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await recordDeletionReview(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          requestId: req.params['requestId'] as string,
          note: str(body, 'note') ?? '',
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such request', result.message);
          return;
        }
        badRequest(res, result.message, 'Nothing has been recorded.');
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  /* ── Meeting notes and research (§7, migration 0047) ───────────────────── */

  /**
   * Both record internal working context — §7's "Admin notes and discovery
   * evidence" — and neither takes the freshness gate: writing down what a
   * conversation produced moves no money, changes no configuration, enforces
   * against nobody, and reaches nobody. Both are in `UNGATED_ADMIN_WRITES`
   * with that reason. The author is the session, never the body.
   */
  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/meeting-notes`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await addMeetingNote(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          meetingDate: str(body, 'meetingDate') ?? '',
          participants: str(body, 'participants') ?? '',
          decisions: str(body, 'decisions') ?? '',
          followUp: str(body, 'followUp') ?? '',
          sourceLink: str(body, 'sourceLink') ?? '',
          notes: str(body, 'notes'),
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        if (result.code === 'invalid') {
          badRequest(res, result.message, 'Nothing has been recorded.');
          return;
        }
        refused(res, 'That note was not recorded', result.message);
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  router.post(`${ADMIN_FOUNDERS_PATH}/:prospectId/research`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = await addResearchEntry(
      mutations,
      {
        prospectId: req.params['prospectId'] as string,
        title: str(body, 'title') ?? '',
        findings: str(body, 'findings'),
        sourceLink: str(body, 'sourceLink') ?? '',
      },
      whoOf(req),
    );

    if (!result.ok) {
      if (result.code === 'not_found') {
        notFound(res, 'No such Founder', result.message);
        return;
      }
      if (result.code === 'invalid') {
        badRequest(res, result.message, 'Nothing has been recorded.');
        return;
      }
      refused(res, 'That research was not recorded', result.message);
      return;
    }

    await sendWorkspace(res, req.params['prospectId'] as string);
  });

  /* ── §22.10 next-campaign readiness ────────────────────────────────────── */

  /**
   * §22.10 needs two statements, not one: the criteria the Admin applied, and
   * what the Founder is told. §25.6 keeps internal wording and customer wording
   * in separate columns precisely so the first never doubles as the second, and
   * §29.4 requires the explanation to name the actual position. So both are
   * required and neither is derived from the other.
   */
  router.post(
    `${ADMIN_FOUNDERS_PATH}/:prospectId/next-campaign-readiness`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const approved = body['approved'];
      if (typeof approved !== 'boolean') {
        badRequest(
          res,
          'Say whether this Founder is approved for another campaign.',
          'Choose one, then record the decision.',
        );
        return;
      }

      const result = await setNextCampaignReadiness(
        mutations,
        {
          prospectId: req.params['prospectId'] as string,
          decision: approved ? 'ready' : 'not_ready',
          criteriaNote: str(body, 'criteriaNote') ?? str(body, 'reason') ?? '',
          customerExplanation: str(body, 'customerExplanation') ?? '',
        },
        whoOf(req),
      );

      if (!result.ok) {
        if (result.code === 'not_found') {
          notFound(res, 'No such Founder', result.message);
          return;
        }
        if (result.code === 'invalid') {
          badRequest(res, result.message, 'Nothing has changed.');
          return;
        }
        refused(res, 'That decision was not recorded', result.message);
        return;
      }

      await sendWorkspace(res, req.params['prospectId'] as string);
    },
  );

  /* ══ The invitation, addressed by its own draft (§7, §9) ════════════════ */

  /* ── §9 — prefilling Problem and Solution from discovery ───────────────── */

  /**
   * There is no `competition` field in this body, in this route, or in the
   * table behind it. §9 states the rule twice and §33.1.5 tests it: Competition
   * is always blank and is written by the Founder. The way to be certain of
   * that is to leave nowhere for a prefill to go.
   *
   * No freshness gate: nothing leaves the building and nobody's access changes.
   * Making an Admin reauthenticate to paste two paragraphs teaches them to
   * reauthenticate reflexively, which is how the gate stops meaning anything.
   */
  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/vetting-prefill`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const optional = (key: string): string | null | undefined =>
      key in body ? (typeof body[key] === 'string' ? (body[key] as string) : null) : undefined;

    const result = await prefillVetting(db, req.params['draftId'] as string, {
      ...(optional('problem') !== undefined ? { problem: optional('problem') } : {}),
      ...(optional('solution') !== undefined ? { solution: optional('solution') } : {}),
      actor: actorOf(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'prefill_rejected',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.json(result.state);
  });

  /* ── The campaign path (simplified flow, 2026-08-10) ───────────────────── */

  /**
   * Admin sets Idea/Product on the draft; the Founder no longer chooses. It
   * stays changeable until the Founder submits, which is when §9's permanent
   * lock happens — after that this refuses and the archive-and-restart path
   * is the only correction.
   *
   * No freshness gate, same reasoning as the prefill above: nothing leaves
   * the building and nobody's access changes until the Founder submits.
   */
  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/campaign-path`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const raw = body['campaignPath'];
    const type =
      raw === null ? null : raw === 'pre_build' || raw === 'pre_launch' ? (raw as CampaignTypeValue) : undefined;

    if (type === undefined) {
      res.status(422).json({
        error: 'campaign_path_rejected',
        title: 'That could not be saved',
        whatHappened: 'That is not one of the two campaign paths.',
        next: 'Nothing has changed.',
      });
      return;
    }

    const result = await setCampaignPath(db, req.params['draftId'] as string, {
      type,
      actor: actorOf(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'campaign_path_rejected',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.json(result.state);
  });

  /* ── Compose (§7) ──────────────────────────────────────────────────────── */

  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/invitation`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const result = await composeInvitation(db, req.params['draftId'] as string, {
      whatWeUnderstood: str(body, 'whatWeUnderstood'),
      whyInvited: str(body, 'whyInvited'),
      senderName: str(body, 'senderName'),
      senderEmail: str(body, 'senderEmail'),
      expectedSetupTime: str(body, 'expectedSetupTime'),
      actor: actorOf(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'compose_rejected',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }
    res.json({ ok: true });
  });

  /* ── The rest of §7's invitation-creation surface ──────────────────────── */

  // Not gated, for the same reason composing is not: nothing leaves the
  // building. A key absent from the body writes nothing (§9's autosave rule),
  // so saving the product name cannot blank an invitation source recorded on a
  // different visit.
  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/prospect`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const optional = (key: string): string | null | undefined =>
      key in body ? (typeof body[key] === 'string' ? (body[key] as string) : null) : undefined;
    const pick = (key: string) => (optional(key) !== undefined ? { [key]: optional(key) } : {});

    const lastContactAt = parseInstant(body['lastContactAt']);
    if (lastContactAt === 'invalid') {
      badRequest(
        res,
        'That last-contact date could not be read.',
        'Give a date, or clear the field. Nothing has changed.',
      );
      return;
    }

    const result = await updateProspect(db, req.params['draftId'] as string, {
      ...pick('preferredName'),
      ...pick('phone'),
      ...pick('productName'),
      ...pick('productUrl'),
      ...pick('launchFrame'),
      ...pick('usAgeFit'),
      ...pick('deliveryFeasibility'),
      ...pick('compensationExpectations'),
      ...pick('affiliateSourcingHypothesis'),
      ...pick('adminNotes'),
      ...pick('invitationSource'),
      ...pick('internalOwner'),
      ...(lastContactAt !== undefined ? { lastContactAt } : {}),
      ...('discoveryEvidence' in body
        ? {
            discoveryEvidence: Array.isArray(body['discoveryEvidence'])
              ? (body['discoveryEvidence'] as unknown[]).filter(
                  (v): v is string => typeof v === 'string',
                )
              : null,
          }
        : {}),
      actor: actorOf(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: 'prospect_update_rejected',
        title: 'That could not be saved',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }
    res.json({ ok: true });
  });

  /* ── Preview — §7's gate ───────────────────────────────────────────────── */

  router.get(`${ADMIN_FOUNDERS_PATH}/:draftId/preview`, admin, async (req, res) => {
    const preview = await previewInvitation(db, req.params['draftId'] as string, context);
    if (!preview) {
      res.status(404).json({ error: 'not_found', title: 'No such draft' });
      return;
    }

    res.json({
      subject: preview.subject,
      html: preview.html,
      text: preview.text,
      recipientEmail: preview.recipientEmail,
      unresolved: preview.unresolved,
      missingFields: preview.missingFields,
      blocked: preview.blocked,
    });
  });

  /* ── Send and revoke, addressed by the draft (§7) ──────────────────────── */

  router.post(`${ADMIN_FOUNDERS_PATH}/:draftId/send`, admin, fresh, json, async (req, res) => {
    const result = await sendInvitation(
      { db, tokens, notifier },
      { draftId: req.params['draftId'] as string, actor: actorOf(req), context },
    );

    if (!result.ok) {
      res.status(422).json({
        error: 'send_rejected',
        title: 'That invitation was not sent',
        whatHappened: result.message,
        next: result.unresolved?.length
          ? `Fill in: ${result.unresolved.join(', ')}`
          : 'Nothing was delivered.',
        ...(result.unresolved ? { unresolved: result.unresolved } : {}),
      });
      return;
    }

    res.status(201).json({
      sendId: result.sendId,
      tokenVersion: result.tokenVersion,
      resent: result.resent,
    });
  });

  router.post(`${ADMIN_FOUNDERS_PATH}/:draftId/revoke`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const reason = str(body, 'reason');
    if (reason === null) {
      badRequest(
        res,
        'A reason is required before an invitation can be revoked.',
        'Say why, then revoke.',
      );
      return;
    }

    const result = await revokeInvitation(
      { db, tokens },
      { draftId: req.params['draftId'] as string, actor: actorOf(req), reason },
    );

    if (!result.ok) {
      res.status(422).json({
        error: 'revoke_rejected',
        title: 'That invitation was not revoked',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.json({ ok: true, tokensRevoked: result.revoked });
  });

  /* ══ Campaign-scoped §9/§10 decisions ═══════════════════════════════════ */

  /**
   * §10's possible-creator result.
   *
   * Takes the freshness gate. The number recorded here is what a Founder sees
   * at the last step before they create an account, and a zero holds them at a
   * waiting state until someone looks at it — that reaches a real person as
   * surely as an email does.
   */
  router.post(
    `${ADMIN_CAMPAIGNS_PATH}/:campaignId/creator-signal`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as { count?: unknown; basis?: unknown };
      if (typeof body?.count !== 'number' || typeof body?.basis !== 'string') {
        badRequest(
          res,
          'A count and the basis for it are both required.',
          'Fill both in and record it again.',
        );
        return;
      }

      const result = await recordPossibleCreatorSignal(db, {
        campaignId: req.params['campaignId'] as string,
        count: body.count,
        basis: body.basis,
        actor: actorOf(req),
      });

      if (!result.ok) {
        res.status(422).json({
          error: 'signal_rejected',
          title: 'That was not recorded',
          whatHappened: result.message,
          next: 'Nothing has changed.',
        });
        return;
      }

      res.status(201).json(result.signal);
    },
  );

  /**
   * §9, §33.1.7 — the wrong-type path.
   *
   * Archive a campaign whose type locked wrongly and begin a fresh vetting
   * record for the same person. §9 is explicit that this is not a conversion:
   * "No campaign-type migration exists. No Creator acceptance, reward, payment,
   * or consent record is copied automatically." The service reads none of those
   * tables — a stronger guarantee than checking that it copied none of them.
   *
   * The response carries the new draft id but no link. The replacement needs an
   * invitation sending, which is the send route: §28.1 puts the raw token in
   * the delivered URL and nowhere else, and this is not an exception.
   */
  router.post(
    `${ADMIN_CAMPAIGNS_PATH}/:campaignId/archive-and-restart`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as { reason?: unknown };
      if (typeof body?.reason !== 'string') {
        badRequest(
          res,
          'A reason is required before a campaign record can be archived.',
          'Say why, then archive.',
        );
        return;
      }

      const result = await archiveAndRestartVetting(db, {
        campaignId: req.params['campaignId'] as string,
        reason: body.reason,
        actor: actorOf(req),
      });

      if (!result.ok) {
        res.status(422).json({
          error: 'archive_rejected',
          title: 'That record was not archived',
          whatHappened: result.message,
          next: 'Nothing has changed.',
        });
        return;
      }

      res.status(201).json(result.result);
    },
  );

  return router;
}
