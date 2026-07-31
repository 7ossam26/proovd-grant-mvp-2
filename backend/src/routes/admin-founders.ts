/**
 * Admin — Users → Founders, Campaign detail, and the invitation controls.
 * Spec §7, §26.1, §26.2, §33.12.4.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * Sending, resending, and revoking an invitation reach a real person or cut off
 * their access, so they take `requireFreshSession` alongside `requireAdmin`.
 * Composing and previewing do not: nothing leaves the building, and making an
 * Admin reauthenticate to type a paragraph teaches them to reauthenticate
 * reflexively, which is how the gate stops meaning anything.
 *
 * ── §33.12.4: auto-populated, and overrides recorded ────────────────────────
 * "User/provider data auto-populates Admin; every override preserves
 * before/after, reason, actor, and time." Everything Proovd already knows —
 * campaign status, the anchors, the send history, token state, the retention
 * due date — is served from the record and is not re-keyable here. What Admin
 * adds is review and decision data, and `composeInvitation` writes prior and
 * new values into `audit_events` for every edit.
 *
 * ── The raw token never appears ─────────────────────────────────────────────
 * No response below carries a draft link. §28.1 puts the raw value in the
 * delivered URL and nowhere else, so Admin sees that a live link exists, its
 * version, and when it expires — never the value. An Admin who needs to give a
 * Founder a working link resends one.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import { campaigns } from '../db/schema/domain.js';
import {
  createProspect,
  composeInvitation,
  previewInvitation,
  sendInvitation,
  revokeInvitation,
  readDraft,
  listFounders,
  type InvitationContext,
} from '../invitations/service.js';
import { retentionDueAt, UNCLAIMED_DRAFT_RETENTION_DAYS } from '../invitations/retention.js';
import { NO_GUARANTEE_TEXT, PROCESS_SUMMARY } from '../notifications/templates/founder-invitation.js';

export const ADMIN_FOUNDERS_PATH = '/api/admin/founders';
export const ADMIN_CAMPAIGNS_PATH = '/api/admin/campaigns';

export interface AdminFoundersDeps {
  db: Database;
  auth: Auth;
  tokens: TokenService;
  notifier: Notifier;
  context: InvitationContext;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

function badRequest(res: express.Response, whatHappened: string, next: string): void {
  res.status(400).json({
    error: 'invalid_request',
    title: 'That could not be saved',
    whatHappened,
    next,
  });
}

export function createAdminFoundersRouter({
  db,
  auth,
  tokens,
  notifier,
  context,
}: AdminFoundersDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  /* ── The fixed copy, so the compose surface can show it read-only ──────── */

  router.get(`${ADMIN_FOUNDERS_PATH}/invitation-copy`, admin, (_req, res) => {
    // §7 forbids Admin promising acceptance, results, reward pricing, or a
    // named Creator's participation. These paragraphs are constants in the
    // template for that reason; the surface renders them so Admin knows exactly
    // what goes out, and there is no route that edits them.
    res.json({
      processSummary: PROCESS_SUMMARY,
      noGuarantee: NO_GUARANTEE_TEXT,
      retentionDays: UNCLAIMED_DRAFT_RETENTION_DAYS,
    });
  });

  /* ── Users → Founders (§26.1) ──────────────────────────────────────────── */

  router.get(ADMIN_FOUNDERS_PATH, admin, async (_req, res) => {
    const rows = await listFounders(db);
    res.json({
      founders: rows.map((row) => ({
        ...row,
        lastSentAt: row.lastSentAt ? new Date(row.lastSentAt).toISOString() : null,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        anonymisedAt: row.anonymisedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        retentionDueAt:
          retentionDueAt(row.lastSentAt ? new Date(row.lastSentAt) : null)?.toISOString() ?? null,
      })),
    });
  });

  router.post(ADMIN_FOUNDERS_PATH, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const required = ['legalName', 'email', 'productName', 'invitationSource', 'internalOwner'];
    for (const field of required) {
      if (typeof body[field] !== 'string' || !(body[field] as string).trim()) {
        badRequest(
          res,
          `${field} is required before a prospect can be created.`,
          'Fill it in and create the prospect again.',
        );
        return;
      }
    }

    const created = await createProspect(db, {
      legalName: body['legalName'] as string,
      preferredName: (body['preferredName'] as string) ?? null,
      email: body['email'] as string,
      phone: (body['phone'] as string) ?? null,
      productName: body['productName'] as string,
      productUrl: (body['productUrl'] as string) ?? null,
      launchFrame: (body['launchFrame'] as string) ?? null,
      usAgeFit: (body['usAgeFit'] as string) ?? null,
      deliveryFeasibility: (body['deliveryFeasibility'] as string) ?? null,
      compensationExpectations: (body['compensationExpectations'] as string) ?? null,
      affiliateSourcingHypothesis: (body['affiliateSourcingHypothesis'] as string) ?? null,
      adminNotes: (body['adminNotes'] as string) ?? null,
      discoveryEvidence: Array.isArray(body['discoveryEvidence'])
        ? (body['discoveryEvidence'] as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : null,
      invitationSource: body['invitationSource'] as string,
      internalOwner: body['internalOwner'] as string,
      actor: actorOf(req),
    });

    res.status(201).json(created);
  });

  /* ── One draft, everything Admin needs about it ────────────────────────── */

  router.get(`${ADMIN_FOUNDERS_PATH}/:draftId`, admin, async (req, res) => {
    const record = await readDraft(db, req.params['draftId'] as string);
    if (!record) {
      res.status(404).json({
        error: 'not_found',
        title: 'No such draft',
        whatHappened: 'There is no invited draft at that address.',
        next: 'Go back to the Founders list.',
      });
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
    });
  });

  /* ── Compose (§7) ──────────────────────────────────────────────────────── */

  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/invitation`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const str = (key: string) =>
      typeof body[key] === 'string' ? (body[key] as string) : null;

    const result = await composeInvitation(db, req.params['draftId'] as string, {
      whatWeUnderstood: str('whatWeUnderstood'),
      whyInvited: str('whyInvited'),
      senderName: str('senderName'),
      senderEmail: str('senderEmail'),
      expectedSetupTime: str('expectedSetupTime'),
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
      // The server's answer to "may this be sent". The surface disables Send on
      // it; the send route re-decides independently, because §1.1 requires
      // server-side authorization and a disabled button is not one.
      blocked: preview.blocked,
    });
  });

  /* ── Send, resend, revoke (§7) ─────────────────────────────────────────── */

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
    const body = req.body as { reason?: unknown };
    if (typeof body?.reason !== 'string') {
      badRequest(
        res,
        'A reason is required before an invitation can be revoked.',
        'Say why, then revoke.',
      );
      return;
    }

    const result = await revokeInvitation(
      { db, tokens },
      { draftId: req.params['draftId'] as string, actor: actorOf(req), reason: body.reason },
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

  return router;
}
