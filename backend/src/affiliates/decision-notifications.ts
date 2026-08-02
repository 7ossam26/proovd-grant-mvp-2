/**
 * The decision messages, sent after each transaction commits — Spec §14.2,
 * §27.2, §27.3, §27.4.
 *
 * Same posture as Phase 11's payment messages: the domain decision already
 * committed, so a provider refusal is recorded and returned, never thrown.
 * Dedup keys name the thing that happens once:
 *
 *   acceptance / decline / expiry   → the association (each happens once per
 *                                     relationship);
 *   proposal / revision / decision  → the exact VERSION, because a second
 *                                     version is a genuinely new message and
 *                                     keying on the association would swallow
 *                                     every message after the first — §7's
 *                                     resend lesson, §33.7.7's duplicate rule.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaigns, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { listingFeePayments } from '../db/schema/listing.js';
import type { ProposalVersion, AssociationCompensationAgreement } from '../db/schema/decisions.js';
import type { Notifier } from '../notifications/send.js';
import {
  AFFILIATE_ACCEPT_CONFIRMATION,
  AFFILIATE_DECLINE_CONFIRMATION,
  AFFILIATE_PROPOSAL_SUBMITTED,
  AFFILIATE_FOUNDER_REVISION,
  AFFILIATE_FOUNDER_DECISION,
  AFFILIATE_PROPOSAL_EXPIRED,
  FOUNDER_CREATOR_PROPOSAL_RECEIVED,
  FOUNDER_CREATOR_PROPOSAL_REVISION,
  FOUNDER_CREATOR_PROPOSAL_DECISION,
} from '../notifications/events.js';
import {
  renderAcceptConfirmation,
  renderDeclineConfirmation,
  renderProposalSubmitted,
  renderProposalReceived,
  renderFounderRevision,
  renderVersionDecision,
  renderProposalExpired,
} from '../notifications/templates/decisions.js';
import { formatUsdCents } from '../payments/listing-notifications.js';

export interface DecisionNotificationContext {
  appBaseUrl: string;
  supportEmail: string;
  fromAddress: string;
}

/* ── Identity reads ───────────────────────────────────────────────────────── */

interface Parties {
  campaignId: string;
  productName: string | null;
  founderEmail: string | null;
  founderName: string | null;
  creatorEmail: string | null;
  creatorName: string | null;
  responseDeadlineUtc: string;
}

async function loadParties(db: Database, associationId: string): Promise<Parties | null> {
  const [row] = await db
    .select({
      campaignId: campaignAffiliateAssociations.campaignId,
      creatorEmail: affiliateSignupProfiles.email,
      creatorName: affiliateSignupProfiles.publicHandle,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);
  if (!row) return null;

  const [founder] = await db
    .select({
      claimEmail: founderClaimProfiles.email,
      claimName: founderClaimProfiles.preferredName,
      prospectEmail: founderProspects.email,
      prospectName: founderProspects.preferredName,
      productName: founderProspects.productName,
    })
    .from(campaigns)
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(campaignDrafts.prospectId, founderProspects.id))
    .where(eq(campaigns.id, row.campaignId))
    .limit(1);

  const [payment] = await db
    .select({ deadline: listingFeePayments.responseDeadlineAt })
    .from(listingFeePayments)
    .where(eq(listingFeePayments.campaignId, row.campaignId))
    .limit(1);

  return {
    campaignId: row.campaignId,
    productName: founder?.productName ?? null,
    founderEmail: (founder?.claimEmail ?? founder?.prospectEmail ?? null)?.trim() || null,
    founderName: founder?.claimName ?? founder?.prospectName ?? null,
    creatorEmail: row.creatorEmail?.trim() || null,
    creatorName: row.creatorName ?? null,
    responseDeadlineUtc: payment
      ? payment.deadline.toISOString().replace('T', ' ').slice(0, 16)
      : '[UNKNOWN]',
  };
}

/** The customer-facing terms sentence for a version. Internal names never render (§3). */
export function describeVersionTerms(
  version: Pick<ProposalVersion, 'bidTotalPercent' | 'fixedPaymentRequestCents'>,
): string {
  const parts: string[] = [];
  if (version.bidTotalPercent !== null) parts.push(`a total of ${version.bidTotalPercent}% per attributed captured charge`);
  if (version.fixedPaymentRequestCents !== null) {
    parts.push(`a fixed Creator payment of ${formatUsdCents(version.fixedPaymentRequestCents)}`);
  }
  return parts.join(' and ') || 'no proposed values';
}

/* ── Senders ──────────────────────────────────────────────────────────────── */

export async function notifyStandardAcceptance(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: { associationId: string; agreement: AssociationCompensationAgreement },
): Promise<string> {
  const parties = await loadParties(db, input.associationId);
  if (!parties?.creatorEmail) return 'skipped: no Creator address';

  const exampleChargeCents = 10000n; // US$100.00 — a worked example, not a promise.
  const exampleShareCents =
    (exampleChargeCents * BigInt(input.agreement.totalPercent)) / 100n;

  const rendered = await renderAcceptConfirmation({
    creatorName: parties.creatorName,
    productName: parties.productName,
    totalPercent: input.agreement.totalPercent,
    exampleChargeFormatted: formatUsdCents(exampleChargeCents),
    exampleShareFormatted: formatUsdCents(exampleShareCents),
    fixedPaymentFormatted: input.agreement.fixedPaymentCents
      ? formatUsdCents(input.agreement.fixedPaymentCents)
      : null,
    responseDeadlineUtc: parties.responseDeadlineUtc,
    campaignUrl: `${context.appBaseUrl}/creator/campaigns/${input.associationId}`,
    reference: input.associationId,
    supportEmail: context.supportEmail,
  });

  const outcome = await notifier.send({
    eventKey: AFFILIATE_ACCEPT_CONFIRMATION,
    entityType: 'campaign_affiliate_association',
    entityId: input.associationId,
    to: parties.creatorEmail,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
  return outcome.status;
}

export async function notifyDecline(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: { associationId: string },
): Promise<string> {
  const parties = await loadParties(db, input.associationId);
  if (!parties?.creatorEmail) return 'skipped: no Creator address';

  const rendered = await renderDeclineConfirmation({
    creatorName: parties.creatorName,
    productName: parties.productName,
    reference: input.associationId,
    supportEmail: context.supportEmail,
  });

  const outcome = await notifier.send({
    eventKey: AFFILIATE_DECLINE_CONFIRMATION,
    entityType: 'campaign_affiliate_association',
    entityId: input.associationId,
    to: parties.creatorEmail,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
  return outcome.status;
}

/** A Creator's new version: confirmation to the Creator, notice to the Founder. */
export async function notifyProposalSubmitted(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: { associationId: string; version: ProposalVersion; isCounter: boolean },
): Promise<{ creator: string; founder: string }> {
  const parties = await loadParties(db, input.associationId);
  if (!parties) return { creator: 'skipped', founder: 'skipped' };
  const summary = describeVersionTerms(input.version);

  let creator = 'skipped: no Creator address';
  if (parties.creatorEmail) {
    const rendered = await renderProposalSubmitted({
      recipientName: parties.creatorName,
      productName: parties.productName,
      versionNumber: input.version.versionNumber,
      termsSummary: summary,
      campaignUrl: `${context.appBaseUrl}/creator/campaigns/${input.associationId}`,
      reference: input.version.id,
      supportEmail: context.supportEmail,
    });
    creator = (
      await notifier.send({
        eventKey: AFFILIATE_PROPOSAL_SUBMITTED,
        entityType: 'proposal_version',
        entityId: input.version.id,
        to: parties.creatorEmail,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        ...rendered,
      })
    ).status;
  }

  let founder = 'skipped: no Founder address';
  if (parties.founderEmail) {
    const rendered = await renderProposalReceived({
      recipientName: parties.founderName,
      productName: parties.productName,
      versionNumber: input.version.versionNumber,
      termsSummary: summary,
      campaignUrl: `${context.appBaseUrl}/campaigns/${parties.campaignId}/workspace`,
      reference: input.version.id,
      supportEmail: context.supportEmail,
    });
    founder = (
      await notifier.send({
        eventKey: input.isCounter ? FOUNDER_CREATOR_PROPOSAL_REVISION : FOUNDER_CREATOR_PROPOSAL_RECEIVED,
        entityType: 'proposal_version',
        entityId: input.version.id,
        to: parties.founderEmail,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        ...rendered,
      })
    ).status;
  }

  return { creator, founder };
}

/** A Founder revision: notice to the Creator, keyed on the NEW version. */
export async function notifyFounderRevision(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: { associationId: string; version: ProposalVersion },
): Promise<string> {
  const parties = await loadParties(db, input.associationId);
  if (!parties?.creatorEmail) return 'skipped: no Creator address';

  const rendered = await renderFounderRevision({
    recipientName: parties.creatorName,
    productName: parties.productName,
    versionNumber: input.version.versionNumber,
    termsSummary: describeVersionTerms(input.version),
    campaignUrl: `${context.appBaseUrl}/creator/campaigns/${input.associationId}`,
    reference: input.version.id,
    supportEmail: context.supportEmail,
  });

  const outcome = await notifier.send({
    eventKey: AFFILIATE_FOUNDER_REVISION,
    entityType: 'proposal_version',
    entityId: input.version.id,
    to: parties.creatorEmail,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
  return outcome.status;
}

/** One party's accept/decline of a version: told to the other party. */
export async function notifyVersionDecision(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: {
    associationId: string;
    version: ProposalVersion;
    decidedBy: 'founder' | 'affiliate';
    decision: 'accepted' | 'declined';
  },
): Promise<string> {
  const parties = await loadParties(db, input.associationId);
  if (!parties) return 'skipped';

  const toCreator = input.decidedBy === 'founder';
  const to = toCreator ? parties.creatorEmail : parties.founderEmail;
  if (!to) return 'skipped: no address';

  const rendered = await renderVersionDecision({
    recipientName: toCreator ? parties.creatorName : parties.founderName,
    productName: parties.productName,
    versionNumber: input.version.versionNumber,
    termsSummary: describeVersionTerms(input.version),
    campaignUrl: toCreator
      ? `${context.appBaseUrl}/creator/campaigns/${input.associationId}`
      : `${context.appBaseUrl}/campaigns/${parties.campaignId}/workspace`,
    reference: input.version.id,
    supportEmail: context.supportEmail,
    decision: input.decision,
    decidedBy: toCreator ? 'Founder' : 'Creator',
  });

  const outcome = await notifier.send({
    // A version is resolved exactly once (terminal states never change), so
    // the version IS the thing that happens once.
    eventKey: toCreator ? AFFILIATE_FOUNDER_DECISION : FOUNDER_CREATOR_PROPOSAL_DECISION,
    entityType: 'proposal_version',
    entityId: input.version.id,
    to,
    from: context.fromAddress,
    replyTo: context.supportEmail,
    ...rendered,
  });
  return outcome.status;
}

/** §14.6: the window closed on an unfinished decision. One per association. */
export async function notifyProposalsExpired(
  db: Database,
  notifier: Notifier,
  context: DecisionNotificationContext,
  input: { expiredAssociationIds: string[] },
): Promise<Array<{ associationId: string; outcome: string }>> {
  if (input.expiredAssociationIds.length === 0) return [];

  const rows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      email: affiliateSignupProfiles.email,
      handle: affiliateSignupProfiles.publicHandle,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(inArray(campaignAffiliateAssociations.id, input.expiredAssociationIds));

  const results: Array<{ associationId: string; outcome: string }> = [];
  for (const row of rows) {
    const to = row.email?.trim();
    if (!to) {
      results.push({ associationId: row.associationId, outcome: 'skipped: no address' });
      continue;
    }
    const parties = await loadParties(db, row.associationId);
    const rendered = await renderProposalExpired({
      creatorName: row.handle,
      productName: parties?.productName ?? null,
      reference: row.associationId,
      supportEmail: context.supportEmail,
    });
    const outcome = await notifier.send({
      eventKey: AFFILIATE_PROPOSAL_EXPIRED,
      entityType: 'campaign_affiliate_association',
      entityId: row.associationId,
      to,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      ...rendered,
    });
    results.push({ associationId: row.associationId, outcome: outcome.status });
  }
  return results;
}
