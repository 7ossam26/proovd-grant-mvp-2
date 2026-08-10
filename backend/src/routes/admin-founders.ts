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
  updateProspect,
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
import {
  readVetting,
  prefillVetting,
  readFieldEdits,
  readPossibleCreatorSignal,
  recordPossibleCreatorSignal,
  archiveAndRestartVetting,
} from '../vetting/service.js';
import { readClaimProfile, readSignupComplete } from '../vetting/claim.js';

export const ADMIN_FOUNDERS_PATH = '/api/admin/founders';
export const ADMIN_CAMPAIGNS_PATH = '/api/admin/campaigns';

export interface AdminFoundersDeps {
  db: Database;
  auth: Auth;
  tokens: TokenService;
  notifier: Notifier;
  context: InvitationContext;
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

    // §7 splits into two acts and this route is the first: writing down a
    // person somebody met off-platform. Only the two facts that identify them
    // are required. The rest of §7's invitation-creation list is filled in on
    // the draft surface and enforced at Send, which is where a blank one
    // actually costs something.
    const required = ['legalName', 'email'];
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

    const lastContactAt = parseInstant(body['lastContactAt']);
    if (lastContactAt === 'invalid') {
      badRequest(
        res,
        'That last-contact date could not be read.',
        'Give a date, or leave it empty if you do not remember.',
      );
      return;
    }

    const created = await createProspect(db, {
      legalName: body['legalName'] as string,
      preferredName: (body['preferredName'] as string) ?? null,
      email: body['email'] as string,
      phone: (body['phone'] as string) ?? null,
      lastContactAt,
      productName: (body['productName'] as string) ?? null,
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
      invitationSource: (body['invitationSource'] as string) ?? null,
      internalOwner: (body['internalOwner'] as string) ?? null,
      actor: actorOf(req),
    });

    // §9: Problem and Solution are "human-prefilled by Proovd from discovery",
    // and this form IS the discovery record — so a call that produced them can
    // write them here rather than making an Admin retype them on the draft.
    //
    // Written after the prospect transaction commits, on 08c's precedent: the
    // prefill is idempotent and its own surface already exists, so a crash
    // between the two costs a retry rather than correctness. Holding a row lock
    // open across a second write would be a more expensive way to be no safer.
    //
    // There is no third key. Competition is never prefilled (§9, §33.1.5), and
    // `prefillVetting` has nowhere to put one.
    const prefill = {
      ...(typeof body['problem'] === 'string' ? { problem: body['problem'] } : {}),
      ...(typeof body['solution'] === 'string' ? { solution: body['solution'] } : {}),
    };
    if (Object.keys(prefill).length > 0) {
      await prefillVetting(db, created.draftId, { ...prefill, actor: actorOf(req) });
    }

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

      /* ── §9's Admin lens, added Phase 07 ───────────────────────────────
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
      // §10: "Admin sees account-claim time [and] provenance." The Affiliate
      // half of that sentence is Phase 08's, because no Affiliate exists yet.
      signupComplete: campaign ? await readSignupComplete(db, campaign.id) : null,
    });
  });

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
    const str = (key: string): string | null | undefined =>
      key in body
        ? typeof body[key] === 'string'
          ? (body[key] as string)
          : null
        : undefined;

    const result = await prefillVetting(db, req.params['draftId'] as string, {
      ...(str('problem') !== undefined ? { problem: str('problem') } : {}),
      ...(str('solution') !== undefined ? { solution: str('solution') } : {}),
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

  /* ── §10 — recording the possible-creator result ───────────────────────── */

  /**
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

  /* ── §9, §33.1.7 — the wrong-type path ─────────────────────────────────── */

  /**
   * Archive a campaign whose type locked wrongly and begin a fresh vetting
   * record for the same person.
   *
   * §9 is explicit that this is not a conversion: "No campaign-type migration
   * exists. No Creator acceptance, reward, payment, or consent record is copied
   * automatically." The service reads none of those tables — which is a
   * stronger guarantee than checking that it copied none of them.
   *
   * The response carries the new draft id but no link. The replacement needs an
   * invitation sending, which is the existing send route: §28.1 puts the raw
   * token in the delivered URL and nowhere else, and this route is not an
   * exception to that.
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

  /* ── The rest of §7's invitation-creation surface ──────────────────────── */

  // Not gated, for the same reason composing is not: nothing leaves the
  // building. A key absent from the body writes nothing (§9's autosave rule),
  // so saving the product name cannot blank an invitation source recorded on a
  // different visit.
  router.put(`${ADMIN_FOUNDERS_PATH}/:draftId/prospect`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const str = (key: string): string | null | undefined =>
      key in body ? (typeof body[key] === 'string' ? (body[key] as string) : null) : undefined;
    const pick = (key: string) => (str(key) !== undefined ? { [key]: str(key) } : {});

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
      // §7 list items that never appear in the message, so the marker gate
      // cannot report them. Named so the surface says which one is blank
      // rather than refusing without a reason.
      missingFields: preview.missingFields,
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
