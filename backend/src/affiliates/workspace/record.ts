/**
 * One Affiliate, composed — Spec §26.1, §8, §5.3, §11, §13, §25.8.
 *
 * ── Provenance is the information model, not a decoration ───────────────────
 * The reference's central idea, and the one that makes this surface different
 * from a form: a field is not just a value, it is a value somebody is
 * responsible for. Three suppliers, three different rules:
 *
 *   Affiliate supplied   `affiliate_signup_profiles` — what the person
 *                        confirmed when they claimed the account. Corrected
 *                        through a route that records a reason, never silently
 *                        overwritten.
 *   Admin researched     `affiliate_prospects` — what Proovd found. The
 *                        Affiliate never typed it, and §11 lets them correct
 *                        the parts that prefill their signup.
 *   Stripe supplied      the connected account. Read-only everywhere: §13
 *                        makes Proovd the holder of a status and an id, never
 *                        of the data behind them.
 *
 * ── Nothing is copied ───────────────────────────────────────────────────────
 * Every value here is read from the record that already owns it. A workspace
 * that duplicated the payout state, the verification decision, or an earnings
 * figure onto an Affiliate row would be a second source of truth for something
 * somebody is paid, which is §26.8's timeline trap in a different phase.
 */

import { and, desc, eq, inArray, like, or } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  affiliateProspects,
  affiliateInvitationSends,
} from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import {
  affiliateAccessActions,
  affiliateDeletionRequests,
  affiliateDeletionReviews,
  affiliateEvidenceFiles,
  affiliateEvidenceVerifications,
} from '../../db/schema/creator-workspace.js';
import { policyConsents } from '../../db/schema/vetting.js';
import { policyVersions } from '../../db/schema/policies.js';
import {
  affiliateEnforcementActions,
  affiliateEnforcementAppeals,
  affiliateConflictDisclosures,
  affiliateSelfPreorderDisclosures,
} from '../../db/schema/enforcement.js';
import { campaignAffiliateAssociations, campaigns } from '../../db/schema/domain.js';
import { associationStatusHistory } from '../../db/schema/domain.js';
import {
  associationCompensationAgreements,
  proposalVersions,
  trackingLinks,
} from '../../db/schema/decisions.js';
import { stripeConnectedAccounts } from '../../db/schema/payments.js';
import { supportCases } from '../../db/schema/support.js';
import { notificationDeliveries } from '../../db/schema/integrity.js';
import { notificationDigestPreferences } from '../../db/schema/digest.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { founderClaimProfiles } from '../../db/schema/vetting.js';
import { formatInstant, resolveActorNames, actorName } from '../../founders/format.js';
import { missingEvidence, REQUIRED_EVIDENCE } from '../registry.js';
import { readCreatorHistory, historyCountsOf } from './history.js';
import { gatherCreatorFacts, deriveCreatorAttention } from './directory.js';
import type {
  CreatorHeader,
  CreatorInvitationView,
  CreatorMenuAction,
  CreatorProfilePane,
  CreatorRelationshipSummary,
  CreatorStandingPane,
  CreatorWorkspaceDetail,
  EvidenceItem,
  ProfileBlock,
  ProfileField,
  ProviderBlock,
  VerificationBlock,
} from './types.js';
import type { CreatorAccountState } from './labels.js';
import {
  ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  AFFILIATE_EVIDENCE_METRICS,
  SLOT_OCCUPYING_STATUSES,
  adminAssociationStatusLabel,
  campaignNameOf,
  campaignTypeLabel,
  channelUrlOf,
  deriveCreatorAccountState,
  evidenceCategoryLabel,
  initialsOf,
  payoutStateLabel,
  platformOf,
  rosterMembershipLabel,
  subtypeLabel,
  subtypeMetricLabel,
  verificationStateLabel,
  type AttentionOwner,
} from './labels.js';

/** Two words for absence, and the difference is load-bearing (see shared.tsx). */
const NOT_PROVIDED = 'Not provided yet';
const NOT_RESEARCHED = 'Not researched';
const NONE_RECORDED = 'None recorded';
const NOT_CLAIMED = 'Not claimed';

function field(
  key: string,
  label: string,
  value: string | null,
  options: { helper?: string; emptyLabel?: string; wide?: boolean } = {},
): ProfileField {
  return {
    key,
    label,
    value: value && value.trim() ? value : null,
    helper: options.helper ?? null,
    emptyLabel: options.emptyLabel ?? NOT_PROVIDED,
    ...(options.wide ? { wide: true } : {}),
  };
}

/* ── The whole detail ───────────────────────────────────────────────────────*/

export async function readCreatorWorkspace(
  db: Database,
  prospectId: string,
  options: {
    /**
     * Whether an evidence upload can be offered at all. The route passes the
     * storage port's own answer; absent (older callers, tests that do not
     * care) reads as unconfigured, which renders the honest Track A4 state
     * rather than a control that would fail (§1.4).
     */
    storageConfigured?: boolean;
  } = {},
): Promise<CreatorWorkspaceDetail | null> {
  const [prospect] = await db
    .select()
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, prospectId))
    .limit(1);
  if (!prospect) return null;

  const facts = (await gatherCreatorFacts(db, [prospectId])).get(prospectId)!;

  const [profile] = await db
    .select()
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, prospectId))
    .limit(1);

  const associationIds = facts.associations.map((a) => a.associationId);

  /* The §23.4 history rows that tell us when a relationship went live. */
  const activations =
    associationIds.length > 0
      ? await db
          .select({
            associationId: associationStatusHistory.associationId,
            toStatus: associationStatusHistory.toStatus,
            occurredAt: associationStatusHistory.occurredAt,
          })
          .from(associationStatusHistory)
          .where(
            and(
              inArray(associationStatusHistory.associationId, associationIds),
              eq(associationStatusHistory.toStatus, 'active'),
            ),
          )
          .orderBy(associationStatusHistory.occurredAt)
      : [];

  const activatedAt = new Map<string, Date>();
  for (const row of activations) {
    if (!activatedAt.has(row.associationId)) activatedAt.set(row.associationId, row.occurredAt);
  }

  /* Campaign facts the relationship rows render: the Founder and the close. */
  const campaignIds = [...new Set(facts.associations.map((a) => a.campaignId))];
  const campaignRows =
    campaignIds.length > 0
      ? await db
          .select({
            id: campaigns.id,
            type: campaigns.type,
            status: campaigns.status,
            closeAt: campaigns.campaignCloseAt,
            founderName: founderClaimProfiles.legalName,
            founderProduct: founderProspects.productName,
          })
          .from(campaigns)
          .leftJoin(founderClaimProfiles, eq(campaigns.id, founderClaimProfiles.campaignId))
          .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
          .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
          .where(inArray(campaigns.id, campaignIds))
      : [];
  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));

  /*
   * The three Selected-relationship facts (2026-08-17 rebuild): the agreement,
   * the link, and the completion answer, batched like everything else. Three
   * queries over the association ids, never a loop — and each label is decided
   * HERE, so the switcher, the Overview card, and Session C's fact card can
   * never disagree about what state a relationship is in.
   */
  const agreementRows =
    associationIds.length > 0
      ? await db
          .select({ associationId: associationCompensationAgreements.associationId })
          .from(associationCompensationAgreements)
          .where(inArray(associationCompensationAgreements.associationId, associationIds))
      : [];
  const hasAgreement = new Set(agreementRows.map((r) => r.associationId));

  const openProposalRows =
    associationIds.length > 0
      ? await db
          .select({ associationId: proposalVersions.associationId })
          .from(proposalVersions)
          .where(
            and(
              inArray(proposalVersions.associationId, associationIds),
              inArray(proposalVersions.state, ['awaiting_founder', 'awaiting_creator']),
            ),
          )
      : [];
  const hasOpenProposal = new Set(openProposalRows.map((r) => r.associationId));

  const linkRows =
    associationIds.length > 0
      ? await db
          .select({
            associationId: trackingLinks.associationId,
            active: trackingLinks.active,
            pausedAt: trackingLinks.pausedAt,
          })
          .from(trackingLinks)
          .where(inArray(trackingLinks.associationId, associationIds))
      : [];
  const linkByAssociation = new Map(linkRows.map((r) => [r.associationId, r]));

  const missing = prospect.subtype
    ? missingEvidence(
        prospect.subtype,
        prospect.verificationEvidence as Record<string, string> | null,
      )
    : [];

  const attention = deriveCreatorAttention(facts, {
    state: prospect.verificationStatus,
    missing,
  });

  const activeSlots = facts.associations.filter((a) =>
    SLOT_OCCUPYING_STATUSES.includes(a.status),
  ).length;

  const account = deriveCreatorAccountState({
    claimed: facts.claimed,
    latestAccessAction: facts.latestAccessAction,
    policyReacceptanceOpen: facts.policyReacceptanceOpen,
  });

  /*
   * The person's §26.7 cases (Session C). `support_cases` has no prospect
   * column and needs none: a case is anchored on the requester's account or
   * one of their associations, so the read matches both. Open work keeps the
   * queue's own membership rule (`status <> 'resolved'`), and each row carries
   * the Support-workspace address that operates it — this surface lists and
   * routes, never resolves.
   */
  const caseConditions = [
    ...(associationIds.length > 0 ? [inArray(supportCases.associationId, associationIds)] : []),
    ...(facts.claimedUserId ? [eq(supportCases.requesterUserId, facts.claimedUserId)] : []),
  ];
  const caseRows =
    caseConditions.length > 0
      ? await db
          .select({
            id: supportCases.id,
            reference: supportCases.reference,
            topic: supportCases.topic,
            subject: supportCases.subject,
            status: supportCases.status,
            createdAt: supportCases.createdAt,
          })
          .from(supportCases)
          .where(caseConditions.length === 1 ? caseConditions[0] : or(...caseConditions))
          .orderBy(desc(supportCases.createdAt))
          .limit(50)
      : [];
  const cases = caseRows.map((row) => ({
    id: row.id,
    reference: row.reference,
    topic: row.topic,
    subject: row.subject,
    status: row.status,
    open: row.status !== 'resolved',
    openedAt: formatInstant(row.createdAt),
    href: `/admin/support/${row.id}`,
  }));

  const header: CreatorHeader = {
    prospectId: prospect.id,
    initials: initialsOf(prospect.legalName, prospect.publicHandle),
    name: prospect.legalName ?? prospect.publicHandle ?? 'Unnamed prospect',
    handle: prospect.publicHandle,
    channelUrl: channelUrlOf(prospect.channelReference),
    platform: platformOf(prospect.channelReference),
    subtype: subtypeLabel(prospect.subtype),
    niche: prospect.audienceNiche,
    location: locationOf(profile),

    verification: {
      state: prospect.verificationStatus,
      label: verificationStateLabel(prospect.verificationStatus),
      at: formatInstant(prospect.verifiedAt),
      missing: [...missing],
    },
    slots: {
      used: activeSlots,
      limit: ACTIVE_PARTNERSHIP_SLOT_LIMIT,
      remaining: Math.max(0, ACTIVE_PARTNERSHIP_SLOT_LIMIT - activeSlots),
      atLimit: activeSlots >= ACTIVE_PARTNERSHIP_SLOT_LIMIT,
    },
    payout: {
      state: facts.claimed ? facts.payoutStatus : null,
      label: payoutStateLabel(facts.claimed ? facts.payoutStatus : null),
    },
    account,

    attention,

    openCases: cases.filter((entry) => entry.open).length,

    availableActions: availableActionsFor({
      account,
      verificationState: prospect.verificationStatus,
    }),
  };

  const relationships: CreatorRelationshipSummary[] = facts.associations.map((association) => {
    const campaign = campaignById.get(association.campaignId);
    const link = linkByAssociation.get(association.associationId);

    /*
     * The completion answer keeps §16a's rule: "not due yet" and "the campaign
     * closed and nobody has decided" are different facts, and only the second
     * asks anything of an Admin. Terminal §23.4 states answer for themselves.
     */
    const completion =
      association.status === 'successfully_completed'
        ? 'Successfully completed'
        : association.status === 'completion_disqualified'
          ? 'Completion disqualified'
          : campaign?.closeAt && campaign.closeAt.getTime() <= Date.now()
            ? 'Decision pending'
            : 'Not due before close';

    return {
      associationId: association.associationId,
      campaignId: association.campaignId,
      campaignName: association.campaignName,
      founderName: campaign?.founderName ?? campaign?.founderProduct ?? null,
      campaignType: campaignTypeLabel(association.campaignType),
      campaignTypeRaw: (association.campaignType as 'pre_build' | 'pre_launch' | null) ?? null,
      status: adminAssociationStatusLabel(association.status),
      statusRaw: association.status,
      designation: rosterMembershipLabel(association.rosterMembership),
      owner: relationshipOwner(association.status),
      activatedAt: formatInstant(activatedAt.get(association.associationId) ?? null),
      closesAt: formatInstant(campaign?.closeAt ?? null),
      holdsSlot: SLOT_OCCUPYING_STATUSES.includes(association.status),

      agreement: hasAgreement.has(association.associationId)
        ? 'Accepted'
        : hasOpenProposal.has(association.associationId)
          ? 'Proposal pending'
          : 'Not started',
      trackingLink: !link
        ? 'No Affiliate link yet'
        : link.pausedAt
          ? 'Affiliate link paused'
          : link.active
            ? 'Affiliate link active'
            : 'Affiliate link inactive',
      completion,
    };
  });

  const history = await readCreatorHistory(db, {
    prospectId,
    associationIds,
    campaignIds,
    claimedUserId: facts.claimedUserId,
  });

  const standing = {
    ...(await composeStanding(db, {
      prospectId,
      account,
      associationIds,
      associationCampaign: new Map(
        facts.associations.map((a) => [a.associationId, a.campaignName]),
      ),
      policyReacceptanceOpen: facts.policyReacceptanceOpen,
    })),
    cases,
  };

  /*
   * The person's delivery record (Session C). Phase 22c's arrangement: the
   * rows carry the §27 KEY and the label resolves in the browser from the
   * shared registry; the audience prefix keeps `internal_*` and every other
   * role's mail out of an Affiliate's list. Bounded and newest-first — the
   * full history surface is `/admin/notifications`.
   */
  const addresses = [
    ...new Set([profile?.email, prospect.email].filter((value): value is string => Boolean(value))),
  ];
  const communicationRows =
    addresses.length > 0
      ? await db
          .select()
          .from(notificationDeliveries)
          .where(
            and(
              inArray(notificationDeliveries.target, addresses),
              like(notificationDeliveries.eventKey, 'affiliate_%'),
            ),
          )
          .orderBy(desc(notificationDeliveries.createdAt))
          .limit(100)
      : [];
  const communications = communicationRows.map((row) => ({
    eventKey: row.eventKey,
    target: row.target,
    entityType: row.entityType,
    entityId: row.entityId,
    confirmed: row.notificationId !== null,
    at: formatInstant(row.createdAt),
    occurredAt: row.createdAt.toISOString(),
  }));

  const profilePane = await composeProfile(db, {
    prospect,
    profile: profile ?? null,
    facts,
    missing,
    associationIds,
    storageConfigured: options.storageConfigured ?? false,
    // The relationship rows the agreements block lists — the same composed
    // `agreement` label the switcher renders, so the two cannot disagree.
    relationshipAgreements: relationships.map((r) => ({
      associationId: r.associationId,
      campaignName: r.campaignName,
      state: r.agreement,
    })),
    /*
     * §29-derived proposal access (0048's header states the column's
     * absence). Restricted while a `restrict_bidding` or `demote` enforcement
     * record stands un-overturned; the record it derives from is named so the
     * badge is checkable from the payload.
     */
    proposalAccess: deriveProposalAccess(standing),
  });

  return {
    header,
    relationships,
    standing,
    profile: profilePane,
    history,
    historyCounts: historyCountsOf(history),
    communications,
  };
}

/**
 * §29's `restrict_bidding`/`demote`, read as the Standard/Restricted badge.
 *
 * An appeal decided `overturned` lifts the restriction it appealed; anything
 * else — no appeal, an open appeal, an upheld one — leaves it standing,
 * because a restriction under appeal is still a restriction (§29.4's action
 * takes effect when recorded, and the appeal is the recorded path out).
 */
function deriveProposalAccess(standing: CreatorStandingPane): {
  key: 'standard' | 'restricted';
  label: string;
  derivedFrom: string | null;
} {
  const restricting = standing.enforcement.find(
    (row) =>
      (row.actionKind === 'restrict_bidding' || row.actionKind === 'demote') &&
      row.appeal?.decision !== 'overturned',
  );
  if (!restricting) {
    return { key: 'standard', label: 'Standard proposal access', derivedFrom: null };
  }
  return {
    key: 'restricted',
    label: 'Proposal bidding restricted',
    derivedFrom: `${restricting.actionKind === 'demote' ? 'Demote' : 'Restrict bidding'} · ${restricting.campaignName} · ${restricting.at}`,
  };
}

/* ── The header's menu ──────────────────────────────────────────────────────*/

/**
 * Which actions this record's state actually permits.
 *
 * Decided by the SERVER and walked by the surface, never a client-side opinion
 * about what looks reasonable — the same arrangement `FounderHeader
 * .availableActions` uses, and for the same reason: a menu the browser composed
 * is a menu that will eventually offer something the route refuses.
 */
function availableActionsFor(state: {
  account: string;
  verificationState: string;
}): CreatorMenuAction[] {
  const actions: CreatorMenuAction[] = ['assign'];
  if (state.verificationState !== 'verified') actions.push('verify');
  if (state.account === 'Access suspended') actions.push('restore');
  else actions.push('suspend');
  actions.push('deletion');
  return actions;
}

/**
 * Who owns the next step on one relationship.
 *
 * Mapped from §23.4's state rather than stored, because the answer is a
 * property of where the relationship is. `System` is the honest answer for a
 * live partnership: nobody is blocked, the campaign is running.
 */
function relationshipOwner(status: string): AttentionOwner {
  switch (status) {
    case 'prospect':
    case 'formal_decision_open':
    case 'readiness_blocked':
      return 'Admin';
    case 'invited':
    case 'signup_started':
    case 'reviewing':
      return 'Affiliate';
    case 'signed_up_waiting_for_founder':
    case 'preparing':
    case 'proposal_pending':
      return 'Founder';
    default:
      return 'System';
  }
}

/* ── Profile & evidence ─────────────────────────────────────────────────────*/

function locationOf(
  profile: typeof affiliateSignupProfiles.$inferSelect | undefined,
): string | null {
  if (!profile) return null;
  const parts = [profile.country, profile.stateRegion].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * §5.3's eligibility representations, as one line.
 *
 * All five or a named gap — never a tick that means "some of them". §28.4
 * forbids bundling the confirmations at collection, and rendering them as one
 * word here would undo that at the point somebody reviews it.
 */
function representationsOf(
  profile: typeof affiliateSignupProfiles.$inferSelect | null,
): string | null {
  if (!profile) return null;
  const confirmations: { label: string; value: boolean }[] = [
    { label: '18+', value: profile.confirmAge18Plus },
    { label: 'US participant', value: profile.confirmUsBased },
    { label: 'actual operator', value: profile.confirmActualOperator },
    { label: 'no duplicate account', value: profile.confirmNoDuplicateAccounts },
    { label: 'sanctions eligible', value: profile.confirmSanctionsEligible },
  ];
  const outstanding = confirmations.filter((c) => !c.value);
  if (outstanding.length === 0) return confirmations.map((c) => c.label).join(' · ');
  return `Outstanding: ${outstanding.map((c) => c.label).join(' · ')}`;
}

async function composeProfile(
  db: Database,
  input: {
    prospect: typeof affiliateProspects.$inferSelect;
    profile: typeof affiliateSignupProfiles.$inferSelect | null;
    facts: Awaited<ReturnType<typeof gatherCreatorFacts>> extends Map<string, infer T>
      ? T
      : never;
    missing: readonly string[];
    associationIds: readonly string[];
    storageConfigured: boolean;
    relationshipAgreements: { associationId: string; campaignName: string; state: string }[];
    proposalAccess: CreatorProfilePane['proposalAccess'];
  },
): Promise<CreatorProfilePane> {
  const { prospect, profile, facts, missing, associationIds } = input;

  /* ── Account details — what the Affiliate confirmed ───────────────────────*/
  const accountBlock: ProfileBlock = {
    provenance: 'affiliate',
    title: 'Account details',
    fields: [
      field('name', 'Name', profile?.legalName ?? prospect.legalName),
      field('username', 'Username', profile?.publicHandle ?? prospect.publicHandle),
      field('email', 'Email', profile?.email ?? prospect.email),
      field(
        'phone',
        'Phone number',
        (profile?.phone ?? prospect.phone) ? `${profile?.phone ?? prospect.phone} · unverified` : null,
        {
          helper: 'Collected, never verified. The MVP has no way to verify a phone number.',
          emptyLabel: 'Not supplied',
        },
      ),
      field('location', 'Location', locationOf(profile ?? undefined), {
        emptyLabel: NOT_CLAIMED,
      }),
      field(
        'dob',
        'Date of birth / age',
        profile?.dateOfBirth ? 'Restricted field · 18+ confirmed' : null,
        { emptyLabel: NOT_CLAIMED },
      ),
      field('representations', 'Eligibility representations', representationsOf(profile), {
        wide: true,
        emptyLabel: NOT_CLAIMED,
      }),
      field('claimed', 'Account claimed', formatInstant(profile?.claimedAt ?? prospect.claimedAt), {
        emptyLabel: NOT_CLAIMED,
      }),
    ],
  };

  /* ── Channel details — what Proovd researched ─────────────────────────────*/
  const researchBlock: ProfileBlock = {
    provenance: 'admin',
    title: 'Channel details',
    fields: [
      field('researchedHandle', 'Researched username', prospect.publicHandle, {
        emptyLabel: NOT_RESEARCHED,
      }),
      field('subtype', 'Channel subtype', subtypeLabel(prospect.subtype), {
        emptyLabel: NOT_RESEARCHED,
      }),
      field('niche', 'Niche', prospect.audienceNiche, { emptyLabel: NOT_RESEARCHED }),
      field('tier', 'Internal quality tier', prospect.qualityTier, {
        helper:
          'Assessment data only. §8 makes this explicitly not a commission floor, and nothing in the product reads it to decide a percentage.',
        emptyLabel: NONE_RECORDED,
      }),
      field('source', 'Recruitment source', prospect.recruitmentSource, {
        emptyLabel: NOT_RESEARCHED,
      }),
      field('audienceSize', 'Audience size', prospect.audienceSize, {
        emptyLabel: NOT_RESEARCHED,
      }),
      field('bio', 'Admin bio', prospect.adminBio, { wide: true, emptyLabel: NOT_RESEARCHED }),
      field('demographics', 'Audience demographics', prospect.audienceDemographics, {
        wide: true,
        emptyLabel: NOT_RESEARCHED,
      }),
      field('permission', 'Channel ownership / permission', prospect.permissionBasis, {
        wide: true,
        emptyLabel: NOT_RESEARCHED,
      }),
      field('sponsored', 'Sponsored-content history', prospect.priorSponsoredContent, {
        wide: true,
        emptyLabel: 'No available history',
      }),
      field('fit', 'Campaign fit', prospect.campaignFit, {
        wide: true,
        emptyLabel: NOT_RESEARCHED,
      }),
      field('conflicts', 'Conflicts', prospect.conflictNotes, { emptyLabel: NONE_RECORDED }),
      field('sanctions', 'Sanctions research', prospect.sanctionsNotes, {
        emptyLabel: NONE_RECORDED,
      }),
      field('notes', 'Internal notes', prospect.internalComments, {
        wide: true,
        emptyLabel: NONE_RECORDED,
      }),
    ],
  };

  /* ── Audience verification — evidence, and the decision about it ──────────*/
  const recorded = (prospect.verificationEvidence as Record<string, string> | null) ?? {};
  const requiredIds: readonly string[] = prospect.subtype
    ? (REQUIRED_EVIDENCE[prospect.subtype] ?? [])
    : [];
  const evidenceIds = [...new Set([...requiredIds, ...Object.keys(recorded)])];

  const evidence: EvidenceItem[] = evidenceIds.map((id) => ({
    id,
    label: evidenceLabel(id),
    basis: requiredIds.includes(id) ? '§5.3 required for this subtype' : 'Additional evidence',
    value: typeof recorded[id] === 'string' && recorded[id]!.trim() ? recorded[id]! : null,
    required: requiredIds.includes(id),
  }));

  const engagement = (prospect.engagementEvidence as Record<string, string> | null) ?? {};

  const verification: VerificationBlock = {
    state: prospect.verificationStatus,
    label: verificationStateLabel(prospect.verificationStatus),
    at: formatInstant(prospect.verifiedAt),
    by: prospect.verifiedBy,
    metricLabel: subtypeMetricLabel(prospect.subtype),
    metrics: [
      field('audienceSize', 'Audience size', prospect.audienceSize, {
        emptyLabel: 'Evidence needed',
      }),
      field(
        'engagement',
        subtypeMetricLabel(prospect.subtype),
        Object.values(engagement).find((v) => typeof v === 'string' && v.trim()) ?? null,
        { emptyLabel: 'Evidence needed' },
      ),
      field('demographics', 'Demographics', prospect.audienceDemographics, {
        emptyLabel: 'Evidence needed',
      }),
      field('permission', 'Ownership / permission', prospect.permissionBasis, {
        emptyLabel: 'Evidence needed',
      }),
      field('sponsored', 'Sponsored history / plan', prospect.priorSponsoredContent, {
        emptyLabel: 'Evidence needed',
      }),
    ],
    evidence,
    missing: [...missing],
  };

  /* ── Evidence pictures, and the per-metric trail (Session B, 0048) ────────*/

  const fileRows = await db
    .select()
    .from(affiliateEvidenceFiles)
    .where(eq(affiliateEvidenceFiles.prospectId, prospect.id))
    .orderBy(desc(affiliateEvidenceFiles.uploadedAt));

  const evidenceFiles = {
    available: input.storageConfigured,
    waitingOn: input.storageConfigured
      ? null
      : 'Evidence uploads are not available on this deployment yet — the object-storage bucket is Track A4. Files already on the record still render.',
    files: fileRows
      .filter((row) => row.removedAt === null)
      .map((row) => ({
        id: row.id,
        category: row.category,
        categoryLabel: evidenceCategoryLabel(row.category),
        filename: row.originalFilename,
        state: row.state,
        rejection: row.rejection,
        dimensions: row.width && row.height ? `${row.width} × ${row.height}` : null,
        uploadedBy: row.uploadedBy,
        uploadedAt: formatInstant(row.uploadedAt),
      })),
  };

  const decisionRows = await db
    .select()
    .from(affiliateEvidenceVerifications)
    .where(eq(affiliateEvidenceVerifications.prospectId, prospect.id))
    .orderBy(desc(affiliateEvidenceVerifications.decidedAt));

  // One row per metric in register order, latest decision or its honest
  // absence — a metric nobody has decided renders as exactly that (§16a).
  const metricDecisions = AFFILIATE_EVIDENCE_METRICS.map((metric) => {
    const latest = decisionRows.find((row) => row.metric === metric.key);
    return {
      metric: metric.key,
      label: metric.label,
      decision: latest?.decision ?? null,
      detail: latest?.detail ?? null,
      decidedBy: latest?.decidedBy ?? null,
      decidedAt: formatInstant(latest?.decidedAt ?? null),
    };
  });

  /* ── The agreements block (§10, §29.8, §31.5) ─────────────────────────────*/

  const consentRows = facts.claimedUserId
    ? await db
        .select({ slug: policyConsents.slug, version: policyConsents.version })
        .from(policyConsents)
        .where(
          and(
            eq(policyConsents.subjectType, 'user'),
            eq(policyConsents.subjectId, facts.claimedUserId),
          ),
        )
        .orderBy(desc(policyConsents.acceptedAt))
    : [];

  const latestConsent = (slug: string): string | null =>
    consentRows.find((row) => row.slug === slug)?.version ?? null;

  const publishedRows = await db
    .select({
      slug: policyVersions.slug,
      version: policyVersions.version,
      title: policyVersions.title,
    })
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.status, 'published'),
        inArray(policyVersions.slug, ['terms', 'affiliate-aup']),
      ),
    );

  const agreements = {
    terms: latestConsent('terms'),
    aup: latestConsent('affiliate-aup'),
    policyState: !facts.claimed
      ? 'not_claimed'
      : facts.policyReacceptanceOpen
        ? 'reacceptance_required'
        : 'accepted',
    publishedVersions: publishedRows,
    perCampaign: input.relationshipAgreements,
  };

  /* ── Stripe — read only, from the stored record ───────────────────────────*/
  const provider = await composeProvider(db, facts);

  /* ── Invitations, one per relationship (§11) ──────────────────────────────*/
  const invitations = await composeInvitations(db, associationIds);

  /* ── Recovery, notifications, retention ───────────────────────────────────*/
  const digest = facts.claimedUserId
    ? (
        await db
          .select({ frequency: notificationDigestPreferences.frequency })
          .from(notificationDigestPreferences)
          .where(eq(notificationDigestPreferences.userId, facts.claimedUserId))
          .limit(1)
      )[0]
    : undefined;

  const [deletionRequest] = await db
    .select()
    .from(affiliateDeletionRequests)
    .where(eq(affiliateDeletionRequests.prospectId, prospect.id))
    .orderBy(desc(affiliateDeletionRequests.requestedAt))
    .limit(1);

  const reviews = deletionRequest
    ? await db
        .select()
        .from(affiliateDeletionReviews)
        .where(eq(affiliateDeletionReviews.requestId, deletionRequest.id))
        .orderBy(desc(affiliateDeletionReviews.occurredAt))
    : [];

  const reviewNames = await resolveActorNames(
    db,
    reviews.map((r) => r.actor),
  );

  const support: ProfileField[] = [
    field('recovery', 'Password recovery', 'Email-link recovery · transactional', {
      helper:
        '§5.5 makes the reset an ask the person makes, and the answer is identical whether or not the address exists.',
    }),
    field('notifications', 'Notification history', 'Durable · transactional messages cannot be opted out'),
    field(
      'digest',
      'Eligible digest',
      digest ? `Chosen: ${digest.frequency}` : 'Not chosen yet',
      {
        helper:
          'Only the Affiliate can set this. Proovd never chooses a summary frequency on someone’s behalf.',
      },
    ),
    field(
      'deletion',
      'Deletion request',
      deletionRequest ? 'Retention review open' : null,
      { emptyLabel: 'None' },
    ),
    field(
      'retention',
      'Retention',
      'Account, tax and status records · account life plus seven years',
      { wide: true },
    ),
  ];

  return {
    summary: {
      handle: prospect.publicHandle,
      channelUrl: channelUrlOf(prospect.channelReference),
      platform: platformOf(prospect.channelReference),
    },
    blocks: [accountBlock, researchBlock],
    verification,
    evidenceFiles,
    metricDecisions,
    proposalAccess: input.proposalAccess,
    agreements,
    provider,
    invitations,
    support,
    deletionRequest: deletionRequest
      ? {
          id: deletionRequest.id,
          detail: deletionRequest.requestDetail,
          requestedAt: formatInstant(deletionRequest.requestedAt) ?? '',
          receivedVia: deletionRequest.receivedVia,
          reviews: reviews.map((review) => ({
            note: review.note,
            actor: actorName(reviewNames, review.actor) ?? review.actor,
            at: formatInstant(review.occurredAt) ?? '',
          })),
        }
      : null,
  };
}

/**
 * A §5.3 evidence input id, in words.
 *
 * The ids are the shared register's and are stable; the labels are derived
 * from them rather than restated, because a second hand-written list of ~25
 * strings is a list that drifts. An id that reads badly as a sentence is
 * better than a label that is wrong about which input it names.
 */
function evidenceLabel(id: string): string {
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function composeProvider(
  db: Database,
  facts: { claimedUserId: string | null; connectedAccountId: string | null; payoutStatus: string | null },
): Promise<ProviderBlock> {
  if (!facts.connectedAccountId) {
    return {
      populated: false,
      waitingOn: facts.claimedUserId
        ? 'The Affiliate has not started payout onboarding with Stripe.'
        : 'Nobody has claimed this account yet, so there is no connected account.',
      accountId: null,
      state: null,
      label: payoutStateLabel(null),
      transferCapability: 'Not available yet',
      requirements: [],
      requirementsLabel: 'Not applicable yet',
      lastUpdated: null,
    };
  }

  const [account] = await db
    .select()
    .from(stripeConnectedAccounts)
    .where(eq(stripeConnectedAccounts.stripeAccountId, facts.connectedAccountId))
    .limit(1);

  const requirements = Array.isArray(account?.requirementsCurrentlyDue)
    ? (account.requirementsCurrentlyDue as unknown[]).filter(
        (r): r is string => typeof r === 'string',
      )
    : [];

  return {
    populated: true,
    waitingOn: null,
    accountId: facts.connectedAccountId,
    state: facts.payoutStatus,
    label: payoutStateLabel(facts.payoutStatus),
    transferCapability: account?.payoutsEnabled ? 'Active' : 'Blocked',
    requirements,
    requirementsLabel:
      requirements.length > 0
        ? `${requirements.length} outstanding`
        : facts.payoutStatus === 'complete'
          ? 'None due'
          : 'Provider review',
    lastUpdated: formatInstant(account?.updatedAt ?? null),
  };
}

/**
 * The invitation, per relationship.
 *
 * §11: "The Affiliate remains tied to the one campaign that caused the
 * invitation." One Creator recruited to two campaigns has TWO invitations, and
 * collapsing them into a single "invitation state" would misreport both.
 *
 * The raw token appears nowhere (§28.1). What an Admin sees is that a live link
 * exists, when it was last sent, and by whom.
 */
async function composeInvitations(
  db: Database,
  associationIds: readonly string[],
): Promise<CreatorInvitationView[]> {
  if (associationIds.length === 0) return [];

  const associations = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      campaignId: campaignAffiliateAssociations.campaignId,
      campaignTitle: campaignBuild.title,
      campaignProduct: founderProspects.productName,
      // §8's invitation names the Founder as well as the product, and both come
      // from the Founder's record rather than from anything on this screen.
      founderPreferredName: founderProspects.preferredName,
      founderLegalName: founderProspects.legalName,
      invitationStatus: campaignAffiliateAssociations.invitationStatus,
      whyRecruited: campaignAffiliateAssociations.whyRecruited,
      reviewedPresence: campaignAffiliateAssociations.reviewedPresence,
      senderName: campaignAffiliateAssociations.senderName,
      senderEmail: campaignAffiliateAssociations.senderEmail,
      recruitedAt: campaignAffiliateAssociations.recruitedAt,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    .where(inArray(campaignAffiliateAssociations.id, [...associationIds]));

  const sends = await db
    .select()
    .from(affiliateInvitationSends)
    .where(inArray(affiliateInvitationSends.associationId, [...associationIds]))
    .orderBy(desc(affiliateInvitationSends.sentAt));

  /* The lifecycle-modal facts (Session B): when signup started, read from the
   * §23.4 history rather than re-derived, and when the claim landed, read from
   * the signup profile — the record the claim wrote. */
  const signupStartedRows = await db
    .select({
      associationId: associationStatusHistory.associationId,
      occurredAt: associationStatusHistory.occurredAt,
    })
    .from(associationStatusHistory)
    .where(
      and(
        inArray(associationStatusHistory.associationId, [...associationIds]),
        eq(associationStatusHistory.toStatus, 'signup_started'),
      ),
    )
    .orderBy(associationStatusHistory.occurredAt);
  const signupStartedAt = new Map<string, Date>();
  for (const row of signupStartedRows) {
    if (!signupStartedAt.has(row.associationId)) signupStartedAt.set(row.associationId, row.occurredAt);
  }

  const profileRows = await db
    .select({
      associationId: affiliateSignupProfiles.associationId,
      claimedAt: affiliateSignupProfiles.claimedAt,
    })
    .from(affiliateSignupProfiles)
    .where(inArray(affiliateSignupProfiles.associationId, [...associationIds]));
  const claimedAtByAssociation = new Map(
    profileRows.map((row) => [row.associationId, row.claimedAt]),
  );

  const names = await resolveActorNames(
    db,
    sends.map((s) => s.sentBy),
  );

  return associations.map((association) => {
    const mine = sends.filter((s) => s.associationId === association.associationId);
    const latest = mine[0];

    /*
     * Why §8's preview gate would refuse right now — a HINT, and it says so.
     *
     * The gate is `previewAffiliateInvitation`, which scans the RENDERED
     * message for markers; this is an input check computed early so the surface
     * can say why a control is unavailable before it is pressed (§1.1: a
     * disabled button is not authorization). The comment here used to claim it
     * was "the same list", and it was not — it tested the four association
     * columns the compose dialog owns and nothing else, so `canSend` came back
     * true while the gate refused on `[PRODUCT NAME]`, which is not a value any
     * control on this screen can write.
     *
     * The last two entries are the ones that made it a lie. §8 lets recruitment
     * start "before, during, or after Founder onboarding", and the Founder
     * route does not require a product name, so a Creator can be fully composed
     * against a campaign whose Founder record cannot yet name what it is for.
     * They name where the value lives, because the answer is not on this
     * screen — reporting an unfixable blocker without saying that is the dead
     * end this is fixing.
     */
    const unresolved: string[] = [];
    if (!association.whyRecruited) unresolved.push('Why this Creator was recruited');
    if (!association.reviewedPresence) unresolved.push('What was reviewed');
    if (!association.senderName) unresolved.push('Sender name');
    if (!association.senderEmail) unresolved.push('Sender email');
    if (!association.campaignProduct) {
      unresolved.push('The product name, on the Founder’s record');
    }
    if (!association.founderPreferredName && !association.founderLegalName) {
      unresolved.push('The Founder’s name, on the Founder’s record');
    }

    return {
      associationId: association.associationId,
      campaignId: association.campaignId,
      campaignName: campaignNameOf(association.campaignTitle, association.campaignProduct),
      state: association.invitationStatus,
      stateLabel: invitationStateLabel(association.invitationStatus),
      lastSentAt: formatInstant(latest?.sentAt ?? null),
      hasLiveToken: association.invitationStatus === 'sent',
      claimedAt: formatInstant(claimedAtByAssociation.get(association.associationId) ?? null),
      createdAt: formatInstant(association.recruitedAt),
      signupStartedAt: formatInstant(signupStartedAt.get(association.associationId) ?? null),
      tokenExpiresAt: formatInstant(latest?.tokenExpiresAt ?? null),
      sends: mine.map((send) => ({
        at: formatInstant(send.sentAt) ?? '',
        by: actorName(names, send.sentBy) ?? send.senderName,
        to: send.recipientEmail ?? 'Recipient removed by the retention sweep',
        status: send.status,
        // A send row exists before the provider call and is confirmed after —
        // NULL is a state ("recorded, not confirmed delivered"), not an error.
        confirmed: send.notificationId !== null,
      })),
      unresolved,
      canSend: unresolved.length === 0,
    };
  });
}

const INVITATION_STATE_LABELS: Record<string, string> = {
  draft: 'Prepared, not sent',
  sent: 'Sent',
  revoked: 'Revoked',
  claimed: 'Claimed',
  expired: 'Expired',
};

function invitationStateLabel(state: string): string {
  return INVITATION_STATE_LABELS[state] ?? state;
}

/* ── Policy, cases, and access (§26.7, §29) ────────────────────────────────*/

/**
 * What is open against this person, and what standing they hold.
 *
 * Two scopes side by side and never merged: an ACCOUNT suspension is a
 * reversible review of the person; a §29 enforcement action is against ONE
 * campaign relationship and carries its own five customer-facing statement
 * fields and a five-business-day appeal window. Reading them into one list
 * would let a link pause and a termination look like the same kind of thing.
 */
async function composeStanding(
  db: Database,
  input: {
    prospectId: string;
    account: CreatorAccountState;
    associationIds: readonly string[];
    associationCampaign: ReadonlyMap<string, string>;
    policyReacceptanceOpen: boolean;
  },
  // The cases list is composed in the main body (it also feeds the header's
  // Support-tab badge), so this returns everything else.
): Promise<Omit<CreatorStandingPane, 'cases'>> {
  const accessRows = await db
    .select()
    .from(affiliateAccessActions)
    .where(eq(affiliateAccessActions.prospectId, input.prospectId))
    .orderBy(desc(affiliateAccessActions.occurredAt));

  const ids = [...input.associationIds];

  const enforcementRows = ids.length
    ? await db
        .select()
        .from(affiliateEnforcementActions)
        .where(inArray(affiliateEnforcementActions.associationId, ids))
        .orderBy(desc(affiliateEnforcementActions.occurredAt))
    : [];

  const appeals = enforcementRows.length
    ? await db
        .select()
        .from(affiliateEnforcementAppeals)
        .where(
          inArray(
            affiliateEnforcementAppeals.actionId,
            enforcementRows.map((row) => row.id),
          ),
        )
    : [];

  const conflicts = ids.length
    ? await db
        .select()
        .from(affiliateConflictDisclosures)
        .where(inArray(affiliateConflictDisclosures.associationId, ids))
    : [];

  const selfPreorders = ids.length
    ? await db
        .select()
        .from(affiliateSelfPreorderDisclosures)
        .where(inArray(affiliateSelfPreorderDisclosures.associationId, ids))
    : [];

  const names = await resolveActorNames(db, [
    ...accessRows.map((row) => row.actor),
    ...enforcementRows.map((row) => row.actor),
  ]);

  const campaignFor = (associationId: string): string =>
    input.associationCampaign.get(associationId) ?? 'Unknown campaign';

  const latest = accessRows[0];

  return {
    account: {
      state: input.account,
      latest: latest
        ? {
            action: latest.action,
            reason: latest.reason,
            evidence: latest.evidence,
            reviewOwner: latest.reviewOwner,
            nextReviewAt: formatInstant(latest.nextReviewAt),
            actor: actorName(names, latest.actor) ?? latest.actor,
            at: formatInstant(latest.occurredAt) ?? '',
          }
        : null,
      history: accessRows.map((row) => ({
        action: row.action,
        reason: row.reason,
        actor: actorName(names, row.actor) ?? row.actor,
        at: formatInstant(row.occurredAt) ?? '',
      })),
    },
    enforcement: enforcementRows.map((row) => {
      const appeal = appeals.find((entry) => entry.actionId === row.id);
      return {
        id: row.id,
        associationId: row.associationId,
        campaignName: campaignFor(row.associationId),
        actionKind: row.actionKind,
        reasonCategory: row.reasonCategory,
        // The five §29 fields, as recorded. A record with no row shape for them
        // cannot exist — the CHECK refuses it — so they are never absent here.
        statement: {
          evidenceAndBehavior: row.evidenceAndBehavior,
          ruleViolated: row.ruleViolated,
          immediateEffect: row.immediateEffect,
          correctionPath: row.correctionPath,
          humanRoute: row.humanRoute,
        },
        appealDueAt: formatInstant(row.appealDueAt),
        appeal: appeal
          ? {
              id: appeal.id,
              grounds: appeal.grounds,
              decision: appeal.decision,
              decidedAt: formatInstant(appeal.decidedAt),
            }
          : null,
        at: formatInstant(row.occurredAt) ?? '',
      };
    }),
    disclosures: [
      ...conflicts.map((row) => ({
        kind: 'conflict' as const,
        associationId: row.associationId,
        campaignName: campaignFor(row.associationId),
        detail: `${row.relationshipKind} — ${row.detail}`,
        at: formatInstant(row.occurredAt) ?? '',
      })),
      ...selfPreorders.map((row) => ({
        kind: 'self_preorder' as const,
        associationId: row.associationId,
        campaignName: campaignFor(row.associationId),
        detail: row.intentNote,
        at: formatInstant(row.occurredAt) ?? '',
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    policyReacceptanceOpen: input.policyReacceptanceOpen,
  };
}
