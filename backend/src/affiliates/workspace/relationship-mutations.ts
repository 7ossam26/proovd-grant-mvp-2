/**
 * The Session C writes against one campaign relationship — Spec §14.2, §22.4,
 * §22.8, §24.8, §26.7, §27.8, §29, migration 0048.
 *
 * Every function here ends the way `mutations.ts`'s do: the domain insert and
 * its §25.6 audit row in ONE transaction, the prior value (where one exists)
 * read from the row rather than the caller (§33.12.4), and the route answers
 * with a full re-read. Two rules are this module's own:
 *
 * ── Nothing here is typed that a record already says ─────────────────────────
 * A deliverable's `source` names the agreement record it restates — computed
 * from the accepted agreement, never taken from the body. The availability
 * term is `availabilityTermOf`'s composition over the frozen mid-campaign
 * sentence or §20's own obligation — the dialog shows it read-only and the
 * check stores it verbatim. A termination request's money treatment is
 * validated against the §24.8 cause register's own permitted set, which is the
 * same matrix 0048 CHECKs — the service refuses by name so an Admin reads why,
 * and the database refuses regardless.
 *
 * ── The case intake creates no second queue ──────────────────────────────────
 * `openAffiliateSupportCase` CALLS `openSupportCase`, so §27.8's business-day
 * clock, the owner, the waiting party, and the four-fact handoff gate all stay
 * where 16b built them. This module adds the subject line, the free-text
 * subcategory, and the workspace's audit row — nothing else.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import { campaignAffiliateAssociations, campaigns } from '../../db/schema/domain.js';
import {
  associationDeliverables,
  associationDeliverableEvidence,
  associationDeliverableDecisions,
  associationAvailabilityVerifications,
  proposalMediationNotes,
  associationTerminationRequests,
} from '../../db/schema/creator-workspace.js';
import { midCampaignAdditions } from '../../db/schema/live-editing.js';
import {
  proposalVersions,
  associationCompensationAgreements,
} from '../../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../../db/schema/payments.js';
import { supportCases } from '../../db/schema/support.js';
import { auditEvents } from '../../db/schema/integrity.js';
import { findRefundCause } from '../../refunds/logic.js';
import { openSupportCase } from '../../support/cases.js';
import { SUPPORT_TOPICS, type SupportTopic } from '../../support/logic.js';
import { sendAffiliatePayoutReminder } from '../../payments/account-notifications.js';
import { availabilityTermOf } from './relationship.js';
import { DELIVERABLE_OUTCOMES, affiliateTreatmentLabel } from './labels.js';
import type { ActorContext, MutationFailure, MutationResult } from './mutations.js';
import type { AskDeps } from './asks.js';
import {
  CREATOR_AVAILABILITY_VERIFIED,
  CREATOR_CASE_OPENED,
  CREATOR_DELIVERABLE_DECIDED,
  CREATOR_DELIVERABLE_EVIDENCE,
  CREATOR_DELIVERABLE_RECORDED,
  CREATOR_MEDIATION_NOTED,
  CREATOR_PAYOUT_REMINDED,
  CREATOR_TERMINATION_DECIDED,
  CREATOR_TERMINATION_REQUESTED,
} from './audit-actions.js';

export interface RelationshipMutationDeps {
  db: Database;
}

const invalid = (message: string): MutationFailure => ({ ok: false, code: 'invalid', message });
const notFound = (message: string): MutationFailure => ({ ok: false, code: 'not_found', message });

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Walks `cause` for Postgres 23505, as the whole codebase does for Drizzle. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    if (typeof current === 'object' && (current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The association, verified to belong to THIS prospect.
 *
 * `affiliate_id` holds the PROSPECT id (the trap `types.ts` documents), and a
 * pair that does not belong together answers the same not-found an unknown id
 * does — otherwise the route would confirm which Affiliate an association
 * belongs to.
 */
async function loadAssociation(
  db: Database,
  prospectId: string,
  associationId: string,
): Promise<{ id: string; campaignId: string } | null> {
  const [row] = await db
    .select({
      id: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      affiliateId: campaignAffiliateAssociations.affiliateId,
    })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!row || row.affiliateId !== prospectId) return null;
  return { id: row.id, campaignId: row.campaignId };
}

/* ── Deliverables (0048, §22.4 idiom) ───────────────────────────────────────*/

/**
 * Records one agreed work item. The `source` is computed from the accepted
 * agreement — a deliverable RESTATES what both parties accepted, and with no
 * accepted agreement there is nothing to restate, so the record is refused
 * rather than invented (§1 rule 6).
 */
export async function recordDeliverable(
  deps: RelationshipMutationDeps,
  input: { prospectId: string; associationId: string; title: string | null; who: ActorContext },
): Promise<MutationResult<{ deliverableId: string }>> {
  const title = text(input.title);
  if (!title) return invalid('Name the agreed work item, as the accepted agreement states it.');

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const [agreement] = await deps.db
    .select({
      source: associationCompensationAgreements.source,
      proposalVersionId: associationCompensationAgreements.proposalVersionId,
    })
    .from(associationCompensationAgreements)
    .where(eq(associationCompensationAgreements.associationId, input.associationId))
    .limit(1);
  const [midCampaign] = await deps.db
    .select({ id: midCampaignAdditions.id })
    .from(midCampaignAdditions)
    .where(eq(midCampaignAdditions.associationId, input.associationId))
    .limit(1);

  let source: string | null = null;
  if (midCampaign) {
    source = 'Mid-campaign addition terms';
  } else if (agreement) {
    if (agreement.source === 'proposal_version' && agreement.proposalVersionId) {
      const [version] = await deps.db
        .select({ versionNumber: proposalVersions.versionNumber })
        .from(proposalVersions)
        .where(eq(proposalVersions.id, agreement.proposalVersionId))
        .limit(1);
      source = version
        ? `Accepted proposal version ${version.versionNumber}`
        : 'Accepted proposal version';
    } else {
      source = 'Standard terms acceptance';
    }
  }
  if (!source) {
    return invalid(
      'No accepted agreement exists on this relationship, so there is nothing for a ' +
        'deliverable to restate. A deliverable never invents a work item the Creator ' +
        'did not agree to.',
    );
  }

  const deliverableId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(associationDeliverables)
      .values({
        associationId: input.associationId,
        title,
        source,
        createdBy: input.who.actor,
      })
      .returning({ id: associationDeliverables.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_DELIVERABLE_RECORDED,
      internalReason: `${title} · restates ${source}`,
      priorValue: null,
      newValue: { deliverableId: row!.id },
    });

    return row!.id;
  });

  return { ok: true, deliverableId };
}

/** Records what was supplied against one deliverable — a receipt, insert-only. */
export async function recordDeliverableEvidence(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string;
    deliverableId: string;
    reference: string | null;
    note: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ evidenceId: string }>> {
  const reference = text(input.reference);
  if (!reference) {
    return invalid(
      'Record the public URL or a plain description of what was supplied. A receipt ' +
        'that points at nothing proves nothing.',
    );
  }

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const [deliverable] = await deps.db
    .select({ id: associationDeliverables.id, associationId: associationDeliverables.associationId })
    .from(associationDeliverables)
    .where(eq(associationDeliverables.id, input.deliverableId))
    .limit(1);
  if (!deliverable || deliverable.associationId !== input.associationId) {
    return notFound('There is no deliverable at that address on this relationship.');
  }

  const evidenceId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(associationDeliverableEvidence)
      .values({
        deliverableId: input.deliverableId,
        reference,
        note: text(input.note),
        submittedBy: input.who.actor,
      })
      .returning({ id: associationDeliverableEvidence.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_DELIVERABLE_EVIDENCE,
      internalReason: reference,
      priorValue: null,
      newValue: { evidenceId: row!.id, deliverableId: input.deliverableId },
    });

    return row!.id;
  });

  return { ok: true, evidenceId };
}

/**
 * The decision — verified, more evidence needed, or the Founder/Admin waiver.
 *
 * Findings are required on every outcome; the waiver additionally carries its
 * named recorder and reason (refused by name here, refused by CHECK
 * regardless), and a non-waiver cannot smuggle either. The decision reads the
 * LATEST evidence receipt itself — a caller cannot point it at a different one.
 */
export async function decideDeliverable(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string;
    deliverableId: string;
    outcome: string;
    findings: string | null;
    waiverRecordedBy: string | null;
    waiverReason: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ decisionId: string }>> {
  if (!(DELIVERABLE_OUTCOMES as readonly string[]).includes(input.outcome)) {
    return invalid(
      'A deliverable decision is verified, more evidence needed, or a recorded ' +
        'Founder/Admin waiver — nothing else has a row shape.',
    );
  }
  const findings = text(input.findings);
  if (!findings) {
    return invalid('Record what was looked at and what it showed. Findings are required on every outcome.');
  }
  const waiverRecordedBy = text(input.waiverRecordedBy);
  const waiverReason = text(input.waiverReason);
  if (input.outcome === 'waived') {
    if (!waiverRecordedBy) {
      return invalid('A waiver needs the named person who recorded it — a waived work item with no name is a decision nobody made.');
    }
    if (!waiverReason) return invalid('A waiver needs its reason, stated.');
  } else if (waiverRecordedBy || waiverReason) {
    return invalid('Only a waiver carries a waiver recorder and reason. A verified decision cannot smuggle one.');
  }

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const [deliverable] = await deps.db
    .select({ id: associationDeliverables.id, associationId: associationDeliverables.associationId })
    .from(associationDeliverables)
    .where(eq(associationDeliverables.id, input.deliverableId))
    .limit(1);
  if (!deliverable || deliverable.associationId !== input.associationId) {
    return notFound('There is no deliverable at that address on this relationship.');
  }

  const [latestEvidence] = await deps.db
    .select({ id: associationDeliverableEvidence.id })
    .from(associationDeliverableEvidence)
    .where(eq(associationDeliverableEvidence.deliverableId, input.deliverableId))
    .orderBy(desc(associationDeliverableEvidence.submittedAt))
    .limit(1);

  const decisionId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(associationDeliverableDecisions)
      .values({
        deliverableId: input.deliverableId,
        evidenceId: latestEvidence?.id ?? null,
        outcome: input.outcome,
        findings,
        waiverRecordedBy,
        waiverReason,
        decidedBy: input.who.actor,
      })
      .returning({ id: associationDeliverableDecisions.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_DELIVERABLE_DECIDED,
      internalReason: `${input.outcome} · ${findings}`,
      priorValue: null,
      newValue: { decisionId: row!.id, deliverableId: input.deliverableId, outcome: input.outcome },
    });

    return row!.id;
  });

  return { ok: true, decisionId };
}

/* ── Content availability (0048) ────────────────────────────────────────────*/

/**
 * The check against the AGREED term. The term is composed from records —
 * the frozen mid-campaign sentence, or §20's availability obligation over the
 * campaign's stored close — and stored verbatim on the row, so a later change
 * to the agreement vocabulary cannot rewrite what was verified.
 */
export async function verifyAvailability(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string;
    available: boolean | null;
    detail: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ verificationId: string }>> {
  if (typeof input.available !== 'boolean') {
    return invalid('Say whether the content is available against the agreed term — yes or no.');
  }
  const detail = text(input.detail);
  if (!detail) {
    return invalid('Record what was checked — the public URLs looked at, and what they showed.');
  }

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const [[midCampaign], [campaign]] = await Promise.all([
    deps.db
      .select({ adjustedDeliverables: midCampaignAdditions.adjustedDeliverables })
      .from(midCampaignAdditions)
      .where(eq(midCampaignAdditions.associationId, input.associationId))
      .limit(1),
    deps.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, association.campaignId))
      .limit(1),
  ]);

  const term = availabilityTermOf(midCampaign ?? null, campaign?.closeAt ?? null);

  const verificationId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(associationAvailabilityVerifications)
      .values({
        associationId: input.associationId,
        termChecked: term.term,
        available: input.available as boolean,
        detail,
        verifiedBy: input.who.actor,
      })
      .returning({ id: associationAvailabilityVerifications.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_AVAILABILITY_VERIFIED,
      internalReason: `${input.available ? 'available' : 'not available'} · ${detail}`,
      priorValue: null,
      newValue: { verificationId: row!.id, termChecked: term.term },
    });

    return row!.id;
  });

  return { ok: true, verificationId };
}

/* ── Proposal mediation (0048, §14.2) ───────────────────────────────────────*/

/** What Admin told the parties. No acceptance column exists to write. */
export async function recordMediationNote(
  deps: RelationshipMutationDeps,
  input: { prospectId: string; associationId: string; note: string | null; who: ActorContext },
): Promise<MutationResult<{ noteId: string }>> {
  const note = text(input.note);
  if (!note) return invalid('Record what Admin actually told the parties.');

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const noteId = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(proposalMediationNotes)
      .values({ associationId: input.associationId, note, createdBy: input.who.actor })
      .returning({ id: proposalMediationNotes.id });

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_MEDIATION_NOTED,
      internalReason: note,
      priorValue: null,
      newValue: { noteId: row!.id },
    });

    return row!.id;
  });

  return { ok: true, noteId };
}

/* ── Termination requests (0048, §29, §24.8) ────────────────────────────────*/

/**
 * Records the ask to end an active partnership. The money treatment must be
 * one the chosen §24.8 cause permits — the register's own matrix, which 0048
 * CHECKs identically — and the record DECIDES NO MONEY and ends nothing.
 */
export async function recordTerminationRequest(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string;
    reason: string | null;
    effectiveAt: Date | null;
    cause: string;
    moneyTreatment: string;
    receivedVia: string | null;
    requestedAt: Date | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ requestId: string }>> {
  const reason = text(input.reason);
  if (!reason) return invalid('Record why the party wants the partnership to end, in their words.');
  const receivedVia = text(input.receivedVia);
  if (!receivedVia) {
    return invalid(
      'Record how the ask reached us. A termination request with no provenance is one ' +
        'nobody can verify was made.',
    );
  }
  if (!input.effectiveAt) {
    return invalid('Record when the termination is asked to take effect.');
  }
  const cause = findRefundCause(input.cause);
  if (!cause) {
    return invalid('Classify the ask under one of §24.8’s five causes — nothing else has a row shape.');
  }
  if (!(cause.permittedAffiliateTreatments as readonly string[]).includes(input.moneyTreatment)) {
    return invalid(
      `The cause “${cause.label}” does not permit the treatment ` +
        `“${affiliateTreatmentLabel(input.moneyTreatment)}”. §24.8’s matrix decides — what is ` +
        'absent from a cause’s list is the guarantee.',
    );
  }

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  try {
    const requestId = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(associationTerminationRequests)
        .values({
          associationId: input.associationId,
          reason,
          effectiveAt: input.effectiveAt as Date,
          cause: input.cause,
          moneyTreatment: input.moneyTreatment,
          receivedVia,
          requestedAt: input.requestedAt ?? new Date(),
          recordedBy: input.who.actor,
        })
        .returning({ id: associationTerminationRequests.id });

      await tx.insert(auditEvents).values({
        actor: input.who.actor,
        mfaContext: input.who.mfaContext,
        reauthContext: input.who.reauthContext,
        targetType: 'campaign_affiliate_association',
        targetId: input.associationId,
        action: CREATOR_TERMINATION_REQUESTED,
        internalReason: `${cause.label} · ${reason}`,
        priorValue: null,
        newValue: { requestId: row!.id, cause: input.cause, moneyTreatment: input.moneyTreatment },
      });

      return row!.id;
    });
    return { ok: true, requestId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return invalid(
        'An undecided termination request already exists on this relationship. A second ' +
          'ask while one waits is a duplicate, not a new decision — decide the open one first.',
      );
    }
    throw error;
  }
}

/**
 * The write-once decision. Applied or declined — the 0048 trigger refuses a
 * second answer, and the conditional UPDATE here is what makes a double-submit
 * safe rather than an error page.
 */
export async function decideTerminationRequest(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string;
    requestId: string;
    decision: string;
    note: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ requestId: string }>> {
  if (input.decision !== 'applied' && input.decision !== 'declined') {
    return invalid('A termination request is applied or declined — nothing else has a row shape.');
  }
  const note = text(input.note);
  if (!note) {
    return invalid('Record why. The decision arrives whole or not at all, and the note is part of it.');
  }

  const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
  if (!association) return notFound('There is no campaign relationship at that address.');

  const decided = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(associationTerminationRequests)
      .set({
        decision: input.decision,
        decisionNote: note,
        decidedBy: input.who.actor,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(associationTerminationRequests.id, input.requestId),
          eq(associationTerminationRequests.associationId, input.associationId),
          isNull(associationTerminationRequests.decision),
        ),
      )
      .returning({ id: associationTerminationRequests.id });
    if (!row) return null;

    await tx.insert(auditEvents).values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      action: CREATOR_TERMINATION_DECIDED,
      internalReason: `${input.decision} · ${note}`,
      priorValue: null,
      newValue: { requestId: row.id, decision: input.decision },
    });

    return row.id;
  });

  if (!decided) {
    const [existing] = await deps.db
      .select({ decision: associationTerminationRequests.decision })
      .from(associationTerminationRequests)
      .where(eq(associationTerminationRequests.id, input.requestId))
      .limit(1);
    if (!existing) return notFound('There is no termination request at that address.');
    return invalid('This request was already decided. A decided request cannot be re-decided.');
  }

  return { ok: true, requestId: decided };
}

/* ── The payout reminder (gap 3 — the existing §27 key) ─────────────────────*/

/**
 * Sends `affiliate_connected_account_info_required` — the message §27 already
 * defines for exactly this state. The ask is recorded first (§1.3) and the
 * send dedups on that record, so a deliberate second ask is a second message
 * and a replay of one is not. Refused unless the stored payout state actually
 * has outstanding requirements — reminding somebody about nothing is §1.4's
 * failure with a send button on it.
 */
export async function sendPayoutReminder(
  deps: RelationshipMutationDeps & { asks: Omit<AskDeps, 'db'> },
  input: { prospectId: string; who: ActorContext },
): Promise<MutationResult<{ sent: boolean; sendReason: string | null }>> {
  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id, email: affiliateProspects.email })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [profile] = await deps.db
    .select({
      email: affiliateSignupProfiles.email,
      payoutStatus: affiliateSignupProfiles.payoutStatus,
      connectedAccountId: affiliateSignupProfiles.connectedAccountId,
    })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);

  if (!profile?.connectedAccountId) {
    return invalid(
      'No payout account exists to remind anyone about. The reminder names what Stripe ' +
        'still needs, and there is no account for Stripe to need anything on.',
    );
  }
  if (profile.payoutStatus !== 'requirements_due') {
    return invalid(
      `The stored payout state is “${profile.payoutStatus ?? 'not started'}”, not an ` +
        'outstanding Stripe requirement. A reminder about nothing is worse than none.',
    );
  }
  const email = profile.email ?? prospect.email;
  if (!email) return invalid('No email address is on record, so nothing can be sent.');

  const [account] = await deps.db
    .select({
      pastDue: stripeConnectedAccounts.requirementsPastDue,
      currentlyDue: stripeConnectedAccounts.requirementsCurrentlyDue,
    })
    .from(stripeConnectedAccounts)
    .where(eq(stripeConnectedAccounts.stripeAccountId, profile.connectedAccountId))
    .limit(1);
  const requirements = [
    ...((account?.pastDue as string[] | null) ?? []),
    ...((account?.currentlyDue as string[] | null) ?? []),
  ];

  // The ask is recorded before the send (§1.3): a transport refusal leaves the
  // ask on the record and the response says nothing was sent.
  const [ask] = await deps.db
    .insert(auditEvents)
    .values({
      actor: input.who.actor,
      mfaContext: input.who.mfaContext,
      reauthContext: input.who.reauthContext,
      targetType: 'affiliate_prospect',
      targetId: input.prospectId,
      action: CREATOR_PAYOUT_REMINDED,
      internalReason: `Stripe requirements outstanding: ${requirements.join(', ') || 'unnamed'}`,
      priorValue: null,
      newValue: { connectedAccountId: profile.connectedAccountId },
    })
    .returning({ id: auditEvents.id });

  const outcome = await sendAffiliatePayoutReminder(
    { notifier: deps.asks.notifier, context: deps.asks.context },
    {
      stripeAccountId: profile.connectedAccountId,
      email,
      missingRequirements: requirements,
      entityId: ask!.id,
    },
  );

  return { ok: true, sent: outcome.sent, sendReason: outcome.reason };
}

/* ── Case intake (gap 7 — §26.7 through the one queue) ──────────────────────*/

/**
 * Opens a §26.7 case for this Affiliate through `openSupportCase` — the one
 * intake, so the case is born with its reference, its §27.8 business-day
 * response promise on the committed calendar, and its owner. Refused before
 * the claim: a case is anchored on the requester's account, and pre-claim
 * there is no account to anchor it on.
 */
export async function openAffiliateSupportCase(
  deps: RelationshipMutationDeps,
  input: {
    prospectId: string;
    associationId: string | null;
    topic: string;
    subject: string | null;
    subcategory: string | null;
    message: string | null;
    who: ActorContext;
  },
): Promise<MutationResult<{ caseId: string; reference: string }>> {
  if (!(SUPPORT_TOPICS as readonly string[]).includes(input.topic)) {
    return invalid(
      'Classify the case under one of §26.7’s ten topics. Finer detail goes in the ' +
        'subcategory — one list, or the queue counts two different things.',
    );
  }
  const message = text(input.message);
  if (!message) return invalid('Record what the Affiliate actually asked, in their words.');

  const [prospect] = await deps.db
    .select({ id: affiliateProspects.id, email: affiliateProspects.email })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return notFound('There is no Affiliate at that address.');

  const [profile] = await deps.db
    .select({
      email: affiliateSignupProfiles.email,
      claimedUserId: affiliateSignupProfiles.claimedUserId,
    })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);
  if (!profile?.claimedUserId) {
    return invalid(
      'Nobody has claimed this account, so there is no requester to anchor a case on. ' +
        'Pre-claim questions live on the prospect’s research record.',
    );
  }

  let campaignId: string | undefined;
  if (input.associationId) {
    const association = await loadAssociation(deps.db, input.prospectId, input.associationId);
    if (!association) return notFound('There is no campaign relationship at that address.');
    campaignId = association.campaignId;
  }

  const opened = await openSupportCase(deps.db, {
    topic: input.topic as SupportTopic,
    owner: 'proovd_support',
    requesterKind: 'creator',
    requesterUserId: profile.claimedUserId,
    requesterEmail: profile.email ?? prospect.email ?? '',
    ...(campaignId ? { campaignId } : {}),
    ...(input.associationId ? { associationId: input.associationId } : {}),
    message,
    createdBy: input.who.actor,
  });
  if (!opened.ok) return invalid(opened.message);

  const subject = text(input.subject);
  const subcategory = text(input.subcategory);
  if (subject || subcategory) {
    await deps.db
      .update(supportCases)
      .set({
        ...(subject ? { subject } : {}),
        ...(subcategory ? { subcategory } : {}),
      })
      .where(eq(supportCases.id, opened.result.caseId));
  }

  await deps.db.insert(auditEvents).values({
    actor: input.who.actor,
    mfaContext: input.who.mfaContext,
    reauthContext: input.who.reauthContext,
    targetType: 'affiliate_prospect',
    targetId: input.prospectId,
    action: CREATOR_CASE_OPENED,
    internalReason: `${input.topic}${subcategory ? ` · ${subcategory}` : ''} · ${opened.result.reference}`,
    priorValue: null,
    newValue: { caseId: opened.result.caseId, reference: opened.result.reference },
  });

  return { ok: true, caseId: opened.result.caseId, reference: opened.result.reference };
}
