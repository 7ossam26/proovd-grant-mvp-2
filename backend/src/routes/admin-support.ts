/**
 * The §26.7, §26.8, and §27.8 Admin routes (Phase 16b).
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * §5.1 names "campaign kill/suspend" in the high-impact category by name, so
 * `enforce` takes `fresh` and so does the relationship-touch log — the latter
 * because it is an append-only record of a personal commitment, and one written
 * by a stale session is one nobody can attribute.
 *
 * Reading the queue, a case, or a timeline is looking. §26.7 makes support a
 * routine daily activity; a freshness gate on the queue would have an Admin
 * reauthenticating every morning, which is how the gate stops meaning anything.
 *
 * Composing a response is a write but not a §5.1 high-impact action — it moves
 * no money and changes no eligibility — so it takes `admin` only. The §33.9.11
 * refusal is what protects it.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  openSupportCase,
  readCaseContext,
  addCaseMessage,
  transferCaseOwnership,
  readSupportQueue,
} from '../support/cases.js';
import { readSupportWorkspaceQueue, readSupportCase } from '../support/workspace/read.js';
import {
  assignCase,
  classifyCase,
  setCaseTriage,
  setCaseWaiting,
  setNextUpdateDue,
  resolveCaseWithResolution,
  closeCase,
  reopenCase,
  addCaseEvidence,
  recordCaseContact,
  recordContactOutcome,
  setCaseSubject,
  type MutationOutcome,
} from '../support/workspace/mutations.js';
import type {
  SupportTriageLevel,
  SupportWaitingParty,
  SupportEvidenceKind,
  SupportLinkedRecordKind,
  SupportContactParty,
} from '../support/workspace/logic.js';
import { RESPONSE_TEMPLATES, renderTemplate } from '../support/templates.js';
import {
  enforceCampaign,
  listEnforcementActions,
  type EnforcementDeps,
} from '../support/enforcement.js';
import {
  readTimeline,
  recordRelationshipTouch,
  listRelationshipTouches,
  type TimelineSubject,
} from '../support/timeline.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { BACKER_SUPPORT_FOUNDER_RESPONSE } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { eq } from 'drizzle-orm';
import { supportCases } from '../db/schema/support.js';
import {
  SUPPORT_TOPICS,
  SUPPORT_OWNERS,
  ENFORCEMENT_REASON_CATEGORIES,
  RELATIONSHIP_TOUCH_KINDS,
  type SupportTopic,
  type SupportOwner,
  type EnforcementReasonCategory,
  type EnforcementActionKind,
} from '../support/logic.js';

export const ADMIN_SUPPORT_BASE_PATH = '/api/admin';

export interface AdminSupportRouterDeps {
  db: Database;
  auth: Auth;
  detachPaymentMethod?:
    | ((input: { paymentMethodId: string; connectedAccountId: string }) => Promise<void>)
    | undefined;
  /** Phase 20b: the campaign Founder's seller account, resolved per campaign (§24.1). */
  resolveConnectedAccount?: ((campaignId: string) => Promise<string | null>) | undefined;
  notifyRoles?: EnforcementDeps['notifyRoles'];
  /** Phase 20b: the §27.5 Founder-response relay on a Backer's case. */
  notifier?: Notifier | undefined;
  notificationContext?: LaunchNotificationContext | undefined;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

/**
 * One answer shape for every workspace write.
 *
 * §27.1's six questions, answered from the SERVICE's own refusal rather than
 * from a friendlier sentence composed here — the browser renders whatever comes
 * back, so a paraphrase at this layer is how the API and the surface start
 * disagreeing about what went wrong.
 *
 * `next` always states what happened to the record, because the most useful
 * thing an operator can be told about a failed write is whether anything moved.
 */
function sendMutation(
  res: express.Response,
  result: MutationOutcome<Record<string, unknown>>,
  title: string,
): void {
  if (result.ok) {
    const { ok: _ok, ...rest } = result;
    res.status(200).json({ ok: true, ...rest });
    return;
  }
  res.status(result.code === 'not_found' ? 404 : 422).json({
    error: result.code,
    title,
    whatHappened: result.message,
    next: 'Nothing has changed. Correct it and try again.',
  });
}

function securityContext(req: express.Request): { mfaContext: string; reauthContext: string } {
  const session = req.authSession;
  return {
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

export function createAdminSupportRouter({
  db,
  auth,
  detachPaymentMethod,
  resolveConnectedAccount,
  notifyRoles,
  notifier,
  notificationContext,
}: AdminSupportRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── §27.8 the daily queue ─────────────────────────────────────────────── */

  router.get(`${ADMIN_SUPPORT_BASE_PATH}/support/queue`, admin, async (req, res) => {
    const horizon = req.query['horizonHours'];
    const queue = await readSupportQueue(db, {
      ...(typeof horizon === 'string' && /^\d+$/.test(horizon)
        ? { horizonHours: Number(horizon) }
        : {}),
    });
    res.json({
      ...queue,
      // §27.8: due AND overdue. The trap: an SLA nobody can see breached is an
      // SLA that gets breached, so overdue is reported as its own number.
      note: 'Overdue cases sort first. A case past its deadline stays in this queue until it is answered.',
    });
  });

  /* ── §26.7 cases ───────────────────────────────────────────────────────── */

  router.post(`${ADMIN_SUPPORT_BASE_PATH}/support/cases`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);

    const topic = str('topic') as SupportTopic | undefined;
    const owner = str('owner') as SupportOwner | undefined;
    const requesterKind = str('requesterKind') as 'backer' | 'founder' | 'creator' | undefined;

    if (!topic || !SUPPORT_TOPICS.includes(topic) || !owner || !SUPPORT_OWNERS.includes(owner)) {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That case could not be opened',
        whatHappened: 'A valid topic and owner are both required.',
        next: 'Choose a topic and an owner, then submit again.',
      });
      return;
    }
    if (!requesterKind) {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That case could not be opened',
        whatHappened: 'A case names who asked.',
        next: 'Say whether this is a Backer, a Founder, or a Creator.',
      });
      return;
    }

    const result = await openSupportCase(db, {
      topic,
      owner,
      requesterKind,
      requesterEmail: str('requesterEmail') ?? '',
      backerIdentityId: str('backerIdentityId'),
      requesterUserId: str('requesterUserId'),
      campaignId: str('campaignId'),
      reservationId: str('reservationId'),
      associationId: str('associationId'),
      message: str('message') ?? '',
      createdBy: actorOf(req),
    });

    if (!result.ok) {
      res.status(422).json({
        error: result.code,
        title: 'That case could not be opened',
        whatHappened: result.message,
        next: 'Correct it and submit again. Nothing has been recorded.',
      });
      return;
    }

    // §27.8: "Support submission returns case ID, topic, owner, human-response
    // due time, and the 48-hour Founder follow-up rule." All five, and the
    // Appendix B.8 acknowledgement is the same string that goes in the email.
    res.status(201).json({
      caseId: result.result.caseId,
      reference: result.result.reference,
      topic: result.result.topic,
      owner: result.result.owner,
      humanResponseDueAt: result.result.humanResponseDueAt.toISOString(),
      calendarVersion: result.result.calendarVersion,
      founderFollowupDueAt: result.result.founderFollowupDueAt?.toISOString() ?? null,
      acknowledgement: result.result.acknowledgement,
    });
  });

  router.get(`${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId`, admin, async (req, res) => {
    const context = await readCaseContext(db, req.params['caseId'] as string);
    if (!context) {
      res.status(404).json({ error: 'not_found', title: 'No such case' });
      return;
    }
    res.json({
      ...context,
      // §26.8: the templates travel with the context, so the Admin composing a
      // reply never has to go looking for the facts they already hold.
      templates: RESPONSE_TEMPLATES.map((t) => ({
        key: t.key,
        label: t.label,
        specRef: t.specRef,
        useWhen: t.useWhen,
      })),
    });
  });

  /** A draft an Admin edits. There is deliberately no route that sends one. */
  router.get(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/templates/:templateKey`,
    admin,
    async (req, res) => {
      const context = await readCaseContext(db, req.params['caseId'] as string);
      if (!context) {
        res.status(404).json({ error: 'not_found', title: 'No such case' });
        return;
      }
      const rendered = renderTemplate(req.params['templateKey'] as string, context);
      if (!rendered) {
        res.status(404).json({ error: 'not_found', title: 'No such template' });
        return;
      }
      res.json({
        ...rendered,
        note: 'This is a starting point. Edit it before sending — a template that sends itself would answer a person with a machine (§1.4).',
      });
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/messages`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const customerFacing = body['customerFacing'] === true;

      const result = await addCaseMessage(db, {
        caseId: req.params['caseId'] as string,
        direction: body['direction'] === 'inbound' ? 'inbound' : 'outbound',
        customerFacing,
        body: typeof body['body'] === 'string' ? body['body'] : '',
        author: actorOf(req),
        templateKey: typeof body['templateKey'] === 'string' ? body['templateKey'] : undefined,
        nextPromisedUpdateAt:
          typeof body['nextPromisedUpdateAt'] === 'string'
            ? new Date(body['nextPromisedUpdateAt'])
            : undefined,
      });

      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 422).json({
          error: result.code,
          title: 'That message was not added',
          whatHappened: result.message,
          next:
            result.code === 'raw_provider_code'
              ? 'Move the provider detail into an internal note and rewrite the reply in plain words.'
              : 'Correct it and try again. Nothing has been sent.',
        });
        return;
      }

      // §27.5/§29.10 (Phase 20b): an outbound customer-facing reply on a
      // Backer's case reaches their inbox — the response the 14-day escalation
      // arm measures is a response the Backer actually received. Deduped per
      // MESSAGE row (each reply is its own send); a provider refusal is
      // recorded by the notifier and never unwinds the recorded message.
      if (customerFacing && body['direction'] !== 'inbound' && notifier && notificationContext) {
        const [caseRow] = await db
          .select({
            requesterKind: supportCases.requesterKind,
            requesterEmail: supportCases.requesterEmail,
            reference: supportCases.reference,
          })
          .from(supportCases)
          .where(eq(supportCases.id, req.params['caseId'] as string))
          .limit(1);
        if (caseRow && caseRow.requesterKind === 'backer') {
          const replyBody = typeof body['body'] === 'string' ? body['body'] : '';
          const notice = await renderPlainNotice({
            subject: `Response to your request — ${caseRow.reference}`,
            headline: 'There is a response to your request.',
            facts: [],
            // The Admin's own words, unedited and first — this is the reply,
            // not a summary of it.
            paragraphs: [
              replyBody,
              'Reply from your pre-order page — your context is already there.',
            ],
            reference: caseRow.reference,
            supportEmail: notificationContext.supportEmail,
          });
          await notifier.send({
            eventKey: BACKER_SUPPORT_FOUNDER_RESPONSE,
            entityType: 'support_case_message',
            entityId: result.messageId,
            to: caseRow.requesterEmail,
            from: notificationContext.fromAddress,
            replyTo: notificationContext.supportEmail,
            ...notice,
          });
        }
      }

      res.status(201).json({ messageId: result.messageId });
    },
  );

  /** §26.8: the handoff note is required BEFORE the case can move. */
  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/transfer`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
      const toOwner = str('toOwner') as SupportOwner;

      if (!SUPPORT_OWNERS.includes(toOwner)) {
        res.status(400).json({
          error: 'invalid_request',
          title: 'That case did not move',
          whatHappened: 'A valid new owner is required.',
          next: 'Choose an owner and record the handoff note.',
        });
        return;
      }

      const result = await transferCaseOwnership(db, {
        caseId: req.params['caseId'] as string,
        toOwner,
        toOwnerActor: str('toOwnerActor') || actorOf(req),
        verifiedFacts: str('verifiedFacts'),
        currentOwner: str('currentOwner'),
        nextCustomerPromise: str('nextCustomerPromise'),
        statementsToKeepConsistent: str('statementsToKeepConsistent'),
        recordedBy: actorOf(req),
      });

      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 422).json({
          error: result.code,
          title: 'That case did not move',
          whatHappened: result.message,
          next: 'Complete the handoff note. The case stays with its current owner until it is complete.',
        });
        return;
      }

      res.status(201).json({ handoffId: result.handoffId });
    },
  );

  /**
   * §26.7's resolution, upgraded to record WHAT resolved it.
   *
   * The service beneath it (`resolveCase`) is untouched and still exported —
   * other modules call it — but no route reaches it any more. A case finished
   * from a human surface always says why: §26.7 wants the decision reviewable,
   * and "resolved" with no recorded resolution is the state nobody can review.
   */
  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/resolve`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await resolveCaseWithResolution(db, {
        caseId: req.params['caseId'] as string,
        resolution: typeof body['resolution'] === 'string' ? body['resolution'] : '',
        operationalNote:
          typeof body['operationalNote'] === 'string' ? body['operationalNote'] : null,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not resolved');
    },
  );

  /* ── The Support workspace (2026-08-13) ────────────────────────────────── */

  /**
   * The workspace directory.
   *
   * Deliberately a different address from `/support/queue`, which stays exactly
   * as Phase 16b built it: that one answers §27.8's "what is due or overdue"
   * and is what the `support-promises` sweep and the daily queue read. This one
   * shows finished cases too, because a workspace that hid them could not
   * answer "what did we tell this person last month".
   */
  router.get(`${ADMIN_SUPPORT_BASE_PATH}/support/workspace`, admin, async (_req, res) => {
    res.json(await readSupportWorkspaceQueue(db));
  });

  router.get(
    `${ADMIN_SUPPORT_BASE_PATH}/support/workspace/:caseId`,
    admin,
    async (req, res) => {
      const detail = await readSupportCase(db, req.params['caseId'] as string, {
        viewerUserId: req.authUser?.id,
      });
      if (!detail) {
        res.status(404).json({
          error: 'not_found',
          title: 'No such case',
          whatHappened: 'That case reference does not match anything on the record.',
          next: 'Go back to the queue and open it from there.',
        });
        return;
      }
      res.json(detail);
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/assign`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      // `assignToSelf` is the reference's "Assign to me". It resolves to the
      // SESSION's user id rather than to anything in the body — a caller that
      // could name its own actor could attribute a decision to somebody else.
      const toUserId =
        body['assignToSelf'] === true
          ? (req.authUser?.id ?? '')
          : typeof body['toUserId'] === 'string'
            ? body['toUserId']
            : '';

      if (!toUserId) {
        res.status(400).json({
          error: 'invalid_request',
          title: 'That case was not assigned',
          whatHappened: 'No Admin was named.',
          next: 'Choose an Admin, or use “Assign to me”.',
        });
        return;
      }

      const result = await assignCase(db, {
        caseId: req.params['caseId'] as string,
        toUserId,
        reason: typeof body['reason'] === 'string' ? body['reason'] : null,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not assigned');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/classify`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await classifyCase(db, {
        caseId: req.params['caseId'] as string,
        topic: (typeof body['topic'] === 'string' ? body['topic'] : '') as SupportTopic,
        subcategory: typeof body['subcategory'] === 'string' ? body['subcategory'] : null,
        internalReason:
          typeof body['internalReason'] === 'string' ? body['internalReason'] : null,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not reclassified');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/triage`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await setCaseTriage(db, {
        caseId: req.params['caseId'] as string,
        triage: (typeof body['triage'] === 'string' ? body['triage'] : '') as SupportTriageLevel,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'The triage level was not changed');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/waiting`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const promised = typeof body['nextPromisedUpdateAt'] === 'string'
        ? new Date(body['nextPromisedUpdateAt'])
        : null;

      if (promised && Number.isNaN(promised.getTime())) {
        res.status(400).json({
          error: 'invalid_request',
          title: 'That case was not changed',
          whatHappened: 'The promised update time is not a date and time.',
          next: 'Correct it and try again. Nothing has changed.',
        });
        return;
      }

      const result = await setCaseWaiting(db, {
        caseId: req.params['caseId'] as string,
        waitingOn: (typeof body['waitingOn'] === 'string'
          ? body['waitingOn']
          : '') as SupportWaitingParty,
        nextAction: typeof body['nextAction'] === 'string' ? body['nextAction'] : '',
        nextPromisedUpdateAt: promised,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not changed');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/next-update`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await setNextUpdateDue(db, {
        caseId: req.params['caseId'] as string,
        at: new Date(typeof body['at'] === 'string' ? body['at'] : ''),
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'The promised update time was not set');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/close`,
    admin,
    json,
    async (req, res) => {
      const result = await closeCase(db, {
        caseId: req.params['caseId'] as string,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not closed');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/reopen`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await reopenCase(db, {
        caseId: req.params['caseId'] as string,
        reason: typeof body['reason'] === 'string' ? body['reason'] : '',
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That case was not reopened');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/evidence`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await addCaseEvidence(db, {
        caseId: req.params['caseId'] as string,
        kind: (typeof body['kind'] === 'string' ? body['kind'] : '') as SupportEvidenceKind,
        description: typeof body['description'] === 'string' ? body['description'] : '',
        linkedKind: (typeof body['linkedKind'] === 'string'
          ? body['linkedKind']
          : 'none') as SupportLinkedRecordKind,
        linkedReference:
          typeof body['linkedReference'] === 'string' ? body['linkedReference'] : null,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That evidence was not attached');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/contacts`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const expected =
        typeof body['expectedResponseAt'] === 'string'
          ? new Date(body['expectedResponseAt'])
          : null;

      const result = await recordCaseContact(db, {
        caseId: req.params['caseId'] as string,
        partyKind: (typeof body['partyKind'] === 'string'
          ? body['partyKind']
          : '') as SupportContactParty,
        partyLabel: typeof body['partyLabel'] === 'string' ? body['partyLabel'] : '',
        message: typeof body['message'] === 'string' ? body['message'] : '',
        expectedResponseAt: expected && !Number.isNaN(expected.getTime()) ? expected : null,
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That contact was not recorded');
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/contacts/:contactId/outcome`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await recordContactOutcome(db, {
        caseId: req.params['caseId'] as string,
        contactId: req.params['contactId'] as string,
        outcome: typeof body['outcome'] === 'string' ? body['outcome'] : '',
        actor: actorOf(req),
        ...securityContext(req),
      });
      sendMutation(res, result, 'That outcome was not recorded');
    },
  );

  router.put(
    `${ADMIN_SUPPORT_BASE_PATH}/support/cases/:caseId/subject`,
    admin,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await setCaseSubject(db, {
        caseId: req.params['caseId'] as string,
        subject: typeof body['subject'] === 'string' ? body['subject'] : '',
      });
      sendMutation(res, result, 'The subject was not changed');
    },
  );

  /* ── §26.7 suspend and kill ────────────────────────────────────────────── */

  router.get(
    `${ADMIN_SUPPORT_BASE_PATH}/campaigns/:campaignId/enforcement`,
    admin,
    async (req, res) => {
      const rows = await listEnforcementActions(db, req.params['campaignId'] as string);
      res.json({
        actions: rows.map((row) => ({
          id: row.id,
          action: row.action,
          phase: row.phase,
          reasonCategory: row.reasonCategory,
          reasonDetail: row.reasonDetail,
          customerExplanation: row.customerExplanation,
          priorCampaignStatus: row.priorCampaignStatus,
          newCampaignStatus: row.newCampaignStatus,
          effectsApplied: row.effectsApplied,
          reservationsClosed: row.reservationsClosed,
          paymentMethodsDetached: row.paymentMethodsDetached,
          actor: row.actor,
          occurredAt: row.occurredAt.toISOString(),
        })),
        reasonCategories: ENFORCEMENT_REASON_CATEGORIES,
      });
    },
  );

  // §5.1 names campaign kill/suspend in the high-impact category by name.
  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/campaigns/:campaignId/enforcement`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
      const action = str('action') as EnforcementActionKind;
      const reasonCategory = str('reasonCategory') as EnforcementReasonCategory;

      const result = await enforceCampaign(
        {
          db,
          ...(detachPaymentMethod ? { detachPaymentMethod } : {}),
          ...(resolveConnectedAccount ? { resolveConnectedAccount } : {}),
          ...(notifyRoles ? { notifyRoles } : {}),
        },
        {
          campaignId: req.params['campaignId'] as string,
          action,
          reasonCategory,
          reasonDetail: str('reasonDetail'),
          customerExplanation: str('customerExplanation'),
          actor: actorOf(req),
          ...securityContext(req),
          evidenceLinks:
            body['evidenceLinks'] && typeof body['evidenceLinks'] === 'object'
              ? (body['evidenceLinks'] as Record<string, unknown>)
              : undefined,
        },
      );

      if (!result.ok) {
        res.status(result.code === 'not_found' ? 404 : 422).json({
          error: result.code,
          title: 'That campaign was not changed',
          whatHappened: result.message,
          next: 'Nothing has changed.',
        });
        return;
      }

      res.status(201).json(result.result);
    },
  );

  /* ── §26.8 the composed timeline ───────────────────────────────────────── */

  router.get(
    `${ADMIN_SUPPORT_BASE_PATH}/timeline/:subject/:subjectId`,
    admin,
    async (req, res) => {
      const subject = req.params['subject'] as TimelineSubject;
      if (subject !== 'campaign' && subject !== 'reservation' && subject !== 'association') {
        res.status(404).json({ error: 'not_found', title: 'No such timeline' });
        return;
      }

      const timeline = await readTimeline(db, subject, req.params['subjectId'] as string);
      res.json({
        ...timeline,
        // Named so the timeline is auditable itself: every entry says which
        // existing table it was read out of, because §26.8 composes rather than
        // duplicates and that claim should be checkable from the response.
        note: 'Read-only. Every entry is composed from the record that already owns it — there is no timeline event store.',
      });
    },
  );

  /* ── §26.8 one-time relationship touches ───────────────────────────────── */

  router.get(
    `${ADMIN_SUPPORT_BASE_PATH}/campaigns/:campaignId/relationship-touches`,
    admin,
    async (req, res) => {
      const rows = await listRelationshipTouches(db, req.params['campaignId'] as string);
      res.json({
        touches: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          note: row.note,
          recordedBy: row.recordedBy,
          occurredAt: row.occurredAt.toISOString(),
        })),
        kinds: RELATIONSHIP_TOUCH_KINDS,
        // Said in the response, so the surface renders the constraint rather
        // than merely obeying it (§26.8, §30).
        note: 'These are one-time personal service events. Each may be logged once per campaign, and there is no way to schedule one.',
      });
    },
  );

  router.post(
    `${ADMIN_SUPPORT_BASE_PATH}/campaigns/:campaignId/relationship-touches`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await recordRelationshipTouch(db, {
        campaignId: req.params['campaignId'] as string,
        kind: typeof body['kind'] === 'string' ? body['kind'] : '',
        note: typeof body['note'] === 'string' ? body['note'] : '',
        recordedBy: actorOf(req),
      });

      if (!result.ok) {
        res.status(422).json({
          error: result.code,
          title: 'That touch was not logged',
          whatHappened: result.message,
          next: 'Nothing has changed.',
        });
        return;
      }

      res.status(201).json({ touchId: result.touchId });
    },
  );

  return router;
}
