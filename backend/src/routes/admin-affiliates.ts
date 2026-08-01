/**
 * Admin — campaign Creators: recruitment, verification, and the private
 * invitation. Spec §8, §5.3, §25.4, §26.1, §33.12.4, §33.2.1.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * Sending, resending, and revoking reach a real person or cut off their access,
 * so they take `requireFreshSession` alongside `requireAdmin`. Creating,
 * editing, composing, and previewing do not: nothing leaves the building, and
 * making an Admin reauthenticate to type a paragraph teaches them to
 * reauthenticate reflexively, which is how the gate stops meaning anything.
 *
 * Recording a verification is a judgement, not a message — but it is the fact
 * §5.3 rests eligibility on, and §33.12.4 wants overrides attributable. It
 * takes the gate for the same reason a settings write does: the record names
 * who decided, and a stale session makes that name unreliable.
 *
 * ── The raw token never appears ─────────────────────────────────────────────
 * No response below carries an invitation link. §28.1 puts the raw value in the
 * delivered URL and nowhere else, so Admin sees that a live link exists, its
 * version, and when it expires — never the value. An Admin who needs to give a
 * Creator a working link resends one.
 *
 * ── §33.2.1 lives partly here ───────────────────────────────────────────────
 * "No public signup; invitation claims only the Affiliate's
 * account/association." Every route in this file is behind `requireAdmin`.
 * There is no unauthenticated route that creates an Affiliate, no route that
 * accepts a self-registration, and nothing here that issues a token to anyone
 * who did not arrive through an Admin's deliberate action.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  createAffiliateProspect,
  updateAffiliateProspect,
  recordVerification,
  readAssociation,
  listCampaignAffiliates,
  listFounderVisibleRoster,
} from '../affiliates/recruitment.js';
import {
  composeAffiliateInvitation,
  previewAffiliateInvitation,
  sendAffiliateInvitation,
  revokeAffiliateInvitation,
  readInvitation,
  previewClaimUrl,
  type AffiliateInvitationContext,
} from '../affiliates/invitation.js';
import {
  AFFILIATE_SUBTYPES,
  VERIFICATION_STATUSES,
  REQUIRED_EVIDENCE,
  type AffiliateSubtype,
  type VerificationStatus,
} from '../affiliates/registry.js';
import {
  PREPARING_NOTICE,
  DECLINE_NOTICE,
  NEVER_ASKS_NOTICE,
} from '../notifications/templates/affiliate-invitation.js';
import {
  revealPreparingCampaign,
  revokeKitAccess,
  readPreparingVisibility,
} from '../affiliates/handoff.js';
import { readAccessLog } from '../affiliates/kit.js';

export const ADMIN_AFFILIATES_PATH = '/api/admin/affiliates';

export interface AdminAffiliatesDeps {
  db: Database;
  auth: Auth;
  tokens: TokenService;
  notifier: Notifier;
  context: AffiliateInvitationContext;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

function badRequest(res: express.Response, whatHappened: string, next: string): void {
  res.status(400).json({ error: 'invalid_request', title: 'That could not be saved', whatHappened, next });
}

function notFound(res: express.Response): void {
  res.status(404).json({
    error: 'not_found',
    title: 'No such recruitment record',
    whatHappened: 'There is no Creator recruitment record at that address.',
    next: 'Go back to the campaign roster.',
  });
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Only string values survive. An evidence field holding an object is a bug. */
function evidenceOf(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function createAdminAffiliatesRouter({
  db,
  auth,
  tokens,
  notifier,
  context,
}: AdminAffiliatesDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '128kb' });

  /* ── The §5.3 register and the fixed copy, for the compose surface ─────── */

  router.get(`${ADMIN_AFFILIATES_PATH}/registry`, admin, (_req, res) => {
    // The subtypes and their required evidence, so the surface asks for the
    // right inputs per channel. Labels and help text are NOT served here — the
    // Admin bundle imports the shared register through Vite, and copying copy
    // across the boundary is how two sentences come to disagree.
    res.json({
      subtypes: AFFILIATE_SUBTYPES,
      requiredEvidence: REQUIRED_EVIDENCE,
      verificationStatuses: VERIFICATION_STATUSES,
      // §8's two fixed sentences and the never-asks line. Read-only, shown so
      // Admin knows exactly what goes out, with no route that edits them.
      fixedCopy: {
        preparingNotice: PREPARING_NOTICE,
        declineNotice: DECLINE_NOTICE,
        neverAsksNotice: NEVER_ASKS_NOTICE,
      },
    });
  });

  /* ── The roster for one campaign (§8, §26.1) ───────────────────────────── */

  router.get(ADMIN_AFFILIATES_PATH, admin, async (req, res) => {
    const campaignId = str(req.query['campaignId']);
    if (!campaignId) {
      badRequest(res, 'A campaign id is required.', 'Open a campaign and try again.');
      return;
    }

    const rows = await listCampaignAffiliates(db, campaignId);
    res.json({
      affiliates: rows.map((row) => ({
        ...row,
        lastSentAt: row.lastSentAt ? new Date(row.lastSentAt).toISOString() : null,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  /**
   * What the Founder is allowed to see of their own roster (§8, §11).
   *
   * Served from Admin for now because no Founder session surface exists until
   * Phase 08c. It is here rather than inlined into a future Founder route so
   * that the projection — which is the authorization boundary — has one home.
   */
  router.get(`${ADMIN_AFFILIATES_PATH}/founder-view`, admin, async (req, res) => {
    const campaignId = str(req.query['campaignId']);
    if (!campaignId) {
      badRequest(res, 'A campaign id is required.', 'Open a campaign and try again.');
      return;
    }
    res.json({ creators: await listFounderVisibleRoster(db, campaignId) });
  });

  /* ── Recruiting (§8) ───────────────────────────────────────────────────── */

  router.post(ADMIN_AFFILIATES_PATH, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;

    const required = [
      'legalName',
      'publicHandle',
      'email',
      'channelReference',
      'audienceNiche',
      'campaignFit',
      'permissionBasis',
      'adminBio',
      'recruitmentSource',
      'recruitingAdmin',
      'campaignId',
    ];
    for (const field of required) {
      if (!str(body[field])) {
        badRequest(
          res,
          `${field} is required before a Creator can be recruited.`,
          'Fill it in and record the prospect again.',
        );
        return;
      }
    }

    const subtype = str(body['subtype']);
    if (!subtype || !AFFILIATE_SUBTYPES.includes(subtype as AffiliateSubtype)) {
      badRequest(
        res,
        'A channel subtype is required, and must be one of the seven §5.3 names.',
        'Pick the subtype that matches their channel — it decides which evidence is needed.',
      );
      return;
    }

    const rosterIntent = str(body['rosterIntent']) ?? 'initial_roster';
    if (rosterIntent !== 'initial_roster' && rosterIntent !== 'mid_campaign') {
      badRequest(
        res,
        'Roster intent must be initial_roster or mid_campaign.',
        'Pick one. §23.4 stores it separately from the association status.',
      );
      return;
    }

    const created = await createAffiliateProspect(db, {
      legalName: str(body['legalName'])!,
      publicHandle: str(body['publicHandle'])!,
      email: str(body['email'])!,
      phone: str(body['phone']),
      subtype: subtype as AffiliateSubtype,
      channelReference: str(body['channelReference'])!,
      audienceNiche: str(body['audienceNiche'])!,
      campaignFit: str(body['campaignFit'])!,
      audienceSize: str(body['audienceSize']),
      engagementEvidence: evidenceOf(body['engagementEvidence']),
      audienceDemographics: str(body['audienceDemographics']),
      permissionBasis: str(body['permissionBasis'])!,
      priorSponsoredContent: str(body['priorSponsoredContent']),
      adminBio: str(body['adminBio'])!,
      qualityTier: str(body['qualityTier']),
      conflictNotes: str(body['conflictNotes']),
      sanctionsNotes: str(body['sanctionsNotes']),
      internalComments: str(body['internalComments']),
      recruitmentSource: str(body['recruitmentSource'])!,
      recruitingAdmin: str(body['recruitingAdmin'])!,
      campaignId: str(body['campaignId'])!,
      rosterIntent,
      actor: actorOf(req),
    });

    if (!created.ok) {
      badRequest(res, created.message, 'Nothing was recorded.');
      return;
    }

    res.status(201).json(created.value);
  });

  /* ── §10's preparing visibility, and its revocation (§31.5) ────────────── */

  /**
   * §10: Admin sees "the set of Affiliates who received preparing visibility,
   * delivery status of notifications, and any revoked association."
   */
  router.get(`${ADMIN_AFFILIATES_PATH}/visibility`, admin, async (req, res) => {
    const campaignId = str(req.query['campaignId']);
    if (!campaignId) {
      badRequest(res, 'A campaign id is required.', 'Open a campaign and try again.');
      return;
    }

    const rows = await readPreparingVisibility(db, campaignId);
    res.json({
      visibility: rows.map((row) => ({
        ...row,
        revealedAt: row.revealedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
      })),
    });
  });

  /* ── One recruitment record, everything Admin needs (§33.12.4) ──────────── */

  router.get(`${ADMIN_AFFILIATES_PATH}/:associationId`, admin, async (req, res) => {
    const associationId = req.params['associationId'] as string;
    const record = await readAssociation(db, associationId);
    if (!record) {
      notFound(res);
      return;
    }

    const invitation = await readInvitation(db, associationId);

    res.json({
      association: {
        id: record.associationId,
        campaignId: record.campaignId,
        status: record.status,
        rosterMembership: record.rosterMembership,
        invitationStatus: record.invitationStatus,
        recruitmentSource: record.recruitmentSource,
        recruitingAdmin: record.recruitingAdmin,
        recruitedAt: record.recruitedAt?.toISOString() ?? null,
      },
      prospect: {
        id: record.prospect.id,
        legalName: record.prospect.legalName,
        publicHandle: record.prospect.publicHandle,
        email: record.prospect.email,
        phone: record.prospect.phone,
        subtype: record.prospect.subtype,
        channelReference: record.prospect.channelReference,
        audienceNiche: record.prospect.audienceNiche,
        campaignFit: record.prospect.campaignFit,
        audienceSize: record.prospect.audienceSize,
        engagementEvidence: record.prospect.engagementEvidence,
        audienceDemographics: record.prospect.audienceDemographics,
        permissionBasis: record.prospect.permissionBasis,
        priorSponsoredContent: record.prospect.priorSponsoredContent,
        adminBio: record.prospect.adminBio,
        qualityTier: record.prospect.qualityTier,
        verificationStatus: record.prospect.verificationStatus,
        verificationEvidence: record.prospect.verificationEvidence,
        verifiedBy: record.prospect.verifiedBy,
        verifiedAt: record.prospect.verifiedAt?.toISOString() ?? null,
        conflictNotes: record.prospect.conflictNotes,
        sanctionsNotes: record.prospect.sanctionsNotes,
        internalComments: record.prospect.internalComments,
        claimedAt: record.prospect.claimedAt?.toISOString() ?? null,
      },
      /** §5.3 evidence still missing. Reported, never enforced except on `verified`. */
      missingEvidence: record.missingEvidence,
      /** §2.2, across every campaign. Phase 08 can never make this non-zero. */
      slots: record.slots,
      invitation: invitation
        ? {
            whyRecruited: invitation.whyRecruited,
            reviewedPresence: invitation.reviewedPresence,
            senderName: invitation.senderName,
            senderEmail: invitation.senderEmail,
            founderName: invitation.founderName,
            productName: invitation.productName,
            hasLiveToken: invitation.hasLiveToken,
            lastSentAt: invitation.lastSentAt?.toISOString() ?? null,
            sends: invitation.sends.map((send) => ({
              ...send,
              sentAt: send.sentAt.toISOString(),
              tokenExpiresAt: send.tokenExpiresAt?.toISOString() ?? null,
              // §1.4: NULL is "recorded, not confirmed delivered" — never
              // rendered as though the message arrived.
              deliveryConfirmed: send.notificationId !== null,
            })),
          }
        : null,
    });
  });

  /* ── Editing the recruitment record (§8) ───────────────────────────────── */

  router.patch(`${ADMIN_AFFILIATES_PATH}/:associationId/prospect`, admin, json, async (req, res) => {
    const record = await readAssociation(db, req.params['associationId'] as string);
    if (!record) {
      notFound(res);
      return;
    }

    const body = req.body as Record<string, unknown>;
    const result = await updateAffiliateProspect(db, record.prospectId, {
      legalName: 'legalName' in body ? str(body['legalName']) : undefined,
      publicHandle: 'publicHandle' in body ? str(body['publicHandle']) : undefined,
      email: 'email' in body ? str(body['email']) : undefined,
      phone: 'phone' in body ? str(body['phone']) : undefined,
      channelReference: 'channelReference' in body ? str(body['channelReference']) : undefined,
      audienceNiche: 'audienceNiche' in body ? str(body['audienceNiche']) : undefined,
      campaignFit: 'campaignFit' in body ? str(body['campaignFit']) : undefined,
      audienceSize: 'audienceSize' in body ? str(body['audienceSize']) : undefined,
      engagementEvidence:
        'engagementEvidence' in body ? evidenceOf(body['engagementEvidence']) : undefined,
      audienceDemographics:
        'audienceDemographics' in body ? str(body['audienceDemographics']) : undefined,
      permissionBasis: 'permissionBasis' in body ? str(body['permissionBasis']) : undefined,
      priorSponsoredContent:
        'priorSponsoredContent' in body ? str(body['priorSponsoredContent']) : undefined,
      adminBio: 'adminBio' in body ? str(body['adminBio']) : undefined,
      qualityTier: 'qualityTier' in body ? str(body['qualityTier']) : undefined,
      conflictNotes: 'conflictNotes' in body ? str(body['conflictNotes']) : undefined,
      sanctionsNotes: 'sanctionsNotes' in body ? str(body['sanctionsNotes']) : undefined,
      internalComments: 'internalComments' in body ? str(body['internalComments']) : undefined,
      recruitmentSource: 'recruitmentSource' in body ? str(body['recruitmentSource']) : undefined,
      recruitingAdmin: 'recruitingAdmin' in body ? str(body['recruitingAdmin']) : undefined,
      actor: actorOf(req),
    });

    if (!result.ok) {
      badRequest(res, result.message, 'Nothing else you entered was lost.');
      return;
    }
    res.json({ ok: true });
  });

  /* ── Verification (§8, §5.3) ───────────────────────────────────────────── */

  router.post(
    `${ADMIN_AFFILIATES_PATH}/:associationId/verification`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const record = await readAssociation(db, req.params['associationId'] as string);
      if (!record) {
        notFound(res);
        return;
      }

      const body = req.body as Record<string, unknown>;
      const status = str(body['status']);
      if (!status || !VERIFICATION_STATUSES.includes(status as VerificationStatus)) {
        badRequest(
          res,
          'A verification status is required.',
          'Pick unverified, in_review, verified, or rejected.',
        );
        return;
      }

      const result = await recordVerification(db, record.prospectId, {
        status: status as VerificationStatus,
        evidence: 'evidence' in body ? evidenceOf(body['evidence']) : undefined,
        verifiedBy: str(body['verifiedBy']) ?? '',
        actor: actorOf(req),
      });

      if (!result.ok) {
        res.status(400).json({
          error: 'invalid_request',
          title: 'That could not be recorded',
          whatHappened: result.message,
          next:
            result.missing && result.missing.length > 0
              ? 'Record the missing evidence first, or set the status to in_review instead.'
              : 'Nothing was changed.',
          missing: result.missing ?? [],
        });
        return;
      }
      res.json({ ok: true });
    },
  );

  /* ── Composing and previewing the invitation (§8) ──────────────────────── */

  router.patch(`${ADMIN_AFFILIATES_PATH}/:associationId/invitation`, admin, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = await composeAffiliateInvitation(db, req.params['associationId'] as string, {
      whyRecruited: 'whyRecruited' in body ? str(body['whyRecruited']) : undefined,
      reviewedPresence: 'reviewedPresence' in body ? str(body['reviewedPresence']) : undefined,
      senderName: 'senderName' in body ? str(body['senderName']) : undefined,
      senderEmail: 'senderEmail' in body ? str(body['senderEmail']) : undefined,
      actor: actorOf(req),
    });

    if (!result.ok) {
      badRequest(res, result.message, 'Nothing was saved.');
      return;
    }
    res.json({ ok: true });
  });

  router.get(`${ADMIN_AFFILIATES_PATH}/:associationId/preview`, admin, async (req, res) => {
    const preview = await previewAffiliateInvitation(
      db,
      req.params['associationId'] as string,
      context,
    );
    if (!preview) {
      notFound(res);
      return;
    }

    res.json({
      subject: preview.subject,
      html: preview.html,
      text: preview.text,
      unresolved: preview.unresolved,
      recipientEmail: preview.recipientEmail,
      /** §8's gate. The Send control reads this; the send route re-decides. */
      blocked: preview.blocked,
      // §28.1: previewing cannot mint a token and cannot recover the last one,
      // so the preview shows the route shape and says so.
      claimUrlShape: previewClaimUrl(context.appBaseUrl),
    });
  });

  /* ── Sending, resending, revoking (§8) ─────────────────────────────────── */

  router.post(`${ADMIN_AFFILIATES_PATH}/:associationId/send`, admin, fresh, async (req, res) => {
    // The route re-decides independently of the disabled button. §1.1: a
    // disabled control is not authorization.
    const result = await sendAffiliateInvitation(
      { db, tokens, notifier },
      { associationId: req.params['associationId'] as string, actor: actorOf(req), context },
    );

    if (!result.ok) {
      res.status(400).json({
        error: 'send_refused',
        title: 'That invitation was not sent',
        whatHappened: result.message,
        next: 'Nothing reached this Creator.',
        unresolved: result.unresolved ?? [],
      });
      return;
    }
    res.json(result);
  });

  /** §31.5's log, in full, for one association. Every read of the kit. */
  router.get(`${ADMIN_AFFILIATES_PATH}/:associationId/access-log`, admin, async (req, res) => {
    const rows = await readAccessLog(db, req.params['associationId'] as string);
    res.json({
      access: rows.map((row) => ({
        id: row.id,
        section: row.section,
        affiliateUserId: row.affiliateUserId,
        occurredAt: row.occurredAt.toISOString(),
      })),
    });
  });

  /**
   * §10: "Revocation removes it immediately."
   *
   * Behind the freshness gate: it withdraws someone's access to confidential
   * material, and §25.6 wants the actor on a high-impact action to be someone
   * who authenticated recently.
   */
  router.post(
    `${ADMIN_AFFILIATES_PATH}/:associationId/revoke-kit-access`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await revokeKitAccess(db, {
        associationId: req.params['associationId'] as string,
        actor: actorOf(req),
        reason: str(body['reason']) ?? '',
      });

      if (!result.ok) {
        badRequest(res, result.message, 'Nothing was changed.');
        return;
      }
      res.json({ ok: true });
    },
  );

  /**
   * Re-runs §10's handoff for a campaign.
   *
   * Idempotent by construction — every Creator already revealed is skipped by
   * their idempotency key — so this is safe to press after an interrupted run,
   * which is exactly what §10's "No duplicate visibility event or email may
   * occur after retries" requires it to be.
   */
  router.post(`${ADMIN_AFFILIATES_PATH}/reveal`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const campaignId = str(body['campaignId']);
    if (!campaignId) {
      badRequest(res, 'A campaign id is required.', 'Nothing was changed.');
      return;
    }

    const result = await revealPreparingCampaign({ db, notifier, context }, campaignId);
    res.json(result);
  });

  router.post(`${ADMIN_AFFILIATES_PATH}/:associationId/revoke`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = await revokeAffiliateInvitation(
      { db, tokens },
      {
        associationId: req.params['associationId'] as string,
        actor: actorOf(req),
        reason: str(body['reason']) ?? '',
      },
    );

    if (!result.ok) {
      badRequest(res, result.message, 'Nothing was changed.');
      return;
    }
    res.json(result);
  });

  return router;
}
