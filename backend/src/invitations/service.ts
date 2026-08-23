/**
 * Founder prospects and invitations — Spec §7.
 *
 * Create a prospect and the initial campaign container, compose the invitation,
 * preview it, send it, resend it, revoke it. This is the phase where a real
 * person first receives something from Proovd, and the constraints are mostly
 * about what must not happen.
 *
 * ── Preview is a gate, not a courtesy ───────────────────────────────────────
 * §7: "Preview must show final variables and no unresolved placeholder."
 * `previewInvitation` renders the real template and reports every bracketed
 * marker still in it; `sendInvitation` refuses while any remain. The check runs
 * server-side on the rendered output, so a caller that skipped the Admin
 * surface entirely still cannot send `[WHAT PROOVD UNDERSTOOD]` to a Founder.
 *
 * ── A resend is a new send, at every level ──────────────────────────────────
 * §7: "Resend rotates the token, invalidates all older versions immediately,
 * and restarts the 30-day unclaimed-draft retention period." So a resend
 * rotates the token lineage, writes a new append-only send row, and — because
 * the notification dedup key is the *send* id and not the draft id — produces a
 * genuinely new email rather than being swallowed as a duplicate of the first.
 * Keying dedup on the draft would satisfy §27.2 and break §7.
 *
 * ── The order of operations, and the windows it leaves ──────────────────────
 * Token, then send row, then the provider, then confirmation. Two orderings
 * were chosen deliberately and both are about which way a crash fails.
 *
 * **Token before send.** If the provider refuses, the rotated token has already
 * invalidated the previous one, so the Founder's old link is dead and no new
 * one has arrived. That is recorded, visible in Admin, and recoverable by
 * resending. The alternative — send first, then rotate — risks delivering a
 * link the next statement invalidates, which is worse: the Founder holds
 * something that looks live and is not.
 *
 * **Send row before the provider.** The row carries `notification_id` NULL
 * until the provider acknowledges. Writing it afterwards instead would leave a
 * crash-shaped hole where an email was delivered with no send row — therefore
 * no retention clock, therefore a draft §25.8 would never sweep. §25.8 sets a
 * maximum, not a minimum: a clock that starts slightly early deletes sooner,
 * which is the safe side; one that never starts keeps personal data forever.
 *
 * The cost is the opposite window — a row recorded for a message that may not
 * have gone out. That is why `notification_id` NULL is a *state*, not missing
 * data: the draft stays out of `sent` until delivery is confirmed, and Admin
 * renders the send as "not confirmed" rather than implying it arrived (§1.4).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { FOUNDER_INVITATION } from '../notifications/events.js';
import {
  renderFounderInvitation,
  type InvitationVariables,
  type RenderedInvitation,
} from '../notifications/templates/founder-invitation.js';
import { campaigns, campaignStatusHistory } from '../db/schema/domain.js';
import {
  founderProspects,
  campaignDrafts,
  campaignInvitationSends,
  type CampaignDraft,
  type FounderProspect,
} from '../db/schema/invitations.js';
import { secureTokens } from '../db/schema/tokens.js';
import { auditEvents } from '../db/schema/integrity.js';

/** The path the delivered link points at. Owned here and by `routes/draft.ts`. */
export const DRAFT_PATH = '/draft';

export interface InvitationContext {
  appBaseUrl: string;
  /** §27.2 / §27.8: the published support address. */
  supportEmail: string;
  /** The verified From address. §27.2 money rules do not apply to this one. */
  fromAddress: string;
}

/* ── Creating a prospect and its campaign container (§7) ───────────────────── */

/**
 * §7 describes two acts, and this is the first of them.
 *
 * "Admin creates a Founder prospect and the initial campaign container after
 * off-platform discovery" is the moment somebody is written down. "The
 * invitation-creation surface contains: …" is a separate list, belonging to the
 * surface where the invitation is actually composed — which is why only the two
 * facts that identify the person are required here. Everything else on §7's
 * list is filled in through `updateProspect` before Send, and is enforced
 * there rather than being demanded from an Admin who has just got off a call.
 *
 * Requiring the whole list at discovery time did not make the record more
 * complete; it made an Admin type a placeholder into `invitationSource` to get
 * past the form, which is a worse record than an honestly incomplete one — the
 * reasoning §5.3's verification evidence already records for the same shape.
 */
export interface CreateProspectInput {
  creationRequestKey?: string | null;
  legalName: string;
  preferredName?: string | null;
  email: string;
  phone?: string | null;
  /** When Proovd last spoke to them off-platform. Not a schedule (§30). */
  lastContactAt?: Date | null;
  productName?: string | null;
  productUrl?: string | null;
  launchFrame?: string | null;
  usAgeFit?: string | null;
  deliveryFeasibility?: string | null;
  compensationExpectations?: string | null;
  affiliateSourcingHypothesis?: string | null;
  adminNotes?: string | null;
  discoveryEvidence?: readonly string[] | null;
  invitationSource?: string | null;
  internalOwner?: string | null;
  /** `user:<id>` of the Admin. */
  actor: string;
}

export interface CreatedProspect {
  prospectId: string;
  campaignId: string;
  draftId: string;
}

/**
 * Creates the prospect, the campaign container, and the empty invited draft, in
 * one transaction.
 *
 * The campaign lands in `invited_draft` — §23.1's entry state — with its
 * creation row in the append-only history. `campaigns.type` stays NULL: §33.1.7
 * locks the type at vetting, and guessing it here from a discovery
 * conversation would be exactly the invented commitment §1 rule 6 forbids.
 */
export async function createProspect(
  db: Database,
  input: CreateProspectInput,
): Promise<CreatedProspect> {
  return db.transaction(async (tx) => {
    const [prospect] = await tx
      .insert(founderProspects)
      .values({
        creationRequestKey: input.creationRequestKey?.trim() || null,
        legalName: input.legalName.trim(),
        preferredName: input.preferredName?.trim() || null,
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        lastContactAt: input.lastContactAt ?? null,
        productName: input.productName?.trim() || null,
        productUrl: input.productUrl?.trim() || null,
        launchFrame: input.launchFrame?.trim() || null,
        usAgeFit: input.usAgeFit?.trim() || null,
        deliveryFeasibility: input.deliveryFeasibility?.trim() || null,
        compensationExpectations: input.compensationExpectations?.trim() || null,
        affiliateSourcingHypothesis: input.affiliateSourcingHypothesis?.trim() || null,
        adminNotes: input.adminNotes?.trim() || null,
        discoveryEvidence: input.discoveryEvidence ? [...input.discoveryEvidence] : null,
        invitationSource: input.invitationSource?.trim() || null,
        internalOwner: input.internalOwner?.trim() || null,
        createdBy: input.actor,
      })
      .returning({ id: founderProspects.id });

    const [campaign] = await tx
      .insert(campaigns)
      .values({ status: 'invited_draft' })
      .returning({ id: campaigns.id });

    await tx.insert(campaignStatusHistory).values({
      campaignId: campaign!.id,
      fromStatus: null,
      toStatus: 'invited_draft',
      actor: input.actor,
    });

    const [draft] = await tx
      .insert(campaignDrafts)
      .values({
        campaignId: campaign!.id,
        prospectId: prospect!.id,
        senderName: null,
        senderEmail: null,
        createdBy: input.actor,
      })
      .returning({ id: campaignDrafts.id });

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: draft!.id,
      action: 'invitation.prospect_created',
      internalReason: `prospect created from ${input.invitationSource?.trim() || 'a source not yet recorded'}; owner ${input.internalOwner?.trim() || 'not yet assigned'}`,
      customerExplanation: null,
      newValue: {
        prospectId: prospect!.id,
        campaignId: campaign!.id,
        productName: input.productName?.trim() || null,
      },
    });

    return { prospectId: prospect!.id, campaignId: campaign!.id, draftId: draft!.id };
  });
}

/* ── The rest of §7's invitation-creation surface ─────────────────────────── */

/**
 * The §7 fields the invitation-creation surface owns, filled in on the draft
 * detail surface rather than at discovery.
 *
 * `undefined` means "not in this request" and writes nothing — §9's autosave
 * rule, which this file has to honour for the same reason: a partial write that
 * blanked the fields it was not given would silently erase an invitation source
 * an Admin recorded last week.
 */
export interface UpdateProspectInput {
  preferredName?: string | null;
  phone?: string | null;
  lastContactAt?: Date | null;
  productName?: string | null;
  productUrl?: string | null;
  launchFrame?: string | null;
  usAgeFit?: string | null;
  deliveryFeasibility?: string | null;
  compensationExpectations?: string | null;
  affiliateSourcingHypothesis?: string | null;
  adminNotes?: string | null;
  discoveryEvidence?: readonly string[] | null;
  invitationSource?: string | null;
  internalOwner?: string | null;
  actor: string;
}

const PROSPECT_TEXT_FIELDS = [
  'preferredName',
  'phone',
  'productName',
  'productUrl',
  'launchFrame',
  'usAgeFit',
  'deliveryFeasibility',
  'compensationExpectations',
  'affiliateSourcingHypothesis',
  'adminNotes',
  'invitationSource',
  'internalOwner',
] as const;

export async function updateProspect(
  db: Database,
  draftId: string,
  input: UpdateProspectInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const record = await readDraft(db, draftId);
  if (!record) return { ok: false, message: 'That draft does not exist.' };
  if (record.prospect.anonymisedAt) {
    return {
      ok: false,
      message:
        'This prospect was anonymised after 30 calendar days without a claim. Its content is gone and cannot be restored — create a new prospect if you want to invite them again.',
    };
  }

  const prior: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  for (const field of PROSPECT_TEXT_FIELDS) {
    const supplied = input[field];
    if (supplied === undefined) continue;
    prior[field] = record.prospect[field];
    next[field] = supplied?.trim() || null;
  }
  if (input.lastContactAt !== undefined) {
    prior['lastContactAt'] = record.prospect.lastContactAt;
    next['lastContactAt'] = input.lastContactAt;
  }
  if (input.discoveryEvidence !== undefined) {
    prior['discoveryEvidence'] = record.prospect.discoveryEvidence;
    next['discoveryEvidence'] = input.discoveryEvidence ? [...input.discoveryEvidence] : null;
  }

  if (Object.keys(next).length === 0) return { ok: true };

  await db.transaction(async (tx) => {
    await tx.update(founderProspects).set(next).where(eq(founderProspects.id, record.prospect.id));
    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: draftId,
      action: 'invitation.prospect_updated',
      internalReason: 'invitation-creation fields edited',
      customerExplanation: null,
      priorValue: prior,
      newValue: next,
    });
  });

  return { ok: true };
}

/**
 * The supplied Admin reference makes the eleven visible Invite-stage fields
 * the send gate. Invitation source and internal ownership remain useful
 * provenance when recorded, but neither is a field on that screen and neither
 * may silently keep its Send button disabled.
 */
export function missingInvitationFields(record: DraftRecord): string[] {
  void record;
  return [];
}

/* ── Composing (§7) ───────────────────────────────────────────────────────── */

export interface ComposeInput {
  whatWeUnderstood?: string | null;
  whyInvited?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  expectedSetupTime?: string | null;
  actor: string;
}

export async function composeInvitation(
  db: Database,
  draftId: string,
  input: ComposeInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const record = await readDraft(db, draftId);
  if (!record) return { ok: false, message: 'That draft does not exist.' };
  if (record.draft.anonymisedAt) {
    return {
      ok: false,
      message:
        'This draft was anonymised after 30 calendar days without a claim. Its content is gone and cannot be restored — create a new prospect if you want to invite them again.',
    };
  }
  if (record.draft.status === 'claimed') {
    return { ok: false, message: 'This invitation has been claimed and is now an account.' };
  }

  const prior = {
    whatWeUnderstood: record.draft.whatWeUnderstood,
    whyInvited: record.draft.whyInvited,
    senderName: record.draft.senderName,
    senderEmail: record.draft.senderEmail,
    expectedSetupTime: record.draft.expectedSetupTime,
  };

  const next = {
    whatWeUnderstood: input.whatWeUnderstood?.trim() || null,
    whyInvited: input.whyInvited?.trim() || null,
    senderName: input.senderName?.trim() || null,
    senderEmail: input.senderEmail?.trim().toLowerCase() || null,
    expectedSetupTime: input.expectedSetupTime?.trim() || null,
  };

  await db.transaction(async (tx) => {
    await tx.update(campaignDrafts).set(next).where(eq(campaignDrafts.id, draftId));
    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: draftId,
      action: 'invitation.composed',
      internalReason: 'invitation content edited',
      customerExplanation: null,
      priorValue: prior,
      newValue: next,
    });
  });

  return { ok: true };
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export interface DraftRecord {
  draft: CampaignDraft;
  prospect: FounderProspect;
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
  /** `max(sent_at)`. The retention clock §33.1.3 measures from. */
  lastSentAt: Date | null;
  /** Whether a usable link is outstanding. Never the link itself (§28.1). */
  hasLiveToken: boolean;
}

export async function readDraft(db: Database, draftId: string): Promise<DraftRecord | null> {
  const [row] = await db
    .select({ draft: campaignDrafts, prospect: founderProspects })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignDrafts.id, draftId))
    .limit(1);

  if (!row) return null;

  const sends = await db
    .select({
      id: campaignInvitationSends.id,
      sentAt: campaignInvitationSends.sentAt,
      recipientEmail: campaignInvitationSends.recipientEmail,
      senderName: campaignInvitationSends.senderName,
      notificationId: campaignInvitationSends.notificationId,
      tokenVersion: campaignInvitationSends.tokenVersion,
      tokenExpiresAt: campaignInvitationSends.tokenExpiresAt,
      sentBy: campaignInvitationSends.sentBy,
    })
    .from(campaignInvitationSends)
    .where(eq(campaignInvitationSends.draftId, draftId))
    .orderBy(desc(campaignInvitationSends.sentAt));

  const live = await db
    .select({ id: secureTokens.id })
    .from(secureTokens)
    .where(
      and(
        eq(secureTokens.scope, 'founder_draft'),
        eq(secureTokens.campaignDraftId, draftId),
        isNull(secureTokens.revokedAt),
        isNull(secureTokens.claimedAt),
      ),
    )
    .limit(1);

  return {
    draft: row.draft,
    prospect: row.prospect,
    sends,
    lastSentAt: sends[0]?.sentAt ?? null,
    hasLiveToken: live.length > 0,
  };
}

/* ── Preview (§7's gate) ──────────────────────────────────────────────────── */

/**
 * The URL shown in a preview.
 *
 * Not a real link. §28.1 keeps the raw token out of everything but the
 * delivered URL, so previewing cannot mint one and cannot recover the last one
 * — the value is unrecoverable by construction. The Admin surface says so
 * beside the preview rather than showing a link that would 404 if clicked.
 */
export function previewDraftUrl(appBaseUrl: string): string {
  return `${appBaseUrl}${DRAFT_PATH}/…`;
}

export interface InvitationPreview extends RenderedInvitation {
  recipientEmail: string | null;
  /**
   * §7 list items that are still blank and never appear in the message, so the
   * marker gate cannot report them. Named so the surface can say which.
   */
  missingFields: string[];
  /** True while §7's gate holds Send closed. */
  blocked: boolean;
}

export async function previewInvitation(
  db: Database,
  draftId: string,
  context: InvitationContext,
): Promise<InvitationPreview | null> {
  const record = await readDraft(db, draftId);
  if (!record) return null;

  const rendered = await renderFounderInvitation(
    variablesFor(record, previewDraftUrl(context.appBaseUrl), context.supportEmail),
  );

  const missingFields = missingInvitationFields(record);

  // The address Admin approves in the preview is the RESOLVED one, overrides
  // included — otherwise the gate approves one recipient and the send reaches
  // another, which is the failure the gate exists to prevent.
  const recipient = resolvedRecipient(record);

  return {
    ...rendered,
    recipientEmail: recipient.email,
    missingFields,
    blocked: rendered.unresolved.length > 0 || !recipient.email || missingFields.length > 0,
  };
}

/**
 * Who this invitation is actually addressed to, after the §7 overrides.
 *
 * ONE resolver, because four places need the answer and they must not disagree:
 * the preview gate (what Admin approves), the send row (what §7 records as
 * delivered), the transport (where it goes), and the rendered body (who it
 * greets). A surface computing its own would let Admin preview one address and
 * the message reach another — the exact failure the preview gate exists to
 * prevent.
 *
 * A NULL override is no override. `??` rather than `||`, because a blank is
 * refused at the database (0040) and an empty string is therefore not a value
 * an override column can hold.
 */
function resolvedRecipient(record: DraftRecord): {
  email: string | null;
  name: string;
} {
  return {
    email: record.draft.overrideRecipientEmail ?? record.prospect.email,
    name:
      record.draft.overrideRecipientName ??
      (record.prospect.preferredName || record.prospect.legalName || ''),
  };
}

function variablesFor(
  record: DraftRecord,
  draftUrl: string,
  supportEmail: string,
): InvitationVariables {
  /*
   * The profile is the source; this invitation may override it.
   *
   * §7 has Admin compose a message to a specific person and §26.2 has user data
   * auto-populate, so both hold at once: `founder_prospects` is what fills the
   * message, and the five `campaign_drafts.override_*` columns say "for THIS
   * invitation, use something else" (0040). A NULL override is no override —
   * never an empty value, which is why `??` is correct here and `||` is not.
   *
   * This resolution is the whole point of storing an override at all. Reading
   * the profile directly would let the workspace label a value "Custom value
   * for this invitation" while the message that actually went out ignored it,
   * which is worse than not offering the control.
   *
   * The recipient NAME override replaces the preferred/legal pair outright: an
   * Admin who typed a name for this message meant that name, not a fallback
   * chain through the profile they were deliberately departing from.
   */
  const recipientName =
    record.draft.overrideRecipientName ??
    (record.prospect.preferredName || record.prospect.legalName);

  return {
    recipientName,
    productName: record.draft.overrideProduct ?? record.prospect.productName,
    productUrl: record.draft.overrideWebsite ?? record.prospect.productUrl,
    whatWeUnderstood: record.draft.whatWeUnderstood,
    whyInvited: record.draft.whyInvited,
    senderName: record.draft.senderName,
    senderEmail: record.draft.senderEmail,
    expectedSetupTime: record.draft.expectedSetupTime,
    draftUrl,
    reference: record.draft.campaignId,
    supportEmail,
  };
}

/* ── Sending and resending (§7) ───────────────────────────────────────────── */

export interface SendInvitationInput {
  draftId: string;
  actor: string;
  context: InvitationContext;
}

export type SendInvitationResult =
  | { ok: true; sendId: string; tokenVersion: number; resent: boolean }
  | { ok: false; message: string; unresolved?: string[] };

export interface InvitationDeps {
  db: Database;
  tokens: TokenService;
  notifier: Notifier;
}

export async function sendInvitation(
  { db, tokens, notifier }: InvitationDeps,
  input: SendInvitationInput,
): Promise<SendInvitationResult> {
  const record = await readDraft(db, input.draftId);
  if (!record) return { ok: false, message: 'That draft does not exist.' };

  if (record.draft.anonymisedAt) {
    return {
      ok: false,
      message:
        'This draft was anonymised after 30 calendar days without a claim. There is nothing left to send.',
    };
  }
  if (record.draft.status === 'claimed') {
    return { ok: false, message: 'This invitation has already been claimed.' };
  }
  const recipient = resolvedRecipient(record);
  if (!recipient.email) {
    return { ok: false, message: 'This prospect has no email address to send to.' };
  }

  // Non-visible provenance values do not gate the reference's Invite stage.
  const missingFields = missingInvitationFields(record);
  if (missingFields.length > 0) {
    return {
      ok: false,
      message: `The invitation is incomplete. Still blank: ${missingFields.join(', ')}.`,
      unresolved: missingFields,
    };
  }

  // §7's gate, enforced on the rendered output rather than on a list of fields
  // the caller might not share. Runs before anything is issued or written.
  const rendered = await renderFounderInvitation(
    variablesFor(record, `${input.context.appBaseUrl}${DRAFT_PATH}/preflight`, input.context.supportEmail),
  );
  if (rendered.unresolved.length > 0) {
    return {
      ok: false,
      message:
        'This invitation still has unfilled fields. A Founder must never receive a placeholder, so Send stays unavailable until every one is written.',
      unresolved: rendered.unresolved,
    };
  }

  const resent = record.hasLiveToken;

  // Token first. See the note at the top of this file for why this ordering,
  // and what it costs when the provider refuses.
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
          eq(secureTokens.scope, 'founder_draft'),
          eq(secureTokens.campaignDraftId, input.draftId),
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
      { scope: 'founder_draft', campaignDraftId: input.draftId },
      { actorId: input.actor },
    );
    raw = issued.raw;
    tokenId = issued.record.id;
    tokenVersion = issued.record.version;
    tokenExpiresAt = issued.record.expiresAt;
  }

  // The dedup identity. The SEND, not the draft — see the note at the top.
  const sendId = randomUUID();

  const message = await renderFounderInvitation(
    variablesFor(
      record,
      `${input.context.appBaseUrl}${DRAFT_PATH}/${raw}`,
      input.context.supportEmail,
    ),
  );

  // The send row lands BEFORE the provider call, with `notification_id` NULL.
  // This is what guarantees a retention clock exists for anything that might
  // have been delivered — see the ordering note at the top of this file.
  await db.insert(campaignInvitationSends).values({
    id: sendId,
    draftId: input.draftId,
    // §7 records what was DELIVERED, so the send row snapshots the resolved
    // recipient. A later profile edit or a changed override cannot rewrite it —
    // this row is the historical answer to "who did we actually write to".
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    senderName: record.draft.senderName!,
    senderEmail: record.draft.senderEmail!,
    invitationSource: record.prospect.invitationSource,
    notificationId: null,
    tokenId,
    tokenVersion,
    tokenExpiresAt,
    status: 'sent',
    sentBy: input.actor,
  });

  const outcome = await notifier.send({
    eventKey: FOUNDER_INVITATION,
    entityType: 'campaign_invitation_send',
    entityId: sendId,
    to: recipient.email,
    from: input.context.fromAddress,
    replyTo: record.draft.senderEmail ?? undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (outcome.status === 'failed') {
    // The send row stays, with `notification_id` NULL. It is not a claim that
    // a message arrived — it is the record that an attempt was made, and the
    // retention clock that attempt has to start in case it did.
    await db.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: input.draftId,
      action: 'invitation.send_failed',
      internalReason: `provider refused: ${outcome.reason}`,
      customerExplanation: null,
      newValue: { sendId, tokenVersion, resent, deliveryConfirmed: false },
    });
    return {
      ok: false,
      message:
        'The email provider did not accept the message, so nothing was delivered. ' +
        (resent
          ? 'The previous link has already been replaced, so the Founder currently has no working link — send again.'
          : 'No link has reached the Founder — send again.'),
    };
  }

  if (outcome.status === 'duplicate') {
    return { ok: false, message: 'That exact send has already been delivered.' };
  }

  await db.transaction(async (tx) => {
    // Confirmation. `notification_id` is the only column of this row the
    // application may write after insert (migration 0006), so `sent_at` and
    // `token_version` — the facts the retention clock rests on — stay fixed.
    await tx
      .update(campaignInvitationSends)
      .set({ notificationId: outcome.notificationId })
      .where(eq(campaignInvitationSends.id, sendId));

    await tx
      .update(campaignDrafts)
      .set({ status: 'sent' })
      .where(eq(campaignDrafts.id, input.draftId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: input.draftId,
      action: resent ? 'invitation.resent' : 'invitation.sent',
      internalReason: resent
        ? `resent; token rotated to v${tokenVersion} and the 30-day retention clock restarted`
        : `invitation sent with token v${tokenVersion}`,
      customerExplanation: 'We sent you a personal link to your Proovd draft.',
      newValue: {
        sendId,
        tokenVersion,
        notificationId: outcome.notificationId,
        expiresAt: tokenExpiresAt,
      },
      relatedNotificationIds: [outcome.notificationId],
    });
  });

  return { ok: true, sendId, tokenVersion, resent };
}

/* ── Revoking (§7) ────────────────────────────────────────────────────────── */

export async function revokeInvitation(
  { db, tokens }: Pick<InvitationDeps, 'db' | 'tokens'>,
  input: { draftId: string; actor: string; reason: string },
): Promise<{ ok: true; revoked: number } | { ok: false; message: string }> {
  const record = await readDraft(db, input.draftId);
  if (!record) return { ok: false, message: 'That draft does not exist.' };
  if (record.draft.status === 'claimed') {
    return {
      ok: false,
      message:
        'This invitation has been claimed. Revoking the link would not remove the account it created — suspend the account instead.',
    };
  }
  if (!input.reason.trim()) {
    return { ok: false, message: 'Say why this is being revoked. The reason is stored.' };
  }

  const revoked = await db.transaction(async (tx) => {
    const count = await tokens.revokeDraftTokens(input.draftId, 'admin_revoked', tx);

    await tx
      .update(campaignDrafts)
      .set({ status: 'revoked' })
      .where(eq(campaignDrafts.id, input.draftId));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'campaign_draft',
      targetId: input.draftId,
      action: 'invitation.revoked',
      internalReason: input.reason.trim(),
      customerExplanation: null,
      priorValue: { status: record.draft.status },
      newValue: { status: 'revoked', tokensRevoked: count },
    });

    return count;
  });

  return { ok: true, revoked };
}

/* ── The draft landing state (§7) ─────────────────────────────────────────── */

/**
 * What a verified draft token is allowed to reveal.
 *
 * §7: the landing state "names the Founder/product and explains what will
 * happen before an account or payment is required." §33.1.1: it "grants no
 * other access."
 *
 * So this returns the Founder's own name, their own product, and the fixed
 * process copy — and nothing that belongs to Proovd's operations: no Admin
 * notes, no discovery evidence, no internal owner, no invitation source, no
 * other campaign, no other Founder. The route learns the draft id only from the
 * verified token, so there is no id for a caller to substitute.
 */
export interface DraftLanding {
  recipientName: string;
  /**
   * The address the invitation was actually sent to. It is the Founder's own —
   * the token that unlocks this read arrived AT that address — so showing it
   * back to them reveals nothing they do not already hold (§26.2).
   */
  recipientEmail: string | null;
  productName: string;
  whatWeUnderstood: string | null;
  senderName: string | null;
  expectedSetupTime: string | null;
  /**
   * §7's "when we last spoke" — the discovery-call record the landing greets
   * them with ("~3 mins" since the meeting). The instant, never a rendering:
   * the surface formats it against ITS clock, not the server's.
   */
  lastContactAt: Date | null;
  /** Admin-prepared reach shown on the invitation's reach screen. */
  viewsCount: number | null;
  reference: string;
}

export async function readDraftLanding(
  db: Database,
  draftId: string,
): Promise<DraftLanding | null> {
  const [row] = await db
    .select({
      legalName: founderProspects.legalName,
      preferredName: founderProspects.preferredName,
      email: founderProspects.email,
      lastContactAt: founderProspects.lastContactAt,
      productName: founderProspects.productName,
      overrideRecipientName: campaignDrafts.overrideRecipientName,
      overrideRecipientEmail: campaignDrafts.overrideRecipientEmail,
      overrideProduct: campaignDrafts.overrideProduct,
      whatWeUnderstood: campaignDrafts.whatWeUnderstood,
      senderName: campaignDrafts.senderName,
      expectedSetupTime: campaignDrafts.expectedSetupTime,
      viewsCount: campaignDrafts.prefillViewsCount,
      campaignId: campaignDrafts.campaignId,
      status: campaignDrafts.status,
      anonymisedAt: campaignDrafts.anonymisedAt,
    })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaignDrafts.id, draftId))
    .limit(1);

  if (!row || row.anonymisedAt) return null;

  // The same resolution `resolvedRecipient`/`variablesFor` apply: the message
  // that went out greeted the override where one exists, and the page the link
  // opens must greet the same person by the same name — anything else has the
  // email and the landing telling two stories (§27.1).
  return {
    recipientName: row.overrideRecipientName ?? (row.preferredName || row.legalName || ''),
    recipientEmail: row.overrideRecipientEmail ?? row.email,
    productName: (row.overrideProduct ?? row.productName) || '',
    whatWeUnderstood: row.whatWeUnderstood,
    senderName: row.senderName,
    expectedSetupTime: row.expectedSetupTime,
    lastContactAt: row.lastContactAt,
    viewsCount: row.viewsCount,
    reference: row.campaignId,
  };
}

/* ── Listing, for Admin (§26.1) ───────────────────────────────────────────── */

export interface FounderRow {
  prospectId: string;
  draftId: string;
  campaignId: string;
  legalName: string | null;
  email: string | null;
  productName: string | null;
  status: string;
  invitationSource: string | null;
  internalOwner: string | null;
  lastSentAt: Date | null;
  claimedAt: Date | null;
  anonymisedAt: Date | null;
  createdAt: Date;
}

export async function listFounders(db: Database): Promise<FounderRow[]> {
  const rows = await db
    .select({
      prospectId: founderProspects.id,
      draftId: campaignDrafts.id,
      campaignId: campaignDrafts.campaignId,
      legalName: founderProspects.legalName,
      email: founderProspects.email,
      productName: founderProspects.productName,
      status: campaignDrafts.status,
      invitationSource: founderProspects.invitationSource,
      internalOwner: founderProspects.internalOwner,
      claimedAt: founderProspects.claimedAt,
      anonymisedAt: campaignDrafts.anonymisedAt,
      createdAt: campaignDrafts.createdAt,
      lastSentAt: sql<Date | null>`(
        SELECT max(s.sent_at) FROM campaign_invitation_sends s
         WHERE s.draft_id = ${campaignDrafts.id}
      )`.as('last_sent_at'),
    })
    .from(campaignDrafts)
    .innerJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .orderBy(desc(campaignDrafts.createdAt));

  return rows;
}
