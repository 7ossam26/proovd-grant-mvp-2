/**
 * Every Affiliate Proovd has ever recruited, one row each — Spec §8, §26.1.
 *
 * ── This read did not exist, and its absence was structural ─────────────────
 * Every affiliate read in the product before this one was CAMPAIGN-scoped:
 * `listCampaignAffiliates(db, campaignId)`, `listFounderVisibleRoster(db,
 * campaignId)`, the roster, the readiness panel. That is right for every
 * surface that had them — a Founder may only ever see their own campaign's
 * roster (§11) — but it means the product could not answer "who have we
 * recruited", which is the question an Admin opens this section with.
 *
 * ── Batched, from the first line ────────────────────────────────────────────
 * Six queries for the whole directory, `inArray` fan-out over the prospect and
 * association ids, and nothing inside a loop. A per-row subquery directory is
 * the thing that falls over first, and `founders/workspace.ts` established the
 * shape.
 *
 * ── The filters are the SERVER's answer ─────────────────────────────────────
 * `filters.adminWork` and friends are booleans on the row, derived from the
 * attention register, not predicates the browser re-runs. §26.2 needs a
 * `prior_value` to override against and a value the browser computed has none —
 * and more practically, two derivations of "does this need Admin work" is two
 * answers waiting to disagree.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { affiliateProspects, affiliateInvitationSends } from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import { affiliateAccessActions } from '../../db/schema/creator-workspace.js';
import { campaignAffiliateAssociations, campaigns } from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { creatorPostSubmissions } from '../../db/schema/launch.js';
import { creatorEarnings, affiliateTransfers } from '../../db/schema/earnings.js';
import { proposalVersions } from '../../db/schema/decisions.js';
import { policyReacceptanceRequirements } from '../../db/schema/enforcement.js';
import { policyConsents } from '../../db/schema/vetting.js';
import { formatInstant, isoOf } from '../../founders/format.js';
import type { CreatorAttention, CreatorDirectoryRow } from './types.js';
import {
  ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  ADMIN_WORK_ATTENTION_KEYS,
  SLOT_OCCUPYING_STATUSES,
  adminAssociationStatusLabel,
  campaignNameOf,
  campaignTypeLabel,
  creatorAttention,
  deriveCreatorAccountState,
  initialsOf,
  payoutStateLabel,
  platformOf,
  subtypeLabel,
  verificationStateLabel,
  type AttentionOwner,
} from './labels.js';
import { missingEvidence } from '../registry.js';
// §23.1's 27 lifecycle labels are already restated once, for the Founder
// workspace. A second copy here would be a second answer to the same question.
import { campaignStatusLabel } from '../../founders/logic.js';

/* ── The facts every row and the record read both need ──────────────────────*/

/**
 * The per-person facts the directory and the workspace share.
 *
 * Gathered once for a set of prospects, so the single-record read is the same
 * code path as one row of the list. Two composers deriving "is this account
 * suspended" separately is exactly how a list and a detail page come to
 * disagree about the same person.
 */
export interface CreatorFacts {
  prospectId: string;
  claimed: boolean;
  claimedUserId: string | null;
  latestAccessAction: string | null;
  policyReacceptanceOpen: boolean;
  payoutStatus: string | null;
  connectedAccountId: string | null;
  associations: {
    associationId: string;
    campaignId: string;
    campaignName: string;
    campaignType: string | null;
    status: string;
    invitationStatus: string;
    rosterMembership: string;
    recruitedAt: Date | null;
    createdAt: Date;
    lastSentAt: Date | null;
  }[];
  postReviewDue: string | null;
  earningsDecisionDue: string | null;
  proposalOpen: string | null;
  transferFailed: string | null;
  payoutFailed: string | null;
}

/**
 * Loads the shared facts for a set of prospects, in six batched queries.
 *
 * Empty in, empty out — an `inArray` over an empty list is a query that returns
 * everything in some drivers and nothing in others, and neither is what the
 * caller meant.
 */
export async function gatherCreatorFacts(
  db: Database,
  prospectIds: readonly string[],
): Promise<Map<string, CreatorFacts>> {
  const facts = new Map<string, CreatorFacts>();
  if (prospectIds.length === 0) return facts;
  const ids = [...prospectIds];

  for (const id of ids) {
    facts.set(id, {
      prospectId: id,
      claimed: false,
      claimedUserId: null,
      latestAccessAction: null,
      policyReacceptanceOpen: false,
      payoutStatus: null,
      connectedAccountId: null,
      associations: [],
      postReviewDue: null,
      earningsDecisionDue: null,
      proposalOpen: null,
      transferFailed: null,
      payoutFailed: null,
    });
  }

  /* 1. The account, and §13's payout state. One profile per prospect. */
  const profiles = await db
    .select({
      prospectId: affiliateSignupProfiles.prospectId,
      claimedUserId: affiliateSignupProfiles.claimedUserId,
      payoutStatus: affiliateSignupProfiles.payoutStatus,
      connectedAccountId: affiliateSignupProfiles.connectedAccountId,
    })
    .from(affiliateSignupProfiles)
    .where(inArray(affiliateSignupProfiles.prospectId, ids));

  for (const profile of profiles) {
    const row = facts.get(profile.prospectId);
    if (!row) continue;
    row.claimedUserId = profile.claimedUserId;
    row.claimed = profile.claimedUserId !== null;
    row.payoutStatus = profile.payoutStatus;
    row.connectedAccountId = profile.connectedAccountId;
  }

  /* 2. Standing. The latest row per prospect decides; there is no status column. */
  const accessRows = await db
    .select({
      prospectId: affiliateAccessActions.prospectId,
      action: affiliateAccessActions.action,
      occurredAt: affiliateAccessActions.occurredAt,
    })
    .from(affiliateAccessActions)
    .where(inArray(affiliateAccessActions.prospectId, ids))
    .orderBy(desc(affiliateAccessActions.occurredAt));

  for (const action of accessRows) {
    const row = facts.get(action.prospectId);
    // Ordered newest-first, so the first one seen for a prospect is the latest.
    if (row && row.latestAccessAction === null) row.latestAccessAction = action.action;
  }

  /* 3. The relationships, with their campaign and last send. */
  const associations = await db
    .select({
      prospectId: campaignAffiliateAssociations.prospectId,
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      campaignTitle: campaignBuild.title,
      campaignProduct: founderProspects.productName,
      campaignType: campaigns.type,
      status: campaignAffiliateAssociations.status,
      invitationStatus: campaignAffiliateAssociations.invitationStatus,
      rosterMembership: campaignAffiliateAssociations.rosterMembership,
      recruitedAt: campaignAffiliateAssociations.recruitedAt,
      createdAt: campaignAffiliateAssociations.createdAt,
      lastSentAt: sql<Date | null>`(
        SELECT max(s.sent_at) FROM affiliate_invitation_sends s
         WHERE s.association_id = ${campaignAffiliateAssociations.id}
      )`.as('last_sent_at'),
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
    // The name is composed, never stored on the campaign — see `campaignNameOf`.
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    .where(inArray(campaignAffiliateAssociations.prospectId, ids))
    .orderBy(desc(campaignAffiliateAssociations.createdAt));

  const associationIds: string[] = [];
  for (const association of associations) {
    const row = association.prospectId ? facts.get(association.prospectId) : undefined;
    if (!row) continue;
    associationIds.push(association.associationId);
    row.associations.push({
      associationId: association.associationId,
      campaignId: association.campaignId,
      campaignName: campaignNameOf(association.campaignTitle, association.campaignProduct),
      campaignType: association.campaignType,
      status: association.status,
      invitationStatus: association.invitationStatus,
      rosterMembership: association.rosterMembership,
      recruitedAt: association.recruitedAt,
      createdAt: association.createdAt,
      lastSentAt: association.lastSentAt ? new Date(association.lastSentAt) : null,
    });
  }

  /* 4. §29.8's outstanding reacceptance, batched.
   *
   * `readOutstandingReacceptance` answers this for ONE user with a query per
   * requirement, which is correct for a request gate and wrong for a list. Two
   * queries here: the affiliate-audience requirements, then every consent any
   * of these accounts has recorded against them.
   */
  const claimedUserIds = [...facts.values()]
    .map((f) => f.claimedUserId)
    .filter((id): id is string => id !== null);

  if (claimedUserIds.length > 0) {
    const requirements = await db
      .select({ policyVersionId: policyReacceptanceRequirements.policyVersionId })
      .from(policyReacceptanceRequirements)
      .where(eq(policyReacceptanceRequirements.audience, 'affiliate'));

    if (requirements.length > 0) {
      const versionIds = requirements.map((r) => r.policyVersionId);
      const consents = await db
        .select({
          subjectId: policyConsents.subjectId,
          policyVersionId: policyConsents.policyVersionId,
        })
        .from(policyConsents)
        .where(
          and(
            eq(policyConsents.subjectType, 'user'),
            inArray(policyConsents.subjectId, claimedUserIds),
            inArray(policyConsents.policyVersionId, versionIds),
          ),
        );

      const accepted = new Set(consents.map((c) => `${c.subjectId}:${c.policyVersionId}`));
      for (const row of facts.values()) {
        if (!row.claimedUserId) continue;
        row.policyReacceptanceOpen = versionIds.some(
          (versionId) => !accepted.has(`${row.claimedUserId}:${versionId}`),
        );
      }
    }
  }

  if (associationIds.length === 0) return facts;

  const byAssociation = new Map<string, CreatorFacts>();
  for (const row of facts.values()) {
    for (const association of row.associations) byAssociation.set(association.associationId, row);
  }

  /* 5. The three Admin-owned queues, and the Founder-owned one. */
  const posts = await db
    .select({ associationId: creatorPostSubmissions.associationId })
    .from(creatorPostSubmissions)
    .where(
      and(
        inArray(creatorPostSubmissions.associationId, associationIds),
        eq(creatorPostSubmissions.status, 'submitted'),
      ),
    );
  for (const post of posts) {
    const row = byAssociation.get(post.associationId);
    if (row && !row.postReviewDue) row.postReviewDue = post.associationId;
  }

  /*
   * Two different money problems, and they are not one.
   *
   * `creator_earnings.state = 'payout_failed'` is Stripe refusing to move money
   * that Proovd already transferred — the Affiliate updates their details and
   * Stripe retries. `affiliate_transfers.status = 'failed'` is a synchronous
   * creation failure Proovd itself retries under the same idempotency key
   * (§32.3: there is no `transfer.failed` webhook). Different owner, different
   * next action, so different attention lines.
   */
  const earnings = await db
    .select({ associationId: creatorEarnings.associationId, state: creatorEarnings.state })
    .from(creatorEarnings)
    .where(
      and(
        inArray(creatorEarnings.associationId, associationIds),
        inArray(creatorEarnings.state, ['finalized', 'approved_for_transfer', 'payout_failed']),
      ),
    );
  for (const earning of earnings) {
    const row = byAssociation.get(earning.associationId);
    if (!row) continue;
    if (earning.state === 'payout_failed') {
      if (!row.payoutFailed) row.payoutFailed = earning.associationId;
    } else if (!row.earningsDecisionDue) {
      row.earningsDecisionDue = earning.associationId;
    }
  }

  const transfers = await db
    .select({ associationId: affiliateTransfers.associationId })
    .from(affiliateTransfers)
    .where(
      and(
        inArray(affiliateTransfers.associationId, associationIds),
        eq(affiliateTransfers.status, 'failed'),
      ),
    );
  for (const transfer of transfers) {
    const row = byAssociation.get(transfer.associationId);
    if (row && !row.transferFailed) row.transferFailed = transfer.associationId;
  }

  const proposals = await db
    .select({ associationId: proposalVersions.associationId })
    .from(proposalVersions)
    .where(
      and(
        inArray(proposalVersions.associationId, associationIds),
        inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
      ),
    );
  for (const proposal of proposals) {
    const row = byAssociation.get(proposal.associationId);
    if (row && !row.proposalOpen) row.proposalOpen = proposal.associationId;
  }

  return facts;
}

/* ── Attention ──────────────────────────────────────────────────────────────*/

/**
 * The one thing that needs doing on this record, or nothing.
 *
 * Walks the register in order and takes the first that holds, because a row
 * shows one thing to do (DNA §5.1). Every branch names the association it
 * concerns where there is one, so the surface can link straight at it.
 */
export function deriveCreatorAttention(
  facts: CreatorFacts,
  verification: { state: string; missing: readonly string[] },
): CreatorAttention {
  const hit = (
    key: string,
    detail: string,
    associationId: string | null,
  ): CreatorAttention => {
    const definition = creatorAttention(key)!;
    return {
      needed: true,
      kind: definition.key,
      owner: definition.owner as AttentionOwner,
      label: definition.label,
      detail,
      associationId,
    };
  };

  if (facts.latestAccessAction === 'suspend') {
    return hit(
      'account_suspended',
      'Access is suspended pending a recorded review. Restoring it is a separate decision.',
      null,
    );
  }
  if (facts.policyReacceptanceOpen) {
    return hit(
      'policy_reacceptance',
      'A policy update requires acceptance before this Affiliate can continue.',
      null,
    );
  }
  if (facts.transferFailed) {
    return hit(
      'transfer_failed',
      'An Affiliate Transfer did not complete. The retry runs under the same key.',
      facts.transferFailed,
    );
  }
  if (facts.payoutFailed) {
    return hit(
      'payout_blocked',
      'A payout failed at Stripe. The Affiliate updates their details there; Stripe retries.',
      facts.payoutFailed,
    );
  }
  if (facts.payoutStatus === 'requirements_due' || facts.payoutStatus === 'restricted') {
    return hit(
      'payout_blocked',
      'Stripe is holding this account. Proovd cannot supply what it is asking for.',
      null,
    );
  }
  if (facts.postReviewDue) {
    return hit(
      'post_review_due',
      'A first post is waiting for the seven §17 checks.',
      facts.postReviewDue,
    );
  }
  if (facts.earningsDecisionDue) {
    return hit(
      'earnings_decision_due',
      'Finalized earnings are waiting on the next money decision.',
      facts.earningsDecisionDue,
    );
  }
  if (facts.proposalOpen) {
    return hit(
      'proposal_open',
      'A commercial proposal is open. Both parties decide; Admin cannot accept for either.',
      facts.proposalOpen,
    );
  }
  if (verification.state !== 'verified' && verification.state !== 'rejected') {
    return hit(
      'verification_due',
      verification.missing.length > 0
        ? `${verification.missing.length} §5.3 evidence input${verification.missing.length === 1 ? '' : 's'} outstanding for this subtype.`
        : 'Every §5.3 evidence input for this subtype is recorded and waiting on a decision.',
      null,
    );
  }

  const unclaimed = facts.associations.find(
    (a) => a.invitationStatus === 'sent' && !facts.claimed,
  );
  if (unclaimed) {
    return hit(
      'invitation_unclaimed',
      `Sent for ${unclaimed.campaignName} and not yet claimed.`,
      unclaimed.associationId,
    );
  }

  const unsent = facts.associations.find((a) => a.invitationStatus === 'draft');
  if (unsent) {
    return hit(
      'invitation_unsent',
      `Prepared for ${unsent.campaignName} and not sent yet.`,
      unsent.associationId,
    );
  }

  return { needed: false };
}

/* ── The directory ──────────────────────────────────────────────────────────*/

/**
 * Every Affiliate, newest first.
 *
 * Deliberately unfiltered and unpaginated: the reference's directory renders
 * every matching row and the filter pills are the whole of its narrowing. That
 * is right for a hand-recruited roster, and if it stops being right the fix is
 * a cursor here rather than a limit the surface cannot see.
 */
export async function listCreatorDirectory(db: Database): Promise<CreatorDirectoryRow[]> {
  const prospects = await db
    .select()
    .from(affiliateProspects)
    .orderBy(desc(affiliateProspects.createdAt));

  if (prospects.length === 0) return [];

  const facts = await gatherCreatorFacts(
    db,
    prospects.map((p) => p.id),
  );

  return prospects.map((prospect) => {
    const row = facts.get(prospect.id)!;
    const missing = prospect.subtype
      ? missingEvidence(
          prospect.subtype,
          prospect.verificationEvidence as Record<string, string> | null,
        )
      : [];
    const attention = deriveCreatorAttention(row, {
      state: prospect.verificationStatus,
      missing,
    });

    const activeSlots = row.associations.filter((a) =>
      SLOT_OCCUPYING_STATUSES.includes(a.status),
    ).length;
    const lead = row.associations[0];

    const name = prospect.legalName ?? prospect.publicHandle ?? 'Unnamed prospect';
    const platform = platformOf(prospect.channelReference);

    return {
      prospectId: prospect.id,
      initials: initialsOf(prospect.legalName, prospect.publicHandle),
      name,
      handle: prospect.publicHandle,
      subtype: subtypeLabel(prospect.subtype),
      platform,
      niche: prospect.audienceNiche,

      verification: {
        state: prospect.verificationStatus,
        label: verificationStateLabel(prospect.verificationStatus),
        at: formatInstant(prospect.verifiedAt),
        missing: missing.length,
      },

      campaigns: {
        total: row.associations.length,
        activeSlots,
        slotLimit: ACTIVE_PARTNERSHIP_SLOT_LIMIT,
        leadLabel: lead ? adminAssociationStatusLabel(lead.status) : null,
      },

      payout: {
        state: row.claimed ? row.payoutStatus : null,
        label: payoutStateLabel(row.claimed ? row.payoutStatus : null),
      },

      account: deriveCreatorAccountState({
        claimed: row.claimed,
        latestAccessAction: row.latestAccessAction,
        policyReacceptanceOpen: row.policyReacceptanceOpen,
      }),

      attention,

      filters: {
        adminWork: attention.needed && ADMIN_WORK_ATTENTION_KEYS.includes(attention.kind),
        verification:
          prospect.verificationStatus !== 'verified' || missing.length > 0,
        // An unclaimed prospect has no payout problem — nobody has started one.
        // "Not yet populated is not zero" (§16a), applied to a filter.
        payout:
          row.payoutFailed !== null ||
          row.transferFailed !== null ||
          (row.claimed && row.payoutStatus !== 'complete'),
      },

      searchText: [
        name,
        prospect.publicHandle,
        prospect.email,
        platform,
        prospect.audienceNiche,
        prospect.channelReference,
        subtypeLabel(prospect.subtype),
        ...row.associations.map((a) => a.campaignName),
      ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' ')
        .toLowerCase(),

      recruitedAt: isoOf(prospect.createdAt),
    } satisfies CreatorDirectoryRow;
  });
}

/**
 * Whether a prospect id is shaped like one at all.
 *
 * Reused by the routes so a malformed path answers the same 404 a real-but-
 * unknown id does — an id that fails to parse and one that does not exist are
 * the same fact to a caller (§5.5's posture, applied to an Admin surface for
 * consistency rather than for secrecy).
 */
export { looksLikeRecordId } from '../../founders/workspace.js';

/* ── The campaign picker ────────────────────────────────────────────────────*/

export interface AssignableCampaign {
  campaignId: string;
  name: string;
  founderName: string | null;
  /** §3.1's label — `Idea Campaign` / `Product Campaign`, never the raw enum. */
  type: string | null;
  status: string;
}

/**
 * Every campaign an Affiliate can be attached to, newest draft first.
 *
 * The reference's acceptance audit refuses a free-text campaign or Founder
 * field by name, so both forms that pick one need a list. The Founder follows
 * from the campaign rather than being a second choice — a form that let an
 * Admin pick a campaign and a mismatched Founder would be offering a pair the
 * record cannot hold.
 *
 * Archived campaigns are excluded: §9's archive-and-restart replaced them, so
 * recruiting to one would attach somebody to a record with a successor.
 */
export async function listAssignableCampaigns(db: Database): Promise<AssignableCampaign[]> {
  const rows = await db
    .select({
      campaignId: campaigns.id,
      type: campaigns.type,
      status: campaigns.status,
      archivedAt: campaigns.archivedAt,
      title: campaignBuild.title,
      product: founderProspects.productName,
      founderLegalName: founderProspects.legalName,
      draftCreatedAt: campaignDrafts.createdAt,
    })
    .from(campaigns)
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    // Ordered by the DRAFT's creation, never the campaign's: §33.12.1's scan
    // forbids reading `campaigns.created_at`/`updated_at` at all, because a
    // campaign anchor inferred from a row timestamp is the §21 mistake this
    // codebase is built to make impossible.
    .orderBy(desc(campaignDrafts.createdAt));

  return rows
    .filter((row) => row.archivedAt === null)
    .map((row) => ({
      campaignId: row.campaignId,
      name: campaignNameOf(row.title, row.product),
      founderName: row.founderLegalName,
      type: campaignTypeLabel(row.type),
      status: campaignStatusLabel(row.status),
    }));
}
