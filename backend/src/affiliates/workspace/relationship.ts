/**
 * One campaign relationship, composed — Spec §14, §15, §16, §17, §18, §22.1,
 * §24.4, §24.7, §26.1, §31.5.
 *
 * Four panes in one read, because the reference's rail is four views of one
 * object rather than four pages: an Admin opening Money has already decided
 * something on Overview, and a second round trip per tab is a second chance for
 * the two to disagree about what state the relationship is in.
 *
 * ── Everything is READ ───────────────────────────────────────────────────────
 * The terms are `proposal_versions` + `association_compensation_agreements`;
 * the link is `tracking_links`; readiness is §16's own thirteen-item
 * derivation; the post is `creator_post_submissions`; the money is
 * `creator_earnings` + `affiliate_transfers` + `creator_payment_allocations`;
 * the traffic is `tracking_link_clicks` and the attribution columns on
 * `reservations`. Nothing is copied onto the association, and nothing is
 * recomputed here that a service already computes — a second implementation of
 * the earned percentage would be a second answer to what somebody is paid.
 *
 * ── §24.7's fourth stream, named as §3.2 requires ───────────────────────────
 * The supplied reference calls this an "fixed Creator payment". §3.2 bans that phrase
 * universally and §33.11.3 scans the shipped bundle for it, so the two rules
 * are exact inverses and §1.8 decides: the Spec wins. What ships is §3.2's own
 * replacement, which is also §24.7's name for the record. `Funded` does not
 * mean paid, and the pane says so — which is what the reference was protecting.
 *
 * ── §16a's rule, everywhere ──────────────────────────────────────────────────
 * A pane whose phase has not run says what it is waiting for rather than
 * rendering a zero. `estimated` earnings before close are not US$0.00; they are
 * a number nobody has finalized.
 */

import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { campaignAffiliateAssociations, campaigns, reservations } from '../../db/schema/domain.js';
import { associationStatusHistory } from '../../db/schema/domain.js';
import { campaignBuild } from '../../db/schema/build.js';
import { campaignDrafts, founderProspects } from '../../db/schema/invitations.js';
import { founderClaimProfiles } from '../../db/schema/vetting.js';
import {
  proposalVersions,
  associationCompensationAgreements,
  trackingLinks,
  creatorBonuses,
  responseDeadlineEvaluations,
} from '../../db/schema/decisions.js';
import { creatorPostSubmissions, requiredCreatorFailures } from '../../db/schema/launch.js';
import { associationReadiness } from '../../db/schema/build.js';
import { creatorPaymentAllocations } from '../../db/schema/creator-payment.js';
import {
  creatorEarnings,
  creatorEarningsStateHistory,
  affiliateTransfers,
  creatorCompletionDecisions,
} from '../../db/schema/earnings.js';
import { trackingLinkClicks } from '../../db/schema/attribution.js';
import { campaignKitAccess } from '../../db/schema/affiliates.js';
import {
  associationDeliverables,
  associationDeliverableEvidence,
  associationDeliverableDecisions,
  associationAvailabilityVerifications,
  proposalMediationNotes,
  associationTerminationRequests,
} from '../../db/schema/creator-workspace.js';
import { midCampaignAdditions } from '../../db/schema/live-editing.js';
import { workAgainRequests } from '../../db/schema/completion.js';
import { campaignAssets } from '../../db/schema/workspace.js';
import { CREATOR_OBLIGATIONS } from '../obligations.js';
import { findRefundCause } from '../../refunds/logic.js';
import { formatInstant } from '../../founders/format.js';
import { gatherCreatorReadiness } from '../../creator-payment/readiness.js';
import { deriveCreatorReadiness, READINESS_ITEMS } from '../../creator-payment/logic.js';
import type { StripeModeValue } from '../../payments/stripe-client.js';
import {
  adminAssociationStatusLabel,
  affiliateTreatmentLabel,
  campaignNameOf,
  campaignTypeLabel,
  deliverableStateLabel,
  rosterMembershipLabel,
  type AttentionOwner,
} from './labels.js';

/**
 * `US$1,430.00` from integer cents.
 *
 * The backend has no shared formatter — `shared/money/format.ts` exists but the
 * backend cannot import it at runtime, and every existing caller inlines the
 * same expression. One helper here rather than a fifth copy of it, and the
 * output matches what the §27 templates already send so a number on this
 * surface and the same number in an inbox read identically.
 */
function usd(cents: bigint | number | string | null | undefined): string {
  const value = cents === null || cents === undefined ? 0n : BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}US$${whole}.${fraction}`;
}

/* ── The contract ───────────────────────────────────────────────────────────*/

/** A block that may have no data yet, and says what it is waiting for. */
export interface RelationshipSection<T> {
  populated: boolean;
  waitingOn: string | null;
  value: T | null;
}

/** One thing that needs doing, or one thing that is being waited on. */
export interface RelationshipTask {
  kind: 'task' | 'waiting';
  owner: AttentionOwner;
  title: string;
  meta: string;
  /** The pane the surface should offer, when Proovd owns the next step. */
  action: { label: string; to: 'review' | 'agreement' | 'money' | 'profile' } | null;
}

export interface RelationshipBand {
  campaignName: string;
  campaignType: string | null;
  founderName: string | null;
  status: string;
  statusRaw: string;
  owner: AttentionOwner;
  designation: string;
  activatedAt: string | null;
  closesAt: string | null;
  /** §14.6's one fixed window, when a decision is still open on it. */
  responseDeadlineAt: string | null;
}

export interface OverviewPane {
  tasks: RelationshipTask[];
  link: {
    state: 'inactive' | 'active' | 'paused';
    label: string;
    url: string | null;
    code: string | null;
    activatedAt: string | null;
    pausedAt: string | null;
    pausedReason: string | null;
    /** §14.1's safe test, appended by the shared marker name. */
    testUrl: string | null;
  } | null;
  readiness: {
    complete: number;
    applicable: number;
    canBeginWork: boolean;
    items: { key: string; label: string; owner: string; complete: boolean; applicable: boolean }[];
  } | null;
  kit: {
    revealedAt: string | null;
    revokedAt: string | null;
    revokedReason: string | null;
    accessCount: number;
    lastAccessAt: string | null;
  };
}

export interface AgreementPane {
  /** The lock-state eyebrow the reference leads with. */
  lockState: string;
  /** `30%` and the rest, split so the surface can render the token large. */
  headlinePercent: string | null;
  headlineRest: string;
  bonus: string | null;
  versions: {
    id: string;
    number: number;
    proposedBy: string;
    totalPercent: number | null;
    fixedPaymentCents: string | null;
    state: string;
    affiliateDecision: string | null;
    founderDecision: string | null;
    createdAt: string | null;
    lockedAt: string | null;
  }[];
  agreement: {
    basePercent: number;
    bidIncreasePercent: number;
    totalPercent: number;
    fixedPayment: string | null;
    acceptedAt: string | null;
  } | null;
  /** §24.7's own stream. §3.2 names it; see the file header for the conflict. */
  fixedPayment: {
    available: boolean;
    rule: string;
    status: string;
    amount: string | null;
    source: string;
    fundedAt: string | null;
    deadlineAt: string | null;
  };
}

export interface ContentPane {
  submission: {
    /** The record the §17 verification route is addressed to. */
    id: string;
    version: number;
    url: string;
    status: string;
    statusLabel: string;
    submittedAt: string | null;
    verifiedAt: string | null;
    verifiedBy: string | null;
    correctionDetail: string | null;
    correctionDueAt: string | null;
    enforcementReason: string | null;
    checklist: { id: string; label: string; passed: boolean }[] | null;
  } | null;
  history: { version: number; url: string; status: string; submittedAt: string | null }[];
  /**
   * §29.6: whether this Creator was required for launch, and what has been
   * recorded if they did not post.
   *
   * `required` is read from §15's roster decision, not inferred from the
   * association's state — a Creator can be active and not required, and
   * offering a failure control against one would be offering to start a
   * replacement clock for somebody nobody is waiting on.
   *
   * `failure` is the campaign's ONE record, and it is surfaced here only when
   * it names THIS relationship. A failure recorded against a different Creator
   * on the same campaign is not this Creator's to resolve.
   */
  launchFailure: {
    required: boolean;
    failure: {
      status: string;
      dueAt: string | null;
      calendarVersion: string;
      replacementDesignation: string;
      recordedAt: string | null;
    } | null;
  };
  /** §18's traffic, with a conversion that is null rather than 0% over zero. */
  performance: RelationshipSection<{
    clicks: number;
    attributedReservations: number;
    capturedAttributed: number;
    conversion: string | null;
    capturedSubtotal: string;
    freshness: string;
  }>;
}

export interface MoneyPane {
  headline: { status: string; label: string; amount: string; owner: string };
  earnings: RelationshipSection<{
    validSubtotal: string;
    commission: string;
    bonus: string;
    fixedPayment: string;
    taxInBase: string;
    lockedPercent: number;
    earnedPercent: number;
    provisionalTotal: string;
    earnedTotal: string;
    unearnedReturned: string;
    state: string;
    stateHistory: { at: string; from: string | null; to: string; reason: string | null }[];
  }>;
  transfer: RelationshipSection<{
    status: string;
    total: string;
    requestedAt: string | null;
    confirmedAt: string | null;
    attempts: number;
  }>;
  completion: {
    outcome: string | null;
    decidedAt: string | null;
    deliverablesNote: string | null;
  } | null;
}

/* ── The Session C blocks (migration 0048, §22.4 idiom) ────────────────────*/

export interface DeliverableView {
  id: string;
  title: string;
  /** The agreement record the title restates — never typed by the caller. */
  source: string;
  /** Derived: latest decision wins; a receipt with no answer is submitted. */
  state: string;
  stateLabel: string;
  createdAt: string | null;
  latestEvidence: {
    id: string;
    reference: string;
    note: string | null;
    submittedBy: string;
    submittedAt: string | null;
  } | null;
  latestDecision: {
    outcome: string;
    findings: string;
    waiverRecordedBy: string | null;
    waiverReason: string | null;
    decidedBy: string;
    decidedAt: string | null;
  } | null;
}

export interface DeliverablesBlock {
  items: DeliverableView[];
  /** Verified or waived — §22.8's "every deliverable verified or waived". */
  resolved: number;
  /** Whether an accepted agreement exists for a new deliverable to restate. */
  canRecord: boolean;
  /** The source label a new deliverable will carry, when one can be recorded. */
  sourceLabel: string | null;
}

export interface AvailabilityBlock {
  /** The agreed term, composed from records — never typed on this surface. */
  term: string;
  /** Which record supplied the term. */
  termSource: string;
  checks: number;
  latest: {
    available: boolean;
    termChecked: string;
    detail: string;
    verifiedBy: string;
    verifiedAt: string | null;
  } | null;
}

export interface TerminationRequestView {
  id: string;
  reason: string;
  effectiveAt: string | null;
  cause: string;
  causeLabel: string;
  moneyTreatment: string;
  treatmentLabel: string;
  receivedVia: string;
  requestedAt: string | null;
  recordedBy: string;
  decision: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface KitAssetsBlock {
  /** False while the §12 bucket is Track A4 — the honest absence renders. */
  visualsAvailable: boolean;
  waitingOn: string | null;
  files: {
    id: string;
    purpose: string;
    state: string;
    filename: string | null;
    dimensions: string | null;
    approved: boolean;
    removed: boolean;
  }[];
}

export interface WorkAgainView {
  id: string;
  status: string;
  message: string;
  requestedAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
}

export interface CreatorRelationshipDetail {
  associationId: string;
  prospectId: string;
  campaignId: string;
  creatorName: string;
  band: RelationshipBand;
  overview: OverviewPane;
  agreement: AgreementPane;
  content: ContentPane;
  money: MoneyPane;
  /* The Session C blocks. Every one composes from records that already exist
     (0048 and earlier); nothing here is a second answer to a question another
     read already answers. */
  deliverables: DeliverablesBlock;
  availability: AvailabilityBlock;
  mediationNotes: { note: string; createdBy: string; createdAt: string | null }[];
  terminationRequests: {
    open: TerminationRequestView | null;
    history: TerminationRequestView[];
  };
  kitAssets: KitAssetsBlock;
  workAgain: WorkAgainView[];
}

/* ── The composer ───────────────────────────────────────────────────────────*/

export async function readCreatorRelationship(
  db: Database,
  associationId: string,
  options: {
    publicOrigin: string;
    linkTestMarker: string;
    stripeMode: StripeModeValue;
    /**
     * Whether the §12 bucket exists (Track A4). Absent reads as unconfigured,
     * which renders the honest kit-visuals absence rather than a control that
     * would fail (§1.4) — the record read takes the same option.
     */
    storageConfigured?: boolean;
  },
): Promise<CreatorRelationshipDetail | null> {
  const [row] = await db
    .select({
      association: campaignAffiliateAssociations,
      prospectName: affiliateProspects.legalName,
      prospectHandle: affiliateProspects.publicHandle,
      verificationStatus: affiliateProspects.verificationStatus,
      campaignType: campaigns.type,
      campaignStatus: campaigns.status,
      campaignCloseAt: campaigns.campaignCloseAt,
      campaignTitle: campaignBuild.title,
      campaignProduct: founderProspects.productName,
      founderName: founderClaimProfiles.legalName,
    })
    .from(campaignAffiliateAssociations)
    .innerJoin(
      affiliateProspects,
      eq(campaignAffiliateAssociations.prospectId, affiliateProspects.id),
    )
    .innerJoin(campaigns, eq(campaignAffiliateAssociations.campaignId, campaigns.id))
    .leftJoin(campaignBuild, eq(campaignBuild.campaignId, campaigns.id))
    .leftJoin(campaignDrafts, eq(campaignDrafts.campaignId, campaigns.id))
    .leftJoin(founderProspects, eq(founderProspects.id, campaignDrafts.prospectId))
    .leftJoin(founderClaimProfiles, eq(founderClaimProfiles.campaignId, campaigns.id))
    .where(eq(campaignAffiliateAssociations.id, associationId))
    .limit(1);

  if (!row) return null;

  const association = row.association;
  const campaignId = association.campaignId;
  /**
   * §14.3, §24.7: the fixed Creator payment is Product-only, and an Idea Campaign cannot
   * reach one by any path — the proposal trigger, the agreement trigger, and
   * the allocation trigger all refuse it. Read from the §9-locked campaign type
   * rather than from anything a caller supplied.
   */
  const isProduct = row.campaignType === 'pre_launch';


  /* ── The parts, in parallel where they are independent ─────────────────── */

  const [
    activation,
    link,
    versions,
    [agreement],
    [bonus],
    [allocation],
    submissions,
    [earnings],
    earningsHistory,
    [transfer],
    [completion],
    [deadline],
    readinessSnapshot,
    kitAccess,
    [rosterDecision],
    [launchFailureRow],
    deliverableRows,
    availabilityRows,
    mediationRows,
    terminationRows,
    [midCampaign],
    workAgainRows,
    kitAssetRows,
  ] = await Promise.all([
    db
      .select({ occurredAt: associationStatusHistory.occurredAt })
      .from(associationStatusHistory)
      .where(
        and(
          eq(associationStatusHistory.associationId, associationId),
          eq(associationStatusHistory.toStatus, 'active'),
        ),
      )
      .orderBy(associationStatusHistory.occurredAt)
      .limit(1),
    db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.associationId, associationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(proposalVersions)
      .where(eq(proposalVersions.associationId, associationId))
      .orderBy(proposalVersions.versionNumber),
    db
      .select()
      .from(associationCompensationAgreements)
      .where(eq(associationCompensationAgreements.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(creatorBonuses)
      .where(eq(creatorBonuses.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(creatorPaymentAllocations)
      .where(eq(creatorPaymentAllocations.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(creatorPostSubmissions)
      .where(eq(creatorPostSubmissions.associationId, associationId))
      .orderBy(creatorPostSubmissions.submittedAt),
    db
      .select()
      .from(creatorEarnings)
      .where(eq(creatorEarnings.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(creatorEarningsStateHistory)
      .where(eq(creatorEarningsStateHistory.associationId, associationId))
      .orderBy(desc(creatorEarningsStateHistory.occurredAt)),
    db
      .select()
      .from(affiliateTransfers)
      .where(eq(affiliateTransfers.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(creatorCompletionDecisions)
      .where(eq(creatorCompletionDecisions.associationId, associationId))
      .orderBy(desc(creatorCompletionDecisions.decidedAt))
      .limit(1),
    db
      .select()
      .from(responseDeadlineEvaluations)
      .where(eq(responseDeadlineEvaluations.campaignId, campaignId))
      .limit(1),
    // §16's checklist is DERIVED from thirteen live facts, never stored, so it
    // is gathered rather than selected. `association_readiness` is §15's
    // roster-decision record and answers a different question.
    gatherCreatorReadiness(db, options.stripeMode, associationId),
    db
      .select({
        occurredAt: campaignKitAccess.occurredAt,
      })
      .from(campaignKitAccess)
      .where(eq(campaignKitAccess.associationId, associationId))
      .orderBy(desc(campaignKitAccess.occurredAt)),
    // §15's roster decision, which is where "required for launch" is recorded.
    db
      .select({ launchRequired: associationReadiness.launchRequired })
      .from(associationReadiness)
      .where(eq(associationReadiness.associationId, associationId))
      .limit(1),
    // The campaign's one §29.6 record, matched to THIS relationship.
    db
      .select()
      .from(requiredCreatorFailures)
      .where(eq(requiredCreatorFailures.failedAssociationId, associationId))
      .limit(1),
    // The Session C records (0048). Each is association-scoped and insert-only.
    db
      .select()
      .from(associationDeliverables)
      .where(eq(associationDeliverables.associationId, associationId))
      .orderBy(associationDeliverables.createdAt),
    db
      .select()
      .from(associationAvailabilityVerifications)
      .where(eq(associationAvailabilityVerifications.associationId, associationId))
      .orderBy(desc(associationAvailabilityVerifications.verifiedAt)),
    db
      .select()
      .from(proposalMediationNotes)
      .where(eq(proposalMediationNotes.associationId, associationId))
      .orderBy(desc(proposalMediationNotes.createdAt)),
    db
      .select()
      .from(associationTerminationRequests)
      .where(eq(associationTerminationRequests.associationId, associationId))
      .orderBy(desc(associationTerminationRequests.requestedAt)),
    // §20's frozen mid-campaign terms — the availability term for a Creator
    // who joined mid-campaign is the sentence they actually accepted.
    db
      .select()
      .from(midCampaignAdditions)
      .where(eq(midCampaignAdditions.associationId, associationId))
      .limit(1),
    db
      .select()
      .from(workAgainRequests)
      .where(eq(workAgainRequests.associationId, associationId))
      .orderBy(desc(workAgainRequests.requestedAt)),
    // The campaign's visual assets — metadata only. No display URL exists
    // anywhere in the product; the port has no presigned GET to hand out.
    db
      .select({
        id: campaignAssets.id,
        purpose: campaignAssets.purpose,
        state: campaignAssets.state,
        originalFilename: campaignAssets.originalFilename,
        width: campaignAssets.width,
        height: campaignAssets.height,
        approvedAt: campaignAssets.approvedAt,
        removedAt: campaignAssets.removedAt,
      })
      .from(campaignAssets)
      .where(eq(campaignAssets.campaignId, campaignId))
      .orderBy(campaignAssets.createdAt),
  ]);

  /* The evidence receipts and decisions need the deliverable ids, so they are
     the one second round trip — batched with `inArray`, nothing in a loop. */
  const deliverableIds = deliverableRows.map((row) => row.id);
  const [evidenceRows, decisionRows] = deliverableIds.length
    ? await Promise.all([
        db
          .select()
          .from(associationDeliverableEvidence)
          .where(inArray(associationDeliverableEvidence.deliverableId, deliverableIds))
          .orderBy(desc(associationDeliverableEvidence.submittedAt)),
        db
          .select()
          .from(associationDeliverableDecisions)
          .where(inArray(associationDeliverableDecisions.deliverableId, deliverableIds))
          .orderBy(desc(associationDeliverableDecisions.decidedAt)),
      ])
    : [[], []];

  const campaignName = campaignNameOf(row.campaignTitle, row.campaignProduct);

  /* ── The band ──────────────────────────────────────────────────────────── */

  const band: RelationshipBand = {
    campaignName,
    campaignType: campaignTypeLabel(row.campaignType),
    founderName: row.founderName ?? row.campaignProduct,
    status: adminAssociationStatusLabel(association.status),
    statusRaw: association.status,
    owner: ownerFor(association.status),
    designation: rosterMembershipLabel(association.rosterMembership),
    activatedAt: formatInstant(activation[0]?.occurredAt ?? link?.activatedAt ?? null),
    closesAt: formatInstant(row.campaignCloseAt),
    // §14.6's window is one fixed 72-hour clock from `listing_paid_at`, and the
    // evaluation row is where it is recorded. Shown only while a decision on
    // this relationship is genuinely still open.
    responseDeadlineAt:
      deadline && !agreement && OPEN_DECISION_STATES.includes(association.status)
        ? formatInstant(deadline.deadlineAt)
        : null,
  };

  /* ── Overview ──────────────────────────────────────────────────────────── */

  const latest = submissions.at(-1) ?? null;

  const tasks: RelationshipTask[] = [];
  if (latest?.status === 'submitted') {
    tasks.push({
      kind: 'task',
      owner: 'Admin',
      title: 'First post submitted',
      meta: `${latest.postUrl} · submitted ${formatInstant(latest.submittedAt) ?? 'recently'}`,
      action: { label: 'Review submitted post', to: 'review' },
    });
  }
  if (latest?.status === 'correction_needed') {
    tasks.push({
      kind: 'waiting',
      owner: 'Affiliate',
      title: 'Post edits requested',
      meta: 'Affiliate link paused · a corrected public URL is required before traffic is payable again.',
      action: null,
    });
  }
  const openVersion = versions.find(
    (version) => version.state === 'awaiting_founder' || version.state === 'awaiting_creator',
  );
  if (openVersion) {
    tasks.push({
      kind: 'waiting',
      // §14.2 is bilateral: whichever party is awaited owns it, and Admin owns
      // neither — Admin may observe, mediate, and reject a policy violation,
      // and cannot accept for either party.
      owner: openVersion.state === 'awaiting_founder' ? 'Founder' : 'Affiliate',
      title: `Proposal version ${openVersion.versionNumber} waiting`,
      meta: 'The bilateral decision remains with the Founder and the Affiliate.',
      action: { label: 'Open the agreement', to: 'agreement' },
    });
  }
  if (earnings && (earnings.state === 'finalized' || earnings.state === 'approved_for_transfer')) {
    tasks.push({
      kind: 'task',
      owner: 'Admin',
      title: 'Money decision ready',
      meta: `${usd((earnings.earnedTotalCents))} finalized · the next Transfer decision is Proovd's.`,
      action: { label: 'Open the money record', to: 'money' },
    });
  }
  if (row.verificationStatus !== 'verified') {
    tasks.push({
      kind: 'task',
      owner: 'Admin',
      title: 'Creator readiness blocked',
      meta: 'Verification is not recorded as complete, so §16 readiness cannot clear.',
      action: { label: 'Review verification evidence', to: 'profile' },
    });
  }

  const linkView = link
    ? {
        state: (link.pausedAt ? 'paused' : link.active ? 'active' : 'inactive') as
          | 'inactive'
          | 'active'
          | 'paused',
        label: link.pausedAt
          ? 'Affiliate link paused'
          : link.active
            ? 'Affiliate link active'
            : 'Affiliate link inactive',
        url: `${options.publicOrigin}/c/${link.code}`,
        code: link.code,
        activatedAt: formatInstant(link.activatedAt),
        pausedAt: formatInstant(link.pausedAt),
        pausedReason: link.pausedReason,
        // §14.1's safe test: the marker is read by its exact shared name at the
        // ingest, which records the click `ignored/link_test` and sets no
        // cookie. An Admin checking a link must not be able to attribute one.
        testUrl: `${options.publicOrigin}/c/${link.code}?${options.linkTestMarker}=1`,
      }
    : null;

  const readinessResult = readinessSnapshot
    ? deriveCreatorReadiness(readinessSnapshot.snapshot)
    : null;
  const readinessItems = readinessResult
    ? readinessResult.items.map((item) => {
        const definition = READINESS_ITEMS.find(
          (entry: (typeof READINESS_ITEMS)[number]) => entry.key === item.key,
        )!;
        return {
          key: item.key,
          label: definition.label,
          owner: definition.owner,
          complete: item.complete,
          applicable: item.applicable,
        };
      })
    : null;

  const overview: OverviewPane = {
    tasks,
    link: linkView,
    readiness: readinessItems
      ? {
          complete: readinessItems.filter((item) => item.applicable && item.complete).length,
          applicable: readinessItems.filter((item) => item.applicable).length,
          canBeginWork: readinessResult?.canBeginWork ?? false,
          items: readinessItems,
        }
      : null,
    kit: {
      revealedAt: formatInstant(association.preparingRevealedAt),
      revokedAt: formatInstant(association.kitAccessRevokedAt),
      revokedReason: association.kitAccessRevokedReason,
      accessCount: kitAccess.length,
      lastAccessAt: formatInstant(kitAccess[0]?.occurredAt ?? null),
    },
  };

  /* ── Agreement ─────────────────────────────────────────────────────────── */

  const locked = versions.find((version) => version.state === 'locked') ?? null;
  const lockState = agreement
    ? locked
      ? `Locked · version ${locked.versionNumber}`
      : 'Accepted · locks at launch'
    : openVersion
      ? `Current proposal · version ${openVersion.versionNumber}`
      : 'No accepted version';

  const totalPercent = agreement?.totalPercent ?? openVersion?.bidTotalPercent ?? null;

  const agreementPane: AgreementPane = {
    lockState,
    headlinePercent: totalPercent === null ? null : `${totalPercent}%`,
    headlineRest:
      totalPercent === null
        ? 'No compensation has been agreed yet.'
        : 'of the attributed captured pre-tax reward subtotal.',
    bonus: bonus
      ? `+${bonus.additionalPercent}% once ${bonus.threshold} ${bonus.triggerUnit === 'unique_attributed_backers' ? 'attributed Backers' : 'in attributed subtotal'} is reached, combined cap ${bonus.maxCombinedPercent}%`
      : null,
    versions: versions.map((version) => ({
      id: version.id,
      number: version.versionNumber,
      proposedBy: version.proposedBy,
      totalPercent: version.bidTotalPercent,
      fixedPaymentCents:
        version.fixedPaymentRequestCents === null
          ? null
          : usd((version.fixedPaymentRequestCents)),
      state: version.state,
      affiliateDecision: version.affiliateDecision,
      founderDecision: version.founderDecision,
      createdAt: formatInstant(version.createdAt),
      lockedAt: formatInstant(version.lockedAt),
    })),
    agreement: agreement
      ? {
          basePercent: agreement.basePercent,
          bidIncreasePercent: agreement.bidIncreasePercent,
          totalPercent: agreement.totalPercent,
          fixedPayment:
            agreement.fixedPaymentCents === null
              ? null
              : usd((agreement.fixedPaymentCents)),
          acceptedAt: formatInstant(agreement.founderAcceptedAt ?? agreement.affiliateAcceptedAt),
        }
      : null,
    fixedPayment: {
      available: isProduct,
      // §14.3: an Idea Campaign cannot reach a fixed Creator payment by any path — the
      // proposal trigger, the agreement trigger, and the allocation trigger all
      // refuse it. The pane states the rule rather than showing an empty slot.
      rule: isProduct
        ? 'Optional · Product Campaigns only'
        : 'A fixed Creator payment is unavailable on Idea Campaigns',
      status: fixedPaymentStatus(isProduct, allocation ?? null, Boolean(agreement)),
      amount: allocation ? usd((allocation.amountCents)) : null,
      source: allocation ? 'Accepted proposal version' : isProduct ? 'None requested' : 'Campaign type rule',
      fundedAt: formatInstant(allocation?.fundedAt ?? null),
      deadlineAt: formatInstant(allocation?.fundingDeadlineAt ?? null),
    },
  };

  /* ── Content ───────────────────────────────────────────────────────────── */

  const performance = await composePerformance(db, {
    campaignId,
    associationId,
    linkId: link?.id ?? null,
    linkActive: Boolean(link?.activatedAt),
  });

  const content: ContentPane = {
    submission: latest
      ? {
          id: latest.id,
          version: submissions.length,
          url: latest.postUrl,
          status: latest.status,
          statusLabel: POST_STATUS_LABELS[latest.status] ?? latest.status,
          submittedAt: formatInstant(latest.submittedAt),
          verifiedAt: formatInstant(latest.verifiedAt),
          verifiedBy: latest.verifiedBy,
          correctionDetail: latest.correctionDetail,
          correctionDueAt: formatInstant(latest.correctionDueAt),
          enforcementReason: latest.enforcementReason,
          checklist: normaliseChecklist(latest.checklist),
        }
      : null,
    history: submissions.map((submission, index) => ({
      version: index + 1,
      url: submission.postUrl,
      status: POST_STATUS_LABELS[submission.status] ?? submission.status,
      submittedAt: formatInstant(submission.submittedAt),
    })),
    performance,
    launchFailure: {
      required: rosterDecision?.launchRequired ?? false,
      failure: launchFailureRow
        ? {
            status: launchFailureRow.status,
            // §29.6's window is three business days on the committed calendar,
            // stored WITH the version that produced it and immutable by
            // trigger. Rendered from the record rather than recomputed — a
            // deadline a surface works out is one that can drift from the sweep.
            dueAt: formatInstant(launchFailureRow.dueAt),
            calendarVersion: launchFailureRow.dueCalendarVersion,
            replacementDesignation: launchFailureRow.replacementDesignation,
            recordedAt: formatInstant(launchFailureRow.creatorFailureRecordedAt),
          }
        : null,
    },
  };

  /* ── Money ─────────────────────────────────────────────────────────────── */

  const money: MoneyPane = {
    headline: {
      status: earnings?.state ?? 'estimated',
      label: MONEY_STATE_LABELS[earnings?.state ?? 'estimated'] ?? (earnings?.state ?? 'Estimated'),
      amount: earnings ? usd((earnings.earnedTotalCents)) : usd(0n),
      owner: moneyOwner(earnings?.state ?? null),
    },
    earnings: earnings
      ? {
          populated: true,
          waitingOn: null,
          value: {
            validSubtotal: usd((earnings.validSubtotalCents)),
            commission: usd((earnings.commissionCents)),
            bonus: usd((earnings.bonusCents)),
            fixedPayment: usd((earnings.eligibleFixedCents)),
            // §24.3: sales tax is outside every Creator percentage. Stated as a
            // line rather than left to be inferred from a number that is right.
            taxInBase: usd(0n),
            lockedPercent: earnings.lockedTotalPercent,
            earnedPercent: earnings.earnedPercent,
            provisionalTotal: usd((earnings.provisionalTotalCents)),
            earnedTotal: usd((earnings.earnedTotalCents)),
            unearnedReturned: usd((earnings.unearnedReturnedCents)),
            state: earnings.state,
            stateHistory: earningsHistory.map((move) => ({
              at: formatInstant(move.occurredAt) ?? '',
              from: move.fromState,
              to: move.toState,
              reason: move.reason,
            })),
          },
        }
      : {
          populated: false,
          waitingOn:
            'Nothing has been captured yet, so nothing has been earned. §22.1 finalizes these amounts after the campaign closes.',
          value: null,
        },
    transfer: transfer
      ? {
          populated: true,
          waitingOn: null,
          value: {
            status: transfer.status,
            total: usd((transfer.totalCents)),
            requestedAt: formatInstant(transfer.requestedAt),
            confirmedAt: formatInstant(transfer.confirmedAt),
            attempts: transfer.attemptCount,
          },
        }
      : {
          populated: false,
          waitingOn:
            'The one campaign Transfer is created on or after Day 3, once earnings are approved and the §11 tax gate is satisfied.',
          value: null,
        },
    completion: completion
      ? {
          outcome: completion.outcome,
          decidedAt: formatInstant(completion.decidedAt),
          deliverablesNote: completion.deliverablesNote,
        }
      : null,
  };

  /* ── The Session C blocks ──────────────────────────────────────────────── */

  const evidenceByDeliverable = new Map<string, (typeof evidenceRows)[number]>();
  for (const receipt of evidenceRows) {
    // Rows arrive newest-first; the first seen per deliverable is the latest.
    if (!evidenceByDeliverable.has(receipt.deliverableId)) {
      evidenceByDeliverable.set(receipt.deliverableId, receipt);
    }
  }
  const decisionByDeliverable = new Map<string, (typeof decisionRows)[number]>();
  for (const decision of decisionRows) {
    if (!decisionByDeliverable.has(decision.deliverableId)) {
      decisionByDeliverable.set(decision.deliverableId, decision);
    }
  }

  const deliverableItems: DeliverableView[] = deliverableRows.map((item) => {
    const latestEvidence = evidenceByDeliverable.get(item.id) ?? null;
    const latestDecision = decisionByDeliverable.get(item.id) ?? null;
    // Latest decision wins; a receipt the latest decision predates has been
    // answered only if the decision came after it. Insert-only rows make the
    // comparison a timestamp read, not a state machine.
    const undecidedEvidence =
      latestEvidence &&
      (!latestDecision || latestDecision.decidedAt < latestEvidence.submittedAt);
    const state = undecidedEvidence
      ? 'evidence_submitted'
      : latestDecision
        ? latestDecision.outcome
        : latestEvidence
          ? 'evidence_submitted'
          : 'pending';
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      state,
      stateLabel: deliverableStateLabel(state),
      createdAt: formatInstant(item.createdAt),
      latestEvidence: latestEvidence
        ? {
            id: latestEvidence.id,
            reference: latestEvidence.reference,
            note: latestEvidence.note,
            submittedBy: latestEvidence.submittedBy,
            submittedAt: formatInstant(latestEvidence.submittedAt),
          }
        : null,
      latestDecision: latestDecision
        ? {
            outcome: latestDecision.outcome,
            findings: latestDecision.findings,
            waiverRecordedBy: latestDecision.waiverRecordedBy,
            waiverReason: latestDecision.waiverReason,
            decidedBy: latestDecision.decidedBy,
            decidedAt: formatInstant(latestDecision.decidedAt),
          }
        : null,
    };
  });

  const deliverables: DeliverablesBlock = {
    items: deliverableItems,
    resolved: deliverableItems.filter(
      (item) => item.state === 'verified' || item.state === 'waived',
    ).length,
    canRecord: Boolean(agreement) || Boolean(midCampaign),
    sourceLabel: deliverableSourceLabel(agreement ?? null, Boolean(midCampaign)),
  };

  const availabilityTerm = availabilityTermOf(
    midCampaign ?? null,
    row.campaignCloseAt ?? null,
  );
  const latestAvailability = availabilityRows[0] ?? null;
  const availability: AvailabilityBlock = {
    term: availabilityTerm.term,
    termSource: availabilityTerm.source,
    checks: availabilityRows.length,
    latest: latestAvailability
      ? {
          available: latestAvailability.available,
          termChecked: latestAvailability.termChecked,
          detail: latestAvailability.detail,
          verifiedBy: latestAvailability.verifiedBy,
          verifiedAt: formatInstant(latestAvailability.verifiedAt),
        }
      : null,
  };

  const terminationViews: TerminationRequestView[] = terminationRows.map((request) => ({
    id: request.id,
    reason: request.reason,
    effectiveAt: formatInstant(request.effectiveAt),
    cause: request.cause,
    causeLabel: findRefundCause(request.cause)?.label ?? request.cause,
    moneyTreatment: request.moneyTreatment,
    treatmentLabel: affiliateTreatmentLabel(request.moneyTreatment),
    receivedVia: request.receivedVia,
    requestedAt: formatInstant(request.requestedAt),
    recordedBy: request.recordedBy,
    decision: request.decision,
    decisionNote: request.decisionNote,
    decidedBy: request.decidedBy,
    decidedAt: formatInstant(request.decidedAt),
  }));

  const kitAssets: KitAssetsBlock = {
    visualsAvailable: options.storageConfigured === true,
    waitingOn:
      options.storageConfigured === true
        ? null
        : 'The §12 object storage is not configured in this deployment (Track A4), ' +
          'so there are no stored visuals to show. The asset records below are what ' +
          'the campaign holds; every Creator kit read is still logged.',
    files: kitAssetRows.map((asset) => ({
      id: asset.id,
      purpose: asset.purpose,
      state: asset.state,
      filename: asset.originalFilename,
      dimensions:
        asset.width !== null && asset.height !== null
          ? `${asset.width} × ${asset.height}`
          : null,
      approved: asset.approvedAt !== null,
      removed: asset.removedAt !== null,
    })),
  };

  return {
    associationId,
    prospectId: association.prospectId ?? association.affiliateId,
    campaignId,
    creatorName: row.prospectName ?? row.prospectHandle ?? 'Unnamed prospect',
    band,
    overview,
    agreement: agreementPane,
    content,
    money,
    deliverables,
    availability,
    mediationNotes: mediationRows.map((note) => ({
      note: note.note,
      createdBy: note.createdBy,
      createdAt: formatInstant(note.createdAt),
    })),
    terminationRequests: {
      open: terminationViews.find((request) => request.decision === null) ?? null,
      history: terminationViews.filter((request) => request.decision !== null),
    },
    kitAssets,
    workAgain: workAgainRows.map((request) => ({
      id: request.id,
      status: request.status,
      message: request.message,
      requestedAt: formatInstant(request.requestedAt),
      respondedAt: formatInstant(request.respondedAt),
      responseNote: request.responseNote,
    })),
  };
}

/**
 * The agreed availability term, READ from records — never typed on a surface.
 *
 * A mid-campaign Creator accepted the frozen remaining-time sentence
 * (`mid_campaign_additions.adjusted_deliverables`, immutable by trigger), so
 * that IS their term. Everyone else accepted §20's availability obligation
 * over the campaign period, so the term is the register's own sentence beside
 * the campaign's stored close anchor. The verification stores whichever it
 * checked, verbatim, so a later vocabulary change cannot rewrite the record.
 */
export function availabilityTermOf(
  midCampaign: { adjustedDeliverables: string } | null,
  closesAt: Date | null,
): { term: string; source: string } {
  if (midCampaign) {
    return {
      term: midCampaign.adjustedDeliverables,
      source: 'Mid-campaign addition terms, frozen at joining (§20)',
    };
  }
  const obligation = CREATOR_OBLIGATIONS.find(
    (entry) => entry.key === 'content_availability',
  )!;
  const close = formatInstant(closesAt);
  return {
    term: close ? `${obligation.statement} · Campaign close: ${close}` : obligation.statement,
    source: '§20 Creator obligations · the accepted campaign period',
  };
}

/**
 * What a new deliverable's `source` will say — the agreement record it
 * restates, derived from the records rather than the caller (0048's rule: a
 * deliverable never invents a work item the Creator did not agree to).
 */
export function deliverableSourceLabel(
  agreement: { source: string; proposalVersionId: string | null } | null,
  midCampaign: boolean,
): string | null {
  if (midCampaign) return 'Mid-campaign addition terms';
  if (!agreement) return null;
  return agreement.source === 'proposal_version'
    ? 'Accepted proposal version'
    : 'Standard terms acceptance';
}

/* ── Small derivations ──────────────────────────────────────────────────────*/

/** The §23.4 states where a formal decision on this relationship is still open. */
const OPEN_DECISION_STATES = ['formal_decision_open', 'reviewing', 'proposal_pending'];

function ownerFor(status: string): AttentionOwner {
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

const POST_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted for Admin review',
  passed: 'Post approved',
  correction_needed: 'Post edits requested',
  rejected: 'Post rejected',
};

const MONEY_STATE_LABELS: Record<string, string> = {
  estimated: 'Estimated',
  finalized: 'Finalized',
  approved_for_transfer: 'Approved for transfer',
  transferred: 'Transferred',
  paid_out: 'Paid out',
  payout_failed: 'Payout failed',
  adjusted: 'Adjusted',
};

/**
 * Who owns the next money step.
 *
 * `estimated` is the system's: nothing has been captured, so nothing has been
 * earned, and there is no decision to make. A payout failure is Stripe's and
 * the Affiliate's — Proovd cannot supply what the provider is asking for.
 */
function moneyOwner(state: string | null): string {
  switch (state) {
    case 'finalized':
    case 'approved_for_transfer':
      return 'Admin owns the next Transfer decision';
    case 'payout_failed':
      return 'Affiliate action required in Stripe';
    case null:
    case 'estimated':
      return 'System owns capture and reconciliation after campaign close';
    default:
      return 'Provider and system state · refresh for the latest result';
  }
}

/**
 * §24.7's allocation, in the reference's own state chain.
 *
 * `funded` is not `paid` and the word never implies it — §16's rule and the
 * pinned sentence beside the chain both say so.
 */
function fixedPaymentStatus(
  isProduct: boolean,
  allocation: { status: string } | null,
  accepted: boolean,
): string {
  if (!isProduct) return 'Not available';
  if (!allocation) return accepted ? 'Not requested' : 'Awaiting agreement';
  const labels: Record<string, string> = {
    payment_pending: 'Payment pending',
    funded: 'Funded',
    payment_failed: 'Payment failed',
    canceled: 'Canceled',
    returned: 'Returned',
    paid: 'Paid',
  };
  return labels[allocation.status] ?? allocation.status;
}

/** The seven §17 checks as they were recorded, or null when none were. */
function normaliseChecklist(
  raw: unknown,
): { id: string; label: string; passed: boolean }[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Array.isArray(raw) ? raw : Object.entries(raw as Record<string, unknown>);
  if (Array.isArray(raw)) {
    return (raw as { id?: unknown; label?: unknown; passed?: unknown }[])
      .filter((item) => typeof item?.id === 'string')
      .map((item) => ({
        id: String(item.id),
        label: typeof item.label === 'string' ? item.label : String(item.id),
        passed: item.passed === true,
      }));
  }
  return (entries as [string, unknown][]).map(([id, value]) => ({
    id,
    label: id.replace(/_/g, ' '),
    passed: value === true,
  }));
}

/**
 * §18's traffic for one relationship.
 *
 * A conversion over zero clicks is `null`, never `0%` — §16a's rule applied to
 * a rate, and the same one `readFounderResults` follows. No Backer identity is
 * read at all: §18 forbids the Affiliate seeing one, and an Admin surface that
 * joined to a Backer here would be one copy-paste from breaching it.
 */
async function composePerformance(
  db: Database,
  input: {
    campaignId: string;
    associationId: string;
    linkId: string | null;
    linkActive: boolean;
  },
): Promise<ContentPane['performance']> {
  if (!input.linkId || !input.linkActive) {
    return {
      populated: false,
      waitingOn:
        'The tracking link has not been activated, so no click can be attributed yet (§18).',
      value: null,
    };
  }

  const [clickRow] = await db
    .select({ total: count() })
    .from(trackingLinkClicks)
    .where(eq(trackingLinkClicks.trackingLinkId, input.linkId));

  const attributed = await db
    .select({
      status: reservations.status,
      subtotal: reservations.rewardSubtotalCents,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, input.campaignId),
        eq(reservations.attributionAssociationId, input.associationId),
      ),
    );

  const captured = attributed.filter((reservation) =>
    CAPTURED_STATUSES.includes(reservation.status),
  );
  const capturedSubtotal = captured.reduce(
    (total, reservation) => total + BigInt(reservation.subtotal ?? 0),
    0n,
  );

  const clicks = clickRow?.total ?? 0;

  return {
    populated: true,
    waitingOn: null,
    value: {
      clicks,
      attributedReservations: attributed.length,
      capturedAttributed: captured.length,
      conversion:
        clicks === 0
          ? null
          : `${((attributed.length / clicks) * 100).toFixed(1)}%`,
      capturedSubtotal: usd(capturedSubtotal),
      // §20/§30: never "real time". What this is, is a refresh.
      freshness: 'Refreshed on this read',
    },
  };
}

/** Ever-captured reservation states — a refund does not un-capture a charge. */
const CAPTURED_STATUSES = ['captured', 'refunded', 'reversed', 'disputed'];
