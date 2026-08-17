/**
 * The three writes the Creator workspace adds — Spec §8, §25.6, §25.8, §26.7.
 *
 * Everything else it can do already had a service: recording a prospect,
 * updating the research record, recording a verification decision, composing
 * and sending and revoking the invitation, revealing the preparing campaign,
 * revoking kit access. Those are `recruitment.ts`, `invitation.ts`, and
 * `handoff.ts`, and the workspace calls them rather than reimplementing them —
 * a second create path for a prospect is a second set of §8 rules to keep in
 * step.
 *
 * ── Every write records its §25.6 row in the same transaction ───────────────
 * Actor, MFA/reauth context, target, action, time, internal reason, and the
 * prior/new value where there is one. The prior value is READ FROM THE ROW,
 * never taken from the caller — a caller that supplies both halves can supply a
 * flattering pair (§33.12.4, and `admin/overrides.ts` records the same rule).
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import type { Auth } from '../../auth/auth.js';
import { auditEvents } from '../../db/schema/integrity.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import {
  affiliateAccessActions,
  affiliateDeletionRequests,
  affiliateDeletionReviews,
} from '../../db/schema/creator-workspace.js';
import { campaignAffiliateAssociations, campaigns, associationStatusHistory } from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { trackingLinks } from '../../db/schema/decisions.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { reconcileAccount, type OnboardingContext } from '../../payments/onboarding.js';
import { sendCorrectionRequest, type AskDeps } from './asks.js';
import {
  CREATOR_ACCESS_RECORDED,
  CREATOR_ACCOUNT_CORRECTED,
  CREATOR_ASSIGNED_TO_CAMPAIGN,
  CREATOR_CORRECTION_REQUESTED,
  CREATOR_DELETION_REQUESTED,
  CREATOR_DELETION_REVIEWED,
  CREATOR_LINK_PAUSED,
  CREATOR_LINK_REACTIVATED,
  CREATOR_RECOVERY_SENT,
  CREATOR_STRIPE_REFRESHED,
} from './audit-actions.js';
import { campaignNameOf, correctionFieldLabel, isCreatorAccessAction } from './labels.js';

export interface CreatorMutationDeps {
  db: Database;
}

/** §25.6/§28.2's actor context, taken from the guarded session, never a body. */
export interface ActorContext {
  actor: string;
  mfaContext: string;
  reauthContext: string;
}

export type MutationFailure = {
  ok: false;
  code: 'not_found' | 'invalid';
  message: string;
};

export type MutationResult<T> = ({ ok: true } & T) | MutationFailure;

const invalid = (message: string): MutationFailure => ({ ok: false, code: 'invalid', message });
const notFound = (message: string): MutationFailure => ({ ok: false, code: 'not_found', message });

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/* ── Assigning an existing prospect to another campaign (§8, §11) ───────────*/

/**
 * A second campaign relationship for a person Proovd already recruited.
 *
 * `createAffiliateProspect` always creates a FRESH prospect — that is right for
 * recruitment, and wrong here: a Creator recruited to a second campaign is one
 * person with two associations, and a second prospect row would split their
 * §2.2 slot count, their verification, and their history in half.
 *
 * What this does NOT do: send anything, create a signup profile, or copy the
 * first relationship's terms. §14.2's compensation is per association and is
 * agreed bilaterally; §11 ties the invitation to one campaign. The new
 * relationship starts at `prospect`, exactly where recruitment starts one.
 */
export async function assignProspectToCampaign(
  deps: CreatorMutationDeps,
  input: {
    prospectId: string;
    campaignId: string;
    rosterIntent: 'initial_roster' | 'mid_campaign';
    recruitmentSource: string | null;
    whyRecruited: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ associationId: string }>> {
  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id, name: affiliateProspects.legalName })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [campaign] = await deps.db
    .select({
      id: campaigns.id,
      title: campaignBuild.title,
      product: founderProspects.productName,
    })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) return notFound('There is no campaign at that address.');
  const campaignName = campaignNameOf(campaign.title, campaign.product);

  const [existing] = await deps.db
    .select({ id: campaignAffiliateAssociations.id })
    .from(campaignAffiliateAssociations)
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, input.campaignId),
        eq(campaignAffiliateAssociations.prospectId, input.prospectId),
      ),
    )
    .limit(1);
  if (existing) {
    return invalid(
      `This Affiliate already has a relationship with ${campaignName}. One person holds one relationship per campaign.`,
    );
  }

  const associationId = await deps.db.transaction(async (tx) => {
    const [association] = await tx
      .insert(campaignAffiliateAssociations)
      .values({
        campaignId: input.campaignId,
        // NOTE: `affiliate_id` holds the PROSPECT id, not an account id. See
        // `types.ts` — anything keying a connected-account lookup off it would
        // route money at a UUID nobody owns.
        affiliateId: input.prospectId,
        prospectId: input.prospectId,
        status: 'prospect',
        rosterMembership: input.rosterIntent,
        invitationStatus: 'draft',
        recruitmentSource: input.recruitmentSource,
        recruitingAdmin: input.who.actor,
        recruitedAt: new Date(),
        whyRecruited: input.whyRecruited,
      })
      .returning({ id: campaignAffiliateAssociations.id });

    await tx.insert(associationStatusHistory).values({
      associationId: association!.id,
      fromStatus: null,
      toStatus: 'prospect',
      actor: input.who.actor,
    });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_ASSIGNED_TO_CAMPAIGN,
      internalReason: `Existing Affiliate assigned to ${campaignName} as ${input.rosterIntent}.`,
      priorValue: null,
      newValue: { associationId: association!.id, campaignId: input.campaignId },
    });

    return association!.id;
  });

  return { ok: true, associationId };
}

/* ── Account standing (§26.7, §25.6) ───────────────────────────────────────*/

/**
 * Suspending or restoring a PERSON's Affiliate access.
 *
 * A recorded deviation — see the schema header. It is a reversible standing
 * review, never a ban: the action column admits two values, and there is no
 * permanent Creator sanction in the Spec.
 *
 * The prior state is read from the latest row inside the write, so the audit's
 * before/after is the record's answer rather than the caller's.
 */
export async function recordCreatorAccessAction(
  deps: CreatorMutationDeps,
  input: {
    prospectId: string;
    action: string;
    reason: string | null;
    evidence: string | null;
    reviewOwner: string | null;
    nextReviewAt: Date | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ actionId: string }>> {
  if (!isCreatorAccessAction(input.action)) {
    return invalid(
      'The only recorded access decisions are suspend and restore. There is no permanent Creator sanction in the Spec.',
    );
  }
  const reason = text(input.reason);
  if (!reason) {
    return invalid(
      '§26.7 requires the reason. A suspension whose reason lives in somebody’s memory is not reviewable.',
    );
  }

  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  if (input.action === 'suspend' && !text(input.reviewOwner)) {
    return invalid(
      '§27.1 asks a suspended person who owns the review. Name the owner before recording the suspension.',
    );
  }

  const [profile] = await deps.db
    .select({ claimedUserId: affiliateSignupProfiles.claimedUserId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);

  const [prior] = await deps.db
    .select({ action: affiliateAccessActions.action })
    .from(affiliateAccessActions)
    .where(eq(affiliateAccessActions.prospectId, input.prospectId))
    .orderBy(desc(affiliateAccessActions.occurredAt))
    .limit(1);

  const priorValue = prior?.action ?? null;
  if (priorValue === input.action) {
    return invalid(
      input.action === 'suspend'
        ? 'This Affiliate’s access is already suspended.'
        : 'This Affiliate’s access is not currently suspended.',
    );
  }
  if (input.action === 'restore' && priorValue === null) {
    return invalid('This Affiliate’s access is not currently suspended.');
  }

  const actionId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(affiliateAccessActions)
      .values({
        prospectId: input.prospectId,
        userId: profile?.claimedUserId ?? null,
        action: input.action,
        reason,
        evidence: text(input.evidence),
        // A restore ends a review; carrying an owner past the end would leave a
        // promise nothing will honour (§1.4). CHECK-refused too.
        reviewOwner: input.action === 'suspend' ? text(input.reviewOwner) : null,
        nextReviewAt: input.action === 'suspend' ? input.nextReviewAt : null,
        actor: input.who.actor,
        mfaContext: input.who.mfaContext,
        reauthContext: input.who.reauthContext,
      })
      .returning({ id: affiliateAccessActions.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_ACCESS_RECORDED,
      internalReason: reason,
      customerExplanation: reason,
      // Read from the record inside the write, never supplied by the caller
      // (§33.12.4): a caller that hands over both halves can hand over a
      // flattering pair.
      priorValue: { access: priorValue ?? 'no recorded decision' },
      newValue: { access: input.action },
      ...(text(input.evidence) ? { evidenceLinks: { note: text(input.evidence) } } : {}),
    });

    return row!.id;
  });

  return { ok: true, actionId };
}

/* ── The §25.8 deletion ask ────────────────────────────────────────────────*/

/**
 * An Affiliate asked Proovd to close their account.
 *
 * Records the ASK. Nothing is deleted and there is no approval state: §25.8
 * retains account, tax, and status records for account life + 7 years, and
 * campaign, payment, support, and audit records outlive the account regardless
 * of what anybody requests.
 */
export async function recordCreatorDeletionRequest(
  deps: CreatorMutationDeps,
  input: {
    prospectId: string;
    detail: string | null;
    receivedVia: string | null;
    requestedAt: Date | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ requestId: string }>> {
  const detail = text(input.detail);
  const receivedVia = text(input.receivedVia);
  if (!detail) return invalid('Record what the Affiliate actually asked for, in their words.');
  if (!receivedVia) {
    return invalid(
      'Record how the request reached us. A deletion request with no provenance is one nobody can verify was made.',
    );
  }

  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [profile] = await deps.db
    .select({ claimedUserId: affiliateSignupProfiles.claimedUserId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);

  const requestId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(affiliateDeletionRequests)
      .values({
        prospectId: input.prospectId,
        userId: profile?.claimedUserId ?? null,
        requestDetail: detail,
        receivedVia,
        // When the Affiliate asked, which is not when an Admin got round to it.
        requestedAt: input.requestedAt ?? new Date(),
        recordedBy: input.who.actor,
      })
      .returning({ id: affiliateDeletionRequests.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_DELETION_REQUESTED,
      internalReason: `${detail} · received via ${receivedVia}`,
      priorValue: null,
      newValue: { requestId: row!.id },
    });

    return row!.id;
  });

  return { ok: true, requestId };
}

/**
 * An Admin looked at the request and recorded what they concluded.
 *
 * Append-only rows rather than a decision column, so a review that changes its
 * mind leaves both answers behind. There is exactly one outcome the product
 * offers — acknowledged, still under review — because that is what §25.8
 * permits: retention obligations do not end because somebody clicked a button.
 */
export async function recordCreatorDeletionReview(
  deps: CreatorMutationDeps,
  input: { requestId: string; note: string | null; who: ActorContext },
): Promise<MutationResult<{ reviewId: string }>> {
  const note = text(input.note);
  if (!note) return invalid('Record what you concluded. A review with no note decides nothing.');

  const [request] = await deps.db
    .select({ id: affiliateDeletionRequests.id, prospectId: affiliateDeletionRequests.prospectId })
    .from(affiliateDeletionRequests)
    .where(eq(affiliateDeletionRequests.id, input.requestId))
    .limit(1);
  if (!request) return notFound('There is no deletion request at that address.');

  const reviewId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(affiliateDeletionReviews)
      .values({
        requestId: request.id,
        note,
        actor: input.who.actor,
        mfaContext: input.who.mfaContext,
        reauthContext: input.who.reauthContext,
      })
      .returning({ id: affiliateDeletionReviews.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: request.prospectId,
      action: CREATOR_DELETION_REVIEWED,
      internalReason: note,
      priorValue: null,
      newValue: { reviewId: row!.id, requestId: request.id },
    });

    return row!.id;
  });

  return { ok: true, reviewId };
}

/* ── Tracking-link controls (§17, §18, §29.5) ──────────────────────────────*/

/**
 * Pausing and reactivating one Creator's tracking link.
 *
 * §17's first-post verification already pauses a link on a `correction_needed`
 * or `rejected` outcome, and resumes it on a corrected pass. This is the manual
 * equivalent for the cases §29.5 leaves to a recorded Admin decision — and it
 * writes the SAME three columns, so a paused link is one state whichever path
 * paused it, and the §18 ingest needs no second rule.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * It never touches `active` or `activated_at`. §14.2 makes the link's identity
 * immutable by trigger and the 0017 CHECK pins `active` to `activated_at`; more
 * importantly, §18 decides every click against `activated_at`, so moving it
 * would silently re-decide clicks that were already recorded. A pause is a
 * pause, and the ledger keeps recording the reason each ignored click earned
 * nothing.
 *
 * It does not move the association either. A paused LINK stops attribution; a
 * paused CREATOR is §29's enforcement action with its own five customer-facing
 * statement fields and its five-business-day appeal window. Collapsing the two
 * would let a link pause quietly become a sanction with no statement.
 */
export async function setTrackingLinkPaused(
  deps: CreatorMutationDeps,
  input: {
    associationId: string;
    paused: boolean;
    reason: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ associationId: string }>> {
  const [link] = await deps.db
    .select()
    .from(trackingLinks)
    .where(eq(trackingLinks.associationId, input.associationId))
    .limit(1);
  if (!link) {
    return notFound(
      'This campaign relationship has no tracking link yet. One is minted when the formal terms are accepted.',
    );
  }

  const reason = text(input.reason);
  if (input.paused && !reason) {
    return invalid(
      'Say why the link is being paused. The reason is stored with the decision and the Creator may be told it.',
    );
  }
  if (input.paused && link.pausedAt !== null) {
    return invalid('This tracking link is already paused.');
  }
  if (!input.paused && link.pausedAt === null) {
    return invalid('This tracking link is not paused, so there is nothing to reactivate.');
  }

  await deps.db.transaction(async (tx) => {
    await tx
      .update(trackingLinks)
      .set(
        input.paused
          ? { pausedAt: new Date(), pausedReason: reason, pausedBy: input.who.actor }
          : { pausedAt: null, pausedReason: null, pausedBy: null },
      )
      .where(eq(trackingLinks.id, link.id));

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: input.paused ? CREATOR_LINK_PAUSED : CREATOR_LINK_REACTIVATED,
      internalReason:
        reason ?? 'Tracking link reactivated; new traffic is attributable again.',
      // Read from the row inside the write (§33.12.4), never supplied.
      priorValue: { paused: link.pausedAt !== null, reason: link.pausedReason },
      newValue: { paused: input.paused, reason: input.paused ? reason : null },
    });
  });

  return { ok: true, associationId: input.associationId };
}

/* ── Correcting the Affiliate-supplied record (§25.6, §33.12.4 — Session B) ─*/

/**
 * The keys the correction register names. A register rather than a free-text
 * field name, because a route accepting any string would happily record a
 * correction of something that does not exist — and because the set decides
 * which record is being corrected: these are the SIGNUP PROFILE's columns,
 * the person's own confirmed facts, which is why the write refuses before a
 * claim (the pre-claim record is Admin research, edited through the research
 * route with its own provenance).
 */
const CORRECTION_COLUMNS = {
  name: true,
  username: true,
  email: true,
  phone: true,
  country: true,
  state_region: true,
} as const;

export async function correctAffiliateAccountField(
  deps: CreatorMutationDeps,
  input: {
    prospectId: string;
    field: string;
    newValue: string | null;
    reason: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ prospectId: string }>> {
  const label = correctionFieldLabel(input.field);
  if (!label || !(input.field in CORRECTION_COLUMNS)) {
    return invalid('A correction names one of the recorded account fields.');
  }
  const reason = text(input.reason);
  if (!reason) {
    return invalid(
      'Say why this correction is being recorded. The prior value, actor, reason and time all remain in history (§25.6).',
    );
  }
  const newValue = text(input.newValue);
  if (!newValue) {
    return invalid('A correction records the corrected value — it never blanks a confirmed fact.');
  }
  if (input.field === 'email' && !newValue.includes('@')) {
    return invalid('That does not read as an email address.');
  }

  const outcome = await deps.db.transaction(async (tx) => {
    /*
     * The prior value is read from the row UNDER LOCK inside the transaction
     * that changes it (§33.12.4) — a caller that supplied both halves could
     * supply a flattering pair.
     */
    const [profile] = await tx
      .select()
      .from(affiliateSignupProfiles)
      .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
      .for('update')
      .limit(1);
    if (!profile) {
      return invalid(
        'Nothing here has been confirmed by the Affiliate yet — before the claim, the account fields are Admin research, corrected through the research record.',
      );
    }

    const property = {
      name: 'legalName',
      username: 'publicHandle',
      email: 'email',
      phone: 'phone',
      country: 'country',
      state_region: 'stateRegion',
    }[input.field as keyof typeof CORRECTION_COLUMNS] as
      | 'legalName'
      | 'publicHandle'
      | 'email'
      | 'phone'
      | 'country'
      | 'stateRegion';
    const prior = profile[property];

    await tx
      .update(affiliateSignupProfiles)
      .set({ [property]: newValue })
      .where(eq(affiliateSignupProfiles.prospectId, input.prospectId));

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_ACCOUNT_CORRECTED,
      internalReason: reason,
      priorValue: { field: input.field, value: (prior as string | null) ?? null },
      newValue: { field: input.field, value: newValue },
    });

    return { ok: true as const, prospectId: input.prospectId };
  });

  return outcome;
}

/* ── The §11 ask: request a correction from the Affiliate (Session B) ───────*/

/**
 * Records the ask as its §25.6 row, then sends `affiliate_correction_request`
 * keyed on that row. The record commits first (08c's ordering); a transport
 * refusal leaves the ask recorded and reports that nothing was sent (§1.4).
 */
export async function requestAffiliateCorrection(
  deps: CreatorMutationDeps & { asks: Omit<AskDeps, 'db'> },
  input: {
    prospectId: string;
    /** The field being asked about, in the words the surface showed. */
    subjectLabel: string | null;
    note: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ sent: boolean; sendReason: string | null }>> {
  const subjectLabel = text(input.subjectLabel);
  const note = text(input.note);
  if (!subjectLabel) return invalid('Name the field the Affiliate should review.');
  if (!note) return invalid('State the suspected issue and the evidence needed — the Affiliate reads this sentence.');

  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [row] = await deps.db
    .insert(auditEvents)
    .values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_CORRECTION_REQUESTED,
      internalReason: `${subjectLabel}: ${note}`,
      priorValue: null,
      newValue: { subject: subjectLabel },
    })
    .returning({ id: auditEvents.id });

  const outcome = await sendCorrectionRequest(
    { db: deps.db, ...deps.asks },
    {
      prospectId: input.prospectId,
      subjectLabel,
      note,
      entityType: 'affiliate_correction_ask',
      entityId: row!.id,
    },
  );

  return { ok: true, sent: outcome.sent, sendReason: outcome.reason };
}

/* ── The Admin-initiated password recovery (§5.5 — Session B, gap 8) ────────*/

/**
 * Asks Better Auth to mint and deliver a reset link through the ONE reset
 * path — `sendResetPassword`, which chooses `affiliate_password_reset` by the
 * account's role. No second reset mechanism exists here: this route only asks
 * for the same thing the person's own "forgot password" ask produces.
 *
 * Refuses when nobody has claimed the account: there is no password to reset,
 * and §1.4 forbids implying a send that cannot happen. The raw link never
 * appears anywhere in the response or the audit row (§28.1).
 */
export async function sendCreatorPasswordRecovery(
  deps: CreatorMutationDeps & { auth: Auth },
  input: { prospectId: string; who: ActorContext },
): Promise<MutationResult<{ sent: true }>> {
  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [profile] = await deps.db
    .select({
      claimedUserId: affiliateSignupProfiles.claimedUserId,
      email: affiliateSignupProfiles.email,
    })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);
  if (!profile?.claimedUserId || !profile.email) {
    return invalid(
      'Nobody has claimed this account yet, so there is no password to reset. The invitation link is how they get in.',
    );
  }

  await deps.auth.api.requestPasswordReset({
    body: { email: profile.email, redirectTo: '/reset-password' },
  });

  await deps.db.insert(auditEvents).values({
    actor: input.who.actor,
    mfaContext: input.who.mfaContext,
    reauthContext: input.who.reauthContext,
    targetType: 'affiliate_prospect',
    targetId: input.prospectId,
    action: CREATOR_RECOVERY_SENT,
    internalReason:
      'Admin-initiated password recovery. The link is transactional and appears nowhere at rest (§28.1).',
    priorValue: null,
    newValue: { requested: true },
  });

  return { ok: true, sent: true };
}

/* ── The live Stripe re-read (§13, Phase 10b — Session B, gap 4) ────────────*/

/**
 * Re-reads the connected account from the provider and updates the stored
 * record — `reconcileAccount`, the Phase 10b reconciliation path, unchanged.
 * A vendor is a source of events, not truth, and a state reachable only by
 * webhook is a state a dropped delivery can strand somebody in.
 */
export async function refreshCreatorStripeAccount(
  deps: CreatorMutationDeps & { onboarding: Omit<OnboardingContext, 'db'> | null },
  input: { prospectId: string; who: ActorContext },
): Promise<MutationResult<{ refreshed: true }>> {
  if (!deps.onboarding) {
    return invalid(
      'This deployment has no Stripe client, so there is nothing to re-read. The block shows the status Stripe last reported.',
    );
  }

  const [profile] = await deps.db
    .select({ connectedAccountId: affiliateSignupProfiles.connectedAccountId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);
  if (!profile?.connectedAccountId) {
    return invalid(
      'This Affiliate has no connected account yet, so there is nothing to re-read.',
    );
  }

  const view = await reconcileAccount(
    { db: deps.db, ...deps.onboarding },
    profile.connectedAccountId,
  );
  if (!view) {
    return invalid('The stored connected-account record could not be found.');
  }

  await deps.db.insert(auditEvents).values({
    actor: input.who.actor,
    mfaContext: input.who.mfaContext,
    reauthContext: input.who.reauthContext,
    targetType: 'affiliate_prospect',
    targetId: input.prospectId,
    action: CREATOR_STRIPE_REFRESHED,
    internalReason: 'Connected-account status re-read from the provider on request.',
    priorValue: null,
    newValue: { state: view.state },
  });

  return { ok: true, refreshed: true };
}
