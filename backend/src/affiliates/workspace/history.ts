/**
 * Everything that happened to one Affiliate — Spec §25.6, §26.1, §26.8.
 *
 * ── Composed, never stored ──────────────────────────────────────────────────
 * There is no `affiliate_history` table and there must not be one. §26.8's own
 * trap: "a second event store that drifts from the first is worse than no
 * timeline." Every entry below is read from the record that already holds the
 * fact and carries `source` — the table it came from — so the claim is
 * checkable from the response rather than taken on trust.
 *
 * This module WRITES NOTHING. A test asserts there is no `.insert(`,
 * `.update(`, or `.delete(` in it, because the schema check passes right up
 * until somebody adds one.
 *
 * ── Why this is not `readTimeline` ──────────────────────────────────────────
 * §26.8's timeline is campaign-, reservation-, or association-scoped. This is
 * PERSON-scoped and spans records that timeline never sees: invitation sends
 * across two campaigns, the Stripe connected account, the account-standing
 * decisions, the §25.8 deletion ask. Filtering the campaign timeline by
 * association would miss all four.
 *
 * ── `audit_events` is read through an allowlist ─────────────────────────────
 * An action this module does not recognise is SKIPPED, never rendered raw. §3.1
 * is the reason: an audit action name is an internal identifier, and a history
 * row reading `affiliate.prospect_updated` to somebody on a support call is the
 * leak §3.1 names. `audit-actions.ts` owns the map, so a writer and a reader
 * cannot disagree about a name.
 */

import { desc, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { affiliateProspects, affiliateInvitationSends, campaignKitAccess } from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import {
  affiliateAccessActions,
  affiliateDeletionRequests,
  affiliateDeletionReviews,
} from '../../db/schema/creator-workspace.js';
import { associationStatusHistory, campaignAffiliateAssociations, campaigns } from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { auditEvents } from '../../db/schema/integrity.js';
import { proposalVersions, trackingLinks } from '../../db/schema/decisions.js';
import { creatorPostSubmissions } from '../../db/schema/launch.js';
import { creatorEarningsStateHistory, affiliateTransfers } from '../../db/schema/earnings.js';
import { creatorPaymentAllocations } from '../../db/schema/creator-payment.js';
import { affiliateEnforcementActions, affiliateEnforcementAppeals } from '../../db/schema/enforcement.js';
import { stripeAccountEvents } from '../../db/schema/payments.js';
import { formatInstant, isoOf, resolveActorNames, actorName } from '../../founders/format.js';
import { creatorAuditTitle } from './audit-actions.js';
import { adminAssociationStatusLabel, campaignNameOf } from './labels.js';
import type { CreatorHistoryEntry } from './types.js';
import type { CreatorHistoryCategory } from './labels.js';

export interface CreatorHistoryScope {
  prospectId: string;
  associationIds: readonly string[];
  campaignIds: readonly string[];
  claimedUserId: string | null;
}

interface Draft {
  category: CreatorHistoryCategory;
  at: Date | null;
  title: string;
  detail: string;
  actor: string | null;
  source: string;
  id: string;
}

/** Reads every recorded fact about this person, newest first. */
export async function readCreatorHistory(
  db: Database,
  scope: CreatorHistoryScope,
): Promise<CreatorHistoryEntry[]> {
  const drafts: Draft[] = [];
  const associationIds = [...scope.associationIds];

  const campaignNames = new Map<string, string>();
  const associationCampaign = new Map<string, string>();
  if (associationIds.length > 0) {
    const rows = await db
      .select({
        associationId: campaignAffiliateAssociations.id,
        campaignId: campaigns.id,
        title: campaignBuild.title,
        product: founderProspects.productName,
      })
      .from(campaignAffiliateAssociations)
      .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
      .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
      .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
      .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
      .where(inArray(campaignAffiliateAssociations.id, associationIds));
    for (const row of rows) {
      const name = campaignNameOf(row.title, row.product);
      campaignNames.set(row.campaignId, name);
      associationCampaign.set(row.associationId, name);
    }
  }

  const on = (associationId: string): string => {
    const name = associationCampaign.get(associationId);
    return name ? ` on ${name}` : '';
  };

  /* ── account ───────────────────────────────────────────────────────────── */

  const [prospect] = await db
    .select({ createdAt: affiliateProspects.createdAt, createdBy: affiliateProspects.createdBy })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, scope.prospectId))
    .limit(1);
  if (prospect) {
    drafts.push({
      category: 'account',
      at: prospect.createdAt,
      title: 'Prospect recorded',
      detail: 'Recruited from off-platform research. No account exists at this point.',
      actor: prospect.createdBy,
      source: 'affiliate_prospects',
      id: scope.prospectId,
    });
  }

  if (associationIds.length > 0) {
    const sends = await db
      .select()
      .from(affiliateInvitationSends)
      .where(inArray(affiliateInvitationSends.associationId, associationIds));
    for (const send of sends) {
      drafts.push({
        category: 'account',
        at: send.sentAt,
        title:
          send.notificationId === null
            ? 'Campaign invitation recorded, delivery unconfirmed'
            : 'Campaign invitation sent',
        detail: `Sent by ${send.senderName}${on(send.associationId)}. The link is scoped to that one campaign.`,
        actor: send.sentBy,
        source: 'affiliate_invitation_sends',
        id: send.id,
      });
    }
  }

  const [signup] = await db
    .select({
      id: affiliateSignupProfiles.id,
      claimedAt: affiliateSignupProfiles.claimedAt,
      claimedUserId: affiliateSignupProfiles.claimedUserId,
      payoutStatus: affiliateSignupProfiles.payoutStatus,
      payoutStatusUpdatedAt: affiliateSignupProfiles.payoutStatusUpdatedAt,
    })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, scope.prospectId))
    .limit(1);
  if (signup?.claimedAt) {
    drafts.push({
      category: 'account',
      at: signup.claimedAt,
      title: 'Account claimed',
      detail: 'The invited account was created and the five §5.3 confirmations were recorded.',
      actor: signup.claimedUserId,
      source: 'affiliate_signup_profiles',
      id: signup.id,
    });
  }

  const accessActions = await db
    .select()
    .from(affiliateAccessActions)
    .where(eq(affiliateAccessActions.prospectId, scope.prospectId));
  for (const action of accessActions) {
    drafts.push({
      category: 'account',
      at: action.occurredAt,
      title: action.action === 'suspend' ? 'Account access suspended' : 'Account access restored',
      detail: action.reason,
      actor: action.actor,
      source: 'affiliate_access_actions',
      id: action.id,
    });
  }

  const deletionRequests = await db
    .select()
    .from(affiliateDeletionRequests)
    .where(eq(affiliateDeletionRequests.prospectId, scope.prospectId));
  for (const request of deletionRequests) {
    drafts.push({
      category: 'account',
      at: request.requestedAt,
      title: 'Account deletion request recorded',
      detail: `${request.requestDetail} · received via ${request.receivedVia}`,
      actor: request.recordedBy,
      source: 'affiliate_deletion_requests',
      id: request.id,
    });
  }
  if (deletionRequests.length > 0) {
    const reviews = await db
      .select()
      .from(affiliateDeletionReviews)
      .where(
        inArray(
          affiliateDeletionReviews.requestId,
          deletionRequests.map((r) => r.id),
        ),
      );
    for (const review of reviews) {
      drafts.push({
        category: 'account',
        at: review.occurredAt,
        title: 'Deletion request reviewed',
        detail: review.note,
        actor: review.actor,
        source: 'affiliate_deletion_reviews',
        id: review.id,
      });
    }
  }

  /* ── campaign ──────────────────────────────────────────────────────────── */

  if (associationIds.length > 0) {
    const transitions = await db
      .select()
      .from(associationStatusHistory)
      .where(inArray(associationStatusHistory.associationId, associationIds));
    for (const transition of transitions) {
      drafts.push({
        category: 'campaign',
        at: transition.occurredAt,
        title: adminAssociationStatusLabel(transition.toStatus),
        detail: transition.fromStatus
          ? `Moved from ${adminAssociationStatusLabel(transition.fromStatus)}${on(transition.associationId)}.`
          : `Relationship created${on(transition.associationId)}.`,
        actor: transition.actor,
        source: 'association_status_history',
        id: transition.id,
      });
    }

    const versions = await db
      .select()
      .from(proposalVersions)
      .where(inArray(proposalVersions.associationId, associationIds));
    for (const version of versions) {
      drafts.push({
        category: 'campaign',
        at: version.createdAt,
        title: `Proposal version ${version.versionNumber}`,
        detail: `Proposed by the ${version.proposedBy}${on(version.associationId)} at ${version.bidTotalPercent}%. Every version is immutable; a revision is a new one.`,
        actor: null,
        source: 'proposal_versions',
        id: version.id,
      });
      if (version.lockedAt) {
        drafts.push({
          category: 'campaign',
          at: version.lockedAt,
          title: 'Terms locked by bilateral acceptance',
          detail: `Version ${version.versionNumber} is the exact version both parties accepted${on(version.associationId)}.`,
          actor: null,
          source: 'proposal_versions',
          id: `${version.id}:locked`,
        });
      }
    }

    const links = await db
      .select()
      .from(trackingLinks)
      .where(inArray(trackingLinks.associationId, associationIds));
    for (const link of links) {
      if (link.activatedAt) {
        drafts.push({
          category: 'campaign',
          at: link.activatedAt,
          title: 'Affiliate link activated',
          detail: `Attribution starts here${on(link.associationId)}. Clicks before this instant earn nothing.`,
          actor: null,
          source: 'tracking_links',
          id: `${link.id}:activated`,
        });
      }
      if (link.pausedAt) {
        drafts.push({
          category: 'campaign',
          at: link.pausedAt,
          title: 'Affiliate link paused',
          detail: link.pausedReason ?? `Paused${on(link.associationId)}.`,
          actor: link.pausedBy,
          source: 'tracking_links',
          id: `${link.id}:paused`,
        });
      }
    }

    const posts = await db
      .select()
      .from(creatorPostSubmissions)
      .where(inArray(creatorPostSubmissions.associationId, associationIds));
    for (const post of posts) {
      drafts.push({
        category: 'campaign',
        at: post.submittedAt,
        title: 'First post submitted',
        detail: `Public post submitted for verification${on(post.associationId)}.`,
        actor: post.submittedBy,
        source: 'creator_post_submissions',
        id: post.id,
      });
      if (post.verifiedAt) {
        drafts.push({
          category: 'evidence',
          at: post.verifiedAt,
          title: `First-post verification · ${post.status.replace(/_/g, ' ')}`,
          detail:
            post.correctionDetail ??
            post.enforcementReason ??
            'The seven §17 checks were recorded. First-post review releases $0.',
          actor: post.verifiedBy,
          source: 'creator_post_submissions',
          id: `${post.id}:verified`,
        });
      }
    }

    const kitAccess = await db
      .select()
      .from(campaignKitAccess)
      .where(inArray(campaignKitAccess.associationId, associationIds));
    for (const access of kitAccess) {
      drafts.push({
        category: 'evidence',
        at: access.occurredAt,
        title: 'Campaign kit opened',
        detail: `Read ${access.section.replace(/_/g, ' ')}${on(access.associationId)}. §31.5 requires every access to be logged.`,
        actor: access.affiliateUserId,
        source: 'campaign_kit_access',
        id: access.id,
      });
    }
  }

  /* ── evidence ──────────────────────────────────────────────────────────── */

  const [verified] = await db
    .select({
      verifiedAt: affiliateProspects.verifiedAt,
      verifiedBy: affiliateProspects.verifiedBy,
      status: affiliateProspects.verificationStatus,
    })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, scope.prospectId))
    .limit(1);
  if (verified?.verifiedAt) {
    drafts.push({
      category: 'evidence',
      at: verified.verifiedAt,
      title: 'Verification decision recorded',
      detail: `Recorded as ${verified.status.replace(/_/g, ' ')}. Verification is a human decision; nothing here verifies automatically.`,
      actor: verified.verifiedBy,
      source: 'affiliate_prospects',
      id: `${scope.prospectId}:verified`,
    });
  }

  /* ── money ─────────────────────────────────────────────────────────────── */

  if (associationIds.length > 0) {
    const earnings = await db
      .select()
      .from(creatorEarningsStateHistory)
      .where(inArray(creatorEarningsStateHistory.associationId, associationIds));
    for (const move of earnings) {
      drafts.push({
        category: 'money',
        at: move.occurredAt,
        title: `Earnings · ${move.toState.replace(/_/g, ' ')}`,
        detail:
          move.reason ??
          `Moved from ${move.fromState?.replace(/_/g, ' ') ?? 'no recorded state'}${on(move.associationId)}.`,
        actor: move.actor,
        source: 'creator_earnings_state_history',
        id: move.id,
      });
    }

    const transfers = await db
      .select()
      .from(affiliateTransfers)
      .where(inArray(affiliateTransfers.associationId, associationIds));
    for (const transfer of transfers) {
      drafts.push({
        category: 'money',
        at: transfer.requestedAt,
        title: `Affiliate Transfer · ${transfer.status}`,
        // The raw provider failure code stays on the record and off this line
        // (§25.6, §33.9.11): what an Admin needs here is that it failed.
        detail: `One Transfer per campaign relationship, under a stable idempotency key${on(transfer.associationId)}.`,
        actor: transfer.createdBy,
        source: 'affiliate_transfers',
        id: transfer.id,
      });
    }

    const allocations = await db
      .select()
      .from(creatorPaymentAllocations)
      .where(inArray(creatorPaymentAllocations.associationId, associationIds));
    for (const allocation of allocations) {
      if (allocation.fundedAt) {
        drafts.push({
          category: 'money',
          at: allocation.fundedAt,
          title: 'Upfront fee funded',
          detail: `Funded means the campaign-specific upfront fee was funded. It does not mean the Creator was paid.`,
          actor: null,
          source: 'creator_payment_allocations',
          id: `${allocation.id}:funded`,
        });
      }
      if (allocation.canceledAt) {
        drafts.push({
          category: 'money',
          at: allocation.canceledAt,
          title: 'Upfront fee allocation closed',
          detail: allocation.canceledReason ?? 'The allocation was closed.',
          actor: allocation.canceledBy,
          source: 'creator_payment_allocations',
          id: `${allocation.id}:canceled`,
        });
      }
    }
  }

  /*
   * The connected account's own events, keyed on the Stripe account id the
   * signup profile holds — not on the person. One human can hold a Founder
   * seller account and an Affiliate recipient account, and §24.1 keeps those
   * two roles apart; reading by user id would mix a Founder's onboarding into
   * a Creator's history.
   */
  const [payoutAccount] = await db
    .select({ connectedAccountId: affiliateSignupProfiles.connectedAccountId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, scope.prospectId))
    .limit(1);

  if (payoutAccount?.connectedAccountId) {
    const accountEvents = await db
      .select()
      .from(stripeAccountEvents)
      .where(eq(stripeAccountEvents.stripeAccountId, payoutAccount.connectedAccountId));
    for (const event of accountEvents) {
      drafts.push({
        category: 'money',
        at: event.occurredAt,
        title: 'Stripe account state changed',
        detail: `${event.event.replace(/_/g, ' ')} · Stripe owns this fact; Proovd stores its status.`,
        actor: event.actor,
        source: 'stripe_account_events',
        id: event.id,
      });
    }
  }

  /* ── policy ────────────────────────────────────────────────────────────── */

  if (associationIds.length > 0) {
    const enforcement = await db
      .select()
      .from(affiliateEnforcementActions)
      .where(inArray(affiliateEnforcementActions.associationId, associationIds));
    for (const action of enforcement) {
      drafts.push({
        category: 'policy',
        at: action.occurredAt,
        title: `Enforcement · ${action.actionKind.replace(/_/g, ' ')}`,
        detail: `${action.ruleViolated} — ${action.immediateEffect}`,
        actor: action.actor,
        source: 'affiliate_enforcement_actions',
        id: action.id,
      });
    }
    if (enforcement.length > 0) {
      const appeals = await db
        .select()
        .from(affiliateEnforcementAppeals)
        .where(
          inArray(
            affiliateEnforcementAppeals.actionId,
            enforcement.map((a) => a.id),
          ),
        );
      for (const appeal of appeals) {
        drafts.push({
          category: 'policy',
          at: appeal.decidedAt ?? appeal.submittedAt,
          title: appeal.decidedAt ? `Appeal ${appeal.decision}` : 'Appeal submitted',
          detail: appeal.decisionNote ?? appeal.grounds,
          actor: appeal.decidedBy,
          source: 'affiliate_enforcement_appeals',
          id: appeal.id,
        });
      }
    }
  }

  /* ── the audit trail, through the allowlist ────────────────────────────── */

  const targets = [scope.prospectId, ...associationIds];
  const audits = await db
    .select()
    .from(auditEvents)
    .where(
      or(
        inArray(auditEvents.targetId, targets),
        scope.claimedUserId ? eq(auditEvents.targetId, scope.claimedUserId) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(400);

  for (const audit of audits) {
    const title = creatorAuditTitle(audit.action);
    // Unmapped actions are skipped, never rendered raw (§3.1). This is the
    // allowlist the file header describes.
    if (!title) continue;
    drafts.push({
      category: categoryForAudit(audit.action),
      at: audit.occurredAt,
      title,
      detail: audit.customerExplanation ?? audit.internalReason ?? 'Recorded by an Admin.',
      actor: audit.actor,
      source: 'audit_events',
      id: audit.id,
    });
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  const names = await resolveActorNames(
    db,
    drafts.map((d) => d.actor),
  );

  return drafts
    .filter((draft): draft is Draft & { at: Date } => draft.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((draft) => ({
      category: draft.category,
      at: formatInstant(draft.at) ?? '',
      occurredAt: isoOf(draft.at) ?? '',
      title: draft.title,
      detail: draft.detail,
      actor: actorName(names, draft.actor) ?? 'System',
      source: draft.source,
      reference: `${draft.source}:${draft.id}`,
    }));
}

function categoryForAudit(action: string): CreatorHistoryCategory {
  if (action.includes('verification')) return 'evidence';
  if (action.includes('invitation') || action.includes('kit_access')) return 'campaign';
  return 'account';
}

/** Counts per chip, so a zero-count filter can be hidden without a scan. */
export function historyCountsOf(entries: readonly CreatorHistoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return counts;
}
