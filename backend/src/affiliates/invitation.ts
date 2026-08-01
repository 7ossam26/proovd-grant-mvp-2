/**
 * The private campaign-specific Affiliate invitation — Spec §8, §27.2, §33.2.1.
 *
 * §8: "Admin can send, resend, or revoke one private campaign-specific signup
 * invitation. No generic Affiliate credential email and no public signup exist."
 *
 * Every constraint the Founder invitation established applies here, for the same
 * reasons, and `invitations/service.ts` is the file to read alongside this one.
 * The two are deliberately parallel rather than merged: they differ in the token
 * scope they issue, the entity they key dedup on, the state machine they move,
 * and the seven-versus-nine contents their templates must resolve. A shared
 * "sendInvitation(kind)" would have to branch on all five, and the branch that
 * matters most — which scope the token gets — is the one §33.2.1 is about.
 *
 * ── One invitation per association ──────────────────────────────────────────
 * §8 says "one". The association carries `invitation_status`, a unique index
 * guarantees one association per (campaign, prospect), and a resend rotates the
 * existing token rather than issuing beside it. So a Creator recruited to two
 * campaigns receives two invitations, and a Creator recruited to one receives
 * one however many times Admin presses resend.
 *
 * ── Ordering, and which way a crash fails ───────────────────────────────────
 * Token, then send row, then the provider, then confirmation — the same order,
 * and the same trade, as the Founder invitation:
 *
 * **Token before send.** A provider refusal leaves the previous link already
 * invalidated and no new one delivered. That is recorded, visible in Admin, and
 * fixed by resending. Sending first and rotating after risks delivering a link
 * the next statement kills, which leaves the Creator holding something that
 * looks live and is not.
 *
 * **Send row before the provider**, with `notification_id` NULL. Writing it
 * afterwards would leave a crash-shaped hole: an email delivered with no record
 * that it was. NULL is a state — "recorded, not confirmed delivered" — and
 * Admin renders it as exactly that rather than implying the message arrived
 * (§1.4).
 *
 * ── The dedup key is the SEND ───────────────────────────────────────────────
 * Not the association. §27.2 forbids a duplicate delivery producing a second
 * email; §8 requires resend to work. Keying on the association satisfies the
 * first and breaks the second — the second invitation would be swallowed as a
 * duplicate of the first. This is the trap Phase 06b documented and it is
 * exactly as easy to fall into here.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { AFFILIATE_CAMPAIGN_INVITATION } from '../notifications/events.js';
import {
  renderAffiliateInvitation,
  type AffiliateInvitationVariables,
  type RenderedAffiliateInvitation,
} from '../notifications/templates/affiliate-invitation.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { affiliateProspects, affiliateInvitationSends } from '../db/schema/affiliates.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import { auditEvents } from '../db/schema/integrity.js';
import { transitionAssociation } from './recruitment.js';

/**
 * The path the delivered link points at.
 *
 * Owned here and by `auth/token-routes.ts`, which also owns the redaction rule
 * for it. A second copy of this string is how a token URL escapes redaction.
 */
export const AFFILIATE_CLAIM_PATH = '/creator-invitation';

export interface AffiliateInvitationContext {
  appBaseUrl: string;
  supportEmail: string;
  fromAddress: string;
}

/* ── Composing (§8) ───────────────────────────────────────────────────────── */

export interface ComposeAffiliateInvitationInput {
  /** §8 item 2 — why this Creator and this channel were recruited. */
  whyRecruited?: string | null;
  /** §8 item 3 — the public presence Proovd reviewed. */
  reviewedPresence?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  actor: string;
}

/**
 * The composed fields live on the association, not the prospect.
 *
 * §8 requires the email to say why this Creator was recruited *for this
 * campaign*. The same Creator recruited to a second campaign is being told
 * something different, and storing it on the person would make the second
 * invitation overwrite the first one's reasoning.
 */
export async function composeAffiliateInvitation(
  db: Database,
  associationId: string,
  input: ComposeAffiliateInvitationInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const record = await readInvitation(db, associationId);
  if (!record) return { ok: false, message: 'That recruitment record does not exist.' };
  if (record.invitationStatus === 'claimed') {
    return { ok: false, message: 'This invitation has been claimed and is now an account.' };
  }

  const prior = {
    whyRecruited: record.whyRecruited,
    reviewedPresence: record.reviewedPresence,
    senderName: record.senderName,
    senderEmail: record.senderEmail,
  };

  const next = {
    whyRecruited: input.whyRecruited?.trim() || null,
    reviewedPresence: input.reviewedPresence?.trim() || null,
    senderName: input.senderName?.trim() || null,
    senderEmail: input.senderEmail?.trim().toLowerCase() || null,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(campaignAffiliateAssociations)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(campaignAffiliateAssociations.id, associationId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: associationId,
      action: 'affiliate.invitation_composed',
      internalReason: 'affiliate invitation content edited',
      customerExplanation: null,
      priorValue: prior,
      newValue: next,
    });
  });

  return { ok: true };
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export interface AffiliateInvitationRecord {
  associationId: string;
  campaignId: string;
  prospectId: string;
  status: string;
  invitationStatus: string;
  recipientEmail: string | null;
  recipientName: string | null;
  publicHandle: string | null;
  channelReference: string | null;
  whyRecruited: string | null;
  reviewedPresence: string | null;
  senderName: string | null;
  senderEmail: string | null;
  /** From the Founder side of the campaign, for §8 item 1. */
  founderName: string | null;
  productName: string | null;
  sends: Array<{
    id: string;
    sentAt: Date;
    recipientEmail: string | null;
    senderName: string;
    notificationId: string | null;
    tokenVersion: number;
    tokenExpiresAt: Date | null;
    sentBy: string;
  }>;
  lastSentAt: Date | null;
  /** Whether a usable link is outstanding. Never the link itself (§28.1). */
  hasLiveToken: boolean;
}

export async function readInvitation(
  db: Database,
  associationId: string,
): Promise<AffiliateInvitationRecord | null> {
  const [row] = await db
    .select({
      association: campaignAffiliateAssociations,
      prospect: affiliateProspects,
      founderName: founderProspects.preferredName,
      founderLegalName: founderProspects.legalName,
      productName: founderProspects.productName,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    // The Founder side is a left join on purpose: §8's recruitment "can start
    // before, during, or after Founder onboarding", so a campaign with no draft
    // yet is a legitimate state, not a missing row. It shows up as an unresolved
    // marker in the preview, which is what holds Send closed.
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaignAffiliateAssociations.campaignId))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);

  if (!row) return null;

  const sends = await db
    .select({
      id: affiliateInvitationSends.id,
      sentAt: affiliateInvitationSends.sentAt,
      recipientEmail: affiliateInvitationSends.recipientEmail,
      senderName: affiliateInvitationSends.senderName,
      notificationId: affiliateInvitationSends.notificationId,
      tokenVersion: affiliateInvitationSends.tokenVersion,
      tokenExpiresAt: affiliateInvitationSends.tokenExpiresAt,
      sentBy: affiliateInvitationSends.sentBy,
    })
    .from(affiliateInvitationSends)
    .where(eq(affiliateInvitationSends.associationId, associationId))
    .orderBy(desc(affiliateInvitationSends.sentAt));

  const live = await db
    .select({ id: secureTokens.id })
    .from(secureTokens)
    .where(
      and(
        eq(secureTokens.scope, 'affiliate_invitation'),
        eq(secureTokens.associationId, associationId),
        isNull(secureTokens.revokedAt),
        isNull(secureTokens.claimedAt),
      ),
    )
    .limit(1);

  return {
    associationId: row.association.id,
    campaignId: row.association.campaignId,
    prospectId: row.prospect.id,
    status: row.association.status,
    invitationStatus: row.association.invitationStatus,
    recipientEmail: row.prospect.email,
    recipientName: row.prospect.publicHandle || row.prospect.legalName,
    publicHandle: row.prospect.publicHandle,
    channelReference: row.prospect.channelReference,
    whyRecruited: row.association.whyRecruited,
    reviewedPresence: row.association.reviewedPresence,
    senderName: row.association.senderName,
    senderEmail: row.association.senderEmail,
    founderName: row.founderName || row.founderLegalName,
    productName: row.productName,
    sends,
    lastSentAt: sends[0]?.sentAt ?? null,
    hasLiveToken: live.length > 0,
  };
}

function variablesFor(
  record: AffiliateInvitationRecord,
  claimUrl: string,
  supportEmail: string,
): AffiliateInvitationVariables {
  return {
    recipientName: record.recipientName,
    founderName: record.founderName,
    productName: record.productName,
    whyRecruited: record.whyRecruited,
    // §8 item 3: "which public presence Proovd reviewed". Falls back to the
    // recorded channel reference, because that IS what was reviewed — but an
    // Admin who wants to be specific about which post or episode can say so.
    reviewedPresence: record.reviewedPresence || record.channelReference,
    senderName: record.senderName,
    senderEmail: record.senderEmail,
    claimUrl,
    reference: record.campaignId,
    supportEmail,
  };
}

/* ── Preview (§8's gate, §7's mechanism) ──────────────────────────────────── */

/**
 * The URL shown in a preview. Not a real link.
 *
 * §28.1 keeps the raw token out of everything but the delivered URL, so
 * previewing cannot mint one and cannot recover the last one. The Admin surface
 * says so beside the preview rather than showing a link that would fail if
 * clicked.
 */
export function previewClaimUrl(appBaseUrl: string): string {
  return `${appBaseUrl}${AFFILIATE_CLAIM_PATH}/…`;
}

export interface AffiliateInvitationPreview extends RenderedAffiliateInvitation {
  recipientEmail: string | null;
  /** True while the gate holds Send closed. */
  blocked: boolean;
}

export async function previewAffiliateInvitation(
  db: Database,
  associationId: string,
  context: AffiliateInvitationContext,
): Promise<AffiliateInvitationPreview | null> {
  const record = await readInvitation(db, associationId);
  if (!record) return null;

  const rendered = await renderAffiliateInvitation(
    variablesFor(record, previewClaimUrl(context.appBaseUrl), context.supportEmail),
  );

  return {
    ...rendered,
    recipientEmail: record.recipientEmail,
    blocked: rendered.unresolved.length > 0 || !record.recipientEmail,
  };
}

/* ── Sending and resending (§8) ───────────────────────────────────────────── */

export interface SendAffiliateInvitationInput {
  associationId: string;
  actor: string;
  context: AffiliateInvitationContext;
}

export type SendAffiliateInvitationResult =
  | { ok: true; sendId: string; tokenVersion: number; resent: boolean }
  | { ok: false; message: string; unresolved?: string[] };

export interface AffiliateInvitationDeps {
  db: Database;
  tokens: TokenService;
  notifier: Notifier;
}

export async function sendAffiliateInvitation(
  { db, tokens, notifier }: AffiliateInvitationDeps,
  input: SendAffiliateInvitationInput,
): Promise<SendAffiliateInvitationResult> {
  const record = await readInvitation(db, input.associationId);
  if (!record) return { ok: false, message: 'That recruitment record does not exist.' };

  if (record.invitationStatus === 'claimed') {
    return { ok: false, message: 'This invitation has already been claimed.' };
  }
  if (record.status === 'removed') {
    return {
      ok: false,
      message: 'This Creator was removed from the campaign. Recruit them again to invite them.',
    };
  }
  if (!record.recipientEmail) {
    return { ok: false, message: 'This prospect has no email address to send to.' };
  }

  // The gate, enforced on the rendered output. Runs before anything is issued
  // or written, so a blocked send changes nothing at all.
  const rendered = await renderAffiliateInvitation(
    variablesFor(
      record,
      `${input.context.appBaseUrl}${AFFILIATE_CLAIM_PATH}/preflight`,
      input.context.supportEmail,
    ),
  );
  if (rendered.unresolved.length > 0) {
    return {
      ok: false,
      message:
        'This invitation still has unfilled fields. A Creator must never receive a placeholder, so Send stays unavailable until every one is written.',
      unresolved: rendered.unresolved,
    };
  }

  const resent = record.hasLiveToken;

  let raw: string;
  let tokenId: string;
  let tokenVersion: number;
  let tokenExpiresAt: Date | null;

  if (resent) {
    const [live] = await db
      .select({ lineageId: secureTokens.lineageId })
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'affiliate_invitation'),
          eq(secureTokens.associationId, input.associationId),
          isNull(secureTokens.revokedAt),
          isNull(secureTokens.claimedAt),
        ),
      )
      .limit(1);

    const rotated = await tokens.rotate(live!.lineageId, { actorId: input.actor });
    if ('ok' in rotated) {
      return { ok: false, message: 'The existing link could not be rotated. Nothing was sent.' };
    }
    raw = rotated.raw;
    tokenId = rotated.record.id;
    tokenVersion = rotated.record.version;
    tokenExpiresAt = rotated.record.expiresAt;
  } else {
    const issued = await tokens.issue(
      { scope: 'affiliate_invitation', associationId: input.associationId },
      { actorId: input.actor },
    );
    raw = issued.raw;
    tokenId = issued.record.id;
    tokenVersion = issued.record.version;
    tokenExpiresAt = issued.record.expiresAt;
  }

  // The dedup identity. The SEND, not the association — see the file header.
  const sendId = randomUUID();

  const message = await renderAffiliateInvitation(
    variablesFor(
      record,
      `${input.context.appBaseUrl}${AFFILIATE_CLAIM_PATH}/${raw}`,
      input.context.supportEmail,
    ),
  );

  // Before the provider call, with `notification_id` NULL.
  await db.insert(affiliateInvitationSends).values({
    id: sendId,
    associationId: input.associationId,
    prospectId: record.prospectId,
    campaignId: record.campaignId,
    recipientEmail: record.recipientEmail,
    recipientName: record.recipientName,
    senderName: record.senderName!,
    senderEmail: record.senderEmail!,
    notificationId: null,
    tokenId,
    tokenVersion,
    tokenExpiresAt,
    status: 'sent',
    sentBy: input.actor,
  });

  const outcome = await notifier.send({
    eventKey: AFFILIATE_CAMPAIGN_INVITATION,
    entityType: 'affiliate_invitation_send',
    entityId: sendId,
    to: record.recipientEmail,
    from: input.context.fromAddress,
    replyTo: record.senderEmail ?? undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (outcome.status === 'failed') {
    await db.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: input.associationId,
      action: 'affiliate.invitation_send_failed',
      internalReason: `provider refused: ${outcome.reason}`,
      customerExplanation: null,
      newValue: { sendId, tokenVersion, resent, deliveryConfirmed: false },
    });
    return {
      ok: false,
      message:
        'The email provider did not accept the message, so nothing was delivered. ' +
        (resent
          ? 'The previous link has already been replaced, so this Creator currently has no working link — send again.'
          : 'No link has reached this Creator — send again.'),
    };
  }

  if (outcome.status === 'duplicate') {
    return { ok: false, message: 'That exact send has already been delivered.' };
  }

  await db.transaction(async (tx) => {
    // `notification_id` is the only column of the send row the application may
    // write after insert, so `sent_at` and `token_version` stay fixed.
    await tx
      .update(affiliateInvitationSends)
      .set({ notificationId: outcome.notificationId })
      .where(eq(affiliateInvitationSends.id, sendId));

    await tx
      .update(campaignAffiliateAssociations)
      .set({ invitationStatus: 'sent', updatedAt: new Date() })
      .where(eq(campaignAffiliateAssociations.id, input.associationId));

    // §23.4: prospect → invited, with its append-only history row. A resend
    // does not re-transition — the association is already `invited`, the
    // conditional UPDATE matches nothing, and there is no second history row
    // for a transition that did not happen.
    await transitionAssociation(input.associationId, 'prospect', 'invited', input.actor, tx);

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: input.associationId,
      action: resent ? 'affiliate.invitation_resent' : 'affiliate.invitation_sent',
      internalReason: resent
        ? `resent; token rotated to v${tokenVersion} and the previous link invalidated`
        : `campaign-specific invitation sent with token v${tokenVersion} (§8)`,
      customerExplanation: 'We invited you to promote a campaign on Proovd.',
      newValue: {
        sendId,
        tokenVersion,
        notificationId: outcome.notificationId,
        expiresAt: tokenExpiresAt,
        campaignId: record.campaignId,
      },
      relatedNotificationIds: [outcome.notificationId],
    });
  });

  return { ok: true, sendId, tokenVersion, resent };
}

/* ── Revoking (§8) ────────────────────────────────────────────────────────── */

/**
 * Revokes the live invitation link for one association.
 *
 * §8 allows revoke beside send and resend. Revocation kills the link and
 * nothing else: the prospect, the association, its recruitment provenance, and
 * every send row survive, because §25.4 keeps "invitation events" per campaign
 * and a revoked invitation is one of them.
 *
 * The association does NOT return to `prospect`. §23.4's machine has no edge
 * back, and inventing one would let a revoked-then-resent Creator show two
 * `prospect → invited` transitions for one recruitment. The invitation status
 * carries the revocation; the association status carries the relationship.
 */
export async function revokeAffiliateInvitation(
  { db, tokens }: Pick<AffiliateInvitationDeps, 'db' | 'tokens'>,
  input: { associationId: string; actor: string; reason: string },
): Promise<{ ok: true; revoked: number } | { ok: false; message: string }> {
  const record = await readInvitation(db, input.associationId);
  if (!record) return { ok: false, message: 'That recruitment record does not exist.' };
  if (record.invitationStatus === 'claimed') {
    return {
      ok: false,
      message:
        'This invitation has been claimed. Revoking the link would not remove the account it created — remove the association instead.',
    };
  }
  if (!input.reason.trim()) {
    return { ok: false, message: 'Say why this is being revoked. The reason is stored.' };
  }

  const revoked = await db.transaction(async (tx) => {
    const count = await tokens.revokeAssociationTokens(
      input.associationId,
      'admin_revoked',
      tx,
    );

    await tx
      .update(campaignAffiliateAssociations)
      .set({ invitationStatus: 'revoked', updatedAt: new Date() })
      .where(eq(campaignAffiliateAssociations.id, input.associationId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'affiliate_association',
      targetId: input.associationId,
      action: 'affiliate.invitation_revoked',
      internalReason: input.reason.trim(),
      customerExplanation: null,
      priorValue: { invitationStatus: record.invitationStatus },
      newValue: { invitationStatus: 'revoked', tokensRevoked: count },
    });

    return count;
  });

  return { ok: true, revoked };
}

/* ── What the invitation link reveals before an account exists ────────────── */

/**
 * §33.2.1: "an invitation claims only that Affiliate's account/association."
 *
 * So this returns the Creator's own name, the campaign they were invited to,
 * and the fixed process copy — and nothing that belongs to Proovd's operations
 * or to anyone else: no quality tier, no verification evidence, no internal
 * comments, no conflict or sanctions notes, no recruiting Admin, no other
 * Creator on the roster, no Backer anything. The route learns the association
 * id only from the verified token, so there is no id for a caller to substitute.
 *
 * The landing surface itself is Phase 08b's; this is the read it will use, and
 * it lives here because the projection is the authorization boundary.
 */
export interface AffiliateInvitationLanding {
  recipientName: string;
  publicHandle: string | null;
  founderName: string | null;
  productName: string | null;
  whyRecruited: string | null;
  reviewedPresence: string | null;
  senderName: string | null;
  reference: string;
}

export async function readInvitationLanding(
  db: Database,
  associationId: string,
): Promise<AffiliateInvitationLanding | null> {
  const record = await readInvitation(db, associationId);
  if (!record) return null;
  if (record.invitationStatus === 'revoked') return null;

  return {
    recipientName: record.recipientName ?? '',
    publicHandle: record.publicHandle,
    founderName: record.founderName,
    productName: record.productName,
    whyRecruited: record.whyRecruited,
    reviewedPresence: record.reviewedPresence || record.channelReference,
    senderName: record.senderName,
    reference: record.campaignId,
  };
}
